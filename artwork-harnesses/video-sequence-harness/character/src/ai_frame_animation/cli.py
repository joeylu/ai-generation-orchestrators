from __future__ import annotations

import argparse
import importlib.metadata
import json
import os
import platform
import sys
import uuid
from pathlib import Path
from typing import Any, Mapping, Sequence

from . import __version__
from .canonical import fingerprint, load_json, redact, rooted_path, safe_error_code, verify_document, write_json_atomic
from .compiler import compile_intent_to_job, reference_binding_for_job
from .handoff import load_decoded_handoff
from .intent import build_character_motion_intent, validate_character_motion_intent
from .media_tools import check_ffmpeg_tools, install_ffmpeg, resolve_media_tool
from .onboarding import initialize_workspace, run_self_test
from .planning import compile_plan, validate_plan_contract
from .processing import process_decoded_handoff, process_video
from .providers.base import GenerationFailed, GenerationIndeterminate, GenerationNotSubmitted
from .providers.discovery import load_provider
from .reference_preparation import load_reference_preparation
from .state import AttemptStore
from .validation import inspect_artifact, validate_delivery


def _print(value: object) -> None:
    print(json.dumps(value, ensure_ascii=False, indent=2))


def _reject_output_alias(output: Path, inputs: Sequence[Path]) -> None:
    if any(output == input_path for input_path in inputs):
        raise ValueError("output_must_not_overwrite_input")


def _verified_plan(path: Path) -> dict[str, Any]:
    plan = load_json(path)
    verify_document(plan, "plan_sha256")
    validate_plan_contract(plan)
    return plan


def _check_reference(root: Path, plan: Mapping[str, Any]) -> None:
    character = plan.get("character")
    if not isinstance(character, Mapping):
        raise ValueError("plan_character_invalid")
    reference = rooted_path(root, str(character.get("reference")), must_exist=True)
    expected = character.get("reference_fingerprint")
    if not isinstance(expected, Mapping):
        raise ValueError("plan_reference_fingerprint_missing")
    actual = fingerprint(reference, media_type="image")
    if actual.get("sha256") != expected.get("sha256") or actual.get("bytes") != expected.get("bytes"):
        raise ValueError("plan_reference_changed")
    if "reference_preparation" in character:
        binding = character["reference_preparation"]
        report = load_reference_preparation(root, binding["path"])
        if report["binding_sha256"] != binding["sha256"] or report["foreground"] != {"path": character["reference"], **actual}:
            raise ValueError("plan_reference_preparation_changed")


def command_doctor(args: argparse.Namespace) -> int:
    if bool(args.provider) != bool(args.provider_config):
        raise ValueError("doctor_provider_and_config_must_be_supplied_together")
    if getattr(args, "plan", None) and not args.provider:
        raise ValueError("doctor_plan_requires_provider")
    root = args.root.resolve(strict=True)
    packages: dict[str, str] = {}
    for distribution in ("Pillow", "jsonschema", "numpy"):
        try:
            packages[distribution] = importlib.metadata.version(distribution)
        except importlib.metadata.PackageNotFoundError:
            packages[distribution] = "missing"
    missing_packages = sorted(name for name, version in packages.items() if version == "missing")
    resolved_ffmpeg = resolve_media_tool(root, args.ffmpeg, "ffmpeg")
    resolved_ffprobe = resolve_media_tool(root, args.ffprobe, "ffprobe")
    executables = {
        "ffmpeg": "available" if resolved_ffmpeg else "missing",
        "ffprobe": "available" if resolved_ffprobe else "missing",
    }
    missing_executables = sorted(name for name, status in executables.items() if status == "missing")
    actions: list[str] = []
    if missing_packages:
        actions.append("Reinstall the immutable release wheel in the active Python environment.")
    if missing_executables:
        actions.append(
            "Run `ai-frame-animation tools install --root <root>` on supported platforms, "
            "install FFmpeg on PATH, or pass explicit paths."
        )
    provider_report: Mapping[str, Any] | None = None
    provider_ready: bool | None = None
    input_report: Mapping[str, Any] | None = None
    if args.provider and args.provider_config:
        provider = load_provider(args.provider, config_path=args.provider_config.resolve(strict=True), root=root)
        provider_report = provider.doctor()
        provider_ready = provider_report.get("status") == "ready"
        if not provider_ready:
            actions.append("Correct the provider's static configuration diagnostics before requesting compute.")
        if not getattr(args, "plan", None) and callable(getattr(provider, "preflight", None)):
            input_report = {"status": "not_checked", "diagnostic_code": "plan_required_for_input_preflight"}
            provider_ready = False
            actions.append("Compile the plan, then run doctor with --plan <workspace-relative-plan> before confirming generation.")
        if getattr(args, "plan", None):
            plan = _verified_plan(rooted_path(root, args.plan, must_exist=True))
            _check_reference(root, plan)
            if plan["provider"]["plugin"] != args.provider:
                raise ValueError("doctor_plan_provider_mismatch")
            preflight = getattr(provider, "preflight", None)
            input_report = preflight(plan) if callable(preflight) else {
                "status": "action_required", "diagnostic_code": "provider_plan_preflight_unsupported",
            }
            if input_report.get("status") != "ready":
                provider_ready = False
                actions.append(
                    "Materialize a reviewed preparation handoff from an optional local CLI or MCP service, "
                    "then re-plan with --prepared-reference. Resolve workflow diagnostics before compute."
                )

    preparation_handoff = None
    if getattr(args, "prepared_reference", None):
        prepared = load_reference_preparation(root, args.prepared_reference)
        preparation_handoff = {
            "status": "ready_for_visual_review",
            "contract_schema": prepared["contract_schema"],
            "producer": prepared["producer"],
            "binding_sha256": prepared["binding_sha256"],
            "foreground": prepared["foreground"],
        }

    planning_ready = not missing_packages
    processing_ready = planning_ready and not missing_executables
    requested_ready = processing_ready and provider_ready is not False
    report: dict[str, Any] = {
        "schema_version": "ai_frame_animation_doctor_v1",
        "status": "ready" if requested_ready else "action_required",
        "version": __version__,
        "python": platform.python_version(),
        "packages": packages,
        "executables": executables,
        "capabilities": {
            "planning": "ready" if planning_ready else "action_required",
            "processing": "ready" if processing_ready else "action_required",
            "generation": "not_checked" if provider_ready is None else ("statically_ready" if provider_ready else "action_required"),
        },
        "actions": actions,
        "network_probe": "not_performed",
        "provider_compute": "not_performed",
        "gpu_compute": "not_performed",
    }
    if provider_report is not None:
        report["provider"] = provider_report
    if input_report is not None:
        report["input_preflight"] = input_report
    if preparation_handoff is not None:
        report["reference_preparation"] = preparation_handoff
    _print(redact(report))
    return 1 if args.require_ready and not requested_ready else 0


def command_init(args: argparse.Namespace) -> int:
    _print(
        initialize_workspace(
            args.root,
            motion=args.motion,
            reference=args.reference,
            description=args.description,
            job_id=args.job_id,
            continuity=args.continuity,
            frame_counts=args.frames,
            size=args.size,
            quality=args.quality,
            gif=args.gif,
            provider=args.provider,
        )
    )
    return 0


def command_self_test(args: argparse.Namespace) -> int:
    del args
    _print(run_self_test())
    return 0


def command_tools_install(args: argparse.Namespace) -> int:
    _print(install_ffmpeg(args.root))
    return 0


def command_tools_check(args: argparse.Namespace) -> int:
    report = check_ffmpeg_tools(args.root)
    _print(redact(report))
    return 1 if args.require_ready and report["status"] != "ready" else 0


def command_intent_validate(args: argparse.Namespace) -> int:
    intent = validate_character_motion_intent(load_json(args.input.resolve(strict=True)))
    _print({
        "status": "valid",
        "schema_version": intent["schema_version"],
        "intent_sha256": intent["intent_sha256"],
        "network_probe": "not_performed",
        "provider_compute": "not_performed",
    })
    return 0


def command_intent_build(args: argparse.Namespace) -> int:
    root = args.root.resolve(strict=True)
    draft_path = rooted_path(root, args.draft, must_exist=True)
    job_path = rooted_path(root, args.job, must_exist=True)
    out = rooted_path(root, args.out, must_exist=False)
    input_paths = [draft_path, job_path]
    if args.prepared_reference is not None:
        input_paths.append(rooted_path(root, args.prepared_reference, must_exist=True))
    _reject_output_alias(out, input_paths)
    job = load_json(job_path)
    reference = reference_binding_for_job(root, job, getattr(args, "prepared_reference", None))
    intent = build_character_motion_intent(load_json(draft_path), raw_request=args.request, reference=reference)
    write_json_atomic(out, intent)
    _print({
        "status": "built",
        "intent": str(out.relative_to(root)),
        "intent_sha256": intent["intent_sha256"],
        "network_probe": "not_performed",
        "provider_compute": "not_performed",
    })
    return 0


def command_compile(args: argparse.Namespace) -> int:
    root = args.root.resolve(strict=True)
    intent_path = rooted_path(root, args.intent, must_exist=True)
    job_path = rooted_path(root, args.job, must_exist=True)
    out = rooted_path(root, args.out, must_exist=False)
    input_paths = [intent_path, job_path]
    if args.prepared_reference is not None:
        input_paths.append(rooted_path(root, args.prepared_reference, must_exist=True))
    _reject_output_alias(out, input_paths)
    compiled = compile_intent_to_job(
        load_json(intent_path),
        load_json(job_path),
        root,
        prepared_reference=getattr(args, "prepared_reference", None),
    )
    write_json_atomic(out, compiled)
    report = compiled["intent_compilation"]
    _print({
        "status": "compiled",
        "job": str(out.relative_to(root)),
        "intent_sha256": report["intent_sha256"],
        "compilation_sha256": report["compilation_sha256"],
        "network_probe": "not_performed",
        "provider_compute": "not_performed",
    })
    return 0


def command_plan(args: argparse.Namespace) -> int:
    root = args.root.resolve(strict=True)
    job_path = rooted_path(root, args.job, must_exist=True)
    out = rooted_path(root, args.out, must_exist=False)
    plan = compile_plan(load_json(job_path), root, prepared_reference=getattr(args, "prepared_reference", None))
    write_json_atomic(out, plan)
    _print({"status": "planned", "plan_sha256": plan["plan_sha256"], "plan": str(out.relative_to(root))})
    return 0


def command_run(args: argparse.Namespace) -> int:
    root = args.root.resolve(strict=True)
    plan_path = rooted_path(root, args.plan, must_exist=True)
    plan = _verified_plan(plan_path)
    _check_reference(root, plan)
    state_root = rooted_path(root, args.state_dir, must_exist=False)
    raw_out = rooted_path(root, args.raw_out, must_exist=False)
    store = AttemptStore(state_root=state_root, attempt_id=args.attempt_id)
    if store.directory.exists():
        raise ValueError("attempt_already_exists_or_consumed")
    if raw_out.exists():
        raise ValueError("raw_output_already_exists")
    store.create_authorized(plan_sha256=str(plan["plan_sha256"]), confirmed_sha256=args.confirm_plan_sha256)
    submission_token = uuid.uuid4().hex
    try:
        provider = load_provider(
            str(plan["provider"]["plugin"]),
            config_path=args.provider_config.resolve(strict=True),
            root=root,
        )
    except Exception as exc:
        store.append("GENERATION_NOT_SUBMITTED", {"code": type(exc).__name__})
        raise
    try:
        store.append("GENERATING", {"submission": "pending"})
        request_id = provider.submit_once(plan, submission_token)
        store.append("SUBMITTED", {"request_id_recorded": True})
        result = provider.await_result(request_id, raw_out)
        if result.resolve(strict=True) != raw_out.resolve(strict=True):
            raise GenerationIndeterminate("provider_returned_unexpected_destination")
        raw = fingerprint(raw_out, media_type="video")
        store.append("RAW_READY", {"raw": raw, "path": str(raw_out.relative_to(root)).replace("\\", "/")})
    except GenerationNotSubmitted as exc:
        store.append("GENERATION_NOT_SUBMITTED", {"code": safe_error_code(exc)})
        raise
    except GenerationFailed as exc:
        store.append("FAILED", {"code": safe_error_code(exc)})
        raise
    except Exception as exc:
        events = store.read()
        if events and events[-1]["state"] not in {"GENERATION_NOT_SUBMITTED", "FAILED"}:
            store.append("GENERATION_INDETERMINATE", {"code": type(exc).__name__})
        raise
    _print({"status": "raw_ready", "attempt_id": args.attempt_id, "raw": raw})
    return 0


def command_process(args: argparse.Namespace) -> int:
    root = args.root.resolve(strict=True)
    plan = _verified_plan(rooted_path(root, args.plan, must_exist=True))
    raw = rooted_path(root, args.raw_video, must_exist=True)
    out = rooted_path(root, args.out_dir, must_exist=False)
    decoded_handoff_path = getattr(args, "decoded_handoff", None)
    if decoded_handoff_path and (args.decoded_dir or args.probe_json):
        raise ValueError("decoded_handoff_conflicts_with_fixture_inputs")
    if bool(args.decoded_dir) != bool(args.probe_json):
        raise ValueError("offline_decoded_fixture_requires_both_inputs")
    if args.decoded_dir and os.environ.get("AI_FRAME_ANIMATION_OFFLINE_TESTS") != "1":
        raise ValueError("offline_decoded_fixture_requires_test_mode")
    if decoded_handoff_path:
        handoff = load_decoded_handoff(root, decoded_handoff_path, raw_video=args.raw_video)
        delivery = process_decoded_handoff(
            root=root,
            plan=plan,
            handoff=handoff,
            out_dir=out,
            key_color=str(plan["delivery"]["key_color"]),
        )
        validation = validate_delivery(out, policy=str(plan["delivery"]["quality"]), workspace_root=root)
        _print({"status": validation["status"], "delivery": str(out.relative_to(root)), "manifest": delivery, "validation": validation})
        return 0
    decoded = rooted_path(root, args.decoded_dir, must_exist=True) if args.decoded_dir else None
    probe_payload = load_json(rooted_path(root, args.probe_json, must_exist=True)) if args.probe_json else None
    ffmpeg = resolve_media_tool(root, args.ffmpeg, "ffmpeg")
    ffprobe = resolve_media_tool(root, args.ffprobe, "ffprobe")
    if decoded is None and ffmpeg is None:
        raise ValueError("ffmpeg_not_found")
    if probe_payload is None and ffprobe is None:
        raise ValueError("ffprobe_not_found")
    delivery = process_video(
        root=root,
        plan=plan,
        raw_video=raw,
        out_dir=out,
        key_color=str(plan["delivery"]["key_color"]),
        ffprobe=ffprobe or "ffprobe",
        ffmpeg=ffmpeg or "ffmpeg",
        decoded_dir=decoded,
        probe_payload=probe_payload,
    )
    validation = validate_delivery(out, policy=str(plan["delivery"]["quality"]), workspace_root=root)
    _print({"status": validation["status"], "delivery": str(out.relative_to(root)), "manifest": delivery, "validation": validation})
    return 0


def command_inspect(args: argparse.Namespace) -> int:
    _print(inspect_artifact(args.target))
    return 0


def command_validate(args: argparse.Namespace) -> int:
    root = args.root.resolve(strict=True)
    delivery = rooted_path(root, args.delivery, must_exist=True)
    _print(validate_delivery(delivery, policy=args.policy, workspace_root=root))
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="ai-frame-animation", description="Transparent 2D character frame-animation pipeline")
    parser.add_argument("--version", action="version", version=__version__)
    subparsers = parser.add_subparsers(dest="command", required=True)

    init = subparsers.add_parser("init", help="create a private-by-default starter workspace")
    init.add_argument("--root", required=True, type=Path)
    init.add_argument("--motion", required=True)
    init.add_argument("--reference", default="reference.png")
    init.add_argument("--description", default="")
    init.add_argument("--job-id")
    init.add_argument("--continuity", choices=("loop", "one_shot"), default="loop")
    init.add_argument("--frames", nargs="+", type=int, choices=(16, 32, 64), default=[16, 32, 64])
    init.add_argument("--size", type=int, choices=(128, 256, 512), default=256)
    init.add_argument("--quality", choices=("strict", "best_effort"), default="strict")
    init.add_argument("--gif", action=argparse.BooleanOptionalAction, default=True)
    init.add_argument("--provider", choices=("minimax_h3",), default="minimax_h3")
    init.set_defaults(handler=command_init)

    self_test = subparsers.add_parser("self-test", help="run an offline, no-media installation check")
    self_test.set_defaults(handler=command_self_test)

    tools = subparsers.add_parser("tools", help="manage deterministic project-local media tools")
    tool_commands = tools.add_subparsers(dest="tool_command", required=True)
    tools_install = tool_commands.add_parser("install", help="download and verify a locked project-local FFmpeg build")
    tools_install.add_argument("--root", type=Path, default=Path.cwd())
    tools_install.set_defaults(handler=command_tools_install)
    tools_check = tool_commands.add_parser("check", help="verify FFmpeg and ffprobe without media or network")
    tools_check.add_argument("--root", type=Path, default=Path.cwd())
    tools_check.add_argument("--require-ready", action="store_true")
    tools_check.set_defaults(handler=command_tools_check)

    intent = subparsers.add_parser("intent", help="validate provider-neutral Agent motion intent")
    intent_commands = intent.add_subparsers(dest="intent_command", required=True)
    intent_build = intent_commands.add_parser("build", help="bind an Agent semantic draft to request/reference evidence")
    intent_build.add_argument("--root", required=True, type=Path)
    intent_build.add_argument("--request", required=True)
    intent_build.add_argument("--draft", required=True, type=Path)
    intent_build.add_argument("--job", required=True, type=Path)
    intent_build.add_argument("--out", required=True, type=Path)
    intent_build.add_argument(
        "--prepared-reference",
        type=Path,
        help="reviewed neutral handoff.json used to bind source, foreground, and preparation digests",
    )
    intent_build.set_defaults(handler=command_intent_build)
    intent_validate = intent_commands.add_parser("validate", help="validate one digest-bound motion intent without compute")
    intent_validate.add_argument("--input", required=True, type=Path)
    intent_validate.set_defaults(handler=command_intent_validate)

    compile_command = subparsers.add_parser("compile", help="deterministically compile motion intent into job.json")
    compile_command.add_argument("--root", required=True, type=Path)
    compile_command.add_argument("--intent", required=True, type=Path)
    compile_command.add_argument("--job", required=True, type=Path, help="existing job template; it is never overwritten")
    compile_command.add_argument("--out", required=True, type=Path)
    compile_command.add_argument(
        "--prepared-reference",
        type=Path,
        help="reviewed neutral handoff.json used to verify the intent reference binding",
    )
    compile_command.set_defaults(handler=command_compile)

    doctor = subparsers.add_parser("doctor", help="offline, redacted dependency diagnostics")
    doctor.add_argument("--root", type=Path, default=Path.cwd())
    doctor.add_argument("--ffmpeg", help="explicit executable path or command name")
    doctor.add_argument("--ffprobe", help="explicit executable path or command name")
    doctor.add_argument("--provider")
    doctor.add_argument("--provider-config", type=Path)
    doctor.add_argument("--plan", type=Path, help="workspace-relative plan for offline generation-input preflight")
    doctor.add_argument(
        "--prepared-reference",
        type=Path,
        help="workspace-relative neutral handoff.json (legacy preparation.json is temporarily accepted)",
    )
    doctor.add_argument("--require-ready", action="store_true", help="return nonzero when requested capabilities are not ready")
    doctor.set_defaults(handler=command_doctor)

    plan = subparsers.add_parser("plan", help="compile an immutable plan without compute")
    plan.add_argument("--root", required=True, type=Path)
    plan.add_argument("--job", required=True, type=Path)
    plan.add_argument("--out", required=True, type=Path)
    plan.add_argument(
        "--prepared-reference",
        type=Path,
        help="reviewed neutral handoff.json; legacy preparation.json is temporarily accepted",
    )
    plan.set_defaults(handler=command_plan)

    run = subparsers.add_parser("run", help="consume one confirmation and submit at most once")
    run.add_argument("--root", required=True, type=Path)
    run.add_argument("--plan", required=True, type=Path)
    run.add_argument("--confirm-plan-sha256", required=True)
    run.add_argument("--attempt-id", required=True)
    run.add_argument("--state-dir", type=Path, default=Path(".ai-frame-animation/attempts"))
    run.add_argument("--provider-config", required=True, type=Path)
    run.add_argument("--raw-out", required=True, type=Path)
    run.set_defaults(handler=command_run)

    process = subparsers.add_parser("process", help="deterministically process one raw video")
    process.add_argument("--root", required=True, type=Path)
    process.add_argument("--plan", required=True, type=Path)
    process.add_argument("--raw-video", required=True, type=Path)
    process.add_argument("--out-dir", required=True, type=Path)
    process.add_argument("--ffmpeg", help="explicit executable path or command name")
    process.add_argument("--ffprobe", help="explicit executable path or command name")
    process.add_argument("--decoded-handoff", type=Path, help="verified provider-neutral predecoded source contract")
    process.add_argument("--decoded-dir", type=Path, help="offline/predecoded frame directory")
    process.add_argument("--probe-json", type=Path, help="offline ffprobe-compatible fixture")
    process.set_defaults(handler=command_process)

    inspect = subparsers.add_parser("inspect", help="read attempt or delivery metadata")
    inspect.add_argument("target", type=Path)
    inspect.set_defaults(handler=command_inspect)

    validate = subparsers.add_parser("validate", help="validate a delivery")
    validate.add_argument("--root", required=True, type=Path)
    validate.add_argument("--delivery", required=True, type=Path)
    validate.add_argument("--policy", choices=("strict", "best_effort"), default="strict")
    validate.set_defaults(handler=command_validate)
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        return int(args.handler(args))
    except Exception as exc:
        print(json.dumps({"status": "error", "code": safe_error_code(exc), "type": type(exc).__name__}, ensure_ascii=False), file=sys.stderr)
        return 2
