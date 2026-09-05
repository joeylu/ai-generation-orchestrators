import copy
import json
import tempfile
import unittest
from pathlib import Path
from fractions import Fraction

from PIL import Image, ImageDraw

from ai_frame_animation.canonical import fingerprint, stamp_document, write_json_atomic
from ai_frame_animation.handoff import load_decoded_handoff, verify_video_timeline_identity
from ai_frame_animation.processing import process_decoded_handoff
from ai_frame_animation.validation import validate_delivery
from ai_frame_animation.media.timeline import build_source_timeline
from test_decoded_handoff import build_fixture, _artifact


def alpha_fixture(root):
    fixture = build_fixture(root, frame_counts=[16])
    doc = fixture["handoff"]
    doc["schema_version"] = "ai_frame_animation_decoded_handoff_v2"
    foreground = root / "foreground.webm"; foreground.write_bytes(b"synthetic-alpha-video")
    doc["foreground_source"] = _artifact(root, foreground, "video")
    for row in doc["decode"]["frames"]:
        path = root / row["artifact"]["path"]
        image = Image.new("RGBA", (16, 16)); ImageDraw.Draw(image).rectangle((4, 4, 10, 12), fill=(20, 220, 30, 128))
        image.save(path); row["artifact"] = _artifact(root, path, "image/png")
    probe = json.loads((root / "probe.json").read_text())
    probe["streams"][0].update(width=16, height=16)
    write_json_atomic(root / "probe.json", probe)
    write_json_atomic(root / "source-probe.json", probe)
    doc["probe"]["artifact"] = _artifact(root, root / "probe.json", "application/json")
    doc["source_probe"] = {**doc["probe"], "artifact": _artifact(root, root / "source-probe.json", "application/json")}
    doc = stamp_document(doc, "handoff_sha256"); write_json_atomic(fixture["handoff_path"], doc)
    fixture["plan"]["delivery"]["alpha_mode"] = "native"
    fixture["plan"] = stamp_document(fixture["plan"], "plan_sha256")
    return fixture, doc, probe


def quantized_pair(count, *, origin=0):
    # Regression: 24fps MP4 ticks versus a millisecond WebM clock. No media jobs.
    original = {"streams": [{"codec_type": "video", "width": 16, "height": 16,
                             "time_base": "1/12288", "avg_frame_rate": "24/1"}],
                "frames": [{"pts": origin + i * 512, "duration": 512} for i in range(count)]}
    foreground = {"streams": [{**original["streams"][0], "time_base": "1/1000"}],
                  "frames": [{"pts": (Fraction(i * 1000, 24) + Fraction(1, 2)) // 1,
                              "duration": 41} for i in range(count)]}
    return original, foreground


class AlphaSourceContractTests(unittest.TestCase):
    def test_millisecond_quantization_preserves_exact_source_time(self):
        for count in (107, 124):
            for origin in (0, 12345):
                original, foreground = quantized_pair(count, origin=origin)
                verify_video_timeline_identity(original, foreground)
                timeline = build_source_timeline(original, decoded_frame_count=count, continuity="one_shot")
                duration = timeline["raw_duration_seconds"]
                self.assertEqual(Fraction(duration["numerator"], duration["denominator"]), Fraction(count, 24))

    def test_quantization_is_not_a_timing_tolerance(self):
        original, foreground = quantized_pair(107)
        changes = [lambda p: p["frames"][1].update(pts=43),  # Only one extra ms still fails.
                   lambda p: p["frames"].pop(),
                   lambda p: p["streams"][0].update(width=32),
                   lambda p: p["frames"][-1].update(duration=43),
                   lambda p: p["frames"].reverse(),
                   lambda p: p["streams"][0].update(time_base="1/100"),
                   lambda p: p["frames"][1].update(pts_time="0.043000"),
                   lambda p: p["frames"][-1].pop("duration")]
        for mutate in changes:
            with self.subTest(mutate=mutate):
                changed = copy.deepcopy(foreground); mutate(changed)
                with self.assertRaises(ValueError):
                    verify_video_timeline_identity(original, changed)
        # Decimal-only probes keep the exact-match contract; no guessed clock.
        for payload in (original, foreground):
            tick = Fraction(payload["streams"][0]["time_base"])
            for row in payload["frames"]:
                row["pts_time"] = str(row.pop("pts") * tick)
        with self.assertRaisesRegex(ValueError, "foreground_source_timeline_mismatch"):
            verify_video_timeline_identity(original, foreground)

    def test_vfr_and_half_tick_rounding_are_deterministic(self):
        original, foreground = quantized_pair(4)
        original["streams"][0]["time_base"] = "1/10000"
        original["frames"] = [{"pts": pts, "duration": duration}
                              for pts, duration in [(0, 425), (425, 800), (1225, 375), (1600, 425)]]
        foreground["frames"] = [{"pts": pts, "duration": duration}
                                for pts, duration in [(0, 42), (43, 80), (123, 37), (160, 42)]]
        verify_video_timeline_identity(original, foreground)
        foreground["frames"][1]["pts"] = 42
        with self.assertRaisesRegex(ValueError, "foreground_source_timeline_mismatch"):
            verify_video_timeline_identity(original, foreground)

    def test_quantized_handoff_delivery_uses_original_probe(self):
        for continuity in ("loop", "one_shot"):
            with self.subTest(continuity=continuity), tempfile.TemporaryDirectory() as tmp:
                root = Path(tmp); fixture, doc, _ = alpha_fixture(root)
                original, foreground = quantized_pair(doc["decode"]["frame_count"], origin=12345)
                for path, payload in [("source-probe.json", original), ("probe.json", foreground)]:
                    write_json_atomic(root / path, payload)
                doc["source_probe"]["artifact"] = _artifact(root, root / "source-probe.json", "application/json")
                doc["probe"]["artifact"] = _artifact(root, root / "probe.json", "application/json")
                write_json_atomic(fixture["handoff_path"], stamp_document(doc, "handoff_sha256"))
                fixture["plan"]["motion"]["continuity"] = continuity
                fixture["plan"] = stamp_document(fixture["plan"], "plan_sha256")
                handoff = load_decoded_handoff(root, fixture["handoff_path"], raw_video=fixture["raw"])
                family = process_decoded_handoff(root=root, plan=fixture["plan"], handoff=handoff,
                    out_dir=root / "delivery", key_color=fixture["plan"]["delivery"]["key_color"])
                self.assertEqual(family["source_timeline"], build_source_timeline(original,
                    decoded_frame_count=doc["decode"]["frame_count"], continuity=continuity))
                self.assertEqual(validate_delivery(root / "delivery", workspace_root=root)["status"], "passed")
                # Independent validation must reject publishing the quantized
                # foreground timeline in place of the authoritative source.
                family["source_timeline"] = build_source_timeline(foreground,
                    decoded_frame_count=doc["decode"]["frame_count"], continuity=continuity)
                write_json_atomic(root / "delivery/delivery-manifest.json", stamp_document(family, "manifest_sha256"))
                with self.assertRaisesRegex(ValueError, "source_processing_timeline_mismatch"):
                    validate_delivery(root / "delivery", workspace_root=root)

    def test_full_delivery_keeps_original_and_foreground_identities(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); fixture, doc, _ = alpha_fixture(root)
            handoff = load_decoded_handoff(root, fixture["handoff_path"], raw_video=fixture["raw"])
            family = process_decoded_handoff(root=root, plan=fixture["plan"], handoff=handoff,
                out_dir=root / "delivery", key_color=fixture["plan"]["delivery"]["key_color"])
            self.assertEqual(family["raw_source"]["sha256"], fingerprint(fixture["raw"])["sha256"])
            self.assertEqual(family["source_processing"]["foreground_source"], doc["foreground_source"])
            self.assertEqual(validate_delivery(root / "delivery", workspace_root=root)["status"], "passed")
            (root / "foreground.webm").write_bytes(b"changed-transparent-source")
            with self.assertRaisesRegex(ValueError, "artifact_(sha256|size)_mismatch"):
                validate_delivery(root / "delivery", workspace_root=root)

    def test_rejects_retiming_geometry_and_changed_raw(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); fixture, doc, probe = alpha_fixture(root)
            for mutate in [lambda p: p["streams"][0].update(width=32),
                           lambda p: p["frames"][1].update(best_effort_timestamp_time="1/16")]:
                changed = copy.deepcopy(probe); mutate(changed)
                with self.assertRaisesRegex(ValueError, "foreground_source_timeline_mismatch"):
                    verify_video_timeline_identity(probe, changed)
            fixture["raw"].write_bytes(b"changed-original")
            with self.assertRaisesRegex(ValueError, "decoded_handoff_raw_invalid"):
                load_decoded_handoff(root, fixture["handoff_path"], raw_video=fixture["raw"])

    def test_native_alpha_mode_is_required_and_never_rekeys_opaque_frames(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); fixture, doc, _ = alpha_fixture(root)
            handoff = load_decoded_handoff(root, fixture["handoff_path"], raw_video=fixture["raw"])
            fixture["plan"]["delivery"].pop("alpha_mode")
            with self.assertRaisesRegex(ValueError, "requires_native_alpha_plan"):
                process_decoded_handoff(root=root, plan=fixture["plan"], handoff=handoff,
                    out_dir=root / "delivery", key_color="#00FF00")
            fixture["plan"]["delivery"]["alpha_mode"] = "native"
            Image.new("RGBA", (16, 16), (0, 255, 0, 255)).save(handoff.decoded_paths[0])
            with self.assertRaisesRegex(ValueError, "native_alpha_missing"):
                process_decoded_handoff(root=root, plan=fixture["plan"], handoff=handoff,
                    out_dir=root / "delivery", key_color="#00FF00")
