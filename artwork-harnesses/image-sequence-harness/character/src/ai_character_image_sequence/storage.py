"""Small, contained, immutable artifact primitives."""
from __future__ import annotations

import hashlib
import json
import os
import re
import stat
import uuid
from contextlib import contextmanager
from pathlib import Path
from typing import Any


class HarnessError(ValueError):
    def __init__(self, code: str):
        self.code = code
        super().__init__(code)


def require(condition: bool, code: str) -> None:
    if not condition:
        raise HarnessError(code)


def canonical(value: Any) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False,
                      allow_nan=False).encode("utf-8")


def digest(value: Any) -> str:
    return hashlib.sha256(canonical(value)).hexdigest()


def sha(path: Path) -> str:
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def read(path: Path, max_bytes: int = 4 * 1024 * 1024) -> dict:
    require(path.stat().st_size <= max_bytes, "json_too_large")
    value = json.loads(path.read_text(encoding="utf-8-sig"))
    require(isinstance(value, dict), "json_object_required")
    return value


def contained(root: Path, value: str | Path) -> Path:
    """Reject traversal and links before resolution, including Windows junctions."""
    root = root.resolve()
    candidate = Path(value)
    require(".." not in candidate.parts, "path_traversal")
    candidate = candidate if candidate.is_absolute() else root / candidate
    try:
        relative = candidate.relative_to(root)
    except ValueError:
        raise HarnessError("path_outside_workspace") from None
    current = root
    for part in relative.parts:
        require(":" not in part, "path_stream_forbidden")
        current /= part
        require(not current.is_symlink(), "path_link_forbidden")
        require(not getattr(current, "is_junction", lambda: False)(), "path_link_forbidden")
        if current.exists():
            attributes = getattr(current.lstat(), "st_file_attributes", 0)
            require(not attributes & getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0x400),
                    "path_link_forbidden")
    require(candidate.resolve().is_relative_to(root), "path_outside_workspace")
    return candidate


def token(value: str, length: int = 64) -> str:
    require(bool(re.fullmatch(r"[a-f0-9]{" + str(length) + "}", value)), "invalid_identifier")
    return value


def save(path: Path, value: dict) -> None:
    """Durably publish a complete evidence record without exposing a partial final file."""
    write_new_bytes(path, canonical(value) + b"\n")


def _sync_directory(path: Path) -> None:
    """Best-effort directory durability; Windows does not expose portable directory fsync."""
    if os.name == "nt":
        return
    fd = os.open(path, os.O_RDONLY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def write_new_bytes(path: Path, data: bytes) -> None:
    """Write, fsync and atomically link a new immutable file into place."""
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.parent / f".{path.name}.{uuid.uuid4().hex}.tmp"
    try:
        with temporary.open("xb") as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        try:
            os.link(temporary, path)
        except FileExistsError:
            raise HarnessError("artifact_already_exists") from None
        _sync_directory(path.parent)
    except FileExistsError:
        raise HarnessError("artifact_already_exists") from None
    finally:
        try:
            temporary.unlink()
        except FileNotFoundError:
            pass


def publish_staged(source: Path, target: Path) -> None:
    """Atomically publish an already-fsynced and validated staged file."""
    target.parent.mkdir(parents=True, exist_ok=True)
    try:
        os.link(source, target)
    except FileExistsError:
        raise HarnessError("artifact_already_exists") from None
    _sync_directory(target.parent)
    source.unlink()


def seal(value: dict) -> dict:
    return {**value, "digest": digest(value)}


def unseal(value: dict) -> dict:
    body = {k: v for k, v in value.items() if k != "digest"}
    require(value.get("digest") == digest(body), "evidence_digest_mismatch")
    return body


@contextmanager
def lock(directory: Path):
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / "operation.lock"
    try:
        fd = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    except FileExistsError:
        raise HarnessError("operation_locked_manual_inspection_required") from None
    try:
        os.write(fd, str(os.getpid()).encode("ascii"))
        os.close(fd)
        yield
    finally:
        path.unlink()


def new_id() -> str:
    return uuid.uuid4().hex
