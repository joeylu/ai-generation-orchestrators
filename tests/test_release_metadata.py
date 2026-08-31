from __future__ import annotations

import io
import json
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

from ai_frame_animation import __version__
from scripts.build_release_metadata import (
    SDIST_SUPPORT_FILES, SKILL_FILES, SKILL_NAME, build_metadata, build_skill_archive,
    project_version, project_version_from_text, sha256, validate_source_archive, verify_tag,
)


ROOT = Path(__file__).parents[1]


class ReleaseMetadataTests(unittest.TestCase):
    def test_versions_agree(self) -> None:
        skill = json.loads((ROOT / "skills" / "artwork" / "skills-2d-frame-animation-video" / "skill.json").read_text(encoding="utf-8"))
        self.assertEqual(project_version(), skill["version"])
        self.assertEqual(project_version(), __version__)
        verify_tag(f"v{project_version()}")

    def test_version_parser_is_scoped_to_project_section(self) -> None:
        value = """[build-system]
requires = [\"setuptools>=77\"]

[project]
name = \"example\"
version = \"1.2.3\"

[tool.example]
version = \"9.9.9\"
"""
        self.assertEqual(project_version_from_text(value), "1.2.3")

    def test_release_metadata_has_checksums_and_sbom(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            dist = Path(temporary)
            (dist / "package.whl").write_bytes(b"wheel")
            build_metadata(dist)
            self.assertIn("package.whl", (dist / "SHA256SUMS.txt").read_text(encoding="ascii"))
            sbom = json.loads((dist / "sbom.spdx.json").read_text(encoding="utf-8"))
            self.assertEqual(sbom["spdxVersion"], "SPDX-2.3")

    def test_complete_skill_archive_is_versioned_checksummed_and_self_contained(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            dist = Path(temporary)
            (dist / "package.whl").write_bytes(b"wheel")
            build_metadata(dist)
            archive_path = dist / f"{SKILL_NAME}-{project_version()}.zip"
            self.assertIn(
                f"{sha256(archive_path)}  {archive_path.name}",
                (dist / "SHA256SUMS.txt").read_text(encoding="ascii"),
            )
            with zipfile.ZipFile(archive_path) as archive:
                expected = {f"{SKILL_NAME}/{name}" for name in (*SKILL_FILES, "LICENSE")}
                self.assertEqual(set(archive.namelist()), expected)
                for info in archive.infolist():
                    self.assertEqual(info.date_time, (1980, 1, 1, 0, 0, 0))
                    self.assertEqual(info.external_attr >> 16, 0o100644)
                    self.assertNotIn(b"\r", archive.read(info))
                    if info.filename.endswith(".md"):
                        # Installed references must resolve within the archive,
                        # not back into a source checkout that is no longer there.
                        for target in re.findall(r"\]\(([^)]+)\)", archive.read(info).decode("utf-8")):
                            self.assertNotIn("://", target)
                            member = (Path(info.filename).parent / target).as_posix()
                            self.assertIn(member, expected)
                metadata = json.loads(archive.read(f"{SKILL_NAME}/skill.json"))
                self.assertEqual(metadata["version"], project_version())
                self.assertEqual(metadata["cli"], "ai-frame-animation")

    def _copy_skill_source(self, root: Path) -> Path:
        skill = root / "skills" / "artwork" / SKILL_NAME
        root.mkdir()
        shutil.copyfile(ROOT / "pyproject.toml", root / "pyproject.toml")
        shutil.copyfile(ROOT / "LICENSE", root / "LICENSE")
        for name in SKILL_FILES:
            target = skill / name
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(ROOT / "skills" / "artwork" / SKILL_NAME / name, target)
        return skill

    def test_skill_archive_is_reproducible_and_excludes_unlisted_files(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            parent = Path(temporary)
            source = parent / "source"
            skill = self._copy_skill_source(source)
            (skill / "unlisted-private-config.json").write_text('{"fixture": true}', encoding="utf-8")
            first, second = parent / "first", parent / "second"
            first.mkdir()
            second.mkdir()
            expected = build_skill_archive(first).read_bytes()
            for name in SKILL_FILES:
                file = skill / name
                file.write_bytes(file.read_bytes().replace(b"\r\n", b"\n").replace(b"\n", b"\r\n"))
            with patch("scripts.build_release_metadata.ROOT", source):
                archive = build_skill_archive(second)
                self.assertEqual(archive.read_bytes(), expected)
                self.assertEqual(build_skill_archive(second), archive)

    def test_skill_archive_rejects_version_drift_and_missing_members(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            parent = Path(temporary)
            source = parent / "source"
            skill = self._copy_skill_source(source)
            dist = parent / "dist"
            dist.mkdir()
            metadata_path = skill / "skill.json"
            original = metadata_path.read_bytes()
            metadata = json.loads(original)
            metadata["version"] = "999.0.0"
            metadata_path.write_text(json.dumps(metadata), encoding="utf-8")
            with patch("scripts.build_release_metadata.ROOT", source):
                with self.assertRaisesRegex(ValueError, "skill_archive_metadata_mismatch"):
                    build_skill_archive(dist)
                metadata_path.write_bytes(original)
                (skill / "references" / "video-state-machine.md").unlink()
                with self.assertRaisesRegex(ValueError, "skill_archive_member_missing_or_unsafe"):
                    build_skill_archive(dist)
            self.assertEqual(list(dist.iterdir()), [])

    def test_skill_archive_never_overwrites_different_existing_bytes(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            dist = Path(temporary)
            archive = dist / f"{SKILL_NAME}-{project_version()}.zip"
            archive.write_bytes(b"preserve this existing artifact")
            with self.assertRaisesRegex(ValueError, "skill_archive_refuses_overwrite"):
                build_skill_archive(dist)
            self.assertEqual(archive.read_bytes(), b"preserve this existing artifact")

    def test_skill_archive_rejects_linked_source(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            parent = Path(temporary)
            source = parent / "source"
            skill = self._copy_skill_source(source)
            member = skill / "SKILL.md"
            target = parent / "outside.md"
            target.write_bytes(member.read_bytes())
            member.unlink()
            try:
                member.symlink_to(target)
            except OSError:
                self.skipTest("symlink creation is unavailable")
            with patch("scripts.build_release_metadata.ROOT", source):
                with self.assertRaisesRegex(ValueError, "skill_archive_symlink_forbidden"):
                    build_skill_archive(parent)

    def test_skill_archive_rejects_linked_members_parents_and_output_with_test_doubles(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            dist = Path(temporary)
            links = (
                ROOT / "skills",
                ROOT / "skills" / "artwork" / SKILL_NAME / "SKILL.md",
                dist / f"{SKILL_NAME}-{project_version()}.zip",
            )
            for link in links:
                with self.subTest(link=link), patch.object(Path, "is_symlink", new=lambda candidate: candidate == link):
                    with self.assertRaisesRegex(ValueError, "skill_archive_symlink_forbidden"):
                        build_skill_archive(dist)
            self.assertEqual(list(dist.iterdir()), [])

    def test_release_command_builds_skill_asset_without_touching_wheel(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            dist = Path(temporary)
            wheel = dist / "fixture.whl"
            wheel.write_bytes(b"wheel-test-double")
            result = subprocess.run(
                [sys.executable, "-B", str(ROOT / "scripts" / "build_release_metadata.py"),
                 "--verify-tag", f"v{project_version()}", "--dist", str(dist)],
                cwd=ROOT, capture_output=True, text=True, timeout=30,
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(wheel.read_bytes(), b"wheel-test-double")
            self.assertTrue((dist / f"{SKILL_NAME}-{project_version()}.zip").is_file())
            self.assertTrue((dist / "SHA256SUMS.txt").is_file())

    def _source_archive(self, destination: Path, names: tuple[str, ...]) -> None:
        with tarfile.open(destination, "w:gz") as archive:
            for name in names:
                member = tarfile.TarInfo(name if name.startswith("/") else f"ai_frame_animation-{project_version()}/{name}")
                member.size = len(b"fixture")
                archive.addfile(member, io.BytesIO(b"fixture"))

    def test_actual_sdist_must_contain_docs_skill_and_golden_support_files(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            dist = Path(temporary)
            source = dist / f"ai_frame_animation-{project_version()}.tar.gz"
            # Reproduce setuptools' previous default: tests shipped without
            # their golden data, release script, or documentation dependencies.
            self._source_archive(source, ("README.md", "pyproject.toml", "tests/test_golden_matte.py"))
            with self.assertRaisesRegex(ValueError, "source_distribution_support_files_missing"):
                build_metadata(dist)
            self.assertFalse((dist / "SHA256SUMS.txt").exists())
            self.assertFalse((dist / f"{SKILL_NAME}-{project_version()}.zip").exists())
            self._source_archive(source, SDIST_SUPPORT_FILES)
            build_metadata(dist)
            self.assertIn(source.name, (dist / "SHA256SUMS.txt").read_text(encoding="ascii"))

    def test_all_public_golden_data_are_required_source_archive_members(self) -> None:
        fixtures = {path.relative_to(ROOT).as_posix() for path in (ROOT / "tests/fixtures/golden").glob("*.json")}
        self.assertTrue(fixtures)
        self.assertTrue(fixtures <= set(SDIST_SUPPORT_FILES), fixtures - set(SDIST_SUPPORT_FILES))

    def test_source_archive_rejects_missing_material_or_subject_fit_data(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            source = Path(temporary) / "source.tar.gz"
            for missing in ("tests/fixtures/golden/subject-fit-cases.json", "tests/fixtures/golden/reference-material-cases.json"):
                with self.subTest(missing=missing):
                    self._source_archive(source, tuple(name for name in SDIST_SUPPORT_FILES if name != missing))
                    with self.assertRaisesRegex(ValueError, "source_distribution_support_files_missing"):
                        validate_source_archive(source)

    def test_source_archive_rejects_unsafe_or_duplicate_members(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            source = Path(temporary) / "source.tar.gz"
            for bad_name in ("../escape", "/absolute", "nested\\..\\escape"):
                with self.subTest(member=bad_name):
                    self._source_archive(source, (*SDIST_SUPPORT_FILES, bad_name))
                    with self.assertRaisesRegex(ValueError, "source_distribution_member_unsafe"):
                        validate_source_archive(source)
            self._source_archive(source, (*SDIST_SUPPORT_FILES, "README.md"))
            with self.assertRaisesRegex(ValueError, "source_distribution_member_duplicate"):
                validate_source_archive(source)

    def test_source_archive_rejects_links_even_when_named_like_required_files(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            source = Path(temporary) / "source.tar.gz"
            with tarfile.open(source, "w:gz") as archive:
                member = tarfile.TarInfo(f"ai_frame_animation-{project_version()}/README.md")
                member.type = tarfile.SYMTYPE
                member.linkname = "outside.md"
                archive.addfile(member)
            with self.assertRaisesRegex(ValueError, "source_distribution_member_unsafe"):
                validate_source_archive(source)


if __name__ == "__main__":
    unittest.main()
