"""Explicit geometric relations checked against a real runtime inspection.

The relation plan names both endpoints of every check.  Runtime node bounds,
rendered text bounds and paint-region bounds are read from ``inspection``;
authored layout rectangles are used only to verify that an explicitly named
image resource is registered by the named node.  Image visible bounds are
derived from the digest-verified resource alpha and an explicit sourceRect.

This module is intentionally optional.  It does not discover ornaments, OCR
text, infer relationships from component ids, or grant human visual approval.
"""
from __future__ import annotations

import base64
import binascii
import hashlib
import io
import math
from typing import Any

from PIL import Image, UnidentifiedImageError

from .common import ContractError, require
from .visual_policy import walk


KIND = "ui_visual_relations_v1"
CHECK_KIND = "ui_visual_relations_check_v1"
COORDINATE_SPACE = "runtime-world"
_VERTICAL_ORDERS = {"decoration_above_text", "text_above_decoration"}
_ALIGNMENTS = {"left", "center", "right"}
_REF_KINDS = {"paint-region-alpha", "text", "node"}


def _number(value: Any, code: str, *, minimum: float | None = None) -> None:
    require(type(value) in (int, float) and math.isfinite(value), code)
    if minimum is not None:
        require(value >= minimum, code)


def _rect(value: Any, code: str, *, positive: bool = False) -> dict[str, float]:
    require(isinstance(value, dict) and set(value) == {"x", "y", "width", "height"}, code)
    for key in ("x", "y", "width", "height"):
        _number(value[key], code)
    require(value["width"] > 0 and value["height"] > 0 if positive else
            value["width"] >= 0 and value["height"] >= 0, code)
    return {key: float(value[key]) for key in ("x", "y", "width", "height")}


def _id(value: Any, code: str) -> None:
    require(isinstance(value, str) and value.strip() and len(value) <= 64, code)


def _evidence(value: Any) -> None:
    require(isinstance(value, str) and value.strip(), "RELATION_EVIDENCE_REQUIRED")


def _source_rect(value: Any) -> tuple[int, int, int, int]:
    require(isinstance(value, list) and len(value) == 4, "RELATION_SOURCE_RECT_INVALID")
    require(all(type(v) is int for v in value), "RELATION_SOURCE_RECT_INVALID")
    x, y, width, height = value
    require(x >= 0 and y >= 0 and width > 0 and height > 0,
            "RELATION_SOURCE_RECT_INVALID")
    return x, y, width, height


def _validate_text_ref(value: Any) -> None:
    require(isinstance(value, dict) and set(value) ==
            {"kind", "componentId", "textIndex", "text"},
            "RELATION_TEXT_REF_SCHEMA")
    require(value["kind"] == "text", "RELATION_TEXT_REF_KIND")
    _id(value["componentId"], "RELATION_COMPONENT_ID")
    require(type(value["textIndex"]) is int and value["textIndex"] >= 0,
            "RELATION_TEXT_INDEX")
    require(isinstance(value["text"], str) and value["text"] != "",
            "RELATION_TEXT_VALUE")


def _validate_asset_ref(value: Any) -> None:
    require(isinstance(value, dict) and set(value) ==
            {"path", "sha256", "sourceRect", "alphaSha256", "alphaThreshold"},
            "RELATION_ASSET_SCHEMA")
    require(isinstance(value["path"], str) and value["path"] and
            "\\" not in value["path"] and ":" not in value["path"],
            "RELATION_ASSET_PATH")
    require(isinstance(value["sha256"], str) and len(value["sha256"]) == 64 and
            all(c in "0123456789abcdef" for c in value["sha256"]),
            "RELATION_ASSET_DIGEST")
    _source_rect(value["sourceRect"])
    require(isinstance(value["alphaSha256"], str) and len(value["alphaSha256"]) == 64 and
            all(c in "0123456789abcdef" for c in value["alphaSha256"]),
            "RELATION_ALPHA_DIGEST")
    require(type(value["alphaThreshold"]) is int and 1 <= value["alphaThreshold"] <= 255,
            "RELATION_ALPHA_THRESHOLD")


def _validate_visual_ref(value: Any) -> None:
    require(isinstance(value, dict) and set(value) ==
            {"kind", "componentId", "paintRegionIndex", "asset"},
            "RELATION_VISUAL_REF_SCHEMA")
    require(value["kind"] == "paint-region-alpha", "RELATION_VISUAL_REF_KIND")
    _id(value["componentId"], "RELATION_COMPONENT_ID")
    require(type(value["paintRegionIndex"]) is int and value["paintRegionIndex"] >= 0,
            "RELATION_PAINT_REGION_INDEX")
    _validate_asset_ref(value["asset"])


def _validate_endpoint(value: Any) -> None:
    require(isinstance(value, dict) and value.get("kind") in _REF_KINDS,
            "RELATION_ENDPOINT_SCHEMA")
    if value["kind"] == "text":
        _validate_text_ref(value)
    elif value["kind"] == "paint-region-alpha":
        _validate_visual_ref(value)
    else:
        require(set(value) == {"kind", "componentId"}, "RELATION_NODE_REF_SCHEMA")
        _id(value["componentId"], "RELATION_COMPONENT_ID")


def _validate_owner(value: Any) -> None:
    require(isinstance(value, dict) and value.get("kind") in {"node", "paint-region"},
            "RELATION_OWNER_SCHEMA")
    _id(value.get("componentId"), "RELATION_COMPONENT_ID")
    if value["kind"] == "node":
        require(set(value) == {"kind", "componentId"}, "RELATION_OWNER_SCHEMA")
    else:
        require(set(value) == {"kind", "componentId", "paintRegionIndex"},
                "RELATION_OWNER_SCHEMA")
        require(type(value["paintRegionIndex"]) is int and value["paintRegionIndex"] >= 0,
                "RELATION_PAINT_REGION_INDEX")


def _validate_plan(plan: Any) -> None:
    require(isinstance(plan, dict) and set(plan) ==
            {"kind", "version", "coordinateSpace", "verticalGaps",
             "horizontalAlignments", "iconInsets"},
            "VISUAL_RELATIONS_SCHEMA")
    require(plan["kind"] == KIND and plan["version"] == "1.0" and
            plan["coordinateSpace"] == COORDINATE_SPACE, "VISUAL_RELATIONS_SCHEMA")
    for field in ("verticalGaps", "horizontalAlignments", "iconInsets"):
        require(isinstance(plan[field], list), "RELATION_SECTION_SCHEMA")
    require(sum(len(plan[field]) for field in
                ("verticalGaps", "horizontalAlignments", "iconInsets")) > 0,
            "RELATION_PLAN_EMPTY")
    relation_ids: set[str] = set()
    for spec in plan["verticalGaps"]:
        require(isinstance(spec, dict) and set(spec) ==
                {"id", "decoration", "text", "order", "minimumGap", "evidence"},
                "RELATION_VERTICAL_SCHEMA")
        _id(spec["id"], "RELATION_ID")
        require(spec["id"] not in relation_ids, "RELATION_DUPLICATE_ID")
        relation_ids.add(spec["id"])
        _validate_visual_ref(spec["decoration"])
        _validate_text_ref(spec["text"])
        require(spec["order"] in _VERTICAL_ORDERS, "RELATION_VERTICAL_ORDER")
        _number(spec["minimumGap"], "RELATION_MINIMUM_GAP", minimum=0)
        _evidence(spec["evidence"])
    for spec in plan["horizontalAlignments"]:
        require(isinstance(spec, dict) and set(spec) ==
                {"id", "left", "right", "alignment", "tolerance", "evidence"},
                "RELATION_HORIZONTAL_SCHEMA")
        _id(spec["id"], "RELATION_ID")
        require(spec["id"] not in relation_ids, "RELATION_DUPLICATE_ID")
        relation_ids.add(spec["id"])
        _validate_endpoint(spec["left"])
        _validate_endpoint(spec["right"])
        require(spec["alignment"] in _ALIGNMENTS, "RELATION_ALIGNMENT")
        _number(spec["tolerance"], "RELATION_ALIGNMENT_TOLERANCE", minimum=0)
        _evidence(spec["evidence"])
    for spec in plan["iconInsets"]:
        require(isinstance(spec, dict) and set(spec) ==
                {"id", "icon", "owner", "minimumInsets", "evidence"},
                "RELATION_INSETS_SCHEMA")
        _id(spec["id"], "RELATION_ID")
        require(spec["id"] not in relation_ids, "RELATION_DUPLICATE_ID")
        relation_ids.add(spec["id"])
        _validate_visual_ref(spec["icon"])
        _validate_owner(spec["owner"])
        require(isinstance(spec["minimumInsets"], dict) and
                set(spec["minimumInsets"]) == {"top", "right", "bottom", "left"},
                "RELATION_INSETS_SCHEMA")
        for value in spec["minimumInsets"].values():
            _number(value, "RELATION_MINIMUM_INSET", minimum=0)
        _evidence(spec["evidence"])


def _registered_resource_paths(node: dict) -> set[str]:
    """Return paths from the node's known resource-bearing document fields.

    Do not search arbitrary labels or notes: a text value that happens to equal
    a resource path is not proof that the runtime registered that resource.
    ``appearance`` is traversed recursively, but only keys used by the public
    appearance contracts can contribute a resource path.
    """
    paths: set[str] = set()
    props = node.get("props", {})
    if isinstance(props, dict) and isinstance(props.get("source"), str):
        paths.add(props["source"])
    resource_keys = {"image", "source", "backgroundImage", "fieldImage", "arrowImage",
                     "popupImage", "rowImage", "selectedRowImage", "trackImage",
                     "thumbImage", "tabImage", "activeTabImage", "overlayImage"}

    def visit(value: Any) -> None:
        if isinstance(value, dict):
            for child_key, child in value.items():
                if child_key in resource_keys:
                    if isinstance(child, str):
                        paths.add(child)
                    else:
                        visit(child)
                else:
                    # Recurse through appearance containers (box, mark,
                    # background, icons, items, stateImages, etc.) but do not
                    # treat arbitrary string values such as labels or notes as
                    # resources. Only the allowlisted resource keys above add
                    # paths.
                    visit(child)
        elif isinstance(value, list):
            for child in value:
                visit(child)

    if isinstance(props, dict):
        visit(props.get("appearance"))
    return paths


def _resource_support(bundle: dict, authored: dict, ref: dict) -> dict[str, Any]:
    asset = ref["asset"]
    require(asset["path"] in _registered_resource_paths(authored),
            "RELATION_ASSET_NOT_REGISTERED")
    resources = bundle.get("resources")
    require(isinstance(resources, list), "RELATION_RESOURCES_REQUIRED")
    matches = [row for row in resources if isinstance(row, dict) and row.get("path") == asset["path"]]
    require(len(matches) == 1, "RELATION_RESOURCE_MISSING")
    resource = matches[0]
    require(isinstance(resource.get("base64"), str) and isinstance(resource.get("sha256"), str),
            "RELATION_RESOURCE_SCHEMA")
    try:
        payload = base64.b64decode(resource["base64"], validate=True)
    except (ValueError, binascii.Error) as exc:
        raise ContractError("RELATION_RESOURCE_BASE64_INVALID") from exc
    actual_sha = hashlib.sha256(payload).hexdigest()
    require(actual_sha == resource["sha256"] == asset["sha256"], "RELATION_RESOURCE_CHANGED")
    try:
        with Image.open(io.BytesIO(payload)) as source:
            image = source.convert("RGBA")
            image.load()
    except (UnidentifiedImageError, OSError) as exc:
        raise ContractError("RELATION_RESOURCE_DECODE_FAILED") from exc
    x, y, width, height = _source_rect(asset["sourceRect"])
    require(x + width <= image.width and y + height <= image.height,
            "RELATION_SOURCE_RECT_OUT_OF_BOUNDS")
    alpha = image.getchannel("A").crop((x, y, x + width, y + height))
    alpha_sha = hashlib.sha256(alpha.tobytes()).hexdigest()
    require(alpha_sha == asset["alphaSha256"], "RELATION_ALPHA_CHANGED")
    threshold = asset["alphaThreshold"]
    support = alpha.point(lambda value: 255 if value >= threshold else 0).getbbox()
    require(support is not None, "RELATION_ALPHA_EMPTY")
    # PIL returns (left, top, right, bottom), while the public geometry
    # contract uses (x, y, width, height). Preserve the crop-local origin;
    # callers add sourceRect.x/y when mapping into the full PNG canvas.
    sx, sy, ex, ey = support
    return {"imageSize": [image.width, image.height], "sourceRect": [x, y, width, height],
            "alphaSha256": alpha_sha, "alphaBounds": [sx, sy, ex - sx, ey - sy],
            "alphaThreshold": threshold}


def _actual_bounds(value: Any, code: str) -> dict[str, float]:
    return _rect(value, code, positive=True)


def _runtime_node(actual: dict[str, dict], ref: dict, checks: list, check, *, role: str) -> dict | None:
    node = actual.get(ref["componentId"])
    if node is None:
        check(False, "RELATION_{}_NODE_MISSING".format(role.upper()), ref["componentId"])
        return None
    if node.get("visible") is not True:
        check(False, "RELATION_{}_NOT_VISIBLE".format(role.upper()), ref["componentId"])
        return None
    return node


def _text_bounds(actual: dict[str, dict], ref: dict, check) -> dict[str, Any] | None:
    node = _runtime_node(actual, ref, [], check, role="text")
    if node is None:
        return None
    labels = node.get("renderedTextBounds")
    if not isinstance(labels, list) or ref["textIndex"] >= len(labels):
        check(False, "RELATION_TEXT_OBSERVATION_MISSING", ref["componentId"],
              text=ref["text"], textIndex=ref["textIndex"])
        return None
    label = labels[ref["textIndex"]]
    if not isinstance(label, dict) or label.get("text") != ref["text"]:
        check(False, "RELATION_TEXT_OBSERVATION_MISMATCH", ref["componentId"],
              expected=ref["text"], textIndex=ref["textIndex"],
              actual=label.get("text") if isinstance(label, dict) else None)
        return None
    bounds = _actual_bounds(label.get("bounds"), "RELATION_TEXT_BOUNDS_INVALID")
    return {"bounds": bounds, "text": label["text"], "textIndex": ref["textIndex"]}


def _visual_bounds(bundle: dict, authored_nodes: dict[str, dict], actual: dict[str, dict],
                   paints: list, ref: dict, check) -> dict[str, Any] | None:
    node = _runtime_node(actual, ref, [], check, role="visual")
    if node is None:
        return None
    matching = [row for row in paints if row.get("componentId") == ref["componentId"]]
    index = ref["paintRegionIndex"]
    if index >= len(matching):
        check(False, "RELATION_PAINT_REGION_MISSING", ref["componentId"],
              paintRegionIndex=index)
        return None
    region = matching[index]
    paint = _actual_bounds(region.get("bounds"), "RELATION_PAINT_BOUNDS_INVALID")
    support = _resource_support(bundle, authored_nodes[ref["componentId"]], ref)
    source_x, source_y, source_width, source_height = support["sourceRect"]
    alpha_x, alpha_y, alpha_width, alpha_height = support["alphaBounds"]
    # The selected paint region is the renderer's rectangle for the complete
    # registered PNG.  sourceRect identifies an ROI inside that PNG; it does
    # not turn the ROI into a new cropped canvas.  Retain both the ROI offset
    # and the full decoded image dimensions when mapping its alpha support.
    image_width, image_height = support["imageSize"]
    visible = {
        "x": paint["x"] + ((source_x + alpha_x) / image_width) * paint["width"],
        "y": paint["y"] + ((source_y + alpha_y) / image_height) * paint["height"],
        "width": (alpha_width / image_width) * paint["width"],
        "height": (alpha_height / image_height) * paint["height"],
    }
    return {"bounds": visible, "paintBounds": paint, "alpha": support,
            "componentId": ref["componentId"], "paintRegionIndex": index,
            "assetPath": ref["asset"]["path"]}


def _endpoint_bounds(bundle, authored_nodes, actual, paints, ref, check):
    if ref["kind"] == "text":
        return _text_bounds(actual, ref, check)
    if ref["kind"] == "node":
        node = _runtime_node(actual, ref, [], check, role="endpoint")
        if node is None:
            return None
        return {"bounds": _actual_bounds(node.get("bounds"), "RELATION_ENDPOINT_BOUNDS_INVALID"),
                "componentId": ref["componentId"], "kind": "node"}
    return _visual_bounds(bundle, authored_nodes, actual, paints, ref, check)


def _owner_bounds(actual: dict[str, dict], paints: list, owner: dict, check) -> dict[str, float] | None:
    node = actual.get(owner["componentId"])
    if node is None:
        check(False, "RELATION_OWNER_MISSING", owner["componentId"])
        return None
    if node.get("visible") is not True:
        check(False, "RELATION_OWNER_NOT_VISIBLE", owner["componentId"])
        return None
    if owner["kind"] == "node":
        return _actual_bounds(node.get("bounds"), "RELATION_OWNER_BOUNDS_INVALID")
    matching = [row for row in paints if row.get("componentId") == owner["componentId"]]
    index = owner["paintRegionIndex"]
    if index >= len(matching):
        check(False, "RELATION_OWNER_PAINT_REGION_MISSING", owner["componentId"],
              paintRegionIndex=index)
        return None
    return _actual_bounds(matching[index].get("bounds"), "RELATION_OWNER_BOUNDS_INVALID")


def check_visual_relations(bundle: dict, plan: dict | None, inspection: dict | None) -> dict:
    """Check an optional relation plan against fresh runtime inspection evidence.

    ``bundle`` is the consumed component document.  ``plan`` is an explicit
    ``ui_visual_relations_v1`` object, normally ``visualObservations.visualRelations``.
    ``inspection`` is the actual runtime ``inspect()`` result from the same
    capture as the caller's screenshot evidence.  The function does not read or
    trust authored rectangles for the measured relationship.
    """
    if plan is None:
        return {"kind": CHECK_KIND, "status": "not_applicable", "issues": [], "checks": [],
                "human_visual_acceptance": False, "coverage": "not_declared"}
    _validate_plan(plan)
    require(isinstance(bundle, dict) and isinstance(bundle.get("document"), dict),
            "RELATION_BUNDLE_REQUIRED")
    root = bundle["document"].get("root")
    require(isinstance(root, dict), "RELATION_DOCUMENT_ROOT_REQUIRED")
    authored_nodes = {node["id"]: node for node in walk(root)}
    require(len(authored_nodes) == sum(1 for _ in walk(root)), "RELATION_DOCUMENT_DUPLICATE_ID")
    require(isinstance(inspection, dict) and isinstance(inspection.get("nodes"), list),
            "RELATION_INSPECTION_REQUIRED")
    require(isinstance(inspection.get("paintRegions"), list),
            "RELATION_INSPECTION_PAINT_REGIONS_REQUIRED")
    actual_nodes: dict[str, dict] = {}
    for node in inspection["nodes"]:
        require(isinstance(node, dict) and isinstance(node.get("id"), str),
                "RELATION_INSPECTION_NODE_SCHEMA")
        require(node["id"] not in actual_nodes, "RELATION_INSPECTION_DUPLICATE_ID")
        actual_nodes[node["id"]] = node
        if "bounds" in node:
            _actual_bounds(node["bounds"], "RELATION_INSPECTION_BOUNDS_INVALID")
    paints = []
    for region in inspection["paintRegions"]:
        require(isinstance(region, dict) and isinstance(region.get("componentId"), str),
                "RELATION_PAINT_REGION_SCHEMA")
        _actual_bounds(region.get("bounds"), "RELATION_PAINT_BOUNDS_INVALID")
        paints.append(region)

    checks: list[dict] = []
    issues: list[dict] = []

    def check(ok: bool, code: str, relation_id: str, **detail: Any) -> None:
        row = {"relationId": relation_id, "code": code, "passed": bool(ok), **detail}
        checks.append(row)
        if not ok:
            issues.append(row)

    for spec in plan["verticalGaps"]:
        decoration = _visual_bounds(bundle, authored_nodes, actual_nodes, paints,
                                     spec["decoration"], lambda ok, code, ident, **d:
                                     check(ok, code, spec["id"], componentId=ident, **d))
        text = _text_bounds(actual_nodes, spec["text"], lambda ok, code, ident, **d:
                            check(ok, code, spec["id"], componentId=ident, **d))
        if decoration is None or text is None:
            continue
        decoration_bounds, text_bounds = decoration["bounds"], text["bounds"]
        if spec["order"] == "decoration_above_text":
            gap = text_bounds["y"] - (decoration_bounds["y"] + decoration_bounds["height"])
        else:
            gap = decoration_bounds["y"] - (text_bounds["y"] + text_bounds["height"])
        check(gap >= spec["minimumGap"], "RELATION_VERTICAL_GAP", spec["id"],
              actualGap=gap, minimumGap=spec["minimumGap"],
              decoration=decoration, text=text, evidence=spec["evidence"])

    for spec in plan["horizontalAlignments"]:
        left = _endpoint_bounds(bundle, authored_nodes, actual_nodes, paints, spec["left"],
                                lambda ok, code, ident, **d:
                                check(ok, code, spec["id"], componentId=ident, **d))
        right = _endpoint_bounds(bundle, authored_nodes, actual_nodes, paints, spec["right"],
                                 lambda ok, code, ident, **d:
                                 check(ok, code, spec["id"], componentId=ident, **d))
        if left is None or right is None:
            continue
        one, two = left["bounds"], right["bounds"]
        if spec["alignment"] == "left":
            delta = abs(one["x"] - two["x"])
        elif spec["alignment"] == "right":
            delta = abs((one["x"] + one["width"]) - (two["x"] + two["width"]))
        else:
            delta = abs((one["x"] + one["width"] / 2) -
                        (two["x"] + two["width"] / 2))
        check(delta <= spec["tolerance"], "RELATION_HORIZONTAL_ALIGNMENT", spec["id"],
              alignment=spec["alignment"], actualDelta=delta,
              tolerance=spec["tolerance"], left=left, right=right,
              evidence=spec["evidence"])

    for spec in plan["iconInsets"]:
        icon = _visual_bounds(bundle, authored_nodes, actual_nodes, paints, spec["icon"],
                              lambda ok, code, ident, **d:
                              check(ok, code, spec["id"], componentId=ident, **d))
        owner = _owner_bounds(actual_nodes, paints, spec["owner"],
                              lambda ok, code, ident, **d:
                              check(ok, code, spec["id"], componentId=ident, **d))
        if icon is None or owner is None:
            continue
        one, two = icon["bounds"], owner
        insets = {"left": one["x"] - two["x"],
                  "top": one["y"] - two["y"],
                  "right": two["x"] + two["width"] - one["x"] - one["width"],
                  "bottom": two["y"] + two["height"] - one["y"] - one["height"]}
        minimum = spec["minimumInsets"]
        check(all(insets[key] >= minimum[key] for key in insets), "RELATION_ICON_INSETS",
              spec["id"], actualInsets=insets, minimumInsets=minimum, icon=icon,
              ownerBounds=owner, evidence=spec["evidence"])

    return {"kind": CHECK_KIND, "status": "failed" if issues else "passed",
            "issues": issues, "checks": checks, "human_visual_acceptance": False,
            "coverage": "explicit_relations_against_actual_runtime_inspection",
            "relationCount": len(checks)}


__all__ = ["check_visual_relations"]
