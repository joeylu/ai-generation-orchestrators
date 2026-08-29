from __future__ import annotations

from fractions import Fraction
from typing import Any, Mapping, Sequence


SUPPORTED_FRAME_COUNTS = (16, 32, 64)


def as_fraction(value: object, field: str) -> Fraction:
    if isinstance(value, bool):
        raise ValueError(f"{field}_invalid")
    try:
        result = value if isinstance(value, Fraction) else Fraction(str(value))
    except (ValueError, ZeroDivisionError) as exc:
        raise ValueError(f"{field}_invalid") from exc
    if result <= 0:
        raise ValueError(f"{field}_invalid")
    return result


def fraction_record(value: Fraction) -> dict[str, int | str]:
    return {
        "numerator": value.numerator,
        "denominator": value.denominator,
        "decimal": format(float(value), ".12g"),
    }


def choose_uniform_indices(source_count: int, frame_count: int, *, continuity: str) -> list[int]:
    if frame_count not in SUPPORTED_FRAME_COUNTS:
        raise ValueError("frame_count_must_be_16_32_or_64")
    if source_count < 1:
        raise ValueError("no_source_frames")
    if continuity == "loop":
        usable = source_count - 1 if source_count > 1 else 1
        return [(index * usable) // frame_count for index in range(frame_count)]
    if continuity == "one_shot":
        if frame_count == 1:
            return [0]
        return [round(index * (source_count - 1) / (frame_count - 1)) for index in range(frame_count)]
    raise ValueError("continuity_must_be_loop_or_one_shot")


def _stream(payload: Mapping[str, Any]) -> Mapping[str, Any]:
    streams = payload.get("streams")
    if not isinstance(streams, list):
        raise ValueError("probe_streams_invalid")
    for item in streams:
        if isinstance(item, Mapping) and item.get("codec_type", "video") == "video":
            return item
    raise ValueError("probe_video_stream_missing")


def _fps(stream: Mapping[str, Any]) -> Fraction:
    for field in ("avg_frame_rate", "r_frame_rate"):
        value = stream.get(field)
        if value not in (None, "0/0", "N/A"):
            try:
                return as_fraction(value, f"probe_{field}")
            except ValueError:
                pass
    raise ValueError("probe_fps_missing")


def _duration(payload: Mapping[str, Any], stream: Mapping[str, Any], frame_count: int, fps: Fraction) -> Fraction:
    duration_ts = stream.get("duration_ts")
    time_base = stream.get("time_base")
    if duration_ts not in (None, "N/A") and time_base not in (None, "N/A"):
        try:
            duration = Fraction(int(str(duration_ts))) * Fraction(str(time_base))
            if duration > 0:
                return duration
        except (ValueError, ZeroDivisionError):
            pass
    for candidate in (stream.get("duration"), (payload.get("format") or {}).get("duration") if isinstance(payload.get("format"), Mapping) else None):
        if candidate not in (None, "N/A"):
            try:
                return as_fraction(candidate, "probe_duration")
            except ValueError:
                pass
    return Fraction(frame_count, 1) / fps


def _pts(payload: Mapping[str, Any]) -> list[Fraction]:
    rows = payload.get("frames")
    if not isinstance(rows, list):
        return []
    result: list[Fraction] = []
    for row in rows:
        if not isinstance(row, Mapping):
            return []
        value = row.get("best_effort_timestamp_time", row.get("pts_time"))
        if value in (None, "N/A"):
            return []
        try:
            current = Fraction(str(value))
        except (ValueError, ZeroDivisionError):
            return []
        if result and current <= result[-1]:
            return []
        result.append(current)
    return result


def build_source_timeline(payload: Mapping[str, Any], *, decoded_frame_count: int, continuity: str) -> dict[str, Any]:
    if decoded_frame_count < 1:
        raise ValueError("decoded_frame_count_invalid")
    stream = _stream(payload)
    fps = _fps(stream)
    raw_duration = _duration(payload, stream, decoded_frame_count, fps)
    pts = _pts(payload)
    if len(pts) != decoded_frame_count:
        pts = [Fraction(index, 1) / fps for index in range(decoded_frame_count)]
        pts_source = "derived_from_rational_fps"
    else:
        pts_source = "ffprobe_frame_timestamps"
    if continuity == "loop" and decoded_frame_count > 1:
        semantic_duration = pts[-1] - pts[0]
        terminal_policy = "half_open_exclude_terminal"
    elif continuity == "one_shot":
        semantic_duration = raw_duration
        terminal_policy = "closed_include_terminal"
    else:
        raise ValueError("continuity_must_be_loop_or_one_shot")
    if semantic_duration <= 0:
        raise ValueError("semantic_duration_invalid")
    return {
        "schema_version": "ai_frame_animation_source_timeline_v1",
        "decoded_frame_count": decoded_frame_count,
        "raw_fps": fraction_record(fps),
        "raw_duration_seconds": fraction_record(raw_duration),
        "semantic_duration_seconds": fraction_record(semantic_duration),
        "frame_timestamps_seconds": [fraction_record(item) for item in pts],
        "timestamps_source": pts_source,
        "terminal_policy": terminal_policy,
    }


def build_variant_timeline(source_timeline: Mapping[str, Any], selected_indices: Sequence[int], frame_count: int) -> dict[str, Any]:
    if len(selected_indices) != frame_count:
        raise ValueError("selected_frame_count_mismatch")
    duration_record = source_timeline.get("semantic_duration_seconds")
    if not isinstance(duration_record, Mapping):
        raise ValueError("semantic_duration_missing")
    duration = Fraction(int(duration_record["numerator"]), int(duration_record["denominator"]))
    playback_fps = Fraction(frame_count, 1) / duration
    timestamps = source_timeline.get("frame_timestamps_seconds")
    if not isinstance(timestamps, list):
        raise ValueError("source_timestamps_missing")
    selected_timestamps = [timestamps[index] for index in selected_indices]
    return {
        "source_frame_index_map": list(selected_indices),
        "source_timestamps_seconds": selected_timestamps,
        "playback_fps": fraction_record(playback_fps),
        "semantic_duration_seconds": dict(duration_record),
        "terminal_policy": source_timeline.get("terminal_policy"),
    }
