"""One durable, bounded job. This is not a queue, web service or worker platform."""
from __future__ import annotations

import importlib
from pathlib import Path
import time
from typing import Protocol

from . import batch, planning
from .adapter import export_request, import_result, seal_result
from .assembly import finalize, inspect_delivery
from .common import (ContractError, digest, load_verified_image, read_json, require,
                     safe_relative, sha256, write_json)
from .process import process
from .visual_qa import (instruction as visual_qa_instruction, write_receipt as write_visual_qa_receipt,
                        write_unavailable_receipt)


class Provider(Protocol):
    """Trusted deployment plugin. Private transport state stays outside delivery."""

    def plan(self, reference: Path, instruction: str, *, state_dir: Path, timeout: float) -> str: ...

    def generate(self, bundle: Path, *, state_dir: Path, timeout: float) -> Path: ...

    def visual_qa(self, reference: Path, preview: Path, contact_sheet: Path, instruction: str,
                  *, state_dir: Path, timeout: float) -> str: ...


def load_provider(config: dict) -> Provider:
    require(set(config) == {"kind", "factory", "options"}
            and config["kind"] == "ai_ui_decomposition_provider_config_v1"
            and isinstance(config["options"], dict), "PROVIDER_CONFIG")
    factory = config["factory"]
    require(isinstance(factory, str) and factory.count(":") == 1, "PROVIDER_FACTORY")
    module, name = factory.split(":")
    require(all(part.isidentifier() for part in module.split(".")) and name.isidentifier(),
            "PROVIDER_FACTORY")
    try:
        provider = getattr(importlib.import_module(module), name)(config["options"])
    except Exception as exc:
        raise ContractError("PROVIDER_SETUP_FAILED") from exc
    require(callable(getattr(provider, "plan", None))
            and callable(getattr(provider, "generate", None))
            and callable(getattr(provider, "visual_qa", None)), "PROVIDER_INTERFACE")
    return provider


def _record(path: Path, body: dict) -> dict:
    result = {**body, "digest": digest(body)}
    write_json(path, result)
    return result


def _verified(path: Path) -> dict:
    record = read_json(path)
    require(record.get("digest") == digest({k: v for k, v in record.items() if k != "digest"}),
            "JOB_RECORD_CHANGED")
    return record


def job_status(job: Path) -> dict:
    """Read-only. A started job with no terminal receipt is never resubmitted."""
    job = job.resolve()
    request = _verified(job / "job.json")
    result = {"kind": "ai_ui_decomposition_job_status_v1", "job_digest": request["digest"],
              "status": "started_outcome_unknown", "automatic_resubmit": False,
              "visual_review": "not_performed",
              "visual_qa_policy": request.get("visual_qa_policy", "strict")}
    run = job / "workspace" / "runs" / "automatic"
    if (run / "batch.json").is_file():
        result["batch"] = batch.status(run)
    if (job / "visual-qa-started.json").is_file():
        visual_qa_started = _verified(job / "visual-qa-started.json")
        require(visual_qa_started["job_digest"] == request["digest"], "JOB_VISUAL_QA_BINDING")
        result["automated_visual_qa"] = "started_outcome_unknown"
    if (job / "result.json").exists():
        terminal = _verified(job / "result.json")
        require(terminal["job_digest"] == request["digest"], "JOB_RESULT_BINDING")
        result.update(terminal)
        if "visual_qa_digest" in terminal:
            visual_qa = _verified(job / "visual-qa.json")
            require(visual_qa["digest"] == terminal["visual_qa_digest"], "JOB_VISUAL_QA_CHANGED")
        if terminal["status"] in {"completed_visual_qa_draft", "completed_visual_qa_warning"}:
            receipt = inspect_delivery(job / "delivery")
            require(receipt["digest"] == terminal["delivery_digest"], "JOB_DELIVERY_CHANGED")
            for key, row in terminal["artifacts"].items():
                require(sha256(safe_relative(job, row["path"])) == row["sha256"],
                        "JOB_ARTIFACT_CHANGED")
    return result


def auto_run(reference: Path, job: Path, provider: Provider, *, maximum_calls: int,
             timeout_seconds: int, authorized: bool, provider_binding: str = "injected",
             visual_qa_policy: str = "strict") -> dict:
    """Caller explicitly delegates two vision calls and a bounded frozen plan.

    A repeated successful job verifies and returns existing files. Every other
    repeated job stops; recovery uses existing verified-result reuse contracts.
    """
    require(authorized is True, "EXPLICIT_PROVIDER_AND_DRAFT_AUTHORIZATION_REQUIRED")
    require(type(maximum_calls) is int and 1 <= maximum_calls <= 32, "JOB_BUDGET")
    require(type(timeout_seconds) is int and 1 <= timeout_seconds <= 86400, "JOB_TIMEOUT")
    require(visual_qa_policy in {"strict", "advisory"}, "VISUAL_QA_POLICY")
    picture, evidence = load_verified_image(reference.resolve())
    require(max(picture.size) <= 30000 and picture.width * picture.height <= 16_777_216,
            "JOB_CANVAS_LIMIT")
    require(callable(getattr(provider, "plan", None))
            and callable(getattr(provider, "generate", None))
            and callable(getattr(provider, "visual_qa", None)), "PROVIDER_INTERFACE")
    body = {"kind": "ai_ui_decomposition_job_v1", "source_sha256": evidence["sha256"],
            "canvas": list(picture.size), "maximum_vision_calls": 2,
            "maximum_generation_calls": maximum_calls, "timeout_seconds": timeout_seconds,
            "provider_binding": provider_binding, "delivery_policy": "unreviewed_draft",
            "visual_qa_policy": visual_qa_policy, "automatic_retries": 0}
    job = job.resolve()
    if job.exists():
        request = _verified(job / "job.json")
        require(request["digest"] == digest(body), "JOB_INPUT_CHANGED")
        status = job_status(job)
        require(status["status"] in {"completed_visual_qa_draft", "completed_visual_qa_warning"},
                "JOB_ALREADY_STARTED_NO_RESUBMIT")
        return status
    # Fail on missing optional dependencies BEFORE either provider can consume compute.
    try:
        import psd_tools  # noqa: F401
        from .psd_preview import finalize_preview  # noqa: F401
    except ImportError as exc:
        raise ContractError("PSD_OPTIONAL_DEPENDENCY_MISSING") from exc
    job.mkdir(parents=True, exist_ok=False)
    request = _record(job / "job.json", body)
    project = job / "project"
    project.mkdir()
    picture.save(project / "reference.png")
    deadline = time.monotonic() + timeout_seconds
    stage = "planning"
    active_asset = None
    run = job / "workspace" / "runs" / "automatic"

    def remaining() -> float:
        seconds = deadline - time.monotonic()
        require(seconds > 0, "JOB_DEADLINE_EXCEEDED")
        return seconds

    try:
        prompt = planning.instruction(list(picture.size), maximum_calls)
        (project / "instruction.txt").write_text(prompt, encoding="utf-8")
        _record(job / "planning-started.json", {"job_digest": request["digest"],
            "reference_sha256": sha256(project / "reference.png"), "instruction_digest": digest(prompt),
            "single_use": True, "maximum_calls": 1})
        try:
            description = provider.plan(project / "reference.png", prompt,
                                        state_dir=job / "private" / "vision", timeout=remaining())
        except Exception as exc:
            raise ContractError("PLANNING_PROVIDER_FAILED") from exc
        remaining()
        plan = planning.materialize(description, project, list(picture.size), maximum_calls)
        frozen = batch.freeze(project / "plan.json", job / "workspace", "automatic")
        require(frozen["maximum_calls"] <= maximum_calls, "JOB_BUDGET_EXCEEDED")
        _record(job / "authorization.json", {"job_digest": request["digest"],
            "plan_digest": digest(plan), "batch_digest": frozen["digest"],
            "maximum_calls": frozen["maximum_calls"], "single_use_requests": True,
            "delivery_policy": "unreviewed_draft", "visual_qa_policy": visual_qa_policy,
            "automatic_retries": 0})
        stage = "generation"
        for asset in frozen["dispatch_order"]:
            remaining()
            bundle = job / "bundles" / asset
            export_request(run, asset, bundle)
            active_asset = asset
            try:
                raw = provider.generate(bundle, state_dir=job / "private" / asset, timeout=remaining())
            except Exception as exc:
                raise ContractError("IMAGE_PROVIDER_FAILED") from exc
            seal_result(bundle, raw)
            import_result(run, bundle)
            active_asset = None
        remaining()
        stage = "processing"
        process(run)
        remaining()
        stage = "visual_quality"
        candidate = job / "private" / "visual-qa-candidate"
        candidate_receipt = finalize(run, candidate, draft=True)
        contact_sheet = run / "materials" / "contact-sheet.png"
        asset_ids = {asset["id"] for asset in plan["assets"]}
        qa_instruction = visual_qa_instruction(list(picture.size), asset_ids)
        _record(job / "visual-qa-started.json", {"job_digest": request["digest"],
            "plan_digest": digest(plan), "materials_digest": candidate_receipt["materials_digest"],
            "instruction_digest": digest(qa_instruction), "single_use": True, "maximum_calls": 1})
        try:
            assessment = provider.visual_qa(project / "reference.png", candidate / "preview.png",
                                            contact_sheet, qa_instruction,
                                            state_dir=job / "private" / "visual-qa-provider",
                                            timeout=remaining())
        except Exception as exc:
            if visual_qa_policy == "strict":
                raise ContractError("VISUAL_QA_PROVIDER_FAILED") from exc
            visual_qa = write_unavailable_receipt(job / "visual-qa.json", "VISUAL_QA_PROVIDER_FAILED",
                plan_digest=digest(plan), materials_digest=candidate_receipt["materials_digest"],
                reference=project / "reference.png", preview=candidate / "preview.png",
                contact_sheet=contact_sheet)
        else:
            try:
                remaining()
                visual_qa = write_visual_qa_receipt(job / "visual-qa.json", assessment,
                    asset_ids=asset_ids, plan_digest=digest(plan),
                    materials_digest=candidate_receipt["materials_digest"], reference=project / "reference.png",
                    preview=candidate / "preview.png", contact_sheet=contact_sheet)
            except ContractError as exc:
                if visual_qa_policy == "strict":
                    raise
                reason = str(exc) if str(exc).isascii() and str(exc).replace("_", "").isupper() else "JOB_STAGE_FAILED"
                visual_qa = write_unavailable_receipt(job / "visual-qa.json", reason,
                    plan_digest=digest(plan), materials_digest=candidate_receipt["materials_digest"],
                    reference=project / "reference.png", preview=candidate / "preview.png",
                    contact_sheet=contact_sheet)
        if visual_qa["outcome"] == "rejected" and visual_qa_policy == "strict":
            _record(job / "result.json", {"kind": "ai_ui_decomposition_job_result_v1",
                "job_digest": request["digest"], "status": "failed_visual_qa", "stage": stage,
                "reason": "AUTOMATED_VISUAL_QA_REJECTED", "asset": None,
                "visual_review": "not_performed", "automated_visual_qa": "rejected",
                "visual_qa_digest": visual_qa["digest"], "automatic_visual_acceptance": False,
                "visual_qa_policy": visual_qa_policy,
                "automatic_resubmit": False, "vision_calls": 2,
                "generation_calls": frozen["maximum_calls"]})
            return job_status(job)
        stage = "draft_export"
        receipt = finalize(run, job / "delivery", draft=True)
        from .psd_export import export_psd
        exported = export_psd(job / "delivery")
        import shutil
        shutil.copyfile(job / "visual-qa.json", job / "delivery" / "automated-visual-qa.json")
        artifacts = {}
        for name, relative in {"psd": "delivery/" + exported["file"], "preview": "delivery/preview.png",
                               "scene": "delivery/scene.json", "delivery": "delivery/delivery.json",
                               "export": "delivery/psd-export.json", "plan": "project/plan.json",
                               "automated_visual_qa": "delivery/automated-visual-qa.json"}.items():
            artifacts[name] = {"path": relative, "sha256": sha256(safe_relative(job, relative))}
        _record(job / "result.json", {"kind": "ai_ui_decomposition_job_result_v1",
            "job_digest": request["digest"],
            "status": "completed_visual_qa_draft" if visual_qa["outcome"] == "passed"
                      else "completed_visual_qa_warning",
            "delivery_digest": receipt["digest"], "artifacts": artifacts,
            "visual_review": "not_performed", "automated_visual_qa": visual_qa["outcome"],
            "visual_qa_digest": visual_qa["digest"], "automatic_visual_acceptance": False,
            "visual_qa_policy": visual_qa_policy,
            "application_check": "not_run", "automatic_resubmit": False,
            "vision_calls": 2, "generation_calls": frozen["maximum_calls"],
            "elapsed_seconds": round(timeout_seconds - (deadline - time.monotonic()), 3)})
    except Exception as exc:
        if active_asset is not None:
            frozen, _ = batch.load(run)
            if batch.state(run, frozen["requests"][active_asset]) == "reserved":
                batch.indeterminate(run, active_asset, "PROVIDER_OR_RESULT_FAILURE_NO_RESUBMIT")
        # Never expose exception text: a transport exception can contain a token,
        # signed URL, home directory or an arbitrary model/provider response.
        reason = "JOB_STAGE_FAILED"
        if isinstance(exc, ContractError) and str(exc).isascii() and str(exc).replace("_", "").isupper():
            reason = str(exc) if len(str(exc)) <= 80 else reason
        _record(job / "result.json", {"kind": "ai_ui_decomposition_job_result_v1",
            "job_digest": request["digest"], "status": "failed_no_resubmit", "stage": stage,
            "reason": reason, "asset": active_asset, "automatic_resubmit": False,
            "visual_review": "not_performed", "automatic_visual_acceptance": False})
    return job_status(job)
