#!/usr/bin/env python3
"""Convert a solid-key frame sequence to RGBA using a globally safe key."""

from __future__ import annotations

import argparse
import json
import math
import shutil
import statistics
from pathlib import Path
from typing import Iterable

from PIL import Image

try:  # Optional acceleration; the Pillow-only path remains the portable baseline.
    import numpy as np
except ModuleNotFoundError:  # pragma: no cover - exercised only in minimal deployments.
    np = None  # type: ignore[assignment]


def parse_hex_color(value: str) -> tuple[int, int, int]:
    raw = value.strip().lstrip("#")
    if len(raw) != 6:
        raise ValueError("key colour must be #RRGGBB")
    return tuple(int(raw[index : index + 2], 16) for index in (0, 2, 4))  # type: ignore[return-value]


def rgb_to_ycbcr(rgb: tuple[int, int, int]) -> tuple[float, float, float]:
    red, green, blue = rgb
    return (0.299 * red + 0.587 * green + 0.114 * blue, 128 - 0.168736 * red - 0.331264 * green + 0.5 * blue, 128 + 0.5 * red - 0.418688 * green - 0.081312 * blue)


def colour_distance(rgb: tuple[int, int, int], key: tuple[int, int, int], color_space: str) -> float:
    if color_space == "rgb":
        return math.sqrt(sum((left - right) ** 2 for left, right in zip(rgb, key)))
    if color_space == "ycbcr":
        _y, cb, cr = rgb_to_ycbcr(rgb)
        _key_y, key_cb, key_cr = rgb_to_ycbcr(key)
        return math.sqrt((cb - key_cb) ** 2 + (cr - key_cr) ** 2)
    raise ValueError("color_space must be rgb or ycbcr")


def _key_channel_groups(key: tuple[int, int, int]) -> tuple[tuple[int, ...], tuple[int, ...]] | None:
    ordered = sorted(range(3), key=lambda index: key[index])
    lower_gap = key[ordered[1]] - key[ordered[0]]
    upper_gap = key[ordered[2]] - key[ordered[1]]
    if max(lower_gap, upper_gap) <= 18 or lower_gap == upper_gap:
        return None
    split = 1 if lower_gap > upper_gap else 2
    return tuple(sorted(ordered[split:])), tuple(sorted(ordered[:split]))


def _key_dominance(key: tuple[int, int, int]) -> tuple[tuple[int, ...], tuple[int, ...], int] | None:
    groups = _key_channel_groups(key)
    if groups is None:
        return None
    high, low = groups
    key_delta = min(key[index] for index in high) - max(key[index] for index in low)
    return (high, low, key_delta) if key_delta > 18 else None


def _dominance_alpha(
    rgb: tuple[int, int, int],
    key: tuple[int, int, int],
    alpha: int,
    *,
    minimum_delta: int = 8,
) -> int:
    """Estimate opacity from a safe key's channel direction.

    Video codecs alter the luminance of a solid key far more than its channel
    direction.  A dark green background can therefore be far from #00FF00 in
    RGB distance while still being unambiguously green-screen material.
    """

    policy = _key_dominance(key)
    if policy is None:
        return alpha
    high, low, key_delta = policy
    pixel_delta = min(rgb[index] for index in high) - max(rgb[index] for index in low)
    if pixel_delta <= minimum_delta:
        return alpha
    key_fraction = min(1.0, (pixel_delta - minimum_delta) / (key_delta - minimum_delta))
    return round(alpha * (1.0 - key_fraction))


def _neutralize_key_channel(
    rgb: tuple[int, int, int], key: tuple[int, int, int]
) -> tuple[int, int, int]:
    policy = _key_dominance(key)
    if policy is None:
        return rgb
    high, low, _key_delta = policy
    channels = list(rgb)
    cap = max(channels[index] for index in low)
    for index in high:
        channels[index] = min(channels[index], cap)
    return (channels[0], channels[1], channels[2])


def border_pixels(image: Image.Image, width: int = 2) -> list[tuple[int, int, int]]:
    rgb = image.convert("RGB")
    pixels = rgb.load()
    image_width, image_height = rgb.size
    values = []
    for y in range(image_height):
        for x in range(image_width):
            if x < width or y < width or x >= image_width - width or y >= image_height - width:
                values.append(pixels[x, y])
    return values


def calibrate_key_color(
    images: Iterable[Image.Image],
    declared_key: str,
    *,
    allow_topology_drift: bool = False,
) -> tuple[tuple[int, int, int], dict]:
    """Calibrate a flat observed key from frame borders.

    The normal route requires the codec-observed colour to retain the declared
    key's channel topology. Post-generation recovery may explicitly opt into a
    per-frame border-key fallback when a provider has changed its otherwise
    flat background mid-video.  That fallback is deliberately visible in the
    returned evidence; it is never used by the pre-authorization path.
    """

    declared = parse_hex_color(declared_key)
    pixels = [pixel for image in images for pixel in border_pixels(image)]
    if not pixels:
        raise ValueError("cannot calibrate an empty frame sequence")
    observed = tuple(round(statistics.median(pixel[channel] for pixel in pixels)) for channel in range(3))
    declared_groups = _key_channel_groups(declared)
    observed_groups = _key_channel_groups(observed)
    topology_matches = observed_groups == declared_groups
    if not topology_matches and not allow_topology_drift:
        raise ValueError("observed key channel topology differs from declared key")
    distance = colour_distance(observed, declared, "rgb")
    return observed, {
        "declared_key": "#" + "".join(f"{channel:02X}" for channel in declared),
        "observed_key_rgb": list(observed),
        "declared_distance": round(distance, 4),
        "sample_count": len(pixels),
        "topology_matches_declared": topology_matches,
        "topology_drift_fallback": not topology_matches,
    }


def _color_key_to_rgba_numpy(
    image: Image.Image,
    *,
    key_color: tuple[int, int, int],
    tolerance: float,
    softness: float,
    color_space: str,
) -> tuple[Image.Image, dict]:
    """Apply the scalar matte policy in bulk without changing its semantics."""

    assert np is not None
    source = np.array(image.convert("RGBA"), dtype=np.uint8)
    rgb = source[..., :3].astype(np.float64)
    alpha = source[..., 3].astype(np.float64)
    key = np.asarray(key_color, dtype=np.float64)
    if color_space == "rgb":
        distance = np.sqrt(np.square(rgb - key).sum(axis=2))
    else:
        red, green, blue = rgb[..., 0], rgb[..., 1], rgb[..., 2]
        cb = 128 - 0.168736 * red - 0.331264 * green + 0.5 * blue
        cr = 128 + 0.5 * red - 0.418688 * green - 0.081312 * blue
        _key_y, key_cb, key_cr = rgb_to_ycbcr(key_color)
        distance = np.sqrt(np.square(cb - key_cb) + np.square(cr - key_cr))
    distance_alpha = np.where(
        distance <= tolerance,
        0.0,
        np.where(
            distance <= tolerance + softness,
            np.rint(alpha * (distance - tolerance) / max(softness, 1e-9)),
            alpha,
        ),
    )
    dominance_alpha = alpha
    policy = _key_dominance(key_color)
    if policy is not None:
        high, low, key_delta = policy
        pixel_delta = np.min(rgb[..., list(high)], axis=2) - np.max(rgb[..., list(low)], axis=2)
        key_fraction = np.minimum(1.0, np.maximum(0.0, (pixel_delta - 8) / (key_delta - 8)))
        dominance_alpha = np.where(pixel_delta <= 8, alpha, np.rint(alpha * (1.0 - key_fraction)))
    next_alpha = np.minimum(distance_alpha, dominance_alpha)
    changed = next_alpha < alpha
    removed = int(np.count_nonzero(changed & (next_alpha == 0)))
    softened = int(np.count_nonzero(changed & (next_alpha != 0)))
    output = source.copy()
    foreground = changed & (next_alpha != 0)
    if policy is not None and np.any(foreground):
        high, low, _key_delta = policy
        cap = np.max(output[..., list(low)], axis=2)
        for channel in high:
            output[..., channel] = np.where(
                foreground,
                np.minimum(output[..., channel], cap),
                output[..., channel],
            )
    output[..., 3] = np.rint(next_alpha).astype(np.uint8)
    output[next_alpha == 0, :3] = 0
    return Image.fromarray(output, "RGBA"), {
        "background_policy": "global_safe_key",
        "candidate_pixels": removed + softened,
        "removed_pixels": removed,
        "softened_pixels": softened,
    }


def color_key_to_rgba(image: Image.Image, *, key_color: tuple[int, int, int], tolerance: float = 24.0, softness: float = 12.0, color_space: str = "rgb") -> tuple[Image.Image, dict]:
    if tolerance < 0 or softness < 0:
        raise ValueError("tolerance and softness must be non-negative")
    if np is not None:
        return _color_key_to_rgba_numpy(
            image,
            key_color=key_color,
            tolerance=tolerance,
            softness=softness,
            color_space=color_space,
        )
    rgba = image.convert("RGBA")
    pixels = rgba.load()
    width, height = rgba.size
    removed = softened = candidates = 0
    for y in range(height):
        for x in range(width):
            red, green, blue, alpha = pixels[x, y]
            rgb = (red, green, blue)
            distance = colour_distance(rgb, key_color, color_space)
            distance_alpha = alpha
            if distance <= tolerance:
                distance_alpha = 0
            elif distance <= tolerance + softness:
                distance_alpha = round(alpha * (distance - tolerance) / max(softness, 1e-9))
            dominance_alpha = _dominance_alpha(rgb, key_color, alpha)
            next_alpha = min(distance_alpha, dominance_alpha)
            if next_alpha >= alpha:
                continue
            candidates += 1
            if next_alpha == 0:
                removed += 1
            else:
                softened += 1
            foreground = (0, 0, 0) if next_alpha == 0 else _neutralize_key_channel(rgb, key_color)
            pixels[x, y] = (*foreground, next_alpha)
    return rgba, {
        "background_policy": "global_safe_key",
        "candidate_pixels": candidates,
        "removed_pixels": removed,
        "softened_pixels": softened,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Convert selected keyed PNGs to RGBA.")
    parser.add_argument("--input-dir", required=True, type=Path)
    parser.add_argument("--out-dir", required=True, type=Path)
    parser.add_argument("--report-out", required=True, type=Path)
    parser.add_argument("--key-color", required=True)
    parser.add_argument("--tolerance", type=float, default=24.0)
    parser.add_argument("--softness", type=float, default=12.0)
    parser.add_argument("--color-space", choices=("rgb", "ycbcr"), default="rgb")
    args = parser.parse_args()
    paths = sorted(args.input_dir.glob("*.png"))
    if not paths:
        raise SystemExit("input directory contains no PNG frames")
    images = []
    for path in paths:
        with Image.open(path) as source:
            images.append(source.convert("RGB"))
    observed, calibration = calibrate_key_color(images, args.key_color)
    args.out_dir.mkdir(parents=True, exist_ok=True)
    records = []
    for index, (path, image) in enumerate(zip(paths, images), start=1):
        rgba, detail = color_key_to_rgba(image, key_color=observed, tolerance=args.tolerance, softness=args.softness, color_space=args.color_space)
        output = args.out_dir / f"rgba_{index:03d}.png"
        rgba.save(output)
        records.append({"index": index, "source": path.name, "file": output.name, **detail})
    report = {"schema_version": "video_color_key_rgba_report_v1", "calibration": calibration, "color_space": args.color_space, "frames": records}
    args.report_out.parent.mkdir(parents=True, exist_ok=True)
    args.report_out.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
