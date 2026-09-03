from __future__ import annotations

import json
import tempfile
import unittest
from fractions import Fraction
from pathlib import Path
from unittest.mock import patch

from PIL import Image, ImageDraw

from ai_frame_animation.canonical import stamp_document
from ai_frame_animation.comparison import compare_deliveries
from ai_frame_animation.processing import process_from_decoded


def make_plan() -> dict:
    return stamp_document(
        {
            "schema_version": "ai_frame_animation_plan_v1",
            "job_id": "comparison-fixture",
            "character": {
                "reference": "reference.png",
                "reference_fingerprint": {"bytes": 1, "sha256": "0" * 64, "media_type": "image"},
                "description": "",
            },
            "motion": {"request": "loop", "continuity": "loop"},
            "delivery": {"frame_counts": [16], "size": 128, "quality": "strict", "gif": False},
            "provider": {"plugin": "fixture"},
        },
        "plan_sha256",
    )


class DeliveryComparisonTests(unittest.TestCase):
    def _valid_deliveries(self, root: Path) -> tuple[Path, Path]:
        raw = root / "raw.mp4"
        raw.write_bytes(b"comparison-fixture")
        decoded = root / "decoded"
        decoded.mkdir()
        paths = []
        for index in range(17):
            image = Image.new("RGB", (8, 8), (0, 255, 0))
            ImageDraw.Draw(image).rectangle((2, 2, 5, 7), fill=(208, 32 + index % 3, 32))
            path = decoded / f"source_{index + 1:06d}.png"
            image.save(path)
            paths.append(path)
        probe = {
            "streams": [{"codec_type": "video", "avg_frame_rate": "8/1", "duration_ts": "17", "time_base": "1/8"}],
            "frames": [{"best_effort_timestamp_time": str(Fraction(index, 8))} for index in range(17)],
        }
        plan = make_plan()
        baseline, candidate = root / "baseline", root / "candidate"
        for output in (baseline, candidate):
            process_from_decoded(
                root=root,
                plan=plan,
                raw_video=raw,
                decoded_paths=paths,
                probe_payload=probe,
                out_dir=output,
                key_color="#00FF00",
            )
        return baseline, candidate

    def test_validated_deliveries_are_byte_exact_and_report_elapsed_delta(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            baseline, candidate = self._valid_deliveries(root)
            report = compare_deliveries(
                root=root,
                baseline=baseline,
                candidate=candidate,
                baseline_elapsed_seconds=12.0,
                candidate_elapsed_seconds=3.0,
            )
        self.assertEqual(report["status"], "identical")
        self.assertTrue(report["identity"]["raw_sha256_equal"])
        self.assertTrue(report["identity"]["plan_sha256_equal"])
        self.assertTrue(report["artifacts"]["byte_exact"])
        self.assertEqual(report["elapsed_seconds"], {
            "baseline": 12.0,
            "candidate": 3.0,
            "saved": 9.0,
            "speedup_multiplier": 4.0,
            "reduction_ratio": 0.75,
        })

    def test_report_identifies_changed_artifact_after_independent_validation(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            baseline, candidate = root / "baseline", root / "candidate"
            for delivery, frame in ((baseline, b"baseline"), (candidate, b"candidate")):
                delivery.mkdir()
                (delivery / "delivery-manifest.json").write_text(json.dumps({
                    "plan_sha256": "a" * 64,
                    "raw_source": {"sha256": "b" * 64},
                }), encoding="utf-8")
                (delivery / "frame.png").write_bytes(frame)
            with patch("ai_frame_animation.comparison.validate_delivery", return_value={"status": "passed"}):
                report = compare_deliveries(root=root, baseline=baseline, candidate=candidate)
        self.assertEqual(report["status"], "different")
        self.assertEqual(report["artifacts"]["changed"], ["frame.png"])
        self.assertEqual(report["transparent_pngs"]["changed"], ["frame.png"])

    def test_elapsed_durations_must_be_supplied_as_a_pair(self) -> None:
        with self.assertRaisesRegex(ValueError, "comparison_elapsed_pair_required"):
            compare_deliveries(
                root=Path.cwd(),
                baseline=Path("unused-baseline"),
                candidate=Path("unused-candidate"),
                baseline_elapsed_seconds=1.0,
            )

    def test_delivery_paths_cannot_escape_workspace(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary) / "workspace"
            root.mkdir()
            (root / "baseline").mkdir()
            outside = Path(temporary) / "outside"
            outside.mkdir()
            with self.assertRaisesRegex(ValueError, "path_escapes_root"):
                compare_deliveries(root=root, baseline=Path("baseline"), candidate=outside)
