"""Explicit, plan-bound reuse of a completed raw result; never invokes a provider."""
from pathlib import Path
import shutil

from . import batch
from .common import digest, identifier, load_verified_image, read_json, require, sha256, write_json
from .resources import require_keyed_input_limit


def verified_result(run: Path, asset: str) -> tuple[dict, dict, dict, Path]:
    frozen, plan = batch.load(run)
    asset = identifier(asset)
    require(asset in frozen["requests"], "UNKNOWN_REQUEST")
    entry = frozen["requests"][asset]
    state = batch.state(run, entry)
    require(state in {"received", "recovered", "reused"}, "COMPLETED_RESULT_REQUIRED")
    directory = run / "requests" / entry["id"]
    item = next(row for row in plan["assets"] if row["id"] == asset)
    cached = item.get("cached_result")
    require((state == "reused") == (cached is not None), "RESULT_ROUTE_MISMATCH")
    record_name = {"received": "received.json", "recovered": "recovered.json",
                   "reused": "reused.json"}[state]
    record = read_json(directory / record_name)
    kinds = {"received": "ai_ui_decomposition_request_received_v1",
             "recovered": "ai_ui_decomposition_request_recovered_v1",
             "reused": "ai_ui_decomposition_result_reused_v1"}
    require(record.get("kind") == kinds[state]
            and record.get("batch_digest") == frozen["digest"]
            and record.get("asset") == asset and record.get("request_id") == entry["id"],
            "RESULT_BINDING_CHANGED")
    if state in {"received", "recovered"}:
        reservation = read_json(directory / "reserved.json")
        require(reservation.get("kind") == "ai_ui_decomposition_request_reserved_v1"
                and reservation.get("batch_digest") == frozen["digest"]
                and reservation.get("asset") == asset
                and reservation.get("request_id") == entry["id"]
                and reservation.get("request_sha256") == entry["request_sha256"]
                and reservation.get("single_use") is True, "RESERVATION_CHANGED")
        require(record.get("generation_calls") == 1, "RESULT_CALL_COUNT")
        if state == "recovered":
            indeterminate = read_json(directory / "indeterminate.json")
            require(record.get("explicit_operator_recovery") is True
                    and record.get("automatic_resubmit") is False
                    and record.get("indeterminate_sha256") == sha256(directory / "indeterminate.json")
                    and indeterminate.get("kind") == "ai_ui_decomposition_request_indeterminate_v1",
                    "RECOVERY_BINDING_CHANGED")
    else:
        require(record.get("digest") == digest({k: v for k, v in record.items() if k != "digest"}),
                "REUSED_RESULT_CHANGED")
        require(record.get("source") == cached and record.get("generation_calls") == 0
                and not (directory / "reserved.json").exists(), "REUSED_RESULT_BINDING")
    raw = directory / "raw.png"
    _picture, evidence = load_verified_image(raw)
    if item["output_mode"] == "keyed_component":
        require_keyed_input_limit(evidence["size"])
    require(record.get("raw_sha256") == evidence["sha256"], "RAW_RESULT_CHANGED")
    for key in ("size", "mode", "bytes", "alpha_extrema"):
        require(record.get(key) == evidence[key], "RESULT_EVIDENCE_CHANGED")
    if cached:
        require(cached["raw_sha256"] == evidence["sha256"], "CACHED_RAW_CHANGED")
    return frozen, item, record, raw


def result_binding(run: Path, asset: str) -> dict:
    frozen, _item, record, _raw = verified_result(run, asset)
    require(record["kind"] == "ai_ui_decomposition_request_received_v1", "ORIGINAL_RESULT_REQUIRED")
    request = read_json(run / frozen["requests"][asset]["request"])
    return {"source_batch_digest": frozen["digest"], "source_request_digest": request["digest"],
            "raw_sha256": record["raw_sha256"]}


def reuse_result(run: Path, asset: str, source_run: Path, source_asset: str) -> dict:
    frozen, plan = batch.load(run)
    asset = identifier(asset)
    require(asset in frozen["requests"], "UNKNOWN_REQUEST")
    entry = frozen["requests"][asset]
    require(batch.state(run, entry) == "prepared", "REQUEST_ALREADY_STARTED")
    target = next(item for item in plan["assets"] if item["id"] == asset)
    require("cached_result" in target, "CACHED_RESULT_REQUIRED")
    source_frozen, source, prior, raw = verified_result(source_run, source_asset)
    require(prior["kind"] == "ai_ui_decomposition_request_received_v1", "ORIGINAL_RESULT_REQUIRED")
    source_request = read_json(source_run / source_frozen["requests"][source_asset]["request"])
    binding = {"source_batch_digest": source_frozen["digest"],
               "source_request_digest": source_request["digest"], "raw_sha256": prior["raw_sha256"]}
    require(target["cached_result"] == binding, "CACHED_SOURCE_MISMATCH")
    require(frozen["source_sha256"] == source_frozen["source_sha256"], "CACHED_REFERENCE_MISMATCH")
    # Resize, node positions and groups are post-processing. Generation semantics
    # (including requested dimensions) must be identical to the original request.
    for key in ("role", "route", "source_region", "output_size", "output_mode", "prompt", "source_asset"):
        require(target[key] == source[key], "CACHED_GENERATION_MISMATCH")
    directory = run / "requests" / entry["id"]
    destination = directory / "raw.png"
    require(not destination.exists(), "RAW_ALREADY_MATERIALIZED")
    with raw.open("rb") as src, destination.open("xb") as dst:
        shutil.copyfileobj(src, dst)
    require(sha256(destination) == binding["raw_sha256"], "CACHED_COPY_CHANGED")
    record = {"kind": "ai_ui_decomposition_result_reused_v1", "batch_digest": frozen["digest"],
              "asset": asset, "request_id": entry["id"], "source": binding,
              "raw_sha256": binding["raw_sha256"], "generation_calls": 0, "automatic_retries": 0,
              **{key: prior[key] for key in ("size", "mode", "bytes", "alpha_extrema")}}
    record["digest"] = digest(record)
    write_json(directory / "reused.json", record)
    return record
