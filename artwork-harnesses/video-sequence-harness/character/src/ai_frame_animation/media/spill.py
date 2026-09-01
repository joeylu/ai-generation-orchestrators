#!/usr/bin/env python3
"""Remove boundary colour-key spill and clear hidden transparent RGB."""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

from PIL import Image, ImageChops, ImageFilter

try:  # Optional acceleration; the portable baseline remains Pillow-only.
    import numpy as np
except ModuleNotFoundError:  # pragma: no cover - exercised only in minimal deployments.
    np = None  # type: ignore[assignment]


def parse_hex_color(value: str) -> tuple[int, int, int]:
    raw = value.strip().lstrip("#")
    if len(raw) != 6:
        raise ValueError("key colour must be #RRGGBB")
    return tuple(int(raw[index : index + 2], 16) for index in (0, 2, 4))  # type: ignore[return-value]


def _distance(left: tuple[int, int, int], right: tuple[int, int, int]) -> float:
    return math.sqrt(sum((a - b) ** 2 for a, b in zip(left, right)))


def _key_channel_groups(key: tuple[int, int, int]) -> tuple[tuple[int, ...], tuple[int, ...]] | None:
    ordered = sorted(range(3), key=lambda index: key[index])
    lower_gap = key[ordered[1]] - key[ordered[0]]
    upper_gap = key[ordered[2]] - key[ordered[1]]
    if max(lower_gap, upper_gap) <= 18 or lower_gap == upper_gap:
        return None
    split = 1 if lower_gap > upper_gap else 2
    return tuple(ordered[split:]), tuple(ordered[:split])


def _key_family(rgb: tuple[int, int, int], key: tuple[int, int, int], delta: int) -> bool:
    groups = _key_channel_groups(key)
    if groups is None:
        return False
    highs, lows = groups
    if len(highs) != 1 or len(lows) < 2:
        return all(rgb[high] >= rgb[low] + delta for high in highs for low in lows)
    dominant = highs[0]
    if all(rgb[dominant] >= rgb[low] + delta for low in lows):
        return True
    for partner in lows:
        others = [index for index in lows if index != partner]
        if (
            others
            and abs(rgb[dominant] - rgb[partner]) <= delta
            and min(rgb[dominant], rgb[partner]) >= max(rgb[index] for index in others) + delta
        ):
            return True
    return False


def _strict_key_family(rgb: tuple[int, int, int], key: tuple[int, int, int], delta: int) -> bool:
    groups = _key_channel_groups(key)
    if groups is None:
        return False
    highs, lows = groups
    return all(rgb[high] >= rgb[low] + delta for high in highs for low in lows)


def _has_transparent_neighbor(pixels, x: int, y: int, width: int, height: int, threshold: int, radius: int) -> bool:
    for ny in range(max(0, y - radius), min(height, y + radius + 1)):
        for nx in range(max(0, x - radius), min(width, x + radius + 1)):
            if (nx, ny) != (x, y) and pixels[nx, ny][3] <= threshold:
                return True
    return False


def _nearby_body_colour(pixels, x: int, y: int, width: int, height: int, key: tuple[int, int, int], threshold: int, radius: int) -> tuple[int, int, int] | None:
    candidates = []
    for ny in range(max(0, y - radius), min(height, y + radius + 1)):
        for nx in range(max(0, x - radius), min(width, x + radius + 1)):
            if (nx, ny) == (x, y):
                continue
            red, green, blue, alpha = pixels[nx, ny]
            rgb = (red, green, blue)
            if alpha > threshold and not _key_family(rgb, key, 8):
                candidates.append((abs(nx - x) + abs(ny - y), rgb))
    return min(candidates, default=(0, None), key=lambda item: item[0])[1]


def zero_transparent_rgb(image: Image.Image) -> int:
    if image.mode != "RGBA":
        raise ValueError("zero_transparent_rgb requires an RGBA image")
    if np is not None:
        data = np.array(image, dtype=np.uint8)
        mask = (data[..., 3] == 0) & np.any(data[..., :3] != 0, axis=2)
        zeroed = int(np.count_nonzero(mask))
        if zeroed:
            data[mask, :3] = 0
            image.paste(Image.fromarray(data, "RGBA"))
        return zeroed
    pixels = image.load()
    zeroed = 0
    for y in range(image.height):
        for x in range(image.width):
            red, green, blue, alpha = pixels[x, y]
            if alpha == 0 and (red or green or blue):
                pixels[x, y] = (0, 0, 0, 0)
                zeroed += 1
    return zeroed


def key_residuals(
    image: Image.Image,
    *,
    key_color: tuple[int, int, int],
    alpha_threshold: int = 8,
    hard_distance: float = 24.0,
    strict_delta: int = 9,
) -> dict:
    rgba = image.convert("RGBA")
    if np is not None:
        data = np.array(rgba, dtype=np.uint8)
        # Squaring a channel delta needs more than int16 (255² overflows it).
        rgb = data[..., :3].astype(np.int32)
        alpha = data[..., 3]
        key = np.asarray(key_color, dtype=np.int32)
        visible = alpha > alpha_threshold
        hard = int(np.count_nonzero(visible & (np.square(rgb - key).sum(axis=2) <= hard_distance ** 2)))
        groups = _key_channel_groups(key_color)
        if groups is None:
            strict = 0
        else:
            highs, lows = groups
            strict_mask = np.ones(alpha.shape, dtype=bool)
            for high in highs:
                for low in lows:
                    strict_mask &= rgb[..., high] >= rgb[..., low] + strict_delta
            strict = int(np.count_nonzero(visible & strict_mask))
        hidden = int(np.count_nonzero((alpha == 0) & np.any(rgb != 0, axis=2)))
        return {
            "hard_key_residual_pixels": hard,
            "strict_key_family_residual_pixels": strict,
            "transparent_nonzero_rgb_pixels": hidden,
        }
    hard = strict = hidden = 0
    for red, green, blue, alpha in rgba.get_flattened_data():
        rgb = (red, green, blue)
        if alpha > alpha_threshold:
            hard += int(_distance(rgb, key_color) <= hard_distance)
            strict += int(_strict_key_family(rgb, key_color, strict_delta))
        elif alpha == 0 and (red or green or blue):
            hidden += 1
    return {
        "hard_key_residual_pixels": hard,
        "strict_key_family_residual_pixels": strict,
        "transparent_nonzero_rgb_pixels": hidden,
    }


def cleanup_key_spill(image: Image.Image, *, key_color: tuple[int, int, int], alpha_threshold: int = 8, radius: int = 2, chroma_distance: float = 120.0, min_channel_delta: int = 18) -> tuple[Image.Image, dict]:
    """Replace key spill along every exterior or enclosed alpha boundary."""

    rgba = image.convert("RGBA")
    pixels = rgba.load()
    changes: list[tuple[int, int, int, int, int, int]] = []
    alpha = rgba.getchannel("A")
    transparent = alpha.point(lambda value: 255 if value <= alpha_threshold else 0)
    near_transparent = transparent.filter(ImageFilter.MaxFilter(radius * 2 + 1))
    opaque = alpha.point(lambda value: 255 if value > alpha_threshold else 0)
    candidates = ImageChops.multiply(opaque, near_transparent)
    candidate_box = candidates.getbbox()
    candidate_pixels = candidates.load()
    if candidate_box is None:
        coordinates = ()
    else:
        left, top, right, bottom = candidate_box
        coordinates = (
            (x, y)
            for y in range(top, bottom)
            for x in range(left, right)
            if candidate_pixels[x, y]
        )
    for x, y in coordinates:
            red, green, blue, alpha = pixels[x, y]
            rgb = (red, green, blue)
            if _distance(rgb, key_color) > chroma_distance and not _key_family(rgb, key_color, min_channel_delta):
                continue
            replacement = _nearby_body_colour(pixels, x, y, rgba.width, rgba.height, key_color, alpha_threshold, radius + 2)
            if replacement is None:
                channels = list(rgb)
                groups = _key_channel_groups(key_color)
                highs, lows = groups if groups is not None else ((), ())
                cap = max((channels[index] for index in lows), default=max(channels))
                for index in highs:
                        channels[index] = min(channels[index], cap)
                replacement = tuple(channels)  # type: ignore[assignment]
            if replacement != rgb:
                changes.append((x, y, replacement[0], replacement[1], replacement[2], alpha))
    for x, y, red, green, blue, alpha in changes:
        pixels[x, y] = (red, green, blue, alpha)
    zeroed = zero_transparent_rgb(rgba)
    residuals = key_residuals(rgba, key_color=key_color, alpha_threshold=alpha_threshold)
    return rgba, {
        "key_color": "#" + "".join(f"{channel:02X}" for channel in key_color),
        "spill_pixels_modified": len(changes),
        "transparent_rgb_zeroed_pixels": zeroed,
        **residuals,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Clean actual key-colour spill from RGBA PNGs.")
    parser.add_argument("--input-dir", required=True, type=Path)
    parser.add_argument("--out-dir", required=True, type=Path)
    parser.add_argument("--report-out", required=True, type=Path)
    parser.add_argument("--key-color", required=True)
    args = parser.parse_args()
    key = parse_hex_color(args.key_color)
    paths = sorted(args.input_dir.glob("*.png"))
    args.out_dir.mkdir(parents=True, exist_ok=True)
    records = []
    for index, path in enumerate(paths, start=1):
        with Image.open(path) as source:
            cleaned, detail = cleanup_key_spill(source, key_color=key)
        output = args.out_dir / f"rgba_{index:03d}.png"
        cleaned.save(output)
        records.append({"index": index, "source": path.name, "file": output.name, **detail})
    report = {"schema_version": "video_key_spill_cleanup_report_v1", "frames": records}
    args.report_out.parent.mkdir(parents=True, exist_ok=True)
    args.report_out.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
