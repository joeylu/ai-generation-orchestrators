from __future__ import annotations

import argparse
import contextlib
import io
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import jsonschema

from ai_frame_animation.cli import command_doctor
from ai_frame_animation.onboarding import initialize_workspace, run_self_test


ROOT = Path(__file__).parents[1]
SCHEMAS = ROOT / "src" / "ai_frame_animation" / "schemas"


class OnboardingTests(unittest.TestCase):
    def test_init_creates_private_by_default_workspace_without_media(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            workspace = Path(temporary) / "runner"
            report = initialize_workspace(
                workspace,
                motion="side-view running cycle",
                reference="hero/reference.png",
                continuity="loop",
                frame_counts=[32, 16, 32],
            )
            self.assertEqual(report["status"], "initialized")
            self.assertEqual(report["network_probe"], "not_performed")
            self.assertEqual(report["provider_compute"], "not_performed")
            self.assertFalse((workspace / "hero" / "reference.png").exists())
            job = json.loads((workspace / "job.json").read_text(encoding="utf-8"))
            schema = json.loads(
                (SCHEMAS / "job.schema.json").read_text(encoding="utf-8")
            )
            jsonschema.validate(job, schema)
            self.assertEqual(job["delivery"]["frame_counts"], [16, 32])
            self.assertIn("/.ai-frame-animation/", (workspace / ".gitignore").read_text(encoding="utf-8"))
            self.assertTrue((workspace / ".ai-frame-animation" / "provider.minimax-h3.json").is_file())

    def test_init_refuses_nonempty_root_and_escaping_reference(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            workspace = Path(temporary) / "existing"
            workspace.mkdir()
            marker = workspace / "keep.txt"
            marker.write_text("keep\n", encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "init_root_must_be_missing_or_empty"):
                initialize_workspace(workspace, motion="wave")
            self.assertEqual(marker.read_text(encoding="utf-8"), "keep\n")

            empty = Path(temporary) / "empty"
            with self.assertRaisesRegex(ValueError, "init_reference_must_be_safe_relative_path"):
                initialize_workspace(empty, motion="wave", reference="../private.png")
            self.assertFalse(empty.exists())
            with self.assertRaisesRegex(ValueError, "init_reference_must_be_safe_relative_path"):
                initialize_workspace(empty, motion="wave", reference="..\\private.png")
            self.assertFalse(empty.exists())
            with self.assertRaisesRegex(ValueError, "init_reference_must_be_safe_relative_path"):
                initialize_workspace(empty, motion="wave", reference=".git/config")
            self.assertFalse(empty.exists())
            with self.assertRaisesRegex(ValueError, "init_reference_must_be_safe_relative_path"):
                initialize_workspace(empty, motion="wave", reference="C:private.png")
            self.assertFalse(empty.exists())

    def test_self_test_is_offline_and_generates_no_media(self) -> None:
        report = run_self_test()
        self.assertEqual(report["status"], "passed")
        self.assertFalse(report["media_generated"])
        self.assertEqual(report["network_probe"], "not_performed")
        self.assertEqual(report["provider_compute"], "not_performed")
        self.assertEqual(report["gpu_compute"], "not_performed")
        self.assertIn("character-motion-intent.schema.json", report["checks"]["packaged_schemas"])

    def test_doctor_reports_actionable_capabilities_without_probe(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            args = argparse.Namespace(
                provider=None,
                provider_config=None,
                root=Path(temporary),
                ffmpeg="ffmpeg",
                ffprobe="ffprobe",
                require_ready=True,
            )
            output = io.StringIO()
            with patch("ai_frame_animation.media_tools.shutil.which", return_value=None):
                with contextlib.redirect_stdout(output):
                    self.assertEqual(command_doctor(args), 1)
            report = json.loads(output.getvalue())
            self.assertEqual(report["status"], "action_required")
            self.assertEqual(report["capabilities"]["planning"], "ready")
            self.assertEqual(report["capabilities"]["processing"], "action_required")
            self.assertEqual(report["capabilities"]["generation"], "not_checked")
            self.assertTrue(report["actions"])
            self.assertEqual(report["network_probe"], "not_performed")
            self.assertEqual(report["provider_compute"], "not_performed")

    def test_doctor_accepts_provider_neutral_ready_status(self) -> None:
        class ReadyProvider:
            def doctor(self):
                return {"plugin": "fixture", "status": "ready", "network_probe": "not_performed"}

        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            config = root / "provider.json"
            config.write_text("{}\n", encoding="utf-8")
            args = argparse.Namespace(
                provider="fixture",
                provider_config=config,
                root=root,
                ffmpeg="ffmpeg",
                ffprobe="ffprobe",
                require_ready=True,
            )
            output = io.StringIO()
            with patch("ai_frame_animation.cli.load_provider", return_value=ReadyProvider()):
                with patch("ai_frame_animation.media_tools.shutil.which", return_value="available"):
                    with contextlib.redirect_stdout(output):
                        self.assertEqual(command_doctor(args), 0)
            report = json.loads(output.getvalue())
            self.assertEqual(report["status"], "ready")
            self.assertEqual(report["capabilities"]["generation"], "statically_ready")
            self.assertEqual(report["actions"], [])

    def test_doctor_discovers_project_local_ffmpeg_tools(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            bin_dir = root / ".ai-frame-animation" / "tools" / "ffmpeg" / "bin"
            bin_dir.mkdir(parents=True)
            suffix = ".exe" if os.name == "nt" else ""
            for name in ("ffmpeg", "ffprobe"):
                tool = bin_dir / f"{name}{suffix}"
                tool.write_bytes(b"fixture")
                if os.name != "nt":
                    tool.chmod(0o755)
            args = argparse.Namespace(
                provider=None,
                provider_config=None,
                root=root,
                ffmpeg=None,
                ffprobe=None,
                require_ready=True,
            )
            output = io.StringIO()
            with patch("ai_frame_animation.media_tools.shutil.which", return_value=None):
                with contextlib.redirect_stdout(output):
                    self.assertEqual(command_doctor(args), 0)
            report = json.loads(output.getvalue())
            self.assertEqual(report["executables"], {"ffmpeg": "available", "ffprobe": "available"})
            self.assertEqual(report["capabilities"]["processing"], "ready")


if __name__ == "__main__":
    unittest.main()
