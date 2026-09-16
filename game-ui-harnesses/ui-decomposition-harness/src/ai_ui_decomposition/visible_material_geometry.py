"""Opt-in source-bound alpha bounds and explicit reservation checks.

This producer-side check validates one already materialized image against
reviewed geometry declarations. It does not identify ornaments or text.
"""
from __future__ import annotations

import math
import re
from pathlib import Path
from typing import Any

from .common import ContractError, load_verified_image, require


KIND = "ui_visible_material_geometry_v1"
CHECK_KIND = "ui_visible_material_geometry_check_v1"


def _number(value: Any, code: str, *, minimum: float | None = None) -> float:
    require(type(value) in (int, float) and math.isfinite(value), code)
    if minimum is not None:
        require(value >= minimum, code)
    return float(value)


def _world_rect(value: Any, code: str, *, positive: bool = False) -> dict[str, float]:
    require(isinstance(value, dict) and set(value) == {"x", "y", "width", "height"}, code)
    rect = {key: _number(value[key], code) for key in ("x", "y", "width", "height")}
    require(rect["width"] > 0 and rect["height"] > 0 if positive else
            rect["width"] >= 0 and rect["height"] >= 0, code)
    return rect


def _rect_pixels(value: Any, code: str) -> tuple[int, int, int, int]:
    require(isinstance(value, list) and len(value) == 4 and
            all(type(item) is int for item in value), code)
    x, y, width, height = value
    require(x >= 0 and y >= 0 and width > 0 and height > 0, code)
    return x, y, width, height


def _identifier(value: Any, code: str) -> None:
    require(isinstance(value, str) and re.fullmatch(r"[a-z][a-z0-9_-]{0,63}", value), code)


def _validate_plan(plan: Any) -> None:
    fields = {"kind", "version", "materialId", "sourceSha256", "alphaThreshold",
              "minimumOccupancy", "expectedAlphaBounds", "imageWorldRect",
              "reservedRects", "textWorldRects"}
    require(isinstance(plan, dict) and set(plan) == fields, "VISIBLE_GEOMETRY_SCHEMA")
    require(plan["kind"] == KIND and plan["version"] == "1.0", "VISIBLE_GEOMETRY_SCHEMA")
    _identifier(plan["materialId"], "VISIBLE_GEOMETRY_MATERIAL_ID")
    require(isinstance(plan["sourceSha256"], str) and
            re.fullmatch(r"[0-9a-f]{64}", plan["sourceSha256"]),
            "VISIBLE_GEOMETRY_SOURCE_DIGEST")
    require(type(plan["alphaThreshold"]) is int and 1 <= plan["alphaThreshold"] <= 255,
            "VISIBLE_GEOMETRY_ALPHA_THRESHOLD")

    minimum = plan["minimumOccupancy"]
    expected = plan["expectedAlphaBounds"]
    require(minimum is not None or expected is not None, "VISIBLE_GEOMETRY_ALPHA_ASSERTION_REQUIRED")
    if minimum is not None:
        require(isinstance(minimum, dict) and set(minimum) <= {"width", "height"} and minimum,
                "VISIBLE_GEOMETRY_MINIMUM_OCCUPANCY")
        for axis, value in minimum.items():
            _number(value, "VISIBLE_GEOMETRY_MINIMUM_OCCUPANCY", minimum=0)
            require(value <= 1, "VISIBLE_GEOMETRY_MINIMUM_OCCUPANCY")
    if expected is not None:
        require(isinstance(expected, dict) and set(expected) == {"rect", "tolerance"},
                "VISIBLE_GEOMETRY_EXPECTED_BOUNDS")
        _rect_pixels(expected["rect"], "VISIBLE_GEOMETRY_EXPECTED_BOUNDS")
        tolerance = expected["tolerance"]
        require(isinstance(tolerance, list) and len(tolerance) == 4 and
                all(type(item) is int and item >= 0 for item in tolerance),
                "VISIBLE_GEOMETRY_EXPECTED_TOLERANCE")

    reserved = plan["reservedRects"]
    texts = plan["textWorldRects"]
    require(isinstance(reserved, list) and isinstance(texts, list),
            "VISIBLE_GEOMETRY_RELATION_SCHEMA")
    if reserved:
        require(plan["imageWorldRect"] is not None,
                "VISIBLE_GEOMETRY_IMAGE_WORLD_RECT_REQUIRED")
        _world_rect(plan["imageWorldRect"], "VISIBLE_GEOMETRY_IMAGE_WORLD_RECT",
                    positive=True)
        require(texts, "VISIBLE_GEOMETRY_TEXT_WORLD_RECTS_REQUIRED")
    elif plan["imageWorldRect"] is not None:
        _world_rect(plan["imageWorldRect"], "VISIBLE_GEOMETRY_IMAGE_WORLD_RECT",
                    positive=True)

    text_ids: set[str] = set()
    for text in texts:
        require(isinstance(text, dict) and set(text) == {"id", "rect"},
                "VISIBLE_GEOMETRY_TEXT_WORLD_RECT")
        _identifier(text["id"], "VISIBLE_GEOMETRY_TEXT_ID")
        require(text["id"] not in text_ids, "VISIBLE_GEOMETRY_DUPLICATE_TEXT_ID")
        text_ids.add(text["id"])
        _world_rect(text["rect"], "VISIBLE_GEOMETRY_TEXT_WORLD_RECT", positive=True)

    reservation_ids: set[str] = set()
    for row in reserved:
        require(isinstance(row, dict) and set(row) == {"id", "rect"},
                "VISIBLE_GEOMETRY_RESERVED_RECT")
        _identifier(row["id"], "VISIBLE_GEOMETRY_RESERVED_ID")
        require(row["id"] not in reservation_ids, "VISIBLE_GEOMETRY_DUPLICATE_RESERVED_ID")
        reservation_ids.add(row["id"])
        _rect_pixels(row["rect"], "VISIBLE_GEOMETRY_RESERVED_RECT")


def _world_bounds(rect: tuple[int, int, int, int], image_size: tuple[int, int],
                  image_world: dict[str, float]) -> dict[str, float]:
    x, y, width, height = rect
    image_width, image_height = image_size
    return {
        "x": image_world["x"] + x * image_world["width"] / image_width,
        "y": image_world["y"] + y * image_world["height"] / image_height,
        "width": width * image_world["width"] / image_width,
        "height": height * image_world["height"] / image_height,
    }


def _intersects(left: dict[str, float], right: dict[str, float]) -> bool:
    return (max(left["x"], right["x"]) < min(left["x"] + left["width"],
                                               right["x"] + right["width"]) and
            max(left["y"], right["y"]) < min(left["y"] + left["height"],
                                               right["y"] + right["height"]))


def check_visible_material_geometry(image_path: Path, plan: dict) -> dict:
    """Check one exact source PNG against explicit alpha and layout constraints.

    Contract errors (including source digest mismatch) raise ``ContractError``.
    Measured quality failures return a report with ``status: failed`` and
    stable issue codes so producer adapters can stop before packaging.
    """
    _validate_plan(plan)
    image, metadata = load_verified_image(Path(image_path))
    require(metadata["sha256"] == plan["sourceSha256"], "VISIBLE_GEOMETRY_SOURCE_CHANGED")
    width, height = image.size
    alpha = image.getchannel("A")
    threshold = plan["alphaThreshold"]
    alpha_box = alpha.point(lambda value: 255 if value >= threshold else 0).getbbox()
    bounds = None if alpha_box is None else [alpha_box[0], alpha_box[1],
                                              alpha_box[2] - alpha_box[0],
                                              alpha_box[3] - alpha_box[1]]
    checks: list[dict] = []
    issues: list[dict] = []

    def record(ok: bool, code: str, check_id: str, **detail: Any) -> None:
        row = {"id": check_id, "code": code, "passed": bool(ok), **detail}
        checks.append(row)
        if not ok:
            issues.append(row)

    record(bounds is not None, "VISIBLE_GEOMETRY_ALPHA_EMPTY", "alpha-support",
           alphaBounds=bounds, alphaThreshold=threshold)
    if bounds is not None:
        x, y, box_width, box_height = bounds
        minimum = plan["minimumOccupancy"]
        if minimum is not None:
            actual = {"width": box_width / width, "height": box_height / height}
            record(all(actual[axis] >= minimum[axis] for axis in minimum),
                   "VISIBLE_GEOMETRY_OCCUPANCY_TOO_SMALL", "minimum-occupancy",
                   actual={axis: actual[axis] for axis in minimum}, minimum=minimum,
                   alphaBounds=bounds, imageSize=[width, height])
        expected = plan["expectedAlphaBounds"]
        if expected is not None:
            expected_rect, tolerance = expected["rect"], expected["tolerance"]
            deltas = [abs(actual_value - expected_value)
                      for actual_value, expected_value in zip(bounds, expected_rect)]
            record(all(delta <= allowed for delta, allowed in zip(deltas, tolerance)),
                   "VISIBLE_GEOMETRY_ALPHA_BOUNDS_OUT_OF_TOLERANCE", "expected-alpha-bounds",
                   actual=bounds, expected=expected_rect, delta=deltas, tolerance=tolerance)

    if plan["reservedRects"]:
        image_world = _world_rect(plan["imageWorldRect"],
                                  "VISIBLE_GEOMETRY_IMAGE_WORLD_RECT", positive=True)
        texts = {row["id"]: _world_rect(row["rect"],
                                       "VISIBLE_GEOMETRY_TEXT_WORLD_RECT", positive=True)
                 for row in plan["textWorldRects"]}
        for reserved in plan["reservedRects"]:
            pixel_rect = _rect_pixels(reserved["rect"], "VISIBLE_GEOMETRY_RESERVED_RECT")
            x, y, reserved_width, reserved_height = pixel_rect
            require(x + reserved_width <= width and y + reserved_height <= height,
                    "VISIBLE_GEOMETRY_RESERVED_RECT_OUT_OF_BOUNDS")
            world = _world_bounds(pixel_rect, image.size, image_world)
            for text_id, text_world in texts.items():
                intersects = _intersects(world, text_world)
                record(not intersects, "VISIBLE_GEOMETRY_TEXT_OVERLAPS_RESERVED_RECT",
                       reserved["id"] + ":" + text_id,
                       reservedBounds=world, reservedSourceRect=pixel_rect,
                       textId=text_id, textBounds=text_world)

    return {"kind": CHECK_KIND, "status": "failed" if issues else "passed",
            "materialId": plan["materialId"], "sourceSha256": metadata["sha256"],
            "imageSize": [width, height], "alphaThreshold": threshold,
            "alphaBounds": bounds, "checks": checks, "issues": issues,
            "human_visual_acceptance": False,
            "coverage": "explicit_source_bound_alpha_and_reserved_geometry"}


__all__ = ["check_visible_material_geometry"]
