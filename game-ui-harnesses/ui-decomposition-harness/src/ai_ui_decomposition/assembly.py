from __future__ import annotations

from pathlib import Path
import shutil

from PIL import Image
import numpy as np

from . import batch
from .common import digest, read_json, require, sha256, write_json
from .media import normalize
from .process import read_materials


def _max_error(left: Image.Image, right: Image.Image) -> int:
    a = np.asarray(left.convert("RGBA"), dtype=np.int16)
    b = np.asarray(right.convert("RGBA"), dtype=np.int16)
    require(a.shape == b.shape, "PIXEL_SHAPE_MISMATCH")
    return int(np.abs(a - b).max())


def finalize(run: Path, output: Path) -> dict:
    frozen, plan = batch.load(run)
    materials = read_materials(run)
    review = read_json(run / "review.json")
    require(review.get("kind") == "ai_ui_decomposition_visual_review_v1"
            and review.get("decision") == "accept"
            and review.get("automatic_visual_acceptance") is False,
            "EXPLICIT_VISUAL_REVIEW_REQUIRED")
    require(review.get("plan_digest") == digest(plan)
            and review.get("materials_digest") == materials["digest"]
            and review.get("contact_sheet_sha256") == materials["contact_sheet_sha256"],
            "REVIEW_BINDING_CHANGED")
    expected_assets = {asset["id"] for asset in plan["assets"]}
    require(set(review.get("reviewed_asset_ids", [])) == expected_assets,
            "REVIEW_ASSET_COVERAGE")
    output = output.resolve()
    require(not output.exists(), "DELIVERY_EXISTS")
    (output / "layers").mkdir(parents=True)
    material_rows = {row["asset"]: row for row in materials["assets"]}
    nodes = {node["id"]: node for node in plan["nodes"]}
    assets = {asset["id"]: asset for asset in plan["assets"]}
    layer_records = {}
    cache = {}
    for node in plan["nodes"]:
        row = material_rows[node["asset"]]
        source = run / row["path"]
        destination = output / "layers" / f"{node['id']}.png"
        shutil.copyfile(source, destination)
        with Image.open(destination) as image:
            picture = normalize(image)
        picture.save(destination)
        cache[node["id"]] = picture
        layer_records[node["id"]] = {"id": node["id"], "name": node["id"],
            "kind": "pixel", "role": assets[node["asset"]]["role"],
            "asset": node["asset"], "png": destination.relative_to(output).as_posix(),
            "sha256": sha256(destination), "left": node["xy"][0], "top": node["xy"][1],
            "size": list(picture.size), "visible": True, "opacity": 255,
            "blend_mode": "normal"}
    tree = [{"id": group["id"], "name": group["id"], "kind": "group",
             "children": [layer_records[child] for child in group["children"]]}
            for group in plan["groups"]]
    preview = Image.new("RGBA", tuple(plan["canvas"]), (0, 0, 0, 0))
    for group in plan["groups"]:
        for node_id in group["children"]:
            node = nodes[node_id]
            preview.alpha_composite(cache[node_id], tuple(node["xy"]))
    preview = normalize(preview)
    preview_path = output / "preview.png"
    preview.save(preview_path)
    scene = {"kind": "ai_ui_decomposition_scene_v1", "canvas": plan["canvas"],
             "tree": tree, "preview": "preview.png",
             "preview_sha256": sha256(preview_path), "document": plan["document"],
             "plan_digest": digest(plan), "materials_digest": materials["digest"],
             "review_sha256": sha256(run / "review.json")}
    write_json(output / "scene.json", scene)
    receipt = {"kind": "ai_ui_decomposition_delivery_v1",
               "status": "assembled_visual_review_bound", "plan_digest": digest(plan),
               "batch_digest": frozen["digest"], "materials_digest": materials["digest"],
               "pixel_layers": len(plan["nodes"]), "groups": len(plan["groups"]),
               "preview_sha256": sha256(preview_path), "automatic_retries": 0,
               "automatic_semantic_inference": False,
               "automatic_visual_acceptance": False,
               "not_established": ["automatic_component_importance_selection",
                                   "automatic_visual_acceptance",
                                   "photoshop_application_open_validation",
                                   "hidden_pixel_recovery"]}
    receipt["digest"] = digest(receipt)
    write_json(output / "delivery.json", receipt)
    return receipt


def inspect_delivery(output: Path) -> dict:
    output = output.resolve()
    scene = read_json(output / "scene.json")
    receipt = read_json(output / "delivery.json")
    body = {key: value for key, value in receipt.items() if key != "digest"}
    require(receipt.get("digest") == digest(body), "DELIVERY_CHANGED")
    preview = output / scene["preview"]
    require(preview.is_file() and sha256(preview) == scene["preview_sha256"],
            "PREVIEW_CHANGED")
    for group in scene["tree"]:
        for layer in group["children"]:
            path = output / layer["png"]
            require(path.is_file() and sha256(path) == layer["sha256"], "LAYER_CHANGED")
    return receipt
