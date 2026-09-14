"""Explicit vertical band alignment for RGBA UI materials.

The caller owns the semantic decision about which source bands may stretch.
This helper only validates the complete source/target partition and applies
the requested copy or stretch operation.  It never crops, pads, or changes
the input image.
"""
from __future__ import annotations

from PIL import Image
import numpy as np

from .common import require


_BAND_KEYS = {"source", "target", "mode"}
_MODES = {"copy", "stretch"}


def _positive_int(value: object, code: str) -> None:
    # ``bool`` is an ``int`` subclass, but is not a meaningful pixel bound.
    require(type(value) is int and value > 0, code)


def _bounds(value: object) -> tuple[int, int]:
    require(isinstance(value, list) and len(value) == 2,
            "VERTICAL_BANDS_SCHEMA")
    top, bottom = value
    require(type(top) is int and type(bottom) is int and top >= 0 and bottom > top,
            "VERTICAL_BANDS_BOUNDS")
    return top, bottom


def _normalize_transparent_rgb(image: Image.Image) -> Image.Image:
    values = np.array(image, dtype=np.uint8, copy=True)
    values[values[:, :, 3] == 0, :3] = 0
    return Image.fromarray(values, "RGBA")


def vertical_bands(image: Image.Image, target_height: int,
                   bands: list[dict]) -> Image.Image:
    """Return a new RGBA image aligned using an explicit vertical partition.

    ``bands`` must be an ordered list of objects with exactly ``source``,
    ``target``, and ``mode`` fields.  Each range is half-open ``[top, bottom]``
    in source or target pixels.  ``copy`` requires equal band heights and
    copies RGBA bytes directly; ``stretch`` resizes only that declared band
    to its target height while retaining the input width.
    """
    require(isinstance(image, Image.Image), "VERTICAL_BANDS_IMAGE")
    _positive_int(target_height, "VERTICAL_BANDS_TARGET_HEIGHT")
    require(isinstance(bands, list) and bands, "VERTICAL_BANDS_SCHEMA")

    source_width, source_height = image.size
    _positive_int(source_width, "VERTICAL_BANDS_SOURCE_WIDTH")
    _positive_int(source_height, "VERTICAL_BANDS_SOURCE_HEIGHT")
    require(source_width * target_height <= 67_108_864 and
            source_width * source_height <= 67_108_864,
            "VERTICAL_BANDS_PIXEL_LIMIT")

    source_cursor = 0
    target_cursor = 0
    parsed: list[tuple[int, int, int, int, str]] = []
    for band in bands:
        require(isinstance(band, dict) and set(band) == _BAND_KEYS,
                "VERTICAL_BANDS_SCHEMA")
        source_top, source_bottom = _bounds(band["source"])
        target_top, target_bottom = _bounds(band["target"])
        mode = band["mode"]
        require(type(mode) is str and mode in _MODES,
                "VERTICAL_BANDS_MODE_INVALID")

        # Requiring the next band to start at the cursor rejects both gaps and
        # overlaps, while the final checks below reject under- and over-cover.
        require(source_top == source_cursor, "VERTICAL_BANDS_SOURCE_COVERAGE")
        require(target_top == target_cursor, "VERTICAL_BANDS_TARGET_COVERAGE")
        require(source_bottom <= source_height,
                "VERTICAL_BANDS_SOURCE_COVERAGE")
        require(target_bottom <= target_height,
                "VERTICAL_BANDS_TARGET_COVERAGE")

        source_band_height = source_bottom - source_top
        target_band_height = target_bottom - target_top
        if mode == "copy":
            require(source_band_height == target_band_height,
                    "VERTICAL_BANDS_COPY_HEIGHT_MISMATCH")
        parsed.append((source_top, source_bottom, target_top, target_bottom, mode))
        source_cursor = source_bottom
        target_cursor = target_bottom

    require(source_cursor == source_height, "VERTICAL_BANDS_SOURCE_COVERAGE")
    require(target_cursor == target_height, "VERTICAL_BANDS_TARGET_COVERAGE")

    source = image.convert("RGBA")
    result = Image.new("RGBA", (source_width, target_height), (0, 0, 0, 0))
    for source_top, source_bottom, target_top, target_bottom, mode in parsed:
        tile = source.crop((0, source_top, source_width, source_bottom))
        target_band_height = target_bottom - target_top
        if mode == "stretch":
            tile = tile.resize((source_width, target_band_height),
                               Image.Resampling.LANCZOS)
        # No mask is used: this copies the complete RGBA tile, including
        # continuous alpha and transparent pixels, without compositing it.
        result.paste(tile, (0, target_top))
    return _normalize_transparent_rgb(result)
