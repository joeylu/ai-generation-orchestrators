from __future__ import annotations

import tempfile
import unittest
import zipfile
from fractions import Fraction
from pathlib import Path
from unittest.mock import patch

from PIL import Image, ImageDraw
import jsonschema

from ai_frame_animation.canonical import stamp_document
from ai_frame_animation.processing import process_from_decoded
from ai_frame_animation.validation import _validate_rgba, validate_delivery


ROOT = Path(__file__).parents[1]
SCHEMAS = ROOT / "src" / "ai_frame_animation" / "schemas"


def make_plan(*, quality: str = "strict", include_gif: bool = True, frame_counts: list[int] | None = None) -> dict:
    return stamp_document(
        {
            "schema_version": "ai_frame_animation_plan_v1",
            "job_id": "fixture-loop",
            "character": {"reference": "reference.png", "reference_fingerprint": {"bytes": 1, "sha256": "0" * 64, "media_type": "image"}, "description": ""},
            "motion": {"request": "loop", "continuity": "loop"},
            "delivery": {"frame_counts": frame_counts or [16, 32, 64], "size": 128, "quality": quality, "gif": include_gif},
            "provider": {"plugin": "fixture"},
        },
        "plan_sha256",
    )


class ProcessDeliveryTests(unittest.TestCase):
    def test_best_effort_can_omit_one_variant_but_strict_cannot(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            raw = root / "raw.mp4"
            raw.write_bytes(b"fixture")
            decoded = root / "decoded"
            decoded.mkdir()
            paths = []
            for index in range(17):
                image = Image.new("RGB", (8, 8), (0, 255, 0))
                ImageDraw.Draw(image).rectangle((2, 2, 5, 7), fill=(208, 32, 32))
                path = decoded / f"source_{index + 1:06d}.png"
                image.save(path)
                paths.append(path)
            probe = {
                "streams": [{"codec_type": "video", "avg_frame_rate": "8/1", "duration_ts": "17", "time_base": "1/8"}],
                "frames": [{"best_effort_timestamp_time": str(Fraction(index, 8))} for index in range(17)],
            }
            from ai_frame_animation import processing

            original = processing._write_variant

            def fail_middle(**kwargs):
                if kwargs["atlas_profile"] == "8x4":
                    raise ValueError("fixture_variant_failure")
                return original(**kwargs)

            out = root / "best-effort"
            with patch("ai_frame_animation.processing._write_variant", side_effect=fail_middle):
                manifest = process_from_decoded(
                    root=root,
                    plan=make_plan(quality="best_effort", include_gif=False),
                    raw_video=raw,
                    decoded_paths=paths,
                    probe_payload=probe,
                    out_dir=out,
                    key_color="#00FF00",
                )
            self.assertEqual([item["atlas_profile"] for item in manifest["variants"]], ["4x4", "8x8"])
            self.assertEqual(validate_delivery(out, policy="best_effort", workspace_root=root)["status"], "passed_with_warnings")
            with self.assertRaisesRegex(ValueError, "quality_policy_mismatch"):
                validate_delivery(out, policy="strict", workspace_root=root)

    def test_strict_failure_publishes_no_partial_delivery(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            raw = root / "raw.mp4"
            raw.write_bytes(b"fixture")
            decoded = root / "decoded"
            decoded.mkdir()
            paths = []
            for index in range(17):
                image = Image.new("RGB", (8, 8), (0, 255, 0))
                ImageDraw.Draw(image).rectangle((2, 2, 5, 7), fill=(208, 32, 32))
                path = decoded / f"source_{index + 1:06d}.png"
                image.save(path)
                paths.append(path)
            probe = {
                "streams": [{"codec_type": "video", "avg_frame_rate": "8/1", "duration_ts": "17", "time_base": "1/8"}],
                "frames": [{"best_effort_timestamp_time": str(Fraction(index, 8))} for index in range(17)],
            }
            from ai_frame_animation import processing

            original = processing._write_variant

            def fail_middle(**kwargs):
                if kwargs["atlas_profile"] == "8x4":
                    raise ValueError("fixture_variant_failure")
                return original(**kwargs)

            out = root / "strict"
            with patch("ai_frame_animation.processing._write_variant", side_effect=fail_middle):
                with self.assertRaisesRegex(ValueError, "fixture_variant_failure"):
                    process_from_decoded(
                        root=root,
                        plan=make_plan(quality="strict", include_gif=False, frame_counts=[16, 32]),
                        raw_video=raw,
                        decoded_paths=paths,
                        probe_payload=probe,
                        out_dir=out,
                        key_color="#00FF00",
                    )
            self.assertFalse(out.exists())
            self.assertEqual(list(root.glob(".strict.*.processing")), [])

    def test_best_effort_keeps_variant_when_optional_gif_fails(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            raw = root / "raw.mp4"
            raw.write_bytes(b"fixture")
            decoded = root / "decoded"
            decoded.mkdir()
            paths = []
            for index in range(17):
                image = Image.new("RGB", (8, 8), (0, 255, 0))
                ImageDraw.Draw(image).rectangle((2, 2, 5, 7), fill=(208, 32, 32))
                path = decoded / f"source_{index + 1:06d}.png"
                image.save(path)
                paths.append(path)
            probe = {
                "streams": [{"codec_type": "video", "avg_frame_rate": "8/1", "duration_ts": "17", "time_base": "1/8"}],
                "frames": [{"best_effort_timestamp_time": str(Fraction(index, 8))} for index in range(17)],
            }
            out = root / "best-effort-gif"
            with patch("ai_frame_animation.processing.export_preview_gif", side_effect=ValueError("fixture_gif_failure")):
                manifest = process_from_decoded(
                    root=root,
                    plan=make_plan(quality="best_effort", include_gif=True, frame_counts=[16]),
                    raw_video=raw,
                    decoded_paths=paths,
                    probe_payload=probe,
                    out_dir=out,
                    key_color="#00FF00",
                )
            self.assertEqual(manifest["variants"][0]["warnings"], ["gif_export_failed"])
            self.assertFalse((out / "atlas-4x4" / "preview.gif").exists())
            self.assertEqual(validate_delivery(out, policy="best_effort", workspace_root=root)["status"], "passed_with_warnings")

    def test_package_members_must_match_delivery_files(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            raw = root / "raw.mp4"
            raw.write_bytes(b"fixture")
            decoded = root / "decoded"
            decoded.mkdir()
            paths = []
            for index in range(17):
                image = Image.new("RGB", (8, 8), (0, 255, 0))
                ImageDraw.Draw(image).rectangle((2, 2, 5, 7), fill=(208, 32, 32))
                path = decoded / f"source_{index + 1:06d}.png"
                image.save(path)
                paths.append(path)
            probe = {
                "streams": [{"codec_type": "video", "avg_frame_rate": "8/1", "duration_ts": "17", "time_base": "1/8"}],
                "frames": [{"best_effort_timestamp_time": str(Fraction(index, 8))} for index in range(17)],
            }
            out = root / "package"
            process_from_decoded(
                root=root,
                plan=make_plan(frame_counts=[16]),
                raw_video=raw,
                decoded_paths=paths,
                probe_payload=probe,
                out_dir=out,
                key_color="#00FF00",
            )
            package = out / "delivery.zip"
            with zipfile.ZipFile(package) as source:
                members = [(item, source.read(item.filename)) for item in source.infolist()]
            with zipfile.ZipFile(package, "w", compression=zipfile.ZIP_DEFLATED) as destination:
                for item, payload in members:
                    if item.filename == "delivery-manifest.json":
                        payload += b"\n"
                    destination.writestr(item, payload)
            with self.assertRaisesRegex(ValueError, "delivery_package_content_mismatch"):
                validate_delivery(out, policy="strict", workspace_root=root)

    def test_opaque_frame_never_passes_transparent_validation(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "opaque.png"
            Image.new("RGBA", (128, 128), (255, 0, 0, 255)).save(path)
            with self.assertRaisesRegex(ValueError, "frame_is_opaque"):
                _validate_rgba(path, 128)

    def test_atlas_profiles_share_one_raw_probe_decode_and_validate(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            raw = root / "raw.mp4"
            raw.write_bytes(b"fixture-raw-video-not-decoded-by-test")
            decoded = root / "decoded"
            decoded.mkdir()
            paths = []
            for index in range(73):
                phase = 0 if index == 72 else index
                image = Image.new("RGB", (16, 16), (0, 255, 0))
                draw = ImageDraw.Draw(image)
                x = 4 + (phase % 3)
                draw.rectangle((x, 5, x + 5, 13), fill=(208, 32, 32))
                path = decoded / f"source_{index + 1:06d}.png"
                image.save(path)
                paths.append(path)
            probe = {
                "streams": [{"codec_type": "video", "avg_frame_rate": "24/1", "duration_ts": "73", "time_base": "1/24"}],
                "frames": [{"best_effort_timestamp_time": str(Fraction(index, 24))} for index in range(73)],
            }
            out = root / "delivery"
            manifest = process_from_decoded(
                root=root,
                plan=make_plan(),
                raw_video=raw,
                decoded_paths=paths,
                probe_payload=probe,
                out_dir=out,
                key_color="#00FF00",
            )
            self.assertEqual(manifest["decode"]["operation_count"], 1)
            schema = __import__("json").loads(
                (SCHEMAS / "delivery-manifest.schema.json").read_text(encoding="utf-8")
            )
            jsonschema.validate(manifest, schema)
            self.assertEqual([item["atlas_profile"] for item in manifest["variants"]], ["4x4", "8x4", "8x8"])
            self.assertTrue(all(item["frame_count"] <= item["capacity"] for item in manifest["variants"]))
            raw_hashes = {
                __import__("json").loads((out / f"atlas-{profile}" / "manifest.json").read_text(encoding="utf-8"))["raw_sha256"]
                for profile in ("4x4", "8x4", "8x8")
            }
            self.assertEqual(raw_hashes, {manifest["raw_source"]["sha256"]})
            report = validate_delivery(out, policy="strict", workspace_root=root)
            self.assertEqual(report["status"], "passed")
            loop_map = __import__("json").loads((out / "atlas-8x8" / "manifest.json").read_text(encoding="utf-8"))["timeline"]["source_frame_index_map"]
            self.assertNotIn(72, loop_map)


if __name__ == "__main__":
    unittest.main()
