"""Compile and materialize explicit monochrome Tabs glyph derivations.

The compiler samples only the caller-declared palette ROI in the verified
reference image. At materialization time, this module applies that fixed color
to the Alpha channel of the authenticated canonical glyph.
"""
from __future__ import annotations

import copy
import hashlib
from pathlib import Path

import numpy as np
from PIL import Image

from .common import (digest, identifier, load_verified_image, read_json, require,
                     safe_relative, sha256, write_json)


VERSION = "1.0"
KIND = "ui_planned_glyph_recipes_v1"
PLAN_MARKER = "native-planned-glyphs-v1:"
APPEARANCE_MARKER = "native-layer-binding-v1:"
REPORT_KIND = "ui_derived_glyphs_v1"


def _sample_palette(reference: Image.Image, rect: list[int]) -> tuple[list[int], str]:
    x, y, width, height = rect
    require(width >= 2 and height >= 2 and x >= 0 and y >= 0 and
            x + width <= reference.width and y + height <= reference.height,
            "NATIVE_GLYPH_PALETTE_RECT")
    patch = np.asarray(reference.crop((x, y, x + width, y + height)).convert("RGBA"))
    require(patch[:, :, 3].min() == 255, "NATIVE_GLYPH_PALETTE_NOT_OPAQUE")
    rgb = patch[:, :, :3].reshape(-1, 3)
    require(int(np.ptp(rgb, axis=0).max()) <= 12,
            "NATIVE_GLYPH_PALETTE_NOT_SOLID")
    color = np.rint(np.median(rgb, axis=0)).astype(np.uint8).tolist()
    return color, hashlib.sha256(patch.tobytes()).hexdigest()


def compile_recipes(request: dict, materials: dict[str, dict], document: dict,
                    appearance: dict, reference: Image.Image,
                    reference_sha256: str, reference_size: list[int]) -> dict | None:
    """Validate native 1.2 recipes and bind source palette evidence."""
    if request.get("version") != "1.2":
        require("derivedGlyphs" not in request, "NATIVE_GLYPH_VERSION")
        return None

    declarations = request.get("derivedGlyphs")
    require(isinstance(declarations, list) and len(declarations) <= 128,
            "NATIVE_GLYPH_DECLARATIONS")
    parts_by_layer: dict[str, tuple[dict, dict]] = {}
    for binding in appearance["bindings"]:
        for part in binding["parts"]:
            layer = part["layerId"]
            require(layer not in parts_by_layer, "NATIVE_GLYPH_LAYER_AMBIGUOUS")
            parts_by_layer[layer] = (binding, part)
    document_nodes: dict[str, dict] = {}

    def visit(node: dict) -> None:
        document_nodes[node["id"]] = node
        for child in node.get("children", []):
            visit(child)

    visit(document["root"])

    recipes: list[dict] = []
    targets: set[str] = set()
    canonicals: set[str] = set()
    for row in declarations:
        require(isinstance(row, dict) and set(row) == {
            "targetLayerId", "canonicalLayerId", "paletteReferenceRect", "evidence",
        }, "NATIVE_GLYPH_FIELDS")
        target_layer = identifier(row["targetLayerId"])
        canonical_layer = identifier(row["canonicalLayerId"])
        require(target_layer != canonical_layer and target_layer not in targets and
                canonical_layer not in canonicals,
                "NATIVE_GLYPH_DUPLICATE_OR_SELF_REFERENCE")
        require(target_layer in materials and canonical_layer in materials,
                "NATIVE_GLYPH_LAYER_UNKNOWN")
        require(target_layer in parts_by_layer and canonical_layer in parts_by_layer,
                "NATIVE_GLYPH_LAYER_UNBOUND")
        target_binding, target_part = parts_by_layer[target_layer]
        canonical_binding, canonical_part = parts_by_layer[canonical_layer]
        target = materials[target_layer]
        canonical = materials[canonical_layer]

        target_role, canonical_role = target_part["role"], canonical_part["role"]
        require(target["componentType"] == canonical["componentType"] == "Tabs" and
                target_binding["componentType"] == canonical_binding["componentType"] == "Tabs",
                "NATIVE_GLYPH_TABS_ONLY")
        require(target["componentId"] == canonical["componentId"] ==
                target_binding["componentId"] == canonical_binding["componentId"],
                "NATIVE_GLYPH_OWNER_MISMATCH")
        tab_id = target_part.get("tabId")
        require(isinstance(tab_id, str) and tab_id == canonical_part.get("tabId"),
                "NATIVE_GLYPH_TAB_MISMATCH")
        owner = target_binding["componentId"]
        tabs_node = document_nodes.get(owner)
        require(tabs_node is not None and tabs_node["type"] == "Tabs" and
                tab_id in {entry["id"] for entry in tabs_node["props"].get("tabs", [])},
                "NATIVE_GLYPH_TAB_UNKNOWN")
        require({target_role, canonical_role} == {"icon", "active-icon"},
                "NATIVE_GLYPH_ROLE_PAIR")
        require(target["rect"][2:] == canonical["rect"][2:],
                "NATIVE_GLYPH_SIZE_MISMATCH")
        require("sharedSource" not in target and "sharedSource" not in canonical,
                "NATIVE_GLYPH_SHARED_SOURCE")

        palette_rect = row["paletteReferenceRect"]
        require(isinstance(palette_rect, list) and len(palette_rect) == 4 and
                all(type(value) is int for value in palette_rect),
                "NATIVE_GLYPH_PALETTE_RECT")
        x, y, width, height = palette_rect
        require(width >= 2 and height >= 2 and x >= 0 and y >= 0 and
                x + width <= reference_size[0] and y + height <= reference_size[1],
                "NATIVE_GLYPH_PALETTE_RECT")
        color, palette_pixels_sha256 = _sample_palette(reference, palette_rect)
        evidence = row["evidence"]
        require(isinstance(evidence, str) and 1 <= len(evidence) <= 1200 and evidence.strip(),
                "NATIVE_GLYPH_EVIDENCE")

        recipes.append({
            "targetLayerId": target_layer,
            "canonicalLayerId": canonical_layer,
            "componentId": target["componentId"],
            "tabId": tab_id,
            "targetRole": target_role,
            "canonicalRole": canonical_role,
            "targetReferenceRect": list(target["rect"]),
            "canonicalReferenceRect": list(canonical["rect"]),
            "paletteReferenceRect": list(palette_rect),
            "paletteRgb": color,
            "paletteReferencePixelsSha256": palette_pixels_sha256,
            "evidence": evidence,
        })
        targets.add(target_layer)
        canonicals.add(canonical_layer)

    require(targets.isdisjoint(canonicals), "NATIVE_GLYPH_CHAIN_OR_CYCLE")
    envelope = {
        "kind": KIND,
        "version": VERSION,
        "originalReferenceSha256": reference_sha256,
        "referenceSize": list(reference_size),
        "declarationsDigest": digest(request["derivedGlyphs"]),
        "recipes": recipes,
    }
    envelope["digest"] = digest(envelope)
    return envelope


def marker(envelope: dict | None) -> str:
    if envelope is None:
        return ""
    return f"{PLAN_MARKER}{envelope['digest']} "


def write_compiled(path: Path, envelope: dict | None) -> None:
    if envelope is not None:
        write_json(path, envelope)


def _validated_envelope(compiled: Path, plan: dict, catalog: dict) -> dict | None:
    path = compiled / "planned-glyphs.json"
    derived_rows = [row for row in catalog["parts"] if isinstance(row.get("derivedGlyph"), dict)]
    if not path.exists():
        require(not derived_rows, "NATIVE_GLYPH_RECIPE_MISSING")
        require(not any(PLAN_MARKER in asset.get("prompt", "") for asset in plan["assets"]),
                "NATIVE_GLYPH_PLAN_BINDING")
        return None
    envelope = read_json(path)
    recorded_digest = envelope.get("digest")
    require(envelope.get("kind") == KIND and envelope.get("version") == VERSION and
            isinstance(envelope.get("recipes"), list) and
            recorded_digest == digest({key: value for key, value in envelope.items()
                                       if key != "digest"}),
            "NATIVE_GLYPH_RECIPE_DIGEST")
    response = read_json(compiled / "response.json")
    require(response.get("version") == "1.2" and
            isinstance(response.get("derivedGlyphs"), list) and
            digest(response["derivedGlyphs"]) == envelope.get("declarationsDigest") and
            response.get("referenceSha256") == envelope.get("originalReferenceSha256"),
            "NATIVE_GLYPH_RESPONSE_BINDING")
    appearance = read_json(compiled / "appearance-plan.json")
    document = read_json(compiled / "semantic-document.json")
    require(digest(appearance) == digest(response.get("appearance")) and
            digest(document) == digest(response.get("document")),
            "NATIVE_GLYPH_COMPILED_INPUT_CHANGED")
    prompt_markers = [asset.get("prompt", "").count(PLAN_MARKER + recorded_digest)
                      for asset in plan["assets"]]
    require(bool(prompt_markers) and all(count == 1 for count in prompt_markers) and
            all(asset.get("prompt", "").count(PLAN_MARKER) == 1 for asset in plan["assets"]),
            "NATIVE_GLYPH_PLAN_BINDING")
    appearance_digest = digest(appearance)
    require(all(asset.get("prompt", "").count(APPEARANCE_MARKER + appearance_digest) == 1 and
                asset.get("prompt", "").count(APPEARANCE_MARKER) == 1
                for asset in plan["assets"]), "NATIVE_GLYPH_APPEARANCE_BINDING")
    expected = {row["targetLayerId"]: row for row in envelope["recipes"]}
    actual = {row["layerId"]: row for row in derived_rows}
    require(set(actual) == set(expected), "NATIVE_GLYPH_CATALOG_COVERAGE")
    catalog_by_layer = {row["layerId"]: row for row in catalog["parts"]}
    document_nodes: dict[str, dict] = {}

    def visit(node: dict) -> None:
        document_nodes[node["id"]] = node
        for child in node.get("children", []):
            visit(child)

    visit(document["root"])
    bindings = {row["componentId"]: row for row in appearance["bindings"]}
    for recipe in envelope["recipes"]:
        target = recipe["targetLayerId"]
        canonical = recipe["canonicalLayerId"]
        target_row = catalog_by_layer.get(target)
        canonical_row = catalog_by_layer.get(canonical)
        require(target_row is not None and canonical_row is not None and
                not isinstance(canonical_row.get("derivedGlyph"), dict) and
                target_row["rect"] == recipe["targetReferenceRect"] and
                canonical_row["rect"] == recipe["canonicalReferenceRect"] and
                target_row["componentId"] == recipe["componentId"] and
                canonical_row["componentId"] == recipe["componentId"] and
                target_row["componentType"] == canonical_row["componentType"] == "Tabs",
                "NATIVE_GLYPH_TARGET_BINDING_CHANGED")
        binding = bindings.get(recipe["componentId"])
        require(binding is not None and binding["componentType"] == "Tabs",
                "NATIVE_GLYPH_APPEARANCE_BINDING")
        target_parts = [part for part in binding["parts"]
                        if part.get("layerId") == target]
        canonical_parts = [part for part in binding["parts"]
                           if part.get("layerId") == canonical]
        require(len(target_parts) == len(canonical_parts) == 1 and
                target_parts[0].get("role") == recipe["targetRole"] and
                canonical_parts[0].get("role") == recipe["canonicalRole"] and
                target_parts[0].get("tabId") == canonical_parts[0].get("tabId") ==
                recipe["tabId"], "NATIVE_GLYPH_APPEARANCE_BINDING")
        tabs_node = document_nodes.get(recipe["componentId"])
        require(tabs_node is not None and tabs_node["type"] == "Tabs" and
                recipe["tabId"] in {row["id"] for row in tabs_node["props"].get("tabs", [])},
                "NATIVE_GLYPH_TAB_UNKNOWN")
    for target, recipe in expected.items():
        declaration = actual[target]["derivedGlyph"]
        require(set(declaration) == {"canonicalLayerId", "recipeDigest"} and
                declaration["canonicalLayerId"] == recipe["canonicalLayerId"] and
                declaration["recipeDigest"] == recorded_digest,
                "NATIVE_GLYPH_CATALOG_BINDING")
    return envelope


def materialize(compiled: Path, paths: dict[str, Path], output: Path,
                plan: dict, catalog: dict) -> dict[str, Path]:
    """Derive targets from authenticated canonical files and write SHA evidence."""
    envelope = _validated_envelope(compiled, plan, catalog)
    if envelope is None:
        return {}
    require(digest(plan) == digest(read_json(compiled / "plan.json")),
            "NATIVE_GLYPH_PLAN_CHANGED")
    original_path = safe_relative(compiled, catalog["original"])
    reference, proof = load_verified_image(original_path, envelope["referenceSize"])
    require(proof["sha256"] == envelope["originalReferenceSha256"],
            "NATIVE_GLYPH_REFERENCE_CHANGED")

    catalog_rows = {row["layerId"]: row for row in catalog["parts"]}
    derived_dir = output / "derived-glyphs"
    require(not derived_dir.exists(), "NATIVE_GLYPH_OUTPUT_EXISTS")
    derived_dir.mkdir(parents=True)
    results: dict[str, Path] = {}
    records: list[dict] = []
    plan_digest = digest(plan)

    for recipe in envelope["recipes"]:
        target_layer = recipe["targetLayerId"]
        canonical_layer = recipe["canonicalLayerId"]
        target_row = catalog_rows[target_layer]
        canonical_row = catalog_rows.get(canonical_layer)
        require(canonical_row is not None and target_row["rect"][2:] ==
                canonical_row["rect"][2:] == recipe["targetReferenceRect"][2:] ==
                recipe["canonicalReferenceRect"][2:], "NATIVE_GLYPH_SIZE_MISMATCH")
        require(canonical_layer in paths and target_layer not in paths,
                "NATIVE_GLYPH_MATERIAL_PATHS")
        color, palette_pixels_sha256 = _sample_palette(reference, recipe["paletteReferenceRect"])
        require(color == recipe["paletteRgb"] and
                palette_pixels_sha256 == recipe["paletteReferencePixelsSha256"],
                "NATIVE_GLYPH_PALETTE_CHANGED")

        canonical_path = Path(paths[canonical_layer])
        canonical, canonical_proof = load_verified_image(
            canonical_path, recipe["canonicalReferenceRect"][2:])
        rgba = np.asarray(canonical.convert("RGBA"))
        opaque = rgba[rgba[:, :, 3] == 255, :3]
        require(len(opaque) >= 9 and
                float(np.max(np.percentile(opaque, 95, axis=0) -
                             np.percentile(opaque, 5, axis=0))) <= 48,
                "NATIVE_GLYPH_CANONICAL_NOT_MONOCHROME")
        alpha = rgba[:, :, 3]
        require(alpha.min() == 0 and alpha.max() == 255,
                "NATIVE_GLYPH_CANONICAL_ALPHA")

        pixels = np.zeros_like(rgba)
        pixels[:, :, :3] = np.asarray(color, dtype=np.uint8)
        pixels[:, :, 3] = alpha
        pixels[alpha == 0, :3] = 0
        derived = Image.fromarray(pixels, "RGBA")
        require(derived.size == tuple(target_row["rect"][2:]),
                "NATIVE_GLYPH_SIZE_MISMATCH")
        require(derived.getchannel("A").tobytes() == canonical.getchannel("A").tobytes(),
                "NATIVE_GLYPH_ALPHA_CHANGED")
        require(derived.tobytes() != canonical.convert("RGBA").tobytes(),
                "NATIVE_GLYPH_STATE_NOT_DISTINCT")

        target_path = derived_dir / f"{target_layer}.png"
        derived.save(target_path, format="PNG", optimize=False, compress_level=9)
        require(target_path.is_file() and sha256(target_path), "NATIVE_GLYPH_OUTPUT_WRITE")
        results[target_layer] = target_path
        records.append({
            "targetLayerId": target_layer,
            "canonicalLayerId": canonical_layer,
            "componentId": recipe["componentId"],
            "tabId": recipe["tabId"],
            "targetRole": recipe["targetRole"],
            "canonicalRole": recipe["canonicalRole"],
            "recipeDigest": envelope["digest"],
            "planDigest": plan_digest,
            "evidence": recipe["evidence"],
            "sourceReferenceSha256": proof["sha256"],
            "paletteReferenceRect": recipe["paletteReferenceRect"],
            "paletteReferencePixelsSha256": palette_pixels_sha256,
            "paletteRgb": color,
            "canonicalSourceSha256": canonical_proof["sha256"],
            "outputSha256": sha256(target_path),
            "alphaSha256": hashlib.sha256(derived.getchannel("A").tobytes()).hexdigest(),
            "alphaExactCanonical": True,
            "basis": "contract-derived solid-color state; not restoration of observed state pixels",
        })

    report = {
        "kind": REPORT_KIND,
        "version": VERSION,
        "recipeDigest": envelope["digest"],
        "planDigest": plan_digest,
        "originalReferenceSha256": proof["sha256"],
        "records": records,
        "mediaCalls": 0,
        "human_visual_acceptance": False,
    }
    report["digest"] = digest(report)
    write_json(output / "derived-glyphs.json", report)
    return results


def verify_final_materials(compiled: Path, output: Path, plan: dict,
                           catalog: dict, material_paths: dict[str, Path]) -> None:
    """Verify copied handoff layers still implement every compiled glyph recipe."""
    envelope = _validated_envelope(compiled, plan, catalog)
    if envelope is None:
        return
    report_path = output / "derived-glyphs.json"
    report = read_json(report_path)
    require(report.get("kind") == REPORT_KIND and report.get("version") == VERSION and
            report.get("digest") == digest({key: value for key, value in report.items()
                                             if key != "digest"}) and
            report.get("recipeDigest") == envelope["digest"] and
            report.get("planDigest") == digest(plan),
            "NATIVE_GLYPH_REPORT_BINDING")
    records = {row["targetLayerId"]: row for row in report["records"]}
    require(set(records) == {row["targetLayerId"] for row in envelope["recipes"]},
            "NATIVE_GLYPH_REPORT_COVERAGE")
    for recipe in envelope["recipes"]:
        target = recipe["targetLayerId"]
        canonical = recipe["canonicalLayerId"]
        require(target in material_paths and canonical in material_paths,
                "NATIVE_GLYPH_FINAL_MATERIAL_MISSING")
        target_image, _ = load_verified_image(material_paths[target],
                                              recipe["targetReferenceRect"][2:])
        canonical_image, _ = load_verified_image(material_paths[canonical],
                                                  recipe["canonicalReferenceRect"][2:])
        target_rgba = target_image.convert("RGBA")
        canonical_rgba = canonical_image.convert("RGBA")
        require(target_rgba.getchannel("A").tobytes() ==
                canonical_rgba.getchannel("A").tobytes(),
                "NATIVE_GLYPH_FINAL_ALPHA_MISMATCH")
        pixels = np.asarray(target_rgba)
        visible = pixels[:, :, 3] > 0
        require(bool(np.any(visible)) and
                np.all(pixels[visible, :3] == np.asarray(recipe["paletteRgb"], dtype=np.uint8)),
                "NATIVE_GLYPH_FINAL_COLOR_MISMATCH")
        record = records[target]
        require(record["canonicalLayerId"] == canonical and
                record["canonicalSourceSha256"] == sha256(material_paths[canonical]) and
                record["outputSha256"] == sha256(material_paths[target]) and
                record["alphaSha256"] == hashlib.sha256(
                    target_rgba.getchannel("A").tobytes()).hexdigest() and
                record["alphaExactCanonical"] is True,
                "NATIVE_GLYPH_FINAL_EVIDENCE_MISMATCH")


def acceptance_scope(scope: dict, envelope: dict | None) -> dict:
    """Append explicit derived regression intent while preserving supplied rows."""
    result = copy.deepcopy(scope)
    if envelope is None:
        return result
    for recipe in envelope["recipes"]:
        result["derivedTestStates"].append({
            "componentId": recipe["componentId"],
            "basis": "contract-derived",
            "description": (
                f"Planned glyph recipe v{VERSION}: derive target layer "
                f"{recipe['targetLayerId']} ({recipe['targetRole']}, tabId "
                f"{recipe['tabId']}) from canonical layer {recipe['canonicalLayerId']} "
                f"({recipe['canonicalRole']}) using original-reference ROI "
                f"{recipe['paletteReferenceRect']} and SHA-256 "
                f"{envelope['originalReferenceSha256']}; preserve canonical Alpha "
                "byte-for-byte. This is a solid-color regression state, not an observed "
                "alternate silhouette."
            ),
        })
    return result
