from __future__ import annotations

import argparse
import json
import tempfile
import unittest
from fractions import Fraction
from pathlib import Path
from unittest.mock import patch

from PIL import Image, ImageDraw, ImageSequence

from ai_frame_animation.canonical import redact, stamp_document, verify_document, write_json_atomic
from ai_frame_animation.cli import build_parser, command_process
from ai_frame_animation.media.gif import export_preview_gif
from ai_frame_animation.media.cycle import select_semantic_interval
from ai_frame_animation.media.key_analysis import _visible_pixels, analyze_key_color
from ai_frame_animation.media.spritesheet import pack_video_spritesheet
from ai_frame_animation.media.timeline import build_source_timeline, build_variant_timeline, choose_atlas_indices, choose_uniform_indices
from ai_frame_animation.planning import compile_plan, validate_plan_contract
from ai_frame_animation.state import AttemptStore


class CoreContractTests(unittest.TestCase):
    def test_cli_exposes_public_workflow_and_onboarding_commands(self) -> None:
        parser = build_parser()
        subparsers_action = next(action for action in parser._actions if getattr(action, "choices", None))
        self.assertEqual(
            set(subparsers_action.choices),
            {"init", "self-test", "tools", "intent", "compile", "doctor", "plan", "run", "process", "inspect", "validate", "compare"},
        )

    def test_plan_is_digest_bound_and_provider_config_free(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            reference = root / "reference.png"
            Image.new("RGBA", (4, 4), (255, 0, 0, 255)).save(reference)
            job = {
                "schema_version": "1.0",
                "job_id": "run-loop",
                "character": {"reference": "reference.png", "description": "red runner"},
                "motion": {"request": "run in place", "continuity": "loop"},
                "delivery": {"frame_counts": [64, 16, 32, 16], "size": 128, "quality": "strict", "gif": True},
                "provider": {"plugin": "minimax_h3"},
            }
            plan = compile_plan(job, root)
            self.assertEqual(verify_document(plan, "plan_sha256"), plan["plan_sha256"])
            self.assertEqual(plan["delivery"]["atlas_profiles"], ["4x4", "8x4", "8x8"])
            encoded = json.dumps(plan)
            self.assertNotIn("workflow", encoded)
            self.assertNotIn("base_url", encoded)
            job["delivery"]["gif"] = "false"
            with self.assertRaisesRegex(ValueError, "delivery_gif_invalid"):
                compile_plan(job, root)
            plan["provider"]["config_path"] = "private.json"
            plan = stamp_document(plan, "plan_sha256")
            with self.assertRaisesRegex(ValueError, "plan.provider_unknown_fields"):
                validate_plan_contract(plan)

    def test_bounded_key_analysis_matches_full_analysis_on_uniform_regions(self) -> None:
        image = Image.new("RGBA", (256, 256), (220, 32, 32, 255))
        full = analyze_key_color(image)
        bounded = analyze_key_color(image, max_pixels=1024)
        sampled, _mode = _visible_pixels(image, 16, max_pixels=1024)
        self.assertEqual(bounded["selected"], full["selected"])
        self.assertLessEqual(len(sampled), 1024)

    def test_attempt_confirmation_is_single_use(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            digest = "a" * 64
            store = AttemptStore(root, "attempt-1")
            store.create_authorized(plan_sha256=digest, confirmed_sha256=digest)
            store.append("GENERATING")
            store.append("GENERATION_INDETERMINATE", {"code": "timeout"})
            with self.assertRaisesRegex(ValueError, "attempt_is_terminal"):
                store.append("GENERATING")
            with self.assertRaisesRegex(ValueError, "attempt_already_exists_or_consumed"):
                AttemptStore(root, "attempt-1").create_authorized(plan_sha256=digest, confirmed_sha256=digest)
            event = json.loads(store.events_path.read_text(encoding="utf-8").splitlines()[0])
            event["attempt_id"] = "different-attempt"
            event = stamp_document(event, "event_sha256")
            store.events_path.write_text(json.dumps(event) + "\n", encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "attempt_event_invalid"):
                store.read()

    def test_loop_and_one_shot_preserve_rational_timeline(self) -> None:
        frames = [{"best_effort_timestamp_time": str(Fraction(index, 24))} for index in range(73)]
        probe = {
            "streams": [{"codec_type": "video", "avg_frame_rate": "24/1", "duration_ts": "73", "time_base": "1/24"}],
            "frames": frames,
        }
        loop = build_source_timeline(probe, decoded_frame_count=73, continuity="loop")
        self.assertEqual(loop["raw_duration_seconds"]["numerator"], 73)
        self.assertEqual(loop["semantic_duration_seconds"], {"numerator": 3, "denominator": 1, "decimal": "3"})
        loop_indices = choose_uniform_indices(73, 64, continuity="loop")
        self.assertNotIn(72, loop_indices)
        loop_variant = build_variant_timeline(loop, loop_indices, 64)
        self.assertEqual((loop_variant["playback_fps"]["numerator"], loop_variant["playback_fps"]["denominator"]), (64, 3))

        one_shot = build_source_timeline(probe, decoded_frame_count=73, continuity="one_shot")
        one_shot_indices = choose_uniform_indices(73, 64, continuity="one_shot")
        self.assertEqual(one_shot_indices[-1], 72)
        one_shot_variant = build_variant_timeline(one_shot, one_shot_indices, 64)
        self.assertEqual((one_shot_variant["playback_fps"]["numerator"], one_shot_variant["playback_fps"]["denominator"]), (1536, 73))

    def test_twenty_one_native_frames_use_atlas_capacity_without_padding_frames(self) -> None:
        fixture = json.loads((Path(__file__).parent / "fixtures/golden/timeline-atlas-cases.json").read_text(encoding="utf-8"))
        case = fixture["cases"][0]
        start, end = case["interval"]["start"], case["interval"]["end_exclusive"]
        compact = choose_atlas_indices(start, end, case["profiles"]["4x4"]["capacity"], continuity="loop")
        medium = choose_atlas_indices(start, end, case["profiles"]["8x4"]["capacity"], continuity="loop")
        large = choose_atlas_indices(start, end, case["profiles"]["8x8"]["capacity"], continuity="loop")
        self.assertEqual(len(compact), case["profiles"]["4x4"]["expected_frame_count"])
        self.assertEqual(medium, list(range(start, end)))
        self.assertEqual(large, medium)
        self.assertEqual(len(set(compact)), 16)

        frames = [Image.new("RGBA", (2, 2), (index, 0, 0, 255)) for index in range(21)]
        sheet, atlas = pack_video_spritesheet(frames, profile="8x4")
        self.assertEqual(atlas["layout"]["frame_count"], case["profiles"]["8x4"]["expected_frame_count"])
        self.assertEqual(atlas["layout"]["unused_cells"], case["profiles"]["8x4"]["unused_cells"])
        self.assertEqual(sheet.crop((10, 4, 12, 6)).getbbox(), None)

    def test_cycle_selector_finds_repeated_native_period_without_llm(self) -> None:
        images = []
        for index in range(40):
            phase = (index - 4) % 12
            image = Image.new("RGB", (64, 48), (0, 255, 0))
            draw = ImageDraw.Draw(image)
            x = 18 + (phase if phase <= 6 else 12 - phase)
            y = 14 + abs(phase - 6) // 3
            draw.rectangle((x, y, x + 15, y + 25), fill=(80, 40 + phase * 8, 180))
            draw.rectangle((x - 3, y + 20, x + 2, y + 28), fill=(220, 180, 80))
            images.append(image)
        probe = {
            "streams": [{"codec_type": "video", "avg_frame_rate": "24/1", "duration_ts": "40", "time_base": "1/24"}],
            "frames": [{"best_effort_timestamp_time": str(Fraction(index, 24))} for index in range(40)],
        }
        timeline = build_source_timeline(probe, decoded_frame_count=40, continuity="loop")
        selected = select_semantic_interval(images, timeline, continuity="loop")
        self.assertEqual(selected["policy"], "deterministic_pose_cycle_v1")
        self.assertEqual(selected["native_frame_count"], 12)

    def test_gif_maps_all_nonopaque_pixels_to_transparency(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            out = Path(temporary) / "preview.gif"
            image = Image.new("RGBA", (3, 1))
            image.putdata([(0, 0, 0, 0), (255, 0, 0, 128), (0, 0, 255, 255)])
            export_preview_gif(images=[image, image], out_gif=out, fps=12)
            with Image.open(out) as gif:
                decoded = [frame.convert("RGBA") for frame in ImageSequence.Iterator(gif)]
            self.assertEqual([pixel[3] for pixel in decoded[0].get_flattened_data()], [0, 0, 255])

    def test_doctor_redaction_hides_secrets_queries_and_paths(self) -> None:
        value = redact(
            {
                "api_key": "secret",
                "base_url": "https://private.example/prompt?token=secret",
                "workflow_path": "C:/private/workflow.json",
            }
        )
        self.assertEqual(value["api_key"], "<redacted>")
        self.assertNotIn("private.example", value["base_url"])
        self.assertNotIn("token", value["base_url"])
        self.assertEqual(value["workflow_path"], "<redacted>")

    def test_predecoded_fixture_path_requires_explicit_test_mode(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            raw = root / "raw.mp4"
            raw.write_bytes(b"fixture")
            decoded = root / "decoded"
            decoded.mkdir()
            probe = root / "probe.json"
            probe.write_text("{}\n", encoding="utf-8")
            Image.new("RGB", (4, 4), (255, 0, 0)).save(root / "reference.png")
            plan = compile_plan(
                {
                    "schema_version": "1.0",
                    "job_id": "fixture",
                    "character": {"reference": "reference.png"},
                    "motion": {"request": "loop", "continuity": "loop"},
                    "delivery": {"frame_counts": [16], "size": 128, "quality": "strict", "gif": False},
                    "provider": {"plugin": "fixture"},
                },
                root,
            )
            plan_path = root / "plan.json"
            write_json_atomic(plan_path, plan)
            args = argparse.Namespace(
                root=root,
                plan=Path("plan.json"),
                raw_video=Path("raw.mp4"),
                out_dir=Path("delivery"),
                decoded_dir=Path("decoded"),
                probe_json=Path("probe.json"),
                ffprobe="ffprobe",
                ffmpeg="ffmpeg",
            )
            with patch.dict("os.environ", {}, clear=True):
                with self.assertRaisesRegex(ValueError, "offline_decoded_fixture_requires_test_mode"):
                    command_process(args)


if __name__ == "__main__":
    unittest.main()
