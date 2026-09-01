from __future__ import annotations

import contextlib
import io
import os
import re
import shlex
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from PIL import Image

from ai_frame_animation.cli import build_parser, main


ROOT = Path(__file__).parents[2]


def quickstart_commands(*, existing_video_only: bool = False) -> list[list[str]]:
    text = (ROOT / "README.zh-CN.md").read_text(encoding="utf-8")
    if existing_video_only:
        text = text.split("## B：", 1)[0]
    return [
        shlex.split(value)
        for value in re.findall(r"(?m)^& \$AnimationPython -m ai_frame_animation (.+)$", text)
    ]


class QuickstartTests(unittest.TestCase):
    def test_local_document_links_resolve_within_the_repository(self) -> None:
        files = [
            *sorted(ROOT.glob("*.md")),
            *sorted((ROOT / ".github").glob("*.md")),
            *sorted((ROOT / "artwork-harnesses").rglob("*.md")),
            *sorted((ROOT / "audio-harnesses").rglob("*.md")),
            *sorted((ROOT / "game-ui-harnesses").rglob("*.md")),
            *sorted((ROOT / "game-scene-harnesses").rglob("*.md")),
        ]
        for file in files:
            text = re.sub(r"```.*?```", "", file.read_text(encoding="utf-8"), flags=re.DOTALL)
            for target in re.findall(r"\]\(([^)]+)\)", text):
                if "://" in target:
                    continue
                path_part = target.split("#", 1)[0]
                resolved = (file.parent / path_part).resolve() if path_part else file
                with self.subTest(file=file.name, target=target):
                    self.assertTrue(resolved.is_relative_to(ROOT.resolve()))
                    self.assertTrue(resolved.exists())

    def test_documented_commands_use_real_cli_options(self) -> None:
        commands = quickstart_commands()
        self.assertTrue(commands)
        parser = build_parser()
        for argv in commands:
            with self.subTest(argv=argv), contextlib.redirect_stdout(io.StringIO()):
                if argv == ["--version"]:
                    with self.assertRaises(SystemExit) as exit_result:
                        parser.parse_args(argv)
                    self.assertEqual(exit_result.exception.code, 0)
                else:
                    self.assertTrue(callable(parser.parse_args(argv).handler))

    def test_documented_existing_video_route_never_loads_a_provider(self) -> None:
        parser = build_parser()
        commands = [argv for argv in quickstart_commands(existing_video_only=True) if argv[0] in {"init", "doctor", "plan", "process", "inspect", "validate"}]
        commands = [argv for argv in commands if not getattr(parser.parse_args(argv), "provider_config", None)]
        self.assertEqual([argv[0] for argv in commands], ["init", "doctor", "plan", "process", "inspect", "validate"])
        with tempfile.TemporaryDirectory() as temporary:
            previous = Path.cwd()
            try:
                os.chdir(temporary)
                workspace = Path("my-animation").resolve()

                def fixture_process(**kwargs):
                    self.assertEqual(kwargs["root"], workspace)
                    self.assertEqual(kwargs["raw_video"].read_bytes(), b"raw-video-test-double")
                    self.assertEqual(kwargs["plan"]["delivery"]["atlas_profiles"], ["8x4"])
                    self.assertEqual(kwargs["plan"]["delivery"]["size"], 256)
                    kwargs["out_dir"].mkdir(parents=True)
                    return {"fixture": "process-result"}

                with (
                    contextlib.redirect_stdout(io.StringIO()),
                    patch("ai_frame_animation.cli.load_provider", side_effect=AssertionError("provider must not load")) as provider,
                    patch("ai_frame_animation.cli.resolve_media_tool", return_value="fixture-tool"),
                    patch("ai_frame_animation.cli.process_video", side_effect=fixture_process) as process,
                    patch("ai_frame_animation.cli.validate_delivery", return_value={"status": "passed"}) as validate,
                    patch("ai_frame_animation.cli.inspect_artifact", return_value={"fixture": "inspection"}) as inspect,
                    patch("subprocess.Popen", side_effect=AssertionError("no real subprocess")),
                    patch("urllib.request.urlopen", side_effect=AssertionError("no network")),
                ):
                    self.assertEqual(main(commands[0]), 0)
                    # Synthetic planning fixture only; no video decode or media
                    # delivery is performed by this onboarding test.
                    Image.new("RGB", (8, 8), (200, 40, 40)).save(workspace / "reference.png")
                    raw = workspace / "work" / "raw" / "source.mp4"
                    raw.parent.mkdir(parents=True)
                    raw.write_bytes(b"raw-video-test-double")
                    for argv in commands[1:]:
                        self.assertEqual(main(argv), 0, argv)
                    provider.assert_not_called()
                    process.assert_called_once()
                    self.assertEqual(validate.call_count, 2)
                    inspect.assert_called_once()
                    self.assertFalse((workspace / ".ai-frame-animation" / "attempts").exists())
                    self.assertFalse((workspace / ".ai-frame-animation" / "workflow.json").exists())
            finally:
                os.chdir(previous)


if __name__ == "__main__":
    unittest.main()
