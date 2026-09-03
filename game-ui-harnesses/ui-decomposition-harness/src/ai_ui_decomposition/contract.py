from __future__ import annotations

from pathlib import Path
import re

from .common import digest, identifier, load_verified_image, require, safe_relative, sha256
from .resources import plan_resources

KIND = "ai_ui_decomposition_plan_v1"
TEXT_POLICY = "remove_ordinary_text_preserve_graphic_symbols"
GRANULARITY = "important_components_only"
ROUTES = {"generated_completion", "generated_isolation", "source_crop", "reuse_scaled"}


def _fields(value: object, expected: set[str], code: str) -> None:
    require(isinstance(value, dict) and set(value) == expected, code)


def _vector(value: object, count: int, code: str) -> list[int]:
    require(isinstance(value, list) and len(value) == count
            and all(type(number) is int for number in value), code)
    return value


def _size(value: object, code: str) -> list[int]:
    result = _vector(value, 2, code)
    require(min(result) > 0 and result[0] * result[1] <= 67_108_864, code)
    return result


def _box(value: object, canvas: list[int], code: str) -> list[int]:
    result = _vector(value, 4, code)
    x0, y0, x1, y1 = result
    require(0 <= x0 < x1 <= canvas[0] and 0 <= y0 < y1 <= canvas[1], code)
    return result


def validate(plan: dict, verify_source: bool = True, source_base: Path | None = None) -> dict:
    required = {"kind", "id", "canvas", "source", "text_policy", "granularity",
                "assets", "nodes", "groups", "document"}
    require(isinstance(plan, dict) and required <= set(plan)
            and set(plan) <= required | {"delivery_policy"}, "PLAN_FIELDS")
    require(plan.get("delivery_policy", "reviewed") in {"reviewed", "unreviewed_draft"},
            "DELIVERY_POLICY")
    require(plan.get("kind") == KIND, "PLAN_KIND")
    identifier(plan.get("id"))
    canvas = _size(plan.get("canvas"), "CANVAS")
    require(plan.get("text_policy") == TEXT_POLICY, "TEXT_POLICY")
    require(plan.get("granularity") == GRANULARITY, "GRANULARITY")
    source = plan.get("source")
    require(isinstance(source, dict) and set(source) == {"path", "sha256", "size"},
            "SOURCE_BINDING")
    require(isinstance(source["path"], str) and source["path"], "SOURCE_PATH")
    require(re.fullmatch(r"[0-9a-f]{64}", source.get("sha256", "")), "SOURCE_DIGEST")
    require(_size(source["size"], "SOURCE_SIZE") == canvas, "SOURCE_CANVAS_MISMATCH")
    source_path = safe_relative((source_base or Path.cwd()).resolve(), source["path"])
    if verify_source:
        require(source_path.is_file() and sha256(source_path) == source["sha256"],
                "SOURCE_CHANGED")
        _picture, evidence = load_verified_image(source_path, canvas)
        require(evidence["sha256"] == source["sha256"], "SOURCE_CHANGED")

    assets = plan.get("assets")
    require(isinstance(assets, list) and 1 <= len(assets) <= 128, "ASSETS")
    index: dict[str, dict] = {}
    for asset in assets:
        required = {"id", "role", "route", "source_region", "output_size",
                    "output_mode", "prompt", "source_asset"}
        require(isinstance(asset, dict) and required <= set(asset)
                and set(asset) <= required | {"resize", "cached_result"}, "ASSET_FIELDS")
        key = identifier(asset.get("id"))
        require(key not in index, "DUPLICATE_ASSET")
        route = asset.get("route")
        require(route in ROUTES, "ASSET_ROUTE")
        if "cached_result" in asset:
            cached = asset["cached_result"]
            _fields(cached, {"source_batch_digest", "source_request_digest", "raw_sha256"},
                    "CACHED_RESULT_FIELDS")
            require(route.startswith("generated_"), "CACHED_RESULT_ROUTE")
            require(all(isinstance(value, str) and re.fullmatch(r"[0-9a-f]{64}", value)
                        for value in cached.values()), "CACHED_RESULT_DIGEST")
        require(asset.get("role") in {"background", "important_component"}, "ASSET_ROLE")
        _box(asset.get("source_region"), canvas, "ASSET_REGION")
        size = _size(asset.get("output_size"), "ASSET_SIZE")
        mode = asset.get("output_mode")
        require(mode in {"opaque_canvas", "keyed_component", "rgba"}, "OUTPUT_MODE")
        if "resize" in asset:
            resize = asset["resize"]
            _fields(resize, {"mode", "insets"}, "RESIZE_FIELDS")
            require(resize["mode"] == "nine_slice", "RESIZE_MODE")
            require(asset["role"] == "important_component"
                    and mode in {"keyed_component", "rgba"}, "RESIZE_COMPONENT_ONLY")
            left, top, right, bottom = _vector(resize["insets"], 4, "RESIZE_INSETS")
            require(min(left, top, right, bottom) > 0, "RESIZE_INSETS")
            require(size[0] > left + right and size[1] > top + bottom,
                    "RESIZE_TARGET_TOO_SMALL")
        if asset["role"] == "background":
            require(mode == "opaque_canvas" and size == canvas, "BACKGROUND_ASSET")
            require(route in {"generated_completion", "source_crop"}, "BACKGROUND_ROUTE")
        if route == "generated_completion":
            require(mode == "opaque_canvas", "COMPLETION_OUTPUT_MODE")
        if route == "generated_isolation":
            require(mode == "keyed_component", "ISOLATION_OUTPUT_MODE")
        if route == "reuse_scaled":
            require(mode == "rgba", "REUSE_OUTPUT_MODE")
        if route.startswith("generated_"):
            require(isinstance(asset.get("prompt"), str) and asset["prompt"].strip(),
                    "GENERATED_PROMPT")
            require(asset.get("source_asset") is None, "GENERATED_SOURCE_ASSET")
        elif route == "reuse_scaled":
            require(isinstance(asset.get("source_asset"), str), "REUSE_SOURCE")
            require(not asset.get("prompt"), "REUSE_PROMPT")
        else:
            require(not asset.get("prompt") and asset.get("source_asset") is None,
                    "SOURCE_CROP_FIELDS")
        index[key] = asset

    for key, asset in index.items():
        if asset["route"] == "reuse_scaled":
            source_id = asset["source_asset"]
            require(source_id in index and source_id != key, "REUSE_SOURCE")
            require(index[source_id]["route"] != "reuse_scaled", "REUSE_CHAIN")
            require(index[source_id]["role"] == "important_component", "REUSE_BACKGROUND")

    nodes = plan.get("nodes")
    require(isinstance(nodes, list) and nodes, "NODES")
    node_ids: set[str] = set()
    used: set[str] = set()
    background_nodes = []
    for node in nodes:
        _fields(node, {"id", "asset", "xy"}, "NODE_FIELDS")
        node_id = identifier(node.get("id"))
        require(node_id not in node_ids, "DUPLICATE_NODE")
        asset_id = identifier(node.get("asset"))
        require(asset_id in index, "NODE_ASSET")
        xy = _vector(node.get("xy"), 2, "NODE_XY")
        width, height = index[asset_id]["output_size"]
        require(0 <= xy[0] and 0 <= xy[1]
                and xy[0] + width <= canvas[0] and xy[1] + height <= canvas[1],
                "NODE_OUTSIDE_CANVAS")
        if index[asset_id]["role"] == "background":
            background_nodes.append(node_id)
            require(xy == [0, 0], "BACKGROUND_POSITION")
        node_ids.add(node_id)
        used.add(asset_id)
    require(used == set(index), "UNUSED_ASSET")
    require(len(background_nodes) == 1, "ONE_BACKGROUND_REQUIRED")

    groups = plan.get("groups")
    require(isinstance(groups, list) and groups, "GROUPS")
    grouped: list[str] = []
    group_ids: set[str] = set()
    for group in groups:
        _fields(group, {"id", "children"}, "GROUP_FIELDS")
        group_id = identifier(group.get("id"))
        require(group_id not in group_ids, "DUPLICATE_GROUP")
        children = group.get("children")
        require(isinstance(children, list) and children
                and all(child in node_ids for child in children), "GROUP_CHILDREN")
        grouped.extend(children)
        group_ids.add(group_id)
    require(len(grouped) == len(set(grouped)) == len(node_ids), "GROUP_COVERAGE")

    document = plan.get("document")
    require(isinstance(document, dict) and set(document) == {"name", "format"},
            "DOCUMENT")
    identifier(document.get("name"))
    require(document.get("format") in {"auto", "psd", "psb"}, "DOCUMENT_FORMAT")
    resources = plan_resources(plan)
    generated = sum(asset["route"].startswith("generated_") and "cached_result" not in asset
                    for asset in assets)
    reused_instances = len(nodes) - len({node["asset"] for node in nodes})
    return {"status": "plan_valid_no_generation", "plan_digest": digest(plan),
            "assets": len(assets), "pixel_layers": len(nodes), "groups": len(groups),
            "generated_requests": generated, "reused_instances": reused_instances,
            "resources": resources,
            "automatic_semantic_inference": False,
            "automatic_visual_acceptance": False,
            "format_available": document["format"] != "psb"}
