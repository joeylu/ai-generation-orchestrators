"""Fixed stages with immutable evidence and separate cloud compute authorizations."""
from __future__ import annotations

import shutil
import time
import uuid
import io
from pathlib import Path

from jsonschema import Draft202012Validator
from PIL import Image, ImageOps

from . import cloud_mcp, reference as preparation
from .media import (board, build_alignment_preview, build_candidate, validate_alignment_preview,
                    validate_candidate, validate_review_bundle, clean_zero_rgb)
from .planning import PRIVATE, image_info, load_plan, reference_path, run_dir, workspace
from .storage import (HarnessError, contained, digest, lock, new_id, publish_staged, read, require,
                      save, seal, sha, token, unseal, write_new_bytes)

REVIEW_CHECKS = {
    "reference": preparation.CHECKS,
    "raw": ["identity", "sixteen_complete_cells", "pose_order", "no_crop_or_cross_cell_leak"],
    "candidate": ["identity", "action_readability", "pose_order", "loop_or_terminal_pose",
                  "all_instances_preserved", "interior_holes_and_soft_materials", "edge_quality",
                  "scale_and_anchor"],
}


def operation_kind(operation: str) -> str:
    return {"generate": "raw", "matte": "matte", "reference-matte": "reference"}[operation]


def validate_image(root: Path, path: Path, plan: dict, kind: str):
    if kind == "reference":
        return preparation.validate_foreground(path, plan["original_reference"])
    if kind == "raw":
        return board(path, None, transparent=False)
    raw_path, _ = artifact(root, plan, "raw")
    with Image.open(raw_path) as raw:
        expected = raw.size
    return board(path, expected, transparent=True)


def reference_foreground(root: Path, plan: dict) -> Path:
    require(plan["reference_preparation"] is None, "reference_use_preparation_draft")
    if plan["reference_needs_cloud_matte"] or (run_dir(root, plan) / "reference-receipt.json").exists():
        return artifact(root, plan, "reference")[0]
    source = reference_path(root, plan)
    preparation.validate_foreground(source, plan["original_reference"])
    return source


def prepare_reference(root: Path, plan_id: str) -> dict:
    """Canonicalize an existing cutout only; never remove any background locally."""
    plan = load_plan(root, plan_id)
    require(plan["reference_preparation"] is None, "reference_use_preparation_draft")
    require(not plan["reference_needs_cloud_matte"], "reference_cloud_matte_required")
    with lock(run_dir(root, plan)):
        if (run_dir(root, plan) / "reference-receipt.json").exists():
            return artifact(root, plan, "reference")[1]
        source = reference_path(root, plan)
        require(preparation.has_exterior_transparency(source), "reference_foreground_invalid")
        with Image.open(source) as image:
            im = clean_zero_rgb(ImageOps.exif_transpose(image).convert("RGBA"))
        buffer = io.BytesIO()
        im.save(buffer, format="PNG")
        return store_image(root, plan, "reference", buffer.getvalue(),
                           {"origin": "existing_cutout", "source_sha256": sha(source)})


def artifact(root: Path, plan: dict, kind: str) -> tuple[Path, dict]:
    directory = run_dir(root, plan)
    path = contained(root, directory / f"{kind}.png")
    record = read(contained(root, directory / f"{kind}-receipt.json"))
    unseal(record)
    require(record["plan_digest"] == plan["digest"] and record["sha256"] == sha(path)
            and record["bytes"] == path.stat().st_size, "source_evidence_mismatch")
    validate_image(root, path, plan, kind)
    if kind == "reference":
        require(record["source_sha256"] == plan["original_reference"]["sha256"], "reference_source_mismatch")
    if kind == "matte":
        _, raw_record = artifact(root, plan, "raw")
        require(record["source_sha256"] == raw_record["sha256"], "matte_source_mismatch")
    return path, record


def store_image(root: Path, plan: dict, kind: str, data: bytes, provenance: dict) -> dict:
    directory = run_dir(root, plan)
    directory.mkdir(parents=True, exist_ok=True)
    target = contained(root, directory / f"{kind}.png")
    receipt_path = contained(root, directory / f"{kind}-receipt.json")
    require(not target.exists() and not receipt_path.exists(), "source_already_exists")
    staging = contained(root, directory / (".image-" + new_id() + ".png"))
    write_new_bytes(staging, data)
    validate_image(root, staging, plan, kind)
    record = seal({"schema": "character_source_receipt_v1", "plan_digest": plan["digest"],
                   "sha256": sha(staging), "bytes": staging.stat().st_size, **provenance})
    publish_staged(staging, target)
    save(receipt_path, record)
    return record


def import_raw(root: Path, plan_id: str, path: Path) -> dict:
    plan = load_plan(root, plan_id)
    require(plan["reference_preparation"] is not None, "review_reference_then_replan_required")
    source = contained(root, path)
    board(source, None, transparent=False)
    with lock(run_dir(root, plan)):
        return store_image(root, plan, "raw", source.read_bytes(), {"origin": "imported_existing_image"})


def review_target(root: Path, plan: dict, stage: str) -> str:
    require(stage in REVIEW_CHECKS, "review_stage_invalid")
    if stage == "reference":
        return sha(reference_foreground(root, plan))
    if stage == "raw":
        _, receipt = artifact(root, plan, "raw")
        return receipt["sha256"]
    directory = contained(root, run_dir(root, plan) / "candidate")
    candidate = read(contained(root, directory / "candidate.json"))
    validate_candidate(directory, candidate, plan)
    _, raw = artifact(root, plan, "raw")
    _, matte = artifact(root, plan, "matte")
    require(candidate["raw_sha256"] == raw["sha256"] and candidate["matte_sha256"] == matte["sha256"],
            "candidate_sources_stale")
    return candidate["digest"]


def review(root: Path, plan_id: str, stage: str, decision: str, reviewer: str, note: str,
           checks: list[str]) -> dict:
    plan = load_plan(root, plan_id)
    require(decision in {"approved", "rejected"}, "review_decision_invalid")
    require(bool(reviewer.strip()) and bool(note.strip()), "review_identity_and_note_required")
    require(len(reviewer) <= 200 and len(note) <= 4000, "review_text_too_long")
    require(stage in REVIEW_CHECKS, "review_stage_invalid")
    if decision == "approved":
        require(sorted(checks) == sorted(REVIEW_CHECKS[stage]), "review_checks_incomplete")
    directory = run_dir(root, plan)
    with lock(directory):
        target = review_target(root, plan, stage)
        result = seal({"schema": "character_visual_review_v1", "plan_digest": plan_id,
                       "target_digest": target, "stage": stage, "decision": decision,
                       "reviewer": reviewer, "note": note, "checks": sorted(checks)})
        save(contained(root, directory / f"{stage}-review.json"), result)
        if stage == "reference" and decision == "approved":
            preparation.publish(root, plan, reference_foreground(root, plan), result)
    return result


def approved_review(root: Path, plan: dict, stage: str) -> dict:
    review_path = contained(root, run_dir(root, plan) / f"{stage}-review.json")
    require(review_path.exists(), "visual_review_required")
    record = read(review_path)
    unseal(record)
    require(record["decision"] == "approved" and record["stage"] == stage
            and record["plan_digest"] == plan["digest"]
            and record["target_digest"] == review_target(root, plan, stage)
            and record["checks"] == sorted(REVIEW_CHECKS[stage]), "visual_review_not_approved_or_stale")
    return record


def import_matte(root: Path, plan_id: str, handoff_path: Path) -> dict:
    """A producer-authored handoff imports cloud output; never asserts a local cloud call."""
    plan = load_plan(root, plan_id)
    handoff = read(contained(root, handoff_path))
    require(set(handoff) == {"schema", "source_sha256", "result", "producer"}
            and handoff["schema"] == "cloud_matte_handoff_v1", "cloud_handoff_invalid")
    require(handoff["producer"] == {"kind": "cloud_mcp"}, "cloud_handoff_producer_invalid")
    require(set(handoff["result"]) == {"path", "sha256", "bytes"}, "cloud_handoff_result_invalid")
    with lock(run_dir(root, plan)):
        approved_review(root, plan, "raw")
        _, raw = artifact(root, plan, "raw")
        require(handoff["source_sha256"] == raw["sha256"], "cloud_handoff_source_mismatch")
        source = contained(root, handoff["result"]["path"])
        require(sha(source) == handoff["result"]["sha256"]
                and source.stat().st_size == handoff["result"]["bytes"], "cloud_handoff_result_mismatch")
        return store_image(root, plan, "matte", source.read_bytes(), {
            "origin": "imported_cloud_handoff", "source_sha256": raw["sha256"],
            "handoff_digest": digest(handoff)})


def config_at(root: Path, path: Path, operation: str) -> dict:
    private = contained(root, PRIVATE)
    value = read(contained(private, path if path.is_absolute() else root / path))
    return cloud_mcp.validate_config(value, operation)


def binding(root: Path, plan: dict, operation: str, config: dict) -> dict:
    require(operation in cloud_mcp.TOOLS, "operation_invalid")
    if operation == "generate":
        require(plan["reference_preparation"] is not None, "review_reference_then_replan_required")
        source = reference_path(root, plan)
        reviewed = None
    elif operation == "reference-matte":
        require(plan["reference_preparation"] is None, "reference_use_preparation_draft")
        require(plan["reference_needs_cloud_matte"], "reference_already_cutout_review_and_replan")
        source = reference_path(root, plan)
        reviewed = None
    else:
        source, _ = artifact(root, plan, "raw")
        reviewed = approved_review(root, plan, "raw")["digest"]
    return {"plan_digest": plan["digest"], "operation": operation, "input_sha256": sha(source),
            "raw_review_digest": reviewed, "config_digest": digest(config)}


def attempts(root: Path, plan: dict, operation: str) -> list[Path]:
    directory = contained(root, run_dir(root, plan) / "attempts")
    if not directory.exists():
        return []
    result = []
    for item in directory.iterdir():
        item = contained(root, item)
        if item.is_dir() and (item / "submission.json").exists():
            sub = read(contained(root, item / "submission.json"), 64 * 1024 * 1024)
            if sub["binding"]["operation"] == operation:
                result.append(item)
    return sorted(result, key=lambda p: read(p / "submission.json", 64 * 1024 * 1024)["created_at"])


def authorize(root: Path, plan_id: str, operation: str, config_path: Path,
              confirm: bool, retry_after: str | None = None) -> dict:
    require(confirm, "explicit_compute_confirmation_required")
    plan = load_plan(root, plan_id)
    config = config_at(root, config_path, operation)
    directory = run_dir(root, plan)
    with lock(directory):
        previous = attempts(root, plan, operation)
        if previous:
            latest = previous[-1]
            terminal = latest / "terminal.json"
            require(not (latest / "receipt.json").exists() or terminal.exists(), "prior_task_pending")
            require(retry_after == latest.name, "fresh_user_retry_decision_required")
        target = operation_kind(operation)
        require(not (directory / f"{target}.png").exists(), "source_already_exists")
        now = int(time.time())
        record = seal({"schema": "character_compute_authorization_v1", "id": new_id(),
                       "binding": binding(root, plan, operation, config), "created_at": now,
                       "expires_at": now + 3600, "retry_after": retry_after})
        save(contained(root, directory / "authorizations" / (record["id"] + ".json")), record)
        return record


def consume_task_result(root: Path, plan: dict, operation: str, attempt_id: str, attempt_dir: Path,
                        submission: dict, result: dict, *, require_submission_id: bool) -> dict:
    """Persist one task observation and terminal output from either submit or poll."""
    directory = run_dir(root, plan)
    status = result.get("structuredContent", {})
    receipt_path = attempt_dir / "receipt.json"
    task_id = str(uuid.UUID(status.get("taskId", "")))
    if require_submission_id or "submissionId" in status:
        require(status.get("submissionId") == submission["arguments"]["submissionId"],
                "mcp_submission_id_mismatch")
    state = status.get("status")
    require(state in {"queued", "running", "completed", "failed"}, "mcp_task_status_invalid")
    delay = status.get("pollAfterSeconds", 5)
    require(type(delay) in {int, float} and 0 <= delay <= 3600, "mcp_poll_delay_invalid")
    if not receipt_path.exists():
        receipt = seal({"task_id": task_id, "submission_digest": submission["digest"],
                        "poll_after_seconds": delay, "received_at": time.time()})
        save(receipt_path, receipt)
    else:
        receipt = read(receipt_path)
        unseal(receipt)
        require(receipt["task_id"] == task_id and receipt["submission_digest"] == submission["digest"],
                "task_receipt_stale")
        observations_dir = contained(root, attempt_dir / "observations")
        observations_dir.mkdir(exist_ok=True)
        observations = sorted(observations_dir.glob("*.json"))
        save(observations_dir / f"{len(observations):06d}.json",
             {"status": state, "received_at": time.time(), "poll_after_seconds": delay})
    if state in {"queued", "running"}:
        return {"status": state, "attempt_id": attempt_id, "poll_after_seconds": delay}
    terminal = attempt_dir / "terminal.json"
    if state == "failed":
        record = {"status": "failed", "code": "cloud_task_failed"}
    else:
        try:
            data, metadata = cloud_mcp.completed_png(result, operation)
            downloaded = contained(root, attempt_dir / "result.png")
            if downloaded.exists():
                require(downloaded.read_bytes() == data, "cloud_result_changed")
            else:
                write_new_bytes(downloaded, data)
            im = validate_image(root, downloaded, plan, operation_kind(operation))
            require([metadata["width"], metadata["height"]] == list(im.size), "cloud_dimensions_mismatch")
            kind = operation_kind(operation)
            image_receipt = store_image(root, plan, kind, data, {
                "origin": "cloud_mcp", "attempt_id": attempt_id,
                "source_sha256": submission["binding"]["input_sha256"]})
            record = {"status": "succeeded", "result_sha256": image_receipt["sha256"]}
        except (HarnessError, OSError, ValueError, KeyError) as exc:
            record = {"status": "failed", "code": "cloud_result_rejected",
                      "reason": exc.code if isinstance(exc, HarnessError) else "invalid_cloud_image"}
    save(terminal, record)
    return {**record, "attempt_id": attempt_id}


def submit(root: Path, plan_id: str, operation: str, config_path: Path, authorization_id: str) -> dict:
    plan = load_plan(root, plan_id)
    config = config_at(root, config_path, operation)
    directory = run_dir(root, plan)
    with lock(directory):
        auth_path = contained(root, directory / "authorizations" / (token(authorization_id, 32) + ".json"))
        auth = read(auth_path)
        unseal(auth)
        require(auth["id"] == authorization_id and auth["binding"] == binding(root, plan, operation, config),
                "authorization_binding_mismatch")
        require(auth["created_at"] <= time.time() < auth["expires_at"], "authorization_expired")
        used = auth_path.with_suffix(".used.json")
        require(not used.exists(), "authorization_already_used")
        previous = attempts(root, plan, operation)
        if previous:
            latest = previous[-1]
            require(auth.get("retry_after") == latest.name, "fresh_user_retry_decision_required")
            require(not (latest / "receipt.json").exists() or (latest / "terminal.json").exists(),
                    "prior_task_pending")
        kind = operation_kind(operation)
        require(not (directory / f"{kind}.png").exists(), "source_already_exists")
        source = reference_path(root, plan) if operation != "matte" else artifact(root, plan, "raw")[0]
        info = image_info(source)
        submission_id = str(uuid.uuid4())
        arguments = cloud_mcp.build_arguments(plan, operation, source.read_bytes(), info["mime"], config,
                                             submission_id)
        # This is discovery only, before the single-use authorization is consumed.
        tool = cloud_mcp.list_tools(config, operation)
        schema = tool.get("inputSchema")
        require(isinstance(schema, dict), "mcp_input_schema_missing")
        require(not list(Draft202012Validator(schema).iter_errors(arguments)), "mcp_arguments_rejected")
        attempt_id = new_id()
        attempt_dir = contained(root, directory / "attempts" / attempt_id)
        save(used, {"attempt_id": attempt_id, "authorization_digest": auth["digest"]})
        submission = seal({"schema": "character_cloud_submission_v1", "attempt_id": attempt_id,
                           "binding": auth["binding"], "authorization_digest": auth["digest"],
                           "created_at": time.time(), "tool": cloud_mcp.TOOLS[operation],
                           "arguments": arguments})
        save(attempt_dir / "submission.json", submission)  # Full input durable BEFORE business call.
        try:
            result = cloud_mcp.call(config, operation, submission["tool"], arguments)
            return consume_task_result(root, plan, operation, attempt_id, attempt_dir, submission, result,
                                       require_submission_id=True)
        except Exception:
            terminal = attempt_dir / "terminal.json"
            if not terminal.exists():
                save(terminal, {"status": "indeterminate", "code": "submission_receipt_uncertain"})
            return {"status": "indeterminate", "attempt_id": attempt_id,
                    "code": "submission_receipt_uncertain", "next": "user_decision_required_no_auto_resubmit"}


def poll(root: Path, plan_id: str, config_path: Path, attempt_id: str) -> dict:
    plan = load_plan(root, plan_id)
    directory = run_dir(root, plan)
    with lock(directory):
        attempt_dir = contained(root, directory / "attempts" / token(attempt_id, 32))
        submission = read(attempt_dir / "submission.json", 64 * 1024 * 1024)
        unseal(submission)
        require(submission["attempt_id"] == attempt_id, "attempt_id_mismatch")
        operation = submission["binding"]["operation"]
        config = config_at(root, config_path, operation)
        require(submission["binding"] == binding(root, plan, operation, config), "attempt_binding_changed")
        terminal = attempt_dir / "terminal.json"
        if terminal.exists():
            return {**read(terminal), "attempt_id": attempt_id}
        # A crash after image publication but before terminal recording must not
        # trigger another cloud query or falsely classify the accepted local image.
        kind = operation_kind(operation)
        local_receipt = directory / f"{kind}-receipt.json"
        if local_receipt.exists():
            _, record = artifact(root, plan, kind)
            require(record.get("attempt_id") == attempt_id and record.get("origin") == "cloud_mcp",
                    "attempt_result_conflict")
            require(record.get("source_sha256") == submission["binding"]["input_sha256"],
                    "attempt_result_source_mismatch")
            recovered = {"status": "succeeded", "result_sha256": record["sha256"]}
            save(terminal, recovered)
            return {**recovered, "attempt_id": attempt_id}
        require((attempt_dir / "receipt.json").exists(), "task_receipt_missing_no_auto_resubmit")
        receipt = read(attempt_dir / "receipt.json")
        unseal(receipt)
        require(receipt["submission_digest"] == submission["digest"], "task_receipt_stale")
        observations_dir = contained(root, attempt_dir / "observations")
        observations_dir.mkdir(exist_ok=True)
        observations = sorted(observations_dir.glob("*.json"))
        prior = read(observations[-1]) if observations else receipt
        remaining = prior["received_at"] + prior["poll_after_seconds"] - time.time()
        if remaining > 0:
            return {"status": "waiting", "attempt_id": attempt_id, "poll_after_seconds": round(remaining, 3)}
        # Only get_task is ever called here. Transient query errors do not resubmit business work.
        result = cloud_mcp.call(config, operation, "get_task", {"taskId": receipt["task_id"]})
        return consume_task_result(root, plan, operation, attempt_id, attempt_dir, submission, result,
                                   require_submission_id=False)


def process(root: Path, plan_id: str) -> dict:
    plan = load_plan(root, plan_id)
    directory = run_dir(root, plan)
    with lock(directory):
        approved_review(root, plan, "raw")
        _, raw = artifact(root, plan, "raw")
        matte_path, _ = artifact(root, plan, "matte")
        output = contained(root, directory / "candidate")
        if output.exists():
            review_target(root, plan, "candidate")
            validate_review_bundle(output, read(output / "candidate.json"))
            return read(output / "candidate.json")
        temporary = contained(root, directory / (".process-" + new_id()))
        candidate = build_candidate(matte_path, temporary, plan, raw["sha256"])
        save(temporary / "candidate.json", candidate)
        validate_candidate(temporary, candidate, plan)
        validate_review_bundle(temporary, candidate)
        temporary.rename(output)
        return candidate


def preview_alignment(root: Path, plan_id: str) -> dict:
    """Build a local, non-deliverable before/after preview from an already transparent raw board."""
    plan = load_plan(root, plan_id)
    require(plan.get("alignment", {}).get("mode") in {"bottom_y", "bottom_center"},
            "alignment_preview_not_requested")
    directory = run_dir(root, plan)
    with lock(directory):
        approved_review(root, plan, "raw")
        raw_path, raw = artifact(root, plan, "raw")
        output = contained(root, directory / "alignment-preview")
        if output.exists():
            return validate_alignment_preview(output, read(output / "alignment-preview.json"),
                                              plan, raw["sha256"])
        temporary = contained(root, directory / (".align-preview-" + new_id()))
        report = build_alignment_preview(raw_path, temporary, plan, raw["sha256"])
        validate_alignment_preview(temporary, report, plan, raw["sha256"])
        temporary.rename(output)
        return report


def deliver(root: Path, plan_id: str, destination: Path) -> dict:
    plan = load_plan(root, plan_id)
    target = contained(root, destination)
    require(target != root.resolve() and not target.is_relative_to(contained(root, PRIVATE)),
            "delivery_destination_invalid")
    require(not target.exists(), "delivery_destination_exists")
    directory = run_dir(root, plan)
    with lock(directory):
        approved_review(root, plan, "raw")
        review_record = approved_review(root, plan, "candidate")
        candidate_dir = contained(root, directory / "candidate")
        candidate = read(candidate_dir / "candidate.json")
        target.parent.mkdir(parents=True, exist_ok=True)
        temporary = contained(root, target.parent / (".delivery-" + new_id()))
        temporary.mkdir()
        for record in candidate.get("source_frames", []) + candidate["frames"] + candidate["artifacts"]:
            out = contained(temporary, record["path"])
            out.parent.mkdir(exist_ok=True)
            shutil.copyfile(contained(candidate_dir, record["path"]), out)
        # Public evidence has no endpoints, task/authorization IDs or private source paths.
        public_review = {"decision": "approved", "checks": review_record["checks"],
                         "candidate_digest": candidate["digest"]}
        public_plan = {k: plan[k] for k in
                       ("digest", "board_size", "frame_size", "loop", "duration_ms", "gif", "alignment")}
        manifest = seal({"schema": "character_image_delivery_v1", "status": "accepted",
                         "plan": public_plan, "candidate": candidate, "review": public_review})
        save(temporary / "manifest.json", manifest)
        validate_delivery(temporary)
        temporary.rename(target)
        return {"status": "accepted", "manifest_digest": manifest["digest"],
                "directory": target.relative_to(root.resolve()).as_posix()}


def validate_delivery(directory: Path) -> dict:
    manifest = read(contained(directory, "manifest.json"))
    unseal(manifest)
    require(manifest["schema"] == "character_image_delivery_v1" and manifest["status"] == "accepted",
            "delivery_status_invalid")
    candidate = manifest["candidate"]
    require(manifest["review"] == {"decision": "approved", "checks": sorted(REVIEW_CHECKS["candidate"]),
                                   "candidate_digest": candidate["digest"]}, "delivery_review_invalid")
    validate_candidate(directory, candidate, manifest["plan"])
    actual = set()
    for path in directory.rglob("*"):
        contained(directory, path)
        if path.is_file():
            actual.add(path.relative_to(directory).as_posix())
    expected = {r["path"] for r in candidate.get("source_frames", [])
                + candidate["frames"] + candidate["artifacts"]} | {"manifest.json"}
    require(actual == expected, "delivery_unexpected_files")
    return {"status": "accepted", "manifest_digest": manifest["digest"], "frames": 16}


def inspect(root: Path, plan_id: str) -> dict:
    plan = load_plan(root, plan_id)
    directory = run_dir(root, plan)
    for kind in ("raw", "matte", "reference"):
        require((directory / f"{kind}.png").exists() == (directory / f"{kind}-receipt.json").exists(),
                "source_publication_incomplete_manual_inspection_required")
        if (directory / f"{kind}-receipt.json").exists():
            artifact(root, plan, kind)
    review_summary = None
    review_artifacts = []
    if plan["reference_preparation"] is None:
        state = "reference_cloud_matte_required" if plan["reference_needs_cloud_matte"] else "reference_review_required"
        if (directory / "reference-receipt.json").exists():
            state = "reference_review_required"
        if (directory / "reference-review.json").exists():
            record = read(directory / "reference-review.json")
            unseal(record)
            review_summary = {"stage": "reference", "decision": record.get("decision"),
                              "review_digest": record.get("digest")}
            if record.get("decision") == "rejected":
                state = "reference_rejected"
        if (directory / "reference-preparation-handoff.json").exists():
            preparation.load_preparation(root, plan)
            state = "reference_ready_replan_required"
    elif (directory / "candidate").exists():
        review_target(root, plan, "candidate")
        bundle = validate_review_bundle(directory / "candidate", read(directory / "candidate/candidate.json"))
        review_artifacts = bundle["files"] + [{"path": "review/review-bundle.json",
                                                "digest": bundle["digest"]}]
        state = "candidate_review_required"
        if (directory / "candidate-review.json").exists():
            record = read(directory / "candidate-review.json")
            unseal(record)
            review_summary = {"stage": "candidate", "decision": record.get("decision"),
                              "review_digest": record.get("digest")}
            if record.get("decision") == "approved":
                approved_review(root, plan, "candidate")
                state = "ready_to_deliver"
            else:
                state = "candidate_rejected"
    elif (directory / "matte-receipt.json").exists():
        state = "ready_to_process"
    elif (directory / "raw-receipt.json").exists():
        state = "raw_review_required"
        if (directory / "raw-review.json").exists():
            record = read(directory / "raw-review.json")
            unseal(record)
            review_summary = {"stage": "raw", "decision": record.get("decision"),
                              "review_digest": record.get("digest")}
            if record.get("decision") == "approved":
                approved_review(root, plan, "raw")
                state = "ready_for_cloud_matte"
            else:
                state = "raw_rejected"
    else:
        state = "ready_for_generation_or_raw_import"
    summaries = []
    for operation in cloud_mcp.TOOLS:
        for attempt in attempts(root, plan, operation):
            if (attempt / "terminal.json").exists():
                status = read(attempt / "terminal.json")["status"]
            else:
                status = "pending" if (attempt / "receipt.json").exists() else "indeterminate"
            summaries.append({"attempt_id": attempt.name, "operation": operation, "status": status})
    return {"state": state, "plan_digest": plan_id, "attempts": summaries,
            "review": review_summary, "review_artifacts": review_artifacts,
            "review_checks": REVIEW_CHECKS}
