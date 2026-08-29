#!/usr/bin/env python3
"""Best-effort sequence fit and anchor alignment for RGBA animation frames."""

from __future__ import annotations

import argparse
import json
import statistics
from pathlib import Path
from typing import Iterable

from PIL import Image


def alpha_bbox(image: Image.Image, alpha_threshold: int = 8) -> tuple[int, int, int, int] | None:
    alpha = image.convert("RGBA").getchannel("A")
    return alpha.point(lambda value: 255 if value > alpha_threshold else 0).getbbox()


def alpha_core_centroid_x(image: Image.Image, alpha_threshold: int = 8) -> float:
    alpha = image.convert("RGBA").getchannel("A")
    pixels = alpha.load()
    masses = [sum(pixels[x, y] for y in range(alpha.height) if pixels[x, y] > alpha_threshold) for x in range(alpha.width)]
    total = sum(masses)
    if total <= 0:
        raise ValueError("frame has no visible subject")
    trim = total * 0.1
    running = 0.0
    left = 0
    for index, mass in enumerate(masses):
        running += mass
        if running >= trim:
            left = index
            break
    running = 0.0
    right = len(masses) - 1
    for index in range(len(masses) - 1, -1, -1):
        running += masses[index]
        if running >= trim:
            right = index
            break
    core = sum(masses[left : right + 1])
    # Use pixel-cell centres instead of integer pixel indices.  This keeps a
    # six-pixel-wide subject centred at x=5 rather than x=4.5 and avoids a
    # systematic one-pixel translation bias after rounding.
    return sum((index + 0.5) * masses[index] for index in range(left, right + 1)) / max(core, 1)


def frame_anchor(image: Image.Image, *, anchor_kind: str = "contact_baseline", alpha_threshold: int = 8) -> tuple[float, float]:
    bbox = alpha_bbox(image, alpha_threshold)
    if bbox is None:
        raise ValueError("frame has no visible subject")
    left, top, right, bottom = bbox
    if anchor_kind == "contact_baseline":
        return alpha_core_centroid_x(image, alpha_threshold), float(bottom)
    if anchor_kind == "subject_center":
        return (left + right) / 2.0, (top + bottom) / 2.0
    raise ValueError("anchor_kind must be contact_baseline or subject_center")


def translate_rgba(image: Image.Image, dx: int, dy: int) -> Image.Image:
    canvas = Image.new("RGBA", image.size, (0, 0, 0, 0))
    canvas.alpha_composite(image.convert("RGBA"), (dx, dy))
    return canvas


def _scale_canvas_uniform(image: Image.Image, scale: float) -> Image.Image:
    """Scale one canvas from its origin, retaining the original canvas size.

    This is deliberately a *sequence-global* operation: callers compute one
    scale from the whole selected action before aligning individual frames.
    It is never a per-frame size correction.
    """

    source = image.convert("RGBA")
    if scale >= 1.0:
        return source.copy()
    width = max(1, round(source.width * scale))
    height = max(1, round(source.height * scale))
    resized = source.resize((width, height), Image.Resampling.LANCZOS)
    canvas = Image.new("RGBA", source.size, (0, 0, 0, 0))
    canvas.alpha_composite(resized, (0, 0))
    # Pillow resampling can leave arbitrary RGB in fully transparent pixels.
    # Delivery alpha always owns those pixels, so make the invariant explicit.
    canvas.putdata([
        (0, 0, 0, 0) if alpha == 0 else (red, green, blue, alpha)
        for red, green, blue, alpha in canvas.get_flattened_data()
    ])
    return canvas


def _maximum_canvas_fit_scale(
    images: Iterable[Image.Image],
    *,
    anchor_kind: str,
    target_anchor: tuple[float, float],
    alpha_threshold: int,
) -> float:
    """Return one common scale that can fit all anchored silhouettes.

    The requested pre-generation margin remains an instruction to the model.
    After raw generation, this uses the physical canvas edge as the hard
    delivery bound: delivery should continue with a warning rather than lose
    every artifact because a generated action exceeded its planned envelope.
    """

    frames = [image.convert("RGBA") for image in images]
    if not frames:
        raise ValueError("no frames to fit")
    target_x, target_y = target_anchor
    factors = [1.0]
    for image in frames:
        bbox = alpha_bbox(image, alpha_threshold)
        if bbox is None:
            raise ValueError("frame has no visible subject")
        anchor_x, anchor_y = frame_anchor(image, anchor_kind=anchor_kind, alpha_threshold=alpha_threshold)
        extents = (
            (anchor_x - bbox[0], target_x),
            (bbox[2] - anchor_x, image.width - target_x),
            (anchor_y - bbox[1], target_y),
            (bbox[3] - anchor_y, image.height - target_y),
        )
        for extent, available in extents:
            if extent > 0:
                factors.append(max(0.0, available) / extent)
    # A pathological requested anchor at the exact edge cannot preserve a
    # non-empty silhouette.  Keep a one-pixel lower bound so delivery still
    # reaches a terminal artifact instead of raising a visual-only failure.
    minimum_scale = 1.0 / max(max(frame.size) for frame in frames)
    return max(minimum_scale, min(1.0, min(factors)))


def fit_and_align_rgba_frames(
    images: Iterable[Image.Image],
    *,
    anchor_kind: str = "contact_baseline",
    target_anchor: tuple[float, float],
    alpha_threshold: int = 8,
) -> tuple[list[Image.Image], dict]:
    """Globally contain a sequence when needed, then apply anchor translation.

    The same scale is applied to all frames.  A small bounded safety loop
    covers integer rounding in the later translate step; any remaining clip is
    reported as a warning and never aborts deterministic delivery.
    """

    source = [image.convert("RGBA") for image in images]
    if not source:
        raise ValueError("no frames to align")
    scale = _maximum_canvas_fit_scale(
        source,
        anchor_kind=anchor_kind,
        target_anchor=target_anchor,
        alpha_threshold=alpha_threshold,
    )
    minimum_scale = 1.0 / max(max(image.size) for image in source)
    fitted: list[Image.Image] = []
    aligned: list[Image.Image] = []
    report: dict = {}
    for _attempt in range(4):
        fitted = [_scale_canvas_uniform(image, scale) for image in source]
        aligned, report = align_rgba_frames(
            fitted,
            anchor_kind=anchor_kind,
            target_anchor=target_anchor,
            alpha_threshold=alpha_threshold,
        )
        if not any(record["clip_warning"] for record in report["records"]):
            break
        if scale <= minimum_scale:
            break
        scale = max(minimum_scale, scale * 0.99)
    report["sequence_scale"] = round(scale, 8)
    if scale < 0.999999:
        report["warning_codes"] = sorted(set(report["warning_codes"]) | {"global_sequence_contain_applied"})
    return aligned, report


def align_rgba_frames(images: Iterable[Image.Image], *, anchor_kind: str = "contact_baseline", target_anchor: tuple[float, float] | None = None, alpha_threshold: int = 8) -> tuple[list[Image.Image], dict]:
    source = [image.convert("RGBA") for image in images]
    if not source:
        raise ValueError("no frames to align")
    anchors = [frame_anchor(image, anchor_kind=anchor_kind, alpha_threshold=alpha_threshold) for image in source]
    target = target_anchor or (statistics.median(item[0] for item in anchors), statistics.median(item[1] for item in anchors))
    output = []
    records = []
    for index, (image, source_anchor) in enumerate(zip(source, anchors), start=1):
        dx, dy = round(target[0] - source_anchor[0]), round(target[1] - source_anchor[1])
        bbox = alpha_bbox(image, alpha_threshold)
        assert bbox is not None
        shifted = (bbox[0] + dx, bbox[1] + dy, bbox[2] + dx, bbox[3] + dy)
        clipped = shifted[0] < 0 or shifted[1] < 0 or shifted[2] > image.width or shifted[3] > image.height
        output.append(translate_rgba(image, dx, dy))
        records.append({"index": index, "source_anchor": [round(source_anchor[0], 3), round(source_anchor[1], 3)], "target_anchor": [round(target[0], 3), round(target[1], 3)], "translate_px": [dx, dy], "clip_warning": clipped})
    return output, {"schema_version": "video_rgba_alignment_report_v1", "anchor_kind": anchor_kind, "target_anchor": [round(target[0], 3), round(target[1], 3)], "records": records, "warning_codes": ["translated_subject_may_clip"] if any(record["clip_warning"] for record in records) else []}


def main() -> int:
    parser = argparse.ArgumentParser(description="Translate-only alignment for RGBA PNGs.")
    parser.add_argument("--input-dir", required=True, type=Path)
    parser.add_argument("--out-dir", required=True, type=Path)
    parser.add_argument("--report-out", required=True, type=Path)
    parser.add_argument("--anchor-kind", default="contact_baseline")
    parser.add_argument("--target-anchor", help="pixel X,Y; default is median")
    args = parser.parse_args()
    paths = sorted(args.input_dir.glob("*.png"))
    images = []
    for path in paths:
        with Image.open(path) as source:
            images.append(source.convert("RGBA"))
    target = tuple(float(value) for value in args.target_anchor.split(",")) if args.target_anchor else None
    if target is not None and len(target) != 2:
        raise SystemExit("--target-anchor must be X,Y")
    aligned, report = align_rgba_frames(images, anchor_kind=args.anchor_kind, target_anchor=target)
    args.out_dir.mkdir(parents=True, exist_ok=True)
    for index, image in enumerate(aligned, start=1):
        image.save(args.out_dir / f"rgba_{index:03d}.png")
    args.report_out.parent.mkdir(parents=True, exist_ok=True)
    args.report_out.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
