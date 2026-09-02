from __future__ import annotations

import argparse
import json
from pathlib import Path

from . import __version__
from . import batch
from .assembly import finalize, inspect_delivery
from .common import ContractError, read_json
from .contract import validate
from .process import process, review_template


def parser() -> argparse.ArgumentParser:
    root = argparse.ArgumentParser(description="Opt-in deterministic UI decomposition Harness")
    root.add_argument("--version", action="version", version=__version__)
    commands = root.add_subparsers(dest="command", required=True)
    init = commands.add_parser("init")
    init.add_argument("--reference", required=True, type=Path)
    init.add_argument("--plan", required=True, type=Path)
    init.add_argument("--id", required=True)
    init.add_argument("--document", required=True)
    commands.add_parser("self-test")
    commands.add_parser("doctor")
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
    recovered = commands.add_parser("recover-receive")
    recovered.add_argument("--run-dir", required=True, type=Path)
    recovered.add_argument("--asset", required=True)
    recovered.add_argument("--source", required=True, type=Path)
    for name in ("status", "process", "review-template"):
        command = commands.add_parser(name)
        command.add_argument("--run-dir", required=True, type=Path)
    final = commands.add_parser("finalize")
    final.add_argument("--run-dir", required=True, type=Path)
    final.add_argument("--output", required=True, type=Path)
    final.add_argument("--draft", action="store_true", help="Requires unreviewed_draft in frozen plan")
    automatic = commands.add_parser("auto-run", help="Explicit bounded provider compute and draft PSD")
    automatic.add_argument("--reference", required=True, type=Path)
    automatic.add_argument("--job-dir", required=True, type=Path)
    automatic.add_argument("--provider-config", required=True, type=Path)
    automatic.add_argument("--max-generation-calls", required=True, type=int)
    automatic.add_argument("--timeout-seconds", type=int, default=3600)
    automatic.add_argument("--allow-provider-calls-and-unreviewed-draft", action="store_true")
    job_status = commands.add_parser("job-status")
    job_status.add_argument("--job-dir", required=True, type=Path)
    inspect = commands.add_parser("inspect")
    inspect.add_argument("--delivery", required=True, type=Path)
    export = commands.add_parser("export")
    export.add_argument("--delivery", required=True, type=Path)
    adapter_export = commands.add_parser("adapter-export")
    adapter_export.add_argument("--run-dir", required=True, type=Path)
    adapter_export.add_argument("--asset", required=True)
    adapter_export.add_argument("--bundle", required=True, type=Path)
    adapter_seal = commands.add_parser("adapter-seal")
    adapter_seal.add_argument("--bundle", required=True, type=Path)
    adapter_seal.add_argument("--source", required=True, type=Path)
    adapter_import = commands.add_parser("adapter-import")
    adapter_import.add_argument("--run-dir", required=True, type=Path)
    adapter_import.add_argument("--bundle", required=True, type=Path)
    for name in ("result-binding", "reuse-result"):
        command = commands.add_parser(name)
        command.add_argument("--run-dir", required=True, type=Path)
        command.add_argument("--asset", required=True)
        if name == "reuse-result":
            command.add_argument("--source-run", required=True, type=Path)
            command.add_argument("--source-asset", required=True)
    return root


def execute(args) -> dict:
    if args.command == "job-status":
        from .headless import job_status
        return job_status(args.job_dir)
    if args.command == "auto-run":
        from .headless import auto_run, load_provider
        from .common import digest, require
        require(args.allow_provider_calls_and_unreviewed_draft,
                "EXPLICIT_PROVIDER_AND_DRAFT_AUTHORIZATION_REQUIRED")
        config = read_json(args.provider_config)
        return auto_run(args.reference, args.job_dir, load_provider(config),
                        maximum_calls=args.max_generation_calls, timeout_seconds=args.timeout_seconds,
                        authorized=True, provider_binding=digest(config))
    if args.command in {"init", "self-test", "doctor"}:
        from .runtime import doctor, init_plan, self_test
        if args.command == "init":
            return init_plan(args.reference, args.plan, args.id, args.document)
        return self_test() if args.command == "self-test" else doctor()
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
    if args.command in {"result-binding", "reuse-result"}:
        from .cached import result_binding, reuse_result
        if args.command == "result-binding":
            return result_binding(run, args.asset)
        return reuse_result(run, args.asset, args.source_run.resolve(), args.source_asset)
    if args.command == "receive":
        return batch.receive(run, args.asset, args.source)
    if args.command == "recover-receive":
        return batch.recover_receive(run, args.asset, args.source)
    if args.command == "indeterminate":
        return batch.indeterminate(run, args.asset, args.reason)
    if args.command == "status":
        return batch.status(run)
    if args.command == "process":
        return process(run)
    if args.command == "review-template":
        return review_template(run)
    if args.command == "finalize":
        return finalize(run, args.output, draft=args.draft)
    if args.command == "inspect":
        return inspect_delivery(args.delivery)
    if args.command == "export":
        from .psd_export import export_psd
        return export_psd(args.delivery.resolve())
    from .adapter import export_request, import_result, seal_result
    if args.command == "adapter-export":
        return export_request(args.run_dir.resolve(), args.asset, args.bundle)
    if args.command == "adapter-seal":
        return seal_result(args.bundle, args.source)
    return import_result(args.run_dir.resolve(), args.bundle)


def main(argv=None) -> int:
    args = parser().parse_args(argv)
    try:
        result = execute(args)
        print(json.dumps(result, ensure_ascii=False, indent=2, sort_keys=True))
        return 2 if result.get("status") == "failed_no_resubmit" else 0
    except ContractError as exc:
        print(json.dumps({"status": "rejected", "error": type(exc).__name__,
                          "reason": str(exc)}, ensure_ascii=False, sort_keys=True))
        return 2
    except (OSError, RuntimeError, ValueError) as exc:
        print(json.dumps({"status": "rejected", "error": type(exc).__name__,
                          "reason": "LOCAL_INPUT_OR_IO_ERROR"}, ensure_ascii=False,
                         sort_keys=True))
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
