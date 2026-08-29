from __future__ import annotations

import hashlib
import json
import os
import shutil
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

from ai_frame_animation.media_tools import check_ffmpeg_tools, install_ffmpeg, load_ffmpeg_lock


def _fixture_archive(directory: Path, *, unsafe: bool = False) -> tuple[Path, dict[str, object]]:
    suffix = ".exe" if os.name == "nt" else ""
    archive_root = "fixture-ffmpeg"
    files = {
        f"{archive_root}/bin/ffmpeg{suffix}": b"fixture ffmpeg",
        f"{archive_root}/bin/ffprobe{suffix}": b"fixture ffprobe",
        f"{archive_root}/LICENSE.txt": b"fixture license",
    }
    if unsafe:
        files["../escape.txt"] = b"escape"
    archive = directory / "fixture.zip"
    with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED) as bundle:
        for name, content in files.items():
            bundle.writestr(name, content)
    digest = hashlib.sha256(archive.read_bytes()).hexdigest()
    entry: dict[str, object] = {
        "version": "fixture-1",
        "distribution": "fixture",
        "source_page": "https://github.com/example/fixture/releases",
        "download_url": "https://api.github.com/repos/example/fixture/releases/assets/1",
        "asset_name": archive.name,
        "asset_bytes": archive.stat().st_size,
        "sha256": digest,
        "archive_entries": len(files),
        "expanded_bytes": sum(len(content) for content in files.values()),
        "archive_root": archive_root,
        "required_files": {
            "ffmpeg": f"bin/ffmpeg{suffix}",
            "ffprobe": f"bin/ffprobe{suffix}",
            "license": "LICENSE.txt",
        },
        "license": "fixture-license",
    }
    return archive, entry


class MediaToolTests(unittest.TestCase):
    def test_packaged_lock_is_pinned_and_https(self) -> None:
        lock = load_ffmpeg_lock()
        windows = lock["platforms"]["windows-x86_64"]
        self.assertEqual(windows["asset_bytes"], 79691570)
        self.assertEqual(len(windows["sha256"]), 64)
        self.assertTrue(windows["download_url"].startswith("https://api.github.com/"))
        self.assertEqual(windows["required_files"]["ffprobe"], "bin/ffprobe.exe")
        self.assertEqual(windows["release_tag"], "autobuild-2026-07-31-14-10")
        self.assertEqual(windows["retention"], "month_end_two_year")

    def test_installer_uses_verified_fixture_without_network(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            base = Path(temporary)
            root = base / "workspace"
            root.mkdir()
            (root / ".gitignore").write_text("/.ai-frame-animation/\n", encoding="utf-8")
            archive, entry = _fixture_archive(base)

            def fixture_download(_entry, destination):
                shutil.copyfile(archive, destination)

            with patch("ai_frame_animation.media_tools.load_ffmpeg_entry", return_value=("fixture-platform", entry)):
                with patch("ai_frame_animation.media_tools._download_locked_asset", side_effect=fixture_download):
                    with patch("ai_frame_animation.media_tools._version_line", return_value="ffmpeg version fixture-1"):
                        report = install_ffmpeg(root)
                        checked = check_ffmpeg_tools(root)

            self.assertEqual(report["status"], "installed")
            self.assertEqual(report["network_probe"], "performed")
            self.assertEqual(checked["status"], "ready")
            self.assertEqual(checked["integrity"], "verified")
            record = json.loads(
                (root / ".ai-frame-animation" / "tools" / "ffmpeg" / "INSTALL.json").read_text(encoding="utf-8")
            )
            self.assertEqual(record["asset_sha256"], entry["sha256"])
            self.assertEqual(set(record["files"]), set(entry["required_files"].values()))

    def test_installer_rejects_digest_mismatch_before_extraction(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            base = Path(temporary)
            root = base / "workspace"
            root.mkdir()
            (root / ".gitignore").write_text("/.ai-frame-animation/\n", encoding="utf-8")
            archive, entry = _fixture_archive(base)
            entry["sha256"] = "0" * 64

            def fixture_download(_entry, destination):
                shutil.copyfile(archive, destination)

            with patch("ai_frame_animation.media_tools.load_ffmpeg_entry", return_value=("fixture-platform", entry)):
                with patch("ai_frame_animation.media_tools._download_locked_asset", side_effect=fixture_download):
                    with self.assertRaisesRegex(ValueError, "ffmpeg_tool_asset_sha256_mismatch"):
                        install_ffmpeg(root)
            self.assertFalse((root / ".ai-frame-animation" / "tools" / "ffmpeg").exists())

    def test_installer_rejects_archive_traversal(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            base = Path(temporary)
            root = base / "workspace"
            root.mkdir()
            (root / ".gitignore").write_text("/.ai-frame-animation/\n", encoding="utf-8")
            archive, entry = _fixture_archive(base, unsafe=True)

            def fixture_download(_entry, destination):
                shutil.copyfile(archive, destination)

            with patch("ai_frame_animation.media_tools.load_ffmpeg_entry", return_value=("fixture-platform", entry)):
                with patch("ai_frame_animation.media_tools._download_locked_asset", side_effect=fixture_download):
                    with self.assertRaisesRegex(ValueError, "ffmpeg_tool_archive_entry_unsafe"):
                        install_ffmpeg(root)
            self.assertFalse((base / "escape.txt").exists())

    def test_installer_requires_private_tool_directory_ignore(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            with self.assertRaisesRegex(ValueError, "ffmpeg_tool_private_directory_not_ignored"):
                install_ffmpeg(root)


if __name__ == "__main__":
    unittest.main()
