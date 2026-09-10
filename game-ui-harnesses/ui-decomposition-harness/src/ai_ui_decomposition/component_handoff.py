"""Package one decomposition archive plus explicit UI Component contracts."""
from __future__ import annotations

from pathlib import Path
import hashlib
import shutil
import uuid
import zipfile

from .assembly import inspect_delivery
from .common import read_json, require, safe_relative, sha256, write_json


MAX_COMPONENT_BUNDLE_BYTES = 67_108_864
INTERACTIVE_COMPONENT_TYPES = {
    "Button", "Switch", "CheckBox", "RadioGroup", "Input", "Select", "Slider",
    "ScrollView", "List", "Dialog", "Tabs",
}


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


def export_component_handoff(delivery: Path, component_bundle: Path,
                             appearance_binding: Path) -> dict:
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
    bundle = read_json(component_bundle)
    document = bundle.get("document")
    if isinstance(document, dict) and document.get("schemaVersion") == "0.2":
        root = document.get("root")
        props = root.get("props") if isinstance(root, dict) else None
        style = props.get("style") if isinstance(props, dict) else None
        require(not isinstance(style, dict) or style.get("opacity") != 0,
                "COMPONENT_HANDOFF_INVISIBLE_ROOT")
        for node in _walk_component_nodes(root):
            if node.get("type") not in INTERACTIVE_COMPONENT_TYPES:
                continue
            props = node.get("props")
            style = props.get("style") if isinstance(props, dict) else None
            require(not isinstance(style, dict) or style.get("opacity") != 0,
                    "COMPONENT_HANDOFF_INVISIBLE_INTERACTIVE")
    require(appearance_binding.is_file() and not appearance_binding.is_symlink(),
            "APPEARANCE_BINDING_FILE_REQUIRED")
    binding = read_json(appearance_binding)
    require(binding.get("kind") == "ui-appearance-binding"
            and binding.get("version") == "0.2", "APPEARANCE_BINDING_KIND")
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

    draft = receipt.get("delivery_policy") == "unreviewed_draft"
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
    staged = output.with_name(f".{uuid.uuid4().hex}.zip")
    try:
        write_json(manifest_path, manifest)
        member_sources["handoff.json"] = manifest_path
        with zipfile.ZipFile(staged, "x", compression=zipfile.ZIP_STORED) as archive:
            for relative in sorted(member_sources):
                source = member_sources[relative]
                info = zipfile.ZipInfo(relative, date_time=(1980, 1, 1, 0, 0, 0))
                info.external_attr = 0o100644 << 16
                with source.open("rb") as reader, archive.open(info, "w", force_zip64=True) as writer:
                    shutil.copyfileobj(reader, writer, length=1024 * 1024)
        with zipfile.ZipFile(staged) as archive:
            require(archive.testzip() is None
                    and archive.namelist() == sorted(member_sources),
                    "COMPONENT_HANDOFF_READBACK")
            for relative, source in member_sources.items():
                digest = hashlib.sha256()
                with archive.open(relative) as reader:
                    for chunk in iter(lambda: reader.read(1024 * 1024), b""):
                        digest.update(chunk)
                require(digest.hexdigest() == sha256(source),
                        "COMPONENT_HANDOFF_BYTES_CHANGED")
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
    write_json(export_receipt, result)
    return result
