from __future__ import annotations

import argparse
import importlib.metadata
import json
import platform
import sys
from pathlib import Path
from typing import Sequence

from . import __version__
from .canonical import load_json, redact, rooted_path, safe_error_code
from .correction import apply_correction, preview_correction
from .handoff import load_preparation_handoff
from .preparation import inspect_preparation, load_preparation, prepare_reference


def _print(value: object) -> None:
    print(json.dumps(value, ensure_ascii=False, indent=2))


def command_self_test(args: argparse.Namespace) -> int:
    del args
    _print({
        "schema_version": "ai_image_background_removal_self_test_v1",
        "status": "passed",
        "version": __version__,
        "media_generated": False,
        "network_probe": "not_performed",
        "provider_compute": "not_performed",
        "gpu_compute": "not_performed",
    })
    return 0


def command_doctor(args: argparse.Namespace) -> int:
    root = args.root.resolve(strict=True)
    packages: dict[str, str] = {}
    for distribution in ("Pillow", "numpy"):
        try:
            packages[distribution] = importlib.metadata.version(distribution)
        except importlib.metadata.PackageNotFoundError:
            packages[distribution] = "missing"
    actions: list[str] = []
    ready = all(version != "missing" for version in packages.values())
    preparation = None
    if args.reference is not None:
        preparation = inspect_preparation(root, args.reference, args.config)
        if preparation["status"] != "ready":
            ready = False
            actions.append("Configure the explicitly supplied local CPU segmentation model or resolve the source diagnostic.")
    report: dict[str, object] = {
        "schema_version": "ai_image_background_removal_doctor_v1",
        "status": "ready" if ready else "action_required",
        "version": __version__,
        "python": platform.python_version(),
        "packages": packages,
        "capabilities": {"preparation": "ready" if ready else "action_required"},
        "actions": actions,
        "network_probe": "not_performed",
        "provider_compute": "not_performed",
        "gpu_compute": "not_performed",
    }
    if preparation is not None:
        report["reference_preparation"] = preparation
    _print(redact(report))
    return 1 if args.require_ready and not ready else 0


def command_prepare(args: argparse.Namespace) -> int:
    root = args.root.resolve(strict=True)
    report = prepare_reference(root=root, reference=args.reference, out_dir=args.out_dir, config_path=args.config)
    out = rooted_path(root, args.out_dir)
    _print({
        "status": "prepared_requires_visual_review",
        "preparation_sha256": report["preparation_sha256"],
        "report": (out / "preparation.json").relative_to(root).as_posix(),
        "handoff": (out / "handoff.json").relative_to(root).as_posix(),
        "foreground": report["foreground"]["path"],
        "method": report["method"],
        "quality": report["quality"],
        "review_dir": (Path(report["foreground"]["path"]).parent / "review").as_posix(),
        "network_probe": "not_performed",
        "provider_compute": "not_performed",
        "gpu_compute": "not_performed",
    })
    return 0


def command_correct_preview(args: argparse.Namespace) -> int:
    root = args.root.resolve(strict=True)
    report = preview_correction(
        root=root,
        prepared_reference=args.prepared_reference,
        region=args.region,
        background_point=args.background_point,
        out_dir=args.out_dir,
        tolerance=args.tolerance,
        softness=args.softness,
    )
    _print({
        "status": "correction_requires_confirmation",
        "correction_sha256": report["correction_sha256"],
        "preview": (rooted_path(root, args.out_dir) / "correction.json").relative_to(root).as_posix(),
        "result": report["result"],
        "review": {name: item["path"] for name, item in report["artifacts"].items() if name.endswith("512.png")},
        "network_probe": "not_performed",
        "provider_compute": "not_performed",
        "gpu_compute": "not_performed",
    })
    return 0


def command_correct_apply(args: argparse.Namespace) -> int:
    root = args.root.resolve(strict=True)
    report = apply_correction(
        root=root,
        preview_path=args.preview,
        confirm_correction_sha256=args.confirm_correction_sha256,
        out_dir=args.out_dir,
    )
    _print({
        "status": "prepared_requires_visual_review",
        "preparation_sha256": report["preparation_sha256"],
        "report": (rooted_path(root, args.out_dir) / "preparation.json").relative_to(root).as_posix(),
        "handoff": (rooted_path(root, args.out_dir) / "handoff.json").relative_to(root).as_posix(),
        "foreground": report["foreground"]["path"],
        "method": report["method"],
        "quality": report["quality"],
        "network_probe": "not_performed",
        "provider_compute": "not_performed",
        "gpu_compute": "not_performed",
    })
    return 0


def command_inspect(args: argparse.Namespace) -> int:
    root = args.root.resolve(strict=True)
    target = rooted_path(root, args.target, must_exist=True)
    value = load_preparation_handoff(root, target) if target.name == "handoff.json" else (load_preparation(root, target) if target.name == "preparation.json" else load_json(target))
    _print(redact(value))
    return 0


def command_validate(args: argparse.Namespace) -> int:
    root = args.root.resolve(strict=True)
    target = rooted_path(root, args.prepared_reference, must_exist=True)
    if target.name == "handoff.json":
        handoff = load_preparation_handoff(root, target)
        result_sha256 = handoff["handoff_sha256"]
        foreground = handoff["foreground"]
        handoff_sha256 = handoff["handoff_sha256"]
    else:
        report = load_preparation(root, target)
        result_sha256 = report["preparation_sha256"]
        foreground = report["foreground"]
        handoff_sha256 = None
    result = {
        "schema_version": "ai_image_background_removal_validation_v1",
        "status": "passed",
        "preparation_sha256": result_sha256,
        "foreground": foreground,
        "network_probe": "not_performed",
        "provider_compute": "not_performed",
        "gpu_compute": "not_performed",
    }
    if handoff_sha256 is not None:
        result["handoff_sha256"] = handoff_sha256
    _print(result)
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="ai-image-background-removal",
        description="Local CPU preparation of transparent game-art references",
    )
    parser.add_argument("--version", action="version", version=__version__)
    commands = parser.add_subparsers(dest="command", required=True)

    self_test = commands.add_parser("self-test", help="run an offline no-media installation check")
    self_test.set_defaults(handler=command_self_test)

    doctor = commands.add_parser("doctor", help="inspect local preparation readiness without inference")
    doctor.add_argument("--root", type=Path, default=Path.cwd())
    doctor.add_argument("--reference", type=Path)
    doctor.add_argument("--config", type=Path)
    doctor.add_argument("--require-ready", action="store_true")
    doctor.set_defaults(handler=command_doctor)

    prepare = commands.add_parser("prepare", help="prepare one ordinary image with existing alpha or configured CPU segmentation")
    prepare.add_argument("--root", required=True, type=Path)
    prepare.add_argument("--reference", required=True, type=Path)
    prepare.add_argument("--out-dir", required=True, type=Path)
    prepare.add_argument("--config", type=Path)
    prepare.set_defaults(handler=command_prepare)

    correct = commands.add_parser("correct", help="preview or apply one digest-confirmed bounded correction")
    corrections = correct.add_subparsers(dest="correction_command", required=True)
    preview = corrections.add_parser("preview")
    preview.add_argument("--root", required=True, type=Path)
    preview.add_argument("--prepared-reference", required=True, type=Path)
    preview.add_argument("--region", required=True, nargs=4, type=int, metavar=("X0", "Y0", "X1", "Y1"))
    preview.add_argument("--background-point", required=True, nargs=2, type=int, metavar=("X", "Y"))
    preview.add_argument("--tolerance", type=float, default=16.0)
    preview.add_argument("--softness", type=float, default=16.0)
    preview.add_argument("--out-dir", required=True, type=Path)
    preview.set_defaults(handler=command_correct_preview)
    apply = corrections.add_parser("apply")
    apply.add_argument("--root", required=True, type=Path)
    apply.add_argument("--preview", required=True, type=Path)
    apply.add_argument("--confirm-correction-sha256", required=True)
    apply.add_argument("--out-dir", required=True, type=Path)
    apply.set_defaults(handler=command_correct_apply)

    inspect = commands.add_parser("inspect", help="read a preparation or correction report")
    inspect.add_argument("--root", required=True, type=Path)
    inspect.add_argument("target", type=Path)
    inspect.set_defaults(handler=command_inspect)

    validate = commands.add_parser("validate", help="verify an existing preparation and every bound artifact")
    validate.add_argument("--root", required=True, type=Path)
    validate.add_argument("--prepared-reference", required=True, type=Path)
    validate.set_defaults(handler=command_validate)
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        return int(args.handler(args))
    except Exception as exc:
        print(json.dumps({"status": "error", "code": safe_error_code(exc), "type": type(exc).__name__}, ensure_ascii=False), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
