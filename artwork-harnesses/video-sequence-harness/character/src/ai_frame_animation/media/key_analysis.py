#!/usr/bin/env python3
"""Choose a solid colour key from a reference image without provider calls.

The module intentionally owns its small provider-neutral policy.
"""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path
from typing import Iterable

from PIL import Image

from . import matte as matte_policy


CANDIDATE_KEYS = (
    "#FF0000", "#FF8000", "#FFFF00", "#80FF00",
    "#00FF00", "#00FF80", "#00FFFF", "#0080FF",
    "#0000FF", "#8000FF", "#FF00FF", "#FF0080",
)
_TRACE_STRICT_FAMILY_RATIO = 0.001
_BLEND_FRACTIONS = (0.10, 0.25)
_BLEND_DISTORTION_LIMIT = 48.0
_BLEND_RISK_RATIO_LIMIT = 0.005
def parse_hex_color(value: str) -> tuple[int, int, int]:
    raw = value.strip().upper()
    if len(raw) != 7 or not raw.startswith("#"):
        raise ValueError("colour must be #RRGGBB")
    try:
        return tuple(int(raw[index : index + 2], 16) for index in (1, 3, 5))  # type: ignore[return-value]
    except ValueError as exc:
        raise ValueError("colour must be #RRGGBB") from exc


def _distance(rgb: tuple[int, int, int], key: tuple[int, int, int]) -> float:
    return math.sqrt(sum((left - right) ** 2 for left, right in zip(rgb, key)))


def _key_channel_groups(key: tuple[int, int, int]) -> tuple[tuple[int, ...], tuple[int, ...]] | None:
    ordered = sorted(range(3), key=lambda index: key[index])
    lower_gap = key[ordered[1]] - key[ordered[0]]
    upper_gap = key[ordered[2]] - key[ordered[1]]
    if max(lower_gap, upper_gap) <= 18 or lower_gap == upper_gap:
        return None
    split = 1 if lower_gap > upper_gap else 2
    return tuple(ordered[split:]), tuple(ordered[:split])


def _strict_key_family(rgb: tuple[int, int, int], key: tuple[int, int, int], delta: int = 9) -> bool:
    groups = _key_channel_groups(key)
    if groups is None:
        return False
    high, low = groups
    return bool(
        all(rgb[high_index] >= rgb[low_index] + delta for high_index in high for low_index in low)
    )


def _visible_pixels(
    image: Image.Image,
    min_alpha: int,
    *,
    max_pixels: int | None = None,
) -> tuple[list[tuple[int, int, int]], str]:
    rgba = image.convert("RGBA")
    if max_pixels is not None and max_pixels < 1:
        raise ValueError("max_pixels must be positive when supplied")
    total = rgba.width * rgba.height
    stride = 1 if max_pixels is None or total <= max_pixels else math.ceil(math.sqrt(total / max_pixels))
    pixels = rgba.load()
    visible = [
        pixels[x, y][:3]
        for y in range(0, rgba.height, stride)
        for x in range(0, rgba.width, stride)
        if pixels[x, y][3] >= min_alpha
    ]
    if not visible:
        raise ValueError("reference image has no visible pixels")
    alpha_minimum, _alpha_maximum = rgba.getchannel("A").getextrema()
    mode = "alpha_foreground" if alpha_minimum < min_alpha else "opaque_full_image_conservative"
    return visible, mode


def _percentile(values: list[float], fraction: float) -> float:
    ordered = sorted(values)
    return ordered[max(0, min(len(ordered) - 1, math.ceil(len(ordered) * fraction) - 1))]


def _blend_risk_ratio(
    visible: list[tuple[int, int, int]], key: tuple[int, int, int]
) -> float:
    """Predict destructive de-spill when codec/model output mixes in the key.

    A colour may be far from the exact key yet share the key's high channels.
    The global matte would then neutralize real subject colour after even a
    modest key cast.  Audit that exact downstream policy before generation.
    """

    risky = 0
    for rgb in visible:
        pixel_risky = False
        for fraction in _BLEND_FRACTIONS:
            mixed = tuple(
                round(channel * (1.0 - fraction) + key_channel * fraction)
                for channel, key_channel in zip(rgb, key)
            )
            next_alpha = matte_policy._dominance_alpha(mixed, key, 255)
            repaired = matte_policy._neutralize_key_channel(mixed, key)
            # Discount the ordinary key cast itself.  What matters is whether
            # the downstream neutralizer moves the recovered colour farther
            # from the source than leaving the mixed pixel untouched.
            distortion = _distance(repaired, rgb) - _distance(mixed, rgb)
            if next_alpha < 128 or distortion > _BLEND_DISTORTION_LIMIT:
                pixel_risky = True
                break
        risky += int(pixel_risky)
    return risky / len(visible)


def analyze_key_color(
    image: Image.Image,
    *,
    requested: str = "auto",
    candidates: Iterable[str] = CANDIDATE_KEYS,
    min_alpha: int = 16,
    max_pixels: int | None = None,
) -> dict:
    """Return the least-conflicting key and transparent audit evidence.

    A requested explicit key remains selected even if risky; that is a useful
    warning for a permissive delivery pipeline, not a hidden override.
    """

    candidate_list = tuple(str(item).upper() for item in candidates)
    if not candidate_list or len(set(candidate_list)) != len(candidate_list):
        raise ValueError("candidates must be a non-empty unique list")
    if any(candidate not in CANDIDATE_KEYS for candidate in candidate_list):
        raise ValueError("candidate is outside the built-in hue-wheel policy")
    automatic = requested.strip().lower() == "auto"
    requested_key = None if automatic else requested.strip().upper()
    if requested_key is not None:
        parse_hex_color(requested_key)
        if requested_key not in candidate_list:
            raise ValueError("requested colour is not supported by this runtime")

    visible, alpha_mode = _visible_pixels(image, min_alpha, max_pixels=max_pixels)
    audits = []
    for key_text in candidate_list:
        key = parse_hex_color(key_text)
        distances = [_distance(pixel, key) for pixel in visible]
        hard_ratio = sum(distance <= 50.0 for distance in distances) / len(distances)
        risk_ratio = sum(distance <= 80.0 for distance in distances) / len(distances)
        strict_family_ratio = sum(_strict_key_family(pixel, key) for pixel in visible) / len(visible)
        blend_risk_ratio = _blend_risk_ratio(visible, key)
        # Select only from actual visible subject pixels. The caller has
        # already applied source alpha or an explicit subject mask; request
        # prose can describe a colour without proving it occurs in this asset.
        # Tiny highlights and antialiased pixels must not make every candidate
        # unusable. Exact and near-key subject pixels still fail closed.
        # Channel-family and de-spill calculations are advisory ranking and
        # audit evidence: they identify edge-matte risk but cannot reject a
        # whole multicolour asset that contains no actual key-colour pixels.
        safe = (
            hard_ratio <= 0.005
            and risk_ratio <= 0.03
        )
        audits.append(
            {
                "key": key_text,
                "safe": safe,
                "hard_near_ratio": round(hard_ratio, 6),
                "risk_near_ratio": round(risk_ratio, 6),
                "strict_key_family_ratio": round(strict_family_ratio, 6),
                "blend_risk_ratio": round(blend_risk_ratio, 6),
                "distance_percentile_5": round(_percentile(distances, 0.05), 4),
            }
        )
    safe_audits = [record for record in audits if record["safe"]]
    ranked = sorted(
        audits,
        key=lambda record: (
            not bool(record["safe"]),
            float(record["blend_risk_ratio"]),
            float(record["strict_key_family_ratio"]),
            float(record["risk_near_ratio"]),
            -float(record["distance_percentile_5"]),
            candidate_list.index(str(record["key"])),
        ),
    )
    selected = requested_key if requested_key is not None else (
        str(ranked[0]["key"]) if safe_audits else None
    )
    selected_audit = next(
        (record for record in audits if record["key"] == selected),
        None,
    )
    warnings: list[str] = []
    if selected_audit is None or not selected_audit["safe"]:
        warnings.append("selected_key_has_palette_conflict")
    if alpha_mode == "opaque_full_image_conservative":
        warnings.append("opaque_reference_palette_audited_conservatively")
    return {
        "schema_version": "video_key_color_analysis_v1",
        "requested": requested,
        "selected": selected,
        "selected_safe": bool(selected_audit is not None and selected_audit["safe"]),
        "safe_candidate_count": len(safe_audits),
        "reference_mode": alpha_mode,
        "visible_pixel_count": len(visible),
        "candidates": audits,
        "warning_codes": warnings,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Analyse a reference image and choose a solid key colour.")
    parser.add_argument("--reference", required=True, type=Path)
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument("--requested", default="auto")
    args = parser.parse_args()
    with Image.open(args.reference) as source:
        payload = analyze_key_color(source, requested=args.requested)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(payload, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
