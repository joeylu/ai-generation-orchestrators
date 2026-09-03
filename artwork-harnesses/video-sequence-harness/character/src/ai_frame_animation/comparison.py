from __future__ import annotations

import math
from pathlib import Path
from typing import Any, Callable, Mapping

from .canonical import SHA256_RE, load_json, relative_posix, rooted_path, sha256_file
from .validation import validate_delivery


def _delivery_path(root: Path, value: Path) -> Path:
    lexical = value if value.is_absolute() else root / value
    if lexical.is_symlink():
        raise ValueError("comparison_symlink_rejected")
    delivery = rooted_path(root, value, must_exist=True)
    if delivery.is_symlink() or not delivery.is_dir():
        raise ValueError("comparison_delivery_not_directory")
    return delivery


def _inventory(delivery: Path) -> dict[str, dict[str, Any]]:
    entries: dict[str, dict[str, Any]] = {}
    for path in sorted(delivery.rglob("*"), key=lambda item: item.as_posix()):
        if path.is_symlink():
            raise ValueError("comparison_symlink_rejected")
        if path.is_dir():
            continue
        if not path.is_file():
            raise ValueError("comparison_artifact_not_regular")
        relative = path.relative_to(delivery).as_posix()
        entries[relative] = {"bytes": path.stat().st_size, "sha256": sha256_file(path)}
    return entries


def _identity(delivery: Path) -> dict[str, str]:
    manifest_path = delivery / "delivery-manifest.json"
    if manifest_path.is_symlink() or not manifest_path.is_file():
        raise ValueError("comparison_delivery_manifest_missing")
    manifest = load_json(manifest_path)
    plan_sha256 = manifest.get("plan_sha256")
    raw = manifest.get("raw_source")
    raw_sha256 = raw.get("sha256") if isinstance(raw, Mapping) else None
    if not isinstance(plan_sha256, str) or not SHA256_RE.fullmatch(plan_sha256):
        raise ValueError("comparison_plan_digest_invalid")
    if not isinstance(raw_sha256, str) or not SHA256_RE.fullmatch(raw_sha256):
        raise ValueError("comparison_raw_digest_invalid")
    return {"plan_sha256": plan_sha256, "raw_sha256": raw_sha256}


def _compare_inventory(
    baseline: Mapping[str, Mapping[str, Any]],
    candidate: Mapping[str, Mapping[str, Any]],
    include: Callable[[str], bool],
) -> dict[str, Any]:
    baseline_paths = {path for path in baseline if include(path)}
    candidate_paths = {path for path in candidate if include(path)}
    common = baseline_paths & candidate_paths
    changed = sorted(path for path in common if baseline[path] != candidate[path])
    only_baseline = sorted(baseline_paths - candidate_paths)
    only_candidate = sorted(candidate_paths - baseline_paths)
    return {
        "baseline_count": len(baseline_paths),
        "candidate_count": len(candidate_paths),
        "byte_exact": not changed and not only_baseline and not only_candidate,
        "only_baseline": only_baseline,
        "only_candidate": only_candidate,
        "changed": changed,
    }


def _elapsed_comparison(baseline: float | None, candidate: float | None) -> dict[str, float] | None:
    if baseline is None and candidate is None:
        return None
    if baseline is None or candidate is None:
        raise ValueError("comparison_elapsed_pair_required")
    if (
        isinstance(baseline, bool)
        or isinstance(candidate, bool)
        or not math.isfinite(baseline)
        or not math.isfinite(candidate)
        or baseline <= 0
        or candidate <= 0
    ):
        raise ValueError("comparison_elapsed_invalid")
    saved = baseline - candidate
    return {
        "baseline": baseline,
        "candidate": candidate,
        "saved": saved,
        "speedup_multiplier": baseline / candidate,
        "reduction_ratio": saved / baseline,
    }


def compare_deliveries(
    *,
    root: Path,
    baseline: Path,
    candidate: Path,
    policy: str = "strict",
    baseline_elapsed_seconds: float | None = None,
    candidate_elapsed_seconds: float | None = None,
) -> dict[str, Any]:
    """Validate two deliveries then compare their public, deterministic artifacts.

    The optional elapsed values are caller-observed wall-clock measurements. They
    are reported only; no delivery artifact or manifest is modified.
    """

    elapsed = _elapsed_comparison(baseline_elapsed_seconds, candidate_elapsed_seconds)
    resolved_root = root.resolve(strict=True)
    baseline_delivery = _delivery_path(resolved_root, baseline)
    candidate_delivery = _delivery_path(resolved_root, candidate)
    baseline_validation = validate_delivery(baseline_delivery, policy=policy, workspace_root=resolved_root)
    candidate_validation = validate_delivery(candidate_delivery, policy=policy, workspace_root=resolved_root)
    baseline_identity = _identity(baseline_delivery)
    candidate_identity = _identity(candidate_delivery)
    baseline_inventory = _inventory(baseline_delivery)
    candidate_inventory = _inventory(candidate_delivery)

    artifacts = _compare_inventory(baseline_inventory, candidate_inventory, lambda _path: True)
    pngs = _compare_inventory(baseline_inventory, candidate_inventory, lambda path: path.lower().endswith(".png"))
    gifs = _compare_inventory(baseline_inventory, candidate_inventory, lambda path: path.lower().endswith(".gif"))
    delivery_manifests = _compare_inventory(
        baseline_inventory,
        candidate_inventory,
        lambda path: path == "delivery-manifest.json",
    )
    raw_sha256_equal = baseline_identity["raw_sha256"] == candidate_identity["raw_sha256"]
    plan_sha256_equal = baseline_identity["plan_sha256"] == candidate_identity["plan_sha256"]
    identical = raw_sha256_equal and plan_sha256_equal and artifacts["byte_exact"]
    report: dict[str, Any] = {
        "schema_version": "ai_frame_animation_delivery_comparison_v1",
        "status": "identical" if identical else "different",
        "policy": policy,
        "baseline": {
            "delivery": relative_posix(resolved_root, baseline_delivery),
            "validation_status": baseline_validation["status"],
            **baseline_identity,
        },
        "candidate": {
            "delivery": relative_posix(resolved_root, candidate_delivery),
            "validation_status": candidate_validation["status"],
            **candidate_identity,
        },
        "identity": {
            "raw_sha256_equal": raw_sha256_equal,
            "plan_sha256_equal": plan_sha256_equal,
        },
        "artifacts": artifacts,
        "transparent_pngs": pngs,
        "gifs": gifs,
        "delivery_manifest": delivery_manifests,
    }
    if elapsed is not None:
        report["elapsed_seconds"] = elapsed
    return report
