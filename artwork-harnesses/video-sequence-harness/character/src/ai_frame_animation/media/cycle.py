from __future__ import annotations

import math
from fractions import Fraction
from typing import Any, Mapping, Sequence

import numpy as np
from PIL import Image

from .timeline import fraction_record


_ANALYSIS_SIZE = (152, 88)
_WINDOW = 2


def _fraction(value: object) -> Fraction:
    if not isinstance(value, Mapping):
        raise ValueError("timeline_fraction_invalid")
    return Fraction(int(value["numerator"]), int(value["denominator"]))


def _analysis_frames(images: Sequence[Image.Image]) -> tuple[list[np.ndarray], list[np.ndarray]]:
    colours: list[np.ndarray] = []
    masks: list[np.ndarray] = []
    for image in images:
        small = image.convert("RGB").resize(_ANALYSIS_SIZE, Image.Resampling.BILINEAR)
        array = np.asarray(small, dtype=np.float32)
        border = np.concatenate((array[0], array[-1], array[:, 0], array[:, -1]), axis=0)
        key = np.median(border, axis=0)
        mask = np.linalg.norm(array - key, axis=2) > 48.0
        subject = array.copy()
        subject[~mask] = 0.0
        colours.append(subject)
        masks.append(mask)
    return colours, masks


def _centroid(mask: np.ndarray) -> tuple[float, float]:
    ys, xs = np.nonzero(mask)
    if len(xs) == 0:
        return 0.5, 0.5
    return float(xs.mean() / mask.shape[1]), float(ys.mean() / mask.shape[0])


def _pose_cost(colours: Sequence[np.ndarray], masks: Sequence[np.ndarray], first: int, second: int) -> float:
    union = masks[first] | masks[second]
    union_count = max(1, int(union.sum()))
    rgb = float(np.abs(colours[first] - colours[second])[union].sum() / (union_count * 3 * 255.0))
    silhouette = float(np.logical_xor(masks[first], masks[second]).sum() / union_count)
    ax, ay = _centroid(masks[first])
    bx, by = _centroid(masks[second])
    centre = math.hypot(ax - bx, ay - by)
    return 0.55 * rgb + 0.35 * silhouette + 0.10 * centre


def _velocity_cost(colours: Sequence[np.ndarray], masks: Sequence[np.ndarray], first: int, second: int) -> float:
    first_velocity = colours[first + 1] - colours[first - 1]
    second_velocity = colours[second + 1] - colours[second - 1]
    union = masks[first - 1] | masks[first + 1] | masks[second - 1] | masks[second + 1]
    count = max(1, int(union.sum()))
    return float(np.abs(first_velocity - second_velocity)[union].sum() / (count * 3 * 510.0))


def _candidate(colours: Sequence[np.ndarray], masks: Sequence[np.ndarray], period: int) -> dict[str, Any]:
    count = len(colours)
    support = [
        _pose_cost(colours, masks, index, index + period)
        for index in range(_WINDOW, count - period - _WINDOW)
    ]
    best: dict[str, Any] | None = None
    for start in range(_WINDOW, count - period - _WINDOW):
        end = start + period
        boundary = float(np.mean([
            _pose_cost(colours, masks, start + offset, end + offset)
            for offset in range(-_WINDOW, _WINDOW + 1)
        ]))
        velocity = _velocity_cost(colours, masks, start, end)
        score = 0.52 * boundary + 0.28 * float(np.mean(support)) + 0.20 * velocity + period * 0.00015
        value = {
            "start_frame_zero_based": start,
            "end_frame_exclusive_zero_based": end,
            "native_frame_count": period,
            "boundary_pose_cost": round(boundary, 9),
            "period_support_cost": round(float(np.mean(support)), 9),
            "velocity_cost": round(velocity, 9),
            "score": round(score, 9),
        }
        if best is None or value["score"] < best["score"]:
            best = value
    if best is None:
        raise ValueError("cycle_candidate_missing")
    return best


def select_semantic_interval(
    images: Sequence[Image.Image], source_timeline: Mapping[str, Any], *, continuity: str
) -> dict[str, Any]:
    """Select one deterministic native interval; atlas capacity is handled later."""

    count = len(images)
    if count < 1:
        raise ValueError("no_source_frames")
    timestamps = source_timeline.get("frame_timestamps_seconds")
    if not isinstance(timestamps, list) or len(timestamps) != count:
        raise ValueError("source_timestamps_missing")
    if continuity == "one_shot":
        duration = _fraction(source_timeline["raw_duration_seconds"])
        return {
            "schema_version": "video_semantic_interval_v1",
            "continuity": continuity,
            "policy": "full_timeline_include_terminal",
            "start_frame_zero_based": 0,
            "end_frame_exclusive_zero_based": count,
            "native_frame_count": count,
            "duration_seconds": fraction_record(duration),
            "candidates": [],
        }
    if continuity != "loop":
        raise ValueError("continuity_must_be_loop_or_one_shot")

    fps = _fraction(source_timeline["raw_fps"])
    minimum = max(8, round(float(fps) * 0.4))
    maximum = min(round(float(fps) * 4.0), count - 2 * _WINDOW - 1)
    candidates: list[dict[str, Any]] = []
    if maximum >= minimum:
        colours, masks = _analysis_frames(images)
        ranked = sorted((_candidate(colours, masks, period) for period in range(minimum, maximum + 1)), key=lambda item: item["score"])
        for item in ranked:
            if all(abs(item["native_frame_count"] - existing["native_frame_count"]) >= 3 for existing in candidates):
                candidates.append(item)
            if len(candidates) == 3:
                break

    if candidates:
        selected = candidates[0]
        start = int(selected["start_frame_zero_based"])
        end = int(selected["end_frame_exclusive_zero_based"])
        policy = "deterministic_pose_cycle_v1"
    else:
        start, end = 0, max(1, count - 1)
        policy = "full_timeline_half_open_fallback"
    start_time = _fraction(timestamps[start])
    if end < count:
        end_time = _fraction(timestamps[end])
    else:
        end_time = _fraction(timestamps[0]) + _fraction(source_timeline["raw_duration_seconds"])
    duration = end_time - start_time
    if duration <= 0:
        raise ValueError("semantic_interval_duration_invalid")
    return {
        "schema_version": "video_semantic_interval_v1",
        "continuity": continuity,
        "policy": policy,
        "start_frame_zero_based": start,
        "end_frame_exclusive_zero_based": end,
        "native_frame_count": end - start,
        "duration_seconds": fraction_record(duration),
        "period_search_frames": [minimum, maximum] if maximum >= minimum else None,
        "candidates": candidates,
    }
