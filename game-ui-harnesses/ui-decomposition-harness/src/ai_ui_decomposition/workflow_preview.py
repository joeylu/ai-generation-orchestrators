"""Build the bounded default-only preview used by the staged workflow.

This module is deliberately smaller than the full delivery runner.  It uses the
existing material handoff builder and stateful acceptance implementation, then
invokes the stateful browser driver in its explicit ``--default-only`` mode.
The resulting receipt binds every file that is handed to the later review and
acceptance nodes.  No provider, Studio, linkage, or full state browser is
invoked here.
"""
from __future__ import annotations

import math
from pathlib import Path
import subprocess

from .acceptance_execution import AcceptanceExecution
from .common import digest, read_json, require, safe_relative, sha256, write_json
from .delivery_adapter import prepare_handoff
from .handoff_build import build_handoff
from . import stateful
from .stateful import accept as stateful_accept
from .visual_observations import check_visual_observations


def _file(path: Path, base: Path, code: str) -> Path:
    """Require a regular file below ``base`` and return its resolved path."""
    path = Path(path)
    resolved = path.resolve()
    require(not path.is_symlink() and resolved.is_file(), code)
    require(resolved.is_relative_to(base.resolve()), code)
    return resolved


def _reference(base: Path, entry: object, code: str) -> tuple[Path, str]:
    require(isinstance(entry, dict) and set(entry) == {"path", "sha256"}, code)
    path = _file(safe_relative(base, entry["path"]), base, code)
    require(isinstance(entry["sha256"], str) and sha256(path) == entry["sha256"], code)
    return path, entry["sha256"]


def _capture_file(state_dir: Path, capture: dict, name: str, code: str) -> Path:
    entry = capture.get(name)
    require(isinstance(entry, dict) and set(entry) == {"path", "sha256"}, code)
    path = _file(safe_relative(state_dir, entry["path"]), state_dir, code)
    require(isinstance(entry["sha256"], str) and sha256(path) == entry["sha256"], code)
    return path


def _relative(output: Path, path: Path) -> dict:
    path = _file(path, output, "PREVIEW_ARTIFACT_MISSING")
    return {"path": path.relative_to(output).as_posix(), "sha256": sha256(path)}


def prepare_preview(compiled, run, component_root, output, timeout_seconds, *, recovery=None, refit=None):
    """Prepare and validate one default-only preview for a staged workflow.

    ``prepare_handoff`` and ``build_handoff`` remain the authorities for
    materialization, the official component import, and layout validation.
    ``stateful.accept`` performs evidence, import, and deterministic matrix
    validation with ``browser=False``.  The only browser process here is the
    explicit default-only capture, whose inspection is checked by the existing
    visual-observation checker.

    The returned paths are absolute ``Path`` objects below ``output`` so the
    workflow controller can register them as node artifacts without copying or
    rewriting any receipt.
    """
    execution = AcceptanceExecution(timeout_seconds)
    output = Path(output).resolve()
    component_root = Path(component_root).resolve()
    require(not output.exists(), "OUTPUT_EXISTS")
    output.mkdir(parents=True)

    execution.start("prepare-handoff")
    require(recovery is None or refit is None, 'PREVIEW_PROCESSING_ROUTE_CONFLICT')
    if refit is not None:
        from .material_refit import prepare_refit
        prepared_plan = prepare_refit(compiled, run, refit, output / 'prepared', component_root)
    elif recovery is None:
        prepared_plan = prepare_handoff(compiled, run, output / "prepared", component_root)
    else:
        from .reviewed_recovery import prepare
        prepared_plan = prepare(compiled, run, recovery, output / "prepared", component_root)
    prepared_plan = _file(prepared_plan, output, "PREVIEW_PREPARED_PLAN_MISSING")
    execution.remaining()

    # build_handoff owns finalization, archive export, official import and the
    # layout gate.  It receives the same cooperative deadline object so its
    # subprocesses consume the remaining process budget.
    run_plan = build_handoff(prepared_plan, component_root, output / "build", execution)
    run_plan = _file(run_plan, output, "PREVIEW_RUN_PLAN_MISSING")
    build_dir = output / "build"
    candidate = _file(build_dir / "assembly" / "ui.component-handoff.draft.zip",
                      output, "PREVIEW_CANDIDATE_MISSING")

    run_plan_data = read_json(run_plan, max_bytes=64 * 1024 * 1024)
    require(set(run_plan_data) == {"kind", "source", "stateEvidence"}
            and run_plan_data["kind"] == "ui_delivery_run_plan_v1",
            "PREVIEW_RUN_PLAN_INVALID")
    _, candidate_sha = _reference(run_plan.parent, run_plan_data["source"],
                                  "PREVIEW_RUN_PLAN_SOURCE_INVALID")
    require(candidate_sha == sha256(candidate), "PREVIEW_CANDIDATE_CHANGED")
    evidence, _ = _reference(run_plan.parent, run_plan_data["stateEvidence"],
                             "PREVIEW_RUN_PLAN_EVIDENCE_INVALID")

    contact = _file(output / "prepared" / "workspace" / "runs" / "materialized"
                    / "materials" / "contact-sheet.png", output,
                    "PREVIEW_CONTACT_MISSING")

    execution.start("stateful-deterministic")
    state_result = stateful_accept(
        candidate,
        evidence,
        component_root,
        output / "stateful",
        browser=False,
        timeout_seconds=max(1, math.floor(execution.remaining())),
        require_visual_layout=True,
    )
    require(isinstance(state_result, dict)
            and state_result.get("status") == "deterministic_passed",
            "PREVIEW_STATEFUL_ACCEPTANCE_FAILED")
    state_dir = output / "stateful"
    state_receipt = _file(state_dir / "acceptance.json", output,
                           "PREVIEW_STATEFUL_RECEIPT_MISSING")
    state_data = read_json(state_receipt)
    require(state_data.get("kind") == "ui_state_acceptance_v1"
            and state_data.get("status") == "deterministic_passed"
            and state_data.get("handoffSha256") == candidate_sha
            and state_data.get("layoutCoverage") == "required_checked",
            "PREVIEW_STATEFUL_RECEIPT_INVALID")
    consumed = _file(state_dir / "consumed.json", output,
                     "PREVIEW_CONSUMED_BUNDLE_MISSING")
    matrix = _file(state_dir / "state-matrix.json", output,
                   "PREVIEW_STATE_MATRIX_MISSING")

    # stateful.accept intentionally does not start a browser when browser=False.
    # This is the sole browser invocation in this preview node.  Passing the
    # explicit switch is part of the command contract and prevents the full
    # linkage/state driver from running.
    execution.start("default-only-browser")
    browser_script = Path(stateful.__file__).with_name("stateful_browser.mjs")
    browser_result = subprocess.run(
        ["node", str(browser_script), str(component_root), str(state_dir), "--default-only"],
        capture_output=True,
        text=True,
        timeout=execution.remaining(),
    )
    require(browser_result.returncode == 0, "STATE_DEFAULT_PREVIEW_FAILED")

    default_browser = _file(state_dir / "preflight-browser.json", output,
                            "PREVIEW_DEFAULT_BROWSER_MISSING")
    default_browser_data = read_json(default_browser, max_bytes=64 * 1024 * 1024)
    require(default_browser_data.get("kind") == "ui_default_preview_v1"
            and default_browser_data.get("status") == "captured"
            and default_browser_data.get("human_visual_acceptance") is False
            and default_browser_data.get("bundleSha256") == sha256(consumed)
            and default_browser_data.get("matrixSha256") == sha256(matrix),
            "PREVIEW_DEFAULT_BROWSER_INVALID")

    capture_path = _file(state_dir / "preflight-default-capture.json", output,
                         "PREVIEW_DEFAULT_CAPTURE_MISSING")
    capture = read_json(capture_path)
    require(capture.get("kind") == "ui_runtime_capture_v1"
            and capture.get("handoffSha256") == candidate_sha
            and capture.get("bundleSha256") == sha256(consumed)
            and capture.get("human_visual_acceptance") is False,
            "PREVIEW_DEFAULT_CAPTURE_INVALID")
    preview = _capture_file(state_dir, capture, "screenshot", "PREVIEW_SCREENSHOT_INVALID")
    inspection = _capture_file(state_dir, capture, "inspection", "PREVIEW_INSPECTION_INVALID")
    require(default_browser_data.get("bundleSha256") == sha256(consumed),
            "PREVIEW_DEFAULT_BUNDLE_CHANGED")

    execution.start("visual-observations")
    observations = _file(state_dir / "visual-observations.json", output,
                         "PREVIEW_VISUAL_OBSERVATIONS_MISSING")
    bundle = read_json(consumed, max_bytes=64 * 1024 * 1024)
    observation_data = read_json(observations, max_bytes=64 * 1024 * 1024)
    inspection_data = read_json(inspection, max_bytes=64 * 1024 * 1024)
    observation_check = check_visual_observations(bundle, observation_data, inspection_data)
    observation_check_path = state_dir / "preflight-visual-observation-check.json"
    write_json(observation_check_path, observation_check)
    require(observation_check.get("status") == "passed",
            "VISUAL_OBSERVATION_PREFLIGHT_REJECTED")

    execution.finish("passed")
    receipt_body = {
        "kind": "ui_workflow_preview_receipt_v1",
        "status": "captured",
        "acceptance": "preview_only",
        "human_visual_acceptance": False,
        "mediaCalls": 0,
        "automaticRetries": 0,
        "runPlan": _relative(output, run_plan),
        "candidate": _relative(output, candidate),
        "preview": _relative(output, preview),
        "contact": _relative(output, contact),
        "stateful": _relative(output, state_receipt),
        "defaultBrowser": _relative(output, default_browser),
        "defaultCapture": _relative(output, capture_path),
        "visualObservationCheck": _relative(output, observation_check_path),
        "execution": execution.report(),
    }
    receipt_path = output / "preview-receipt.json"
    if recovery is not None:
        receipt_body['reviewedRecovery'] = _relative(output, output/'prepared'/'recovery-lineage.json')
    if refit is not None:
        receipt_body['materialRefit'] = _relative(output, output/'prepared'/'material-refit.json')
    write_json(receipt_path, {**receipt_body, "digest": digest(receipt_body)})

    return {
        "run_plan": run_plan,
        "candidate": candidate,
        "preview": preview,
        "contact": contact,
        "receipt": receipt_path,
    }
