"""Validate external transparent-reference handoffs without importing their producer."""

from __future__ import annotations

from collections import deque
from pathlib import Path, PurePosixPath, PureWindowsPath
from typing import Any, Mapping

import numpy as np
from PIL import Image

from .canonical import SHA256_RE, fingerprint, load_json, rooted_path, verify_document


HANDOFF_SCHEMA = "ai_reference_preparation_handoff_v1"
LEGACY_SCHEMAS = {f"ai_frame_animation_reference_preparation_v{version}" for version in range(1, 8)}


def _path(root: Path, raw: object) -> Path:
    if isinstance(raw, Path):
        raw = raw.as_posix()
    if (
        not isinstance(raw, str)
        or not raw
        or "\\" in raw
        or PureWindowsPath(raw).drive
        or PurePosixPath(raw).is_absolute()
        or ".." in PurePosixPath(raw).parts
    ):
        raise ValueError("reference_preparation_path_unsafe")
    path = rooted_path(root, raw, must_exist=True)
    if path.is_symlink() or not path.is_file():
        raise ValueError("reference_preparation_path_unsafe")
    return path


def _artifact(root: Path, value: object) -> tuple[dict[str, Any], Path]:
    if not isinstance(value, Mapping) or set(value) != {"path", "bytes", "sha256", "media_type"}:
        raise ValueError("reference_preparation_artifact_invalid")
    if type(value.get("bytes")) is not int or value["bytes"] < 0 or not isinstance(value.get("sha256"), str) or not SHA256_RE.fullmatch(value["sha256"]):
        raise ValueError("reference_preparation_artifact_invalid")
    media_type = value.get("media_type")
    if not isinstance(media_type, str) or not media_type:
        raise ValueError("reference_preparation_artifact_invalid")
    path = _path(root, value.get("path"))
    actual = fingerprint(path, media_type=media_type)
    expected = {key: value[key] for key in ("bytes", "sha256", "media_type")}
    if actual != expected:
        raise ValueError("reference_preparation_artifact_changed")
    return dict(value), path


def _has_exterior_transparency(path: Path) -> bool:
    with Image.open(path) as source:
        if source.format != "PNG" or source.mode != "RGBA" or getattr(source, "n_frames", 1) != 1:
            return False
        alpha = np.asarray(source.getchannel("A"))
    clear = alpha <= 8
    if not np.any(alpha > 8) or np.count_nonzero(clear) < max(1, int(np.ceil(alpha.size * 0.01))):
        return False
    reached = np.zeros(clear.shape, dtype=bool)
    reached[0], reached[-1] = clear[0], clear[-1]
    reached[:, 0], reached[:, -1] = clear[:, 0], clear[:, -1]
    pending = deque(zip(*np.nonzero(reached)))
    while pending:
        y, x = pending.popleft()
        for ny, nx in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):
            if 0 <= ny < clear.shape[0] and 0 <= nx < clear.shape[1] and clear[ny, nx] and not reached[ny, nx]:
                reached[ny, nx] = True
                pending.append((ny, nx))
    return int(np.count_nonzero(reached)) >= max(1, int(np.ceil(alpha.size * 0.01)))


def _load_handoff(root: Path, path: Path, value: Mapping[str, Any]) -> dict[str, Any]:
    verify_document(value, "handoff_sha256")
    if set(value) != {
        "schema_version", "producer", "source", "foreground", "preparation_report",
        "producer_result_sha256", "visual_review_required", "handoff_sha256",
    } or value.get("schema_version") != HANDOFF_SCHEMA or value.get("visual_review_required") is not True:
        raise ValueError("reference_preparation_handoff_invalid")
    producer = value.get("producer")
    if not isinstance(producer, Mapping) or set(producer) != {"name", "version"} or not all(isinstance(producer.get(key), str) and producer[key] for key in ("name", "version")):
        raise ValueError("reference_preparation_producer_invalid")
    result_sha256 = value.get("producer_result_sha256")
    if not isinstance(result_sha256, str) or not SHA256_RE.fullmatch(result_sha256):
        raise ValueError("reference_preparation_producer_result_invalid")
    source, _source_path = _artifact(root, value.get("source"))
    foreground, foreground_path = _artifact(root, value.get("foreground"))
    report, _report_path = _artifact(root, value.get("preparation_report"))
    if source["media_type"] != "image" or foreground["media_type"] != "image" or report["media_type"] != "application/json":
        raise ValueError("reference_preparation_artifact_invalid")
    if not _has_exterior_transparency(foreground_path):
        raise ValueError("reference_preparation_foreground_invalid")
    return {
        "contract_schema": HANDOFF_SCHEMA,
        "binding_sha256": value["handoff_sha256"],
        "binding_path": path,
        "producer": dict(producer),
        "producer_result_sha256": result_sha256,
        "source": source,
        "foreground": foreground,
        "preparation_report": report,
    }


def _load_legacy(root: Path, path: Path, value: Mapping[str, Any]) -> dict[str, Any]:
    verify_document(value, "preparation_sha256")
    if value.get("schema_version") not in LEGACY_SCHEMAS or value.get("quality", {}).get("visual_review_required") is not True:
        raise ValueError("reference_preparation_contract_invalid")
    source, _source_path = _artifact(root, value.get("source"))
    foreground, foreground_path = _artifact(root, value.get("foreground"))
    if source["media_type"] != "image" or foreground["media_type"] != "image" or not _has_exterior_transparency(foreground_path):
        raise ValueError("reference_preparation_foreground_invalid")
    version = value.get("tool_version")
    if not isinstance(version, str) or not version:
        raise ValueError("reference_preparation_contract_invalid")
    return {
        "contract_schema": str(value["schema_version"]),
        "binding_sha256": value["preparation_sha256"],
        "binding_path": path,
        "producer": {"name": "ai-frame-animation-legacy", "version": version},
        "producer_result_sha256": value["preparation_sha256"],
        "source": source,
        "foreground": foreground,
        "preparation_report": {"path": path.relative_to(root).as_posix(), **fingerprint(path, media_type="application/json")},
    }


def load_reference_preparation(root: Path, value: str | Path) -> dict[str, Any]:
    root = root.resolve(strict=True)
    path = _path(root, value)
    document = load_json(path)
    if not isinstance(document, Mapping):
        raise ValueError("reference_preparation_contract_invalid")
    if document.get("schema_version") == HANDOFF_SCHEMA:
        return _load_handoff(root, path, document)
    return _load_legacy(root, path, document)
