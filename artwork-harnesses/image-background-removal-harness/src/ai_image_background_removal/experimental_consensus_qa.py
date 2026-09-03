"""Experimental deterministic QA over three already-produced foregrounds.

This module never invokes a provider.  It can reject divergent masks, but it
cannot prove semantic correctness or select a non-primary candidate.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any, Mapping

import numpy as np
from PIL import Image

from .canonical import relative_posix, rooted_path, stamp_document, write_json_atomic
from .fal_provider import DEFAULT_PROFILE_ID
from .handoff import load_preparation_handoff
from .preparation import load_preparation


SCHEMA_VERSION = "ai_image_background_removal_consensus_qa_experimental_v1"
POLICY_ID = "triple_profile_source_alpha_consensus_r1"
LIGHT_2K_PROFILE = "general_light_2k_2048_refined_foreground_v1"
MATTING_PROFILE = "matting_2048_refined_foreground_v1"
ALPHA_BINARY_THRESHOLD = 128
MIN_PRIMARY_LIGHT_2K_IOU = 0.95
MIN_PRIMARY_MATTING_IOU = 0.80


def _candidate(
    root: Path, value: str | Path, *, role: str, expected_profile: str
) -> tuple[dict[str, Any], dict[str, Any], np.ndarray]:
    handoff = load_preparation_handoff(root, value)
    preparation = load_preparation(root, handoff["preparation_report"]["path"])
    segmentation = preparation.get("segmentation")
    if (
        not isinstance(segmentation, Mapping)
        or segmentation.get("backend") != "external_foreground_v1"
        or segmentation.get("execution") != "remote"
        or segmentation.get("profile") != expected_profile
    ):
        raise ValueError("experimental_consensus_qa_profile_mismatch")
    cutout_path = rooted_path(root, preparation["cutout"]["path"], must_exist=True)
    try:
        with Image.open(cutout_path) as opened:
            alpha = np.asarray(opened.convert("RGBA"), dtype=np.uint8)[..., 3].copy()
    except OSError as exc:
        raise ValueError("experimental_consensus_qa_foreground_invalid") from exc
    return {
        "role": role,
        "profile": expected_profile,
        "handoff_sha256": handoff["handoff_sha256"],
        "preparation_sha256": preparation["preparation_sha256"],
        "cutout": dict(preparation["cutout"]),
        "foreground": dict(handoff["foreground"]),
        "warnings": list(preparation["quality"]["warnings"]),
    }, dict(handoff["source"]), alpha


def _binary_iou(left: np.ndarray, right: np.ndarray) -> float:
    left_binary = left >= ALPHA_BINARY_THRESHOLD
    right_binary = right >= ALPHA_BINARY_THRESHOLD
    union = int(np.count_nonzero(left_binary | right_binary))
    if union == 0:
        raise ValueError("experimental_consensus_qa_empty_masks")
    return float(np.count_nonzero(left_binary & right_binary) / union)


def run_consensus_qa(
    *,
    root: Path,
    primary_handoff: str | Path,
    light_2k_handoff: str | Path,
    matting_handoff: str | Path,
    out: str | Path,
) -> dict[str, Any]:
    """Write one immutable experimental decision over three verified handoffs."""

    root = root.resolve(strict=True)
    output = rooted_path(root, out)
    if output == root or output.suffix.lower() != ".json":
        raise ValueError("experimental_consensus_qa_output_invalid")
    if output.exists():
        raise ValueError("experimental_consensus_qa_output_exists")

    primary, primary_source, primary_alpha = _candidate(
        root, primary_handoff, role="primary", expected_profile=DEFAULT_PROFILE_ID
    )
    light_2k, light_2k_source, light_2k_alpha = _candidate(
        root, light_2k_handoff, role="light_2k", expected_profile=LIGHT_2K_PROFILE
    )
    matting, matting_source, matting_alpha = _candidate(
        root, matting_handoff, role="matting", expected_profile=MATTING_PROFILE
    )
    candidates = [primary, light_2k, matting]
    if any(candidate["foreground"]["media_type"] != "image" for candidate in candidates):
        raise ValueError("experimental_consensus_qa_foreground_invalid")
    source_values = [primary_source, light_2k_source, matting_source]
    if light_2k_source != primary_source or matting_source != primary_source:
        raise ValueError("experimental_consensus_qa_source_mismatch")
    if light_2k_alpha.shape != primary_alpha.shape or matting_alpha.shape != primary_alpha.shape:
        raise ValueError("experimental_consensus_qa_size_mismatch")

    primary_light_2k_iou = _binary_iou(primary_alpha, light_2k_alpha)
    primary_matting_iou = _binary_iou(primary_alpha, matting_alpha)
    reasons: list[str] = []
    if primary_light_2k_iou < MIN_PRIMARY_LIGHT_2K_IOU:
        reasons.append("primary_light_2k_mask_divergence")
    if primary_matting_iou < MIN_PRIMARY_MATTING_IOU:
        reasons.append("primary_matting_mask_divergence")
    passed = not reasons

    document: dict[str, Any] = {
        "schema_version": SCHEMA_VERSION,
        "release_status": "experimental",
        "policy": {
            "id": POLICY_ID,
            "comparison_space": "source_coordinate_cutout_alpha",
            "alpha_binary_threshold": ALPHA_BINARY_THRESHOLD,
            "minimum_primary_light_2k_iou": MIN_PRIMARY_LIGHT_2K_IOU,
            "minimum_primary_matting_iou": MIN_PRIMARY_MATTING_IOU,
            "semantic_correctness_guaranteed": False,
        },
        "source": source_values[0],
        "candidates": candidates,
        "measurements": {
            "primary_light_2k_binary_iou": round(primary_light_2k_iou, 6),
            "primary_matting_binary_iou": round(primary_matting_iou, 6),
        },
        "status": "passed" if passed else "rejected",
        "decision": "accept_primary" if passed else "reject",
        "reasons": reasons,
        "selected_foreground": dict(primary["foreground"]) if passed else None,
        "network_probe": "not_performed",
        "provider_compute": "not_performed",
        "gpu_compute": "not_performed",
    }
    report = stamp_document(document, "qa_sha256")
    write_json_atomic(output, report)
    return {**report, "report_path": relative_posix(root, output)}
