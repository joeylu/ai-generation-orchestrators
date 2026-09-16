"""Bounded exact-image reuse for explicitly identical native Image layers."""
from __future__ import annotations

from pathlib import Path

from .common import require, sha256


VERSION = "1.0"


def is_shared(row: dict) -> bool:
    return "sharedSource" in row


def validate_shared_sources(rows: dict[str, dict], by_id: dict[str, dict],
                            rects: dict[str, list[float]], appearance: dict) -> None:
    """Validate declarations after ordinary material and appearance checks."""
    bindings = {row["componentId"]: row for row in appearance["bindings"]}
    for target_layer, target in rows.items():
        if not is_shared(target):
            continue
        declaration = target["sharedSource"]
        require(isinstance(declaration, dict) and
                set(declaration) == {"version", "sourceLayerId", "evidence"} and
                declaration["version"] == VERSION,
                "NATIVE_SHARED_SOURCE_SCHEMA")
        source_layer = declaration["sourceLayerId"]
        evidence = declaration["evidence"]
        require(isinstance(source_layer, str), "NATIVE_SHARED_SOURCE_REFERENCE")
        require(isinstance(evidence, str) and 1 <= len(evidence) <= 1200 and evidence.strip(),
                "NATIVE_SHARED_SOURCE_EVIDENCE")
        require(source_layer in rows, "NATIVE_SHARED_SOURCE_MISSING")
        require(source_layer != target_layer, "NATIVE_SHARED_SOURCE_SELF")
        source = rows[source_layer]
        require(not is_shared(source), "NATIVE_SHARED_SOURCE_CHAIN")
        require(target["componentType"] == source["componentType"] == "Image",
                "NATIVE_SHARED_SOURCE_IMAGE_ONLY")
        require(target["componentId"] != "background" and source["componentId"] != "background",
                "NATIVE_SHARED_SOURCE_BACKGROUND")
        require(target["rect"][2:] == source["rect"][2:], "NATIVE_SHARED_SOURCE_SIZE")
        require(target["groupId"] == source["groupId"], "NATIVE_SHARED_SOURCE_GROUP")
        # The native envelope binds one ordinary Image layer to each Image
        # component. A state map would make the shared identity conditional.
        for component_id in (target["componentId"], source["componentId"]):
            node = by_id.get(component_id)
            binding = bindings.get(component_id)
            require(node is not None and node["type"] == "Image" and binding is not None,
                    "NATIVE_SHARED_SOURCE_IMAGE_ONLY")
            require(not binding.get("states"), "NATIVE_SHARED_SOURCE_STATE_DISTINCTION")
        # The input Image geometry is the exported resource geometry. Retain
        # this check here as well as the general Image registration check so
        # the reuse contract remains local and reviewable.
        require(target["rect"][2:] == [rects[target["componentId"]][2],
                                       rects[target["componentId"]][3]] and
                source["rect"][2:] == [rects[source["componentId"]][2],
                                       rects[source["componentId"]][3]],
                "NATIVE_SHARED_SOURCE_SIZE")


def generated_rows(parts: list[dict]) -> list[dict]:
    """Return material rows that require an authenticated generated result."""
    return [row for row in parts if not is_shared(row)]


def resolve_paths(parts: list[dict], source_paths: dict[str, Path]) -> dict[str, Path]:
    """Map validated aliases to their direct source extraction paths."""
    roots = {row["layerId"] for row in parts if not is_shared(row)}
    require(set(source_paths) == roots, "NATIVE_SHARED_MATERIAL_PATH_COVERAGE")
    resolved = dict(source_paths)
    for row in parts:
        if not is_shared(row):
            continue
        source = row["sharedSource"]["sourceLayerId"]
        require(source in source_paths, "NATIVE_SHARED_MATERIAL_SOURCE_PATH")
        resolved[row["layerId"]] = source_paths[source]
    require(set(resolved) == {row["layerId"] for row in parts},
            "NATIVE_SHARED_MATERIAL_PATH_COVERAGE")
    return resolved


def shared_map(parts: list[dict], material_paths: dict[str, Path]) -> dict | None:
    """Build a digest-bearing handoff record for exact copied layer bytes."""
    links = []
    for row in parts:
        if not is_shared(row):
            continue
        source_layer = row["sharedSource"]["sourceLayerId"]
        source_path = material_paths[source_layer]
        target_path = material_paths[row["layerId"]]
        source_digest, target_digest = sha256(source_path), sha256(target_path)
        require(source_digest == target_digest, "NATIVE_SHARED_MATERIAL_BYTES_CHANGED")
        links.append({"layerId": row["layerId"], "sourceLayerId": source_layer,
                      "evidence": row["sharedSource"]["evidence"],
                      "sha256": source_digest})
    if not links:
        return None
    return {"kind": "ui_shared_material_map_v1", "version": VERSION,
            "links": links, "generation_calls_for_links": 0,
            "semantic_identity_basis": "explicit_input_evidence"}
