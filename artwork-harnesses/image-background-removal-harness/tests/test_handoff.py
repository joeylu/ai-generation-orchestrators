from __future__ import annotations

import contextlib
import io
import json
import tempfile
import unittest
from pathlib import Path

from PIL import Image, ImageDraw

from ai_image_background_removal.cli import main
from ai_image_background_removal.handoff import load_preparation_handoff
from ai_image_background_removal.preparation import prepare_reference


class PreparationHandoffTests(unittest.TestCase):
    def _prepare(self, root: Path) -> dict:
        source = Image.new("RGBA", (64, 64))
        ImageDraw.Draw(source).ellipse((12, 8, 52, 60), fill=(245, 245, 245, 255))
        source.save(root / "reference.png")
        prepare_reference(root=root, reference="reference.png", out_dir="prepared")
        return load_preparation_handoff(root, "prepared/handoff.json")

    def test_prepare_publishes_transport_neutral_handoff(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            handoff = self._prepare(root)
            self.assertEqual(handoff["schema_version"], "ai_reference_preparation_handoff_v1")
            self.assertEqual(handoff["producer"]["name"], "ai-image-background-removal")
            self.assertTrue(handoff["visual_review_required"])
            self.assertEqual(handoff["source"]["path"], "reference.png")
            self.assertEqual(handoff["foreground"]["path"], "prepared/foreground.png")
            self.assertEqual(handoff["preparation_report"]["path"], "prepared/preparation.json")

    def test_handoff_rejects_changed_artifact(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            self._prepare(root)
            (root / "prepared/foreground.png").write_bytes(b"changed")
            with self.assertRaisesRegex(ValueError, "reference_handoff_artifact_changed"):
                load_preparation_handoff(root, "prepared/handoff.json")

    def test_cli_validates_handoff_without_media_or_network(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            handoff = self._prepare(root)
            output = io.StringIO()
            with contextlib.redirect_stdout(output):
                result = main(["validate", "--root", str(root), "--prepared-reference", "prepared/handoff.json"])
            self.assertEqual(result, 0)
            report = json.loads(output.getvalue())
            self.assertEqual(report["status"], "passed")
            self.assertEqual(report["handoff_sha256"], handoff["handoff_sha256"])
            self.assertEqual(report["provider_compute"], "not_performed")
            self.assertEqual(report["gpu_compute"], "not_performed")


if __name__ == "__main__":
    unittest.main()
