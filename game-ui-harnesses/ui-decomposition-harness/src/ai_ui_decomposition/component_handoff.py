"""Package one decomposition archive plus explicit UI Component contracts."""
from __future__ import annotations

from pathlib import Path
import base64
import hashlib
import io
import math
import re
import shutil
import uuid
import zipfile

from PIL import Image

from .assembly import inspect_delivery
from .common import ContractError, load_verified_image, read_json, require, safe_relative, sha256, write_json


from .switch_state_images import validate_state_images
from .scrollbar_insets import validate_insets
from .scrollbar_thumb_slices import validate_thumb_slices
from .select_option_icons import validate_option_icons
from .select_menu_highlights import validate_menu_highlights
from .tabs_layout import validate_tabs_layout

MAX_COMPONENT_BUNDLE_BYTES = 67_108_864
def _validate_tabs_background(node):
    if node.get('type')=='Tabs' and 'drawBackground' in node.get('props',{}):
        require(type(node['props']['drawBackground']) is bool,'COMPONENT_HANDOFF_TABS_BACKGROUND_BOOLEAN')

INTERACTIVE_COMPONENT_TYPES = {
    "Button", "Switch", "CheckBox", "RadioGroup", "Input", "Select", "Slider",
    "ScrollView", "List", "Dialog", "Tabs",
}


def _validate_state_text_colors(binding: dict) -> None:
    """Preserve authored colors verbatim; never infer them from raster brightness."""
    for row in binding.get("bindings", []):
        states = row.get("states", {})
        require(isinstance(states, dict), "COMPONENT_HANDOFF_STATES_INVALID")
        if 'scrollView' in states:
            state=states['scrollView']
            require(row.get('componentType') == 'ScrollView' and isinstance(state,dict), 'COMPONENT_HANDOFF_STATE_TYPE_MISMATCH')
            require(set(state) <= {'thumbPositions','scrollbarInsets','scrollbarThumbSlices'}, 'COMPONENT_HANDOFF_UNKNOWN_STATE_FIELD')
            if 'scrollbarInsets' in state: validate_insets(state['scrollbarInsets'])
            if 'scrollbarThumbSlices' in state:validate_thumb_slices(state['scrollbarThumbSlices'],has_insets='scrollbarInsets' in state)
        if 'switch' in states:
            state=states['switch']
            require(row.get('componentType') == 'Switch' and isinstance(state,dict), 'COMPONENT_HANDOFF_STATE_TYPE_MISMATCH')
            require(set(state) <= {'thumbPositions','labelLayout','stateLabelLayouts','stateImages'}, 'COMPONENT_HANDOFF_UNKNOWN_STATE_FIELD')
            validate_state_images(row)
            if 'stateLabelLayouts' in state:
                layouts=state['stateLabelLayouts']
                require(isinstance(layouts,dict) and set(layouts)=={'on','off'}, 'COMPONENT_HANDOFF_SWITCH_LABEL_LAYOUT_INVALID')
                for layout in layouts.values():
                    require(isinstance(layout,dict) and set(layout)=={'coordinateSpace','x','y','width','height'} and layout['coordinateSpace']=='target-component-local', 'COMPONENT_HANDOFF_SWITCH_LABEL_LAYOUT_INVALID')
                    require(all(type(layout[k]) in (int,float) and math.isfinite(layout[k]) and layout[k] >= 0 for k in ('x','y','width','height')) and layout['width']>0 and layout['height']>0,'COMPONENT_HANDOFF_SWITCH_LABEL_LAYOUT_INVALID')
        for kind, component, field, allowed in (
            ("select", "Select", "fieldTextColor", {"labelLayout", "popupPlacement", "popupContentLayout", "fieldTextColor", "optionIcons", "menuHighlights"}),
            ("tabs", "Tabs", "activeTextColor", {"headerHeight", "labelLayout", "hitArea", "activeTextColor", "icons", "items", "layoutPolicy"}),
        ):
            if kind not in states:
                continue
            state = states[kind]
            require(row.get("componentType") == component and isinstance(state, dict),
                    "COMPONENT_HANDOFF_STATE_TYPE_MISMATCH")
            require(set(state) <= allowed, "COMPONENT_HANDOFF_UNKNOWN_STATE_FIELD")
            if field in state:
                color = state[field]
                require(isinstance(color, str) and re.fullmatch(r"#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})", color) is not None,
                        f"COMPONENT_HANDOFF_STATE_COLOR_INVALID:{field}")


def _validate_bound_layers(delivery: Path, binding: dict, document: dict) -> None:
    """Inspect bound PNG bytes even when the semantic target has no appearance yet."""
    scene = read_json(delivery / "scene.json")
    layers = {row["id"]: row for group in scene["tree"] for row in group["children"]}
    nodes = {node.get("id"): node for node in _walk_component_nodes(document.get("root"))}
    for row in binding.get("bindings", []):
        node = nodes.get(row.get("componentId"))
        require(isinstance(node, dict), "COMPONENT_HANDOFF_UNKNOWN_COMPONENT")
        require(row.get("componentType") == node.get("type"),
                "COMPONENT_HANDOFF_COMPONENT_TYPE_MISMATCH")
        if node.get("type") not in INTERACTIVE_COMPONENT_TYPES:
            continue
        parts = row.get("parts")
        require(isinstance(parts, list) and parts, "COMPONENT_HANDOFF_BOUND_PARTS_REQUIRED")
        scroll=row.get('states',{}).get('scrollView',{})
        if 'scrollbarInsets' in scroll:
            by_role={p['role']:layers.get(p['layerId']) for p in parts}
            require(by_role.get('scrollbar-track') and by_role.get('scrollbar-thumb'), 'COMPONENT_HANDOFF_UNKNOWN_LAYER')
            scale=binding['registration']['transform']['scale']
            validate_insets(scroll['scrollbarInsets'],by_role['scrollbar-track']['size'][1]*scale,by_role['scrollbar-thumb']['size'][1]*scale)
        if 'scrollbarThumbSlices' in scroll:
            thumbs=[layers.get(p['layerId']) for p in parts if p['role']=='scrollbar-thumb']
            require(len(thumbs)==1 and thumbs[0] is not None,'COMPONENT_HANDOFF_UNKNOWN_LAYER')
            validate_thumb_slices(scroll['scrollbarThumbSlices'],thumbs[0]['size'][1],'scrollbarInsets' in scroll)
        images=validate_state_images(row,{key:l['size'] for key,l in layers.items()})
        referenced=parts+([{'layerId':pair[field]} for pair in (images['off'],images['on']) for field in ('trackLayerId','thumbLayerId')] if images else [])
        if node['type'] == 'Tabs':
            validate_tabs_layout(row.get('states', {}).get('tabs', {}), [t['id'] for t in node['props']['tabs']], node['layout']['width'], node['layout']['height'])
        if node['type'] == 'Select' and 'menuHighlights' in row.get('states', {}).get('select', {}):
            popup = [layers.get(p['layerId']) for p in parts if p['role'] == 'popup']
            require(len(popup) == 1 and popup[0] is not None, 'SELECT_MENU_HIGHLIGHTS_POPUP_REQUIRED')
            scale = binding['registration']['transform']['scale']
            validate_menu_highlights(row['states']['select'], len(node['props']['options']), [v*scale for v in popup[0]['size']])
        if node['type'] == 'Select' and 'optionIcons' in row.get('states', {}).get('select', {}):
            popup = [layers.get(p['layerId']) for p in parts if p['role'] == 'popup']
            require(len(popup) == 1 and popup[0] is not None, 'SELECT_OPTION_ICONS_POPUP_REQUIRED')
            scale = binding['registration']['transform']['scale']
            items = validate_option_icons(row['states']['select'], [o['id'] for o in node['props']['options']],
                                          layers, [v * scale for v in popup[0]['size']])
            referenced += [item['icon'] for item in items if item['icon'] is not None]
        for part in referenced:
            layer = layers.get(part.get("layerId"))
            require(isinstance(layer, dict), "COMPONENT_HANDOFF_UNKNOWN_LAYER")
            picture, evidence = load_verified_image(safe_relative(delivery, layer["png"]), layer["size"])
            require(evidence["sha256"] == layer["sha256"], "LAYER_CHANGED")
            minimum, maximum = picture.getchannel("A").getextrema()
            require(minimum == 0 and maximum > 0,
                    f"COMPONENT_HANDOFF_OPAQUE_INTERACTIVE_ASSET:{layer['id']}")


def _walk_component_nodes(root: object):
    pending = [root]
    while pending:
        node = pending.pop()
        if not isinstance(node, dict):
            continue
        yield node
        children = node.get("children")
        if isinstance(children, list):
            pending.extend(reversed(children))


def _appearance_resource_paths(value: object):
    if isinstance(value, dict):
        for child in value.values():
            yield from _appearance_resource_paths(child)
    elif isinstance(value, list):
        for child in value:
            yield from _appearance_resource_paths(child)
    elif isinstance(value, str) and value.lower().endswith(".png"):
        yield value


def _validate_canvas_layout_pairs(value: object, component_id: str,
                                  part_path: str = "appearance") -> None:
    if isinstance(value, dict):
        canvas, layout = value.get("canvas"), value.get("layout")
        if isinstance(canvas, dict) and isinstance(layout, dict):
            width, height = layout.get("width"), layout.get("height")
            source_width, source_height = canvas.get("width"), canvas.get("height")
            if all(isinstance(item, (int, float)) and item > 0
                   for item in (width, height, source_width, source_height)):
                cross_error = abs(width * source_height - height * source_width)
                require(cross_error <= max(width * source_height,
                                           height * source_width) * 0.001,
                        f"COMPONENT_HANDOFF_NON_UNIFORM_APPEARANCE_PART:"
                        f"{component_id}:{part_path}:{source_width}x{source_height}->"
                        f"{width}x{height}")
        for key, child in value.items():
            _validate_canvas_layout_pairs(child, component_id, f"{part_path}.{key}")
    elif isinstance(value, list):
        for index, child in enumerate(value):
            _validate_canvas_layout_pairs(child, component_id,
                                          f"{part_path}[{index}]")


def _validate_interactive_appearances(bundle: dict, root: object) -> None:
    paths: set[str] = set()
    for node in _walk_component_nodes(root):
        if node.get("type") not in INTERACTIVE_COMPONENT_TYPES:
            continue
        layout = node.get("layout")
        props = node.get("props")
        appearance = props.get("appearance") if isinstance(props, dict) else None
        if not isinstance(layout, dict) or not isinstance(appearance, dict):
            continue
        source = appearance.get("sourceCanvas")
        if isinstance(source, dict):
            width, height = layout.get("width"), layout.get("height")
            source_width, source_height = source.get("width"), source.get("height")
            if all(isinstance(value, (int, float)) and value > 0
                   for value in (width, height, source_width, source_height)):
                cross_error = abs(width * source_height - height * source_width)
                require(cross_error <= max(width * source_height, height * source_width) * 0.001,
                        f"COMPONENT_HANDOFF_NON_UNIFORM_APPEARANCE:{node.get('id')}:"
                        f"{source_width}x{source_height}->{width}x{height}")
        _validate_canvas_layout_pairs(appearance, str(node.get("id", "unknown")))
        paths.update(_appearance_resource_paths(appearance))

    resources = bundle.get("resources")
    if not paths:
        return
    require(isinstance(resources, list), "COMPONENT_HANDOFF_APPEARANCE_RESOURCE_REQUIRED")
    by_path = {row.get("path"): row for row in resources if isinstance(row, dict)}
    for path in sorted(paths):
        resource = by_path.get(path)
        require(isinstance(resource, dict),
                f"COMPONENT_HANDOFF_APPEARANCE_RESOURCE_REQUIRED:{path}")
        try:
            payload = base64.b64decode(resource.get("base64", ""), validate=True)
            picture = Image.open(io.BytesIO(payload))
            picture.load()
        except (ValueError, TypeError, OSError) as exc:
            raise ContractError(f"COMPONENT_HANDOFF_APPEARANCE_RESOURCE_INVALID:{path}") from exc
        require(hashlib.sha256(payload).hexdigest() == resource.get("sha256"),
                f"COMPONENT_HANDOFF_APPEARANCE_RESOURCE_CHANGED:{path}")
        require("A" in picture.getbands(),
                f"COMPONENT_HANDOFF_OPAQUE_INTERACTIVE_ASSET:{path}")
        minimum, maximum = picture.getchannel("A").getextrema()
        require(minimum == 0 and maximum > 0,
                f"COMPONENT_HANDOFF_OPAQUE_INTERACTIVE_ASSET:{path}")


def export_component_handoff(delivery: Path, component_bundle: Path,
                             appearance_binding: Path, *, reference_original: Path | None = None,
                             reference_state: Path | None = None, acceptance_scope: Path | None = None,
                             reference_mapping: Path | None = None, reference_derived: Path | None = None,
                             layout_spacing: Path | None = None) -> dict:
    delivery = delivery.resolve()
    receipt = inspect_delivery(delivery)
    export = read_json(delivery / "png-zip-export.json")
    require(export.get("kind") == "ai_ui_decomposition_png_zip_export_v1"
            and export.get("status") == "archive_roundtrip_passed", "PNG_ZIP_EXPORT_REQUIRED")
    decomposition = safe_relative(delivery, export.get("file"))
    require(decomposition.is_file() and sha256(decomposition) == export.get("zip_sha256"),
            "PNG_ZIP_EXPORT_CHANGED")

    component_bundle = component_bundle.resolve()
    appearance_binding = appearance_binding.resolve()
    require(component_bundle.is_file() and not component_bundle.is_symlink()
            and 0 < component_bundle.stat().st_size <= MAX_COMPONENT_BUNDLE_BYTES,
            "COMPONENT_BUNDLE_FILE_REQUIRED")
    bundle = read_json(component_bundle, max_bytes=MAX_COMPONENT_BUNDLE_BYTES)
    document = bundle.get("document")
    if isinstance(document, dict) and document.get("schemaVersion") == "0.2":
        root = document.get("root")
        props = root.get("props") if isinstance(root, dict) else None
        style = props.get("style") if isinstance(props, dict) else None
        require(not isinstance(style, dict) or style.get("opacity") != 0,
                "COMPONENT_HANDOFF_INVISIBLE_ROOT")
        for node in _walk_component_nodes(root):
            _validate_tabs_background(node)
            if node.get("type") not in INTERACTIVE_COMPONENT_TYPES:
                continue
            props = node.get("props")
            style = props.get("style") if isinstance(props, dict) else None
            require(not isinstance(style, dict) or style.get("opacity") != 0,
                    "COMPONENT_HANDOFF_INVISIBLE_INTERACTIVE")
        _validate_interactive_appearances(bundle, root)
    require(appearance_binding.is_file() and not appearance_binding.is_symlink(),
            "APPEARANCE_BINDING_FILE_REQUIRED")
    binding = read_json(appearance_binding)
    require(binding.get("kind") == "ui-appearance-binding"
            and binding.get("version") == "0.2", "APPEARANCE_BINDING_KIND")
    _validate_state_text_colors(binding)
    require(binding.get("deliveryDigest") == receipt["digest"],
            "APPEARANCE_BINDING_DELIVERY_MISMATCH")
    require(binding.get("sceneSha256") == sha256(delivery / "scene.json"),
            "APPEARANCE_BINDING_SCENE_MISMATCH")
    require(binding.get("archiveSha256") == sha256(decomposition),
            "APPEARANCE_BINDING_ARCHIVE_MISMATCH")
    if isinstance(document, dict) and document.get("schemaVersion") == "0.2":
        bindings = binding.get("bindings")
        bound_component_ids = {
            row.get("componentId") for row in bindings
            if isinstance(row, dict) and isinstance(row.get("componentId"), str)
        } if isinstance(bindings, list) else set()
        require(all(node.get("type") not in INTERACTIVE_COMPONENT_TYPES
                    or node.get("id") in bound_component_ids
                    for node in _walk_component_nodes(document.get("root"))),
                "COMPONENT_HANDOFF_INTERACTIVE_BINDING_REQUIRED")
        _validate_bound_layers(delivery, binding, document)

    draft = receipt.get("delivery_policy") == "unreviewed_draft"
    from .layout_spacing import require_export_spacing
    if isinstance(document,dict) and document.get('schemaVersion')=='0.2':
        spacing = require_export_spacing(document, read_json(layout_spacing) if layout_spacing is not None else None)
    else:
        require(layout_spacing is None,'SPACING_DOCUMENT_REQUIRED')
        spacing = {'status':'legacy_not_checked','human_visual_acceptance':False}
    output = delivery / ("ui.component-handoff.draft.zip" if draft
                         else "ui.component-handoff.zip")
    export_receipt = delivery / "component-handoff-export.json"
    require(not output.exists() and not export_receipt.exists(),
            "COMPONENT_HANDOFF_EXISTS")
    member_sources = {
        "appearance-binding.json": appearance_binding,
        "component.ui-bundle.json": component_bundle,
        f"decomposition/{decomposition.name}": decomposition,
    }
    manifest = {
        "kind": "ai_ui_component_handoff_v1",
        "status": "contracts_packaged_unreviewed_draft" if draft else "contracts_packaged_reviewed",
        "decomposition": {"path": f"decomposition/{decomposition.name}",
                          "sha256": sha256(decomposition)},
        "component_bundle": {"path": "component.ui-bundle.json",
                             "sha256": sha256(component_bundle)},
        "appearance_binding": {"path": "appearance-binding.json",
                               "sha256": sha256(appearance_binding)},
        "delivery_policy": receipt.get("delivery_policy"),
        "human_visual_acceptance": receipt.get("human_visual_acceptance"),
    }
    manifest_path = delivery / f".{uuid.uuid4().hex}.handoff.json"
    extra = {}
    reference_args = (reference_original, reference_state, acceptance_scope, reference_mapping)
    if any(value is not None for value in reference_args) or reference_derived is not None:
        require(all(value is not None for value in reference_args), 'REFERENCE_ARGUMENTS_REQUIRED')
        require(manifest['human_visual_acceptance'] is False, 'REFERENCE_DRAFT_REQUIRED')
        from .reference_delivery import reference_members
        extra, reference, unknown = reference_members(*reference_args, bundle, reference_derived)
        manifest.update(kind='ai_ui_component_handoff_v2', schemaVersion='2.0', reference=reference)
    staged = output.with_name(f".{uuid.uuid4().hex}.zip")
    try:
        write_json(manifest_path, manifest)
        member_sources["handoff.json"] = manifest_path
        with zipfile.ZipFile(staged, "x", compression=zipfile.ZIP_STORED) as archive:
            for relative in sorted(set(member_sources) | set(extra)):
                if relative in extra:
                    info = zipfile.ZipInfo(relative, date_time=(1980, 1, 1, 0, 0, 0))
                    info.external_attr = 0o100644 << 16
                    archive.writestr(info, extra[relative])
                    continue
                source = member_sources[relative]
                info = zipfile.ZipInfo(relative, date_time=(1980, 1, 1, 0, 0, 0))
                info.external_attr = 0o100644 << 16
                with source.open("rb") as reader, archive.open(info, "w", force_zip64=True) as writer:
                    shutil.copyfileobj(reader, writer, length=1024 * 1024)
        with zipfile.ZipFile(staged) as archive:
            require(archive.testzip() is None
                    and archive.namelist() == sorted(set(member_sources) | set(extra)),
                    "COMPONENT_HANDOFF_READBACK")
            for relative, source in member_sources.items():
                digest = hashlib.sha256()
                with archive.open(relative) as reader:
                    for chunk in iter(lambda: reader.read(1024 * 1024), b""):
                        digest.update(chunk)
                require(digest.hexdigest() == sha256(source),
                        "COMPONENT_HANDOFF_BYTES_CHANGED")
            require(all(archive.read(name) == data for name, data in extra.items()), 'REFERENCE_BYTES_CHANGED')
        with staged.open("rb") as reader, output.open("xb") as writer:
            shutil.copyfileobj(reader, writer, length=1024 * 1024)
    finally:
        staged.unlink(missing_ok=True)
        manifest_path.unlink(missing_ok=True)
    result = {"kind": "ai_ui_component_handoff_export_v1",
              "status": "archive_roundtrip_passed", "file": output.name,
              "sha256": sha256(output), "decomposition_sha256": sha256(decomposition),
              "delivery_policy": receipt.get("delivery_policy"),
              "human_visual_acceptance": receipt.get("human_visual_acceptance")}
    result['reference_evidence'] = 'complete' if extra else 'missing_reference_evidence'
    result['visual_comparison_ready'] = bool(extra) and not unknown
    result['layout_spacing'] = spacing
    write_json(export_receipt, result)
    return result
