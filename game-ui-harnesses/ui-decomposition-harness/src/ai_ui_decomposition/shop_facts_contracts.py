"""Finalize shop-facts output against the native producer and consumer contracts."""
from __future__ import annotations

from copy import deepcopy

from .common import require


def _walk(node: dict):
    yield node
    for child in node.get("children", []):
        yield from _walk(child)


def _profile_names(node: dict) -> list[str]:
    """Return only producer capabilities registered for the actual node behavior."""
    kind, props = node["type"], node.get("props", {})
    base = ["base"]
    if kind == "Container":
        return base + (["nested-children"] if node.get("children") else [])
    if kind == "Panel":
        return base + ["optional-header"] + (["nested-children"] if node.get("children") else [])
    if kind == "Text":
        return base + (["ellipsis"] if props.get("overflow") == "ellipsis" else []) + ["system-font"]
    if kind == "Image":
        fit = props.get("fit")
        return base + ([fit] if fit in {"region", "contain", "cover", "stretch"} else [])
    if kind == "Button":
        return base + ["runtime-feedback", "per-line-text-layout"]
    if kind == "Tabs":
        return base + ["horizontal", "per-tab-icons", "native-items"]
    if kind == "Input":
        return base + ["text", "editing-v1.1"]
    if kind == "Select":
        # The shop Select binding always authors its field color and runtime
        # menu-highlight contract in appearance-plan.json.
        return base + ["equal-height-options", "field-text-color", "menu-highlights-v1"]
    if kind == "List":
        return base + ["equal-height-rows", "row-gap", "structured-image-text-child-acceptance",
                       "selected-label-text-binding", "component-linkages-v1", "item-contents-v1"]
    if kind == "CheckBox":
        return base + ["binary-mark"]
    return base


def _finalize_capabilities(request: dict) -> None:
    from .capabilities import PROFILES

    rows = []
    for node in _walk(request["document"]["root"]):
        profiles = _profile_names(node)
        if node['type']=='List' and any(b['componentId']==node['id'] and
                'backgroundPolicy' in b.get('states',{}).get('list',{}) for b in request['appearance']['bindings']):
            profiles.append('list-background-v1')
        allowed = PROFILES.get(node["type"], set())
        require(bool(profiles) and len(profiles) == len(set(profiles)) and set(profiles) <= allowed,
                "SHOP_FACTS_PROFILE_NOT_REGISTERED:" + node["id"])
        rows.append({"id": node["id"], "type": node["type"], "profiles": profiles})
    request["capabilities"] = rows


def _finalize_board_policies(request: dict) -> None:
    from .relative_board import validate_policy

    policies = request.get("boardPolicies")
    require(isinstance(policies, dict), "SHOP_FACTS_BOARD_POLICIES")
    normalized = {}
    for group, old in policies.items():
        require(isinstance(old, dict) and old.get("mode") == "foreground-gap-row",
                "SHOP_FACTS_BOARD_POLICIES")
        padding = old.get("target_padding")
        require(type(padding) is int and 1 <= padding <= 16, "SHOP_FACTS_BOARD_POLICIES")
        policy = {
            "version": "1.2",
            "mode": "foreground-gap-row",
            "target_padding": padding,
            "canvas_policy": "content-bounds",
            "max_internal_gap_ratio": 0.08,
            "max_part_aspect_error": 0.5,
            "separation_basis": "mixed-height",
        }
        validate_policy(policy)
        normalized[group] = policy
    request["boardPolicies"] = normalized


def _relation_rows(node: dict, binding: dict) -> dict:
    """Mirror the slot names consumed by stateful.compile_matrix."""
    kind = node["type"]
    note_shared = "The authored source facts declare one material reused across these runtime states."
    note_distinct = "The authored source facts require distinct normal and selected-state materials."
    if kind == "Tabs":
        tab_ids = [row["id"] for row in node["props"]["tabs"]]
        roles_by_tab: dict[str, set[str]] = {tab_id: set() for tab_id in tab_ids}
        for part in binding["parts"]:
            if part["role"] in {"tab", "active-tab", "icon", "active-icon"}:
                tab_id = part.get("tabId")
                require(tab_id in roles_by_tab, "SHOP_FACTS_STATE_BINDING")
                roles_by_tab[tab_id].add(part["role"])
        relations = {}
        for tab_id in tab_ids:
            roles = roles_by_tab[tab_id]
            require({"tab", "active-tab", "icon", "active-icon"} <= roles,
                    "SHOP_FACTS_STATE_BINDING")
            relations[f"background/{tab_id}"] = {"mode": "distinct", "note": note_distinct}
            relations[f"icon/{tab_id}"] = {"mode": "distinct", "note": note_distinct}
        return relations
    if kind in {"Button", "Input"}:
        return {"background": {"mode": "shared", "note": note_shared}}
    if kind == "CheckBox":
        return {role: {"mode": "shared", "note": note_shared} for role in ("box", "mark")}
    if kind == "Select":
        return {role: {"mode": "shared", "note": note_shared}
                for role in ("background", "indicator", "popup")}
    if kind == "List":
        background={} if binding.get('states',{}).get('list',{}).get('backgroundPolicy',{}).get('mode')=='parent' else {"background": {"mode": "shared", "note": note_shared}}
        return {**background, **{
            f"row/{item['id']}": {"mode": "distinct", "note": note_distinct}
            for item in node["props"]["items"]}}
    require(False, "SHOP_FACTS_STATE_COMPONENT_UNSUPPORTED:" + node["id"])
    return {}


def _finalize_state_evidence(request: dict) -> None:
    from .native_delivery import _global_rects, _walk as native_walk
    from .stateful import state_names

    document = request["document"]
    bindings = {row["componentId"]: row for row in request["appearance"]["bindings"]}
    world = _global_rects(document)
    components = {}
    stateful_types = {"Button", "Tabs", "Input", "Select", "List", "CheckBox"}
    for node in native_walk(document["root"]):
        kind = node["type"]
        if kind not in stateful_types:
            continue
        ident = node["id"]
        require(ident in bindings, "SHOP_FACTS_STATE_BINDING:" + ident)
        rect = world[ident]
        region = [rect[0], rect[1], rect[2], rect[3]]
        if kind == "Tabs":
            observed = node["props"].get("activeId")
        elif kind in {"Select", "List"}:
            observed = node["props"].get("selectedId")
        elif kind == "CheckBox":
            observed = "on" if node["props"].get("checked") else "off"
        elif kind == "Input":
            observed = "filled" if node["props"].get("value") else "empty"
        else:
            observed = "default"
        names = state_names(node)
        require(names and observed in names, "SHOP_FACTS_STATE_NAMES:" + ident)
        states = {
            name: {
                "basis": "observed" if name == observed else "contract-derived",
                "region": list(region),
                "note": ("The source facts identify this initial component state." if name == observed else
                         "This interaction state follows the authored component contract; no alternate screenshot is asserted."),
            }
            for name in names
        }
        components[ident] = {"states": states,
                             "relations": _relation_rows(node, bindings[ident])}
    request["stateEvidence"] = {"kind": "ui_state_evidence_v1", "components": components}


def _finalize_layout_spacing(facts: dict, request: dict) -> None:
    from .layout_spacing import require_export_spacing
    from .native_delivery import _global_rects, _walk as native_walk

    document = request["document"]
    nodes = {node["id"]: node for node in native_walk(document["root"])}
    require("shop-panel" in nodes and nodes["shop-panel"]["type"] == "Panel",
            "SHOP_FACTS_LAYOUT_PANEL_REQUIRED")
    world = _global_rects(document)
    panel_y = world["shop-panel"][1]
    panel_height = world["shop-panel"][3]
    footer = facts["footer"]
    action_ids = ["button-" + row["role"] for row in footer["buttons"]]
    require(set(action_ids) == {"button-back", "button-purchase"} and
            all(ident in nodes and nodes[ident]["type"] == "Button" for ident in action_ids),
            "SHOP_FACTS_FOOTER_ACTIONS")
    require(all(nodes[ident]["id"] in {child["id"] for child in nodes["shop-panel"].get("children", [])}
                for ident in action_ids), "SHOP_FACTS_FOOTER_ACTION_PARENT")
    boundary = footer["slogan"]["bounds"][1] - panel_y
    require(type(boundary) in (int, float) and 0 < boundary <= panel_height,
            "SHOP_FACTS_FOOTER_SAFE_BOUNDARY")
    gaps = [boundary - (world[ident][1] - panel_y + world[ident][3])
            for ident in action_ids]
    minimum_gap = min(gaps)
    require(minimum_gap >= 0, "SHOP_FACTS_SPACING_NO_SAFE_GAP")

    quantity_ids = ("quantity-minus", "quantity-plus")
    require(all(ident in nodes and nodes[ident]["type"] == "Button" for ident in quantity_ids),
            "SHOP_FACTS_QUANTITY_BUTTONS")
    request["layoutSpacing"] = {
        "version": "1.1",
        "panelFooters": [{
            "panelId": "shop-panel",
            "componentIds": action_ids,
            "innerBottom": boundary,
            "minimumGap": minimum_gap,
            "evidence": "The explicit slogan bounds define the footer action safe boundary; button gaps are measured from those source facts.",
        }],
        "scrollBottomSpaces": [],
        "nonFooterButtons": {
            ident: "This is an explicit quantity decrement/increment control, not a footer action button."
            for ident in quantity_ids
        },
    }
    require_export_spacing(document, request["layoutSpacing"])


def _validate_layout_requirements(request: dict) -> None:
    from .native_delivery import _walk as native_walk

    requirement = request.get("layoutRequirements")
    require(isinstance(requirement, dict) and set(requirement) == {
        "kind", "panels", "selects", "buttons", "textBackgrounds"} and
        requirement["kind"] == "ui_layout_requirements_v1",
        "SHOP_FACTS_LAYOUT_REQUIREMENTS_SCHEMA")
    nodes = list(native_walk(request["document"]["root"]))
    expected = {
        "panels": {node["id"] for node in nodes if node["type"] == "Panel"},
        "selects": {node["id"] for node in nodes if node["type"] == "Select"},
        "buttons": {node["id"] for node in nodes if node["type"] == "Button"},
        "textBackgrounds": {node["id"] for node in nodes if node["type"] == "Text"},
    }
    row_fields = {
        "panels": {"componentId", "appearance", "reason"},
        "selects": {"componentId", "surface", "reason"},
        "buttons": {"componentId", "textProfile", "reason"},
        "textBackgrounds": {"componentId", "drawBackground", "reason"},
    }
    allowed = {
        "panels": {"required", "plain"}, "selects": {"opaque", "translucent"},
        "buttons": {"single-style", "per-line"}, "textBackgrounds": {False, True},
    }
    value_key = {"panels": "appearance", "selects": "surface", "buttons": "textProfile",
                 "textBackgrounds": "drawBackground"}
    for section, ids in expected.items():
        rows = requirement[section]
        require(isinstance(rows, list) and all(isinstance(row, dict) for row in rows),
                "SHOP_FACTS_LAYOUT_REQUIREMENTS_SECTION:" + section)
        actual = [row.get("componentId") for row in rows]
        require(set(actual) == ids and len(actual) == len(set(actual)),
                "SHOP_FACTS_LAYOUT_REQUIREMENTS_COVERAGE:" + section)
        for row in rows:
            require(set(row) == row_fields[section] and
                    (type(row[value_key[section]]) is bool if section == "textBackgrounds"
                     else row[value_key[section]] in allowed[section]) and
                    isinstance(row["reason"], str) and row["reason"].strip(),
                    "SHOP_FACTS_LAYOUT_REQUIREMENTS_ROW:" + section)


def finalize_request(facts: dict, request: dict) -> dict:
    """Complete native output fields and fail closed on unsupported layout facts."""
    require(isinstance(facts, dict) and isinstance(request, dict), "SHOP_FACTS_FINALIZE_INPUT")
    request = deepcopy(request)
    _finalize_capabilities(request)
    _finalize_board_policies(request)
    from .document_extensions import check_extensions
    check_extensions(request["document"], request["capabilities"])
    from .reference_delivery import validate_states
    validate_states(request["referenceState"], request["acceptanceScope"], request["document"])
    _finalize_state_evidence(request)
    from .native_delivery import _validate_state_evidence
    request["stateEvidence"] = _validate_state_evidence(request["stateEvidence"])
    _validate_layout_requirements(request)
    _finalize_layout_spacing(facts, request)
    return request
