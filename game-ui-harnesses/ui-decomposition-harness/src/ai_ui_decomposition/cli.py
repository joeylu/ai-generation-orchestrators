from __future__ import annotations

import argparse
import json
from pathlib import Path

from . import batch
from .assembly import finalize, inspect_delivery
from .common import ContractError, read_json
from .contract import validate
from .process import process, review_template


def parser() -> argparse.ArgumentParser:
    root = argparse.ArgumentParser(description="Opt-in deterministic UI decomposition Harness")
    commands = root.add_subparsers(dest="command", required=True)
    check = commands.add_parser("check")
    check.add_argument("--plan", required=True, type=Path)
    freeze = commands.add_parser("freeze")
    freeze.add_argument("--plan", required=True, type=Path)
    freeze.add_argument("--workspace", required=True, type=Path)
    freeze.add_argument("--run", required=True)
    for name in ("reserve", "receive", "indeterminate"):
        command = commands.add_parser(name)
        command.add_argument("--run-dir", required=True, type=Path)
        command.add_argument("--asset", required=True)
        if name == "receive":
            command.add_argument("--source", required=True, type=Path)
        if name == "indeterminate":
            command.add_argument("--reason", required=True)
    for name in ("status", "process", "review-template"):
        command = commands.add_parser(name)
        command.add_argument("--run-dir", required=True, type=Path)
    final = commands.add_parser("finalize")
    final.add_argument("--run-dir", required=True, type=Path)
    final.add_argument("--output", required=True, type=Path)
    inspect = commands.add_parser("inspect")
    inspect.add_argument("--delivery", required=True, type=Path)
    export = commands.add_parser("export")
    export.add_argument("--delivery", required=True, type=Path)
    return root


def execute(args) -> dict:
    if args.command == "check":
        plan_path = args.plan.resolve()
        return validate(read_json(plan_path), source_base=plan_path.parent)
    if args.command == "freeze":
        return batch.freeze(args.plan, args.workspace, args.run)
    run = getattr(args, "run_dir", None)
    if run is not None:
        run = run.resolve()
    if args.command == "reserve":
        return batch.reserve(run, args.asset)
    if args.command == "receive":
        return batch.receive(run, args.asset, args.source)
    if args.command == "indeterminate":
        return batch.indeterminate(run, args.asset, args.reason)
    if args.command == "status":
        return batch.status(run)
    if args.command == "process":
        return process(run)
    if args.command == "review-template":
        return review_template(run)
    if args.command == "finalize":
        return finalize(run, args.output)
    if args.command == "inspect":
        return inspect_delivery(args.delivery)
    from .psd_export import export_psd
    return export_psd(args.delivery.resolve())


def main(argv=None) -> int:
    args = parser().parse_args(argv)
    try:
        result = execute(args)
        print(json.dumps(result, ensure_ascii=False, indent=2, sort_keys=True))
        return 0
    except (ContractError, RuntimeError) as exc:
        print(json.dumps({"status": "rejected", "error": type(exc).__name__,
                          "reason": str(exc)}, ensure_ascii=False, sort_keys=True))
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
