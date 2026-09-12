"""Offline same-state image comparison; never confers human acceptance."""
from pathlib import Path
import math
import numpy as np
from .common import digest, load_verified_image, read_json, require, write_json


def compare_regions(reference: Path, rendered: Path, policy_path: Path, output: Path) -> dict:
    policy = read_json(policy_path)
    require(set(policy) == {"kind", "reference_sha256", "rendered_sha256",
            "reference_state", "rendered_state", "regions"}
            and policy["kind"] == "ai_ui_region_qa_policy_v1", "REGION_QA_POLICY")
    require(isinstance(policy["reference_state"], dict) and policy["reference_state"]
            and policy["reference_state"] == policy["rendered_state"], "REGION_QA_STATE_MISMATCH")
    left, a = load_verified_image(reference)
    right, b = load_verified_image(rendered, a["size"])
    require(a["sha256"] == policy["reference_sha256"]
            and b["sha256"] == policy["rendered_sha256"], "REGION_QA_SOURCE_CHANGED")
    regions = policy["regions"]
    require(isinstance(regions, list) and 0 < len(regions) <= 256, "REGION_QA_REGIONS")
    results, seen = [], set()
    for region in regions:
        require(isinstance(region, dict) and set(region) ==
                {"id", "bounds", "channel_tolerance", "max_bad_fraction"}, "REGION_QA_REGION")
        key = region["id"]
        require(isinstance(key, str) and key and key not in seen, "REGION_QA_DUPLICATE_ID")
        seen.add(key)
        bounds = region["bounds"]
        require(isinstance(bounds, list) and len(bounds) == 4
                and all(type(v) is int for v in bounds), "REGION_QA_BOUNDS")
        x, y, w, h = bounds
        require(x >= 0 and y >= 0 and w > 0 and h > 0
                and x + w <= left.width and y + h <= left.height, "REGION_QA_BOUNDS")
        tolerance, maximum = region["channel_tolerance"], region["max_bad_fraction"]
        require(type(tolerance) is int and 0 <= tolerance <= 255
                and type(maximum) in (int, float) and math.isfinite(maximum)
                and 0 <= maximum <= 1, "REGION_QA_THRESHOLD")
        bad, total_error = 0, 0
        for row in range(y, y + h):
            box = (x, row, x + w, row + 1)
            delta = np.abs(np.asarray(left.crop(box), dtype=np.int16)
                           - np.asarray(right.crop(box), dtype=np.int16))
            bad += int(np.count_nonzero(delta.max(axis=2) > tolerance))
            total_error += int(delta.sum())
        fraction = bad / (w * h)
        results.append({**region, "bad_fraction": fraction,
                        "mean_rgba_error": total_error / (w * h * 4),
                        "passed": fraction <= maximum})
    report = {"kind": "ai_ui_region_qa_result_v1", "policy_digest": digest(policy),
              "reference_sha256": a["sha256"], "rendered_sha256": b["sha256"],
              "state": policy["reference_state"], "regions": results,
              "passed": all(row["passed"] for row in results),
              "human_visual_acceptance": False,
              "coverage": "declared_regions_only", "state_evidence": "caller_declared"}
    report["digest"] = digest(report)
    write_json(output, report)
    require(report["passed"], "REGION_VISUAL_QA_REJECTED")
    return report
