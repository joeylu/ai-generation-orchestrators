from __future__ import annotations

from pathlib import Path
import shutil

from PIL import Image

from .common import digest, identifier, read_json, require, safe_relative, sha256, write_json
from .contract import validate


def run_location(workspace: Path, run_id: str) -> Path:
    root = workspace.resolve()
    run = (root / "runs" / identifier(run_id)).resolve()
    require(run.is_relative_to(root), "RUN_PATH_ESCAPE")
    return run


def _body_digest(record: dict) -> str:
    return digest({key: value for key, value in record.items() if key != "digest"})


def load(run: Path) -> tuple[dict, dict]:
    batch = read_json(run / "batch.json")
    require(batch.get("kind") == "ai_ui_decomposition_batch_v1"
            and batch.get("digest") == _body_digest(batch), "BATCH_CHANGED")
    plan = read_json(run / "plan.json")
    validate(plan, verify_source=False)
    require(digest(plan) == batch["plan_digest"], "PLAN_CHANGED")
    reference = run / "input" / "reference.png"
    require(reference.is_file() and sha256(reference) == batch["source_sha256"],
            "SOURCE_SNAPSHOT_CHANGED")
    for entry in batch["requests"].values():
        request = safe_relative(run, entry["request"])
        crop = safe_relative(run, entry["crop"])
        prompt = safe_relative(run, entry["prompt"])
        require(sha256(request) == entry["request_sha256"]
                and sha256(crop) == entry["crop_sha256"]
                and sha256(prompt) == entry["prompt_sha256"], "REQUEST_INPUT_CHANGED")
    return batch, plan


def freeze(plan_path: Path, workspace: Path, run_id: str) -> dict:
    plan = read_json(plan_path.resolve())
    plan_base = plan_path.resolve().parent
    summary = validate(plan, source_base=plan_base)
    run = run_location(workspace, run_id)
    require(not run.exists(), "RUN_EXISTS")
    (run / "input").mkdir(parents=True)
    (run / "requests").mkdir()
    write_json(run / "plan.json", plan)
    source_path = safe_relative(plan_base, plan["source"]["path"])
    reference = run / "input" / "reference.png"
    with Image.open(source_path) as image:
        image.convert("RGBA").save(reference)
    source_sha = sha256(reference)
    requests = {}
    order = []
    with Image.open(reference) as image:
        image = image.convert("RGBA")
        for asset in plan["assets"]:
            if not asset["route"].startswith("generated_"):
                continue
            key = asset["id"]
            order.append(key)
            request_id = f"{plan['id']}-{key}-r001"
            directory = run / "requests" / request_id
            directory.mkdir()
            crop = directory / "crop.png"
            image.crop(tuple(asset["source_region"])).save(crop)
            prompt = directory / "prompt.txt"
            prompt_text = _prompt(asset)
            prompt.write_text(prompt_text + "\n", encoding="utf-8")
            request = {"kind": "ai_ui_decomposition_provider_request_v1",
                       "id": request_id, "asset": key,
                       "plan_digest": digest(plan), "prompt": prompt_text,
                       "inputs": ["input/reference.png",
                                  crop.relative_to(run).as_posix()],
                       "input_sha256": [source_sha, sha256(crop)],
                       "planned_calls": 1, "automatic_retries": 0}
            request["digest"] = digest(request)
            request_path = directory / "request.json"
            write_json(request_path, request)
            requests[key] = {"id": request_id,
                             "request": request_path.relative_to(run).as_posix(),
                             "request_sha256": sha256(request_path),
                             "crop": crop.relative_to(run).as_posix(),
                             "crop_sha256": sha256(crop),
                             "prompt": prompt.relative_to(run).as_posix(),
                             "prompt_sha256": sha256(prompt)}
    batch = {"kind": "ai_ui_decomposition_batch_v1", "run_id": run_id,
             "plan_digest": digest(plan), "source_sha256": source_sha,
             "dispatch_order": order, "requests": requests,
             "maximum_calls": len(order), "automatic_retries": 0,
             "provider": None, "provider_invocation_included": False,
             "plan_summary": summary}
    batch["digest"] = digest(batch)
    write_json(run / "batch.json", batch)
    return batch


def _prompt(asset: dict) -> str:
    width, height = asset["output_size"]
    common = (f" Target support ratio is {width}:{height}. Use the full UI reference and exact "
              "crop as style evidence. Do not draw text, numerals, pseudo-text, labels, logos, "
              "or watermarks. Preserve intentional pictograms and graphic symbols.")
    if asset["route"] == "generated_completion":
        return asset["prompt"].strip() + common + " Return one complete opaque UI-free scene."
    return (asset["prompt"].strip() + common
            + " Return exactly one complete component centered on a flat uniform vivid magenta "
              "#F808F8 background. Leave clean margin on every edge and preserve internal holes.")


def state(run: Path, entry: dict) -> str:
    directory = run / "requests" / entry["id"]
    if (directory / "received.json").is_file():
        return "received"
    if (directory / "indeterminate.json").is_file():
        return "indeterminate"
    if (directory / "reserved.json").is_file():
        return "reserved"
    return "prepared"


def reserve(run: Path, asset: str) -> dict:
    batch, _ = load(run)
    asset = identifier(asset)
    require(asset in batch["requests"], "UNKNOWN_REQUEST")
    index = batch["dispatch_order"].index(asset)
    for prior in batch["dispatch_order"][:index]:
        require(state(run, batch["requests"][prior]) in {"received", "indeterminate"},
                "PRIOR_REQUEST_NOT_TERMINAL")
    entry = batch["requests"][asset]
    require(state(run, entry) == "prepared", "REQUEST_ALREADY_STARTED")
    record = {"kind": "ai_ui_decomposition_request_reserved_v1",
              "batch_digest": batch["digest"], "asset": asset,
              "request_id": entry["id"], "request_sha256": entry["request_sha256"],
              "single_use": True, "automatic_retries": 0}
    write_json(run / "requests" / entry["id"] / "reserved.json", record)
    return record


def receive(run: Path, asset: str, source: Path) -> dict:
    batch, _ = load(run)
    asset = identifier(asset)
    require(asset in batch["requests"], "UNKNOWN_REQUEST")
    entry = batch["requests"][asset]
    require(state(run, entry) == "reserved", "RESERVATION_REQUIRED")
    source = source.resolve()
    require(source.is_file(), "RAW_SOURCE_REQUIRED")
    raw = run / "requests" / entry["id"] / "raw.png"
    require(not raw.exists(), "RAW_ALREADY_MATERIALIZED")
    shutil.copyfile(source, raw)
    with Image.open(raw) as image:
        size, mode = list(image.size), image.mode
    record = {"kind": "ai_ui_decomposition_request_received_v1",
              "batch_digest": batch["digest"], "asset": asset,
              "request_id": entry["id"], "raw_sha256": sha256(raw),
              "size": size, "mode": mode, "generation_calls": 1,
              "automatic_retries": 0}
    write_json(raw.parent / "received.json", record)
    return record


def indeterminate(run: Path, asset: str, reason: str) -> dict:
    batch, _ = load(run)
    asset = identifier(asset)
    require(asset in batch["requests"] and reason.strip(), "REQUEST_REASON_REQUIRED")
    entry = batch["requests"][asset]
    require(state(run, entry) == "reserved", "RESERVATION_REQUIRED")
    record = {"kind": "ai_ui_decomposition_request_indeterminate_v1",
              "batch_digest": batch["digest"], "asset": asset,
              "request_id": entry["id"], "reason": reason,
              "automatic_resubmit": False, "automatic_retries": 0}
    write_json(run / "requests" / entry["id"] / "indeterminate.json", record)
    return record


def status(run: Path) -> dict:
    batch, _ = load(run)
    rows = [{"asset": asset, "request_id": batch["requests"][asset]["id"],
             "state": state(run, batch["requests"][asset])}
            for asset in batch["dispatch_order"]]
    counts = {name: sum(row["state"] == name for row in rows)
              for name in ("prepared", "reserved", "received", "indeterminate")}
    return {"kind": "ai_ui_decomposition_batch_status_v1",
            "batch_digest": batch["digest"], "rows": rows, **counts,
            "maximum_calls": batch["maximum_calls"], "automatic_retries": 0}
