"""Transport-neutral preparation handoff shared by local CLI and service adapters."""

from __future__ import annotations

from pathlib import Path, PurePosixPath, PureWindowsPath
from typing import Any, Mapping

from . import __version__
from .canonical import SHA256_RE, fingerprint, load_json, relative_posix, rooted_path, stamp_document, verify_document, write_json_atomic


SCHEMA_VERSION = "ai_reference_preparation_handoff_v1"
PRODUCER_NAME = "ai-image-background-removal"


def _safe_artifact(root: Path, value: Mapping[str, Any]) -> Path:
    if set(value) != {"path", "bytes", "sha256", "media_type"}:
        raise ValueError("reference_handoff_artifact_invalid")
    if (
        type(value.get("bytes")) is not int
        or value["bytes"] < 0
        or not isinstance(value.get("sha256"), str)
        or not SHA256_RE.fullmatch(value["sha256"])
        or not isinstance(value.get("media_type"), str)
        or not value["media_type"]
    ):
        raise ValueError("reference_handoff_artifact_invalid")
    raw = value.get("path")
    if (
        not isinstance(raw, str)
        or not raw
        or "\\" in raw
        or PureWindowsPath(raw).drive
        or PurePosixPath(raw).is_absolute()
        or ".." in PurePosixPath(raw).parts
    ):
        raise ValueError("reference_handoff_path_unsafe")
    path = rooted_path(root, raw, must_exist=True)
    if path.is_symlink() or not path.is_file():
        raise ValueError("reference_handoff_path_unsafe")
    expected = {key: value[key] for key in ("bytes", "sha256", "media_type")}
    if fingerprint(path, media_type=str(value["media_type"])) != expected:
        raise ValueError("reference_handoff_artifact_changed")
    return path


def write_preparation_handoff(*, root: Path, staged: Path, out: Path, report: Mapping[str, Any]) -> dict[str, Any]:
    report_path = staged / "preparation.json"
    handoff = stamp_document({
        "schema_version": SCHEMA_VERSION,
        "producer": {"name": PRODUCER_NAME, "version": __version__},
        "source": dict(report["source"]),
        "foreground": dict(report["foreground"]),
        "preparation_report": {
            "path": relative_posix(root, out / "preparation.json"),
            **fingerprint(report_path, media_type="application/json"),
        },
        "producer_result_sha256": report["preparation_sha256"],
        "visual_review_required": True,
    }, "handoff_sha256")
    write_json_atomic(staged / "handoff.json", handoff)
    return handoff


def load_preparation_handoff(root: Path, value: str | Path) -> dict[str, Any]:
    root = root.resolve(strict=True)
    path = rooted_path(root, value, must_exist=True)
    if path.is_symlink() or not path.is_file():
        raise ValueError("reference_handoff_path_unsafe")
    handoff = load_json(path)
    verify_document(handoff, "handoff_sha256")
    if set(handoff) != {
        "schema_version", "producer", "source", "foreground", "preparation_report",
        "producer_result_sha256", "visual_review_required", "handoff_sha256",
    } or handoff.get("schema_version") != SCHEMA_VERSION or handoff.get("visual_review_required") is not True:
        raise ValueError("reference_handoff_contract_invalid")
    producer = handoff.get("producer")
    if not isinstance(producer, Mapping) or set(producer) != {"name", "version"} or producer.get("name") != PRODUCER_NAME or not isinstance(producer.get("version"), str) or not producer["version"]:
        raise ValueError("reference_handoff_producer_invalid")
    if not isinstance(handoff.get("producer_result_sha256"), str) or not SHA256_RE.fullmatch(handoff["producer_result_sha256"]):
        raise ValueError("reference_handoff_result_invalid")
    for name in ("source", "foreground", "preparation_report"):
        artifact = handoff.get(name)
        if not isinstance(artifact, Mapping):
            raise ValueError("reference_handoff_artifact_invalid")
        _safe_artifact(root, artifact)
    from .preparation import load_preparation
    report = load_preparation(root, handoff["preparation_report"]["path"])
    if report.get("preparation_sha256") != handoff.get("producer_result_sha256"):
        raise ValueError("reference_handoff_report_mismatch")
    if report.get("source") != handoff["source"] or report.get("foreground") != handoff["foreground"]:
        raise ValueError("reference_handoff_report_mismatch")
    return handoff
