from __future__ import annotations

from pathlib import Path
import importlib.metadata
import importlib.util

from PIL import Image

from .common import digest, identifier, load_verified_image, require, sha256, write_json
from .contract import GRANULARITY, KIND, TEXT_POLICY, validate
from .media import matte_key
from .resources import (DEFAULT_MEMORY_BUDGET_BYTES, MAX_KEYED_INPUT_PIXELS,
                        MAX_NODES, MAX_TOTAL_LAYER_PIXELS, MAX_TOTAL_MATERIAL_PIXELS,
                        memory_budget_bytes)


def init_plan(reference: Path, plan_path: Path, plan_id: str, document_name: str) -> dict:
    plan_id = identifier(plan_id)
    document_name = identifier(document_name)
    reference = reference.resolve()
    plan_path = plan_path.resolve()
    require(not plan_path.exists(), "PLAN_EXISTS")
    picture, evidence = load_verified_image(reference)
    input_path = plan_path.parent / "inputs" / "reference.png"
    require(not input_path.exists(), "REFERENCE_SNAPSHOT_EXISTS")
    input_path.parent.mkdir(parents=True, exist_ok=True)
    picture.save(input_path)
    canvas = evidence["size"]
    plan = {
        "kind": KIND, "id": plan_id, "canvas": canvas,
        "source": {"path": "inputs/reference.png", "sha256": sha256(input_path),
                   "size": canvas},
        "text_policy": TEXT_POLICY, "granularity": GRANULARITY,
        "assets": [{"id": "scene", "role": "background",
                    "route": "generated_completion",
                    "source_region": [0, 0, canvas[0], canvas[1]],
                    "output_size": canvas, "output_mode": "opaque_canvas",
                    "prompt": "Reconstruct the scenic background without UI or text",
                    "source_asset": None}],
        "nodes": [{"id": "background", "asset": "scene", "xy": [0, 0]}],
        "groups": [{"id": "background_group", "children": ["background"]}],
        "document": {"name": document_name, "format": "auto"},
    }
    validate(plan, source_base=plan_path.parent)
    write_json(plan_path, plan)
    return {"kind": "ai_ui_decomposition_plan_initialized_v1",
            "status": "starter_plan_requires_semantic_editing",
            "plan": plan_path.name, "plan_digest": digest(plan), "canvas": canvas,
            "automatic_semantic_inference": False}


def doctor() -> dict:
    versions = {}
    for name in ("Pillow", "numpy", "scipy"):
        versions[name] = importlib.metadata.version(name)
    psd_available = importlib.util.find_spec("psd_tools") is not None
    psd_version = importlib.metadata.version("psd-tools") if psd_available else None
    return {"kind": "ai_ui_decomposition_doctor_v1", "status": "ready",
            "core_versions": versions, "psd": {"available": psd_available,
            "version": psd_version, "expected": "1.18.0"},
            "network_probe": "not_performed", "provider_compute": "not_performed",
            "resource_policy": {"memory_budget_bytes": memory_budget_bytes(),
                                "memory_budget_fallback_bytes": DEFAULT_MEMORY_BUDGET_BYTES,
                                "keyed_input_pixels": MAX_KEYED_INPUT_PIXELS,
                                "material_pixels": MAX_TOTAL_MATERIAL_PIXELS,
                                "layer_pixels": MAX_TOTAL_LAYER_PIXELS,
                                "nodes": MAX_NODES},
            "automatic_retries": 0}


def self_test() -> dict:
    image = Image.new("RGBA", (32, 24), (248, 8, 248, 255))
    for x in range(6, 26):
        for y in range(4, 20):
            image.putpixel((x, y), (40, 180, 220, 255))
    for x in range(13, 19):
        for y in range(9, 15):
            image.putpixel((x, y), (248, 8, 248, 255))
    result = matte_key(image, [32, 24])
    alpha = result.getchannel("A")
    require(alpha.getbbox() is not None and alpha.getpixel((16, 12)) == 0,
            "SELF_TEST_MATTE_FAILED")
    values = (result.getpixel((x, y)) for y in range(result.height)
              for x in range(result.width))
    require(all(pixel[:3] == (0, 0, 0) for pixel in values if pixel[3] == 0),
            "SELF_TEST_TRANSPARENT_RGB_FAILED")
    return {"kind": "ai_ui_decomposition_self_test_v1", "status": "passed",
            "global_key_hole": "passed", "transparent_rgb": "passed",
            "network_probe": "not_performed", "provider_compute": "not_performed"}
