from __future__ import annotations

import json
import io
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from fractions import Fraction
from pathlib import Path
from unittest.mock import patch

from PIL import Image, ImageDraw

from ai_frame_animation.canonical import fingerprint, stamp_document, write_json_atomic
from ai_frame_animation.cli import main as cli_main
from ai_frame_animation.handoff import load_decoded_handoff
from ai_frame_animation.media.matte import parse_hex_color
from ai_frame_animation.planning import compile_plan
from ai_frame_animation.validation import inspect_artifact, validate_delivery


def _artifact(root: Path, path: Path, media_type: str) -> dict:
    return {"path": path.relative_to(root).as_posix(), **fingerprint(path, media_type=media_type)}


def build_fixture(root: Path, *, frame_counts: list[int] | None = None) -> dict:
    reference = root / "reference.png"
    Image.new("RGB", (8, 8), (208, 32, 32)).save(reference)
    plan = compile_plan(
        {
            "schema_version": "1.0",
            "job_id": "decoded-handoff-fixture",
            "character": {"reference": "reference.png", "description": "fixture character"},
            "motion": {"request": "idle loop", "continuity": "loop"},
            "delivery": {"frame_counts": frame_counts or [16, 32, 64], "size": 128, "quality": "strict", "gif": False},
            "provider": {"plugin": "fixture"},
        },
        root,
    )
    plan_path = root / "plan.json"
    write_json_atomic(plan_path, plan)

    raw = root / "raw.mp4"
    raw.write_bytes(b"fixture-raw-video-never-decoded")
    probe_payload = {
        "streams": [{"codec_type": "video", "avg_frame_rate": "8/1", "duration_ts": "17", "time_base": "1/8"}],
        "frames": [{"best_effort_timestamp_time": str(Fraction(index, 8))} for index in range(17)],
    }
    probe_path = root / "probe.json"
    write_json_atomic(probe_path, probe_payload)

    decoded = root / "decoded"
    decoded.mkdir()
    background = parse_hex_color(plan["delivery"]["key_color"])
    frame_records = []
    for index in range(17):
        image = Image.new("RGB", (16, 16), background)
        ImageDraw.Draw(image).rectangle((4 + index % 2, 5, 9 + index % 2, 13), fill=(208, 32, 32))
        frame = decoded / f"decoded_{index:08d}.png"
        image.save(frame)
        frame_records.append({"index": index, "artifact": _artifact(root, frame, "image/png")})

    handoff = stamp_document(
        {
            "schema_version": "ai_frame_animation_decoded_handoff_v1",
            "raw_source": _artifact(root, raw, "video"),
            "probe": {
                "operation_count": 1,
                "artifact": _artifact(root, probe_path, "application/json"),
                "tool": {"name": "fixture-ffprobe", "version": "fixture-1", "sha256": "1" * 64},
            },
            "decode": {
                "operation_count": 1,
                "policy": "single_lossless_png_decode",
                "directory": decoded.relative_to(root).as_posix(),
                "frame_count": len(frame_records),
                "frames": frame_records,
                "tool": {"name": "fixture-ffmpeg", "version": "fixture-1", "sha256": "2" * 64},
            },
        },
        "handoff_sha256",
    )
    handoff_path = root / "decoded-handoff.json"
    write_json_atomic(handoff_path, handoff)
    return {"plan": plan, "plan_path": plan_path, "raw": raw, "handoff": handoff, "handoff_path": handoff_path, "decoded": decoded}


class DecodedHandoffTests(unittest.TestCase):
    def test_cli_processes_family_without_invoking_media_tools(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            fixture = build_fixture(root)
            out = root / "delivery"
            with (
                patch("ai_frame_animation.cli.resolve_media_tool", side_effect=AssertionError("media tool resolution is forbidden")),
                patch("ai_frame_animation.processing.probe_video", side_effect=AssertionError("probe is forbidden")),
                patch("ai_frame_animation.processing.decode_video_once", side_effect=AssertionError("decode is forbidden")),
                redirect_stdout(io.StringIO()),
                redirect_stderr(io.StringIO()),
            ):
                result = cli_main(
                    [
                        "process",
                        "--root", str(root),
                        "--plan", str(fixture["plan_path"]),
                        "--raw-video", str(fixture["raw"]),
                        "--decoded-handoff", str(fixture["handoff_path"]),
                        "--out-dir", str(out),
                    ]
                )
            self.assertEqual(result, 0)
            manifest = json.loads((out / "delivery-manifest.json").read_text(encoding="utf-8"))
            self.assertEqual(manifest["decode"], {
                "probe_operation_count": 1,
                "operation_count": 1,
                "decoded_frame_count": 17,
                "input_mode": "verified_decoded_handoff",
                "handoff_sha256": fixture["handoff"]["handoff_sha256"],
            })
            self.assertEqual([item["atlas_profile"] for item in manifest["variants"]], ["4x4", "8x4", "8x8"])
            self.assertTrue(all(item["frame_count"] <= item["capacity"] for item in manifest["variants"]))
            self.assertEqual(validate_delivery(out, policy="strict", workspace_root=root)["status"], "passed")
            inspection = inspect_artifact(out)
            self.assertEqual(inspection["decode_input_mode"], "verified_decoded_handoff")
            self.assertEqual(inspection["decoded_handoff_sha256"], fixture["handoff"]["handoff_sha256"])

    def test_raw_source_must_match_the_digest_bound_handoff(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            fixture = build_fixture(root, frame_counts=[16])
            other = root / "other.mp4"
            other.write_bytes(fixture["raw"].read_bytes())
            with self.assertRaisesRegex(ValueError, "decoded_handoff_raw_mismatch"):
                load_decoded_handoff(root, fixture["handoff_path"], raw_video=other)

    def test_frame_tampering_is_rejected_before_processing(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            fixture = build_fixture(root, frame_counts=[16])
            frame = fixture["decoded"] / "decoded_00000000.png"
            frame.write_bytes(frame.read_bytes() + b"tampered")
            with self.assertRaisesRegex(ValueError, "decoded_handoff_frame_invalid"):
                load_decoded_handoff(root, fixture["handoff_path"], raw_video=fixture["raw"])

    def test_extra_decoded_file_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            fixture = build_fixture(root, frame_counts=[16])
            (fixture["decoded"] / "unregistered.png").write_bytes(b"not-a-frame")
            with self.assertRaisesRegex(ValueError, "decoded_handoff_frame_inventory_invalid"):
                load_decoded_handoff(root, fixture["handoff_path"], raw_video=fixture["raw"])

    def test_probe_tampering_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            fixture = build_fixture(root, frame_counts=[16])
            (root / "probe.json").write_text("{}\n", encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "decoded_handoff_probe_invalid"):
                load_decoded_handoff(root, fixture["handoff_path"], raw_video=fixture["raw"])

    def test_probe_payload_rejects_unbounded_ffprobe_fields(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            fixture = build_fixture(root, frame_counts=[16])
            probe_path = root / "probe.json"
            probe = json.loads(probe_path.read_text(encoding="utf-8"))
            probe["format"] = {"duration": "2.125", "filename": "private/source.mp4"}
            write_json_atomic(probe_path, probe)
            value = json.loads(fixture["handoff_path"].read_text(encoding="utf-8"))
            value["probe"]["artifact"] = _artifact(root, probe_path, "application/json")
            write_json_atomic(fixture["handoff_path"], stamp_document(value, "handoff_sha256"))
            with self.assertRaisesRegex(ValueError, "decoded_handoff_probe_payload_invalid"):
                load_decoded_handoff(root, fixture["handoff_path"], raw_video=fixture["raw"])

    def test_probe_and_decode_frame_counts_must_match(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            fixture = build_fixture(root, frame_counts=[16])
            probe_path = root / "probe.json"
            probe = json.loads(probe_path.read_text(encoding="utf-8"))
            probe["frames"].pop()
            write_json_atomic(probe_path, probe)
            value = json.loads(fixture["handoff_path"].read_text(encoding="utf-8"))
            value["probe"]["artifact"] = _artifact(root, probe_path, "application/json")
            write_json_atomic(fixture["handoff_path"], stamp_document(value, "handoff_sha256"))
            with self.assertRaisesRegex(ValueError, "decoded_handoff_frame_inventory_invalid"):
                load_decoded_handoff(root, fixture["handoff_path"], raw_video=fixture["raw"])

    def test_noncontiguous_frame_indices_are_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            fixture = build_fixture(root, frame_counts=[16])
            value = json.loads(fixture["handoff_path"].read_text(encoding="utf-8"))
            value["decode"]["frames"][1]["index"] = 2
            write_json_atomic(fixture["handoff_path"], stamp_document(value, "handoff_sha256"))
            with self.assertRaisesRegex(ValueError, "decoded_handoff_frame_inventory_invalid"):
                load_decoded_handoff(root, fixture["handoff_path"], raw_video=fixture["raw"])

    def test_handoff_digest_tampering_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            fixture = build_fixture(root, frame_counts=[16])
            value = json.loads(fixture["handoff_path"].read_text(encoding="utf-8"))
            value["decode"]["tool"]["version"] = "tampered"
            write_json_atomic(fixture["handoff_path"], value)
            with self.assertRaisesRegex(ValueError, "handoff_sha256_mismatch"):
                load_decoded_handoff(root, fixture["handoff_path"], raw_video=fixture["raw"])

    def test_fixture_only_inputs_cannot_be_combined_with_handoff(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            fixture = build_fixture(root, frame_counts=[16])
            with redirect_stdout(io.StringIO()), redirect_stderr(io.StringIO()):
                result = cli_main(
                    [
                        "process",
                        "--root", str(root),
                        "--plan", str(fixture["plan_path"]),
                        "--raw-video", str(fixture["raw"]),
                        "--decoded-handoff", str(fixture["handoff_path"]),
                        "--decoded-dir", str(fixture["decoded"]),
                        "--probe-json", str(root / "probe.json"),
                        "--out-dir", str(root / "delivery"),
                    ]
                )
            self.assertEqual(result, 2)

    def test_contract_paths_cannot_escape_the_workspace(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            fixture = build_fixture(root, frame_counts=[16])
            value = json.loads(fixture["handoff_path"].read_text(encoding="utf-8"))
            value["raw_source"]["path"] = "../raw.mp4"
            write_json_atomic(fixture["handoff_path"], stamp_document(value, "handoff_sha256"))
            with self.assertRaisesRegex(ValueError, "decoded_handoff_raw_invalid"):
                load_decoded_handoff(root, fixture["handoff_path"], raw_video=fixture["raw"])

if __name__ == "__main__":
    unittest.main()
