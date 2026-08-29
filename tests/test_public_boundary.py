from __future__ import annotations

import re
import subprocess
import unittest
from pathlib import Path


ROOT = Path(__file__).parents[1]
FORBIDDEN_PREFIXES = (
    ".opencode/",
    "artwork/",
    "handoff/",
    "skills/providers/",
    "skills/artwork/skills-2d-frame-animation/",
)
FORBIDDEN_MARKERS = (
    "Halabang" + "-Docker-Boilerplate",
    "internal_" + "web_beta",
    "owner_" + "wake",
    "C:" + "\\Users\\",
    "E:" + "\\Halagame",
)
TEXT_SUFFIXES = {".md", ".py", ".json", ".toml", ".yaml", ".yml", ".txt"}


def prospective_public_files() -> list[Path]:
    result = subprocess.run(
        [
            "git",
            "-c",
            f"safe.directory={ROOT.as_posix()}",
            "ls-files",
            "--cached",
            "--others",
            "--exclude-standard",
        ],
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
    )
    return sorted(ROOT / value for value in result.stdout.splitlines() if (ROOT / value).is_file())


class PublicBoundaryTests(unittest.TestCase):
    def test_forbidden_trees_and_binary_handoffs_are_absent(self) -> None:
        relative = [path.relative_to(ROOT).as_posix() for path in prospective_public_files()]
        for value in relative:
            self.assertFalse(value.startswith(FORBIDDEN_PREFIXES), value)
            self.assertNotIn(Path(value).suffix.lower(), {".zip", ".mp4", ".mov", ".webm"}, value)

    def test_video_skill_is_a_thin_discoverable_entrypoint(self) -> None:
        skill_root = ROOT / "skills" / "artwork" / "skills-2d-frame-animation-video"
        expected = {
            "SKILL.md",
            "agents/openai.yaml",
            "references/video-runtime-adapter-protocol.md",
            "references/video-state-machine.md",
            "skill.json",
        }
        actual = {
            path.relative_to(skill_root).as_posix()
            for path in prospective_public_files()
            if path.is_relative_to(skill_root)
        }
        self.assertEqual(actual, expected)
        self.assertIn("skills-2d-frame-animation-video", (ROOT / "README.md").read_text(encoding="utf-8"))
        self.assertIn("skills-2d-frame-animation-video", (ROOT / "skills" / "README.md").read_text(encoding="utf-8"))

    def test_private_markers_are_absent_from_public_text(self) -> None:
        findings = []
        for path in prospective_public_files():
            if path.suffix.lower() not in TEXT_SUFFIXES:
                continue
            text = path.read_text(encoding="utf-8", errors="replace")
            for marker in FORBIDDEN_MARKERS:
                if marker.lower() in text.lower():
                    findings.append(f"{path.relative_to(ROOT)}:{marker}")
            if re.search(r"(?i)authorization:\s*bearer\s+[A-Za-z0-9._-]{12,}", text):
                findings.append(f"{path.relative_to(ROOT)}:bearer-token")
            if re.search(r"\bsk-[A-Za-z0-9_-]{20,}\b", text):
                findings.append(f"{path.relative_to(ROOT)}:api-token")
        self.assertEqual(findings, [])


if __name__ == "__main__":
    unittest.main()
