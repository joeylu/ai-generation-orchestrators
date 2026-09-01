from __future__ import annotations

import re
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


ROOT = Path(__file__).parents[2]
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
    # A verified extracted sdist has package metadata but no Git checkout.
    # Scan its actual contents, not a containing repository's ignored work tree.
    # Do not use a blanket exception fallback: checkout Git failures must surface.
    if not (ROOT / ".git").exists() and (ROOT / "PKG-INFO").is_file():
        return sorted(path for path in ROOT.rglob("*") if path.is_file())
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
    def test_extracted_source_archive_is_scanned_without_git(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "PKG-INFO").write_text("fixture package metadata", encoding="utf-8")
            (root / "README.md").write_text("fixture", encoding="utf-8")
            (root / "handoff").mkdir()
            (root / "handoff/fixture.zip").write_bytes(b"fixture")
            with patch(__name__ + ".ROOT", root), patch(__name__ + ".subprocess.run", side_effect=AssertionError("no Git in sdist")):
                paths = {path.relative_to(root).as_posix() for path in prospective_public_files()}
            self.assertEqual(paths, {"PKG-INFO", "README.md", "handoff/fixture.zip"})

    def test_checkout_git_failure_is_not_silently_treated_as_an_archive(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / ".git").mkdir()
            (root / "PKG-INFO").write_text("fixture", encoding="utf-8")
            with patch(__name__ + ".ROOT", root), patch(__name__ + ".subprocess.run", side_effect=subprocess.CalledProcessError(128, "git")):
                with self.assertRaises(subprocess.CalledProcessError):
                    prospective_public_files()

    def test_forbidden_trees_and_binary_handoffs_are_absent(self) -> None:
        relative = [path.relative_to(ROOT).as_posix() for path in prospective_public_files()]
        for value in relative:
            self.assertFalse(value.startswith(FORBIDDEN_PREFIXES), value)
            self.assertNotIn(Path(value).suffix.lower(), {".zip", ".mp4", ".mov", ".webm"}, value)

    def test_video_skill_is_a_thin_discoverable_entrypoint(self) -> None:
        skill_root = ROOT / "artwork-harnesses" / "video-sequence-harness" / "character"
        expected = {
            "LICENSE",
            "MANIFEST.in",
            "README.md",
            "SKILL.md",
            "agents/openai.yaml",
            "pyproject.toml",
            "references/reference-preparation-handoff.md",
            "references/video-runtime-adapter-protocol.md",
            "references/video-state-machine.md",
            "skill.json",
        }
        entrypoint_files = {
            path.relative_to(skill_root).as_posix()
            for path in prospective_public_files()
            if path.is_relative_to(skill_root)
            and path.relative_to(skill_root).parts[0] not in {"src", "docs", "examples", "tests"}
        }
        self.assertEqual(entrypoint_files, expected)
        package = skill_root / "src" / "ai_frame_animation"
        self.assertTrue((package / "cli.py").is_file())
        self.assertFalse((package / "preparation.py").exists())
        self.assertTrue((package / "reference_preparation.py").is_file())
        self.assertTrue((package / "processing.py").is_file())
        pyproject = (skill_root / "pyproject.toml").read_text(encoding="utf-8")
        self.assertIn('where = ["src"]', pyproject)
        self.assertIn("artwork-harnesses/video-sequence-harness/character", (ROOT / "README.md").read_text(encoding="utf-8"))
        self.assertIn("Character animation", (ROOT / "artwork-harnesses" / "video-sequence-harness" / "README.md").read_text(encoding="utf-8"))

    def test_background_and_video_packages_are_physically_independent(self) -> None:
        background = ROOT / "artwork-harnesses" / "image-background-removal-harness"
        video = ROOT / "artwork-harnesses" / "video-sequence-harness" / "character"
        self.assertTrue((background / "src/ai_image_background_removal/preparation.py").is_file())
        self.assertTrue((video / "src/ai_frame_animation/reference_preparation.py").is_file())
        self.assertFalse((ROOT / "pyproject.toml").exists())
        self.assertFalse((ROOT / "MANIFEST.in").exists())
        background_text = "\n".join(path.read_text(encoding="utf-8") for path in (background / "src").rglob("*.py"))
        video_text = "\n".join(path.read_text(encoding="utf-8") for path in (video / "src").rglob("*.py"))
        self.assertNotRegex(background_text, r"(?m)^\s*(?:from|import)\s+ai_frame_animation\b")
        self.assertNotRegex(video_text, r"(?m)^\s*(?:from|import)\s+ai_image_background_removal\b")
        self.assertIn('name = "ai-image-background-removal"', (background / "pyproject.toml").read_text(encoding="utf-8"))
        self.assertIn('name = "ai-frame-animation"', (video / "pyproject.toml").read_text(encoding="utf-8"))

    def test_harness_catalog_separates_implemented_and_planned_entries(self) -> None:
        background = ROOT / "artwork-harnesses" / "image-background-removal-harness"
        self.assertTrue((background / "SKILL.md").is_file())
        self.assertTrue((background / "skill.json").is_file())
        planned = (
            ROOT / "artwork-harnesses" / "image-generation-harness",
            ROOT / "artwork-harnesses" / "image-sequence-harness",
            ROOT / "artwork-harnesses" / "video-sequence-harness" / "prop",
            ROOT / "audio-harnesses",
            ROOT / "game-scene-harnesses",
        )
        for directory in planned:
            self.assertIn("planned", (directory / "README.md").read_text(encoding="utf-8").lower())
            self.assertFalse(any(directory.rglob("SKILL.md")), directory)
        ui = ROOT / "game-ui-harnesses" / "ui-decomposition-harness" / "README.md"
        self.assertIn("in development", ui.read_text(encoding="utf-8").lower())

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
