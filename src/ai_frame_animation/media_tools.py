from __future__ import annotations

import json
import os
import platform
import shutil
import stat
import subprocess
import tempfile
import urllib.parse
import urllib.request
import zipfile
from datetime import datetime, timezone
from importlib import resources
from pathlib import Path, PurePosixPath
from typing import Any, Mapping

from .canonical import sha256_file


TOOL_DIRECTORY = Path(".ai-frame-animation/tools/ffmpeg")
LOCK_SCHEMA = "ffmpeg_tool_lock_v1"
INSTALL_SCHEMA = "project_local_tool_install_v1"


def current_platform_key() -> str:
    system = platform.system().lower()
    machine = platform.machine().lower()
    architectures = {
        "amd64": "x86_64",
        "x86_64": "x86_64",
        "arm64": "arm64",
        "aarch64": "arm64",
    }
    architecture = architectures.get(machine, machine or "unknown")
    return f"{system}-{architecture}"


def load_ffmpeg_lock() -> dict[str, Any]:
    resource = resources.files("ai_frame_animation").joinpath("tooling/ffmpeg-lock.json")
    value = json.loads(resource.read_text(encoding="utf-8"))
    validate_ffmpeg_lock(value)
    return value


def validate_ffmpeg_lock(value: Mapping[str, Any]) -> None:
    if value.get("schema_version") != LOCK_SCHEMA:
        raise ValueError("ffmpeg_tool_lock_schema_invalid")
    platforms = value.get("platforms")
    if not isinstance(platforms, Mapping) or not platforms:
        raise ValueError("ffmpeg_tool_lock_platforms_invalid")
    for key, candidate in platforms.items():
        if not isinstance(key, str) or not isinstance(candidate, Mapping):
            raise ValueError("ffmpeg_tool_lock_entry_invalid")
        required_strings = (
            "version",
            "distribution",
            "source_page",
            "release_tag",
            "retention",
            "download_url",
            "asset_name",
            "sha256",
            "archive_root",
            "license",
        )
        if any(not isinstance(candidate.get(field), str) or not candidate[field] for field in required_strings):
            raise ValueError("ffmpeg_tool_lock_entry_invalid")
        if len(str(candidate["sha256"])) != 64 or any(character not in "0123456789abcdef" for character in str(candidate["sha256"])):
            raise ValueError("ffmpeg_tool_lock_digest_invalid")
        parsed = urllib.parse.urlparse(str(candidate["download_url"]))
        if parsed.scheme != "https" or parsed.hostname not in {"api.github.com", "github.com"}:
            raise ValueError("ffmpeg_tool_lock_url_invalid")
        for field in ("asset_bytes", "archive_entries", "expanded_bytes"):
            if not isinstance(candidate.get(field), int) or int(candidate[field]) <= 0:
                raise ValueError("ffmpeg_tool_lock_entry_invalid")
        required_files = candidate.get("required_files")
        if not isinstance(required_files, Mapping) or set(required_files) != {"ffmpeg", "ffprobe", "license"}:
            raise ValueError("ffmpeg_tool_lock_required_files_invalid")


def load_ffmpeg_entry(platform_key: str | None = None) -> tuple[str, dict[str, Any]]:
    value = load_ffmpeg_lock()
    selected = platform_key or current_platform_key()
    entry = value["platforms"].get(selected)
    if not isinstance(entry, Mapping):
        raise ValueError("ffmpeg_tool_platform_unsupported")
    return selected, dict(entry)


def _relative_tool_path(root: Path, relative: str) -> Path:
    candidate = PurePosixPath(relative)
    if candidate.is_absolute() or not candidate.parts or ".." in candidate.parts:
        raise ValueError("ffmpeg_tool_relative_path_invalid")
    target = (root / Path(*candidate.parts)).resolve(strict=False)
    if not target.is_relative_to(root.resolve(strict=False)):
        raise ValueError("ffmpeg_tool_relative_path_invalid")
    return target


def _private_directory_is_ignored(root: Path) -> bool:
    ignore_file = root / ".gitignore"
    if not ignore_file.is_file():
        return False
    rules = {
        line.strip().replace("\\", "/")
        for line in ignore_file.read_text(encoding="utf-8-sig").splitlines()
        if line.strip() and not line.lstrip().startswith("#")
    }
    return bool(rules & {".ai-frame-animation", ".ai-frame-animation/", "/.ai-frame-animation", "/.ai-frame-animation/"})


def _validate_install_destination(root: Path) -> None:
    resolved_root = root.resolve(strict=True)
    candidates = (
        resolved_root / ".ai-frame-animation",
        resolved_root / ".ai-frame-animation" / "tools",
        resolved_root / TOOL_DIRECTORY,
    )
    for candidate in candidates:
        if candidate.is_symlink():
            raise ValueError("ffmpeg_tool_install_path_symlink_rejected")
        if not candidate.resolve(strict=False).is_relative_to(resolved_root):
            raise ValueError("ffmpeg_tool_install_path_escapes_root")
    if not _private_directory_is_ignored(resolved_root):
        raise ValueError("ffmpeg_tool_private_directory_not_ignored")


def project_tool_paths(root: Path) -> dict[str, Path]:
    executable_suffix = ".exe" if os.name == "nt" else ""
    target = root.resolve(strict=True) / TOOL_DIRECTORY
    return {
        "root": target,
        "ffmpeg": target / "bin" / f"ffmpeg{executable_suffix}",
        "ffprobe": target / "bin" / f"ffprobe{executable_suffix}",
        "record": target / "INSTALL.json",
    }


def resolve_media_tool(root: Path, requested: str | None, name: str) -> str | None:
    resolved_root = root.resolve(strict=True)
    if requested:
        requested_path = Path(requested)
        if requested_path.is_absolute() or requested_path.parent != Path("."):
            candidate = requested_path if requested_path.is_absolute() else resolved_root / requested_path
            if candidate.is_file():
                return str(candidate.resolve())
        return shutil.which(requested)

    project_local = project_tool_paths(resolved_root)[name]
    if project_local.is_file() and not project_local.is_symlink() and (os.name == "nt" or os.access(project_local, os.X_OK)):
        return str(project_local.resolve())
    return shutil.which(name)


def _version_line(executable: Path | str) -> str | None:
    try:
        completed = subprocess.run(
            [str(executable), "-version"],
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=15,
            check=False,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    if completed.returncode != 0:
        return None
    return next((line.strip() for line in completed.stdout.splitlines() if line.strip()), None)


def _record_integrity(paths: Mapping[str, Path], entry: Mapping[str, Any] | None) -> tuple[str, list[str]]:
    record_path = paths["record"]
    if not record_path.is_file():
        return "unrecorded", ["Project-local FFmpeg has no INSTALL.json provenance record."]
    try:
        record = json.loads(record_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return "invalid", ["Project-local FFmpeg INSTALL.json is invalid."]
    if record.get("schema_version") != INSTALL_SCHEMA:
        return "invalid", ["Project-local FFmpeg INSTALL.json uses an unsupported schema."]
    if entry is not None and record.get("asset_sha256") != entry.get("sha256"):
        return "lock_mismatch", ["Project-local FFmpeg does not match the packaged tool lock."]
    files = record.get("files")
    if isinstance(files, Mapping):
        for relative, expected in files.items():
            if not isinstance(relative, str) or not isinstance(expected, Mapping):
                return "invalid", ["Project-local FFmpeg file records are invalid."]
            candidate = _relative_tool_path(paths["root"], relative)
            if not candidate.is_file() or candidate.is_symlink():
                return "file_mismatch", ["A recorded project-local FFmpeg file is missing."]
            if expected.get("bytes") != candidate.stat().st_size or expected.get("sha256") != sha256_file(candidate):
                return "file_mismatch", ["A recorded project-local FFmpeg file failed its integrity check."]
    return "verified", []


def check_ffmpeg_tools(root: Path) -> dict[str, Any]:
    resolved_root = root.resolve(strict=True)
    paths = project_tool_paths(resolved_root)
    resolved: dict[str, str | None] = {
        name: resolve_media_tool(resolved_root, None, name) for name in ("ffmpeg", "ffprobe")
    }
    executables: dict[str, dict[str, str]] = {}
    actions: list[str] = []
    project_local = True
    version_lines: dict[str, str | None] = {}
    for name in ("ffmpeg", "ffprobe"):
        selected = resolved[name]
        version = _version_line(selected) if selected else None
        version_lines[name] = version
        local_path = paths[name]
        is_local = bool(selected) and Path(str(selected)).resolve(strict=False) == local_path.resolve(strict=False)
        project_local = project_local and is_local
        executables[name] = {
            "status": "ready" if version else ("broken" if selected else "missing"),
            "source": "project_local" if is_local else ("path" if selected else "none"),
            "version": version or "not_available",
        }

    entry: Mapping[str, Any] | None = None
    expected_version: str | None = None
    if project_local:
        try:
            _platform, entry = load_ffmpeg_entry()
            expected_version = str(entry["version"])
        except ValueError as exc:
            if str(exc) != "ffmpeg_tool_platform_unsupported":
                raise
        integrity, integrity_actions = _record_integrity(paths, entry)
        actions.extend(integrity_actions)
        if expected_version and any(expected_version not in str(version_lines[name]) for name in ("ffmpeg", "ffprobe")):
            integrity = "version_mismatch"
            actions.append("Project-local FFmpeg executables do not match the packaged tool lock version.")
    else:
        integrity = "external" if all(resolved.values()) else "not_available"

    executable_ready = all(value["status"] == "ready" for value in executables.values())
    integrity_ready = integrity in {"verified", "external"}
    ready = executable_ready and integrity_ready
    if not executable_ready:
        actions.append(
            "Run `ai-frame-animation tools install --root <root>` on supported platforms, "
            "install FFmpeg on PATH, or pass explicit executable paths."
        )
    return {
        "schema_version": "ai_frame_animation_tool_check_v1",
        "status": "ready" if ready else "action_required",
        "executables": executables,
        "integrity": integrity,
        "actions": actions,
        "network_probe": "not_performed",
        "media_generated": False,
        "provider_compute": "not_performed",
        "gpu_compute": "not_performed",
    }


def _download_locked_asset(entry: Mapping[str, Any], destination: Path) -> None:
    headers = entry.get("headers")
    request_headers = {"User-Agent": "ai-frame-animation-tool-installer"}
    if isinstance(headers, Mapping):
        request_headers.update({str(key): str(value) for key, value in headers.items()})
    request = urllib.request.Request(
        str(entry["download_url"]),
        headers=request_headers,
        method="GET",
    )
    with urllib.request.urlopen(request, timeout=30) as response, destination.open("xb") as output:
        final_url = urllib.parse.urlparse(response.geturl())
        final_host = final_url.hostname or ""
        if final_url.scheme != "https" or not (
            final_host == "github.com"
            or final_host == "api.github.com"
            or final_host.endswith(".githubusercontent.com")
        ):
            raise ValueError("ffmpeg_tool_download_redirect_invalid")
        received = 0
        while True:
            chunk = response.read(1024 * 1024)
            if not chunk:
                break
            received += len(chunk)
            if received > int(entry["asset_bytes"]):
                raise ValueError("ffmpeg_tool_asset_size_mismatch")
            output.write(chunk)


def _validate_download(entry: Mapping[str, Any], archive: Path) -> None:
    if archive.stat().st_size != entry["asset_bytes"]:
        raise ValueError("ffmpeg_tool_asset_size_mismatch")
    if sha256_file(archive) != entry["sha256"]:
        raise ValueError("ffmpeg_tool_asset_sha256_mismatch")


def _extract_locked_archive(entry: Mapping[str, Any], archive: Path, destination: Path) -> Path:
    with zipfile.ZipFile(archive) as bundle:
        entries = bundle.infolist()
        if len(entries) != entry["archive_entries"]:
            raise ValueError("ffmpeg_tool_archive_entry_count_mismatch")
        expanded_bytes = 0
        for info in entries:
            if "\\" in info.filename:
                raise ValueError("ffmpeg_tool_archive_entry_unsafe")
            relative = PurePosixPath(info.filename)
            if relative.is_absolute() or not relative.parts or ".." in relative.parts or ":" in relative.parts[0]:
                raise ValueError("ffmpeg_tool_archive_entry_unsafe")
            target = (destination / Path(*relative.parts)).resolve(strict=False)
            if not target.is_relative_to(destination.resolve(strict=False)):
                raise ValueError("ffmpeg_tool_archive_entry_unsafe")
            unix_mode = info.external_attr >> 16
            if stat.S_IFMT(unix_mode) == stat.S_IFLNK:
                raise ValueError("ffmpeg_tool_archive_symlink_rejected")
            expanded_bytes += info.file_size
        if expanded_bytes != entry["expanded_bytes"]:
            raise ValueError("ffmpeg_tool_archive_expanded_size_mismatch")
        bundle.extractall(destination)
    source = destination / str(entry["archive_root"])
    if not source.is_dir():
        raise ValueError("ffmpeg_tool_archive_root_missing")
    return source


def _write_install_record(source: Path, platform_key: str, entry: Mapping[str, Any]) -> dict[str, Any]:
    required = entry["required_files"]
    ffmpeg = _relative_tool_path(source, str(required["ffmpeg"]))
    ffprobe = _relative_tool_path(source, str(required["ffprobe"]))
    license_file = _relative_tool_path(source, str(required["license"]))
    if (
        not ffmpeg.is_file()
        or ffmpeg.is_symlink()
        or not ffprobe.is_file()
        or ffprobe.is_symlink()
        or not license_file.is_file()
        or license_file.is_symlink()
    ):
        raise ValueError("ffmpeg_tool_required_file_missing")
    versions = {"ffmpeg": _version_line(ffmpeg), "ffprobe": _version_line(ffprobe)}
    if any(not value or str(entry["version"]) not in value for value in versions.values()):
        raise ValueError("ffmpeg_tool_version_mismatch")
    recorded_files: dict[str, dict[str, Any]] = {}
    for relative in (str(required["ffmpeg"]), str(required["ffprobe"]), str(required["license"])):
        candidate = _relative_tool_path(source, relative)
        recorded_files[relative] = {"bytes": candidate.stat().st_size, "sha256": sha256_file(candidate)}
    record = {
        "schema_version": INSTALL_SCHEMA,
        "installed_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        "platform": platform_key,
        "distribution": entry["distribution"],
        "distribution_page": entry["source_page"],
        "github_asset_id": entry.get("github_asset_id"),
        "asset_name": entry["asset_name"],
        "asset_bytes": entry["asset_bytes"],
        "asset_sha256": entry["sha256"],
        "ffmpeg_version": entry["version"],
        "license": entry["license"],
        "files": recorded_files,
        "system_path_modified": False,
        "git_ignored": True,
    }
    (source / "INSTALL.json").write_text(json.dumps(record, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return record


def install_ffmpeg(root: Path) -> dict[str, Any]:
    resolved_root = root.resolve(strict=True)
    _validate_install_destination(resolved_root)
    platform_key, entry = load_ffmpeg_entry()
    paths = project_tool_paths(resolved_root)
    target = paths["root"]
    if target.exists():
        report = check_ffmpeg_tools(resolved_root)
        if report["status"] == "ready" and all(
            report["executables"][name]["source"] == "project_local" for name in ("ffmpeg", "ffprobe")
        ):
            return {
                "schema_version": "ai_frame_animation_tool_install_v1",
                "status": "already_installed",
                "platform": platform_key,
                "version": entry["version"],
                "destination": TOOL_DIRECTORY.as_posix(),
                "asset_sha256": entry["sha256"],
                "license": entry["license"],
                "network_probe": "not_performed",
                "system_path_modified": False,
            }
        raise ValueError("ffmpeg_tool_install_target_exists")

    private_root = resolved_root / ".ai-frame-animation"
    private_root.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="ffmpeg-install-", dir=private_root) as temporary:
        staging = Path(temporary)
        archive = staging / str(entry["asset_name"])
        _download_locked_asset(entry, archive)
        _validate_download(entry, archive)
        source = _extract_locked_archive(entry, archive, staging / "extracted")
        _write_install_record(source, platform_key, entry)
        target.parent.mkdir(parents=True, exist_ok=True)
        source.rename(target)

    return {
        "schema_version": "ai_frame_animation_tool_install_v1",
        "status": "installed",
        "platform": platform_key,
        "version": entry["version"],
        "destination": TOOL_DIRECTORY.as_posix(),
        "distribution": entry["distribution"],
        "source_page": entry["source_page"],
        "asset_sha256": entry["sha256"],
        "license": entry["license"],
        "network_probe": "performed",
        "media_generated": False,
        "provider_compute": "not_performed",
        "gpu_compute": "not_performed",
        "system_path_modified": False,
    }
