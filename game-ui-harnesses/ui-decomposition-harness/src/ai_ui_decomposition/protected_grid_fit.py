"""Bounded, measured protected-grid fitting for row-frame materials.

The grid is supplied by the producer after inspecting the returned material.
This module only applies that measured transform.  It does not identify marks,
dividers, or stretch-safe pixels and it does not make a visual acceptance
decision.
"""

from __future__ import annotations

import copy
import hashlib
import re

from PIL import Image

from .common import require
from .media import normalize


_FIELDS = {
    "version", "role", "supportSha256", "supportSize", "resize", "evidence"
}
_RESIZE_FIELDS = {
    "mode", "scale", "sourceX", "sourceY", "targetX", "targetY",
    "markCell", "dividerColumn"
}


def _int(value: object) -> bool:
    """True only for JSON integer values, never for bool."""
    return type(value) is int


def _grid(value: object, *, end: int | None = None) -> list[int]:
    require(isinstance(value, list) and 5 <= len(value) <= 12,
            "FRAME_FIT_GRID_FIELDS")
    require(all(_int(item) for item in value), "FRAME_FIT_GRID_INTEGER")
    require(value[0] == 0 and all(left < right for left, right in zip(value, value[1:])),
            "FRAME_FIT_GRID_ORDER")
    require(all(item >= 0 for item in value), "FRAME_FIT_GRID_BOUNDS")
    if end is not None:
        require(value[-1] == end, "FRAME_FIT_GRID_BOUNDS")
    else:
        # Static validation has no target size.  A positive endpoint still
        # catches an empty target grid; fit_frame checks the actual inner size.
        require(value[-1] > 0, "FRAME_FIT_GRID_BOUNDS")
    return list(value)


def validate_protected_grid(spec: object, *, support_size: list[int] | None = None,
                            inner_size: list[int] | None = None) -> dict:
    """Validate a 1.2 protected-grid spec and return a defensive copy.

    ``support_size`` and ``inner_size`` are optional so ``validate_frames`` can
    perform static checks while ``fit_frame`` can additionally bind the target
    geometry to the actual output canvas.
    """
    require(isinstance(spec, dict) and set(spec) == _FIELDS,
            "FRAME_FIT_FIELDS")
    require(spec.get("version") == "1.2" and spec.get("role") == "row-frame",
            "FRAME_FIT_VERSION_ROLE")
    evidence = spec.get("evidence")
    require(isinstance(evidence, str) and bool(evidence.strip()),
            "FRAME_FIT_EVIDENCE")
    support_hash = spec.get("supportSha256")
    require(isinstance(support_hash, str) and
            re.fullmatch(r"[0-9a-f]{64}", support_hash), "FRAME_FIT_HASH")
    declared_size = spec.get("supportSize")
    require(isinstance(declared_size, list) and len(declared_size) == 2 and
            all(_int(value) and value > 0 for value in declared_size),
            "FRAME_FIT_SIZE")
    if support_size is not None:
        require(isinstance(support_size, list) and len(support_size) == 2 and
                all(_int(value) and value > 0 for value in support_size) and
                declared_size == support_size, "FRAME_FIT_SUPPORT_CHANGED")

    resize = spec.get("resize")
    require(isinstance(resize, dict) and set(resize) == _RESIZE_FIELDS and
            resize.get("mode") == "protected_grid", "FRAME_FIT_RESIZE")

    scale = resize.get("scale")
    require(isinstance(scale, list) and len(scale) == 2 and
            all(_int(value) and value > 0 for value in scale) and
            scale[0] <= scale[1], "FRAME_FIT_SCALE")

    source_x = _grid(resize.get("sourceX"), end=declared_size[0])
    source_y = _grid(resize.get("sourceY"), end=declared_size[1])
    target_x = _grid(resize.get("targetX"))
    target_y = _grid(resize.get("targetY"))
    require(len(source_x) == len(target_x) and len(source_y) == len(target_y),
            "FRAME_FIT_GRID_DIMENSIONS")

    columns = len(source_x) - 1
    rows = len(source_y) - 1
    mark = resize.get("markCell")
    require(isinstance(mark, list) and len(mark) == 2 and
            all(_int(value) for value in mark), "FRAME_FIT_MARK_CELL")
    mark_column, mark_row = mark
    require(0 < mark_column < columns - 1 and 0 < mark_row < rows - 1,
            "FRAME_FIT_MARK_CELL")
    divider = resize.get("dividerColumn")
    require(_int(divider) and 0 < divider < columns - 1 and divider != mark_column,
            "FRAME_FIT_DIVIDER_COLUMN")

    if inner_size is not None:
        require(isinstance(inner_size, list) and len(inner_size) == 2 and
                all(_int(value) and value > 0 for value in inner_size),
                "FRAME_FIT_TARGET_SIZE")
        require(target_x[-1] <= inner_size[0] and target_y[-1] <= inner_size[1],
                "RESIZE_TARGET_TOO_SMALL")
        _grid(target_x, end=inner_size[0])
        _grid(target_y, end=inner_size[1])

    return copy.deepcopy(spec)


def _scaled_coordinate(value: int, numerator: int, denominator: int) -> int:
    # Keep the contract's Python round semantics while avoiding a float scale
    # field.  The source dimensions are already bounded by the image contract.
    return int(round(value * numerator / denominator))


def _scaled_grid(grid: list[int], numerator: int, denominator: int) -> list[int]:
    mapped = [_scaled_coordinate(value, numerator, denominator) for value in grid]
    require(all(left < right for left, right in zip(mapped, mapped[1:])),
            "FRAME_FIT_GRID_COLLAPSE")
    return mapped


def fit_protected_grid(source: Image.Image, target: list[int], padding: int,
                       spec: dict) -> tuple[Image.Image, dict]:
    """Apply one measured 1.2 row-frame transform to an authenticated support."""
    checked = validate_protected_grid(spec)
    require(isinstance(target, list) and len(target) == 2 and
            all(_int(value) and value > 0 for value in target),
            "FRAME_FIT_TARGET_SIZE")
    require(_int(padding) and padding >= 0, "FRAME_FIT_TARGET_PADDING")
    inner = [target[0] - 2 * padding, target[1] - 2 * padding]
    require(all(value > 0 for value in inner), "RESIZE_TARGET_TOO_SMALL")

    source = source.convert("RGBA")
    require(list(source.size) == checked["supportSize"] and
            hashlib.sha256(source.tobytes()).hexdigest() ==
            checked["supportSha256"], "FRAME_FIT_SUPPORT_CHANGED")
    resize = checked["resize"]
    numerator, denominator = resize["scale"]
    source_x = resize["sourceX"]
    source_y = resize["sourceY"]
    target_x = resize["targetX"]
    target_y = resize["targetY"]
    validate_protected_grid(checked, support_size=list(source.size),
                            inner_size=inner)

    scaled_size = [_scaled_coordinate(source.width, numerator, denominator),
                   _scaled_coordinate(source.height, numerator, denominator)]
    require(all(value > 0 for value in scaled_size), "FRAME_FIT_GRID_COLLAPSE")
    scaled = source.resize(tuple(scaled_size), Image.Resampling.LANCZOS)
    scaled_x = _scaled_grid(source_x, numerator, denominator)
    scaled_y = _scaled_grid(source_y, numerator, denominator)
    require(scaled_x[-1] == scaled.width and scaled_y[-1] == scaled.height,
            "FRAME_FIT_GRID_COLLAPSE")

    columns = len(source_x) - 1
    rows = len(source_y) - 1
    mark_column, mark_row = resize["markCell"]
    divider = resize["dividerColumn"]
    protected = {
        (0, 0), (columns - 1, 0), (0, rows - 1),
        (columns - 1, rows - 1), (mark_column, mark_row)
    }

    # The measured target grid is a strict tiling of the target inner canvas.
    # Every source tile is assigned once, with no implicit gaps or overlays.
    for column in range(columns):
        source_width = scaled_x[column + 1] - scaled_x[column]
        target_width = target_x[column + 1] - target_x[column]
        if column == divider:
            require(target_width == source_width,
                    "FRAME_FIT_DIVIDER_DISTORTION")
        for row in range(rows):
            source_height = scaled_y[row + 1] - scaled_y[row]
            target_height = target_y[row + 1] - target_y[row]
            if (column, row) in protected:
                require((target_width, target_height) ==
                        (source_width, source_height),
                        "FRAME_FIT_PROTECTED_CELL_DISTORTION")

    fitted = Image.new("RGBA", tuple(inner), (0, 0, 0, 0))
    for row in range(rows):
        for column in range(columns):
            source_box = (scaled_x[column], scaled_y[row],
                          scaled_x[column + 1], scaled_y[row + 1])
            target_box = (target_x[column], target_y[row],
                          target_x[column + 1], target_y[row + 1])
            tile = scaled.crop(source_box)
            target_size = (target_box[2] - target_box[0],
                           target_box[3] - target_box[1])
            if tile.size != target_size and (column, row) not in protected:
                # Width has already been checked for the divider, so a divider
                # tile can only be resampled vertically here.
                tile = tile.resize(target_size, Image.Resampling.LANCZOS)
            require(tile.size == target_size, "FRAME_FIT_PROTECTED_CELL_DISTORTION")
            fitted.paste(tile, (target_box[0], target_box[1]))

    result = Image.new("RGBA", tuple(target), (0, 0, 0, 0))
    result.paste(fitted, (padding, padding))
    result = normalize(result)
    alpha_box = result.getchannel("A").getbbox()
    require(alpha_box is not None, "EMPTY_MATERIAL")
    evidence = {
        "sourceSize": list(source.size),
        "scaledSize": list(scaled.size),
        "sourceGrid": {"x": list(source_x), "y": list(source_y)},
        "scaledSourceGrid": {"x": list(scaled_x), "y": list(scaled_y)},
        "targetInnerSize": list(inner),
        "targetGrid": {"x": list(target_x), "y": list(target_y)},
        "markCell": list(resize["markCell"]),
        "dividerColumn": resize["dividerColumn"],
    }
    record = {
        "transform": "uniform rational downscale; measured protected-grid tiles; "
                     "protected corners and mark copied; divider width preserved; "
                     "explicit grid-strip LANCZOS; source-hash-bound",
        "measuredFrame": copy.deepcopy(checked),
        "target_padding": padding,
        "uniform_scale": list(resize["scale"]),
        "grid_evidence": evidence,
        "alpha_bbox": list(alpha_box),
        "human_visual_acceptance": False,
    }
    return result, record
