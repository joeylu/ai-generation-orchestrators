#!/usr/bin/env python3
"""Pack a single video-derived RGBA sequence into the web UI's fixed grids."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Sequence

from PIL import Image


GRID_BY_PROFILE = {"4x4": (4, 4), "8x4": (8, 4), "8x8": (8, 8)}
GRID_BY_FRAME_COUNT = {columns * rows: (columns, rows) for columns, rows in GRID_BY_PROFILE.values()}


def grid_for_frame_count(frame_count: int) -> tuple[int, int]:
    try:
        return GRID_BY_FRAME_COUNT[frame_count]
    except KeyError as exc:
        raise ValueError("frame_count must be one of 16, 32, 64") from exc


def grid_for_profile(profile: str) -> tuple[int, int]:
    try:
        return GRID_BY_PROFILE[profile]
    except KeyError as exc:
        raise ValueError("atlas_profile_invalid") from exc


def rgba_pixel_bytes(image: Image.Image) -> bytes:
    rgba = image.convert("RGBA")
    return f"{rgba.width}x{rgba.height}:RGBA\n".encode("ascii") + rgba.tobytes()


def pack_video_spritesheet(
    images: Sequence[Image.Image], *, profile: str | None = None, frame_count: int | None = None
) -> tuple[Image.Image, dict]:
    if profile is not None:
        columns, rows = grid_for_profile(profile)
        capacity = columns * rows
        if len(images) > capacity:
            raise ValueError("image count exceeds atlas capacity")
    else:
        expected_count = frame_count if frame_count is not None else len(images)
        columns, rows = grid_for_frame_count(expected_count)
        capacity = expected_count
        profile = f"{columns}x{rows}"
        if len(images) != expected_count:
            raise ValueError("image count does not match requested frame_count")
    if not images:
        raise ValueError("no frames to pack")
    frames = [image.convert("RGBA") for image in images]
    frame_size = frames[0].size
    if any(frame.size != frame_size for frame in frames):
        raise ValueError("all frames must have the same dimensions")
    width, height = frame_size
    sheet = Image.new("RGBA", (columns * width, rows * height), (0, 0, 0, 0))
    records = []
    for index, frame in enumerate(frames, start=1):
        column = (index - 1) % columns
        row = (index - 1) // columns
        x, y = column * width, row * height
        sheet.alpha_composite(frame, (x, y))
        records.append({"index": index, "rect": {"x": x, "y": y, "w": width, "h": height}, "source_rgba_bytes": len(rgba_pixel_bytes(frame))})
    # A pack failure is structural.  Re-decode-equivalent comparison is done
    # against the in-memory sheet here; CLI writes once after this succeeds.
    for record, frame in zip(records, frames):
        rect = record["rect"]
        actual = sheet.crop((rect["x"], rect["y"], rect["x"] + width, rect["y"] + height))
        if actual.tobytes() != frame.tobytes():
            raise ValueError("spritesheet cell differs from its source RGBA frame")
    atlas = {
        "schema_version": "video_sequence_atlas_v2",
        "format": "RGBA8888",
        "image_size": {"w": sheet.width, "h": sheet.height},
        "profile": profile,
        "layout": {"columns": columns, "rows": rows, "frame_width": width, "frame_height": height, "capacity": capacity, "frame_count": len(frames), "unused_cells": capacity - len(frames), "order": "row_major", "trimmed": False, "rotated": False},
        "frames": records,
    }
    return sheet, atlas


def main() -> int:
    parser = argparse.ArgumentParser(description="Pack RGBA frames into a fixed 4x4, 8x4, or 8x8 spritesheet grid.")
    parser.add_argument("--input-dir", required=True, type=Path)
    parser.add_argument("--spritesheet-out", required=True, type=Path)
    parser.add_argument("--atlas-out", required=True, type=Path)
    parser.add_argument("--profile", required=True, choices=tuple(GRID_BY_PROFILE))
    args = parser.parse_args()
    paths = sorted(args.input_dir.glob("*.png"))
    images = []
    for path in paths:
        with Image.open(path) as source:
            images.append(source.convert("RGBA"))
    sheet, atlas = pack_video_spritesheet(images, profile=args.profile)
    args.spritesheet_out.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(args.spritesheet_out)
    atlas["image"] = args.spritesheet_out.name
    args.atlas_out.parent.mkdir(parents=True, exist_ok=True)
    args.atlas_out.write_text(json.dumps(atlas, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(atlas, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
