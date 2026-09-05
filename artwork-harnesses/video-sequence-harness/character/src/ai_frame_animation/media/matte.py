#!/usr/bin/env python3
"""Convert a solid-key frame sequence to RGBA using a globally safe key."""

from __future__ import annotations

import argparse
from collections import deque
import json
import math
import shutil
import statistics
from pathlib import Path
from typing import Iterable

from PIL import Image, ImageFilter

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


def _recover_foreground_color(
    rgb: tuple[int, int, int],
    key: tuple[int, int, int],
    source_alpha: int,
    matte_alpha: int,
) -> tuple[int, int, int]:
    """Undo key-colour mixing for a straight-alpha foreground edge."""

    if matte_alpha <= 0 or source_alpha <= 0 or matte_alpha >= source_alpha:
        return rgb
    opacity = matte_alpha / source_alpha
    if opacity < 1 / 32:
        return (0, 0, 0)
    recovered = tuple(
        max(0, min(255, round((channel - (1.0 - opacity) * key_channel) / opacity)))
        for channel, key_channel in zip(rgb, key)
    )
    return _neutralize_key_channel(recovered, key)  # type: ignore[arg-type]


def _edge_connected_components(
    hard_mask: bytes,
    rgb_bytes: bytes,
    width: int,
    height: int,
    *,
    maximum_enclosed_stddev: float = 9.0,
) -> tuple[bytes, int, int]:
    """Select edge-connected key pixels and flat enclosed background holes."""

    total = width * height
    if len(hard_mask) != total or len(rgb_bytes) != total * 3:
        raise ValueError("matte_component_input_invalid")
    hard = bytearray(hard_mask)
    # C-level byte searches skip already visited spans instead of invoking the
    # Python queue once per pixel in broad canvas backgrounds.  The mask is
    # normalized so this remains equivalent for every non-zero byte value.
    remaining = hard.translate(bytes([0] + [1] * 255))
    connected = bytearray(total)
    pending: deque[int] = deque()
    edge_spans: deque[tuple[int, int]] = deque()

    def seed(index: int) -> int:
        if remaining[index]:
            row_start = index - index % width
            row_end = row_start + width
            left = remaining.rfind(b"\x00", row_start, index) + 1
            if left == 0:
                left = row_start
            right = remaining.find(b"\x00", index, row_end)
            right = (row_end if right == -1 else right) - 1
            connected[left : right + 1] = b"\x01" * (right - left + 1)
            remaining[left : right + 1] = b"\x00" * (right - left + 1)
            edge_spans.append((left, right))
            return right
        return index

    for x in range(width):
        seed(x)
        seed((height - 1) * width + x)
    for y in range(1, height - 1):
        seed(y * width)
        seed(y * width + width - 1)
    while edge_spans:
        left, right = edge_spans.popleft()
        for offset in (-width, width):
            if left + offset < 0 or right + offset >= total:
                continue
            index = remaining.find(b"\x01", left + offset, right + offset + 1)
            while index != -1:
                index = remaining.find(b"\x01", seed(index) + 1, right + offset + 1)

    edge_count = total - connected.count(0)
    if edge_count == total - hard.count(0):
        return bytes(connected), edge_count, 0
    enclosed_count = 0
    minimum_hole = max(48, total // 4096)
    rgb = memoryview(rgb_bytes)
    start = remaining.find(b"\x01")
    while start != -1:
        component: list[int] = []
        pending.append(start)
        remaining[start] = 0
        sums = [0, 0, 0]
        squares = [0, 0, 0]
        while pending:
            index = pending.popleft()
            component.append(index)
            base = index * 3
            for channel in range(3):
                value = int(rgb[base + channel])
                sums[channel] += value
                squares[channel] += value * value
            x = index % width
            for neighbour in (index - width, index + width, index - 1, index + 1):
                if neighbour < 0 or neighbour >= total:
                    continue
                if (neighbour == index - 1 and x == 0) or (neighbour == index + 1 and x == width - 1):
                    continue
                if remaining[neighbour]:
                    remaining[neighbour] = 0
                    pending.append(neighbour)
        count = len(component)
        start = remaining.find(b"\x01", start + 1)
        if count < minimum_hole:
            continue
        maximum_stddev = max(
            math.sqrt(max(0.0, squares[channel] / count - (sums[channel] / count) ** 2))
            for channel in range(3)
        )
        if maximum_stddev > maximum_enclosed_stddev:
            continue
        for index in component:
            connected[index] = 1
        enclosed_count += count
    return bytes(connected), edge_count, enclosed_count


def _dilate_binary_mask(mask, radius: int):
    """Exact square max filter for a binary mask with clipped edge windows."""

    source = np.asarray(mask, dtype=bool)
    if source.ndim != 2 or not isinstance(radius, int) or radius < 0:
        raise ValueError("binary_dilation_input_invalid")
    height, width = source.shape
    horizontal = source.copy()
    for shift in range(1, min(radius, width - 1) + 1):
        horizontal[:, shift:] |= source[:, :-shift]
        horizontal[:, :-shift] |= source[:, shift:]
    result = horizontal.copy()
    for shift in range(1, min(radius, height - 1) + 1):
        result[shift:, :] |= horizontal[:-shift, :]
        result[:-shift, :] |= horizontal[shift:, :]
    return result


def _dilate_mask(mask: bytes, width: int, height: int, radius: int = 2) -> bytes:
    if np is not None:
        values = np.frombuffer(mask, dtype=np.uint8, count=width * height).reshape(height, width)
        return _dilate_binary_mask(values, radius).astype(np.uint8).tobytes()
    image = Image.frombytes("L", (width, height), bytes(255 if value else 0 for value in mask))
    return bytes(1 if value else 0 for value in image.filter(ImageFilter.MaxFilter(radius * 2 + 1)).tobytes())


def _large_compact_regions(mask: bytes, width: int, height: int) -> bytes:
    """Find smooth key-colour islands without selecting small detailed effects."""

    total = width * height
    source = bytearray(mask)
    visited = bytearray(total)
    selected = bytearray(total)
    pending: deque[int] = deque()
    minimum_size = max(256, total // 2048)
    starts = np.flatnonzero(np.frombuffer(source, dtype=np.uint8)).tolist() if np is not None else range(total)
    for start in starts:
        if not source[start] or visited[start]:
            continue
        component: list[int] = []
        pending.append(start)
        visited[start] = 1
        min_x = max_x = start % width
        min_y = max_y = start // width
        while pending:
            index = pending.popleft()
            component.append(index)
            x, y = index % width, index // width
            min_x, max_x = min(min_x, x), max(max_x, x)
            min_y, max_y = min(min_y, y), max(max_y, y)
            for neighbour in (index - width, index + width, index - 1, index + 1):
                if neighbour < 0 or neighbour >= total:
                    continue
                if (neighbour == index - 1 and x == 0) or (neighbour == index + 1 and x == width - 1):
                    continue
                if source[neighbour] and not visited[neighbour]:
                    visited[neighbour] = 1
                    pending.append(neighbour)
        box_area = (max_x - min_x + 1) * (max_y - min_y + 1)
        if len(component) >= minimum_size and len(component) / box_area >= 0.35:
            for index in component:
                selected[index] = 1
    return bytes(selected)


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


def analyze_sequence_background(
    images: Iterable[Image.Image],
    *,
    declared_key: tuple[int, int, int] | None = None,
) -> dict:
    """Classify an opaque sequence without assuming one colour for all frames."""

    records = []
    dominance = _key_dominance(declared_key) if declared_key is not None else None
    for image in images:
        pixels = border_pixels(image, width=4)
        if not pixels:
            raise ValueError("background_border_empty")
        observed = tuple(round(statistics.median(pixel[channel] for pixel in pixels)) for channel in range(3))
        distances = sorted(colour_distance(pixel, observed, "rgb") for pixel in pixels)
        p95 = distances[min(len(distances) - 1, math.ceil(len(distances) * 0.95) - 1)]
        p99 = distances[min(len(distances) - 1, math.ceil(len(distances) * 0.99) - 1)]
        record = {"observed_key_rgb": list(observed), "border_p95": round(p95, 4), "border_p99": round(p99, 4)}
        if dominance is not None:
            high, low, _key_delta = dominance
            family_count = sum(
                min(pixel[index] for index in high) - max(pixel[index] for index in low) > 8
                for pixel in pixels
            )
            record["key_family_ratio"] = round(family_count / len(pixels), 6)
        records.append(record)
    if not records:
        raise ValueError("background_sequence_empty")
    clip_key = tuple(round(statistics.median(record["observed_key_rgb"][channel] for record in records)) for channel in range(3))
    maximum_drift = max(colour_distance(tuple(record["observed_key_rgb"]), clip_key, "rgb") for record in records)
    spatially_complex = sum(record["border_p95"] > 28.0 or record["border_p99"] > 42.0 for record in records)
    minimum_key_family_ratio = (
        min(float(record["key_family_ratio"]) for record in records)
        if dominance is not None
        else None
    )
    if spatially_complex > max(1, len(records) // 8):
        route = (
            "per_frame_key_family_drift"
            if minimum_key_family_ratio is not None and minimum_key_family_ratio >= 0.95
            else "background_unkeyable"
        )
    elif maximum_drift > 48.0:
        route = "per_frame_flat_color_drift"
    else:
        route = "clip_stable_flat_color"
    return {
        "policy": "cpu_border_sequence_v1",
        "route": route,
        "frame_count": len(records),
        "clip_median_rgb": list(clip_key),
        "maximum_frame_key_drift": round(maximum_drift, 4),
        "spatially_complex_frames": spatially_complex,
        "maximum_border_p95": max(record["border_p95"] for record in records),
        "maximum_border_p99": max(record["border_p99"] for record in records),
        "minimum_border_key_family_ratio": minimum_key_family_ratio,
        "frames": records,
    }


def _effective_thresholds(
    image: Image.Image,
    key_color: tuple[int, int, int],
    tolerance: float,
    softness: float,
) -> tuple[float, float]:
    if max(key_color) - min(key_color) > 24:
        return tolerance, softness
    distances = sorted(colour_distance(pixel, key_color, "rgb") for pixel in border_pixels(image))
    percentile = distances[min(len(distances) - 1, math.ceil(len(distances) * 0.95) - 1)] if distances else 0.0
    return min(tolerance, max(6.0, percentile + 4.0)), min(softness, 10.0)


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
    """Build a conservative spatial matte without globally erasing subject colours."""

    assert np is not None
    source_image = image.convert("RGBA")
    tolerance, softness = _effective_thresholds(source_image, key_color, tolerance, softness)
    source = np.array(source_image, dtype=np.uint8)
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
    distance_alpha = np.where(distance <= tolerance, 0.0, np.where(
        distance <= tolerance + softness,
        np.rint(alpha * (distance - tolerance) / max(softness, 1e-9)),
        alpha,
    ))
    dominance_alpha = alpha.copy()
    policy = _key_dominance(key_color)
    if policy is not None:
        high, low, key_delta = policy
        pixel_delta = np.min(rgb[..., list(high)], axis=2) - np.max(rgb[..., list(low)], axis=2)
        key_fraction = np.minimum(1.0, np.maximum(0.0, (pixel_delta - 8) / (key_delta - 8)))
        dominance_alpha = np.where(pixel_delta <= 8, alpha, np.rint(alpha * (1.0 - key_fraction)))
    soft_candidate = (distance_alpha < alpha) | ((dominance_alpha < alpha) & (distance <= max(144.0, tolerance + softness)))
    hard_candidate = (distance <= tolerance) | ((dominance_alpha <= 16) & (distance <= max(72.0, tolerance + softness)))
    rgb_u8 = source[..., :3]
    background_bytes, edge_count, enclosed_count = _edge_connected_components(
        hard_candidate.astype(np.uint8).tobytes(), rgb_u8.tobytes(), source.shape[1], source.shape[0]
    )
    background = np.frombuffer(background_bytes, dtype=np.uint8).reshape(alpha.shape).astype(bool)
    edge_radius = 3 if policy is not None else 2
    dilated_bytes = _dilate_mask(background_bytes, source.shape[1], source.shape[0], radius=edge_radius)
    dilated = np.frombuffer(dilated_bytes, dtype=np.uint8).reshape(alpha.shape).astype(bool)
    edge = dilated & ~background & soft_candidate
    protected_candidate = soft_candidate & ~background & ~edge
    ambiguous = np.zeros(alpha.shape, dtype=bool)
    if max(key_color) - min(key_color) > 24:
        ambiguous_bytes = _large_compact_regions(
            protected_candidate.astype(np.uint8).tobytes(), source.shape[1], source.shape[0]
        )
        ambiguous = np.frombuffer(ambiguous_bytes, dtype=np.uint8).reshape(alpha.shape).astype(bool)
    next_alpha = alpha.copy()
    next_alpha[background] = 0
    edge_alpha = distance_alpha
    if policy is not None:
        edge_alpha = np.minimum(distance_alpha, dominance_alpha)
    next_alpha[edge] = np.minimum(edge_alpha[edge], alpha[edge])
    ambiguous_alpha = np.minimum(np.minimum(distance_alpha[ambiguous], dominance_alpha[ambiguous]), alpha[ambiguous])
    next_alpha[ambiguous] = np.rint(np.square(ambiguous_alpha) / np.maximum(alpha[ambiguous], 1.0))
    changed = next_alpha < alpha
    removed = int(np.count_nonzero(background))
    softened = int(np.count_nonzero(edge & (next_alpha > 0) & changed))
    protected = int(np.count_nonzero(protected_candidate & ~ambiguous))
    ambiguous_softened = int(np.count_nonzero(ambiguous & (next_alpha < alpha)))
    if policy is not None:
        next_alpha[(edge | ambiguous) & (next_alpha <= 8)] = 0
    output = source.copy()
    foreground = (edge | ambiguous) & changed & (next_alpha != 0)
    if policy is not None and np.any(foreground):
        opacity = next_alpha / np.maximum(alpha, 1.0)
        recovered = np.rint((rgb - (1.0 - opacity[..., None]) * key) / np.maximum(opacity[..., None], 1 / 32))
        recovered_u8 = np.clip(recovered, 0, 255).astype(np.uint8)
        high, low, _key_delta = policy
        cap = np.max(recovered_u8[..., list(low)], axis=2)
        for channel in high:
            recovered_u8[..., channel] = np.minimum(recovered_u8[..., channel], cap)
        output[..., :3] = np.where(foreground[..., None], recovered_u8, output[..., :3])
    output[..., 3] = np.rint(next_alpha).astype(np.uint8)
    output[next_alpha == 0, :3] = 0
    return Image.fromarray(output, "RGBA"), {
        "background_policy": "edge_connected_key_v3",
        "candidate_pixels": int(np.count_nonzero(soft_candidate)),
        "removed_pixels": removed,
        "softened_pixels": softened,
        "edge_connected_pixels": edge_count,
        "enclosed_background_pixels": enclosed_count,
        "protected_candidate_pixels": protected,
        "ambiguous_compact_pixels_softened": ambiguous_softened,
        "edge_radius": edge_radius,
        "effective_tolerance": round(tolerance, 4),
        "effective_softness": round(softness, 4),
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
    tolerance, softness = _effective_thresholds(rgba, key_color, tolerance, softness)
    pixels = rgba.load()
    width, height = rgba.size
    source_pixels = list(rgba.get_flattened_data())
    hard = bytearray(width * height)
    soft = bytearray(width * height)
    distance_alphas = [255] * (width * height)
    dominance_alphas = [255] * (width * height)
    for index, (red, green, blue, alpha) in enumerate(source_pixels):
        rgb = (red, green, blue)
        distance = colour_distance(rgb, key_color, color_space)
        distance_alpha = alpha
        if distance <= tolerance:
            distance_alpha = 0
        elif distance <= tolerance + softness:
            distance_alpha = round(alpha * (distance - tolerance) / max(softness, 1e-9))
        dominance_alpha = _dominance_alpha(rgb, key_color, alpha)
        soft[index] = int(distance_alpha < alpha or (dominance_alpha < alpha and distance <= max(144.0, tolerance + softness)))
        hard[index] = int(distance <= tolerance or (dominance_alpha <= 16 and distance <= max(72.0, tolerance + softness)))
        distance_alphas[index] = distance_alpha
        dominance_alphas[index] = dominance_alpha
    rgb_bytes = bytes(channel for pixel in source_pixels for channel in pixel[:3])
    background, edge_count, enclosed_count = _edge_connected_components(bytes(hard), rgb_bytes, width, height)
    policy = _key_dominance(key_color)
    edge_radius = 3 if policy is not None else 2
    dilated = _dilate_mask(background, width, height, radius=edge_radius)
    protected_mask = bytes(int(bool(soft[index]) and not background[index] and not dilated[index]) for index in range(width * height))
    ambiguous = _large_compact_regions(protected_mask, width, height) if max(key_color) - min(key_color) > 24 else bytes(width * height)
    removed = softened = protected = ambiguous_softened = 0
    for y in range(height):
        for x in range(width):
            index = y * width + x
            red, green, blue, alpha = pixels[x, y]
            rgb = (red, green, blue)
            if background[index]:
                next_alpha = 0
                removed += 1
            elif (dilated[index] and soft[index]) or ambiguous[index]:
                use_dominance = policy is not None and (bool(dilated[index]) or bool(ambiguous[index]))
                next_alpha = min(alpha, distance_alphas[index], dominance_alphas[index] if use_dominance else alpha)
                if ambiguous[index] and alpha:
                    next_alpha = round(next_alpha * next_alpha / alpha)
                if policy is not None and next_alpha <= 8:
                    next_alpha = 0
                softened += int(next_alpha < alpha and next_alpha > 0)
                ambiguous_softened += int(bool(ambiguous[index]) and next_alpha < alpha)
            else:
                next_alpha = alpha
                protected += int(bool(soft[index]))
            if next_alpha >= alpha:
                continue
            foreground = (0, 0, 0) if next_alpha == 0 else (
                _recover_foreground_color(rgb, key_color, alpha, next_alpha)
                if policy is not None
                else _neutralize_key_channel(rgb, key_color)
            )
            pixels[x, y] = (*foreground, next_alpha)
    return rgba, {
        "background_policy": "edge_connected_key_v3",
        "candidate_pixels": int(sum(soft)),
        "removed_pixels": removed,
        "softened_pixels": softened,
        "edge_connected_pixels": edge_count,
        "enclosed_background_pixels": enclosed_count,
        "protected_candidate_pixels": protected,
        "ambiguous_compact_pixels_softened": ambiguous_softened,
        "edge_radius": edge_radius,
        "effective_tolerance": round(tolerance, 4),
        "effective_softness": round(softness, 4),
    }


def remove_tiny_detached_alpha_components(
    image: Image.Image,
    *,
    alpha_threshold: int = 8,
    maximum_area: int | None = None,
) -> tuple[Image.Image, dict]:
    """Drop tiny isolated low-chroma matte islands without removing real props."""

    rgba = image.convert("RGBA")
    width, height = rgba.size
    limit = maximum_area if maximum_area is not None else max(4, round(width * height * 0.0001))
    alpha = bytearray(rgba.getchannel("A").tobytes())
    seen = bytearray(width * height)
    removable: list[list[int]] = []
    component_sizes: list[int] = []
    for start, value in enumerate(alpha):
        if value <= alpha_threshold or seen[start]:
            continue
        queue = deque([start])
        seen[start] = 1
        component: list[int] = []
        while queue:
            index = queue.popleft()
            component.append(index)
            x = index % width
            if x and alpha[index - 1] > alpha_threshold and not seen[index - 1]:
                seen[index - 1] = 1
                queue.append(index - 1)
            if x + 1 < width and alpha[index + 1] > alpha_threshold and not seen[index + 1]:
                seen[index + 1] = 1
                queue.append(index + 1)
            if index >= width and alpha[index - width] > alpha_threshold and not seen[index - width]:
                seen[index - width] = 1
                queue.append(index - width)
            if index + width < width * height and alpha[index + width] > alpha_threshold and not seen[index + width]:
                seen[index + width] = 1
                queue.append(index + width)
        component_sizes.append(len(component))
        if len(component) <= limit:
            removable.append(component)
    # An all-particle image has no trustworthy primary component; leave it alone.
    if component_sizes and max(component_sizes) <= limit:
        removable = []
    if not removable:
        return rgba, {
            "policy": "low_chroma_tiny_detached_alpha_v1",
            "maximum_area": limit,
            "removed_components": 0,
            "removed_pixels": 0,
        }
    pixels = bytearray(rgba.tobytes())
    for component in removable:
        for index in component:
            offset = index * 4
            pixels[offset : offset + 4] = b"\x00\x00\x00\x00"
    return Image.frombytes("RGBA", rgba.size, bytes(pixels)), {
        "policy": "low_chroma_tiny_detached_alpha_v1",
        "maximum_area": limit,
        "removed_components": len(removable),
        "removed_pixels": sum(len(component) for component in removable),
    }


def aggressive_color_key_cleanup(
    image: Image.Image,
    *,
    source_image: Image.Image,
    key_color: tuple[int, int, int],
    key_palette: Iterable[tuple[int, int, int]],
    alpha_threshold: int = 8,
    key_family_safe: bool = False,
) -> tuple[Image.Image, dict]:
    """Remove strong cross-frame key remnants under a visible-area damage budget."""

    if image.size != source_image.size:
        raise ValueError("aggressive_key_source_dimensions_differ")
    palette = list(dict.fromkeys(tuple(color) for color in key_palette))
    saturated_palette = [color for color in palette if max(color) - min(color) > 24]
    default_report = {
        "policy": "guarded_clip_palette_hard_key_v2",
        "removed_pixels": 0,
        "spill_pixels_neutralized": 0,
        "partner_hue_spill_pixels_neutralized": 0,
        "global_safe_spill_pixels_neutralized": 0,
        "key_family_safe": key_family_safe,
        "palette_size": len(saturated_palette),
        "palette_damage_fallback": False,
        "current_key_damage_fallback": False,
        "conservative_damage_fallback": False,
    }
    if np is None:
        return image.convert("RGBA"), {**default_report, "skipped": True, "reason": "numpy_unavailable"}
    if not saturated_palette or max(key_color) - min(key_color) <= 24:
        return image.convert("RGBA"), {**default_report, "skipped": True, "reason": "low_chroma_key"}

    rgba = np.array(image.convert("RGBA"), dtype=np.uint8)
    evidence = np.array(source_image.convert("RGB"), dtype=np.uint8)
    rgb = evidence.astype(np.int16)
    alpha = rgba[..., 3]
    transparent = (alpha <= alpha_threshold).astype(np.uint8)
    near_transparent = _dilate_binary_mask(transparent, 4)

    def key_masks(colors: list[tuple[int, int, int]]) -> tuple[object, object]:
        broad = np.zeros(alpha.shape, dtype=bool)
        strong = np.zeros(alpha.shape, dtype=bool)
        for palette_color in colors:
            palette_key = np.asarray(palette_color, dtype=np.int16)
            palette_highs = np.flatnonzero(palette_key >= int(palette_key.max()) - 32)
            palette_lows = np.flatnonzero(palette_key <= int(palette_key.min()) + 32)
            palette_dominance = np.min(rgb[..., palette_highs], axis=2) - np.max(rgb[..., palette_lows], axis=2)
            palette_distance = np.sqrt(np.square(rgb.astype(np.float32) - palette_key.astype(np.float32)).sum(axis=2))
            broad |= (palette_distance <= 85.0) | ((palette_dominance >= 12) & (palette_distance <= 185.0))
            strong |= (palette_distance <= 56.0) | ((palette_dominance >= 28) & (palette_distance <= 170.0))
        return broad, strong

    broad_key_family, global_strong_key = key_masks(saturated_palette)
    visible = alpha > alpha_threshold
    visible_pixels = int(np.count_nonzero(visible))
    damage_limit = max(2048, round(visible_pixels * 0.30))
    unsafe_attempt = broad_key_family & (near_transparent | global_strong_key) & visible
    palette_attempted_removed = int(np.count_nonzero(unsafe_attempt))
    palette_damage_fallback = len(saturated_palette) > 8 and palette_attempted_removed > damage_limit
    if palette_damage_fallback:
        return image.convert("RGBA"), {
            **default_report,
            "skipped": True,
            "reason": "palette_damage_budget_exceeded",
            "palette_damage_fallback": True,
            "conservative_damage_fallback": True,
            "palette_attempted_removed_pixels": palette_attempted_removed,
            "current_key_attempted_removed_pixels": 0,
            "attempted_visible_damage_ratio": round(palette_attempted_removed / max(1, visible_pixels), 6),
            "visible_damage_ratio": 0.0,
            "distance_threshold": 85,
            "near_transparent_radius": 4,
        }
    # Cross-frame colours are allowed to clear only ordinary boundary spill or
    # a large, flat connected region. This removes a background visible through
    # a closed ribbon/limb hole without treating a detailed same-colour effect
    # as background merely because another frame used that hue on its border.
    enclosed_palette = np.zeros(alpha.shape, dtype=bool)
    rgb_bytes = evidence.tobytes()
    for palette_color in saturated_palette:
        palette_broad, strong = key_masks([palette_color])
        selected, _edge_count, _enclosed_count = _edge_connected_components(
            strong.astype(np.uint8).tobytes(),
            rgb_bytes,
            source_image.width,
            source_image.height,
            # Moving arm/body gaps remain semantically flat green-screen holes,
            # but codec ringing can raise their per-channel deviation above the
            # conservative first-pass limit. Component area still protects tiny
            # same-family character details from this relaxed sequence pass.
            maximum_enclosed_stddev=60.0,
        )
        palette_region = np.frombuffer(selected, dtype=np.uint8).reshape(alpha.shape).astype(bool)
        # The component is the semantic evidence. Grow only through this one
        # palette family, never through a union that could bridge foreground.
        for _iteration in range(8):
            grown = _dilate_binary_mask(palette_region, 1) & palette_broad
            if np.array_equal(grown, palette_region):
                break
            palette_region = grown
        enclosed_palette |= palette_region
    removal = broad_key_family & (near_transparent | enclosed_palette) & visible

    removal_u8 = removal.astype(np.uint8)
    feather = _dilate_binary_mask(removal_u8, 1) & ~removal
    feather &= broad_key_family & visible
    next_alpha = alpha.copy()
    next_alpha[removal] = 0
    next_alpha[feather] = np.minimum(next_alpha[feather], 96)

    key = np.asarray(key_color, dtype=np.int16)
    high_channels = np.flatnonzero(key >= int(key.max()) - 32)
    low_channels = np.flatnonzero(key <= int(key.min()) + 32)
    dominance = np.min(rgb[..., high_channels], axis=2) - np.max(rgb[..., low_channels], axis=2)
    next_transparent = (next_alpha <= alpha_threshold).astype(np.uint8)
    spill_contour_radius = 8
    contour = _dilate_binary_mask(next_transparent, spill_contour_radius)
    visible_contour = contour & (next_alpha > alpha_threshold)
    cleanup_scope = (next_alpha > alpha_threshold) if key_family_safe else visible_contour
    spill = cleanup_scope & (dominance >= 10)
    low_cap = np.max(rgb[..., low_channels], axis=2)
    output_rgb = rgba[..., :3].astype(np.int16)
    for channel in high_channels:
        output_rgb[..., channel][spill] = np.minimum(output_rgb[..., channel][spill], low_cap[spill])
    # Chroma subsampling can mix a single-high-channel key with a foreground
    # low channel, turning green-on-blue into cyan or green-on-red into yellow.
    # In that topology, capping against the partner would preserve the spill;
    # cap the key channel against the remaining low channel instead.
    partner_hue_spill = np.zeros(alpha.shape, dtype=bool)
    if len(high_channels) == 1 and len(low_channels) >= 2:
        dominant = int(high_channels[0])
        for partner_value in low_channels:
            partner = int(partner_value)
            other_lows = [int(channel) for channel in low_channels if int(channel) != partner]
            if not other_lows:
                continue
            partner_mask = (
                cleanup_scope
                & (
                    np.minimum(rgb[..., dominant], rgb[..., partner])
                    - np.max(rgb[..., other_lows], axis=2)
                    >= 28
                )
            )
            partner_cap = np.max(output_rgb[..., other_lows], axis=2)
            output_rgb[..., dominant][partner_mask] = np.minimum(
                output_rgb[..., dominant][partner_mask], partner_cap[partner_mask]
            )
            partner_hue_spill |= partner_mask
    spill |= partner_hue_spill
    global_safe_spill = spill & ~visible_contour if key_family_safe else np.zeros(alpha.shape, dtype=bool)
    output = rgba.copy()
    output[..., :3] = np.clip(output_rgb, 0, 255).astype(np.uint8)
    output[..., 3] = next_alpha
    output[next_alpha == 0, :3] = 0
    return Image.fromarray(output, "RGBA"), {
        **default_report,
        "skipped": False,
        "removed_pixels": int(np.count_nonzero(removal)),
        "global_strong_pixels_removed": int(np.count_nonzero(removal & global_strong_key)),
        "enclosed_palette_pixels_removed": int(np.count_nonzero(removal & enclosed_palette)),
        "feather_pixels_hardened": int(np.count_nonzero(feather)),
        "spill_pixels_neutralized": int(np.count_nonzero(spill)),
        "partner_hue_spill_pixels_neutralized": int(np.count_nonzero(partner_hue_spill)),
        "global_safe_spill_pixels_neutralized": int(np.count_nonzero(global_safe_spill)),
        "palette_attempted_removed_pixels": palette_attempted_removed,
        "current_key_attempted_removed_pixels": palette_attempted_removed,
        "visible_damage_ratio": round(int(np.count_nonzero(removal)) / max(1, visible_pixels), 6),
        "distance_threshold": 85,
        "near_transparent_radius": 4,
        "spill_contour_radius": spill_contour_radius,
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
