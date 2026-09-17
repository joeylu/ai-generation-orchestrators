import copy
import hashlib
import io
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

from PIL import Image, ImageDraw

from ai_ui_decomposition import batch
from ai_ui_decomposition.acceptance_execution import AcceptanceExecution
from ai_ui_decomposition.adapter import export_request, import_result, seal_result
from ai_ui_decomposition.common import read_json, sha256
from ai_ui_decomposition.delivery_adapter import compile_delivery, prepare_handoff
from ai_ui_decomposition.handoff_build import build_handoff
from ai_ui_decomposition.planned_glyphs import PLAN_MARKER
from ai_ui_decomposition.shared_materials import generated_rows
from ai_ui_decomposition.sourced_handoff import prepare_from_sources
from ai_ui_decomposition.cached import verified_result

from test_native_delivery import native_fixture


def tab_icon_pair(request, tab_index=0):
    binding = next(row for row in request["appearance"]["bindings"]
                   if row["componentType"] == "Tabs")
    tabs = request["document"]["root"]["children"]
    node = next(row for row in tabs if row["id"] == binding["componentId"])
    tab_id = node["props"]["tabs"][tab_index]["id"]
    parts = {part["role"]: part["layerId"] for part in binding["parts"]
             if part.get("tabId") == tab_id and
             part["role"] in {"icon", "active-icon"}}
    materials = {row["layerId"]: row for row in request["materials"]}
    return tab_id, parts["icon"], parts["active-icon"], materials


def palette_patch(material, color):
    x, y, width, height = material["rect"]
    patch_width = min(4, width - 2)
    patch_height = min(4, height - 2)
    rect = [x + (width - patch_width) // 2,
            y + (height - patch_height) // 2,
            patch_width, patch_height]
    return rect, color


def synthetic_reference(source_path, output_path, request, tab_index=1,
                        color=(32, 96, 224, 255)):
    _, _, palette_layer, materials = tab_icon_pair(request, tab_index)
    rect, color = palette_patch(materials[palette_layer], color)
    image = Image.open(source_path).convert("RGBA")
    x, y, width, height = rect
    ImageDraw.Draw(image).rectangle((x, y, x + width - 1, y + height - 1), fill=color)
    image.save(output_path)
    return rect, color


def monochrome_icon(size):
    image = Image.new("RGBA", tuple(size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    draw.ellipse((4, 4, size[0] - 5, size[1] - 5), fill=(176, 176, 176, 255))
    return image


def overwrite_json(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n",
                    encoding="utf-8")


class PlannedGlyphTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.root = Path(cls.tmp.name)
        cls.consumer = Path(__file__).resolve().parents[2] / "ui-component-harness"
        subprocess.run([
            "node", str(Path(__file__).with_name("stateful-fixtures.mjs")),
            str(cls.consumer), str(cls.root / "fixtures"),
        ], check=True, capture_output=True)

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def make_request(self, name, palette_color=(32, 96, 224, 255)):
        fixture = self.root / "fixtures" / "Tabs"
        request, raws = native_fixture(fixture)
        request["version"] = "1.2"
        tab_id, canonical_layer, target_layer, materials = tab_icon_pair(request)
        reference = self.root / f"{name}-reference.png"
        rect, _ = synthetic_reference(fixture / "reference.png", reference, request,
                                      color=palette_color)
        # The declared palette ROI is explicitly sourced from another visible tab.
        request["referenceSha256"] = sha256(reference)
        request["derivedGlyphs"] = [{
            "targetLayerId": target_layer,
            "canonicalLayerId": canonical_layer,
            "paletteReferenceRect": rect,
            "evidence": "Synthetic fixture explicitly declares this monochrome paired state.",
        }]
        return fixture, request, raws, reference, tab_id, canonical_layer, target_layer, materials

    def complete_generation(self, fixture, request, raws, reference, output):
        compiled = output / "compiled"
        compile_delivery(reference, request, compiled, self.consumer, 8)
        frozen = batch.freeze(
            compiled / "plan.json", output / "generation", "glyph",
            capability_request=compiled / "capabilities.json",
            component_document=compiled / "semantic-document.json",
            layout_spacing=compiled / "layout-spacing.json",
        )
        run = output / "generation" / "runs" / "glyph"
        catalog = read_json(compiled / "material-catalog.json")
        plan = read_json(compiled / "plan.json")
        target = next(row["layerId"] for row in catalog["parts"]
                      if isinstance(row.get("derivedGlyph"), dict))
        canonical = next(row["derivedGlyph"]["canonicalLayerId"]
                         for row in catalog["parts"] if row["layerId"] == target)
        canonical_row = next(row for row in catalog["parts"]
                             if row["layerId"] == canonical)
        raws[canonical] = monochrome_icon(canonical_row["rect"][2:])

        for asset in plan["assets"]:
            key = asset["id"]
            request_bundle = output / "requests" / key
            export_request(run, key, request_bundle)
            if key.startswith("board-"):
                group = key[6:]
                strategy_ref = catalog["strategies"][group]
                board = read_json(compiled / strategy_ref["path"])["boards"][0]
                image = Image.new("RGB", board["canvas"], "#F808F8")
                for slot in board["slots"]:
                    raw_part = raws[slot["asset_id"]]
                    part = (raw_part.convert("RGBA") if isinstance(raw_part, Image.Image)
                            else Image.open(io.BytesIO(raw_part)).convert("RGBA"))
                    left, top, right, bottom = slot["search_window"]
                    image.paste(part, ((left + right - part.width) // 2,
                                       (top + bottom - part.height) // 2), part)
            else:
                image = Image.open(io.BytesIO(raws[key])).convert("RGB")
            raw_path = output / f"{key}.png"
            image.save(raw_path)
            seal_result(request_bundle, raw_path)
            import_result(run, request_bundle)
        return compiled, run, frozen, target, canonical

    def test_freeze_prepare_sourced_prepare_and_consumer_import(self):
        fixture, request, raws, reference, tab_id, canonical, target, materials = self.make_request("full")
        _, _, palette_layer, _ = tab_icon_pair(request, 1)
        self.assertNotEqual(palette_layer, target)
        output = self.root / "full"
        compiled, run, frozen, target, canonical = self.complete_generation(
            fixture, request, raws, reference, output)
        plan = read_json(compiled / "plan.json")
        target_catalog = next(row for row in read_json(compiled / "material-catalog.json")["parts"]
                              if row["layerId"] == target)
        self.assertEqual(target_catalog["generationAsset"], None)
        self.assertNotIn(target, {asset["id"] for asset in plan["assets"]})
        strategy = read_json(compiled / "strategy-tabs.json")["boards"][0]
        self.assertNotIn(target, {slot["asset_id"] for slot in strategy["slots"]})
        self.assertIn(canonical, {slot["asset_id"] for slot in strategy["slots"]})
        self.assertTrue(all(asset["prompt"].count(PLAN_MARKER) == 1
                            for asset in plan["assets"]))
        self.assertNotIn(target, {row["layerId"] for row in generated_rows(
            read_json(compiled / "material-catalog.json")["parts"])})

        prepared = output / "prepared"
        build = prepare_handoff(compiled, run, prepared, self.consumer)
        report = read_json(prepared / "derived-glyphs.json")
        record = report["records"][0]
        canonical_png = prepared / "materials" / f"{canonical}.png"
        target_png = prepared / "materials" / f"{target}.png"
        canonical_image = Image.open(canonical_png).convert("RGBA")
        target_image = Image.open(target_png).convert("RGBA")
        self.assertEqual(canonical_image.size, target_image.size)
        self.assertEqual(canonical_image.getchannel("A").tobytes(),
                         target_image.getchannel("A").tobytes())
        self.assertEqual(record["canonicalSourceSha256"], sha256(canonical_png))
        self.assertEqual(record["outputSha256"], sha256(target_png))
        self.assertEqual(record["alphaSha256"], hashlib.sha256(
            target_image.getchannel("A").tobytes()).hexdigest())
        target_pixels = target_image.load()
        expected_rgb = tuple(record["paletteRgb"])
        self.assertTrue(all(target_pixels[x, y][:3] == expected_rgb
                            for y in range(target_image.height)
                            for x in range(target_image.width)
                            if target_pixels[x, y][3] > 0))
        scope = read_json(compiled / "acceptance-scope.json")
        tabs_component = next(row["componentId"] for row in request["appearance"]["bindings"]
                              if row["componentType"] == "Tabs")
        self.assertTrue(any(row["componentId"] == tabs_component and
                            row["basis"] == "contract-derived" and tab_id in row["description"]
                            for row in scope["derivedTestStates"]))
        self.assertEqual(read_json(compiled / "reference-state.json"), request["referenceState"])
        self.assertEqual(read_json(compiled / "state-evidence.json"), request["stateEvidence"])

        direct_handoff = output / "direct-handoff"
        build_handoff(build, self.consumer, direct_handoff, AcceptanceExecution(90))
        self.assertTrue((direct_handoff / "consumed.json").is_file())

        catalog = read_json(compiled / "material-catalog.json")
        sources = {}
        for key in {row["generationAsset"] for row in generated_rows(catalog["parts"])}:
            frozen_source, _, receipt, raw = verified_result(run, key)
            sources[key] = {
                "runDirectory": str(run),
                "assetId": key,
                "batchDigest": frozen_source["digest"],
                "expectedRawSha256": receipt["raw_sha256"],
                "basis": "Explicit local synthetic material fixture.",
            }
        joined = output / "joined"
        joined_build = prepare_from_sources(compiled, sources, joined, self.consumer)
        joined_record = read_json(joined / "derived-glyphs.json")["records"][0]
        self.assertEqual(joined_record["outputSha256"], record["outputSha256"])
        joined_handoff = output / "joined-handoff"
        build_handoff(joined_build, self.consumer, joined_handoff, AcceptanceExecution(90))
        self.assertTrue((joined_handoff / "consumed.json").is_file())

        canonical_asset = next(row["generationAsset"] for row in catalog["parts"]
                               if row["layerId"] == canonical)
        changed = copy.deepcopy(sources)
        changed[canonical_asset]["expectedRawSha256"] = None
        with self.assertRaisesRegex(ValueError, "SOURCED_DERIVED_CANONICAL_RAW_REQUIRED"):
            prepare_from_sources(compiled, changed, output / "missing-source-sha", self.consumer)

    def test_rejects_unknown_cross_tab_and_unbound_palette_roi(self):
        fixture, request, _, reference, _, canonical, target, materials = self.make_request("reject")
        cases = []
        unknown = copy.deepcopy(request)
        unknown["derivedGlyphs"][0]["canonicalLayerId"] = "missing-layer"
        cases.append(("unknown", unknown, "NATIVE_GLYPH_LAYER_UNKNOWN"))

        cross_tab = copy.deepcopy(request)
        _, other_icon, _, _ = tab_icon_pair(cross_tab, 1)
        cross_tab["derivedGlyphs"][0]["canonicalLayerId"] = other_icon
        cases.append(("cross-tab", cross_tab, "NATIVE_GLYPH_TAB_MISMATCH"))

        outside = copy.deepcopy(request)
        outside["derivedGlyphs"][0]["paletteReferenceRect"] = [9999, 9999, 4, 4]
        cases.append(("outside-roi", outside, "NATIVE_GLYPH_PALETTE_RECT"))

        different_size = copy.deepcopy(request)
        canonical_row = next(row for row in different_size["materials"]
                             if row["layerId"] == canonical)
        canonical_row["rect"][2] += 1
        cases.append(("different-size", different_size, "NATIVE_GLYPH_SIZE_MISMATCH"))

        cycle = copy.deepcopy(request)
        _, normal_layer, active_layer, _ = tab_icon_pair(cycle)
        cycle["derivedGlyphs"].append({
            "targetLayerId": normal_layer,
            "canonicalLayerId": active_layer,
            "paletteReferenceRect": cycle["derivedGlyphs"][0]["paletteReferenceRect"],
            "evidence": "Synthetic reverse edge for the cycle rejection fixture.",
        })
        cases.append(("cycle", cycle, "NATIVE_GLYPH_CHAIN_OR_CYCLE"))

        duplicate = copy.deepcopy(request)
        duplicate["derivedGlyphs"].append(copy.deepcopy(duplicate["derivedGlyphs"][0]))
        cases.append(("duplicate", duplicate,
                      "NATIVE_GLYPH_DUPLICATE_OR_SELF_REFERENCE"))

        for name, invalid, code in cases:
            with self.subTest(name=name):
                with self.assertRaisesRegex(ValueError, code):
                    compile_delivery(reference, invalid, self.root / f"reject-{name}",
                                     self.consumer, 8)

    def test_materializer_rejects_changed_original_reference(self):
        fixture, request, raws, reference, _, canonical, _, _ = self.make_request("changed-ref")
        output = self.root / "changed-ref-run"
        compiled, _run, _frozen, target, canonical = self.complete_generation(
            fixture, request, raws, reference, output)
        from ai_ui_decomposition.planned_glyphs import materialize

        original = compiled / "original.png"
        image = Image.open(original).convert("RGBA")
        red, green, blue, _ = image.getpixel((0, 0))
        image.putpixel((0, 0), (255 - red, 255 - green, 255 - blue, 255))
        changed_original = self.root / "changed-original.png"
        image.save(changed_original)
        changed_original.replace(original)
        catalog = read_json(compiled / "material-catalog.json")
        plan = read_json(compiled / "plan.json")
        with self.assertRaisesRegex(ValueError, "NATIVE_GLYPH_REFERENCE_CHANGED"):
            materialize(compiled, {}, self.root / "changed-out",
                        plan, catalog)

    def test_materializer_rejects_changed_recipe_plan_and_response(self):
        fixture, request, _, reference, _, canonical, target, _ = self.make_request("tamper")
        compiled = self.root / "tamper-compiled"
        compile_delivery(reference, request, compiled, self.consumer, 8)
        catalog = read_json(compiled / "material-catalog.json")
        canonical_row = next(row for row in catalog["parts"]
                             if row["layerId"] == canonical)
        canonical_path = self.root / "tamper-canonical.png"
        monochrome_icon(canonical_row["rect"][2:]).save(canonical_path)

        cases = ("recipe", "plan", "response", "material", "appearance")
        expected = {
            "recipe": "NATIVE_GLYPH_RECIPE_DIGEST",
            "plan": "NATIVE_GLYPH_PLAN_BINDING",
            "response": "NATIVE_GLYPH_RESPONSE_BINDING",
            "material": "NATIVE_GLYPH_TARGET_BINDING_CHANGED",
            "appearance": "NATIVE_GLYPH_COMPILED_INPUT_CHANGED",
        }
        from ai_ui_decomposition.planned_glyphs import materialize

        for name in cases:
            with self.subTest(name=name):
                copied = self.root / f"tamper-{name}"
                shutil.copytree(compiled, copied)
                if name == "recipe":
                    recipe = read_json(copied / "planned-glyphs.json")
                    recipe["recipes"][0]["evidence"] = "Changed after compile"
                    overwrite_json(copied / "planned-glyphs.json", recipe)
                elif name == "plan":
                    plan = read_json(copied / "plan.json")
                    plan["assets"][0]["prompt"] = plan["assets"][0]["prompt"].replace(
                        PLAN_MARKER, "native-planned-glyphs-v0:", 1)
                    overwrite_json(copied / "plan.json", plan)
                elif name == "response":
                    response = read_json(copied / "response.json")
                    response["derivedGlyphs"][0]["evidence"] = "Changed after compile"
                    overwrite_json(copied / "response.json", response)
                elif name == "material":
                    catalog = read_json(copied / "material-catalog.json")
                    row = next(row for row in catalog["parts"] if row["layerId"] == target)
                    row["rect"][0] += 1
                    overwrite_json(copied / "material-catalog.json", catalog)
                else:
                    appearance = read_json(copied / "appearance-plan.json")
                    binding = next(row for row in appearance["bindings"]
                                   if row["componentType"] == "Tabs")
                    part = next(row for row in binding["parts"]
                                if row["layerId"] == target)
                    part["tabId"] = "other-tab"
                    overwrite_json(copied / "appearance-plan.json", appearance)
                plan = read_json(copied / "plan.json")
                with self.assertRaisesRegex(ValueError, expected[name]):
                    materialize(copied, {canonical: canonical_path},
                                self.root / f"tamper-{name}-output", plan,
                                read_json(copied / "material-catalog.json"))

    def test_same_color_canonical_is_rejected_as_not_distinct(self):
        fixture, request, _, reference, _, canonical, _, _ = self.make_request(
            "same-color", (176, 176, 176, 255))
        compiled = self.root / "same-color-compiled"
        compile_delivery(reference, request, compiled, self.consumer, 8)
        canonical_row = next(row for row in read_json(compiled / "material-catalog.json")["parts"]
                             if row["layerId"] == canonical)
        canonical_path = self.root / "same-color-canonical.png"
        monochrome_icon(canonical_row["rect"][2:]).save(canonical_path)
        from ai_ui_decomposition.planned_glyphs import materialize
        with self.assertRaisesRegex(ValueError, "NATIVE_GLYPH_STATE_NOT_DISTINCT"):
            materialize(compiled, {canonical: canonical_path},
                        self.root / "same-color-output", read_json(compiled / "plan.json"),
                        read_json(compiled / "material-catalog.json"))


if __name__ == "__main__":
    unittest.main()
