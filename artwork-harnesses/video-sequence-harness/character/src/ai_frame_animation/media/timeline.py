from __future__ import annotations

from fractions import Fraction
from bisect import bisect_right
from typing import Any, Mapping, Sequence


ATLAS_CAPACITIES = {"4x4": 16, "8x4": 32, "8x8": 64}


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
    """Legacy exact-count sampler retained for old decoded-handoff consumers."""
    if frame_count not in ATLAS_CAPACITIES.values():
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


def choose_atlas_indices(start: int, end_exclusive: int, capacity: int, *, continuity: str,
                         timestamps: Sequence[Fraction] | None = None) -> list[int]:
    """Keep every native frame when it fits; otherwise sample without duplication."""

    if start < 0 or end_exclusive <= start:
        raise ValueError("semantic_interval_invalid")
    if capacity not in ATLAS_CAPACITIES.values():
        raise ValueError("atlas_capacity_invalid")
    native_count = end_exclusive - start
    if continuity not in {"loop", "one_shot"}:
        raise ValueError("continuity_must_be_loop_or_one_shot")
    if timestamps is not None:
        if len(timestamps) < end_exclusive or any(b <= a for a, b in zip(timestamps, timestamps[1:])):
            raise ValueError("source_timestamps_invalid")
    if native_count <= capacity:
        return list(range(start, end_exclusive))
    if timestamps is not None:
        pts = timestamps[start:end_exclusive]
        span = pts[-1] - pts[0]
        # Preserve existing CFR rounding, including ffprobe microsecond precision.
        cfr = all(abs(value - (pts[0] + span * i / (native_count - 1))) <= Fraction(1, 100000)
                  for i, value in enumerate(pts))
        if not cfr:
            end_time = timestamps[end_exclusive] if continuity == "loop" and end_exclusive < len(timestamps) else pts[-1]
            selected = []
            for i in range(capacity):
                target = pts[0] + (end_time - pts[0]) * i / (capacity if continuity == "loop" else capacity - 1)
                candidate = max(0, bisect_right(pts, target) - 1)
                if continuity == "one_shot" and candidate + 1 < native_count and pts[candidate + 1] - target < target - pts[candidate]:
                    candidate += 1
                # Reserve a distinct native frame for every remaining sample.
                lower = selected[-1] - start + 1 if selected else 0
                candidate = min(max(candidate, lower), native_count - (capacity - i))
                selected.append(start + candidate)
            return selected
    if continuity == "loop":
        return [start + (index * native_count) // capacity for index in range(capacity)]
    if continuity == "one_shot":
        if capacity == 1:
            return [start]
        return [start + round(index * (native_count - 1) / (capacity - 1)) for index in range(capacity)]
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


def frame_time(row: Mapping[str, Any], stream: Mapping[str, Any], fields: Sequence[str]) -> Fraction | None:
    """Prefer integer ticks; decimal ffprobe fields are only rounded evidence."""
    exact = []
    decimal = []
    for field in fields:
        value = row.get(field)
        if value not in (None, "N/A"):
            if isinstance(value, bool) or not str(value).lstrip("-").isdigit():
                raise ValueError("probe_frame_ticks_invalid")
            exact.append(int(value) * as_fraction(stream.get("time_base"), "probe_time_base"))
        value = row.get(field + "_time")
        if value not in (None, "N/A"):
            if isinstance(value, bool):
                raise ValueError("probe_frame_time_invalid")
            try:
                decimal.append(Fraction(str(value)))
            except (ValueError, ZeroDivisionError) as exc:
                raise ValueError("probe_frame_time_invalid") from exc
    if exact:
        if any(value != exact[0] for value in exact) or any(abs(value - exact[0]) > Fraction(1, 2000000) for value in decimal):
            raise ValueError("probe_frame_time_evidence_mismatch")
        return exact[0]
    return decimal[0] if decimal else None


def _pts(payload: Mapping[str, Any]) -> list[Fraction]:
    rows = payload.get("frames")
    if not isinstance(rows, list):
        return []
    result: list[Fraction] = []
    for row in rows:
        if not isinstance(row, Mapping):
            return []
        try:
            current = frame_time(row, _stream(payload), ("best_effort_timestamp", "pts"))
        except ValueError as exc:
            raise ValueError("probe_frame_timestamps_invalid") from exc
        if current is None:
            return []
        if result and current <= result[-1]:
            return []
        result.append(current)
    return result


def _observed_duration(payload: Mapping[str, Any], stream: Mapping[str, Any], pts: Sequence[Fraction], fps: Fraction) -> Fraction:
    durations = []
    for row in payload["frames"]:
        try:
            value = frame_time(row, stream, ("duration", "pkt_duration"))
        except ValueError as exc:
            raise ValueError("probe_frame_duration_invalid") from exc
        if value is not None and value < 0:
            raise ValueError("probe_frame_duration_invalid")
        durations.append(value or None)
    span = pts[-1] - pts[0]
    if durations[-1] is not None:
        return span + durations[-1]
    intervals = sorted(b - a for a, b in zip(pts, pts[1:]))
    median = intervals[len(intervals) // 2] if intervals else 1 / fps
    candidates = []
    if stream.get("duration_ts") not in (None, "N/A") and stream.get("time_base") not in (None, "N/A"):
        try:
            candidates.append(Fraction(str(stream["duration_ts"])) * Fraction(str(stream["time_base"])))
        except (ValueError, ZeroDivisionError):
            pass
    candidates.append(stream.get("duration"))
    if isinstance(payload.get("format"), Mapping):
        candidates.append(payload["format"].get("duration"))
    for value in candidates:
        try:
            candidate = as_fraction(value, "probe_duration")
        except ValueError:
            continue
        if span < candidate <= span + max(Fraction(1), 4 * median):
            return candidate
    return span + median


def build_source_timeline(payload: Mapping[str, Any], *, decoded_frame_count: int, continuity: str) -> dict[str, Any]:
    if decoded_frame_count < 1:
        raise ValueError("decoded_frame_count_invalid")
    stream = _stream(payload)
    pts = _pts(payload)
    if "frames" in payload and len(pts) != decoded_frame_count:
        raise ValueError("probe_frame_timestamps_invalid")
    try:
        fps = _fps(stream)
    except ValueError:
        if len(pts) < 2:
            raise
        fps = Fraction(len(pts) - 1, 1) / (pts[-1] - pts[0])
    raw_duration = _duration(payload, stream, decoded_frame_count, fps)
    if len(pts) != decoded_frame_count:
        pts = [Fraction(index, 1) / fps for index in range(decoded_frame_count)]
        pts_source = "derived_from_rational_fps"
    else:
        pts_source = "ffprobe_frame_timestamps"
        raw_duration = _observed_duration(payload, stream, pts, fps)
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


def build_variant_timeline(
    source_timeline: Mapping[str, Any], selected_indices: Sequence[int], frame_count: int,
    *, semantic_duration: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    if len(selected_indices) != frame_count:
        raise ValueError("selected_frame_count_mismatch")
    duration_record = semantic_duration or source_timeline.get("semantic_duration_seconds")
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
