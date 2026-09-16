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


KIND = "ui_native_delivery_input_v1"
VERSION = "1.0"

# Container is a structural document root/parent.  These are the component
# types for which this bounded producer has an explicit native delivery route.
SUPPORTED_TYPES = {
    "Container", "Panel", "Text", "Image", "Button", "Tabs", "Input",
    "Select", "List", "CheckBox",
}
STATEFUL_TYPES = {"Panel", "Button", "Tabs", "Input", "Select", "List", "CheckBox"}

_NATIVE_FIELDS = {
    "kind", "version", "referenceSha256", "document", "materials",
    "boardPolicies", "appearance", "capabilities", "referenceState",
    "acceptanceScope", "referenceMapping", "layoutSpacing",
    "layoutRequirements", "visualObservations", "stateEvidence",
}

_REQUIRED_APPEARANCE_ROLES = {
    "Image": {"image"},
    "Container": {"background"},
    "Panel": {"background"},
    "Button": {"background"},
    "Tabs": {"tab", "active-tab"},
    "Input": {"background"},
    "Select": {"background", "indicator", "popup"},
    "List": {"background", "row", "selected-row"},
    "CheckBox": {"box", "mark"},
}


def _finite(value: object) -> bool:
    return type(value) in (int, float) and math.isfinite(value)


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
                         materials: dict[str, dict], source_size: list[int]) -> None:
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
        require(_REQUIRED_APPEARANCE_ROLES.get(kind, set()) <= roles,
                "NATIVE_APPEARANCE_REQUIRED_ROLE")
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
    require(isinstance(request, dict) and set(request) == _NATIVE_FIELDS,
            "NATIVE_INPUT_FIELDS")
    require(request["kind"] == KIND and request["version"] == VERSION,
            "NATIVE_INPUT_VERSION")
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
    _validate_appearance(request["appearance"], document, by_id, materials, proof["size"])
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
    for spec in visual['texts']:
        require(isinstance(spec,dict) and spec.get('componentId') in by_id,'NATIVE_TEXT_OBSERVATION_ID')
        if 'geometry' not in spec:continue
        g=spec['geometry']
        require(isinstance(g,dict) and set(g)=={'version','referenceBounds','maxCenterOffset','widthRatio','evidence'} and g['version']=='1.0' and isinstance(g['evidence'],str) and g['evidence'].strip(),'TEXT_GEOMETRY_SCHEMA')
        ref=g['referenceBounds'];off=g['maxCenterOffset'];ratio=g['widthRatio']
        require(isinstance(ref,list) and len(ref)==4 and isinstance(off,list) and len(off)==2 and isinstance(ratio,list) and len(ratio)==2,'TEXT_GEOMETRY_VALUES')
        require(all(_finite(v) for v in ref+off+ratio) and min(ref[2:])>0 and min(off)>=0 and 0<ratio[0]<=ratio[1],'TEXT_GEOMETRY_VALUES')

    groups: dict[str, list[dict]] = {}
    for row in materials.values():
        if is_shared(row):
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
    assets: list[dict] = []
    placed: list[dict] = []
    catalog: list[dict] = []
    background = next(row for row in materials.values()
                      if row["componentId"] == "background" or row["layerId"] == "background")
    bg_marker = f"native-layer-binding-v1:{appearance_digest}:{background['layerId']}"
    assets.append({"id": "background", "role": "background", "route": "generated_completion",
                   "source_region": [0, 0, *canvas], "output_size": canvas,
                   "output_mode": "opaque_canvas",
                   "prompt": f"{bg_marker} Complete the reference scene with all UI materials removed; preserve only the environmental background.",
                   "source_asset": None})
    placed.append({"id": "background", "asset": "background", "xy": [0, 0]})
    catalog.append({"componentId": background["componentId"], "componentType": "Image",
                    "layerId": background["layerId"], "rect": background["rect"],
                    "generationAsset": "background", "board": None})

    for layer, row in materials.items():
        if layer == background["layerId"]:
            continue
        rect = row["rect"]
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
                       "prompt": f"{marker} {row['description']} Preserve the complete component shape and transparent holes; use solid #F808F8 only as the declared key backdrop. No text or labels.",
                       "source_asset": None})
        placed.append({"id": asset_id, "asset": asset_id, "xy": [rect[0], rect[1]]})

    for group, rows in groups.items():
        strategy = strategies[group]
        asset_id = f"board-{group}"
        parts = "; ".join(f"{row['layerId']} ({row['rect'][2]}x{row['rect'][3]}): {row['description']}" for row in rows)
        marker = f"component-family-board-v1:{strategy['digest']}:{group}"
        native_marker = f"native-layer-binding-v1:{appearance_digest}:{group}"
        board=strategy['boards'][0]
        if board['extraction_policy']['version'] in {'1.1', '1.2'}:
            native_marker += ' component-family-content-gap-v1.1'
        windows='; '.join(f"{slot['asset_id']}: {slot['search_window']}" for slot in board['slots'])
        assets.append({"id": asset_id, "role": "important_component", "route": "generated_isolation",
                       "source_region": [0, 0, *canvas], "output_size": canvas,
                       "output_mode": "keyed_component",
                       "prompt": f"{marker} {native_marker} Canvas {board['canvas']}, extraction {board['extraction_policy']['mode']}. Planned windows [left,top,right,bottom]: {windows}. Complete {group} board. Preserve declared order and full silhouettes with separated key-color gutters; for foreground-gap-row, windows guide placement and cuts follow actual empty gaps. {parts} Use uniform #F808F8 elsewhere; no text, labels, reordering or merged parts.",
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
    write_json(output / "acceptance-scope.json", request["acceptanceScope"])
    write_json(output / "reference-mapping.json", request["referenceMapping"])
    write_json(output / "layout-spacing.json", request["layoutSpacing"])
    write_json(output / "spacing-check.json", spacing_report)
    write_json(output / "layout-requirements.json", request["layoutRequirements"])
    write_json(output / "visual-observations.json", request["visualObservations"])
    write_json(output / "state-evidence.json", state_evidence)
    write_json(output / "appearance-plan.json", copy.deepcopy(request["appearance"]))
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
