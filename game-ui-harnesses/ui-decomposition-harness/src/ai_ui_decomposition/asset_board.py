"""Offline intake for a native-transparent 4x4 UI component asset board."""
from __future__ import annotations

import shutil
import uuid
import zipfile
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

from .common import digest, identifier, load_verified_image, require, sha256, write_json


SLOT_IDS = (
    "image", "text", "container", "button",
    "switch", "checkbox", "radio_group", "input",
    "select", "progress_bar", "slider", "scroll_view",
    "list", "panel", "dialog", "tabs",
)
ALPHA_THRESHOLD = 16
MINIMUM_AREA_DIVISOR = 100_000
MINIMUM_AREA_FLOOR = 16


def _component_rows(alpha: np.ndarray) -> tuple[list[dict], int, int]:
    labels, _count = ndimage.label(alpha >= ALPHA_THRESHOLD,
                                   structure=np.ones((3, 3), dtype=np.uint8))
    minimum_area = max(MINIMUM_AREA_FLOOR, int(round(alpha.size / MINIMUM_AREA_DIVISOR)))
    rows: list[dict] = []
    ignored = 0
    for label_id, slices in enumerate(ndimage.find_objects(labels), start=1):
        if slices is None:
            continue
        selected = labels[slices] == label_id
        area = int(selected.sum())
        if area < minimum_area:
            ignored += area
            continue
        ys, xs = np.nonzero(selected)
        y0, x0 = slices[0].start, slices[1].start
        rows.append({
            "area": area,
            "bbox": [x0, y0, slices[1].stop, slices[0].stop],
            "center": [float(x0 + xs.mean()), float(y0 + ys.mean())],
        })
    return rows, minimum_area, ignored


def split_asset_board(source_path: Path, output_path: Path, document: str) -> dict:
    """Split a transparent 4x4 board into the canonical sixteen component types."""
    identifier(document)
    source_path = source_path.resolve()
    output_path = output_path.resolve()
    require(not output_path.exists(), "ASSET_BOARD_OUTPUT_EXISTS")
    source, evidence = load_verified_image(source_path)
    require(evidence["alpha_extrema"][0] == 0 and evidence["alpha_extrema"][1] >= 250,
            "ASSET_BOARD_TRANSPARENCY_REQUIRED")

    source_data = np.array(source, copy=True)
    alpha = source_data[:, :, 3]
    require(not np.any(source_data[:, :, :3][alpha == 0]), "ASSET_BOARD_TRANSPARENT_RGB")
    components, minimum_area, ignored_area = _component_rows(alpha)
    require(len(components) >= len(SLOT_IDS), "ASSET_BOARD_COMPONENTS_MISSING")

    height, width = alpha.shape
    slots: dict[int, list[dict]] = {index: [] for index in range(len(SLOT_IDS))}
    for component in components:
        x, y = component["center"]
        column = min(3, int(x * 4 / width))
        row = min(3, int(y * 4 / height))
        slots[row * 4 + column].append(component)
    require(all(slots.values()), "ASSET_BOARD_SLOT_EMPTY")

    padding = max(4, int(round(min(width, height) * 0.0064)))
    staging = output_path.with_name(f".{output_path.name}.{uuid.uuid4().hex}")
    staging.mkdir(parents=True, exist_ok=False)
    try:
        assets_path = staging / "assets"
        assets_path.mkdir()
        assets = []
        for index, name in enumerate(SLOT_IDS):
            selected = slots[index]
            x0 = max(0, min(row["bbox"][0] for row in selected) - padding)
            y0 = max(0, min(row["bbox"][1] for row in selected) - padding)
            x1 = min(width, max(row["bbox"][2] for row in selected) + padding)
            y1 = min(height, max(row["bbox"][3] for row in selected) + padding)
            crop_data = np.array(source.crop((x0, y0, x1, y1)), copy=True)
            crop_alpha = crop_data[:, :, 3]
            crop_data[crop_alpha == 0, :3] = 0
            promoted = 0
            if int(crop_alpha.max()) < 255:
                require(int(crop_alpha.max()) >= 250, "ASSET_BOARD_OPAQUE_CONTENT_REQUIRED")
                promote = crop_alpha >= 250
                promoted = int(promote.sum())
                crop_data[promote, 3] = 255
                crop_alpha = crop_data[:, :, 3]
            require(int(crop_alpha.min()) == 0 and int(crop_alpha.max()) == 255,
                    "ASSET_BOARD_ASSET_ALPHA_RANGE")
            filename = f"{index + 1:02d}_{name}.png"
            destination = assets_path / filename
            Image.fromarray(crop_data, "RGBA").save(destination, "PNG", optimize=True)
            assets.append({
                "id": name,
                "file": f"assets/{filename}",
                "source_bbox": [x0, y0, x1, y1],
                "width": x1 - x0,
                "height": y1 - y0,
                "connected_regions": len(selected),
                "near_opaque_pixels_promoted": promoted,
                "sha256": sha256(destination),
            })

        manifest = {
            "kind": "ai_ui_native_asset_board_draft_v1",
            "document": document,
            "delivery_policy": "unreviewed_draft",
            "human_visual_acceptance": False,
            "source": {"name": source_path.name, **evidence},
            "extraction": {
                "layout": "4x4",
                "slot_order": list(SLOT_IDS),
                "alpha_threshold": ALPHA_THRESHOLD,
                "minimum_component_area": minimum_area,
                "padding": padding,
                "significant_connected_regions": len(components),
                "ignored_low_alpha_area": ignored_area,
                "near_opaque_rule": "promote alpha >= 250 only when a crop has no alpha 255",
            },
            "assets": assets,
            "validation": {
                "asset_count": len(assets),
                "all_slots_present": True,
                "transparent_rgb_zero": True,
                "all_assets_have_transparent_and_opaque_pixels": True,
            },
        }
        manifest["digest"] = digest(manifest)
        write_json(staging / "manifest.json", manifest)

        archive_path = staging / f"{document}.draft.zip"
        members = [staging / "manifest.json", *sorted(assets_path.glob("*.png"))]
        ordered_members = sorted(members, key=lambda path: path.relative_to(staging).as_posix())
        with zipfile.ZipFile(archive_path, "x", compression=zipfile.ZIP_STORED) as archive:
            for path in ordered_members:
                relative = path.relative_to(staging).as_posix()
                info = zipfile.ZipInfo(relative, date_time=(1980, 1, 1, 0, 0, 0))
                info.external_attr = 0o100644 << 16
                with path.open("rb") as reader, archive.open(info, "w", force_zip64=True) as writer:
                    shutil.copyfileobj(reader, writer, length=1024 * 1024)
        with zipfile.ZipFile(archive_path) as archive:
            require(archive.testzip() is None, "ASSET_BOARD_ZIP_READBACK")
            require(archive.namelist() == sorted(path.relative_to(staging).as_posix()
                    for path in members), "ASSET_BOARD_ZIP_INVENTORY")
        result = {
            "kind": "ai_ui_native_asset_board_draft_export_v1",
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
