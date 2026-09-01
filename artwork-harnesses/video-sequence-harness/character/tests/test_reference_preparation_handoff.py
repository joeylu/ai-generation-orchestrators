from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from PIL import Image

from ai_frame_animation.canonical import fingerprint, stamp_document, write_json_atomic
from ai_frame_animation.planning import compile_plan
from ai_frame_animation.reference_preparation import load_reference_preparation


class ReferencePreparationHandoffTests(unittest.TestCase):
    def _handoff(self, root: Path) -> dict:
        source = root / "reference.png"
        Image.new("RGB", (64, 64), (240, 240, 240)).save(source)
        prepared = root / "prepared"
        prepared.mkdir()
        foreground_path = prepared / "foreground.png"
        foreground = Image.new("RGBA", (64, 64))
        for y in range(8, 60):
            for x in range(16, 48):
                foreground.putpixel((x, y), (245, 245, 245, 255))
        foreground.save(foreground_path)
        report = stamp_document({"schema_version": "other_service_v3"}, "result_sha256")
        write_json_atomic(prepared / "preparation.json", report)
        handoff = stamp_document({
            "schema_version": "ai_reference_preparation_handoff_v1",
            "producer": {"name": "any-mcp-producer", "version": "2026.09"},
            "source": {"path": "reference.png", **fingerprint(source, media_type="image")},
            "foreground": {"path": "prepared/foreground.png", **fingerprint(foreground_path, media_type="image")},
            "preparation_report": {
                "path": "prepared/preparation.json",
                **fingerprint(prepared / "preparation.json", media_type="application/json"),
            },
            "producer_result_sha256": report["result_sha256"],
            "visual_review_required": True,
        }, "handoff_sha256")
        write_json_atomic(prepared / "handoff.json", handoff)
        return handoff

    def _job(self, reference: str = "reference.png") -> dict:
        return {
            "schema_version": "1.0",
            "job_id": "handoff-fixture",
            "character": {"reference": reference},
            "motion": {"request": "idle loop", "continuity": "loop"},
            "delivery": {"frame_counts": [16], "size": 128, "quality": "strict", "gif": False},
            "provider": {"plugin": "fixture"},
        }

    def test_arbitrary_producer_is_accepted_and_digest_bound(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            handoff = self._handoff(root)
            loaded = load_reference_preparation(root, "prepared/handoff.json")
            self.assertEqual(loaded["producer"]["name"], "any-mcp-producer")
            plan = compile_plan(self._job(), root, prepared_reference="prepared/handoff.json")
            self.assertEqual(plan["character"]["reference"], "prepared/foreground.png")
            self.assertEqual(plan["character"]["reference_preparation"], {
                "path": "prepared/handoff.json", "sha256": handoff["handoff_sha256"],
            })

    def test_changed_foreground_is_rejected_before_planning(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            self._handoff(root)
            (root / "prepared/foreground.png").write_bytes(b"changed")
            with self.assertRaisesRegex(ValueError, "reference_preparation_artifact_changed"):
                compile_plan(self._job(), root, prepared_reference="prepared/handoff.json")

    def test_handoff_cannot_be_rebound_to_another_original(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            self._handoff(root)
            Image.new("RGB", (64, 64), (12, 34, 56)).save(root / "other.png")
            with self.assertRaisesRegex(ValueError, "reference_preparation_source_mismatch"):
                compile_plan(self._job("other.png"), root, prepared_reference="prepared/handoff.json")


if __name__ == "__main__":
    unittest.main()
