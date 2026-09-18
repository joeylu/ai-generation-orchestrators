"""Bounded compiler for the explicitly supported single-panel shop profile.

This module consumes compact, source-bound observations.  It does not inspect
samples, infer text, or contact a model/provider.  Geometry is source pixel-edge
coordinates and the returned native request is built from scratch.
"""
from __future__ import annotations

import copy
import hashlib
import json
import math
import re
from pathlib import Path
from typing import Any

from .common import ContractError, digest, identifier, load_verified_image, require


KIND = "ui_shop_facts_v1"
VERSION = "1.0"
MAX_FACTS_BYTES = 15_360
FACTS_MARKER = "shop-facts-input-v1:"
UNKNOWN_TEXT = "The source pixels do not establish this input editing state."


def planning_instruction(reference_sha256: str, canvas: list[int] | dict[str, int]) -> str:
    """Return a bounded prompt/specification for the shop-facts planning profile."""
    if isinstance(canvas, dict):
        size = [canvas.get("width"), canvas.get("height")]
    else:
        size = canvas
    require(isinstance(reference_sha256, str) and re.fullmatch(r"[0-9a-f]{64}", reference_sha256),
            "SHOP_FACTS_REFERENCE_SHA")
    require(isinstance(size, list) and len(size) == 2 and all(type(v) is int and v > 0 for v in size),
            "SHOP_FACTS_CANVAS")
    return (
        "Describe only directly observed facts in this one shop screenshot. Return exactly one JSON object "
        "matching kind ui_shop_facts_v1 version 1.0; do not return a native document, paths, commands, "
        "receipts, inferred artwork, or prose. Coordinates are integer source-pixel edges in global canvas "
        "space, except rows.template rectangles are row-local. Keep JSON under 15360 UTF-8 bytes; list each "
        "product once. Use null only where the schema explicitly permits it, and record unobserved values "
        "as {status:unknown,reason:...}. Do not guess font family; compiler uses Arial and requires explicit "
        "sizes. Include runtime derivation evidence for category mapping, sort mapping, quantity bounds, "
        "search behavior and any changed row pitch. This profile supports only one Panel, Tabs, one search "
        "Input, one sort Select, one uniform List, and a footer with selected name, quantity, total, checkbox, "
        "two buttons and slogan. Unsupported or ambiguous layouts must be reported as unsupportedProfile.\n"
        "For a directly observed disconnected rectangular tab glyph grid, include optional glyphStructure "
        "with columnGroups and rowGroups (integers 2..4), maxInternalGapRatio (positive, at most 0.25 "
        "of glyph height), and nonempty source observation evidence. Do not infer topology from its name "
        "or expected board slot count. Omit this field for connected glyphs; ambiguous topology is unsupported. "
        f"Bind source.sha256 to {reference_sha256} and source.canvas to {size}. "
        "The following self-contained structural example is synthetic: replace all observed values, geometry and semantics from the new image; never copy its content. "
        + json.dumps(synthetic_facts(reference_sha256, [640,480]), ensure_ascii=False, separators=(",", ":"))
    )


def _style(bg: str, border: str, text: str, size: int, *, weight: str = "normal",
           radius: int = 0, border_width: int = 0, opacity: float = 1) -> dict:
    return {"backgroundColor": bg, "borderColor": border, "borderWidth": border_width,
            "cornerRadius": radius, "textColor": text, "fontFamily": "Arial",
            "fontSize": size, "fontWeight": weight, "opacity": opacity}


def _node(ident: str, kind: str, rect: list[int], props: dict, children: list[dict] | None = None) -> dict:
    x, y, w, h = rect
    result = {"id": ident, "type": kind, "layout": {"x": x, "y": y, "width": w, "height": h}, "props": props}
    if children is not None:
        result["children"] = children
    return result


def _rect(value: Any, canvas: tuple[int, int], name: str, *, local: bool = False) -> list[int]:
    require(isinstance(value, list) and len(value) == 4 and all(type(v) is int for v in value),
            "SHOP_FACTS_RECT:" + name)
    x, y, w, h = value
    require(x >= 0 and y >= 0 and w > 0 and h > 0, "SHOP_FACTS_RECT:" + name)
    require(local or (x + w <= canvas[0] and y + h <= canvas[1]), "SHOP_FACTS_RECT_BOUNDS:" + name)
    return list(value)


def _inside(inner: list[int], outer: list[int], name: str) -> None:
    x, y, w, h = inner
    ox, oy, ow, oh = outer
    require(x >= ox and y >= oy and x + w <= ox + ow and y + h <= oy + oh,
            "SHOP_FACTS_GEOMETRY_RELATION:" + name)


def _evidence(value: Any, name: str, *, nullable: bool = False) -> str | None:
    if value is None and nullable:
        return None
    require(isinstance(value, str) and value.strip() == value and bool(value), "SHOP_FACTS_EVIDENCE:" + name)
    return value


def _unknown(value: Any, name: str) -> Any:
    require(isinstance(value, dict), "SHOP_FACTS_UNKNOWN:" + name)
    status = value.get("status")
    if status == "unknown":
        require(set(value) == {"status", "reason"} and isinstance(value["reason"], str) and value["reason"].strip(),
                "SHOP_FACTS_UNKNOWN:" + name)
        return None
    require(status == "observed" and set(value) == {"status", "value", "evidence"},
            "SHOP_FACTS_UNKNOWN:" + name)
    _evidence(value["evidence"], name)
    return value["value"]


def _exact(value: Any, keys: set[str], name: str, *, optional: set[str] = frozenset()) -> dict:
    require(isinstance(value, dict) and keys <= set(value) and set(value) <= keys | set(optional),
            "SHOP_FACTS_FIELDS:" + name)
    return value


def _validate_facts(reference: Path, facts: dict) -> tuple[list[int], str, str]:
    encoded = json.dumps(facts, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False).encode("utf-8")
    require(len(encoded) <= MAX_FACTS_BYTES, "SHOP_FACTS_SIZE_LIMIT")
    _exact(facts, {"kind", "version", "source", "observation", "background", "panel", "theme", "tabs",
                   "search", "sort", "rows", "sharedCurrency", "footer", "runtimeDerivations"}, "root",
           optional={"unsupportedProfile", "materialObservations"})
    require("unsupportedProfile" not in facts and facts["kind"] == KIND and facts["version"] == VERSION,
            "SHOP_FACTS_PROFILE_UNSUPPORTED")
    source = _exact(facts["source"], {"sha256", "canvas"}, "source")
    require(isinstance(source["sha256"], str) and re.fullmatch(r"[0-9a-f]{64}", source["sha256"]),
            "SHOP_FACTS_SOURCE_SHA")
    canvas = source["canvas"]
    require(isinstance(canvas, list) and len(canvas) == 2 and all(type(v) is int and v > 0 for v in canvas),
            "SHOP_FACTS_CANVAS")
    picture, proof = load_verified_image(reference, canvas)
    from PIL import Image
    with Image.open(reference) as original:
        require(original.getexif().get(274, 1) == 1, "SHOP_FACTS_REFERENCE_ORIENTATION")
    require(proof["sha256"] == source["sha256"], "SHOP_FACTS_SOURCE_SHA_MISMATCH")
    obs = _exact(facts["observation"], {"basis", "unknowns"}, "observation")
    require(obs["basis"] == "single-static-shop-screen" and isinstance(obs["unknowns"], list),
            "SHOP_FACTS_OBSERVATION")
    for entry in obs["unknowns"]:
        _exact(entry, {"path", "reason"}, "observation.unknowns")
        require(isinstance(entry["path"], str) and entry["path"].strip() and
                isinstance(entry["reason"], str) and entry["reason"].strip(), "SHOP_FACTS_OBSERVATION")

    bg = _exact(facts["background"], {"semantics", "rect"}, "background")
    require(isinstance(bg["semantics"], str) and bg["semantics"].strip(), "SHOP_FACTS_BACKGROUND_UNKNOWN")
    require(_rect(bg["rect"], tuple(canvas), "background") == [0, 0, *canvas], "SHOP_FACTS_BACKGROUND_GEOMETRY")
    panel = _exact(facts["panel"], {"semantics", "rect", "headerRect", "title", "subtitle", "balance"}, "panel")
    require(isinstance(panel["semantics"], str) and panel["semantics"].strip(), "SHOP_FACTS_PANEL_UNKNOWN")
    panel_rect = _rect(panel["rect"], tuple(canvas), "panel.rect")
    _inside(_rect(panel["headerRect"], tuple(canvas), "panel.headerRect"), panel_rect, "panel.header")
    title = _exact(panel["title"], {"text", "bounds"}, "panel.title")
    require(isinstance(title["text"], str) and title["text"].strip(), "SHOP_FACTS_TITLE")
    _inside(_rect(title["bounds"], tuple(canvas), "panel.title.bounds"), panel_rect, "panel.title")
    subtitle = _exact(panel["subtitle"], {"text", "bounds"}, "panel.subtitle")
    if subtitle["text"] is None:
        require(subtitle["bounds"] is None, "SHOP_FACTS_SUBTITLE_BOUNDS")
    else:
        require(isinstance(subtitle["text"], str) and subtitle["text"].strip(), "SHOP_FACTS_SUBTITLE")
        _inside(_rect(subtitle["bounds"], tuple(canvas), "panel.subtitle.bounds"), panel_rect, "panel.subtitle")
    balance = _exact(panel["balance"], {"text", "bounds", "currencyRect"}, "panel.balance")
    require(isinstance(balance["text"], str) and balance["text"].strip(), "SHOP_FACTS_BALANCE")
    for key in ("bounds", "currencyRect"):
        _inside(_rect(balance[key], tuple(canvas), "panel.balance." + key), panel_rect, "panel.balance")

    theme = _exact(facts["theme"], {"colors", "fontSizesPx", "shape"}, "theme")
    colors = _exact(theme["colors"], {"canvas", "panel", "text", "muted", "accent", "selected", "button", "buttonText", "activeTabText", "quantityText", "border"}, "theme.colors")
    for name, value in colors.items():
        require(isinstance(value, str) and re.fullmatch(r"#[0-9A-Fa-f]{3}(?:[0-9A-Fa-f]{3})?", value), "SHOP_FACTS_COLOR:" + name)
    fonts = _exact(theme["fontSizesPx"], {"title", "subtitle", "body", "price", "footer", "button", "tab", "checkbox", "slogan", "quantity", "sort", "itemName"}, "theme.fontSizesPx")
    require(all(type(v) is int and 1 <= v <= 96 for v in fonts.values()), "SHOP_FACTS_FONT_SIZE")
    shape = _exact(theme["shape"], {"borderWidthPx", "cornerRadiusPx"}, "theme.shape")
    require(all(type(v) is int and 0 <= v <= 32 for v in shape.values()), "SHOP_FACTS_SHAPE")

    tabs = _exact(facts["tabs"], {"items"}, "tabs", optional={"rect"})
    if "rect" in tabs: _rect(tabs["rect"], tuple(canvas), "tabs.rect")
    require(isinstance(tabs["items"], list) and 2 <= len(tabs["items"]) <= 8, "SHOP_FACTS_TABS")
    tab_ids, selected_tabs, all_tabs = set(), 0, 0
    for index, tab in enumerate(tabs["items"]):
        _exact(tab, {"id", "label", "labelBounds", "glyphDescription", "glyphBounds", "glyphPaletteRects", "category", "selected", "bounds"}, f"tabs.items[{index}]", optional={"glyphStructure"})
        if "glyphStructure" in tab:
            from .shop_facts_contracts import glyph_policy
            glyph_policy([tab])  # Use the extraction contract's bounded topology validation.
        identifier(tab["id"]); require(tab["id"] not in tab_ids, "SHOP_FACTS_DUPLICATE_ID"); tab_ids.add(tab["id"])
        require(isinstance(tab["label"], str) and tab["label"].strip() and isinstance(tab["glyphDescription"], str) and tab["glyphDescription"].strip(), "SHOP_FACTS_TAB_TEXT")
        require(type(tab["selected"]) is bool, "SHOP_FACTS_TAB_SELECTED")
        selected_tabs += int(tab["selected"])
        if tab["category"] is None: all_tabs += 1
        else: require(isinstance(tab["category"], str) and tab["category"].strip(), "SHOP_FACTS_CATEGORY")
        for key in ("labelBounds", "glyphBounds", "bounds"):
            _rect(tab[key], tuple(canvas), "tabs.item." + key)
        _inside(tab["labelBounds"], tab["bounds"], "tab label")
        _inside(tab["glyphBounds"], tab["bounds"], "tab glyph")
        _inside(tab["bounds"], tabs["rect"], "tab bounds") if "rect" in tabs else None
        palettes = _exact(tab["glyphPaletteRects"], {"normal", "active"}, "tabs.glyphPaletteRects")
        for key, roi in palettes.items():
            roi = _rect(roi, tuple(canvas), "tab.palette." + key)
            require(roi[2] >= 2 and roi[3] >= 2, "SHOP_FACTS_PALETTE_ROI")
    require(selected_tabs == all_tabs == 1, "SHOP_FACTS_TABS_INITIAL_STATE")
    categories = [t["category"] for t in tabs["items"] if t["category"] is not None]
    require(len(categories) == len(set(categories)), "SHOP_FACTS_DUPLICATE_CATEGORY")

    search = _exact(facts["search"], {"rect", "iconBounds", "iconDescription", "textBounds", "placeholder", "value", "editingState"}, "search")
    search_rect = _rect(search["rect"], tuple(canvas), "search.rect")
    if search["iconBounds"] is not None:
        _inside(_rect(search["iconBounds"], tuple(canvas), "search.iconBounds"), search_rect, "search icon")
        require(isinstance(search["iconDescription"], str) and search["iconDescription"].strip(), "SHOP_FACTS_SEARCH_ICON")
    else: require(search["iconDescription"] is None, "SHOP_FACTS_SEARCH_ICON")
    _inside(_rect(search["textBounds"], tuple(canvas), "search.textBounds"), search_rect, "search text")
    require(isinstance(search["placeholder"], str) and isinstance(search["value"], str), "SHOP_FACTS_SEARCH_TEXT")
    state = _exact(search["editingState"], {"focused", "caretVisible", "selectionStart", "selectionEnd", "selectionDirection"}, "search.editingState")
    for key, raw in state.items():
        val = _unknown(raw, "search.editingState." + key)
        if key in ("focused", "caretVisible") and val is not None: require(type(val) is bool, "SHOP_FACTS_INPUT_STATE")
        if key in ("selectionStart", "selectionEnd") and val is not None: require(type(val) is int and 0 <= val <= len(search["value"].encode("utf-16-le")) // 2, "SHOP_FACTS_INPUT_SELECTION")
        if key == "selectionDirection" and val is not None: require(val in ("forward", "backward", "none"), "SHOP_FACTS_INPUT_SELECTION")

    sort = _exact(facts["sort"], {"rect", "labelBounds", "indicatorBounds", "selectedValue", "popupRect", "popupContentRect", "optionRowHeightPx", "options", "evidence"}, "sort")
    sort_rect = _rect(sort["rect"], tuple(canvas), "sort.rect")
    for key in ("labelBounds", "indicatorBounds"):
        _inside(_rect(sort[key], tuple(canvas), "sort." + key), sort_rect, "sort child")
    popup = _rect(sort["popupRect"], tuple(canvas), "sort.popupRect")
    _inside(_rect(sort["popupContentRect"], tuple(canvas), "sort.popupContentRect"), popup, "sort popup content")
    require(type(sort["optionRowHeightPx"]) is int and sort["optionRowHeightPx"] > 0 and
            isinstance(sort["options"], list) and 1 <= len(sort["options"]) <= 8, "SHOP_FACTS_SORT_OPTIONS")
    option_ids = set()
    for i, option in enumerate(sort["options"]):
        _exact(option, {"label", "value", "field", "direction"}, f"sort.options[{i}]")
        identifier(option["value"]); require(option["value"] not in option_ids, "SHOP_FACTS_SORT_DUPLICATE"); option_ids.add(option["value"])
        require(isinstance(option["label"], str) and option["label"].strip() and option["field"] in ("unitPrice", "searchText") and option["direction"] in ("asc", "desc"), "SHOP_FACTS_SORT_OPTION")
    require(sort["selectedValue"] in option_ids, "SHOP_FACTS_SORT_SELECTION")
    _evidence(sort["evidence"], "sort")

    rows = _exact(facts["rows"], {"viewport", "sourcePitchPx", "template", "items"}, "rows", optional={"backgroundPolicy", "backgroundEvidence"})
    if "backgroundPolicy" in rows:
        policy = _exact(rows["backgroundPolicy"], {"version", "mode"}, "rows.backgroundPolicy")
        require(policy["version"] == "1.0" and policy["mode"] in ("parent", "own"), "SHOP_FACTS_LIST_BACKGROUND_POLICY")
        _evidence(rows.get("backgroundEvidence"), "rows.backgroundEvidence")
    else:
        require("backgroundEvidence" not in rows, "SHOP_FACTS_LIST_BACKGROUND_POLICY")
    viewport = _rect(rows["viewport"], tuple(canvas), "rows.viewport")
    require(type(rows["sourcePitchPx"]) is int and rows["sourcePitchPx"] > 0, "SHOP_FACTS_ROW_PITCH")
    template = _exact(rows["template"], {"rowHeightPx", "imageRect", "nameRect", "descriptionRect", "currencyRect", "priceRect", "markRect"}, "rows.template", optional={"markGlyphRect"})
    rh = template["rowHeightPx"]
    require(type(rh) is int and 1 <= rh <= rows["sourcePitchPx"], "SHOP_FACTS_ROW_HEIGHT")
    local_canvas = (viewport[2], rh)
    for key in ("imageRect", "nameRect", "descriptionRect", "currencyRect", "priceRect", "markRect"):
        value = _rect(template[key], local_canvas, "rows.template." + key, local=True)
        _inside(value, [0, 0, *local_canvas], "row template")
    if template.get("markGlyphRect") is not None:
        glyph = _rect(template["markGlyphRect"], local_canvas, "rows.template.markGlyphRect", local=True)
        _inside(glyph, template["markRect"], "observed row mark glyph")
    require(template["currencyRect"][2:] == balance["currencyRect"][2:], "SHOP_FACTS_CURRENCY_GEOMETRY")
    require(template["priceRect"][2] >= 1 and template["priceRect"][3] >= 1, "SHOP_FACTS_PRICE_GEOMETRY")
    require(isinstance(rows["items"], list) and 1 <= len(rows["items"]) <= 32, "SHOP_FACTS_ITEMS")
    item_ids, selected_items = set(), 0
    known_categories = set(categories)
    for i, item in enumerate(rows["items"]):
        _exact(item, {"id", "name", "description", "priceText", "searchText", "unitPrice", "category", "iconDescription", "selected"}, f"rows.items[{i}]")
        identifier(item["id"]); require(item["id"] not in item_ids, "SHOP_FACTS_DUPLICATE_ID"); item_ids.add(item["id"])
        for key in ("name", "description", "priceText", "searchText", "iconDescription"):
            require(isinstance(item[key], str) and item[key].strip(), "SHOP_FACTS_ITEM_TEXT:" + key)
        require(type(item["unitPrice"]) is int and 0 <= item["unitPrice"] <= 9_007_199_254_740_991, "SHOP_FACTS_ITEM_PRICE")
        require(item["category"] in known_categories, "SHOP_FACTS_ITEM_CATEGORY")
        require(type(item["selected"]) is bool, "SHOP_FACTS_ITEM_SELECTED")
        selected_items += int(item["selected"])
    require(selected_items == 1, "SHOP_FACTS_LIST_SELECTION")
    selected_item = next(item for item in rows["items"] if item["selected"])
    require(search["value"] == "" and tabs["items"][next(i for i,t in enumerate(tabs["items"]) if t["selected"])]["category"] is None,
            "SHOP_FACTS_INITIAL_FILTER_UNSUPPORTED")
    for category in known_categories:
        require(any(item["category"] == category for item in rows["items"]), "SHOP_FACTS_CATEGORY_EMPTY")
    source_order = list(rows["items"])
    selected_sort = next(option for option in sort["options"] if option["value"] == sort["selectedValue"])
    keyname = selected_sort["field"]
    expected_order = sorted(source_order, key=lambda item: item[keyname].encode('utf-16-be') if keyname=='searchText' else item[keyname], reverse=selected_sort["direction"] == "desc")
    require([item["id"] for item in expected_order] == [item["id"] for item in source_order], "SHOP_FACTS_INITIAL_SORT_ORDER")

    currency = _exact(facts["sharedCurrency"], {"sourceRect", "description", "evidence"}, "sharedCurrency")
    source_coin_rect = _rect(currency["sourceRect"], tuple(canvas), "sharedCurrency.sourceRect")
    require(source_coin_rect[2:] == balance["currencyRect"][2:] == template["currencyRect"][2:], "SHOP_FACTS_CURRENCY_GEOMETRY")
    observed_first_row_coin = [rows["viewport"][0] + template["currencyRect"][0],
                               rows["viewport"][1] + template["currencyRect"][1], *template["currencyRect"][2:]]
    require(source_coin_rect == observed_first_row_coin, "SHOP_FACTS_CURRENCY_SOURCE_MISMATCH")
    require(isinstance(currency["description"], str) and currency["description"].strip(), "SHOP_FACTS_CURRENCY_DESCRIPTION")
    _evidence(currency["evidence"], "sharedCurrency")

    footer = _exact(facts["footer"], {"rect", "selectedName", "quantity", "total", "checkbox", "buttons", "slogan"}, "footer")
    footer_rect = _rect(footer["rect"], tuple(canvas), "footer.rect")
    _inside(footer_rect, panel_rect, "footer panel")
    selected_name = _exact(footer["selectedName"], {"text", "bounds", "prefix", "emptyText"}, "footer.selectedName")
    require(selected_name["text"] == selected_name["prefix"] + selected_item["name"], "SHOP_FACTS_SELECTED_NAME_TEXT")
    for key in ("text", "prefix", "emptyText"):
        require(isinstance(selected_name[key], str), "SHOP_FACTS_SELECTED_NAME")
    _inside(_rect(selected_name["bounds"], tuple(canvas), "footer.selectedName.bounds"), footer_rect, "selected name")
    quantity = _exact(footer["quantity"], {"minusRect", "valueRect", "valueTextBounds", "plusRect", "value"}, "footer.quantity")
    for key in ("minusRect", "valueRect", "plusRect"):
        _inside(_rect(quantity[key], tuple(canvas), "footer.quantity." + key), footer_rect, "quantity control")
    _inside(_rect(quantity["valueTextBounds"], tuple(canvas), "quantity text"), quantity["valueRect"], "quantity text")
    require(type(quantity["value"]) is int and quantity["value"] >= 0, "SHOP_FACTS_QUANTITY")
    total = _exact(footer["total"], {"text", "bounds", "prefix", "suffix", "fractionDigits", "grouping", "emptyText"}, "footer.total", optional={"currencyRect"})
    require(total.get("currencyRect") is None, "SHOP_FACTS_FOOTER_CURRENCY_UNSUPPORTED")
    require(all(isinstance(total[key], str) for key in ("text", "prefix", "suffix", "emptyText")), "SHOP_FACTS_TOTAL_TEXT")
    require(type(total["fractionDigits"]) is int and 0 <= total["fractionDigits"] <= 6 and total["grouping"] in ("none", "comma"), "SHOP_FACTS_TOTAL_FORMAT")
    formatted = _format_number(selected_item["unitPrice"] * quantity["value"], total["fractionDigits"], total["grouping"])
    require(total["text"] == total["prefix"] + formatted + total["suffix"], "SHOP_FACTS_TOTAL_OBSERVATION")
    _inside(_rect(total["bounds"], tuple(canvas), "footer.total.bounds"), footer_rect, "total")
    checkbox = _exact(footer["checkbox"], {"rect", "labelBounds", "label", "checked"}, "footer.checkbox")
    for key in ("rect", "labelBounds"):
        _inside(_rect(checkbox[key], tuple(canvas), "footer.checkbox." + key), footer_rect, "checkbox")
    require(isinstance(checkbox["label"], str) and checkbox["label"].strip() and type(checkbox["checked"]) is bool, "SHOP_FACTS_CHECKBOX")
    require(isinstance(footer["buttons"], list) and len(footer["buttons"]) == 2, "SHOP_FACTS_BUTTONS")
    roles = set()
    for button in footer["buttons"]:
        _exact(button, {"rect", "labelBounds", "label", "role", "textColor"}, "footer.button")
        _inside(_rect(button["rect"], tuple(canvas), "footer.button.rect"), footer_rect, "button")
        _inside(_rect(button["labelBounds"], tuple(canvas), "footer.button.labelBounds"), button["rect"], "button label")
        require(button["role"] in ("back", "purchase") and button["role"] not in roles and isinstance(button["label"], str) and button["label"].strip(), "SHOP_FACTS_BUTTON")
        require(isinstance(button["textColor"],str) and re.fullmatch(r"#[0-9A-Fa-f]{6}",button["textColor"]), "SHOP_FACTS_BUTTON_TEXT_COLOR")
        roles.add(button["role"])
    require(roles == {"back", "purchase"}, "SHOP_FACTS_BUTTON_ROLES")
    slogan = _exact(footer["slogan"], {"text", "bounds"}, "footer.slogan")
    require(isinstance(slogan["text"], str), "SHOP_FACTS_SLOGAN")
    _inside(_rect(slogan["bounds"], tuple(canvas), "footer.slogan.bounds"), footer_rect, "slogan")

    deriv = _exact(facts["runtimeDerivations"], {"categoriesEvidence", "quantityBounds", "rowSpacing", "search", "selectionOnFilter", "quantityOnSelectionChange", "purchaseEmptySelection"}, "runtimeDerivations")
    _evidence(deriv["categoriesEvidence"], "categories")
    qb = _exact(deriv["quantityBounds"], {"min", "max", "step", "evidence"}, "quantityBounds")
    require(all(type(qb[k]) is int for k in ("min", "max", "step")) and qb["min"] >= 0 and qb["max"] >= qb["min"] and qb["step"] > 0 and qb["min"] <= quantity["value"] <= qb["max"] and (quantity["value"] - qb["min"]) % qb["step"] == 0 and (qb["max"] - qb["min"]) // qb["step"] <= 128, "SHOP_FACTS_QUANTITY_BOUNDS")
    _evidence(qb["evidence"], "quantityBounds")
    spacing = _exact(deriv["rowSpacing"], {"outputPitchPx", "evidence"}, "rowSpacing")
    require(type(spacing["outputPitchPx"]) is int and spacing["outputPitchPx"] > 0, "SHOP_FACTS_ROW_SPACING")
    if spacing["outputPitchPx"] == rows["sourcePitchPx"]: _evidence(spacing["evidence"], "rowSpacing", nullable=True)
    else: _evidence(spacing["evidence"], "rowSpacing")
    _exact(deriv["search"], {"match", "caseSensitive", "evidence"}, "runtimeDerivations.search")
    require(deriv["search"]["match"] in ("contains", "startsWith") and type(deriv["search"]["caseSensitive"]) is bool, "SHOP_FACTS_SEARCH_DERIVATION")
    _evidence(deriv["search"]["evidence"], "search")
    require(deriv["selectionOnFilter"] in ("clear", "first") and deriv["quantityOnSelectionChange"] in ("retain", "reset") and deriv["purchaseEmptySelection"] in ("disabled", "enabled"), "SHOP_FACTS_RUNTIME_POLICY")
    return canvas, proof["sha256"], digest(facts)


def _format_number(value: int, digits: int, grouping: str) -> str:
    from decimal import Decimal
    return format(Decimal(value), (',' if grouping=='comma' else '') + f'.{digits}f')


def _global(rect: list[int], parent: list[int]) -> list[int]:
    return [rect[0] - parent[0], rect[1] - parent[1], rect[2], rect[3]]


def _text(ident: str, text: str, rect: list[int], color: str, size: int, weight: str = "normal") -> dict:
    return _node(ident, "Text", rect, {"text": text, "wrap": "none", "overflow": "ellipsis", "lineHeight": size * 1.2,
                  "drawBackground": False, "style": _style("#000000", "#000000", color, size, weight=weight)})


def _image(ident: str, rect: list[int], color: str, size: int, *, fit: str = "contain") -> dict:
    return _node(ident, "Image", rect, {"source": f"layers/{ident}.png", "fit": fit, "drawBackground": False,
                  "style": _style("#000000", "#000000", color, size)})


def _evidence_field(status: Any, field: str) -> dict:
    value = _unknown(status, field)
    if status['status'] == 'unknown':
        return {"status": "unknown", "reason": status["reason"]}
    return {"status": "observed", "value": value, "evidence": status["evidence"]}


def _add_material(rows: list[dict], component: dict, rect: list[int], description: str,
                  marker: str, *, group: str | None = None, shared_source: str | None = None) -> str:
    layer = component["id"]
    material = {"layerId": layer, "componentId": component.get("ownerId", layer), "rect": list(rect),
                "description": f"{marker} {description}", "groupId": group}
    if shared_source:
        material["sharedSource"] = {"version": "1.0", "sourceLayerId": shared_source,
                                    "evidence": "The compact source facts explicitly declare this repeated coin artwork shared."}
    rows.append(material)
    return layer


def _appearance_binding(component: dict, parts: list[dict], states: dict | None = None) -> dict:
    result = {"componentId": component["id"], "componentType": component["type"], "parts": parts}
    if states is not None: result["states"] = states
    return result


def expand_shop_facts(reference: Path, facts: dict) -> dict:
    """Expand validated compact source facts into a native 1.2 request."""
    reference = Path(reference)
    canvas, reference_sha, facts_sha = _validate_facts(reference, facts)
    width, height = canvas
    marker = FACTS_MARKER + facts_sha
    panel = facts["panel"]; panel_rect = panel["rect"]
    tabs_f = facts["tabs"]; rows_f = facts["rows"]; footer_f = facts["footer"]
    theme = facts["theme"]; colors = theme["colors"]; fs = theme["fontSizesPx"]
    source_order = rows_f["items"]

    # Allocate generated IDs in one deterministic namespace, then reject any
    # caller IDs that would collide with a node/choice/tab in UiDocument.
    fixed = {"shop-root", "background", "shop-panel", "shop-header", "shop-title", "shop-subtitle",
             "balance-text", "balance-coin", "shop-tabs", "tabs-content", "search-input", "sort-select",
             "shop-list", "shop-footer", "selected-name", "quantity-minus", "quantity-value",
             "quantity-plus", "shop-total", "remember-checkbox", "slogan"}
    fixed.update("button-" + row["role"] for row in footer_f["buttons"])
    fixed.update("tab-icon-" + tab["id"] + suffix for tab in tabs_f["items"] for suffix in ("", "-active"))
    fixed.update("row-image-" + item["id"] for item in source_order)
    fixed.update("row-name-" + item["id"] for item in source_order)
    fixed.update("row-description-" + item["id"] for item in source_order)
    fixed.update("row-coin-" + item["id"] for item in source_order)
    fixed.update("row-price-" + item["id"] for item in source_order)
    if facts["search"]["iconBounds"] is not None: fixed.add("search-icon")
    supplied_ids = {item["id"] for item in source_order} | {tab["id"] for tab in tabs_f["items"]} | {row["value"] for row in facts["sort"]["options"]}
    require(not (fixed & supplied_ids), "SHOP_FACTS_GENERATED_ID_COLLISION")

    # Root art is a real material.  Structural containers carry transparent style.
    root_children: list[dict] = []
    materials: list[dict] = []
    bindings: list[dict] = []
    glyph_recipes: list[dict] = []
    root = _node("shop-root", "Container", [0, 0, width, height], {"style": _style(colors["canvas"], colors["canvas"], colors["text"], fs["body"])}, root_children)
    bg = _image("background", [0, 0, width, height], colors["text"], fs["body"], fit="stretch")
    root_children.append(bg)
    _add_material(materials, bg, [0, 0, width, height], facts["background"]["semantics"], marker)
    bindings.append(_appearance_binding(bg, [{"role": "image", "layerId": "background"}]))

    # Panel holds the title band, category tabs and single footer container.
    panel_node: dict = _node("shop-panel", "Panel", _global(panel_rect, [0, 0, width, height]),
        {"title": "", "style": _style(colors["panel"], colors["border"], colors["text"], fs["body"],
                                         radius=theme["shape"]["cornerRadiusPx"], border_width=theme["shape"]["borderWidthPx"])}, [])
    root_children.append(panel_node)
    panel_rel = _global(panel_rect, [0, 0, width, height])
    panel_bg = _add_material(materials, {"id": "shop-panel", "type": "Panel"}, panel_rect,
                             facts["panel"]["semantics"], marker)
    bindings.append(_appearance_binding(panel_node, [{"role": "background", "layerId": panel_bg}],
        {"panel": {"titleLayout": {"coordinateSpace": "target-component-local", "x": 0, "y": 0,
                                      "width": panel_rect[2], "height": panel_rect[3]}}}))

    def append(parent: dict, node: dict) -> dict:
        parent["children"].append(node)
        return node

    # Header composition: its background material describes the observed crown.
    header_rect = panel["headerRect"]
    title_rect = panel["title"]["bounds"]
    title = append(panel_node, _text("shop-title", panel["title"]["text"], _global(title_rect, panel_rect), colors["text"], fs["title"], "bold"))
    subtitle_node = None
    if panel["subtitle"]["text"] is not None:
        subtitle_rect = panel["subtitle"]["bounds"]
        subtitle_node = append(panel_node, _text("shop-subtitle", panel["subtitle"]["text"], _global(subtitle_rect, panel_rect), colors["muted"], fs["subtitle"]))
    balance = panel["balance"]
    bal_text = append(panel_node, _text("balance-text", balance["text"], _global(balance["bounds"], panel_rect), colors["text"], fs["footer"], "bold"))
    coin_rect = balance["currencyRect"]
    balance_coin = append(panel_node, _image("balance-coin", _global(coin_rect, panel_rect), colors["text"], fs["body"]))
    first_coin_layer = "row-coin-" + source_order[0]["id"]
    _add_material(materials, balance_coin, coin_rect, facts["sharedCurrency"]["description"], marker,
                  shared_source=first_coin_layer)
    bindings.append(_appearance_binding(balance_coin, [{"role": "image", "layerId": "balance-coin"}]))

    # Tabs use one native component with one source base per cell and explicit
    # paired glyph roles.  Opposite states are derived only from declared ROIs.
    if "rect" in tabs_f:
        tab_rect = list(tabs_f["rect"])
    else:
        left = min(t["bounds"][0] for t in tabs_f["items"]); top = min(t["bounds"][1] for t in tabs_f["items"])
        right = max(t["bounds"][0] + t["bounds"][2] for t in tabs_f["items"])
        bottom = max(t["bounds"][1] + t["bounds"][3] for t in tabs_f["items"])
        tab_rect = [left, top, right-left, bottom-top]
    tabs_node = append(panel_node, _node("shop-tabs", "Tabs", _global(tab_rect, panel_rect),
        {"activeId": next(t["id"] for t in tabs_f["items"] if t["selected"]),
         "tabs": [{"id": t["id"], "label": t["label"], "contentId": "tab-page-"+t['id']} for t in tabs_f["items"]],
         "enabled": True, "drawBackground": False, "style": _style(colors["panel"], colors["border"], colors["text"], fs["tab"],
                                                  radius=theme["shape"]["cornerRadiusPx"], border_width=theme["shape"]["borderWidthPx"])}, []))
    tabs_content_rect = [tab_rect[0], tab_rect[1] + max(t["bounds"][3] for t in tabs_f["items"]),
                         tab_rect[2], max(1, footer_f["rect"][1] - (tab_rect[1] + max(t["bounds"][3] for t in tabs_f["items"]))) ]
    for tab in tabs_f['items']:
        append(tabs_node,_node('tab-page-'+tab['id'],'Container',[0,0,1,1],
            {'style':_style(colors['panel'],colors['panel'],colors['text'],fs['body'])},[]))
    content = append(panel_node, _node("tabs-content", "Container", _global(tabs_content_rect, panel_rect),
        {"style": _style(colors["panel"], colors["panel"], colors["text"], fs["body"])}, []))

    # Build tab backgrounds and glyph pairs.  Glyph palette declarations point
    # to original-image ROIs, and the opposite role has no independent slot.
    tab_parts = []
    icons_state = []; items_state = []
    tab_header_height = max(t["bounds"][3] for t in tabs_f["items"])
    for tab in tabs_f["items"]:
        item_bounds = _global(tab["bounds"], tab_rect)
        glyph_local = _global(tab["glyphBounds"], tab["bounds"])
        normal_id, active_id = "tab-icon-" + tab["id"], "tab-icon-" + tab["id"] + "-active"
        normal_frame, active_frame = "tab-base-" + tab["id"], "tab-active-base-" + tab["id"]
        for layer, description in ((normal_frame, "Observed unselected category tab base."),
                                   (active_frame, "Observed selected category tab base.")):
            _add_material(materials, {"id": layer, "ownerId": "shop-tabs", "type": "Tabs"}, tab["bounds"], description, marker,
                          group="shop-tab-art")
        tab_parts.extend([{"role": "tab", "layerId": normal_frame, "tabId": tab["id"]},
                          {"role": "active-tab", "layerId": active_frame, "tabId": tab["id"]}])
        normal_rect, active_rect = tab["glyphBounds"], tab["glyphBounds"]
        _add_material(materials, {"id": normal_id, "ownerId": "shop-tabs", "type": "Tabs"}, normal_rect,
                      f"Category glyph {tab['glyphDescription']} in normal state.", marker, group="shop-tab-art")
        _add_material(materials, {"id": active_id, "ownerId": "shop-tabs", "type": "Tabs"}, active_rect,
                      f"Category glyph {tab['glyphDescription']} in active state, palette derived from observed source ROI.", marker, group="shop-tab-art")
        tab_parts.extend([{"role": "icon", "layerId": normal_id, "tabId": tab["id"]},
                          {"role": "active-icon", "layerId": active_id, "tabId": tab["id"]}])
        if tab["selected"]:
            canonical, target = active_id, normal_id
            palette = tab["glyphPaletteRects"]["normal"]
        else:
            canonical, target = normal_id, active_id
            palette = tab["glyphPaletteRects"]["active"]
        glyph_recipes.append({"targetLayerId": target, "canonicalLayerId": canonical,
                              "paletteReferenceRect": palette,
                              "evidence": f"Observed {tab['glyphDescription']} silhouette is reused with the explicitly sampled source-state palette."})
        label_local = _global(tab["labelBounds"], tab["bounds"])
        items_state.append({"tabId": tab["id"], "layout": item_bounds,
                            "labelLayout": {"x": label_local[0], "y": label_local[1], "width": label_local[2], "height": label_local[3]},
                            "hitArea": {"x": 0, "y": 0, "width": item_bounds[2], "height": item_bounds[3]}})
        icons_state.append({"tabId": tab["id"],
                            "iconLayout": {"x": glyph_local[0], "y": glyph_local[1], "width": glyph_local[2], "height": glyph_local[3]},
                            "activeIconLayout": {"x": glyph_local[0], "y": glyph_local[1], "width": glyph_local[2], "height": glyph_local[3]}})
    # Tabs labels are carried by the Tabs definition; preserve text geometry as
    # an observation rather than materializing duplicate Text nodes.
    tabs_parts = tab_parts
    tabs_states = {"tabs": {"headerHeight": tab_header_height, "labelLayout": {"x": 0, "y": 0, "width": tab_rect[2], "height": tab_header_height},
                            "hitArea": {"x": 0, "y": 0, "width": tab_rect[2], "height": tab_header_height},
                            "activeTextColor": colors["text"], "items": items_state, "icons": icons_state}}
    bindings.append(_appearance_binding(tabs_node, tabs_parts, tabs_states))

    # Search and sort controls occupy their observed source rectangles.
    search_f = facts["search"]
    search_node = append(content, _node("search-input", "Input", _global(search_f["rect"], tabs_content_rect),
        {"value": search_f["value"], "placeholder": search_f["placeholder"], "inputType": "text",
         "readOnly": False, "maxLength": max(1, min(256, max(len(search_f["value"]), len(search_f["placeholder"])) + 64)),
         "enabled": True, "style": _style(colors["panel"], colors["border"], colors["text"], fs["body"], radius=theme["shape"]["cornerRadiusPx"], border_width=theme["shape"]["borderWidthPx"])}))
    search_layer = _add_material(materials, search_node, search_f["rect"], "Search field surface.", marker)
    bindings.append(_appearance_binding(search_node, [{"role": "background", "layerId": search_layer}],
        {"input": {"textLayout": {"coordinateSpace": "target-component-local", "x": search_f["textBounds"][0] - search_f["rect"][0],
                                   "y": search_f["textBounds"][1] - search_f["rect"][1], "width": search_f["textBounds"][2], "height": search_f["textBounds"][3]},
                    "placeholderLayout": {"coordinateSpace": "target-component-local", "x": search_f["textBounds"][0] - search_f["rect"][0],
                                          "y": search_f["textBounds"][1] - search_f["rect"][1], "width": search_f["textBounds"][2], "height": search_f["textBounds"][3]}}}))
    input_fields = {"value": {"status": "observed", "value": search_f["value"], "evidence": "The authored source search field text/value is recorded in compact facts."}}
    for field in ("focused", "caretVisible", "selectionStart", "selectionEnd", "selectionDirection"):
        input_fields[field] = _evidence_field(search_f["editingState"][field], field)
    # State validator requires selection values to fit and caret dependencies;
    # the source facts author them or preserve explicit unknowns.

    if search_f["iconBounds"] is not None:
        icon_node = append(content, _image("search-icon", _global(search_f["iconBounds"], tabs_content_rect), colors["muted"], fs["body"]))
        _add_material(materials, icon_node, search_f["iconBounds"], search_f["iconDescription"], marker)
        bindings.append(_appearance_binding(icon_node, [{"role": "image", "layerId": "search-icon"}]))

    sort_f = facts["sort"]
    sort_node = append(content, _node("sort-select", "Select", _global(sort_f["rect"], tabs_content_rect),
        {"selectedId": sort_f["selectedValue"], "options": [{"id": option["value"], "label": option["label"]} for option in sort_f["options"]],
         "enabled": True, "style": _style(colors["panel"], colors["border"], colors["text"], fs["sort"], radius=theme["shape"]["cornerRadiusPx"], border_width=theme["shape"]["borderWidthPx"])}))
    popup_rect = sort_f["popupRect"]
    sort_layers = []
    for role, layer, rect, desc in (("background", "sort-field", sort_f["rect"], "Observed sort field."),
                                    ("indicator", "sort-indicator", sort_f["indicatorBounds"], "Observed sort dropdown indicator."),
                                    ("popup", "sort-popup", popup_rect, "Derived opaque sort option popup surface.")):
        sort_layers.append({"role": role, "layerId": _add_material(materials, {"id": layer, "ownerId": "sort-select", "type": "Select"}, rect, desc, marker, group="shop-select")})
    popup_content = sort_f["popupContentRect"]
    sort_state = {"select": {"labelLayout": {"coordinateSpace": "target-component-local", "x": sort_f["labelBounds"][0]-sort_f["rect"][0], "y": sort_f["labelBounds"][1]-sort_f["rect"][1], "width": sort_f["labelBounds"][2], "height": sort_f["labelBounds"][3]},
                             "popupPlacement": {"coordinateSpace": "target-component-local", "anchor": "below-start", "gap": popup_rect[1]-(sort_f["rect"][1]+sort_f["rect"][3])},
                             "popupContentLayout": {"coordinateSpace": "target-popup-local", "x": popup_content[0]-popup_rect[0], "y": popup_content[1]-popup_rect[1], "width": popup_content[2], "height": popup_content[3]},
                             "fieldTextColor": colors["text"], "menuHighlights": {"version": "1.0", "coordinateSpace": "popup-row-local", "selected": {"color": colors["selected"], "alpha": 0.14, "insets": {"top": 1, "right": 2, "bottom": 1, "left": 2}, "cornerRadius": 0}, "hover": {"color": colors["accent"], "alpha": 0.1, "insets": {"top": 1, "right": 2, "bottom": 1, "left": 2}, "cornerRadius": 0}}}}
    bindings.append(_appearance_binding(sort_node, sort_layers, sort_state))

    # List and each row's directly-owned Image/Text children are generated from
    # a single row template plus one data record; no legacy ID/row is copied.
    list_f = _global(rows_f["viewport"], tabs_content_rect)
    row_height = rows_f["template"]["rowHeightPx"]
    pitch = facts["runtimeDerivations"]["rowSpacing"]["outputPitchPx"]
    row_gap = pitch - row_height
    list_children: list[dict] = []
    list_items = [{"id": item["id"], "label": item["name"]} for item in source_order]
    list_node = append(content, _node("shop-list", "List", list_f,
        {"selectedId": next(i["id"] for i in source_order if i["selected"]), "items": list_items,
         "itemTemplate": "text-row", "itemHeight": pitch, "rowGap": row_gap, "enabled": True,
         "style": _style(colors["panel"], colors["border"], colors["text"], fs["body"], radius=theme["shape"]["cornerRadiusPx"], border_width=theme["shape"]["borderWidthPx"])} , list_children))
    # Add the List material channels at its declared global viewport/row sizes.
    list_parts = []
    for role, layer, rect, desc in (("background", "list-background", rows_f["viewport"], "Observed product-list viewport."),
                                    ("row", "list-row", [rows_f["viewport"][0], rows_f["viewport"][1], rows_f["viewport"][2], row_height], "Uniform unselected shop row template."),
                                    ("selected-row", "list-selected-row", [rows_f["viewport"][0], rows_f["viewport"][1], rows_f["viewport"][2], row_height], "Uniform selected shop row template.")):
        list_parts.append({"role": role, "layerId": _add_material(materials, {"id": layer, "ownerId": "shop-list", "type": "List"}, rect, desc, marker, group="shop-list")})
    item_contents = []
    template = rows_f["template"]
    for index, item in enumerate(source_order):
        row_children = []
        for role, key, kind, value, color, size in (
            ("image", "imageRect", "Image", None, colors["text"], fs["body"]),
            ("name", "nameRect", "Text", item["name"], colors["text"], fs["itemName"]),
            ("description", "descriptionRect", "Text", item["description"], colors["muted"], fs["body"]),
            ("coin", "currencyRect", "Image", None, colors["text"], fs["body"]),
            ("price", "priceRect", "Text", item["priceText"], colors["text"], fs["price"])):
            cid = {"image": "row-image-", "name": "row-name-", "description": "row-description-", "coin": "row-coin-", "price": "row-price-"}[role] + item["id"]
            local_rect = template[key]
            node = _image(cid, local_rect, color, size) if kind == "Image" else _text(cid, value, local_rect, color, size)
            if role == "name": node["props"]["style"]["fontWeight"]="bold"
            row_children.append(node)
            if role == "image":
                desc = "Product illustration: " + item["iconDescription"]
                _add_material(materials, node, [rows_f["viewport"][0]+local_rect[0], rows_f["viewport"][1]+index*pitch+local_rect[1], local_rect[2], local_rect[3]], desc, marker, group="shop-product-icons")
                bindings.append(_appearance_binding(node, [{"role": "image", "layerId": cid}]))
            elif role == "coin":
                rect = [rows_f["viewport"][0]+local_rect[0], rows_f["viewport"][1]+index*pitch+local_rect[1], local_rect[2], local_rect[3]]
                if index == 0:
                    _add_material(materials, node, rect, facts["sharedCurrency"]["description"], marker)
                else:
                    _add_material(materials, node, rect, facts["sharedCurrency"]["description"], marker,
                                  shared_source=first_coin_layer)
                bindings.append(_appearance_binding(node, [{"role": "image", "layerId": cid}]))
            else:
                pass
        list_children.extend(row_children)
        item_contents.append({"itemId": item["id"], "childIds": [child["id"] for child in row_children]})
    list_node["props"]["itemContents"] = {"version": "1.0", "coordinateSpace": "item-local", "labelMode": "children", "items": item_contents}
    bindings.append(_appearance_binding(list_node, list_parts,
        {"list": {"labelLayout": {"coordinateSpace": "target-component-local", "x": 0, "y": 0, "width": rows_f["viewport"][2], "height": row_height},
                  "hitArea": {"x": 0, "y": 0, "width": rows_f["viewport"][2], "height": row_height}}}))

    # Footer controls are grouped structurally, with explicit footer geometry.
    footer_rect = footer_f["rect"]
    selected_f = footer_f["selectedName"]
    selected_node = append(panel_node, _text("selected-name", selected_f["text"], _global(selected_f["bounds"], panel_rect), colors["text"], fs["footer"]))
    qty_f = footer_f["quantity"]
    qty_bounds = facts["runtimeDerivations"]["quantityBounds"]
    minus = append(panel_node, _node("quantity-minus", "Button", _global(qty_f["minusRect"], panel_rect), {"label": "−", "enabled": True, "style": _style(colors["button"], colors["border"], colors["buttonText"], fs["button"], radius=theme["shape"]["cornerRadiusPx"], border_width=theme["shape"]["borderWidthPx"])} , []))
    quantity_text = append(panel_node, _text("quantity-value", str(qty_f["value"]), _global(qty_f["valueTextBounds"], panel_rect), colors["text"], fs["quantity"]))
    plus = append(panel_node, _node("quantity-plus", "Button", _global(qty_f["plusRect"], panel_rect), {"label": "+", "enabled": True, "style": _style(colors["button"], colors["border"], colors["buttonText"], fs["button"], radius=theme["shape"]["cornerRadiusPx"], border_width=theme["shape"]["borderWidthPx"])} , []))
    total_f = footer_f["total"]
    total_node = append(panel_node, _text("shop-total", total_f["text"], _global(total_f["bounds"], panel_rect), colors["text"], fs["footer"], "bold"))
    check_f = footer_f["checkbox"]
    check_node = append(panel_node, _node("remember-checkbox", "CheckBox", _global(check_f["rect"], panel_rect), {"label": check_f["label"], "checked": check_f["checked"], "enabled": True, "style": _style(colors["panel"], colors["border"], colors["text"], fs["checkbox"])}))
    # The mark occupies only the observed checkbox's leading square region;
    # its artwork is contract-derived and appears only in the checked state.
    box_width = check_f["rect"][3]
    require(check_f["labelBounds"][0] - check_f["rect"][0] >= box_width, "SHOP_FACTS_CHECKBOX_GEOMETRY")
    mark_rect = [check_f["rect"][0], check_f["rect"][1], box_width, check_f["rect"][3]]
    box_layer = _add_material(materials, {"id": "checkbox-box", "ownerId": "remember-checkbox", "type": "CheckBox"}, mark_rect, "Observed checkbox box viewport.", marker)
    mark_layer = _add_material(materials, {"id": "checkbox-mark", "ownerId": "remember-checkbox", "type": "CheckBox"}, mark_rect, "Contract-derived conventional check mark, shown only in the checked state.", marker)
    bindings.append(_appearance_binding(check_node, [{"role": "box", "layerId": box_layer}, {"role": "mark", "layerId": mark_layer}],
        {"checkbox": {"labelLayout": {"coordinateSpace": "target-component-local", "x": check_f["labelBounds"][0]-check_f["rect"][0], "y": check_f["labelBounds"][1]-check_f["rect"][1], "width": check_f["labelBounds"][2], "height": check_f["labelBounds"][3]}}}))
    for button_f in footer_f["buttons"]:
        cid = "button-" + button_f["role"]
        button = append(panel_node, _node(cid, "Button", _global(button_f["rect"], panel_rect), {"label": button_f["label"], "enabled": True, "style": _style(colors["button"], colors["border"], colors["buttonText"], fs["button"], radius=theme["shape"]["cornerRadiusPx"], border_width=theme["shape"]["borderWidthPx"])} , []))
        layer = _add_material(materials, button, button_f["rect"], f"{button_f['role']} footer action button.", marker)
        bindings.append(_appearance_binding(button, [{"role": "background", "layerId": layer}], {"button": {"labelLayout": {"coordinateSpace": "target-component-local", "x": button_f["labelBounds"][0]-button_f["rect"][0], "y": button_f["labelBounds"][1]-button_f["rect"][1], "width": button_f["labelBounds"][2], "height": button_f["labelBounds"][3]}}}))
    slogan = footer_f["slogan"]
    slogan_node = append(panel_node, _text("slogan", slogan["text"], _global(slogan["bounds"], panel_rect), colors["muted"], fs["slogan"]))
    # Selected-name value projection; runtime text remains an authored fallback.
    value_text = {"version": "1.1", "bindings": [{"sourceId": "shop-list", "targetId": "selected-name",
        "parts": [selected_f["prefix"], {"field": "selectedId", "items": [{"itemId": item["id"], "text": item["name"]} for item in source_order], "emptyText": selected_f["emptyText"]}]}]}
    # Linkage extensions operate over the same single explicit row set.
    runtime = facts["runtimeDerivations"]
    linkage = {"version": "1.0", "pipelines": [{"listId": "shop-list", "items": [{"itemId": item["id"], "searchText": item["searchText"], "category": item["category"], "unitPrice": item["unitPrice"]} for item in source_order],
        "search": {"inputId": "search-input", "match": runtime["search"]["match"], "caseSensitive": runtime["search"]["caseSensitive"]},
        "category": {"tabsId": "shop-tabs", "map": [{"optionId": tab["id"], "category": tab["category"]} for tab in tabs_f["items"]]},
        "sort": {"selectId": "sort-select", "map": [{"optionId": option["value"], "field": option["field"], "direction": option["direction"]} for option in facts["sort"]["options"]]},
        "selectionOnFilter": runtime["selectionOnFilter"],
        "quantity": {"decrementId": "quantity-minus", "incrementId": "quantity-plus", "textId": "quantity-value", "initial": qty_f["value"], "min": qty_bounds["min"], "max": qty_bounds["max"], "step": qty_bounds["step"], "onSelectionChange": runtime["quantityOnSelectionChange"]},
        "total": {"textId": "shop-total", "operation": "multiply", "fractionDigits": total_f["fractionDigits"], "grouping": total_f["grouping"], "prefix": total_f["prefix"], "suffix": total_f["suffix"], "emptyText": total_f["emptyText"]},
        "purchase": {"buttonId": "button-purchase", "emptySelection": runtime["purchaseEmptySelection"]}}]}
    document = {"schemaVersion": "0.2", "id": "shop-facts-native", "canvas": {"width": width, "height": height}, "root": root,
                "valueTextBindings": value_text, "componentLinkages": linkage,
                "linkageState": {"version": "1.0", "quantities": [{"listId": "shop-list", "value": qty_f["value"]}]}}

    nodes = list(_walk(root))
    # Required native image/background + state coverage comes from the tree.
    for node in nodes:
        if node["type"] == "Image" and node["id"] not in {m["componentId"] for m in materials}:
            raise ContractError("SHOP_FACTS_IMAGE_MATERIAL_MISSING")
    # Input text state facts are serialized independently from runtime linkage.
    reference_state_rows = []
    for node in nodes:
        kind, cid = node["type"], node["id"]
        if kind == "Input":
            reference_state_rows.append({"componentId": cid, "componentType": kind, "fields": {"value": input_fields["value"], **{k: input_fields[k] for k in ("focused", "selectionStart", "selectionEnd", "selectionDirection", "caretVisible")}}})
        elif kind == "Tabs":
            reference_state_rows.append({"componentId": cid, "componentType": kind, "fields": {"activeId": {"status": "observed", "value": node["props"]["activeId"], "evidence": "The source-selected category tab is recorded in compact facts."}}})
        elif kind == "Select":
            reference_state_rows.append({"componentId": cid, "componentType": kind, "fields": {"selectedId": {"status": "observed", "value": node["props"]["selectedId"], "evidence": "The source-selected sort option is recorded in compact facts."}, "popupOpen": {"status": "observed", "value": False, "evidence": "The source screenshot shows the sort menu closed."}}})
        elif kind == "List":
            reference_state_rows.append({"componentId": cid, "componentType": kind, "fields": {"selectedId": {"status": "observed", "value": node["props"]["selectedId"], "evidence": "The source-highlighted row is recorded in compact facts."}}})
        elif kind == "CheckBox":
            reference_state_rows.append({"componentId": cid, "componentType": kind, "fields": {"checked": {"status": "observed", "value": node["props"]["checked"], "evidence": "The source checkbox state is recorded in compact facts."}}})
        elif kind == "Button":
            # Action buttons do not have author-observed transient pointer states.
            continue
    # Button is absent from reference_delivery.FIELDS, and native only covers stateful FIELDS.
    reference_state = {"kind": "ui-reference-state", "schemaVersion": "1.1", "components": reference_state_rows}
    stateful_types = {"Button", "Tabs", "Input", "Select", "List", "CheckBox"}
    state_evidence = {}
    for node in nodes:
        kind, cid = node["type"], node["id"]
        if kind not in stateful_types: continue
        if kind == "Tabs": state_names = [tab["id"] for tab in node["props"]["tabs"]]
        elif kind == "Select": state_names = [option["id"] for option in node["props"]["options"]]
        elif kind == "List": state_names = [item["id"] for item in node["props"]["items"]]
        elif kind == "CheckBox": state_names = ["off", "on"]
        elif kind == "Button": state_names = ["default", "hover", "pressed"]
        else: state_names = ["empty", "filled", "focused", "disabled"] if node["props"]["value"] else ["empty", "focused", "disabled"]
        state_evidence[cid] = {"states": {state_name: {"basis": "observed" if state_name in (node["props"].get("activeId"), node["props"].get("selectedId"), "on" if node["props"].get("checked") else "off", "empty" if kind == "Input" and not node["props"]["value"] else "filled" if kind == "Input" else "default") else "contract-derived", "region": [node["layout"][k] for k in ("x", "y", "width", "height")], "note": "Observed initial source state or a contract-derived interaction state; no alternate screenshot is asserted."} for state_name in state_names}, "relations": {}}
    # Give both quantity buttons explicit role/behavior evidence.
    for cid in ("quantity-minus", "quantity-plus"):
        state_evidence[cid]["relations"] = {"background": {"mode": "shared", "note": "One authored button surface is used for runtime feedback states."}}

    visual_texts = []
    required_text_ids = []
    text_specs = []
    def add_text_observation(cid: str, text: str, bounds: list[int], note: str) -> None:
        required_text_ids.append(cid)
        text_specs.append({"componentId": cid, "text": text, "minFontSize": fs["body"], "region": list(bounds),
                           "geometry": {"version": "1.0", "referenceBounds": list(bounds), "maxCenterOffset": [2, 2], "widthRatio": [0.90, 1.10], "evidence": note}})
    add_text_observation("shop-title", panel["title"]["text"], title_rect, "Exact title text and source bounds are supplied in shop facts.")
    if subtitle_node is not None: add_text_observation("shop-subtitle", panel["subtitle"]["text"], panel["subtitle"]["bounds"], "Exact subtitle text and source bounds are supplied in shop facts.")
    add_text_observation("balance-text", balance["text"], balance["bounds"], "Exact balance text and source bounds are supplied in shop facts.")
    for tab in tabs_f["items"]:
        visual_texts.append({"componentId": "shop-tabs", "text": tab["label"], "minFontSize": fs["tab"], "region": tab["labelBounds"]})
        # Tabs controls are owner-rendered text, so geometry binds to owner id.
        if "shop-tabs" not in required_text_ids:
            required_text_ids.append("shop-tabs")
            text_specs.append({"componentId": "shop-tabs", "text": tab["label"], "geometry": {"version": "1.0", "referenceBounds": tab["labelBounds"], "maxCenterOffset": [2, 2], "widthRatio": [0.90, 1.10], "evidence": "Exact tab label and source bounds are supplied in shop facts."}})
    if search_f["value"] or search_f["placeholder"]:
        display_input = search_f["value"] or search_f["placeholder"]
        visual_texts.append({"componentId": "search-input", "text": display_input, "minFontSize": fs["body"], "region": search_f["textBounds"]})
        required_text_ids.append("search-input")
        text_specs.append({"componentId": "search-input", "text": display_input, "geometry": {"version": "1.0", "referenceBounds": search_f["textBounds"], "maxCenterOffset": [2, 2], "widthRatio": [0.90, 1.10], "evidence": "Exact input value/placeholder and source bounds are supplied in shop facts."}})
    for item in source_order:
        i = source_order.index(item)
        row_base = [rows_f["viewport"][0], rows_f["viewport"][1] + i * rows_f["sourcePitchPx"]]
        for key, role in (("nameRect", "name"), ("descriptionRect", "description"), ("priceRect", "price")):
            rect = [row_base[0] + template[key][0], row_base[1] + template[key][1], template[key][2], template[key][3]]
            cid = f"row-{role}-{item['id']}"
            value = item["name"] if role == "name" else item["description"] if role == "description" else item["priceText"]
            add_text_observation(cid, value, rect, "Exact list-row text and the shared source template bounds are supplied in shop facts.")
    add_text_observation("selected-name", selected_f["text"], selected_f["bounds"], "Exact selected-name string and source bounds are supplied in shop facts.")
    add_text_observation("quantity-value", str(qty_f["value"]), qty_f["valueTextBounds"], "Quantity value and source bounds are supplied in shop facts.")
    add_text_observation("shop-total", total_f["text"], total_f["bounds"], "Exact total string and source bounds are supplied in shop facts.")
    add_text_observation("remember-checkbox", check_f["label"], check_f["labelBounds"], "Exact checkbox label and source bounds are supplied in shop facts.")
    for button_f in footer_f["buttons"]:
        add_text_observation("button-" + button_f["role"], button_f["label"], button_f["labelBounds"], "Exact button label and source bounds are supplied in shop facts.")
    add_text_observation("slogan", slogan["text"], slogan["bounds"], "Exact slogan and source bounds are supplied in shop facts.")
    for option in facts["sort"]["options"]:
        visual_texts.append({"componentId": "sort-select", "text": option["label"], "minFontSize": fs["sort"], "region": sort_f["labelBounds"]})
    required_text_ids.append("sort-select")
    text_specs.append({"componentId": "sort-select", "text": next(o["label"] for o in facts["sort"]["options"] if o["value"] == facts["sort"]["selectedValue"]),
                       "geometry": {"version": "1.0", "referenceBounds": sort_f["labelBounds"], "maxCenterOffset": [2, 2], "widthRatio": [0.90, 1.10], "evidence": "Exact selected sort label and source bounds are supplied in shop facts."}})
    visual_texts.extend(text_specs)

    # Explicitly derived semantics and relationships remain inspectable.
    mapping = {"coordinateSpace": "raw-image-pixel-edges-to-runtime-canvas", "sourceSize": canvas, "targetSize": canvas,
               "crop": [0, 0, *canvas], "rotationDegrees": 0, "flipX": False, "flipY": False,
               "scale": [1, 1], "offset": [0, 0]}
    all_nodes = list(_walk(root))
    acceptance = {"kind": "ui-acceptance-scope", "schemaVersion": "1.0", "referenceState": "reference/reference-state.json",
                  "components": [{"componentId": node["id"], "mode": "compare", "reason": "Explicit shop-facts source geometry target; visual acceptance remains pending."} for node in all_nodes],
                  "derivedTestStates": [{"componentId": cid, "basis": "contract-derived", "description": "Interaction state is derived by the shop linkage contract; it is not asserted as an observed source state."} for cid in state_evidence],
                  "human_visual_acceptance": False}
    profile_map = {"Container": ["base", "nested-children"], "Panel": ["base", "optional-header", "nested-children"],
                   "Text": ["base", "system-font"], "Image": ["base", "contain"], "Button": ["base", "runtime-feedback", "per-line-text-layout"],
                   "Tabs": ["base", "runtime-feedback", "component-linkages-v1"], "Input": ["base", "runtime-editing", "component-linkages-v1"],
                   "Select": ["base", "runtime-feedback", "component-linkages-v1"], "List": ["base", "runtime-feedback", "component-linkages-v1", "item-contents-v1"], "CheckBox": ["base", "runtime-feedback"]}
    capabilities = [{"id": node["id"], "type": node["type"], "profiles": list(profile_map[node["type"]])} for node in all_nodes]
    # List-linkage extension profiles belong to their participating components;
    # item contents are declared only on the List owner.
    from .document_extensions import check_extensions
    # Extension checking is performed by the official native compiler.

    # Native appearance layer registration remains source-coordinate aligned.
    appearance = {"registration": {"sourceCanvas": {"width": width, "height": height}, "targetCanvas": {"width": width, "height": height}, "transform": {"scale": 1, "offset": {"x": 0, "y": 0}}}, "bindings": bindings}
    # Per-part appearance state plans use the strict target-local coordinate vocabulary.
    # Data-only state recipes deliberately carry no old sample IDs or assets.
    state_evidence_doc = {"kind": "ui_state_evidence_v1", "components": state_evidence}
    base_doc = document
    # CheckBox and Button state text geometry is represented by the native owner,
    # and all text observations identify complete source bounds.
    layout_requirements = {"kind": "ui_layout_requirements_v1",
        "panels": [{"componentId": "shop-panel", "appearance": "required", "reason": "The source shop uses a crowned panel surface."}],
        "selects": [{"componentId": "sort-select", "surface": "opaque", "reason": "The derived sort menu uses an explicit opaque content surface."}],
        "buttons": [{"componentId": "button-back", "textProfile": "single-style", "reason": "Observed back button text uses its explicit source bounds."},
                    {"componentId": "button-purchase", "textProfile": "single-style", "reason": "Observed purchase button text uses its explicit source bounds."},
                    {"componentId": "quantity-minus", "textProfile": "single-style", "reason": "Observed minus label uses its explicit control bounds."},
                    {"componentId": "quantity-plus", "textProfile": "single-style", "reason": "Observed plus label uses its explicit control bounds."}],
        "textBackgrounds": [{"componentId": node["id"], "drawBackground": False, "reason": "Text is rendered as system typography over its parent control."} for node in all_nodes if node["type"] == "Text"]}
    spacing = {"version": "1.1", "panelFooters": [{"panelId": "shop-panel", "componentIds": ["shop-footer"], "innerBottom": panel_rect[3], "minimumGap": 0, "evidence": "The footer container aligns to the observed panel bottom."}], "scrollBottomSpaces": [], "nonFooterButtons": {}}
    stateful_without_panel = {"Panel"}
    for node in all_nodes:
        if node["type"] == "Panel":
            # Panel is part of the state evidence schema internally but not the separate matrix.
            continue
    request = {"kind": "ui_native_delivery_input_v1", "version": "1.2", "referenceSha256": reference_sha,
        "document": base_doc, "materials": materials,
        "boardPolicies": {"shop-product-icons": {"version": "1.2", "mode": "foreground-gap-row", "target_padding": 2, "max_canvas_aspect_error": 0.15}},
        "appearance": appearance, "capabilities": capabilities,
        "referenceState": reference_state, "acceptanceScope": acceptance, "referenceMapping": mapping,
        "layoutSpacing": spacing, "layoutRequirements": layout_requirements,
        "visualObservations": {"kind": "ui_visual_observations_v1", "texts": visual_texts, "dialogs": [], "requiredTextGeometryIds": list(dict.fromkeys(required_text_ids)),
                               "sourceUnknowns": copy.deepcopy(facts["observation"]["unknowns"])},
        "stateEvidence": state_evidence_doc, "visibleGeometryRequirements": [], "derivedGlyphs": glyph_recipes}
    from .shop_facts_rendering import finish_rendering
    from .shop_facts_contracts import finalize_request
    return finalize_request(facts, finish_rendering(facts, request))


def _add_material_for_text_placeholder(materials: list[dict], component_id: str, viewport: list[int], index: int,
                                        pitch: int, local_rect: list[int], marker: str, text: str) -> str:
    # Text has no raster material in the native contract; its appearance binding
    # is represented as a source-geometry text role with no material.  This
    # helper is not used by the compiler's material catalog.
    raise ContractError("SHOP_FACTS_TEXT_MATERIAL_INTERNAL")


def _walk(node: dict):
    yield node
    for child in node.get("children", []):
        yield from _walk(child)


def synthetic_facts(source_sha256: str, canvas: list[int] | dict[str, int], variant: str = "a") -> dict:
    """Small deterministic facts fixture; caller creates matching PNG bytes."""
    size = [canvas["width"], canvas["height"]] if isinstance(canvas, dict) else list(canvas)
    width, height = size
    scale = min(width / 640, height / 480)
    def r(x: float, y: float, w: float, h: float) -> list[int]:
        return [round(x * scale), round(y * scale), max(1, round(w * scale)), max(1, round(h * scale))]
    item_id = "cargo" if variant == "a" else "compass"
    name = "Cargo Crate" if variant == "a" else "Map Compass"
    price, qty = (25, 2) if variant == "a" else (40, 1)
    total_text = f"Total: {price * qty} G"
    panel_rect = r(24, 18, 592, 444)
    header_rect = r(24, 18, 592, 62)
    tabs_rect = r(40, 86, 552, 44)
    rows_view = r(40, 180, 512, 130)
    footer_rect = r(40, 326, 512, 120)
    row_h = max(38, round(54 * scale)); pitch = max(row_h, round(58 * scale))
    local = lambda x,y,w,h: [round(x*scale),round(y*scale),max(1,round(w*scale)),max(1,round(h*scale))]
    root_white = "#303740"
    return {
      "kind": KIND, "version": VERSION, "source": {"sha256": source_sha256, "canvas": size},
      "observation": {"basis": "single-static-shop-screen", "unknowns": []},
      "background": {"semantics": "A quiet muted teal-blue room background behind the shop panel.", "rect": [0,0,width,height]},
      "panel": {"semantics": "A centered slate shop panel with a shallow crown/header band.", "rect": panel_rect, "headerRect": header_rect,
        "title": {"text": "Supply Depot" if variant == "a" else "Travel Store", "bounds": r(40,24,220,40)},
        "subtitle": {"text": "Choose equipment" if variant == "a" else None, "bounds": r(40,54,220,18) if variant == "a" else None},
        "balance": {"text": "320" if variant == "a" else "480", "bounds": r(484,24,48,28), "currencyRect": r(536,24,30,30)}},
      "theme": {"colors": {"canvas":"#27343B","panel":root_white,"text":"#F8F3E7","muted":"#C9D1D1","accent":"#5DA6BF","selected":"#3F829A","button":"#376F82","buttonText":"#FFFFFF","activeTabText":"#FFFFFF","quantityText":"#F8F3E7","border":"#52656A"},
        "fontSizesPx": {"title":22,"subtitle":14,"body":14,"price":14,"footer":14,"button":14,"tab":14,"checkbox":14,"slogan":12,"quantity":14,"sort":13,"itemName":14},
        "shape": {"borderWidthPx":1,"cornerRadiusPx":8}},
      "tabs": {"rect": tabs_rect, "items": [
        {"id":"all","label":"ALL","labelBounds":r(70,96,44,20),"glyphDescription":"four-square grid symbol","glyphBounds":r(48,98,18,18),"glyphPaletteRects":{"normal":r(4,4,3,3),"active":r(8,4,3,3)},"category":None,"selected":True,"bounds":r(40,86,92,44)},
        {"id":"gear","label":"GEAR","labelBounds":r(168,96,48,20),"glyphDescription":"crossed tool silhouettes","glyphBounds":r(144,98,18,18),"glyphPaletteRects":{"normal":r(4,4,3,3),"active":r(8,4,3,3)},"category":"gear","selected":False,"bounds":r(132,86,92,44)}]},
      "search": {"rect":r(40,138,250,34),"iconBounds":None,"iconDescription":None,"textBounds":r(52,144,220,22),"placeholder":"Search supplies","value":"",
        "editingState": {key:{"status":"unknown","reason":UNKNOWN_TEXT} for key in ("focused","caretVisible","selectionStart","selectionEnd","selectionDirection")}},
      "sort": {"rect":r(420,138,132,34),"labelBounds":r(428,144,88,22),"indicatorBounds":r(526,148,14,14),"selectedValue":"price-asc","popupRect":r(420,172,132,64),"popupContentRect":r(424,174,124,60),"optionRowHeightPx":30,
        "options":[{"label":"Price ↑","value":"price-asc","field":"unitPrice","direction":"asc"},{"label":"Name A–Z","value":"name-asc","field":"searchText","direction":"asc"}],"evidence":"The dropdown is closed and its visible selected label and explicit option labels support this bounded derived menu."},
      "rows": {"viewport":rows_view,"sourcePitchPx":pitch,"template":{"rowHeightPx":row_h,"imageRect":local(8,8,38,38),"nameRect":local(56,6,190,18),"descriptionRect":local(56,26,190,16),"currencyRect":local(350,12,30,30),"priceRect":local(390,16,60,22),"markRect":local(472,12,24,24)},
        "items":[{"id":item_id,"name":name,"description":"Packed travel provisions","priceText":str(price),"searchText":name+" Packed travel provisions","unitPrice":price,"category":"gear","iconDescription":"a small brown travel container","selected":True}]},
      "sharedCurrency": {"sourceRect":r(390,192,30,30),"description":"A small round gold coin with a dark stamped center.","evidence":"The same coin design appears at the header balance and beside row prices."},
      "footer": {"rect":footer_rect,"selectedName":{"text":"Selected: "+name,"bounds":r(48,336,180,22),"prefix":"Selected: ","emptyText":"—"},
        "quantity":{"minusRect":r(190,378,24,28),"valueRect":r(218,378,40,28),"valueTextBounds":r(230,382,16,20),"plusRect":r(262,378,24,28),"value":qty},
        "total":{"text":total_text,"bounds":r(342,336,110,22),"prefix":"Total: ","suffix":" G","fractionDigits":0,"grouping":"none","emptyText":"—"},
        "checkbox":{"rect":r(48,414,190,26),"labelBounds":r(74,416,164,20),"label":"Remember selection","checked":False},
        "buttons":[{"rect":r(340,378,96,30),"labelBounds":r(350,383,76,20),"label":"Back","role":"back","textColor":"#FFFFFF"},{"rect":r(444,378,108,30),"labelBounds":r(454,383,88,20),"label":"Purchase","role":"purchase","textColor":"#FFFFFF"}],
        "slogan":{"text":"Ready for the journey","bounds":r(232,418,102,20)}},
      "runtimeDerivations": {"categoriesEvidence":"The visible ALL tab and complete supplied item rows establish the initial all-category list; GEAR owns the gear category.",
        "quantityBounds":{"min":1,"max":20,"step":1,"evidence":"The observed control has decrement and increment affordances and the explicitly supplied safe range is 1 through 20."},
        "rowSpacing":{"outputPitchPx":pitch,"evidence":None},"search":{"match":"contains","caseSensitive":False,"evidence":"The profile uses literal case-insensitive contains search over the explicitly supplied searchText field."},
        "selectionOnFilter":"clear","quantityOnSelectionChange":"reset","purchaseEmptySelection":"disabled"}}
