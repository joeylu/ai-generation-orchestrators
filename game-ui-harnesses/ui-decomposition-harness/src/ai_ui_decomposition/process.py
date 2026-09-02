from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw

from . import batch
from .common import digest, require, sha256, write_json
from .media import contain, matte_key, normalize, opaque_exact, resize_material


def process(run: Path) -> dict:
    frozen, plan = batch.load(run)
    state = batch.status(run)
    require(state["received"] + state["reused"] == len(frozen["requests"])
            and state["indeterminate"] == 0, "BATCH_INCOMPLETE")
    from .cached import verified_result
    for asset in frozen["requests"]:
        verified_result(run, asset)
    output = run / "materials"
    require(not output.exists(), "MATERIALS_EXIST")
    output.mkdir()
    reference = run / "input" / "reference.png"
    pictures: dict[str, Image.Image] = {}
    rows = []
    with Image.open(reference) as reference_image:
        reference_image = reference_image.convert("RGBA")
        for asset in (item for item in plan["assets"] if item["route"] != "reuse_scaled"):
            key = asset["id"]
            size = asset["output_size"]
            if asset["route"].startswith("generated_"):
                entry = frozen["requests"][key]
                raw = run / "requests" / entry["id"] / "raw.png"
                with Image.open(raw) as image:
                    source = image.convert("RGBA")
            elif asset["route"] == "source_crop":
                source = reference_image.crop(tuple(asset["source_region"]))
            if asset["output_mode"] == "keyed_component":
                material = matte_key(source, size)
            elif asset["output_mode"] == "opaque_canvas":
                material = opaque_exact(source, size)
            else:
                material = contain(source, size)
            pictures[key] = normalize(resize_material(material, asset))
        for asset in (item for item in plan["assets"] if item["route"] == "reuse_scaled"):
            material = contain(pictures[asset["source_asset"]], asset["output_size"])
            pictures[asset["id"]] = resize_material(material, asset)
        for asset in plan["assets"]:
            key = asset["id"]
            size = asset["output_size"]
            material = pictures[key]
            directory = output / key
            directory.mkdir()
            path = directory / "material.png"
            material.save(path)
            alpha = material.getchannel("A")
            rows.append({"asset": key, "path": path.relative_to(run).as_posix(),
                         "sha256": sha256(path), "size": size,
                         "route": asset["route"], "source_asset": asset.get("source_asset"),
                         "alpha_extrema": list(alpha.getextrema())})

    columns, cell_width, cell_height = 4, 280, 190
    rows_count = (len(rows) + columns - 1) // columns
    sheet = Image.new("RGB", (columns * cell_width, rows_count * cell_height), "#252932")
    draw = ImageDraw.Draw(sheet)
    for index, row in enumerate(rows):
        picture = pictures[row["asset"]].copy()
        picture.thumbnail((250, 145), Image.Resampling.LANCZOS)
        tile = Image.new("RGBA", (260, 150), "#dddddd")
        tile.alpha_composite(picture, ((260 - picture.width) // 2,
                                       (150 - picture.height) // 2))
        x = (index % columns) * cell_width + 10
        y = (index // columns) * cell_height + 28
        sheet.paste(tile.convert("RGB"), (x, y))
        draw.text((x, y - 20), row["asset"], fill="white")
    sheet_path = output / "contact-sheet.png"
    sheet.save(sheet_path)
    record = {"kind": "ai_ui_decomposition_materials_v1",
              "batch_digest": frozen["digest"], "plan_digest": digest(plan),
              "assets": rows, "count": len(rows),
              "contact_sheet": sheet_path.relative_to(run).as_posix(),
              "contact_sheet_sha256": sha256(sheet_path),
              "automatic_retries": 0, "automatic_visual_acceptance": False}
    record["digest"] = digest(record)
    write_json(output / "materials.json", record)
    return record


def review_template(run: Path) -> dict:
    materials = read_materials(run)
    review = {"kind": "ai_ui_decomposition_visual_review_v1",
              "decision": "pending", "plan_digest": materials["plan_digest"],
              "materials_digest": materials["digest"],
              "contact_sheet_sha256": materials["contact_sheet_sha256"],
              "reviewed_asset_ids": [], "notes": [],
              "automatic_visual_acceptance": False}
    write_json(run / "review.json", review)
    return review


def read_materials(run: Path) -> dict:
    from .common import read_json
    record = read_json(run / "materials" / "materials.json")
    require(record.get("kind") == "ai_ui_decomposition_materials_v1", "MATERIALS_KIND")
    body = {key: value for key, value in record.items() if key != "digest"}
    require(record.get("digest") == digest(body), "MATERIALS_CHANGED")
    for row in record["assets"]:
        path = run / row["path"]
        require(path.resolve().is_relative_to(run.resolve())
                and path.is_file() and sha256(path) == row["sha256"], "MATERIAL_CHANGED")
    sheet = run / record["contact_sheet"]
    require(sheet.is_file() and sha256(sheet) == record["contact_sheet_sha256"],
            "CONTACT_SHEET_CHANGED")
    return record
