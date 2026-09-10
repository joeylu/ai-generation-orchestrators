"""Offline intake for native-transparent UI appearance subpart boards."""
from __future__ import annotations

import shutil
import uuid
import zipfile
from pathlib import Path

import numpy as np
from PIL import Image

from .asset_board import _component_rows
from .common import digest, identifier, load_verified_image, require, sha256, write_json


ALPHA_THRESHOLD = 16
INTERACTIVE_COLUMNS = 4
INTERACTIVE_ROWS = 6
STRUCTURAL_COLUMNS = 4
STRUCTURAL_ROWS = 3

INTERACTIVE_SLOTS = (
    ("switch_track", "Switch", "track", None),
    ("switch_thumb", "Switch", "thumb", None),
    ("checkbox_box", "CheckBox", "box", None),
    ("checkbox_mark", "CheckBox", "mark", None),
    ("radio_option_a", "RadioGroup", "option", "option-a"),
    ("radio_indicator_a", "RadioGroup", "indicator", "option-a"),
    ("radio_option_b", "RadioGroup", "option", "option-b"),
    ("radio_indicator_b", "RadioGroup", "indicator", "option-b"),
    ("radio_option_c", "RadioGroup", "option", "option-c"),
    ("radio_indicator_c", "RadioGroup", "indicator", "option-c"),
    ("input_background", "Input", "background", None),
    ("select_background", "Select", "background", None),
    ("select_indicator", "Select", "indicator", None),
    ("select_popup", "Select", "popup", None),
    ("progress_track", "ProgressBar", "track", None),
    ("progress_fill", "ProgressBar", "fill", "full-range-template"),
    ("slider_track", "Slider", "track", None),
    ("slider_fill", "Slider", "fill", "full-range-template"),
    ("slider_thumb", "Slider", "thumb", None),
    ("scroll_viewport", "ScrollView", "viewport", None),
    ("scrollbar_track", "ScrollView", "scrollbar-track", None),
    ("scrollbar_thumb", "ScrollView", "scrollbar-thumb", None),
    ("list_background", "List", "background", None),
    ("list_row", "List", "row", "unselected-sample"),
)

STRUCTURAL_SLOTS = (
    ("button_background", "Button", "background", None),
    ("container_background", "Container", "background", None),
    ("panel_background", "Panel", "background", None),
    ("panel_header", "Panel", "header", None),
    ("panel_body", "Panel", "body", None),
    ("dialog_background", "Dialog", "background", None),
    ("dialog_header", "Dialog", "header", None),
    ("dialog_body", "Dialog", "body", None),
    ("list_selected_row", "List", "selected-row", "selected-sample"),
    ("tabs_tab", "Tabs", "tab", "inactive-sample"),
    ("tabs_active_tab", "Tabs", "active-tab", "active-sample"),
)


def _normalized_size(bounds: tuple[int, int, int, int], canvas: tuple[int, int],
                     columns: int, rows: int) -> tuple[float, float]:
    return ((bounds[2] - bounds[0]) / (canvas[0] / columns),
            (bounds[3] - bounds[1]) / (canvas[1] / rows))


def _require_matching_template_geometry(
        left: tuple[int, int, int, int], left_canvas: tuple[int, int], left_grid: tuple[int, int],
        right: tuple[int, int, int, int], right_canvas: tuple[int, int], right_grid: tuple[int, int],
        code: str) -> None:
    left_size = _normalized_size(left, left_canvas, *left_grid)
    right_size = _normalized_size(right, right_canvas, *right_grid)
    require(all(abs(a - b) / max(a, b) <= 0.15 for a, b in zip(left_size, right_size)), code)


def _equalize_pair_canvases(assets: list[dict], output: Path, first_id: str, second_id: str) -> None:
    rows = {row["id"]: row for row in assets}
    first, second = rows[first_id], rows[second_id]
    paths = [output / first["file"], output / second["file"]]
    images = [Image.open(path).convert("RGBA") for path in paths]
    target = (max(image.width for image in images), max(image.height for image in images))
    for row, path, image in zip((first, second), paths, images):
        left = (target[0] - image.width) // 2
        top = (target[1] - image.height) // 2
        canvas = Image.new("RGBA", target, (0, 0, 0, 0))
        canvas.alpha_composite(image, (left, top))
        canvas.save(path, "PNG", optimize=True)
        row["width"], row["height"] = target
        row["canvas_padding"] = [left, top, target[0] - image.width - left,
                                 target[1] - image.height - top]
        row["sha256"] = sha256(path)


def _validate_board(path: Path, columns: int, rows: int, blank_slots: set[int]) -> tuple[Image.Image, dict, list[tuple[int, int, int, int]], dict]:
    picture, evidence = load_verified_image(path.resolve())
    require(evidence["alpha_extrema"][0] == 0 and evidence["alpha_extrema"][1] >= 250,
            "SUPPLEMENTAL_BOARD_TRANSPARENCY_REQUIRED")
    data = np.array(picture, copy=True)
    alpha = data[:, :, 3]
    require(not np.any(data[:, :, :3][alpha == 0]), "SUPPLEMENTAL_BOARD_TRANSPARENT_RGB")
    height, width = alpha.shape
    require(width % columns == 0 and height % rows == 0,
            "SUPPLEMENTAL_BOARD_GRID_DIMENSIONS")
    require(width // columns >= 64 and height // rows >= 64,
            "SUPPLEMENTAL_BOARD_CELL_TOO_SMALL")
    components, minimum_area, ignored_area = _component_rows(alpha)
    slots: dict[int, list[dict]] = {index: [] for index in range(columns * rows)}
    for component in components:
        x, y = component["center"]
        column = min(columns - 1, int(x * columns / width))
        row = min(rows - 1, int(y * rows / height))
        slots[row * columns + column].append(component)
    bounds: list[tuple[int, int, int, int]] = []
    for index in range(columns * rows):
        if index in blank_slots:
            require(not slots[index], "SUPPLEMENTAL_BOARD_RESERVED_SLOT_NOT_EMPTY")
            continue
        require(slots[index], "SUPPLEMENTAL_BOARD_SLOT_EMPTY")
        bounds.append((min(row["bbox"][0] for row in slots[index]),
                       min(row["bbox"][1] for row in slots[index]),
                       max(row["bbox"][2] for row in slots[index]),
                       max(row["bbox"][3] for row in slots[index])))
    extraction = {"minimum_component_area": minimum_area,
                  "ignored_low_alpha_area": ignored_area,
                  "significant_connected_regions": len(components),
                  "connected_regions_per_slot": [len(slots[index]) for index in range(columns * rows)]}
    return picture, evidence, bounds, extraction


def _asset_row(source: Image.Image, bounds: tuple[int, int, int, int], slot: tuple[str, str, str, str | None],
               index: int, output: Path, padding: int, scale: float = 1.0) -> dict:
    left, top, right, bottom = bounds
    width, height = source.size
    crop_bounds = (max(0, left - padding), max(0, top - padding),
                   min(width, right + padding), min(height, bottom + padding))
    crop = np.array(source.crop(crop_bounds), copy=True)
    alpha = crop[:, :, 3]
    crop[alpha == 0, :3] = 0
    promoted = 0
    if int(alpha.max()) < 255:
        require(int(alpha.max()) >= 250, "SUPPLEMENTAL_BOARD_OPAQUE_CONTENT_REQUIRED")
        promote = alpha >= 250
        promoted = int(promote.sum())
        crop[promote, 3] = 255
        alpha = crop[:, :, 3]
    require(int(alpha.min()) == 0 and int(alpha.max()) == 255,
            "SUPPLEMENTAL_BOARD_ASSET_ALPHA_RANGE")
    asset_id, component_type, role, state = slot
    filename = f"{index:02d}_{asset_id}.png"
    picture = Image.fromarray(crop, "RGBA")
    if scale != 1.0:
        target_size = (max(1, int(round(picture.width * scale))),
                       max(1, int(round(picture.height * scale))))
        picture = picture.resize(target_size, Image.Resampling.LANCZOS)
        normalized = np.array(picture, copy=True)
        normalized[normalized[:, :, 3] == 0, :3] = 0
        picture = Image.fromarray(normalized, "RGBA")
    destination = output / "assets" / filename
    picture.save(destination, "PNG", optimize=True)
    result = {
        "id": asset_id,
        "component_type": component_type,
        "role": role,
        "file": f"assets/{filename}",
        "source_bbox": list(crop_bounds),
        "width": picture.width,
        "height": picture.height,
        "normalization_scale": scale,
        "near_opaque_pixels_promoted": promoted,
        "sha256": sha256(destination),
    }
    if state is not None:
        result["state_or_sample"] = state
    return result


def split_supplemental_boards(interactive_path: Path, structural_path: Path,
                              output_path: Path, document: str) -> dict:
    """Split the two fixed role boards and package 35 authenticated PNG assets."""
    identifier(document)
    output_path = output_path.resolve()
    require(not output_path.exists(), "SUPPLEMENTAL_BOARD_OUTPUT_EXISTS")
    interactive, interactive_evidence, interactive_bounds, interactive_extraction = _validate_board(
        interactive_path, INTERACTIVE_COLUMNS, INTERACTIVE_ROWS, set())
    structural, structural_evidence, structural_bounds, structural_extraction = _validate_board(
        structural_path, STRUCTURAL_COLUMNS, STRUCTURAL_ROWS, {11})
    require(len(interactive_bounds) == len(INTERACTIVE_SLOTS),
            "SUPPLEMENTAL_BOARD_INTERACTIVE_COUNT")
    require(len(structural_bounds) == len(STRUCTURAL_SLOTS),
            "SUPPLEMENTAL_BOARD_STRUCTURAL_COUNT")
    _require_matching_template_geometry(
        interactive_bounds[23], interactive.size, (INTERACTIVE_COLUMNS, INTERACTIVE_ROWS),
        structural_bounds[8], structural.size, (STRUCTURAL_COLUMNS, STRUCTURAL_ROWS),
        "SUPPLEMENTAL_BOARD_LIST_TEMPLATE_GEOMETRY_MISMATCH")
    _require_matching_template_geometry(
        structural_bounds[9], structural.size, (STRUCTURAL_COLUMNS, STRUCTURAL_ROWS),
        structural_bounds[10], structural.size, (STRUCTURAL_COLUMNS, STRUCTURAL_ROWS),
        "SUPPLEMENTAL_BOARD_TAB_TEMPLATE_GEOMETRY_MISMATCH")

    staging = output_path.with_name(f".{output_path.name}.{uuid.uuid4().hex}")
    staging.mkdir(parents=True, exist_ok=False)
    try:
        (staging / "assets").mkdir()
        padding = max(4, int(round(min(*interactive.size, *structural.size) * 0.0064)))
        interactive_cell = (interactive.width / INTERACTIVE_COLUMNS,
                            interactive.height / INTERACTIVE_ROWS)
        structural_cell = (structural.width / STRUCTURAL_COLUMNS,
                           structural.height / STRUCTURAL_ROWS)
        structural_scale_x = interactive_cell[0] / structural_cell[0]
        structural_scale_y = interactive_cell[1] / structural_cell[1]
        require(abs(structural_scale_x - structural_scale_y) <= 0.001,
                "SUPPLEMENTAL_BOARD_NON_UNIFORM_CELL_SCALE")
        structural_scale = (structural_scale_x + structural_scale_y) / 2
        assets = [
            *(_asset_row(interactive, bounds, slot, index + 1, staging, padding)
              for index, (bounds, slot) in enumerate(zip(interactive_bounds, INTERACTIVE_SLOTS))),
            *(_asset_row(structural, bounds, slot, index + 1 + len(INTERACTIVE_SLOTS), staging, padding, structural_scale)
              for index, (bounds, slot) in enumerate(zip(structural_bounds, STRUCTURAL_SLOTS))),
        ]
        _equalize_pair_canvases(assets, staging, "list_row", "list_selected_row")
        _equalize_pair_canvases(assets, staging, "tabs_tab", "tabs_active_tab")
        manifest = {
            "kind": "ai_ui_supplemental_asset_boards_draft_v1",
            "document": document,
            "appearance_binding_version": "0.2",
            "delivery_policy": "unreviewed_draft",
            "human_visual_acceptance": False,
            "sources": {
                "interactive": {"name": interactive_path.name, **interactive_evidence,
                                "layout": "4x6", "slot_order": [row[0] for row in INTERACTIVE_SLOTS]},
                "structural": {"name": structural_path.name, **structural_evidence,
                               "layout": "4x3", "slot_order": [*[row[0] for row in STRUCTURAL_SLOTS], None]},
            },
            "extraction": {
                "alpha_threshold": ALPHA_THRESHOLD,
                "padding": padding,
                "reserved_structural_slot": 12,
                "reserved_slot_policy": "all alpha below threshold",
                "canonical_cell_size": [interactive_cell[0], interactive_cell[1]],
                "structural_uniform_normalization_scale": structural_scale,
                "near_opaque_rule": "promote alpha >= 250 only when a crop has no alpha 255",
                "interactive": interactive_extraction,
                "structural": structural_extraction,
            },
            "assets": assets,
            "validation": {
                "asset_count": len(assets),
                "all_required_slots_present": True,
                "reserved_slot_empty": True,
                "transparent_rgb_zero": True,
                "all_assets_have_transparent_and_opaque_pixels": True,
                "paired_template_geometry_compatible": True,
                "paired_template_canvases_equal": True,
            },
        }
        manifest["digest"] = digest(manifest)
        write_json(staging / "manifest.json", manifest)

        archive_path = staging / f"{document}.supplemental.draft.zip"
        members = [staging / "manifest.json", *sorted((staging / "assets").glob("*.png"))]
        with zipfile.ZipFile(archive_path, "x", compression=zipfile.ZIP_STORED) as archive:
            for path in sorted(members, key=lambda item: item.relative_to(staging).as_posix()):
                relative = path.relative_to(staging).as_posix()
                info = zipfile.ZipInfo(relative, date_time=(1980, 1, 1, 0, 0, 0))
                info.external_attr = 0o100644 << 16
                with path.open("rb") as reader, archive.open(info, "w", force_zip64=True) as writer:
                    shutil.copyfileobj(reader, writer, length=1024 * 1024)
        with zipfile.ZipFile(archive_path) as archive:
            require(archive.testzip() is None, "SUPPLEMENTAL_BOARD_ZIP_READBACK")
            require(archive.namelist() == sorted(path.relative_to(staging).as_posix()
                    for path in members), "SUPPLEMENTAL_BOARD_ZIP_INVENTORY")
        result = {
            "kind": "ai_ui_supplemental_asset_boards_draft_export_v1",
            "status": "archive_roundtrip_passed",
            "document": document,
            "delivery_policy": "unreviewed_draft",
            "human_visual_acceptance": False,
            "asset_count": len(assets),
            "manifest_digest": manifest["digest"],
            "file": archive_path.name,
            "zip_sha256": sha256(archive_path),
        }
        write_json(staging / "export.json", result)
        staging.rename(output_path)
        return result
    except Exception:
        shutil.rmtree(staging, ignore_errors=True)
        raise
