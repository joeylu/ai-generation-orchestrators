from __future__ import annotations

from pathlib import Path
import importlib.util
import json
import sys
import tempfile
import unittest

import numpy as np
from PIL import Image, ImageDraw

PACKAGE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PACKAGE / "src"))

from ai_ui_decomposition import batch
from ai_ui_decomposition.assembly import finalize, inspect_delivery
from ai_ui_decomposition.common import ContractError, sha256
from ai_ui_decomposition.contract import validate
from ai_ui_decomposition.media import contain, matte_key, nine_slice
from ai_ui_decomposition.process import process, review_template
from ai_ui_decomposition.cached import result_binding, reuse_result


class HarnessTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.reference = self.root / "reference.png"
        picture = Image.new("RGB", (64, 48), "#17314a")
        ImageDraw.Draw(picture).rectangle((4, 4, 59, 43), outline="#b98a42", width=2)
        picture.save(self.reference)
        self.plan_path = self.root / "plan.json"
        self.plan = {
            "kind": "ai_ui_decomposition_plan_v1", "id": "fixture-r001",
            "canvas": [64, 48],
            "source": {"path": "reference.png", "sha256": sha256(self.reference),
                       "size": [64, 48]},
            "text_policy": "remove_ordinary_text_preserve_graphic_symbols",
            "granularity": "important_components_only",
            "assets": [
                {"id": "scene", "role": "background", "route": "source_crop",
                 "source_region": [0, 0, 64, 48], "output_size": [64, 48],
                 "output_mode": "opaque_canvas", "prompt": None, "source_asset": None},
                {"id": "button", "role": "important_component",
                 "route": "generated_isolation", "source_region": [8, 8, 28, 20],
                 "output_size": [20, 12], "output_mode": "keyed_component",
                 "prompt": "Isolate an empty gold button", "source_asset": None},
                {"id": "button_small", "role": "important_component",
                 "route": "reuse_scaled", "source_region": [34, 8, 46, 20],
                 "output_size": [12, 12], "output_mode": "rgba", "prompt": None,
                 "source_asset": "button"}],
            "nodes": [{"id": "background", "asset": "scene", "xy": [0, 0]},
                      {"id": "primary_button", "asset": "button", "xy": [8, 24]},
                      {"id": "small_button", "asset": "button_small", "xy": [40, 24]}],
            "groups": [{"id": "background_group", "children": ["background"]},
                       {"id": "controls_group",
                        "children": ["primary_button", "small_button"]}],
            "document": {"name": "fixture-ui", "format": "auto"}}
        self.plan_path.write_text(json.dumps(self.plan), encoding="utf-8")
        self.workspace = self.root / "workspace"
        batch.freeze(self.plan_path, self.workspace, "trial-r001")
        self.run = self.workspace / "runs" / "trial-r001"

    def tearDown(self):
        self.temp.cleanup()

    def raw_component(self) -> Path:
        path = self.root / "raw.png"
        image = Image.new("RGB", (40, 30), (248, 8, 248))
        draw = ImageDraw.Draw(image)
        draw.rounded_rectangle((8, 7, 31, 22), radius=3, fill="#db9b31")
        draw.rectangle((17, 11, 22, 18), fill=(248, 8, 248))
        image.save(path)
        return path

    def complete_materials(self):
        batch.reserve(self.run, "button")
        batch.receive(self.run, "button", self.raw_component())
        return process(self.run)

    def test_plan_and_single_use_batch_are_provider_neutral(self):
        summary = validate(self.plan, source_base=self.root)
        self.assertEqual(summary["generated_requests"], 1)
        frozen, _ = batch.load(self.run)
        self.assertFalse(frozen["provider_invocation_included"])
        self.assertIsNone(frozen["provider"])
        batch.reserve(self.run, "button")
        with self.assertRaisesRegex(ContractError, "REQUEST_ALREADY_STARTED"):
            batch.reserve(self.run, "button")

    def test_key_holes_and_uniform_reuse_survive_processing(self):
        materials = self.complete_materials()
        rows = {row["asset"]: row for row in materials["assets"]}
        button = Image.open(self.run / rows["button"]["path"]).convert("RGBA")
        small = Image.open(self.run / rows["button_small"]["path"]).convert("RGBA")
        self.assertEqual(button.getpixel((10, 6))[3], 0)
        big_box = button.getchannel("A").getbbox()
        small_box = small.getchannel("A").getbbox()
        big_ratio = (big_box[2] - big_box[0]) / (big_box[3] - big_box[1])
        small_ratio = (small_box[2] - small_box[0]) / (small_box[3] - small_box[1])
        self.assertLess(abs(big_ratio - small_ratio), 0.2)
        self.assertTrue(np.all(np.asarray(small)[np.asarray(small)[:, :, 3] == 0, :3] == 0))

    def test_digest_bound_review_is_required_before_assembly(self):
        materials = self.complete_materials()
        review_template(self.run)
        with self.assertRaisesRegex(ContractError, "EXPLICIT_VISUAL_REVIEW_REQUIRED"):
            finalize(self.run, self.root / "delivery")
        review_path = self.run / "review.json"
        review = json.loads(review_path.read_text(encoding="utf-8"))
        review["decision"] = "accept"
        review["reviewed_asset_ids"] = [row["asset"] for row in materials["assets"]]
        review_path.write_text(json.dumps(review), encoding="utf-8")
        receipt = finalize(self.run, self.root / "delivery")
        self.assertEqual(receipt["status"], "assembled_visual_review_bound")
        self.assertEqual(inspect_delivery(self.root / "delivery")["digest"], receipt["digest"])
        with Image.open(self.root / "delivery" / "preview.png") as preview:
            self.assertEqual(preview.size, (64, 48))

    def test_indeterminate_request_is_terminal_and_never_processed(self):
        batch.reserve(self.run, "button")
        record = batch.indeterminate(self.run, "button", "provider outcome unknown")
        self.assertFalse(record["automatic_resubmit"])
        self.assertEqual(batch.status(self.run)["indeterminate"], 1)
        with self.assertRaisesRegex(ContractError, "BATCH_INCOMPLETE"):
            process(self.run)

    def test_explicit_recovery_preserves_indeterminate_evidence_and_can_process(self):
        batch.reserve(self.run, "button")
        prior = batch.indeterminate(self.run, "button", "known task polling interrupted")
        record = batch.recover_receive(self.run, "button", self.raw_component())
        self.assertTrue(record["explicit_operator_recovery"])
        self.assertEqual(record["indeterminate_sha256"], sha256(
            self.run / "requests/fixture-r001-button-r001/indeterminate.json"))
        self.assertEqual(batch.status(self.run)["recovered"], 1)
        self.assertEqual(process(self.run)["count"], 3)
        with self.assertRaisesRegex(ContractError, "EXPLICIT_RECOVERY_REQUIRED"):
            batch.recover_receive(self.run, "button", self.raw_component())
        self.assertEqual(prior["automatic_resubmit"], False)

    @unittest.skipUnless(importlib.util.find_spec("psd_tools"), "psd option not installed")
    def test_psd_export_roundtrips_layers_and_composite(self):
        from ai_ui_decomposition.psd_export import export_psd
        materials = self.complete_materials()
        review_template(self.run)
        review_path = self.run / "review.json"
        review = json.loads(review_path.read_text(encoding="utf-8"))
        review["decision"] = "accept"
        review["reviewed_asset_ids"] = [row["asset"] for row in materials["assets"]]
        review_path.write_text(json.dumps(review), encoding="utf-8")
        delivery = self.root / "delivery"
        finalize(self.run, delivery)
        result = export_psd(delivery)
        self.assertEqual(result["pixel_layers"], 3)
        self.assertEqual(result["rgba_max_error"], 0)
        self.assertLessEqual(result["preview_max_error"], 1)

    def test_background_role_does_not_depend_on_asset_id(self):
        self.assertEqual(validate(self.plan, source_base=self.root)["assets"], 3)
        changed = json.loads(json.dumps(self.plan))
        changed["assets"][0]["role"] = "important_component"
        with self.assertRaisesRegex(ContractError, "ONE_BACKGROUND_REQUIRED"):
            validate(changed, source_base=self.root)

    def test_plan_rejects_provider_or_host_specific_extension_fields(self):
        changed = json.loads(json.dumps(self.plan))
        changed["provider_endpoint"] = "https://private.invalid"
        with self.assertRaisesRegex(ContractError, "PLAN_FIELDS"):
            validate(changed, source_base=self.root)

    def test_legacy_processing_pixels_remain_unchanged(self):
        materials = self.complete_materials()
        with Image.open(self.root / "raw.png") as raw:
            expected = matte_key(raw, [20, 12])
        for row in materials["assets"]:
            if row["asset"] == "scene":
                continue
            baseline = expected if row["asset"] == "button" else contain(expected, [12, 12])
            with Image.open(self.run / row["path"]) as actual:
                self.assertEqual(actual.tobytes(), baseline.tobytes())

    def test_explicit_resize_processes_generated_and_reused_components(self):
        old_digest = validate(self.plan, source_base=self.root)["plan_digest"]
        for asset in self.plan["assets"][1:]:
            asset["resize"] = {"mode": "nine_slice", "insets": [2, 2, 2, 2]}
        self.assertNotEqual(old_digest, validate(self.plan, source_base=self.root)["plan_digest"])
        self.plan_path.write_text(json.dumps(self.plan), encoding="utf-8")
        batch.freeze(self.plan_path, self.workspace, "resize-r001")
        self.run = self.workspace / "runs" / "resize-r001"
        materials = self.complete_materials()
        for row in materials["assets"][1:]:
            with Image.open(self.run / row["path"]) as actual:
                self.assertEqual(actual.size, tuple(row["size"]))
                self.assertEqual(actual.getchannel("A").getbbox(), (0, 0, *actual.size))

    def test_resize_schema_rejects_bad_insets_and_opaque_backgrounds(self):
        cases = [(None, "RESIZE_FIELDS"),
                 ({"mode": "stretch", "insets": [2, 2, 2, 2]}, "RESIZE_MODE"),
                 ({"mode": "nine_slice", "insets": [True, 2, 2, 2]}, "RESIZE_INSETS"),
                 ({"mode": "nine_slice", "insets": [0, 2, 2, 2]}, "RESIZE_INSETS"),
                 ({"mode": "nine_slice", "insets": [10, 2, 10, 2]}, "RESIZE_TARGET_TOO_SMALL"),
                 ({"mode": "nine_slice", "insets": [2, 2, 2, 2], "extra": 1}, "RESIZE_FIELDS")]
        for resize, error in cases:
            with self.subTest(resize=resize):
                self.plan["assets"][1]["resize"] = resize
                with self.assertRaisesRegex(ContractError, error):
                    validate(self.plan, source_base=self.root)
        del self.plan["assets"][1]["resize"]
        self.plan["assets"][0]["resize"] = {"mode": "nine_slice", "insets": [2, 2, 2, 2]}
        with self.assertRaisesRegex(ContractError, "RESIZE_COMPONENT_ONLY"):
            validate(self.plan, source_base=self.root)

    def test_nine_slice_preserves_corners_alpha_and_identity_in_both_axes(self):
        values = np.zeros((17, 23, 4), dtype=np.uint8)
        values[:, :, :3] = [63, 129, 207]
        values[:, :, 3] = 255
        values[0, 0] = [0, 0, 0, 0]
        values[1, 1, 3] = 103
        source = Image.fromarray(values, "RGBA")
        insets = [3, 4, 5, 2]
        self.assertEqual(nine_slice(source, [23, 17], insets).tobytes(), source.tobytes())
        for width, height in [(41, 17), (23, 31), (41, 31), (12, 10)]:
            with self.subTest(size=(width, height)):
                actual = nine_slice(source, [width, height], insets)
                for old, new in [((0, 0, 3, 4), (0, 0, 3, 4)),
                                 ((18, 0, 23, 4), (width - 5, 0, width, 4)),
                                 ((0, 15, 3, 17), (0, height - 2, 3, height)),
                                 ((18, 15, 23, 17), (width - 5, height - 2, width, height))]:
                    self.assertEqual(source.crop(old).tobytes(), actual.crop(new).tobytes())
                pixels = np.asarray(actual)
                self.assertTrue(np.all(pixels[pixels[:, :, 3] == 0, :3] == 0))
                self.assertTrue(np.all(pixels[4:height - 2, 3:width - 5, 3] == 255))

    def test_nine_slice_rejects_missing_support_and_impossible_caps(self):
        with self.assertRaisesRegex(ContractError, "EMPTY_MATERIAL"):
            nine_slice(Image.new("RGBA", (20, 20)), [20, 20], [2, 2, 2, 2])
        with self.assertRaisesRegex(ContractError, "RESIZE_SUPPORT_TOO_SMALL"):
            nine_slice(Image.new("RGBA", (4, 4), "gold"), [20, 20], [2, 2, 2, 2])
        with self.assertRaisesRegex(ContractError, "RESIZE_TARGET_TOO_SMALL"):
            nine_slice(Image.new("RGBA", (20, 20), "gold"), [4, 4], [2, 2, 2, 2])

    def cached_plan(self, change=None):
        self.complete_materials()
        plan = json.loads(json.dumps(self.plan))
        plan["id"] = "cached-r001"
        plan["assets"][1]["cached_result"] = result_binding(self.run, "button")
        plan["assets"][1]["resize"] = {"mode": "nine_slice", "insets": [2, 2, 2, 2]}
        if change:
            change(plan)
        path = self.root / "cached-plan.json"
        path.write_text(json.dumps(plan), encoding="utf-8")
        batch.freeze(path, self.workspace, "cached-r001")
        return self.workspace / "runs" / "cached-r001"

    def test_cached_result_reprocesses_with_zero_calls_and_pending_review(self):
        target = self.cached_plan()
        old_raw = self.run / "requests/fixture-r001-button-r001/raw.png"
        old_hash = sha256(old_raw)
        record = reuse_result(target, "button", self.run, "button")
        self.assertEqual(record["generation_calls"], 0)
        state = batch.status(target)
        self.assertEqual((state["received"], state["reused"], state["maximum_calls"]), (0, 1, 0))
        self.assertFalse((target / "requests/cached-r001-button-r001/reserved.json").exists())
        self.assertEqual(record["raw_sha256"], old_hash)
        self.assertEqual(sha256(old_raw), old_hash)
        result = process(target)
        self.assertEqual(result["count"], 3)
        self.assertEqual(review_template(target)["decision"], "pending")
        with self.assertRaisesRegex(ContractError, "EXPLICIT_VISUAL_REVIEW_REQUIRED"):
            finalize(target, self.root / "unreviewed")

    def test_cached_result_forbids_generation_and_double_import(self):
        target = self.cached_plan()
        with self.assertRaisesRegex(ContractError, "CACHED_RESULT_NO_GENERATION"):
            batch.reserve(target, "button")
        reuse_result(target, "button", self.run, "button")
        with self.assertRaisesRegex(ContractError, "REQUEST_ALREADY_STARTED"):
            reuse_result(target, "button", self.run, "button")
        with self.assertRaisesRegex(ContractError, "ORIGINAL_RESULT_REQUIRED"):
            result_binding(target, "button")

    def test_cached_result_rejects_changed_prompt_before_copy(self):
        def change(plan):
            plan["assets"][1]["prompt"] = "A different component"
        target = self.cached_plan(change)
        with self.assertRaisesRegex(ContractError, "CACHED_GENERATION_MISMATCH"):
            reuse_result(target, "button", self.run, "button")
        self.assertFalse((target / "requests/cached-r001-button-r001/raw.png").exists())

    def test_cached_result_rejects_wrong_source_binding(self):
        def change(plan):
            plan["assets"][1]["cached_result"]["source_batch_digest"] = "0" * 64
        target = self.cached_plan(change)
        with self.assertRaisesRegex(ContractError, "CACHED_SOURCE_MISMATCH"):
            reuse_result(target, "button", self.run, "button")

    def test_cached_result_rejects_changed_reference(self):
        def change(plan):
            Image.new("RGB", (64, 48), "red").save(self.reference)
            plan["source"]["sha256"] = sha256(self.reference)
        target = self.cached_plan(change)
        with self.assertRaisesRegex(ContractError, "CACHED_REFERENCE_MISMATCH"):
            reuse_result(target, "button", self.run, "button")

    def test_cached_result_checks_raw_before_reuse_and_before_process(self):
        target = self.cached_plan()
        reuse_result(target, "button", self.run, "button")
        copied = target / "requests/cached-r001-button-r001/raw.png"
        Image.new("RGB", (40, 30), "red").save(copied)
        with self.assertRaisesRegex(ContractError, "RAW_RESULT_CHANGED"):
            process(target)
        self.assertFalse((target / "materials").exists())
        original = self.run / "requests/fixture-r001-button-r001/raw.png"
        Image.new("RGB", (40, 30), "red").save(original)
        with self.assertRaisesRegex(ContractError, "RAW_RESULT_CHANGED"):
            result_binding(self.run, "button")

    def test_failed_result_cannot_supply_cache_binding(self):
        batch.reserve(self.run, "button")
        batch.indeterminate(self.run, "button", "no valid result")
        with self.assertRaisesRegex(ContractError, "COMPLETED_RESULT_REQUIRED"):
            result_binding(self.run, "button")

    def test_cached_schema_rejects_paths_and_non_generated_routes(self):
        self.plan["assets"][1]["cached_result"] = {"path": "../raw.png"}
        with self.assertRaisesRegex(ContractError, "CACHED_RESULT_FIELDS"):
            validate(self.plan, source_base=self.root)
        del self.plan["assets"][1]["cached_result"]
        self.plan["assets"][0]["cached_result"] = dict(source_batch_digest="0"*64,
            source_request_digest="1"*64, raw_sha256="2"*64)
        with self.assertRaisesRegex(ContractError, "CACHED_RESULT_ROUTE"):
            validate(self.plan, source_base=self.root)


if __name__ == "__main__":
    unittest.main()
