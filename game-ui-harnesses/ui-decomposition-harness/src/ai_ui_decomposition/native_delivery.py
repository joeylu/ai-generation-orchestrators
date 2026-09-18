"""Compile an authenticated native UiDocument into the existing delivery DAG.

The native route owns no semantic inference and never contacts a provider.  It
only validates the caller supplied document, appearance layer bindings,
reference evidence and explicit material grouping before emitting the same
provider-neutral plan files as the legacy visual compiler.
"""
from __future__ import annotations

import copy
import math
import tempfile
from pathlib import Path

from .common import (digest, identifier, load_verified_image, require, sha256,
                     write_json)
from .component_boards import plan_boards
from .contract import validate
from .capabilities import audit
from .layout_spacing import require_export_spacing
from .reference_delivery import validate_mapping, validate_states
from .document_extensions import item_offsets, check_extensions
from .shared_materials import is_shared, validate_shared_sources
from . import planned_glyphs


KIND = "ui_native_delivery_input_v1"
VERSIONS = {"1.0", "1.1", "1.2"}

# Container is a structural document root/parent.  These are the component
# types for which this bounded producer has an explicit native delivery route.
SUPPORTED_TYPES = {
    "Container", "Panel", "Text", "Image", "Button", "Tabs", "Input",
    "Select", "ProgressBar", "ScrollView", "List", "CheckBox",
}
STATEFUL_TYPES = {"Panel", "Button", "Tabs", "Input", "Select", "ProgressBar",
                  "ScrollView", "List", "CheckBox"}

_NATIVE_FIELDS = {
    "kind", "version", "referenceSha256", "document", "materials",
    "boardPolicies", "appearance", "capabilities", "referenceState",
    "acceptanceScope", "referenceMapping", "layoutSpacing",
    "layoutRequirements", "visualObservations", "stateEvidence",
}
_NATIVE_FIELDS_V1_1 = _NATIVE_FIELDS | {"visibleGeometryRequirements"}
_NATIVE_FIELDS_V1_2 = _NATIVE_FIELDS | {"derivedGlyphs"}
_NATIVE_FIELDS_V1_2_VISIBLE = _NATIVE_FIELDS_V1_2 | {"visibleGeometryRequirements"}
VISIBLE_GEOMETRY_MARKER = "native-visible-geometry-requirements-v1:"

_REQUIRED_APPEARANCE_ROLES = {
    "Image": {"image"},
    "Container": {"background"},
    "Panel": {"background"},
    "Button": {"background"},
    "Tabs": {"tab", "active-tab"},
    "Input": {"background"},
    "Select": {"background", "indicator", "popup"},
    "ProgressBar": {"track", "fill"},
    "ScrollView": {"viewport", "scrollbar-track", "scrollbar-thumb"},
    "List": {"background", "row", "selected-row"},
    "CheckBox": {"box", "mark"},
}


def _list_background_mode(binding: dict) -> str:
    """Return the consumer-defined List background ownership mode.

    The absence of the field is deliberately mapped to the legacy own mode.
    This is a local structural check only; the official component CLI remains
    authoritative for the complete appearance binding.
    """
    states = binding.get("states", {})
    require(isinstance(states, dict), "NATIVE_APPEARANCE_STATES_REQUIRED")
    state = states.get("list", {})
    require(isinstance(state, dict), "NATIVE_LIST_BACKGROUND_POLICY")
    if "backgroundPolicy" not in state:
        return "own"
    policy = state["backgroundPolicy"]
    require(isinstance(policy, dict) and set(policy) == {"version", "mode"},
            "NATIVE_LIST_BACKGROUND_POLICY")
    require(policy["version"] == "1.0" and policy["mode"] in {"parent", "own"},
            "NATIVE_LIST_BACKGROUND_POLICY")
    return policy["mode"]


def _finite(value: object) -> bool:
    return type(value) in (int, float) and math.isfinite(value)


def _validate_world_rect(value: object, code: str, *, positive: bool) -> None:
    require(isinstance(value, dict) and set(value) == {"x", "y", "width", "height"}, code)
    require(all(_finite(value[key]) for key in ("x", "y", "width", "height")), code)
    require(value["width"] > 0 and value["height"] > 0 if positive else
            value["width"] >= 0 and value["height"] >= 0, code)


def validate_visible_geometry_requirements(request: dict,
                                           material_ids: set[str]) -> list[dict] | None:
    """Validate native 1.1 declarations without inventing image evidence.

    Source digests and source-pixel bounds are intentionally absent here: the
    materialized-handoff producer fills those only from verified output PNGs.
    """
    version = request.get("version")
    if version == "1.0":
        return None
    require(version in {"1.1", "1.2"}, "NATIVE_INPUT_VERSION")
    if "visibleGeometryRequirements" not in request:
        return None
    rows = request["visibleGeometryRequirements"]
    require(isinstance(rows, list) and len(rows) <= 128,
            "NATIVE_VISIBLE_GEOMETRY_REQUIREMENTS")
    seen_materials: set[str] = set()
    for row in rows:
        require(isinstance(row, dict) and set(row) == {
            "materialId", "alphaThreshold", "minimumOccupancy", "reservedRects",
            "textWorldRects", "imageWorldRect",
        }, "NATIVE_VISIBLE_GEOMETRY_FIELDS")
        material_id = row["materialId"]
        identifier(material_id)
        require(material_id in material_ids, "NATIVE_VISIBLE_GEOMETRY_MATERIAL_MISSING")
        require(material_id not in seen_materials, "NATIVE_VISIBLE_GEOMETRY_MATERIAL_DUPLICATE")
        seen_materials.add(material_id)
        threshold = row["alphaThreshold"]
        require(type(threshold) is int and 1 <= threshold <= 255,
                "NATIVE_VISIBLE_GEOMETRY_ALPHA_THRESHOLD")
        minimum = row["minimumOccupancy"]
        require(isinstance(minimum, dict) and set(minimum) <= {"width", "height"} and minimum,
                "NATIVE_VISIBLE_GEOMETRY_MINIMUM_OCCUPANCY")
        for axis, value in minimum.items():
            require(_finite(value) and 0 <= value <= 1,
                    "NATIVE_VISIBLE_GEOMETRY_MINIMUM_OCCUPANCY")
        reserved, texts, image_world = row["reservedRects"], row["textWorldRects"], row["imageWorldRect"]
        require(isinstance(reserved, list) and isinstance(texts, list),
                "NATIVE_VISIBLE_GEOMETRY_RELATIONS")
        if image_world is not None:
            _validate_world_rect(image_world, "NATIVE_VISIBLE_GEOMETRY_IMAGE_WORLD_RECT", positive=True)
        if reserved:
            require(image_world is not None and texts,
                    "NATIVE_VISIBLE_GEOMETRY_RELATIONS")
        reserved_ids: set[str] = set()
        for item in reserved:
            require(isinstance(item, dict) and set(item) == {"id", "rect"},
                    "NATIVE_VISIBLE_GEOMETRY_RESERVED_RECT")
            identifier(item["id"])
            require(item["id"] not in reserved_ids,
                    "NATIVE_VISIBLE_GEOMETRY_RESERVED_RECT")
            reserved_ids.add(item["id"])
            rect = item["rect"]
            require(isinstance(rect, list) and len(rect) == 4 and
                    all(type(value) is int for value in rect) and
                    rect[0] >= 0 and rect[1] >= 0 and rect[2] > 0 and rect[3] > 0,
                    "NATIVE_VISIBLE_GEOMETRY_RESERVED_RECT")
        text_ids: set[str] = set()
        for item in texts:
            require(isinstance(item, dict) and set(item) == {"id", "rect"},
                    "NATIVE_VISIBLE_GEOMETRY_TEXT_RECT")
            identifier(item["id"])
            require(item["id"] not in text_ids,
                    "NATIVE_VISIBLE_GEOMETRY_TEXT_RECT")
            text_ids.add(item["id"])
            _validate_world_rect(item["rect"], "NATIVE_VISIBLE_GEOMETRY_TEXT_RECT", positive=True)
    return copy.deepcopy(rows)


def _walk(node: dict):
    yield node
    for child in node.get("children", []):
        yield from _walk(child)


def _global_rects(document: dict) -> dict[str, list[float]]:
    result: dict[str, list[float]] = {}

    def visit(node: dict, parent_x: float = 0, parent_y: float = 0) -> None:
        layout = node["layout"]
        x = parent_x + layout["x"]
        y = parent_y + layout["y"]
        result[node["id"]] = [x, y, layout["width"], layout["height"]]
        offsets = item_offsets(node)
        for child in node.get("children", []):
            visit(child, x, y + offsets.get(child['id'], 0))

    visit(document["root"])
    return result


def _validate_document_shape(document: object) -> tuple[dict, dict[str, dict], dict[str, list[float]]]:
    require(isinstance(document, dict), "NATIVE_DOCUMENT_REQUIRED")
    # The official CLI remains authoritative for all UiDocument fields.  The
    # local checks here make unsupported native producer behavior fail before
    # any delivery output is materialized.
    require(document.get("schemaVersion") == "0.2", "NATIVE_DOCUMENT_VERSION")
    require(isinstance(document.get("canvas"), dict), "NATIVE_DOCUMENT_CANVAS")
    canvas = document["canvas"]
    require(set(canvas) == {"width", "height"}, "NATIVE_DOCUMENT_CANVAS")
    require(all(type(canvas[k]) is int and canvas[k] > 0 for k in ("width", "height")),
            "NATIVE_DOCUMENT_CANVAS")
    nodes = list(_walk(document.get("root", {})))
    by_id: dict[str, dict] = {}
    for node in nodes:
        require(isinstance(node, dict), "NATIVE_NODE_REQUIRED")
        ident = node.get("id")
        require(isinstance(ident, str) and ident not in by_id, "NATIVE_NODE_ID")
        # Plan IDs and portable layer/resource names use the existing bounded
        # identifier policy; rejecting here prevents path ambiguity later.
        identifier(ident)
        kind = node.get("type")
        require(kind in SUPPORTED_TYPES, "NATIVE_COMPONENT_UNSUPPORTED")
        by_id[ident] = node
    require(nodes and document.get("root", {}).get("type") == "Container",
            "NATIVE_ROOT_CONTAINER_REQUIRED")
    rects = _global_rects(document)
    width, height = canvas["width"], canvas["height"]
    for node in nodes:
        rect = rects[node["id"]]
        require(all(_finite(v) for v in rect), "NATIVE_NODE_LAYOUT")
        x, y, w, h = rect
        require(x >= 0 and y >= 0 and w > 0 and h > 0 and
                x + w <= width and y + h <= height, "NATIVE_NODE_LAYOUT_BOUNDS")
        require("appearance" not in node.get("props", {}), "NATIVE_APPEARANCE_IN_DOCUMENT")
    return document, by_id, rects


def _validate_cli_document(document: dict, component_root: Path) -> str:
    """Run the current official consumer validator against the exact input."""
    from .delivery_adapter import _cli

    with tempfile.TemporaryDirectory(prefix="ui-native-validate-") as directory:
        path = Path(directory) / "semantic-document.json"
        write_json(path, document)
        return _cli(component_root, ["validate", path])


def _validate_registration(registration: object, source_size: list[int], canvas: dict) -> None:
    require(isinstance(registration, dict) and
            set(registration) == {"sourceCanvas", "targetCanvas", "transform"},
            "NATIVE_APPEARANCE_REGISTRATION")
    for key, expected in (("sourceCanvas", source_size),
                          ("targetCanvas", [canvas["width"], canvas["height"]])):
        value = registration[key]
        require(isinstance(value, dict) and set(value) == {"width", "height"} and
                value["width"] == expected[0] and value["height"] == expected[1],
                "NATIVE_APPEARANCE_REGISTRATION")
    transform = registration["transform"]
    require(isinstance(transform, dict) and set(transform) == {"scale", "offset"},
            "NATIVE_APPEARANCE_REGISTRATION")
    require(_finite(transform["scale"]) and transform["scale"] > 0,
            "NATIVE_APPEARANCE_REGISTRATION")
    offset = transform["offset"]
    require(isinstance(offset, dict) and set(offset) == {"x", "y"} and
            _finite(offset["x"]) and _finite(offset["y"]),
            "NATIVE_APPEARANCE_REGISTRATION")


def _validate_target_layout(value: object, width: float, height: float,
                            code: str, *, extra: set[str] | None = None) -> None:
    """Validate a consumer target-component-local rectangle.

    Native input is compiled before any generated PNG exists.  This mirrors
    the consumer's coordinate, finite-value and containment checks while
    deliberately leaving source-pixel checks to the official importer.
    """
    keys = {"coordinateSpace", "x", "y", "width", "height"}
    if extra:
        keys |= extra
    require(isinstance(value, dict) and set(value) == keys, code)
    require(value["coordinateSpace"] == "target-component-local", code)
    require(all(_finite(value[key]) for key in ("x", "y", "width", "height")), code)
    require(value["width"] > 0 and value["height"] > 0, code)
    require(value["x"] >= 0 and value["y"] >= 0 and
            value["x"] + value["width"] <= width and
            value["y"] + value["height"] <= height, code)


def _validate_progress_state(binding: dict, node: dict) -> None:
    """Validate the exact native ProgressBar state vocabulary.

    The consumer accepts a complete full-range fill template and clips it at
    runtime.  It does not accept a provider-specific state image or an
    alternate fill direction in this route.
    """
    states = binding.get("states")
    require(isinstance(states, dict) and set(states) == {"progressBar"},
            "NATIVE_PROGRESS_STATE")
    state = states["progressBar"]
    require(isinstance(state, dict) and set(state) == {"sourceState", "fillClip"},
            "NATIVE_PROGRESS_STATE_FIELDS")
    require(state["sourceState"] == "full-range-template",
            "NATIVE_PROGRESS_FULL_RANGE_TEMPLATE")
    clip = state["fillClip"]
    require(isinstance(clip, dict) and set(clip) == {
        "coordinateSpace", "anchor", "direction", "x", "y", "width", "height",
    }, "NATIVE_PROGRESS_FILL_CLIP")
    require(clip["anchor"] == "top-left" and clip["direction"] == "left-to-right",
            "NATIVE_PROGRESS_FILL_CLIP")
    _validate_target_layout(clip, node["layout"]["width"], node["layout"]["height"],
                            "NATIVE_PROGRESS_FILL_CLIP", extra={"anchor", "direction"})


def _material_local_rect(layer_id: str, component_id: str, materials: dict[str, dict],
                         rects: dict[str, list[float]] | None) -> list[float]:
    rect = materials[layer_id]["rect"]
    if rects is None:
        return list(rect)
    origin = rects[component_id]
    return [rect[0] - origin[0], rect[1] - origin[1], rect[2], rect[3]]


def _validate_scroll_state(binding: dict, node: dict, materials: dict[str, dict],
                           rects: dict[str, list[float]] | None) -> None:
    """Validate the consumer's vertical ScrollView appearance contract.

    Track/thumb source dimensions are represented by the authored material
    rectangles at this stage.  The producer still rechecks decoded PNG sizes
    and all resource fingerprints during handoff/import.
    """
    props = node["props"]
    require(props.get("scrollX") == 0 and
            props.get("contentWidth") <= node["layout"]["width"],
            "NATIVE_SCROLL_VERTICAL_ONLY")
    if props.get("contentHeight") <= node["layout"]["height"]:
        require(props.get("scrollbarVisibility") in {"auto", "always"},
                "NATIVE_SCROLL_VISIBILITY_REQUIRED")

    states = binding.get("states")
    require(isinstance(states, dict) and set(states) == {"scrollView"},
            "NATIVE_SCROLL_STATE")
    state = states["scrollView"]
    require(isinstance(state, dict) and set(state) <= {
        "thumbPositions", "scrollbarInsets", "scrollbarThumbSlices",
    } and "thumbPositions" in state, "NATIVE_SCROLL_STATE_FIELDS")
    positions = state["thumbPositions"]
    require(isinstance(positions, dict) and set(positions) == {
        "coordinateSpace", "anchor", "min", "max",
    }, "NATIVE_SCROLL_THUMB_POSITIONS")
    require(positions["coordinateSpace"] == "target-component-local" and
            positions["anchor"] == "top-left", "NATIVE_SCROLL_THUMB_POSITIONS")
    minimum, maximum = positions["min"], positions["max"]
    require(isinstance(minimum, dict) and set(minimum) == {"x", "y"} and
            isinstance(maximum, dict) and set(maximum) == {"x", "y"} and
            all(_finite(point[key]) for point in (minimum, maximum) for key in ("x", "y")),
            "NATIVE_SCROLL_THUMB_POSITIONS")
    require(minimum["x"] == maximum["x"] and maximum["y"] > minimum["y"],
            "NATIVE_SCROLL_AXIS")

    track_layer = next(part["layerId"] for part in binding["parts"]
                       if part["role"] == "scrollbar-track")
    thumb_layer = next(part["layerId"] for part in binding["parts"]
                       if part["role"] == "scrollbar-thumb")
    track = _material_local_rect(track_layer, node["id"], materials, rects)
    thumb = materials[thumb_layer]["rect"]
    require(track[2] > 0 and track[3] > 0 and thumb[2] > 0 and thumb[3] > 0,
            "NATIVE_SCROLL_GEOMETRY")
    for point in (minimum, maximum):
        require(point["x"] >= track[0] and
                point["x"] + thumb[2] <= track[0] + track[2] and
                point["y"] >= track[1] and
                point["y"] + thumb[3] <= track[1] + track[3],
                "NATIVE_SCROLL_THUMB_BOUNDS")

    if "scrollbarInsets" in state:
        from .scrollbar_insets import validate_insets
        validate_insets(state["scrollbarInsets"], track[3], thumb[3])
    if "scrollbarThumbSlices" in state:
        from .scrollbar_thumb_slices import validate_thumb_slices
        validate_thumb_slices(state["scrollbarThumbSlices"], thumb[3],
                              "scrollbarInsets" in state)


def _layer_refs(value: object, refs: list[str]) -> None:
    if isinstance(value, dict):
        for key, child in value.items():
            if key == "layerId" or key.endswith("LayerId"):
                require(isinstance(child, str), "NATIVE_LAYER_REFERENCE")
                refs.append(child)
            elif key == "layerIds":
                require(isinstance(child, list) and all(isinstance(v, str) for v in child),
                        "NATIVE_LAYER_REFERENCE")
                refs.extend(child)
            else:
                _layer_refs(child, refs)
    elif isinstance(value, list):
        for child in value:
            _layer_refs(child, refs)


def _validate_appearance(appearance: object, document: dict, by_id: dict[str, dict],
                         materials: dict[str, dict], source_size: list[int],
                         rects: dict[str, list[float]] | None = None) -> None:
    require(isinstance(appearance, dict) and set(appearance) == {"registration", "bindings"},
            "NATIVE_APPEARANCE_SCHEMA")
    _validate_registration(appearance["registration"], source_size, document["canvas"])
    bindings = appearance["bindings"]
    require(isinstance(bindings, list) and bindings, "NATIVE_APPEARANCE_BINDINGS")
    seen_components: set[str] = set()
    bound_layers: set[str] = set()
    for binding in bindings:
        require(isinstance(binding, dict) and
                set(binding) <= {"componentId", "componentType", "parts", "states"} and
                {"componentId", "componentType", "parts"} <= set(binding),
                "NATIVE_APPEARANCE_BINDING")
        cid, kind = binding["componentId"], binding["componentType"]
        require(isinstance(cid, str) and cid in by_id and cid not in seen_components,
                "NATIVE_APPEARANCE_COMPONENT")
        require(kind == by_id[cid]["type"] and kind in SUPPORTED_TYPES,
                "NATIVE_APPEARANCE_COMPONENT_TYPE")
        seen_components.add(cid)
        parts = binding["parts"]
        require(isinstance(parts, list) and parts, "NATIVE_APPEARANCE_PARTS")
        roles: set[str] = set()
        for part in parts:
            require(isinstance(part, dict) and
                    set(part) <= {"role", "layerId", "optionId", "itemId", "tabId"} and
                    {"role", "layerId"} <= set(part), "NATIVE_APPEARANCE_PART")
            role, layer = part["role"], part["layerId"]
            require(isinstance(role, str) and isinstance(layer, str), "NATIVE_APPEARANCE_PART")
            identifier(layer)
            require(layer in materials, "NATIVE_LAYER_UNKNOWN")
            require(materials[layer]["componentId"] == cid and
                    materials[layer]["componentType"] == kind, "NATIVE_LAYER_OWNER_MISMATCH")
            bound_layers.add(layer)
            roles.add(role)
        required_roles = _REQUIRED_APPEARANCE_ROLES.get(kind, set())
        if kind == "List":
            # list-background-v1 is the sole producer/consumer contract for
            # this choice. Parent owns only row paint; own and legacy retain
            # the independent List background layer.
            mode = _list_background_mode(binding)
            required_roles = {"row", "selected-row"} if mode == "parent" else required_roles
            require(roles == required_roles if mode == "parent" else required_roles <= roles,
                    "NATIVE_LIST_BACKGROUND_POLICY")
        else:
            require(required_roles <= roles, "NATIVE_APPEARANCE_REQUIRED_ROLE")
        if kind in STATEFUL_TYPES:
            require("states" in binding and isinstance(binding["states"], dict),
                    "NATIVE_APPEARANCE_STATES_REQUIRED")
        nested: list[str] = []
        _layer_refs(binding.get("states", {}), nested)
        for layer in nested:
            require(layer in materials, "NATIVE_LAYER_UNKNOWN")
            require(materials[layer]["componentId"] == cid and
                    materials[layer]["componentType"] == kind, "NATIVE_LAYER_OWNER_MISMATCH")
            bound_layers.add(layer)
        if kind == "ProgressBar":
            _validate_progress_state(binding, by_id[cid])
        elif kind == "ScrollView":
            _validate_scroll_state(binding, by_id[cid], materials, rects)
    # Every material is an explicit layer binding; there is no implicit art
    # assignment based on component names or order.
    require(bound_layers == set(materials), "NATIVE_APPEARANCE_LAYER_COVERAGE")
    require({cid for cid,node in by_id.items() if node['type'] in STATEFUL_TYPES|{'Image'}} <= seen_components,
            'NATIVE_APPEARANCE_COMPONENT_COVERAGE')


def _validate_materials(rows: object, document: dict, by_id: dict[str, dict],
                        rects: dict[str, list[float]]) -> dict[str, dict]:
    require(isinstance(rows, list) and rows, "NATIVE_MATERIALS_REQUIRED")
    result: dict[str, dict] = {}
    component_types = {node["id"]: node["type"] for node in by_id.values()}
    canvas = [document["canvas"]["width"], document["canvas"]["height"]]
    for row in rows:
        require(isinstance(row, dict) and
                {"layerId", "componentId", "rect", "description", "groupId"} <= set(row) <=
                {"layerId", "componentId", "rect", "description", "groupId", "sharedSource"},
                "NATIVE_MATERIAL_FIELDS")
        layer, cid, rect, group = row["layerId"], row["componentId"], row["rect"], row["groupId"]
        identifier(layer)
        require(layer not in result, "NATIVE_MATERIAL_DUPLICATE")
        require(isinstance(cid, str) and cid in component_types, "NATIVE_MATERIAL_COMPONENT")
        require(component_types[cid] not in {"Text","Container"}, "NATIVE_STRUCTURAL_MATERIAL_UNSUPPORTED")
        require(isinstance(rect, list) and len(rect) == 4 and all(type(v) is int for v in rect),
                "NATIVE_MATERIAL_RECT")
        x, y, w, h = rect
        require(w > 0 and h > 0 and x >= 0 and y >= 0 and x + w <= canvas[0] and y + h <= canvas[1],
                "NATIVE_MATERIAL_RECT_BOUNDS")
        require(isinstance(row["description"], str) and 1 <= len(row["description"]) <= 1600 and
                row["description"].strip(), "NATIVE_MATERIAL_DESCRIPTION")
        require(group is None or (isinstance(group, str) and bool(group.strip())),
                "NATIVE_MATERIAL_GROUP")
        if isinstance(group, str):
            identifier(group)
        normalized = {
            "componentId": cid, "componentType": component_types[cid], "layerId": layer,
            "rect": list(rect), "description": row["description"], "groupId": group,
        }
        if "sharedSource" in row:
            normalized["sharedSource"] = copy.deepcopy(row["sharedSource"])
        result[layer] = normalized
    # A material for a document Image is exported as layers/<componentId>.png;
    # require the source declaration to agree with _materialized_handoff.
    for cid, node in by_id.items():
        if node["type"] == "Image":
            matching = [row for row in result.values() if row["componentId"] == cid]
            require(len(matching)==1 and node["props"].get("source") == f"layers/{cid}.png",
                    "NATIVE_IMAGE_RESOURCE_BINDING")
            require(matching[0]['rect']==rects[cid], 'NATIVE_IMAGE_SOURCE_REGISTRATION')
    background = [row for row in result.values() if row["componentId"] == "background" or row["layerId"] == "background"]
    require(len(background) == 1, "NATIVE_BACKGROUND_REQUIRED")
    bg = background[0]
    require(bg['componentId']=='background' and bg['layerId']=='background' and bg["componentType"] == "Image" and bg["groupId"] is None and
            bg["rect"] == [0, 0, *canvas], "NATIVE_BACKGROUND_GEOMETRY")
    bg_node = by_id.get(bg["componentId"])
    require(bg_node is not None and bg_node["type"] == "Image" and
            bg_node["props"].get("source") == f"layers/{bg['componentId']}.png" and
            [int(v) for v in rects[bg["componentId"]]] == bg["rect"],
            "NATIVE_BACKGROUND_RESOURCE")
    return result


def _validate_state_evidence(value: object) -> dict:
    require(isinstance(value, dict) and set(value) <= {"kind", "components", "handoffSha256", "reference"} and
            {"kind", "components"} <= set(value) and value["kind"] == "ui_state_evidence_v1" and
            isinstance(value["components"], dict), "NATIVE_STATE_EVIDENCE")
    # handoffSha256/reference describe an already built archive and are not
    # valid in the data-only build-plan snapshot; handoff_build adds fresh ones.
    return {"kind": value["kind"], "components": copy.deepcopy(value["components"])}


def _board_strategy(group: str, rows: list[dict], policy: dict) -> dict:
    edge=16*math.ceil(max(sum(row['rect'][2]+16 for row in rows)+16,max(row['rect'][3] for row in rows)+16)/16)
    require(edge<=4096,'NATIVE_BOARD_CANVAS_LIMIT')
    observations = {
        "kind": "ai_ui_material_observations_v2",
        "strategy": "component-family-board-v1",
        "packing_canvas": [edge,edge],
        "extraction_policy": copy.deepcopy(policy),
        "assets": [
            {"id": row["layerId"], "component_type": row["componentType"],
             "component_group": group, "target_size": row["rect"][2:],
             "source_reusable": False, "source_evidence": ""}
            for row in rows
        ],
    }
    return plan_boards(observations)


def compile_native_delivery(reference, request, output, component_root, maximum_calls):
    """Compile a native UiDocument into the established offline DAG plan."""
    require(isinstance(request, dict), "NATIVE_INPUT_FIELDS")
    require(request.get("kind") == KIND and request.get("version") in VERSIONS,
            "NATIVE_INPUT_VERSION")
    if request["version"] == "1.0":
        require(set(request) == _NATIVE_FIELDS, "NATIVE_INPUT_FIELDS")
    elif request["version"] == "1.1":
        require(set(request) in (_NATIVE_FIELDS, _NATIVE_FIELDS_V1_1),
                "NATIVE_INPUT_FIELDS")
    else:
        require(set(request) in (_NATIVE_FIELDS_V1_2, _NATIVE_FIELDS_V1_2_VISIBLE),
                "NATIVE_INPUT_FIELDS")
    require(type(maximum_calls) is int and maximum_calls >= 0, "NATIVE_MAXIMUM_CALLS")
    source = Path(reference)
    picture, proof = load_verified_image(source)
    from PIL import Image
    with Image.open(source) as original:
        require(original.getexif().get(274,1)==1,'NATIVE_REFERENCE_ORIENTATION_UNSUPPORTED')
    require(request["referenceSha256"] == proof["sha256"], "NATIVE_REFERENCE_BINDING")
    document, by_id, rects = _validate_document_shape(request["document"])
    cli_preflight=_validate_cli_document(document, Path(component_root))
    extension_check=check_extensions(document, request['capabilities'])
    materials = _validate_materials(request["materials"], document, by_id, rects)
    visible_geometry_requirements = validate_visible_geometry_requirements(
        request, set(materials))
    _validate_appearance(request["appearance"], document, by_id, materials, proof["size"], rects)
    if request["version"] == "1.2" and request["derivedGlyphs"]:
        require(source.suffix.lower() == ".png", "NATIVE_GLYPH_REFERENCE_PNG_REQUIRED")
    glyph_envelope = planned_glyphs.compile_recipes(
        request, materials, document, request["appearance"], picture,
        proof["sha256"], proof["size"])
    validate_shared_sources(materials, by_id, rects, request["appearance"])
    validate_mapping(request["referenceMapping"], proof["size"], document["canvas"])
    mapping=request['referenceMapping']
    require(proof['size']==[document['canvas']['width'],document['canvas']['height']] and
            mapping['crop']==[0,0,*proof['size']] and mapping['rotationDegrees']==0 and
            not mapping['flipX'] and not mapping['flipY'] and mapping['scale']==[1,1] and mapping['offset']==[0,0],
            'NATIVE_IDENTITY_MAPPING_REQUIRED')
    require(request['appearance']['registration']['transform']==dict(scale=1,offset=dict(x=0,y=0)),
            'NATIVE_IDENTITY_REGISTRATION_REQUIRED')
    validate_states(request["referenceState"], request["acceptanceScope"], document)
    compiled_acceptance_scope = planned_glyphs.acceptance_scope(
        request["acceptanceScope"], glyph_envelope)
    if glyph_envelope is not None:
        validate_states(request["referenceState"], compiled_acceptance_scope, document)
    spacing_report = require_export_spacing(document, request["layoutSpacing"])
    state_evidence = _validate_state_evidence(request["stateEvidence"])
    require(isinstance(request["layoutRequirements"], dict) and
            isinstance(request["visualObservations"], dict), "NATIVE_EVIDENCE_FIELDS")
    from .stateful import state_names
    required_states={cid for cid,n in by_id.items() if n['type'] in STATEFUL_TYPES-{'Panel'}}
    require(set(state_evidence['components'])==required_states,'NATIVE_STATE_EVIDENCE_COVERAGE')
    for cid in required_states:
        value=state_evidence['components'][cid]
        require(isinstance(value,dict) and isinstance(value.get('states'),dict) and set(value['states'])==set(state_names(by_id[cid])),
                'NATIVE_STATE_MATRIX_COVERAGE')
    visual=request['visualObservations'];required_text=visual.get('requiredTextGeometryIds')
    require(visual.get('kind')=='ui_visual_observations_v1' and isinstance(visual.get('texts'),list) and
            isinstance(required_text,list) and all(isinstance(cid,str) and cid in by_id for cid in required_text) and len(required_text)==len(set(required_text)),
            'NATIVE_TEXT_GEOMETRY_REQUIRED')
    for cid in required_text:
        specs=[s for s in visual['texts'] if s.get('componentId')==cid and 'geometry' in s]
        require(bool(specs),'NATIVE_TEXT_GEOMETRY_MISSING')
    from .layout_gate import require_planning_coverage
    require_planning_coverage(document,request['layoutRequirements'],visual)
    for spec in visual['texts']:
        require(isinstance(spec,dict) and spec.get('componentId') in by_id,'NATIVE_TEXT_OBSERVATION_ID')
        if 'geometry' not in spec:continue
        g=spec['geometry']
        require(isinstance(g,dict) and set(g)=={'version','referenceBounds','maxCenterOffset','widthRatio','evidence'} and g['version']=='1.0' and isinstance(g['evidence'],str) and g['evidence'].strip(),'TEXT_GEOMETRY_SCHEMA')
        ref=g['referenceBounds'];off=g['maxCenterOffset'];ratio=g['widthRatio']
        require(isinstance(ref,list) and len(ref)==4 and isinstance(off,list) and len(off)==2 and isinstance(ratio,list) and len(ratio)==2,'TEXT_GEOMETRY_VALUES')
        require(all(_finite(v) for v in ref+off+ratio) and min(ref[2:])>0 and min(off)>=0 and 0<ratio[0]<=ratio[1],'TEXT_GEOMETRY_VALUES')

    derived_target_ids = {recipe["targetLayerId"]
                          for recipe in (glyph_envelope or {}).get("recipes", [])}
    groups: dict[str, list[dict]] = {}
    for row in materials.values():
        if is_shared(row) or row["layerId"] in derived_target_ids:
            continue
        group = row["groupId"]
        if group is not None:
            groups.setdefault(group, []).append(row)
    for group, rows in groups.items():
        require(len({row["componentType"] for row in rows}) == 1,
                "NATIVE_BOARD_MIXED_COMPONENT_TYPE")
    policies = request["boardPolicies"]
    require(isinstance(policies, dict) and set(policies) == set(groups),
            "NATIVE_BOARD_POLICY_REQUIRED")

    # Build strategies before prompts so every generated request is bound to
    # an immutable strategy digest and its exact old layer binding.
    strategies: dict[str, dict] = {}
    for group, rows in groups.items():
        strategies[group] = _board_strategy(group, rows, policies[group])

    canvas = [document["canvas"]["width"], document["canvas"]["height"]]
    appearance_digest = digest(request["appearance"])
    geometry_marker = (VISIBLE_GEOMETRY_MARKER + digest(visible_geometry_requirements) + " "
                       if visible_geometry_requirements is not None else "")
    glyph_marker = planned_glyphs.marker(glyph_envelope)
    from .material_ownership import compile_ownership, MARKER as OWNERSHIP_MARKER
    ownership = compile_ownership(request, materials)
    ownership_text = {r['layerId']:r['instruction'] for r in ownership['layers']}
    plan_markers = glyph_marker + geometry_marker + OWNERSHIP_MARKER + ownership['digest'] + ' '
    assets: list[dict] = []
    placed: list[dict] = []
    catalog: list[dict] = []
    background = next(row for row in materials.values()
                      if row["componentId"] == "background" or row["layerId"] == "background")
    bg_marker = f"native-layer-binding-v1:{appearance_digest}:{background['layerId']}"
    assets.append({"id": "background", "role": "background", "route": "generated_completion",
                   "source_region": [0, 0, *canvas], "output_size": canvas,
                   "output_mode": "opaque_canvas",
                   "prompt": f"{plan_markers}{bg_marker} Complete the reference scene with all UI materials removed; preserve only the environmental background. Authored environmental scope: {background['description']}",
                   "source_asset": None})
    placed.append({"id": "background", "asset": "background", "xy": [0, 0]})
    catalog.append({"componentId": background["componentId"], "componentType": "Image",
                    "layerId": background["layerId"], "rect": background["rect"],
                    "generationAsset": "background", "board": None})

    derived_targets = {recipe["targetLayerId"]: recipe
                       for recipe in (glyph_envelope or {}).get("recipes", [])}
    for layer, row in materials.items():
        if layer == background["layerId"]:
            continue
        rect = row["rect"]
        if layer in derived_targets:
            recipe = derived_targets[layer]
            catalog.append({"componentId": row["componentId"],
                            "componentType": row["componentType"],
                            "layerId": layer, "rect": rect,
                            "generationAsset": None, "board": None,
                            "derivedGlyph": {
                                "canonicalLayerId": recipe["canonicalLayerId"],
                                "recipeDigest": glyph_envelope["digest"],
                            }})
            continue
        generated = materials[row["sharedSource"]["sourceLayerId"]] if is_shared(row) else row
        group = generated["groupId"]
        asset_id = f"board-{group}" if group is not None else generated["layerId"]
        catalog_row = {"componentId": row["componentId"], "componentType": row["componentType"],
                       "layerId": layer, "rect": rect, "generationAsset": asset_id,
                       "board": group}
        if is_shared(row):
            catalog_row["sharedSource"] = copy.deepcopy(row["sharedSource"])
        catalog.append(catalog_row)
        if is_shared(row):
            continue
        if group is not None:
            continue
        marker = f"native-layer-binding-v1:{appearance_digest}:{layer}"
        assets.append({"id": asset_id, "role": "important_component", "route": "generated_isolation",
                       "source_region": [rect[0], rect[1], rect[0] + rect[2], rect[1] + rect[3]],
                       "output_size": rect[2:], "output_mode": "keyed_component",
                       "prompt": f"{plan_markers}{marker} {row['description']} {ownership_text[layer]} Preserve the complete component shape and transparent holes; use solid #F808F8 only as the declared key backdrop. No text or labels.",
                       "source_asset": None})
        placed.append({"id": asset_id, "asset": asset_id, "xy": [rect[0], rect[1]]})

    for group, rows in groups.items():
        strategy = strategies[group]
        asset_id = f"board-{group}"
        parts = "; ".join(f"{row['layerId']} ({row['rect'][2]}x{row['rect'][3]}): {row['description']} {ownership_text[row['layerId']]}" for row in rows)
        marker = f"component-family-board-v1:{strategy['digest']}:{group}"
        native_marker = f"native-layer-binding-v1:{appearance_digest}:{group}"
        board=strategy['boards'][0]
        if board['extraction_policy'].get('separation_basis') == 'mixed-height':
            ratio = board['extraction_policy']['max_internal_gap_ratio']
            parts += (f'; External gutters between adjacent assets must be at least '
                      f'max(floor(max(left ink height,right ink height)*{ratio})+2, '
                      f'ceil(min(left ink height,right ink height)*{ratio}*4)) pixels. '
                      'This external clearance is separate from declared internal glyph gaps.')
        if board['extraction_policy']['version'] in {'1.3','1.4'}:
            parts += '; Explicit disconnected glyph structure: ' + '; '.join(
                f"{g['asset_id']}: {g['column_groups']} columns by {g['row_groups']} rows of disconnected strokes, internal gaps at most {g['max_internal_gap_ratio']} of glyph height"
                for g in board['extraction_policy']['disconnected_glyphs'])
            parts += ('; External glyph gutters must also exceed floor(max(each adjacent ink height '
                      'times its declared internal gap ratio))+1 pixels; undeclared assets use '
                      f"{board['extraction_policy']['max_internal_gap_ratio']} as their ratio.")
        if board['extraction_policy']['version'] in {'1.1', '1.2', '1.3', '1.4', '1.5'}:
            native_marker += ' component-family-content-gap-v1.1'
        windows='; '.join(f"{slot['asset_id']}: {slot['search_window']}" for slot in board['slots'])
        assets.append({"id": asset_id, "role": "important_component", "route": "generated_isolation",
                       "source_region": [0, 0, *canvas], "output_size": canvas,
                       "output_mode": "keyed_component",
                       "prompt": f"{plan_markers}{marker} {native_marker} Canvas {board['canvas']}, extraction {board['extraction_policy']['mode']}. Planned windows [left,top,right,bottom]: {windows}. Complete {group} board. Preserve declared order and full silhouettes with separated key-color gutters; for foreground-gap-row, windows guide placement and cuts follow actual empty gaps. {parts} Use uniform #F808F8 elsewhere; no text, labels, reordering or merged parts.",
                       "source_asset": None})
        placed.append({"id": asset_id, "asset": asset_id, "xy": [0, 0]})

    require(len(assets) <= maximum_calls, "NATIVE_GENERATION_BUDGET")
    require(len(assets) <= 128, "NATIVE_GENERATION_BUDGET")

    output = Path(output)
    require(not output.exists(), "OUTPUT_EXISTS")
    output.mkdir(parents=True)
    original = output / ("original" + source.suffix)
    original.parent.mkdir(parents=True, exist_ok=True)
    with source.open("rb") as reader, original.open("xb") as writer:
        writer.write(reader.read())
    require(sha256(original) == proof["sha256"], "NATIVE_REFERENCE_COPY_CHANGED")

    plan = {
        "kind": "ai_ui_decomposition_plan_v1", "id": "visual-delivery-native",
        "canvas": canvas, "source": {"path": original.name, "sha256": sha256(original), "size": canvas},
        "text_policy": "remove_ordinary_text_preserve_graphic_symbols",
        "granularity": "important_components_only", "delivery_policy": "unreviewed_draft",
        "assets": assets, "nodes": placed,
        "groups": [{"id": "native-components", "children": [node["id"] for node in placed]}],
        "document": {"name": "ui", "format": "png_zip"},
    }
    plan_check = validate(plan, source_base=output)
    write_json(output / "plan.json", plan)
    write_json(output / "plan-check.json", plan_check)
    write_json(output / "material-ownership.json", ownership)

    capability_request = {"kind": "ui-decomposition-capability-request", "version": "1.0",
                          "planDigest": digest(plan), "components": copy.deepcopy(request["capabilities"])}
    require(isinstance(capability_request["components"], list), "NATIVE_CAPABILITIES_REQUIRED")
    inventory = {node["id"]: node["type"] for node in _walk(document["root"])}
    declared = {row.get("id"): row.get("type") for row in capability_request["components"] if isinstance(row, dict)}
    require(set(declared) == set(inventory) and all(declared[k] == inventory[k] for k in inventory),
            "NATIVE_CAPABILITY_COVERAGE")
    capability_check = audit(capability_request)
    require(capability_check["status"] == "capability_supported", "NATIVE_CAPABILITY_UNSUPPORTED")
    write_json(output / "capabilities.json", capability_request)
    write_json(output / "capability-check.json", capability_check)

    write_json(output / "semantic-document.json", document)
    write_json(output / "document-extensions.json", extension_check)
    write_json(output / "response.json", request)
    write_json(output / "consumer-preflight.json",dict(exitCode=0,stdout=cli_preflight,scope='pure_document_no_materials'))
    write_json(output / "reference-state.json", request["referenceState"])
    write_json(output / "acceptance-scope.json", compiled_acceptance_scope)
    write_json(output / "reference-mapping.json", request["referenceMapping"])
    write_json(output / "layout-spacing.json", request["layoutSpacing"])
    write_json(output / "spacing-check.json", spacing_report)
    write_json(output / "layout-requirements.json", request["layoutRequirements"])
    write_json(output / "visual-observations.json", request["visualObservations"])
    write_json(output / "state-evidence.json", state_evidence)
    write_json(output / "appearance-plan.json", copy.deepcopy(request["appearance"]))
    planned_glyphs.write_compiled(output / "planned-glyphs.json", glyph_envelope)
    strategy_refs: dict[str, dict] = {}
    for group, strategy in strategies.items():
        filename = f"strategy-{group}.json"
        write_json(output / filename, strategy)
        strategy_refs[group] = {"path": filename, "digest": strategy["digest"]}
    write_json(output / "material-catalog.json", {"original": original.name, "parts": catalog,
                                                   "strategies": strategy_refs})
    return {"planDigest": digest(plan), "maximumCalls": len(assets),
            "componentCount": len(list(_walk(document["root"]))),
            "human_visual_acceptance": False}
