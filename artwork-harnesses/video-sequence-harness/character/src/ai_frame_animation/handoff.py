from __future__ import annotations

import json
import os
import stat
from dataclasses import dataclass
from importlib import resources
from pathlib import Path, PurePosixPath, PureWindowsPath
from typing import Any, Mapping
from fractions import Fraction

import jsonschema
from PIL import Image

from .canonical import fingerprint, load_json, verify_document


MAX_HANDOFF_BYTES = 8 * 1024 * 1024
MAX_PROBE_BYTES = 32 * 1024 * 1024
PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"


@dataclass(frozen=True)
class DecodedHandoff:
    sha256: str
    raw_video: Path
    probe_payload: Mapping[str, Any]
    decoded_paths: tuple[Path, ...]
    source_processing: Mapping[str, Any] | None = None
    source_probe_payload: Mapping[str, Any] | None = None


def _safe_relative(value: object, code: str) -> PurePosixPath:
    if not isinstance(value, str) or not value or "\\" in value:
        raise ValueError(code)
    posix = PurePosixPath(value)
    windows = PureWindowsPath(value)
    if (
        posix.is_absolute()
        or windows.is_absolute()
        or windows.drive
        or posix.as_posix() != value
        or any(part in {"", ".", ".."} for part in posix.parts)
    ):
        raise ValueError(code)
    return posix


def _lexical_absolute(path: Path) -> Path:
    return Path(os.path.abspath(os.fspath(path)))


def _reject_symlink_components(root: Path, candidate: Path, code: str) -> None:
    lexical = _lexical_absolute(candidate)
    current = lexical
    reparse_flag = getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0)
    while True:
        try:
            details = current.lstat()
            if stat.S_ISLNK(details.st_mode) or bool(getattr(details, "st_file_attributes", 0) & reparse_flag):
                raise ValueError(code)
        except OSError as exc:
            raise ValueError(code) from exc
        try:
            if current.samefile(root):
                return
        except OSError as exc:
            raise ValueError(code) from exc
        parent = current.parent
        if parent == current:
            raise ValueError(code)
        current = parent


def _external_path(root: Path, value: str | Path, code: str) -> Path:
    candidate = Path(value)
    candidate = candidate if candidate.is_absolute() else root / candidate
    _reject_symlink_components(root, candidate, code)
    try:
        resolved = candidate.resolve(strict=True)
        resolved.relative_to(root)
    except (OSError, ValueError) as exc:
        raise ValueError(code) from exc
    return resolved


def _contract_path(root: Path, value: object, code: str) -> Path:
    relative = _safe_relative(value, code)
    return _external_path(root, root.joinpath(*relative.parts), code)


def _regular_file(root: Path, value: object, code: str) -> Path:
    path = _contract_path(root, value, code)
    try:
        path.lstat()
    except OSError as exc:
        raise ValueError(code) from exc
    if not path.is_file() or path.is_symlink():
        raise ValueError(code)
    return path


def _directory(root: Path, value: object, code: str) -> Path:
    path = _contract_path(root, value, code)
    try:
        path.lstat()
    except OSError as exc:
        raise ValueError(code) from exc
    if not path.is_dir() or path.is_symlink():
        raise ValueError(code)
    return path


def _artifact_path(root: Path, artifact: Mapping[str, Any], *, code: str, maximum_bytes: int | None = None) -> Path:
    path = _regular_file(root, artifact.get("path"), code)
    actual = fingerprint(path, media_type=str(artifact.get("media_type")))
    if maximum_bytes is not None and int(actual["bytes"]) > maximum_bytes:
        raise ValueError(code)
    if actual != {key: artifact.get(key) for key in ("bytes", "sha256", "media_type")}:
        raise ValueError(code)
    return path


def _validated_probe_payload(value: Mapping[str, Any]) -> Mapping[str, Any]:
    if not set(value).issubset({"streams", "format", "frames"}):
        raise ValueError("decoded_handoff_probe_payload_invalid")
    streams = value.get("streams")
    frames = value.get("frames")
    format_record = value.get("format", {})
    stream_fields = {"codec_type", "avg_frame_rate", "r_frame_rate", "duration_ts", "time_base", "duration", "width", "height"}
    if (
        not isinstance(streams, list)
        or len(streams) != 1
        or not isinstance(streams[0], Mapping)
        or not set(streams[0]).issubset(stream_fields)
        or streams[0].get("codec_type", "video") != "video"
        or not isinstance(frames, list)
        or not frames
        or not isinstance(format_record, Mapping)
        or not set(format_record).issubset({"duration"})
    ):
        raise ValueError("decoded_handoff_probe_payload_invalid")
    for row in frames:
        if (
            not isinstance(row, Mapping)
            or not set(row).issubset({"best_effort_timestamp", "pts", "duration", "pkt_duration",
                                      "best_effort_timestamp_time", "pts_time", "duration_time", "pkt_duration_time"})
            or not any(key in row for key in ("best_effort_timestamp", "pts", "best_effort_timestamp_time", "pts_time"))
        ):
            raise ValueError("decoded_handoff_probe_payload_invalid")
    return value


def verify_video_timeline_identity(original: Mapping[str, Any], foreground: Mapping[str, Any]) -> None:
    """An Alpha producer may change encoding, but cannot silently retime frames."""
    from .media.timeline import build_source_timeline, as_fraction, frame_time
    from .media.frames import check_pixel_budget
    timelines = []
    dimensions = []
    for payload in (original, foreground):
        _validated_probe_payload(payload)
        stream = payload["streams"][0]
        count = len(payload["frames"])
        check_pixel_budget(stream.get("width"), stream.get("height"), count)
        dimensions.append((stream["width"], stream["height"], count))
        timeline = build_source_timeline(payload, decoded_frame_count=count, continuity="one_shot")
        pts = [Fraction(p["numerator"], p["denominator"]) for p in timeline["frame_timestamps_seconds"]]
        duration = timeline["raw_duration_seconds"]
        timelines.append(([p - pts[0] for p in pts], Fraction(duration["numerator"], duration["denominator"])))
    if dimensions[0] != dimensions[1]:
        raise ValueError("foreground_source_timeline_mismatch")
    if timelines[0] == timelines[1]:
        return
    # Quantization is a deterministic mapping, never an error window. Require
    # integer evidence on both sides and a fine enough destination clock.
    for payload in (original, foreground):
        if any(not any(row.get(key) not in (None, "N/A") for key in ("pts", "best_effort_timestamp"))
               for row in payload["frames"]):
            raise ValueError("foreground_source_timeline_mismatch")
        if not any(payload["frames"][-1].get(key) not in (None, "N/A", 0, "0") for key in ("duration", "pkt_duration")):
            raise ValueError("foreground_source_timeline_mismatch")
    tick = as_fraction(foreground["streams"][0].get("time_base"), "probe_time_base")
    source_pts, source_duration = timelines[0]
    foreground_pts, foreground_duration = timelines[1]
    if tick > Fraction(1, 1000) or any(b - a < 2 * tick for a, b in zip(source_pts, source_pts[1:])):
        raise ValueError("foreground_source_timeline_mismatch")
    def nearest(value: Fraction) -> Fraction:
        return ((value / tick + Fraction(1, 2)) // 1) * tick
    if foreground_pts != [nearest(value) for value in source_pts]:
        raise ValueError("foreground_source_timeline_mismatch")
    # Packet duration is truncated to destination ticks by common muxers;
    # nearest-tick duration is also accepted, but no extra hold or drift is.
    tail = source_duration - source_pts[-1]
    expected_tails = {(tail // tick) * tick, nearest(tail)}
    actual_tail = frame_time(foreground["frames"][-1], foreground["streams"][0], ("duration", "pkt_duration"))
    if actual_tail not in expected_tails or actual_tail is None or actual_tail <= 0 or foreground_duration != foreground_pts[-1] + actual_tail:
        raise ValueError("foreground_source_timeline_mismatch")


def load_decoded_handoff(root: Path, handoff_path: str | Path, *, raw_video: str | Path) -> DecodedHandoff:
    """Load a content-bound, provider-neutral predecoded source without invoking media tools."""

    resolved_root = root.resolve(strict=True)
    if not resolved_root.is_dir():
        raise ValueError("decoded_handoff_root_invalid")
    document_path = _external_path(resolved_root, handoff_path, "decoded_handoff_path_invalid")
    if not document_path.is_file() or document_path.is_symlink() or document_path.stat().st_size > MAX_HANDOFF_BYTES:
        raise ValueError("decoded_handoff_path_invalid")
    document = load_json(document_path)
    schema = json.loads(
        resources.files("ai_frame_animation").joinpath("schemas", "decoded-handoff.schema.json").read_text(encoding="utf-8")
    )
    try:
        jsonschema.validate(document, schema)
    except jsonschema.ValidationError as exc:
        raise ValueError("decoded_handoff_schema_invalid") from exc
    digest = verify_document(document, "handoff_sha256")

    raw_artifact = document["raw_source"]
    if not isinstance(raw_artifact, Mapping):
        raise ValueError("decoded_handoff_schema_invalid")
    declared_raw = _artifact_path(resolved_root, raw_artifact, code="decoded_handoff_raw_invalid")
    supplied_raw = _external_path(resolved_root, raw_video, "decoded_handoff_raw_invalid")
    if declared_raw != supplied_raw:
        raise ValueError("decoded_handoff_raw_mismatch")

    probe = document["probe"]
    if not isinstance(probe, Mapping) or not isinstance(probe.get("artifact"), Mapping):
        raise ValueError("decoded_handoff_schema_invalid")
    probe_path = _artifact_path(
        resolved_root,
        probe["artifact"],
        code="decoded_handoff_probe_invalid",
        maximum_bytes=MAX_PROBE_BYTES,
    )
    probe_payload = _validated_probe_payload(load_json(probe_path))
    source_processing = None
    source_probe_payload = None
    if document["schema_version"] == "ai_frame_animation_decoded_handoff_v2":
        _artifact_path(resolved_root, document["foreground_source"], code="decoded_handoff_foreground_invalid")
        original_probe = _artifact_path(resolved_root, document["source_probe"]["artifact"],
            code="decoded_handoff_source_probe_invalid", maximum_bytes=MAX_PROBE_BYTES)
        source_probe_payload = load_json(original_probe)
        verify_video_timeline_identity(source_probe_payload, probe_payload)
        source_processing = {
            "schema_version": "ai_frame_animation_alpha_source_v1",
            "foreground_source": document["foreground_source"],
            "source_probe": document["source_probe"]["artifact"],
            "foreground_probe": document["probe"]["artifact"],
            "handoff_sha256": digest,
        }

    decode = document["decode"]
    if not isinstance(decode, Mapping):
        raise ValueError("decoded_handoff_schema_invalid")
    decoded_directory = _directory(resolved_root, decode.get("directory"), "decoded_handoff_directory_invalid")
    rows = decode.get("frames")
    probe_frames = probe_payload.get("frames")
    if (
        not isinstance(rows, list)
        or decode.get("frame_count") != len(rows)
        or not isinstance(probe_frames, list)
        or len(probe_frames) != len(rows)
    ):
        raise ValueError("decoded_handoff_frame_inventory_invalid")

    paths: list[Path] = []
    declared_names: list[str] = []
    for expected_index, row in enumerate(rows):
        if not isinstance(row, Mapping) or row.get("index") != expected_index or not isinstance(row.get("artifact"), Mapping):
            raise ValueError("decoded_handoff_frame_inventory_invalid")
        frame = _artifact_path(resolved_root, row["artifact"], code="decoded_handoff_frame_invalid")
        if frame.parent != decoded_directory or frame.name in declared_names:
            raise ValueError("decoded_handoff_frame_inventory_invalid")
        try:
            with frame.open("rb") as handle:
                signature = handle.read(len(PNG_SIGNATURE))
            if signature != PNG_SIGNATURE:
                raise ValueError("decoded_handoff_frame_invalid")
        except OSError as exc:
            raise ValueError("decoded_handoff_frame_invalid") from exc
        paths.append(frame)
        if source_processing is not None:
            with Image.open(frame) as image:
                stream = probe_payload["streams"][0]
                if image.size != (stream["width"], stream["height"]) or image.mode != "RGBA":
                    raise ValueError("decoded_handoff_foreground_dimensions_invalid")
        declared_names.append(frame.name)

    try:
        actual = sorted(entry.name for entry in decoded_directory.iterdir())
    except OSError as exc:
        raise ValueError("decoded_handoff_frame_inventory_invalid") from exc
    if actual != sorted(declared_names):
        raise ValueError("decoded_handoff_frame_inventory_invalid")

    return DecodedHandoff(
        sha256=digest,
        raw_video=declared_raw,
        probe_payload=probe_payload,
        decoded_paths=tuple(paths),
        source_processing=source_processing,
        source_probe_payload=source_probe_payload,
    )
