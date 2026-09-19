"""Read-only call-budget diagnostics for UI asset plans.

This module deliberately stops at reporting.  It does not rewrite a plan,
compile a board, authorize a batch, or claim that same-sized components are
semantically compatible.  A caller may review the returned candidates before
choosing to make a new, explicit board-grouping decision.
"""
from __future__ import annotations

from collections import defaultdict
import re

from .assets_brief import packing_canvas
from .component_boards import plan_boards
from .common import ContractError, digest, require


KIND = "ui_assets_budget_review_v1"
GROUP_KIND = "ui_assets_board_groups_v1"
_SHA256 = re.compile(r"[0-9a-f]{64}")


def _is_sha256(value: object) -> bool:
    return isinstance(value, str) and _SHA256.fullmatch(value) is not None


def _plan_index(plan: dict) -> tuple[dict[str, dict], list[dict], str]:
    """Validate the small plan surface needed by this read-only diagnostic."""
    require(isinstance(plan, dict), "BUDGET_PLAN_FIELDS")
    assets = plan.get("assets")
    nodes = plan.get("nodes")
    source = plan.get("source")
    require(isinstance(assets, list), "BUDGET_PLAN_ASSETS")
    require(isinstance(nodes, list), "BUDGET_PLAN_NODES")
    require(isinstance(source, dict) and _is_sha256(source.get("sha256")),
            "BUDGET_PLAN_SOURCE")

    index: dict[str, dict] = {}
    for asset in assets:
        require(isinstance(asset, dict) and isinstance(asset.get("id"), str)
                and asset["id"], "BUDGET_ASSET_FIELDS")
        key = asset["id"]
        require(key not in index, "BUDGET_DUPLICATE_ASSET")
        index[key] = asset
    return index, nodes, source["sha256"]


def _valid_group(row: object, index: dict[str, dict], used: set[str],
                 group_ids: set[str]) -> tuple[str, list[str]]:
    """Validate one declared board without changing the plan or board file."""
    require(isinstance(row, dict) and set(row) == {
            "id", "assetIds", "packingCanvas", "extractionPolicy"},
            "BUDGET_GROUP_FIELDS")
    group_id = row.get("id")
    ids = row.get("assetIds")
    require(isinstance(group_id, str) and group_id and group_id not in group_ids,
            "BUDGET_GROUP_ID")
    require(isinstance(ids, list) and 2 <= len(ids) <= 16 and
            all(isinstance(i, str) for i in ids), "BUDGET_GROUP_MEMBERS")
    require(len(set(ids)) == len(ids), "BUDGET_GROUP_MEMBER_DUPLICATE")
    require(all(i in index for i in ids), "BUDGET_GROUP_MEMBER_UNKNOWN")
    require(not any(i in used for i in ids), "BUDGET_GROUP_MEMBER_DUPLICATE")

    members = [index[i] for i in ids]
    # The public board contract only groups pending keyed important components.
    require(not any(a.get("role") != "important_component" or
                    not str(a.get("route", "")).startswith("generated_") or
                    a.get("output_mode") != "keyed_component" or
                    "cached_result" in a or "resize" in a for a in members),
            "BUDGET_GROUP_MEMBER_UNSUPPORTED")
    sizes = [a.get("output_size") for a in members]
    require(not any(not isinstance(size, list) or len(size) != 2 or
                    any(type(value) is not int for value in size)
                    for size in sizes), "BUDGET_GROUP_SIZE")
    # Existing public boards are not limited to the compact compiler's canvas
    # search profile. Validate their actual canvas below, without repacking it.
    require(all(min(s[k] for s in sizes)>0 and
                max(s[k] for s in sizes)<=2*min(s[k] for s in sizes) for k in (0,1)),
            "ASSET_BOARD_SIMILAR_SIZE_REQUIRED")
    require(isinstance(row.get("packingCanvas"), list), "BUDGET_GROUP_CANVAS")
    require(isinstance(row.get("extractionPolicy"), dict), "BUDGET_GROUP_POLICY")
    observations = dict(
        kind="ai_ui_material_observations_v2",
        strategy="component-family-board-v1",
        packing_canvas=row["packingCanvas"],
        extraction_policy=row["extractionPolicy"],
        assets=[dict(id=i, component_type="Image", component_group=group_id,
                     target_size=list(index[i]["output_size"]),
                     source_reusable=False, source_evidence="") for i in ids],
    )
    try:
        plan_boards(observations)
    except (ContractError, TypeError, KeyError, ValueError) as exc:
        raise ContractError("BUDGET_GROUP_INVALID") from exc
    return group_id, ids


def _balanced_chunks(values: list[str], maximum: int = 16) -> list[list[str]]:
    """Split a same-sized family into 2..16 member chunks without a singleton."""
    count = len(values)
    require(count >= 2, "BUDGET_CANDIDATE_SIZE")
    chunk_count = (count + maximum - 1) // maximum
    # For a family of at least two, ceil(n/16) is never greater than n/2, so
    # every balanced chunk remains a valid board candidate.
    base, remainder = divmod(count, chunk_count)
    chunks: list[list[str]] = []
    cursor = 0
    for ordinal in range(chunk_count):
        size = base + (1 if ordinal < remainder else 0)
        chunks.append(values[cursor:cursor + size])
        cursor += size
    return chunks


def _candidate_chunks(ids: list[str], index: dict[str, dict]) -> list[list[str]]:
    """Return packer-admitted candidate chunks, or an empty list."""
    chunks = _balanced_chunks(ids)
    for chunk in chunks:
        sizes = [index[key]["output_size"] for key in chunk]
        try:
            packing_canvas(sizes)
        except (ContractError, TypeError, KeyError, ValueError):
            return []
    return chunks


def _validate_previous(previous: object, source_sha256: str) -> int:
    require(isinstance(previous, dict), "BUDGET_PREVIOUS_FIELDS")
    require(previous.get("kind") == KIND, "BUDGET_PREVIOUS_KIND")
    require(previous.get("digest") == digest({k: v for k, v in previous.items()
                                               if k != "digest"}),
            "BUDGET_PREVIOUS_CHANGED")
    require(previous.get("sourceSha256") == source_sha256,
            "BUDGET_PREVIOUS_SOURCE_CHANGED")
    require(_is_sha256(previous.get("planDigest")) and
            _is_sha256(previous.get("groupsDigest")),
            "BUDGET_PREVIOUS_BINDING")
    calls = previous.get("plannedCalls")
    require(type(calls) is int and calls >= 0, "BUDGET_PREVIOUS_CALLS")
    return calls


def review_budget(plan: dict, groups: dict, previous: dict | None = None) -> dict:
    """Return a digest-bound, non-mutating call-budget review.

    ``plannedCalls`` counts pending generated assets and subtracts one call for
    every additional member of a verified board group.  Candidates are only
    suggestions for currently ungrouped, same-sized keyed components.  They
    are intentionally absent from that count because this function never
    applies them to the supplied plan or group specification.
    """
    index, nodes, source_sha256 = _plan_index(plan)
    require(isinstance(groups, dict) and groups.get("kind") == GROUP_KIND,
            "BUDGET_GROUPS_KIND")
    rows = groups.get("groups")
    require(isinstance(rows, list), "BUDGET_GROUPS_FIELDS")

    verified_groups: list[tuple[str, list[str]]] = []
    used: set[str] = set()
    group_ids: set[str] = set()
    for ordinal, row in enumerate(rows):
        result = _valid_group(row, index, used, group_ids)
        group_id, ids = result
        verified_groups.append((group_id, ids))
        group_ids.add(group_id)
        used.update(ids)

    warnings: list[str] = []

    # A cached result is already received and therefore does not consume a new
    # planned image call.  This mirrors contract.validate's generated_requests.
    pending_generated = [a for a in index.values()
                         if str(a.get("route", "")).startswith("generated_")
                         and "cached_result" not in a]
    planned_calls = len(pending_generated) - sum(len(ids) - 1
                                                for _group_id, ids in verified_groups)
    require(planned_calls >= 0, "BUDGET_CALL_COUNT")

    # Preserve plan order inside each size family so the report remains stable
    # and reviewable.  Members already assigned to a verified board are not
    # candidates, even if a family of the same size exists elsewhere.
    families: dict[tuple[int, int], list[str]] = defaultdict(list)
    for asset in index.values():
        if asset["id"] in used or "cached_result" in asset:
            continue
        if (asset.get("role") != "important_component" or
                not str(asset.get("route", "")).startswith("generated_") or
                asset.get("output_mode") != "keyed_component" or
                "resize" in asset):
            continue
        size = asset.get("output_size")
        if (isinstance(size, list) and len(size) == 2 and
                all(type(value) is int and value > 0 for value in size)):
            families[(size[0], size[1])].append(asset["id"])

    candidates: list[dict] = []
    for ids in families.values():
        if len(ids) < 2:
            continue
        for chunk in _candidate_chunks(ids, index):
            candidates.append(dict(assetIds=chunk, savedCalls=len(chunk) - 1))

    previous_calls = None
    change = None
    if previous is not None:
        previous_calls = _validate_previous(previous, source_sha256)
        change = planned_calls - previous_calls
        if change > 0:
            warnings.append("PLANNED_CALLS_INCREASED_FROM_PREVIOUS")
        elif change < 0:
            warnings.append("PLANNED_CALLS_DECREASED_FROM_PREVIOUS")

    report = dict(kind=KIND, status="review_required", sourceSha256=source_sha256,
                  planDigest=digest(plan), groupsDigest=digest(groups),
                  plannedCalls=planned_calls, finalLayers=len(nodes),
                  candidates=candidates, previousCalls=previous_calls,
                  change=change, warnings=warnings, generationCalls=0,
                  automaticSemanticInference=False)
    report["digest"] = digest(report)
    return report


__all__ = ["KIND", "GROUP_KIND", "review_budget"]
