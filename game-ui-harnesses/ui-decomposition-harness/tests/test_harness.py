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
from ai_ui_decomposition.process import process, review_template


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


if __name__ == "__main__":
    unittest.main()
