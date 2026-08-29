from __future__ import annotations

import hashlib
import json
import os
import re
from pathlib import Path
from typing import Any, Mapping
from urllib.parse import urlsplit, urlunsplit


SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
SECRET_KEYS = {"api_key", "authorization", "credential", "password", "secret", "token"}
PATH_KEYS = {"model_path", "workflow_path", "host_path"}
SAFE_ERROR_CODE_RE = re.compile(r"^[A-Za-z][A-Za-z0-9_.:-]{0,159}$")


def canonical_json_bytes(value: object) -> bytes:
    return json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
    ).encode("utf-8")


def canonical_sha256(value: object) -> str:
    return hashlib.sha256(canonical_json_bytes(value)).hexdigest()


def stamp_document(document: Mapping[str, Any], digest_field: str) -> dict[str, Any]:
    stamped = dict(document)
    stamped.pop(digest_field, None)
    stamped[digest_field] = canonical_sha256(stamped)
    return stamped


def verify_document(document: Mapping[str, Any], digest_field: str) -> str:
    expected = document.get(digest_field)
    if not isinstance(expected, str) or not SHA256_RE.fullmatch(expected):
        raise ValueError(f"{digest_field}_missing_or_invalid")
    actual = canonical_sha256({key: value for key, value in document.items() if key != digest_field})
    if actual != expected:
        raise ValueError(f"{digest_field}_mismatch")
    return actual


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def safe_error_code(error: BaseException) -> str:
    """Return a stable code without copying paths, URLs, or secrets into logs."""

    message = str(error)
    return message if SAFE_ERROR_CODE_RE.fullmatch(message) else type(error).__name__


def fingerprint(path: Path, *, media_type: str | None = None) -> dict[str, Any]:
    if path.is_symlink() or not path.is_file():
        raise ValueError("artifact_not_regular_file")
    result: dict[str, Any] = {
        "bytes": path.stat().st_size,
        "sha256": sha256_file(path),
    }
    if media_type:
        result["media_type"] = media_type
    return result


def load_json(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError("json_root_must_be_object")
    return value


def write_json_atomic(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.replace(path)


def rooted_path(root: Path, value: str | Path, *, must_exist: bool = False) -> Path:
    resolved_root = root.resolve(strict=True)
    candidate = Path(value)
    resolved = candidate.resolve(strict=must_exist) if candidate.is_absolute() else (resolved_root / candidate).resolve(strict=must_exist)
    try:
        resolved.relative_to(resolved_root)
    except ValueError as exc:
        raise ValueError("path_escapes_root") from exc
    return resolved


def relative_posix(root: Path, path: Path) -> str:
    return path.resolve(strict=False).relative_to(root.resolve(strict=True)).as_posix()


def _redact_string(value: str) -> str:
    parsed = urlsplit(value)
    if parsed.scheme and parsed.netloc:
        host = "localhost" if parsed.hostname in {"127.0.0.1", "localhost", "::1"} else "<redacted-host>"
        port = f":{parsed.port}" if parsed.port and host == "localhost" else ""
        return urlunsplit((parsed.scheme, host + port, parsed.path, "", ""))
    if Path(value).is_absolute():
        return "<redacted-path>"
    return value


def redact(value: object, *, key: str = "") -> object:
    lowered = key.lower()
    if (
        lowered in SECRET_KEYS
        or lowered in PATH_KEYS
        or lowered.endswith(("_token", "_secret", "_password", "_credential"))
        or "api_key" in lowered
    ):
        return "<redacted>"
    if isinstance(value, str):
        return _redact_string(value)
    if isinstance(value, list):
        return [redact(item) for item in value]
    if isinstance(value, dict):
        return {str(item_key): redact(item, key=str(item_key)) for item_key, item in value.items()}
    return value
