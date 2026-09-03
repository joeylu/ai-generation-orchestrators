from __future__ import annotations

import contextlib
import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from PIL import Image

from ai_image_background_removal.canonical import fingerprint, write_json_atomic
from ai_image_background_removal.cli import main
from ai_image_background_removal.media.dual_segmentation import BACKEND, ISNET, inspect_dual_segmenter
from ai_image_background_removal.media.segmentation import inspect_segmenter
from ai_image_background_removal.preparation import inspect_preparation, prepare_reference


class ResourceLimitTests(unittest.TestCase):
    def test_source_over_pixel_budget_is_rejected_before_prepare_or_publication(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "source.png"
            Image.new("RGBA", (16, 16), "white").save(source)
            with patch("ai_image_background_removal.resource_limits.MAX_DECODED_PIXELS", 255):
                self.assertEqual(inspect_preparation(root, source)["diagnostic_code"], "reference_resolution_too_large")
                with self.assertRaisesRegex(ValueError, "^reference_resolution_too_large$"):
                    prepare_reference(root=root, reference=source, out_dir="prepared")
            self.assertFalse((root / "prepared").exists())

    def test_single_model_over_byte_budget_is_rejected_before_runtime_setup(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            model = root / "model.onnx"
            model.write_bytes(b"model")
            config = root / "config.json"
            write_json_atomic(config, {"backend": "onnx_birefnet", "model_path": model.name,
                                       "model_sha256": fingerprint(model)["sha256"]})
            with patch("ai_image_background_removal.resource_limits.MAX_MODEL_BYTES", 1):
                with self.assertRaisesRegex(ValueError, "^reference_segmentation_model_too_large$"):
                    inspect_segmenter(config)

    def test_dual_model_over_byte_budget_stops_before_runtime_setup(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            primary, auxiliary = root / "primary.onnx", root / "auxiliary.onnx"
            primary.write_bytes(b"primary")
            auxiliary.write_bytes(b"auxiliary")

            def item(path: Path, backend: str) -> dict[str, str]:
                return {"backend": backend, "model_path": path.name, "model_sha256": fingerprint(path)["sha256"]}

            config = root / "config.json"
            write_json_atomic(config, {"backend": BACKEND, "primary": item(primary, "onnx_birefnet"),
                                       "auxiliary": item(auxiliary, ISNET)})
            with patch("ai_image_background_removal.resource_limits.MAX_MODEL_BYTES", 1):
                with self.assertRaisesRegex(ValueError, "^reference_segmentation_model_too_large$"):
                    inspect_dual_segmenter(config)

    def test_doctor_exposes_path_free_external_serialization_policy(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            output = io.StringIO()
            with contextlib.redirect_stdout(output):
                self.assertEqual(main(["doctor", "--root", temporary]), 0)
            policy = json.loads(output.getvalue())["resource_policy"]
        self.assertEqual(policy, {
            "schema_version": "ai_image_background_removal_resource_policy_v1",
            "max_decoded_pixels": 8_388_608,
            "max_model_bytes": 1_073_741_824,
            "opaque_preparation_concurrency": 1,
            "onnx_intra_op_threads": 4,
            "opaque_scheduling": "external_serial_required",
        })


if __name__ == "__main__":
    unittest.main()
