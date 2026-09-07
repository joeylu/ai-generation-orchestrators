"""Named PNG delivery with bounded streaming archive I/O and readback checks."""
from pathlib import Path
import hashlib
import shutil
import uuid
import zipfile

from .assembly import inspect_delivery
from .common import read_json, require, safe_relative, sha256, write_json
from .contract import identifier


def export_png_zip(delivery: Path, *, additional_export: bool = False) -> dict:
    delivery = delivery.resolve()
    inspect_delivery(delivery)
    scene = read_json(delivery / "scene.json")
    require(scene["document"]["format"] == "png_zip" or additional_export, "PNG_ZIP_PLAN_REQUIRED")
    name = scene["document"]["name"]
    identifier(name)
    draft = scene.get("delivery_policy") == "unreviewed_draft"
    output = delivery / (name + (".draft.zip" if draft else ".zip"))
    require(not output.exists(), "PNG_ZIP_EXISTS")
    members = {"scene.json": sha256(delivery / "scene.json"),
               "delivery.json": sha256(delivery / "delivery.json"),
               scene["preview"]: scene["preview_sha256"]}
    layer_names = set()
    for group in scene["tree"]:
        for layer in group["children"]:
            identifier(layer["id"])
            require(layer["png"] == f"layers/{layer['id']}.png"
                    and layer["png"] not in layer_names, "PNG_ZIP_LAYER_NAME")
            layer_names.add(layer["png"])
            members[layer["png"]] = layer["sha256"]
    qa = delivery / "automated-visual-qa.json"
    if qa.exists():
        members[qa.name] = sha256(qa)
    staged = output.with_name(f".{uuid.uuid4().hex}.zip")
    try:
        with zipfile.ZipFile(staged, "x", compression=zipfile.ZIP_STORED) as archive:
            for relative in sorted(members):
                source = safe_relative(delivery, relative)
                require(sha256(source) == members[relative], "PNG_ZIP_SOURCE_CHANGED")
                info = zipfile.ZipInfo(relative, date_time=(1980, 1, 1, 0, 0, 0))
                info.external_attr = 0o100644 << 16
                with source.open("rb") as reader, archive.open(info, "w", force_zip64=True) as writer:
                    shutil.copyfileobj(reader, writer, length=1024 * 1024)
        with zipfile.ZipFile(staged) as archive:
            require(archive.namelist() == sorted(members), "PNG_ZIP_INVENTORY_CHANGED")
            for relative, expected in members.items():
                digest = hashlib.sha256()
                with archive.open(relative) as reader:
                    for chunk in iter(lambda: reader.read(1024 * 1024), b""):
                        digest.update(chunk)
                require(digest.hexdigest() == expected, "PNG_ZIP_BYTES_CHANGED")
        # Exclusive final creation avoids overwriting another completed export.
        with staged.open("rb") as reader, output.open("xb") as writer:
            shutil.copyfileobj(reader, writer, length=1024 * 1024)
    finally:
        staged.unlink(missing_ok=True)
    result = {"kind": "ai_ui_decomposition_png_zip_export_v1", "status": "archive_roundtrip_passed",
              "source_document_format": scene["document"]["format"], "additional_export": additional_export,
              "file": output.name, "zip_sha256": sha256(output), "pixel_layers": len(layer_names),
              "delivery_policy": "unreviewed_draft" if draft else "reviewed",
              "visual_review": "not_performed" if draft else "human_accepted"}
    write_json(delivery / "png-zip-export.json", result)
    return result
