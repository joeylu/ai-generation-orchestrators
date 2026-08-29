from __future__ import annotations

import argparse
import importlib.metadata
import json
import os
import platform
import shutil
import sys
import uuid
from pathlib import Path
from typing import Any, Mapping, Sequence

from . import __version__
from .canonical import fingerprint, load_json, redact, rooted_path, safe_error_code, verify_document, write_json_atomic
from .planning import compile_plan, validate_plan_contract
from .processing import process_video
from .providers.base import GenerationFailed, GenerationIndeterminate, GenerationNotSubmitted
from .providers.discovery import load_provider
from .state import AttemptStore
from .validation import inspect_artifact, validate_delivery


def _print(value: object) -> None:
    print(json.dumps(value, ensure_ascii=False, indent=2))


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


def command_doctor(args: argparse.Namespace) -> int:
    if bool(args.provider) != bool(args.provider_config):
        raise ValueError("doctor_provider_and_config_must_be_supplied_together")
    packages: dict[str, str] = {}
    for distribution in ("Pillow", "jsonschema", "numpy"):
        try:
            packages[distribution] = importlib.metadata.version(distribution)
        except importlib.metadata.PackageNotFoundError:
            packages[distribution] = "missing"
    report: dict[str, Any] = {
        "schema_version": "ai_frame_animation_doctor_v1",
        "version": __version__,
        "python": platform.python_version(),
        "packages": packages,
        "executables": {
            "ffmpeg": "available" if shutil.which(args.ffmpeg) else "missing",
            "ffprobe": "available" if shutil.which(args.ffprobe) else "missing",
        },
        "network_probe": "not_performed",
        "provider_compute": "not_performed",
    }
    if args.provider and args.provider_config:
        provider = load_provider(args.provider, config_path=args.provider_config.resolve(strict=True), root=args.root.resolve(strict=True))
        report["provider"] = provider.doctor()
    _print(redact(report))
    return 0


def command_plan(args: argparse.Namespace) -> int:
    root = args.root.resolve(strict=True)
    job_path = rooted_path(root, args.job, must_exist=True)
    out = rooted_path(root, args.out, must_exist=False)
    plan = compile_plan(load_json(job_path), root)
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
    if bool(args.decoded_dir) != bool(args.probe_json):
        raise ValueError("offline_decoded_fixture_requires_both_inputs")
    if args.decoded_dir and os.environ.get("AI_FRAME_ANIMATION_OFFLINE_TESTS") != "1":
        raise ValueError("offline_decoded_fixture_requires_test_mode")
    decoded = rooted_path(root, args.decoded_dir, must_exist=True) if args.decoded_dir else None
    probe_payload = load_json(rooted_path(root, args.probe_json, must_exist=True)) if args.probe_json else None
    delivery = process_video(
        root=root,
        plan=plan,
        raw_video=raw,
        out_dir=out,
        key_color=str(plan["delivery"]["key_color"]),
        ffprobe=args.ffprobe,
        ffmpeg=args.ffmpeg,
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

    doctor = subparsers.add_parser("doctor", help="offline, redacted dependency diagnostics")
    doctor.add_argument("--root", type=Path, default=Path.cwd())
    doctor.add_argument("--ffmpeg", default="ffmpeg")
    doctor.add_argument("--ffprobe", default="ffprobe")
    doctor.add_argument("--provider")
    doctor.add_argument("--provider-config", type=Path)
    doctor.set_defaults(handler=command_doctor)

    plan = subparsers.add_parser("plan", help="compile an immutable plan without compute")
    plan.add_argument("--root", required=True, type=Path)
    plan.add_argument("--job", required=True, type=Path)
    plan.add_argument("--out", required=True, type=Path)
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
    process.add_argument("--ffmpeg", default="ffmpeg")
    process.add_argument("--ffprobe", default="ffprobe")
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
