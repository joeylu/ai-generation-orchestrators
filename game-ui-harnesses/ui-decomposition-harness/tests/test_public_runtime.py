from __future__ import annotations

from pathlib import Path
import json
import sys
import tempfile
import unittest
from unittest.mock import patch

from PIL import Image, ImageDraw

PACKAGE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PACKAGE / "src"))

from ai_ui_decomposition import batch
from ai_ui_decomposition.adapter import export_request, import_result, seal_result
from ai_ui_decomposition.common import ContractError, sha256
from ai_ui_decomposition.contract import validate
from ai_ui_decomposition.media import matte_key
from ai_ui_decomposition.runtime import doctor, init_plan, self_test


class PublicRuntimeTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.reference = self.root / "reference.png"
        Image.new("RGB", (64, 48), "#17314a").save(self.reference)

    def tearDown(self):
        self.temporary.cleanup()

    def _initialized(self):
        plan = self.root / "project" / "plan.json"
        result = init_plan(self.reference, plan, "sample-r001", "sample-ui")
        return plan, result

    def test_init_copies_portable_reference_and_creates_valid_starter(self):
        plan_path, result = self._initialized()
        self.assertEqual(result["status"], "starter_plan_requires_semantic_editing")
        plan = json.loads(plan_path.read_text(encoding="utf-8"))
        self.assertEqual(plan["source"]["path"], "inputs/reference.png")
        self.assertEqual(validate(plan, source_base=plan_path.parent)["generated_requests"], 1)

    def test_declared_source_size_must_match_decoded_oriented_pixels(self):
        plan_path, _ = self._initialized()
        plan = json.loads(plan_path.read_text(encoding="utf-8"))
        replacement = self.root / "project" / "inputs" / "reference.png"
        Image.new("RGB", (32, 24), "black").save(replacement)
        plan["source"]["sha256"] = sha256(replacement)
        with self.assertRaisesRegex(ContractError, "IMAGE_DIMENSION_MISMATCH"):
            validate(plan, source_base=plan_path.parent)

    def test_pixel_limit_is_checked_before_decode(self):
        plan_path, _ = self._initialized()
        plan = json.loads(plan_path.read_text(encoding="utf-8"))
        with patch("ai_ui_decomposition.common.MAX_IMAGE_PIXELS", 100):
            with self.assertRaisesRegex(ContractError, "IMAGE_PIXEL_LIMIT"):
                validate(plan, source_base=plan_path.parent)

    def test_transparent_provider_background_remains_transparent(self):
        image = Image.new("RGBA", (30, 20), (0, 0, 0, 0))
        ImageDraw.Draw(image).rectangle((8, 5, 21, 14), fill=(20, 190, 220, 255))
        result = matte_key(image, [20, 12])
        self.assertEqual(result.getpixel((0, 0)), (0, 0, 0, 0))
        self.assertIsNotNone(result.getchannel("A").getbbox())

    def test_file_adapter_roundtrip_is_digest_bound(self):
        plan_path, _ = self._initialized()
        workspace = self.root / "workspace"
        batch.freeze(plan_path, workspace, "trial-r001")
        run = workspace / "runs" / "trial-r001"
        bundle = self.root / "bundle"
        handoff = export_request(run, "scene", bundle)
        self.assertEqual(handoff["automatic_retries"], 0)
        generated = self.root / "generated.png"
        Image.new("RGB", (64, 48), "#284761").save(generated)
        seal_result(bundle, generated)
        received = import_result(run, bundle)
        self.assertEqual(received["generation_calls"], 1)
        self.assertEqual(batch.status(run)["received"], 1)

    def test_existing_adapter_bundle_does_not_consume_single_use_request(self):
        plan_path, _ = self._initialized()
        workspace = self.root / "workspace"
        batch.freeze(plan_path, workspace, "trial-r001")
        run = workspace / "runs" / "trial-r001"
        bundle = self.root / "existing-bundle"
        bundle.mkdir()
        with self.assertRaisesRegex(ContractError, "ADAPTER_BUNDLE_EXISTS"):
            export_request(run, "scene", bundle)
        self.assertEqual(batch.status(run)["prepared"], 1)

    def test_opaque_provider_result_rejects_wrong_ratio(self):
        plan_path, _ = self._initialized()
        workspace = self.root / "workspace"
        batch.freeze(plan_path, workspace, "trial-r001")
        run = workspace / "runs" / "trial-r001"
        batch.reserve(run, "scene")
        wrong = self.root / "wrong.png"
        Image.new("RGB", (48, 48), "black").save(wrong)
        with self.assertRaisesRegex(ContractError, "OPAQUE_RESULT_ASPECT_MISMATCH"):
            batch.receive(run, "scene", wrong)

    def test_doctor_and_self_test_are_offline_and_redacted(self):
        diagnosis = doctor()
        self.assertEqual(diagnosis["status"], "ready")
        self.assertEqual(diagnosis["network_probe"], "not_performed")
        self.assertNotIn(str(Path.home()).lower(), json.dumps(diagnosis).lower())
        self.assertEqual(self_test()["status"], "passed")


if __name__ == "__main__":
    unittest.main()
