from __future__ import annotations

import argparse
import contextlib
import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from urllib.error import HTTPError, URLError

from PIL import Image

from ai_frame_animation.canonical import write_json_atomic
from ai_frame_animation.cli import command_run
from ai_frame_animation.planning import compile_plan
from ai_frame_animation.providers.base import GenerationIndeterminate, GenerationNotSubmitted
from ai_frame_animation.providers.minimax_h3 import MiniMaxH3Provider
from ai_frame_animation.state import AttemptStore


class FakeProvider:
    def __init__(self, *, indeterminate: bool = False):
        self.submit_count = 0
        self.indeterminate = indeterminate

    def doctor(self):
        return {"network_probe": "not_performed"}

    def submit_once(self, plan, submission_token):
        self.submit_count += 1
        return "request-1"

    def await_result(self, request_id, destination):
        if self.indeterminate:
            raise GenerationIndeterminate("fixture_timeout")
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(b"raw-video-fixture")
        return destination


class ProviderAttemptTests(unittest.TestCase):
    def _plan(self, root: Path) -> Path:
        Image.new("RGBA", (4, 4), (255, 0, 0, 255)).save(root / "reference.png")
        job = {
            "schema_version": "1.0",
            "job_id": "one-submit",
            "character": {"reference": "reference.png"},
            "motion": {"request": "wave", "continuity": "one_shot"},
            "delivery": {"frame_counts": [16], "size": 128, "quality": "strict", "gif": True},
            "provider": {"plugin": "fixture"},
        }
        plan = compile_plan(job, root)
        path = root / "plan.json"
        write_json_atomic(path, plan)
        return path

    def _args(self, root: Path, plan: Path, digest: str, attempt_id: str) -> argparse.Namespace:
        config = root / "provider.json"
        config.write_text("{}\n", encoding="utf-8")
        return argparse.Namespace(
            root=root,
            plan=plan,
            confirm_plan_sha256=digest,
            attempt_id=attempt_id,
            state_dir=Path("state"),
            provider_config=config,
            raw_out=Path(f"raw/{attempt_id}.mp4"),
        )

    def test_run_submits_once_and_attempt_cannot_be_replayed(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            plan_path = self._plan(root)
            digest = json.loads(plan_path.read_text(encoding="utf-8"))["plan_sha256"]
            provider = FakeProvider()
            args = self._args(root, plan_path, digest, "attempt-1")
            with patch("ai_frame_animation.cli.load_provider", return_value=provider):
                with contextlib.redirect_stdout(io.StringIO()):
                    self.assertEqual(command_run(args), 0)
                with self.assertRaisesRegex(ValueError, "attempt_already_exists_or_consumed"):
                    command_run(args)
            self.assertEqual(provider.submit_count, 1)

    def test_indeterminate_attempt_is_terminal_without_resubmit(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            plan_path = self._plan(root)
            digest = json.loads(plan_path.read_text(encoding="utf-8"))["plan_sha256"]
            provider = FakeProvider(indeterminate=True)
            args = self._args(root, plan_path, digest, "attempt-timeout")
            with patch("ai_frame_animation.cli.load_provider", return_value=provider):
                with self.assertRaises(GenerationIndeterminate):
                    command_run(args)
            states = [event["state"] for event in AttemptStore(root / "state", "attempt-timeout").read()]
            self.assertEqual(states[-1], "GENERATION_INDETERMINATE")
            self.assertEqual(provider.submit_count, 1)

    def test_minimax_adapter_calls_prompt_exactly_once(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            reference = Image.new("RGBA", (4, 4), (0, 0, 0, 0))
            reference.putpixel((1, 1), (255, 0, 0, 255))
            reference.save(root / "reference.png")
            workflow = {
                "1": {"inputs": {"image": ""}, "class_type": "LoadImage"},
                "2": {"inputs": {"text": ""}, "class_type": "Text"},
            }
            (root / "workflow.json").write_text(json.dumps(workflow), encoding="utf-8")
            config = {
                "base_url": "http://127.0.0.1:8188",
                "workflow_path": "workflow.json",
                "bindings": {
                    "reference_image": {"node": "1", "input": "image"},
                    "positive_prompt": {"node": "2", "input": "text"},
                },
            }
            config_path = root / "config.json"
            config_path.write_text(json.dumps(config), encoding="utf-8")
            provider = MiniMaxH3Provider(config_path=config_path, root=root)
            calls = []
            provider._upload_reference = lambda path, token, payload: {"name": "uploaded.png"}  # type: ignore[method-assign]
            provider._post_json = lambda relative, payload: calls.append((relative, payload)) or {"prompt_id": "p1"}  # type: ignore[method-assign]
            plan = {"character": {"reference": "reference.png"}, "delivery": {"key_color": "#00FF00"}, "generation": {"prompt": "wave on a solid key background"}}
            self.assertEqual(provider.submit_once(plan, "token"), "p1")
            with self.assertRaises(GenerationIndeterminate):
                provider.submit_once(plan, "token-2")
            self.assertEqual([item[0] for item in calls], ["prompt"])
            doctor = provider.doctor()
            self.assertEqual(doctor["network_probe"], "not_performed")
            self.assertEqual(doctor["workflow_path"], "<redacted>")
            self.assertEqual(doctor["status"], "ready")
            self.assertTrue(doctor["workflow_valid"])
            self.assertEqual(doctor["diagnostic_code"], "ready")

    def test_minimax_doctor_rejects_invalid_binding_without_network(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            workflow = {"1": {"inputs": {"different": ""}, "class_type": "LoadImage"}}
            (root / "workflow.json").write_text(json.dumps(workflow), encoding="utf-8")
            config = {
                "base_url": "http://127.0.0.1:8188",
                "workflow_path": "workflow.json",
                "bindings": {
                    "reference_image": {"node": "1", "input": "image"},
                    "positive_prompt": {"node": "2", "input": "text"},
                },
            }
            config_path = root / "config.json"
            config_path.write_text(json.dumps(config), encoding="utf-8")
            provider = MiniMaxH3Provider(config_path=config_path, root=root)
            with patch("ai_frame_animation.providers.minimax_h3.urlopen") as urlopen:
                report = provider.doctor()
            urlopen.assert_not_called()
            self.assertEqual(report["status"], "action_required")
            self.assertFalse(report["workflow_valid"])
            self.assertEqual(report["diagnostic_code"], "minimax_h3_workflow_input_missing:reference_image")

    def test_minimax_http400_is_definitive_not_submitted_but_transport_remains_indeterminate(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            reference = Image.new("RGBA", (4, 4), (0, 0, 0, 0))
            reference.putpixel((1, 1), (255, 0, 0, 255))
            reference.save(root / "reference.png")
            workflow = {"1": {"inputs": {"image": ""}, "class_type": "LoadImage"},
                        "2": {"inputs": {"text": ""}, "class_type": "Text"}}
            (root / "workflow.json").write_text(json.dumps(workflow), encoding="utf-8")
            config = {"base_url": "http://127.0.0.1:8188", "workflow_path": "workflow.json",
                      "bindings": {"reference_image": {"node": "1", "input": "image"},
                                   "positive_prompt": {"node": "2", "input": "text"}}}
            (root / "config.json").write_text(json.dumps(config), encoding="utf-8")
            plan = {"character": {"reference": "reference.png"}, "delivery": {"key_color": "#00FF00"},
                    "generation": {"prompt": "fixture"}}
            cases = ((HTTPError("http://127.0.0.1/prompt", 400, "bad", {}, io.BytesIO()), GenerationNotSubmitted, "prompt_rejected"),
                     (HTTPError("http://127.0.0.1/prompt", 500, "bad", {}, io.BytesIO()), GenerationIndeterminate, "result_unknown"),
                     (URLError("closed"), GenerationIndeterminate, "result_unknown"))
            for error, expected, message in cases:
                provider = MiniMaxH3Provider(config_path=root / "config.json", root=root)
                provider._upload_reference = lambda path, token, payload: {"name": "uploaded.png"}  # type: ignore[method-assign]
                provider._post_json = lambda relative, payload, error=error: (_ for _ in ()).throw(error)  # type: ignore[method-assign]
                try:
                    with self.subTest(error=type(error).__name__, code=getattr(error, "code", None)), self.assertRaisesRegex(expected, message):
                        provider.submit_once(plan, "token")
                finally:
                    if isinstance(error, HTTPError):
                        error.close()

    def test_minimax_adapter_rejects_lookalike_loopback_host(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            config = {
                "base_url": "http://localhost.evil.example",
                "workflow_path": "workflow.json",
                "bindings": {
                    "reference_image": {"node": "1", "input": "image"},
                    "positive_prompt": {"node": "2", "input": "text"},
                },
            }
            config_path = root / "config.json"
            config_path.write_text(json.dumps(config), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "loopback"):
                MiniMaxH3Provider(config_path=config_path, root=root)


if __name__ == "__main__":
    unittest.main()
