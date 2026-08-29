from __future__ import annotations

import json
import zipfile
from fractions import Fraction
from pathlib import Path
from typing import Any, Mapping

from PIL import Image, ImageSequence

from .canonical import SHA256_RE, load_json, rooted_path, sha256_file, verify_document
from .media.spritesheet import GRID_BY_FRAME_COUNT
from .state import AttemptStore


def _resolve_under(root: Path, relative: object) -> Path:
    if not isinstance(relative, str):
        raise ValueError("artifact_path_invalid")
    return rooted_path(root, relative, must_exist=True)


def _verify_artifact(root: Path, artifact: Mapping[str, Any]) -> Path:
    path = _resolve_under(root, artifact.get("path"))
    if path.is_symlink() or not path.is_file():
        raise ValueError("artifact_not_regular")
    if artifact.get("bytes") != path.stat().st_size:
        raise ValueError("artifact_size_mismatch")
    if artifact.get("sha256") != sha256_file(path):
        raise ValueError("artifact_sha256_mismatch")
    return path


def _validate_rgba(path: Path, expected_size: int) -> None:
    with Image.open(path) as image:
        if image.mode != "RGBA" or image.size != (expected_size, expected_size):
            raise ValueError("frame_mode_or_size_invalid")
        pixels = image.get_flattened_data()
        alpha_values = [pixel[3] for pixel in pixels]
        if min(alpha_values) == 255:
            raise ValueError("frame_is_opaque")
        if any(alpha == 0 and (red or green or blue) for red, green, blue, alpha in pixels):
            raise ValueError("transparent_pixel_has_hidden_rgb")


def _validate_gif(path: Path, expected_frames: int, playback_fps: Fraction) -> None:
    with Image.open(path) as gif:
        frames = []
        durations = []
        for frame in ImageSequence.Iterator(gif):
            frames.append(frame.convert("RGBA"))
            durations.append(int(frame.info.get("duration", gif.info.get("duration", 0))))
    # GIF encoders may losslessly coalesce consecutive identical frames and
    # extend their duration. PNGs remain the authoritative frame inventory.
    if not frames or expected_frames < 1:
        raise ValueError("gif_frame_inventory_invalid")
    if any(frame.getchannel("A").getextrema()[0] != 0 for frame in frames):
        raise ValueError("gif_transparency_missing")
    frame_duration = max(1, round(1000 / float(playback_fps)))
    if abs(sum(durations) - frame_duration * expected_frames) > frame_duration:
        raise ValueError("gif_duration_invalid")


def _fraction(value: object, field: str) -> Fraction:
    if not isinstance(value, Mapping):
        raise ValueError(f"{field}_invalid")
    try:
        result = Fraction(int(value["numerator"]), int(value["denominator"]))
    except (KeyError, TypeError, ValueError, ZeroDivisionError) as exc:
        raise ValueError(f"{field}_invalid") from exc
    if result <= 0:
        raise ValueError(f"{field}_invalid")
    return result


def _signed_fraction(value: object, field: str) -> Fraction:
    if not isinstance(value, Mapping):
        raise ValueError(f"{field}_invalid")
    try:
        result = Fraction(int(value["numerator"]), int(value["denominator"]))
    except (KeyError, TypeError, ValueError, ZeroDivisionError) as exc:
        raise ValueError(f"{field}_invalid") from exc
    return result


def _validate_variant(
    delivery_root: Path,
    entry: Mapping[str, Any],
    raw_sha256: str,
    require_gif: bool,
    *,
    source_frame_count: int,
    source_timestamps: list[Fraction],
    source_duration: Fraction,
    terminal_policy: str,
    gif_requested: bool,
) -> dict[str, Any]:
    if entry.get("status") != "completed":
        raise ValueError("variant_entry_status_invalid")
    manifest_path = _verify_artifact(delivery_root, entry["manifest"])
    variant_root = manifest_path.parent
    manifest = load_json(manifest_path)
    verify_document(manifest, "manifest_sha256")
    frame_count = manifest.get("frame_count")
    size = manifest.get("size")
    if not isinstance(frame_count, int) or not isinstance(size, int):
        raise ValueError("variant_dimensions_invalid")
    if frame_count not in GRID_BY_FRAME_COUNT or entry.get("frame_count") != frame_count:
        raise ValueError("variant_entry_frame_count_mismatch")
    if manifest.get("raw_sha256") != raw_sha256:
        raise ValueError("variant_raw_source_mismatch")
    artifacts = manifest.get("artifacts")
    if not isinstance(artifacts, Mapping) or not isinstance(artifacts.get("frames"), list):
        raise ValueError("variant_artifacts_invalid")
    frames = artifacts["frames"]
    if len(frames) != frame_count:
        raise ValueError("variant_frame_count_invalid")
    frame_paths: list[Path] = []
    for artifact in frames:
        if not isinstance(artifact, Mapping):
            raise ValueError("frame_artifact_invalid")
        frame_path = _verify_artifact(variant_root, artifact)
        _validate_rgba(frame_path, size)
        frame_paths.append(frame_path)
    spritesheet_artifact = artifacts.get("spritesheet")
    atlas_artifact = artifacts.get("atlas")
    if not isinstance(spritesheet_artifact, Mapping) or not isinstance(atlas_artifact, Mapping):
        raise ValueError("variant_atlas_or_spritesheet_missing")
    spritesheet_path = _verify_artifact(variant_root, spritesheet_artifact)
    atlas_path = _verify_artifact(variant_root, atlas_artifact)
    atlas = load_json(atlas_path)
    columns, rows = GRID_BY_FRAME_COUNT[frame_count]
    layout = atlas.get("layout")
    if not isinstance(layout, Mapping) or [layout.get("columns"), layout.get("rows"), layout.get("frame_count")] != [columns, rows, frame_count]:
        raise ValueError("atlas_layout_invalid")
    if (
        atlas.get("format") != "RGBA8888"
        or atlas.get("image") != spritesheet_path.name
        or atlas.get("image_size") != {"w": columns * size, "h": rows * size}
        or not isinstance(atlas.get("frames"), list)
        or len(atlas["frames"]) != frame_count
    ):
        raise ValueError("atlas_metadata_invalid")
    for index, record in enumerate(atlas["frames"], start=1):
        expected_rect = {
            "x": ((index - 1) % columns) * size,
            "y": ((index - 1) // columns) * size,
            "w": size,
            "h": size,
        }
        if not isinstance(record, Mapping) or record.get("index") != index or record.get("rect") != expected_rect:
            raise ValueError("atlas_frame_record_invalid")
    with Image.open(spritesheet_path) as source_sheet:
        sheet = source_sheet.convert("RGBA")
    if source_sheet.mode != "RGBA" or sheet.size != (columns * size, rows * size):
        raise ValueError("spritesheet_mode_or_size_invalid")
    for index, frame_path in enumerate(frame_paths):
        with Image.open(frame_path) as source_frame:
            frame = source_frame.convert("RGBA")
        x = (index % columns) * size
        y = (index // columns) * size
        if sheet.crop((x, y, x + size, y + size)).tobytes() != frame.tobytes():
            raise ValueError("spritesheet_cell_mismatch")
    gif = artifacts.get("gif")
    if require_gif and not isinstance(gif, Mapping):
        raise ValueError("variant_gif_missing")
    timeline = manifest.get("timeline")
    if not isinstance(timeline, Mapping):
        raise ValueError("variant_timeline_invalid")
    if timeline.get("terminal_policy") != terminal_policy:
        raise ValueError("variant_terminal_policy_mismatch")
    indices = timeline.get("source_frame_index_map")
    if not isinstance(indices, list) or len(indices) != frame_count:
        raise ValueError("variant_timeline_invalid")
    if any(not isinstance(index, int) or isinstance(index, bool) or index < 0 or index >= source_frame_count for index in indices):
        raise ValueError("variant_source_index_invalid")
    if any(right < left for left, right in zip(indices, indices[1:])):
        raise ValueError("variant_source_indices_not_monotonic")
    if terminal_policy == "half_open_exclude_terminal" and source_frame_count > 1 and source_frame_count - 1 in indices:
        raise ValueError("loop_terminal_was_sampled")
    if terminal_policy == "closed_include_terminal" and indices[-1] != source_frame_count - 1:
        raise ValueError("one_shot_terminal_missing")
    duration = _fraction(timeline.get("semantic_duration_seconds"), "semantic_duration")
    if duration != source_duration:
        raise ValueError("variant_semantic_duration_mismatch")
    selected_timestamps = timeline.get("source_timestamps_seconds")
    if not isinstance(selected_timestamps, list) or len(selected_timestamps) != frame_count:
        raise ValueError("variant_source_timestamps_invalid")
    actual_timestamps = [
        _signed_fraction(value, "variant_source_timestamp") for value in selected_timestamps
    ]
    if actual_timestamps != [source_timestamps[index] for index in indices]:
        raise ValueError("variant_source_timestamps_mismatch")
    playback_fps = _fraction(timeline.get("playback_fps"), "playback_fps")
    if playback_fps * duration != frame_count:
        raise ValueError("variant_playback_timeline_mismatch")
    if isinstance(gif, Mapping):
        _validate_gif(_verify_artifact(variant_root, gif), frame_count, playback_fps)
    warnings = manifest.get("warnings", [])
    if not isinstance(warnings, list) or any(not isinstance(item, str) for item in warnings):
        raise ValueError("variant_warnings_invalid")
    if entry.get("warnings", []) != warnings:
        raise ValueError("variant_warning_summary_mismatch")
    if require_gif and "gif_export_failed" in warnings:
        raise ValueError("strict_gif_failure_warning_invalid")
    if gif_requested and not isinstance(gif, Mapping) and "gif_export_failed" not in warnings:
        raise ValueError("gif_omission_warning_missing")
    return {"frame_count": frame_count, "status": "valid", "warnings": warnings}


def _validate_package(delivery_root: Path) -> None:
    package = delivery_root / "delivery.zip"
    if package.is_symlink() or not package.is_file():
        raise ValueError("delivery_package_missing")
    expected = sorted(path.relative_to(delivery_root).as_posix() for path in delivery_root.rglob("*") if path.is_file() and path != package)
    with zipfile.ZipFile(package) as archive:
        actual = sorted(item.filename for item in archive.infolist())
        if actual != expected:
            raise ValueError("delivery_package_inventory_mismatch")
        bad = archive.testzip()
        if bad is not None:
            raise ValueError("delivery_package_crc_failure")
        for item in archive.infolist():
            local = delivery_root / item.filename
            with archive.open(item, "r") as archived, local.open("rb") as source:
                while True:
                    archived_chunk = archived.read(1024 * 1024)
                    source_chunk = source.read(1024 * 1024)
                    if archived_chunk != source_chunk:
                        raise ValueError("delivery_package_content_mismatch")
                    if not archived_chunk:
                        break


def validate_delivery(delivery_root: Path, *, policy: str = "strict", workspace_root: Path | None = None) -> dict[str, Any]:
    if policy not in {"strict", "best_effort"}:
        raise ValueError("quality_policy_invalid")
    delivery_root = delivery_root.resolve(strict=True)
    manifest = load_json(delivery_root / "delivery-manifest.json")
    verify_document(manifest, "manifest_sha256")
    if manifest.get("quality_policy") != policy:
        raise ValueError("quality_policy_mismatch")
    if not isinstance(manifest.get("plan_sha256"), str) or not SHA256_RE.fullmatch(str(manifest["plan_sha256"])):
        raise ValueError("delivery_plan_digest_invalid")
    raw = manifest.get("raw_source")
    if not isinstance(raw, Mapping) or not isinstance(raw.get("sha256"), str):
        raise ValueError("raw_source_binding_invalid")
    if workspace_root is None:
        raise ValueError("workspace_root_required_for_raw_validation")
    raw_path = _resolve_under(workspace_root.resolve(strict=True), raw.get("path"))
    if raw.get("bytes") != raw_path.stat().st_size or raw.get("sha256") != sha256_file(raw_path):
        raise ValueError("raw_source_fingerprint_mismatch")
    requested = manifest.get("requested_frame_counts")
    variants = manifest.get("variants")
    failures = manifest.get("failures")
    gif_requested = manifest.get("gif_requested")
    if (
        not isinstance(requested, list)
        or not requested
        or any(isinstance(item, bool) or item not in GRID_BY_FRAME_COUNT for item in requested)
        or len(set(requested)) != len(requested)
        or not isinstance(variants, list)
        or any(not isinstance(entry, Mapping) for entry in variants)
        or not isinstance(failures, list)
        or any(not isinstance(entry, Mapping) for entry in failures)
        or not isinstance(gif_requested, bool)
    ):
        raise ValueError("delivery_variant_inventory_invalid")
    completed_list = [entry.get("frame_count") for entry in variants]
    failed_list = [entry.get("frame_count") for entry in failures]
    if (
        any(isinstance(item, bool) or item not in requested for item in completed_list + failed_list)
        or len(set(completed_list)) != len(completed_list)
        or len(set(failed_list)) != len(failed_list)
        or set(completed_list) & set(failed_list)
        or set(completed_list) | set(failed_list) != set(requested)
    ):
        raise ValueError("delivery_variant_inventory_invalid")
    if any(entry.get("status") != "failed" or not isinstance(entry.get("code"), str) for entry in failures):
        raise ValueError("delivery_failure_record_invalid")
    completed = set(completed_list)
    if policy == "strict" and (completed != set(requested) or failures):
        raise ValueError("strict_requested_variants_incomplete")
    if policy == "best_effort" and not completed:
        raise ValueError("best_effort_has_no_valid_variant")
    require_gif = policy == "strict" and gif_requested
    source_timeline = manifest.get("source_timeline")
    if not isinstance(source_timeline, Mapping):
        raise ValueError("source_timeline_invalid")
    source_frame_count = source_timeline.get("decoded_frame_count")
    terminal_policy = source_timeline.get("terminal_policy")
    decode = manifest.get("decode")
    if (
        not isinstance(source_frame_count, int)
        or source_frame_count < 1
        or terminal_policy not in {"half_open_exclude_terminal", "closed_include_terminal"}
        or not isinstance(decode, Mapping)
        or decode.get("operation_count") != 1
        or decode.get("decoded_frame_count") != source_frame_count
    ):
        raise ValueError("source_timeline_invalid")
    timestamp_records = source_timeline.get("frame_timestamps_seconds")
    if not isinstance(timestamp_records, list) or len(timestamp_records) != source_frame_count:
        raise ValueError("source_timeline_invalid")
    source_timestamps = [_signed_fraction(value, "source_timestamp") for value in timestamp_records]
    if any(right <= left for left, right in zip(source_timestamps, source_timestamps[1:])):
        raise ValueError("source_timestamps_not_strictly_increasing")
    source_duration = _fraction(source_timeline.get("semantic_duration_seconds"), "source_semantic_duration")
    raw_duration = _fraction(source_timeline.get("raw_duration_seconds"), "source_raw_duration")
    _fraction(source_timeline.get("raw_fps"), "source_raw_fps")
    if terminal_policy == "half_open_exclude_terminal":
        if source_frame_count < 2 or source_duration != source_timestamps[-1] - source_timestamps[0]:
            raise ValueError("source_loop_duration_mismatch")
    elif source_duration != raw_duration:
        raise ValueError("source_one_shot_duration_mismatch")
    results = [
        _validate_variant(
            delivery_root,
            entry,
            str(raw["sha256"]),
            require_gif,
            source_frame_count=source_frame_count,
            source_timestamps=source_timestamps,
            source_duration=source_duration,
            terminal_policy=terminal_policy,
            gif_requested=gif_requested,
        )
        for entry in variants
    ]
    _validate_package(delivery_root)
    return {
        "schema_version": "ai_frame_animation_validation_report_v1",
        "policy": policy,
        "status": "passed_with_warnings" if failures or any(result["warnings"] for result in results) else "passed",
        "raw_sha256": raw["sha256"],
        "variants": results,
        "failures": failures,
    }


def inspect_artifact(path: Path) -> dict[str, Any]:
    path = path.resolve(strict=True)
    if path.is_dir() and (path / "delivery-manifest.json").is_file():
        manifest = load_json(path / "delivery-manifest.json")
        verify_document(manifest, "manifest_sha256")
        return {
            "kind": "delivery",
            "plan_sha256": manifest.get("plan_sha256"),
            "quality_policy": manifest.get("quality_policy"),
            "raw_sha256": (manifest.get("raw_source") or {}).get("sha256") if isinstance(manifest.get("raw_source"), Mapping) else None,
            "requested_frame_counts": manifest.get("requested_frame_counts"),
            "completed_frame_counts": [item.get("frame_count") for item in manifest.get("variants", []) if isinstance(item, Mapping)],
            "failures": manifest.get("failures", []),
        }
    if path.is_file() and path.name == "events.jsonl":
        events = AttemptStore(path.parent.parent, path.parent.name).read()
        return {"kind": "attempt", "attempt_id": events[0].get("attempt_id") if events else None, "states": [item.get("state") for item in events]}
    if path.is_file() and path.suffix.lower() == ".json":
        value = load_json(path)
        return {"kind": "json", "schema_version": value.get("schema_version"), "keys": sorted(value)}
    raise ValueError("inspect_target_not_supported")
