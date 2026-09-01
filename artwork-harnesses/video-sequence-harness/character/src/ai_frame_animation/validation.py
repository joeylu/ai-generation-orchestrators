from __future__ import annotations

import json
import math
import zipfile
from fractions import Fraction
from pathlib import Path
from typing import Any, Mapping

from PIL import Image, ImageSequence

from .canonical import SHA256_RE, load_json, rooted_path, sha256_file, verify_document
from .media.spritesheet import GRID_BY_PROFILE
from .media.quality import check_subject_canvas
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


def _validate_rgba(path: Path, expected_size: int, *, margin: int = 0) -> None:
    with Image.open(path) as image:
        if image.mode != "RGBA" or image.size != (expected_size, expected_size):
            raise ValueError("frame_mode_or_size_invalid")
        pixels = image.get_flattened_data()
        alpha_values = [pixel[3] for pixel in pixels]
        if min(alpha_values) == 255:
            raise ValueError("frame_is_opaque")
        check_subject_canvas(image)
        if margin:
            bbox = image.getchannel("A").getbbox()
            if bbox is None or bbox[0] < margin or bbox[1] < margin or bbox[2] > expected_size - margin or bbox[3] > expected_size - margin:
                raise ValueError("subject_fit_margin_not_preserved")
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
    # Compare to the rational timeline, not a per-frame rounded duration.
    # One centisecond is the format's timing resolution; coalescing is allowed.
    expected_duration = Fraction(expected_frames * 1000, 1) / playback_fps
    if any(duration <= 0 for duration in durations) or abs(sum(durations) - expected_duration) > 10:
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


def _validate_subject_fit(fit: object, alignment: Mapping[str, Any], *, size: int,
                          source_count: int, frame_count: int) -> int:
    if not isinstance(alignment, Mapping):
        raise ValueError("variant_alignment_invalid")
    if fit is None:
        # Historical deliveries have no subject fit; never mistake a new
        # source-space alignment for that old output-pixel convention.
        if alignment.get("schema_version") == "video_rgba_alignment_report_v2":
            raise ValueError("subject_fit_missing")
        return 0
    if not isinstance(fit, Mapping) or fit.get("schema_version") != "video_subject_fit_v1":
        raise ValueError("subject_fit_invalid")
    vectors = {"source_canvas_size": 2, "aligned_union_bbox": 4, "source_crop_box": 4,
               "resize_size": 2, "offset_px": 2}
    for name, length in vectors.items():
        value = fit.get(name)
        if not isinstance(value, list) or len(value) != length or any(type(v) is not int for v in value):
            raise ValueError("subject_fit_invalid")
    crop, union, resized, offset = (fit[name] for name in ("source_crop_box", "aligned_union_bbox", "resize_size", "offset_px"))
    margin, scale = fit.get("margin_px"), fit.get("scale")
    if (type(margin) is not int or not 0 < margin < (size - 8) / 2
        or not isinstance(scale, (float, int)) or isinstance(scale, bool) or not math.isfinite(scale) or scale <= 0
        or type(fit.get("size")) is not int or fit["size"] != size
        or type(fit.get("source_frame_count")) is not int or fit["source_frame_count"] != source_count
        or min(fit["source_canvas_size"]) < 1 or fit.get("bounds_alpha_threshold") != 0
        or fit.get("filter_guard_px") != 4
        or not crop[0] < union[0] < union[2] < crop[2]
        or not crop[1] < union[1] < union[3] < crop[3]):
        raise ValueError("subject_fit_invalid")
    width, height = crop[2] - crop[0], crop[3] - crop[1]
    expected_scale = (size - 2 * margin) / max(width, height)
    if (not math.isclose(scale, expected_scale, rel_tol=1e-12)
        or resized != [max(1, round(width * expected_scale)), max(1, round(height * expected_scale))]
        or offset != [(size - resized[0]) // 2, (size - resized[1]) // 2]):
        raise ValueError("subject_fit_invalid")
    records = alignment.get("records")
    if (alignment.get("schema_version") != "video_rgba_alignment_report_v2"
        or alignment.get("coordinate_space") != "source_pixels_before_shared_fit"
        or not isinstance(records, list) or len(records) != frame_count
        or any(not isinstance(record, Mapping) or record.get("clip_warning") is not False for record in records)):
        raise ValueError("subject_fit_alignment_invalid")
    return margin


def _validate_variant(
    delivery_root: Path,
    entry: Mapping[str, Any],
    raw_sha256: str,
    require_gif: bool,
    *,
    source_frame_count: int,
    source_timestamps: list[Fraction],
    source_duration: Fraction,
    interval_start: int,
    interval_end: int,
    terminal_policy: str,
    gif_requested: bool,
    expected_subject_fit: object = None,
    strict: bool = True,
) -> dict[str, Any]:
    if entry.get("status") != "completed":
        raise ValueError("variant_entry_status_invalid")
    manifest_path = _verify_artifact(delivery_root, entry["manifest"])
    variant_root = manifest_path.parent
    manifest = load_json(manifest_path)
    verify_document(manifest, "manifest_sha256")
    if manifest.get("schema_version") != "ai_frame_animation_variant_manifest_v2":
        raise ValueError("variant_manifest_schema_invalid")
    warning_evidence = manifest.get("warnings", [])
    if not isinstance(warning_evidence, list) or any(not isinstance(item, str) for item in warning_evidence):
        raise ValueError("variant_warnings_invalid")
    processing = manifest.get("processing", {})
    alignment = processing.get("alignment", {}) if isinstance(processing, Mapping) else {}
    records = alignment.get("records", []) if isinstance(alignment, Mapping) else []
    if not isinstance(records, list):
        raise ValueError("variant_alignment_invalid")
    if strict and (
        "translated_subject_may_clip" in warning_evidence
        or any(isinstance(record, Mapping) and record.get("clip_warning") for record in records)
    ):
        raise ValueError("strict_subject_clipping")
    frame_count = manifest.get("frame_count")
    atlas_profile = manifest.get("atlas_profile")
    if atlas_profile not in GRID_BY_PROFILE or entry.get("atlas_profile") != atlas_profile:
        raise ValueError("variant_entry_atlas_profile_mismatch")
    columns, rows = GRID_BY_PROFILE[atlas_profile]
    capacity = columns * rows
    if manifest.get("capacity") != capacity or entry.get("capacity") != capacity:
        raise ValueError("variant_entry_capacity_mismatch")
    size = manifest.get("size")
    if not isinstance(frame_count, int) or not isinstance(size, int):
        raise ValueError("variant_dimensions_invalid")
    subject_fit = processing.get("subject_fit") if isinstance(processing, Mapping) else None
    if subject_fit != expected_subject_fit:
        raise ValueError("family_subject_fit_mismatch")
    margin = _validate_subject_fit(subject_fit, alignment, size=size, frame_count=frame_count,
                                   source_count=interval_end - interval_start)
    if strict and (
        len(records) != frame_count
        or any(not isinstance(record, Mapping) or not isinstance(record.get("clip_warning"), bool) for record in records)
    ):
        raise ValueError("variant_alignment_invalid")
    if frame_count < 1 or frame_count > capacity or entry.get("frame_count") != frame_count:
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
        _validate_rgba(frame_path, size, margin=margin)
        frame_paths.append(frame_path)
    spritesheet_artifact = artifacts.get("spritesheet")
    atlas_artifact = artifacts.get("atlas")
    if not isinstance(spritesheet_artifact, Mapping) or not isinstance(atlas_artifact, Mapping):
        raise ValueError("variant_atlas_or_spritesheet_missing")
    spritesheet_path = _verify_artifact(variant_root, spritesheet_artifact)
    atlas_path = _verify_artifact(variant_root, atlas_artifact)
    atlas = load_json(atlas_path)
    if atlas.get("schema_version") != "video_sequence_atlas_v2":
        raise ValueError("atlas_schema_invalid")
    layout = atlas.get("layout")
    if not isinstance(layout, Mapping) or [layout.get("columns"), layout.get("rows"), layout.get("capacity"), layout.get("frame_count"), layout.get("unused_cells")] != [columns, rows, capacity, frame_count, capacity - frame_count]:
        raise ValueError("atlas_layout_invalid")
    if (
        atlas.get("format") != "RGBA8888"
        or atlas.get("profile") != atlas_profile
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
    transparent_cell = bytes(size * size * 4)
    for index in range(frame_count, capacity):
        x = (index % columns) * size
        y = (index // columns) * size
        if sheet.crop((x, y, x + size, y + size)).tobytes() != transparent_cell:
            raise ValueError("spritesheet_unused_cell_not_transparent")
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
    if any(index < interval_start or index >= interval_end for index in indices):
        raise ValueError("variant_source_index_outside_semantic_interval")
    if any(right < left for left, right in zip(indices, indices[1:])):
        raise ValueError("variant_source_indices_not_monotonic")
    if terminal_policy == "half_open_exclude_terminal" and interval_end in indices:
        raise ValueError("loop_terminal_was_sampled")
    if terminal_policy == "closed_include_terminal" and indices[-1] != interval_end - 1:
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
    return {"atlas_profile": atlas_profile, "capacity": capacity, "frame_count": frame_count, "status": "valid", "warnings": warnings}


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
    if manifest.get("schema_version") != "ai_frame_animation_delivery_manifest_v2":
        raise ValueError("delivery_manifest_schema_invalid")
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
    requested = manifest.get("requested_atlas_profiles")
    variants = manifest.get("variants")
    failures = manifest.get("failures")
    gif_requested = manifest.get("gif_requested")
    if (
        not isinstance(requested, list)
        or not requested
        or any(not isinstance(item, str) or item not in GRID_BY_PROFILE for item in requested)
        or len(set(requested)) != len(requested)
        or not isinstance(variants, list)
        or any(not isinstance(entry, Mapping) for entry in variants)
        or not isinstance(failures, list)
        or any(not isinstance(entry, Mapping) for entry in failures)
        or not isinstance(gif_requested, bool)
    ):
        raise ValueError("delivery_variant_inventory_invalid")
    completed_list = [entry.get("atlas_profile") for entry in variants]
    failed_list = [entry.get("atlas_profile") for entry in failures]
    if (
        any(not isinstance(item, str) or item not in requested for item in completed_list + failed_list)
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
        or decode.get("probe_operation_count") != 1
        or decode.get("operation_count") != 1
        or decode.get("decoded_frame_count") != source_frame_count
    ):
        raise ValueError("source_timeline_invalid")
    input_mode = decode.get("input_mode")
    handoff_sha256 = decode.get("handoff_sha256")
    if input_mode not in {"internal_decode", "verified_decoded_handoff"}:
        raise ValueError("decode_input_mode_invalid")
    if input_mode == "verified_decoded_handoff":
        if not isinstance(handoff_sha256, str) or not SHA256_RE.fullmatch(handoff_sha256):
            raise ValueError("decoded_handoff_binding_invalid")
    elif handoff_sha256 is not None:
        raise ValueError("decoded_handoff_binding_invalid")
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
    semantic_interval = manifest.get("semantic_interval")
    if not isinstance(semantic_interval, Mapping) or semantic_interval.get("schema_version") != "video_semantic_interval_v1":
        raise ValueError("semantic_interval_invalid")
    interval_start = semantic_interval.get("start_frame_zero_based")
    interval_end = semantic_interval.get("end_frame_exclusive_zero_based")
    native_count = semantic_interval.get("native_frame_count")
    if (
        not isinstance(interval_start, int) or isinstance(interval_start, bool)
        or not isinstance(interval_end, int) or isinstance(interval_end, bool)
        or not 0 <= interval_start < interval_end <= source_frame_count
        or native_count != interval_end - interval_start
        or semantic_interval.get("continuity") != ("loop" if terminal_policy == "half_open_exclude_terminal" else "one_shot")
    ):
        raise ValueError("semantic_interval_invalid")
    selected_duration = _fraction(semantic_interval.get("duration_seconds"), "semantic_interval_duration")
    expected_end = source_timestamps[interval_end] if interval_end < source_frame_count else raw_duration
    if selected_duration != expected_end - source_timestamps[interval_start]:
        raise ValueError("semantic_interval_duration_mismatch")
    first_manifest = load_json(_verify_artifact(delivery_root, variants[0]["manifest"]))
    first_processing = first_manifest.get("processing", {})
    expected_subject_fit = first_processing.get("subject_fit") if isinstance(first_processing, Mapping) else None
    results = [
        _validate_variant(
            delivery_root,
            entry,
            str(raw["sha256"]),
            require_gif,
            source_frame_count=source_frame_count,
            source_timestamps=source_timestamps,
            source_duration=selected_duration,
            interval_start=interval_start,
            interval_end=interval_end,
            terminal_policy=terminal_policy,
            gif_requested=gif_requested,
            expected_subject_fit=expected_subject_fit,
            strict=policy == "strict",
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
        decode = manifest.get("decode")
        decode_record = decode if isinstance(decode, Mapping) else {}
        interval = manifest.get("semantic_interval")
        interval_record = interval if isinstance(interval, Mapping) else {}
        return {
            "kind": "delivery",
            "plan_sha256": manifest.get("plan_sha256"),
            "quality_policy": manifest.get("quality_policy"),
            "raw_sha256": (manifest.get("raw_source") or {}).get("sha256") if isinstance(manifest.get("raw_source"), Mapping) else None,
            "decode_input_mode": decode_record.get("input_mode"),
            "decoded_handoff_sha256": decode_record.get("handoff_sha256"),
            "semantic_interval": {
                "policy": interval_record.get("policy"),
                "start_frame_zero_based": interval_record.get("start_frame_zero_based"),
                "end_frame_exclusive_zero_based": interval_record.get("end_frame_exclusive_zero_based"),
                "native_frame_count": interval_record.get("native_frame_count"),
            },
            "requested_atlas_profiles": manifest.get("requested_atlas_profiles"),
            "completed_atlas_profiles": [item.get("atlas_profile") for item in manifest.get("variants", []) if isinstance(item, Mapping)],
            "failures": manifest.get("failures", []),
        }
    if path.is_file() and path.name == "events.jsonl":
        events = AttemptStore(path.parent.parent, path.parent.name).read()
        return {"kind": "attempt", "attempt_id": events[0].get("attempt_id") if events else None, "states": [item.get("state") for item in events]}
    if path.is_file() and path.suffix.lower() == ".json":
        value = load_json(path)
        return {"kind": "json", "schema_version": value.get("schema_version"), "keys": sorted(value)}
    raise ValueError("inspect_target_not_supported")
