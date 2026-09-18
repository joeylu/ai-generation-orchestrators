"""Reference-to-PNG assets entry, independent of component delivery orchestration.

Reuse the original processing and archive contracts. Do not import the combined
CLI, repository workflow, semantic compiler, or component acceptance modules here.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

from . import __version__
from .common import ContractError, digest, read_json, require


def parser() -> argparse.ArgumentParser:
    root = argparse.ArgumentParser(description="Split reference artwork into named PNG layers; no runtime UI")
    root.add_argument("--version", action="version", version=__version__)
    root.add_argument("--timeline", type=Path)
    from .timeline import CATEGORIES
    root.add_argument("--timing-category", choices=sorted(CATEGORIES), default="unclassified")
    commands = root.add_subparsers(dest="command", required=True)

    def command(name, *paths):
        child = commands.add_parser(name)
        for field in paths:
            child.add_argument("--" + field, type=Path, required=True)
        return child

    init = command("init", "reference", "plan")
    init.add_argument("--id", required=True)
    init.add_argument("--document", required=True)
    command("doctor")
    command("self-test")
    command("check", "plan")
    freeze = command("freeze", "plan", "workspace")
    freeze.add_argument("--run", required=True)
    freeze.add_argument("--material-preflight", choices=("per-image-v1", "after-generation-v1"), default="per-image-v1")
    command("material-preflight", "run-dir", "output")
    auth = command("authorize-generation", "run-dir")
    auth.add_argument("--plan-digest", required=True)
    auth.add_argument("--approval", required=True)
    command("generation-status", "run-dir")
    exchange = command("exchange-generation", "run-dir")
    exchange.add_argument("--request-digest")
    exchange.add_argument("--source", type=Path)
    loop = command("export-loop", "run-dir", "output", "output-root")
    loop.add_argument("--python", type=Path)
    loop.add_argument("--node", default="node")
    for name in ("status", "process", "review-template"):
        command(name, "run-dir")
    final = command("finalize", "run-dir", "output")
    final.add_argument("--draft", action="store_true")
    command("export", "delivery")
    command("inspect", "delivery")
    export = command("adapter-export", "run-dir", "bundle")
    export.add_argument("--asset", required=True)
    command("adapter-seal", "bundle", "source")
    command("adapter-import", "run-dir", "bundle")
    uncertain = command("indeterminate", "run-dir")
    uncertain.add_argument("--asset", required=True)
    uncertain.add_argument("--reason", required=True)
    binding = command("result-binding", "run-dir")
    binding.add_argument("--asset", required=True)
    reuse = command("reuse-result", "run-dir", "source-run")
    reuse.add_argument("--asset", required=True)
    reuse.add_argument("--source-asset", required=True)
    automatic = command("auto-run", "reference", "job-dir", "provider-config")
    automatic.add_argument("--max-generation-calls", type=int, required=True)
    automatic.add_argument("--timeout-seconds", type=int, default=3600)
    automatic.add_argument("--visual-qa-policy", choices=("strict", "advisory"), default="strict")
    automatic.add_argument("--allow-provider-calls-and-unreviewed-draft", action="store_true")
    command("job-status", "job-dir")
    return root


def execute(args) -> dict:
    name = args.command
    if name in {"authorize-generation", "generation-status", "exchange-generation", "export-loop"}:
        from . import assets_generation as generation
        if name == "authorize-generation":
            return generation.authorize(args.run_dir, args.plan_digest, args.approval)
        if name == "generation-status":
            return generation.status(args.run_dir)
        if name == "exchange-generation":
            return generation.exchange(args.run_dir, args.request_digest, args.source)
        return generation.export_loop(args.run_dir, args.output, args.output_root, args.python, args.node)
    if name == "material-preflight":
        from .material_preflight import check_batch
        return check_batch(None, args.run_dir.resolve(), args.output)
    if name in {"doctor", "self-test", "init"}:
        from .runtime import doctor, init_plan, self_test
        if name == "init":
            return init_plan(args.reference, args.plan, args.id, args.document, output_format="png_zip")
        return doctor() if name == "doctor" else self_test()
    if name in {"check", "freeze"}:
        from .contract import validate
        plan = read_json(args.plan)
        require(plan["document"]["format"] == "png_zip", "PNG_ZIP_PLAN_REQUIRED")
        checked = validate(plan, source_base=args.plan.resolve().parent)
        if name == "check":
            return checked
        from .batch import freeze
        return freeze(args.plan, args.workspace, args.run, material_preflight=args.material_preflight)
    if name in {"auto-run", "job-status"}:
        from .headless import auto_run, job_status, load_provider
        if name == "job-status":
            return job_status(args.job_dir)
        require(args.allow_provider_calls_and_unreviewed_draft,
                "EXPLICIT_PROVIDER_AND_DRAFT_AUTHORIZATION_REQUIRED")
        config = read_json(args.provider_config)
        return auto_run(args.reference, args.job_dir, load_provider(config),
                        maximum_calls=args.max_generation_calls, timeout_seconds=args.timeout_seconds,
                        authorized=True, provider_binding=digest(config),
                        visual_qa_policy=args.visual_qa_policy, output_format="png_zip")
    if name in {"process", "review-template"}:
        from .process import process, review_template
        return (process if name == "process" else review_template)(args.run_dir.resolve())
    if name in {"finalize", "inspect"}:
        from .assembly import finalize, inspect_delivery
        if name == "inspect":
            return inspect_delivery(args.delivery.resolve())
        from .batch import load
        _, plan = load(args.run_dir.resolve())
        require(plan["document"]["format"] == "png_zip", "PNG_ZIP_PLAN_REQUIRED")
        return finalize(args.run_dir.resolve(), args.output, draft=args.draft)
    if name == "export":
        from .png_zip import export_png_zip
        return export_png_zip(args.delivery.resolve())
    if name in {"status", "indeterminate"}:
        from .batch import status, indeterminate
        if name == "status":
            return status(args.run_dir.resolve())
        return indeterminate(args.run_dir.resolve(), args.asset, args.reason)
    if name in {"result-binding", "reuse-result"}:
        from .cached import result_binding, reuse_result
        if name == "result-binding":
            return result_binding(args.run_dir.resolve(), args.asset)
        return reuse_result(args.run_dir.resolve(), args.asset, args.source_run.resolve(), args.source_asset)
    from .adapter import export_request, seal_result, import_result
    if name == "adapter-export":
        return export_request(args.run_dir.resolve(), args.asset, args.bundle)
    if name == "adapter-seal":
        return seal_result(args.bundle, args.source)
    if name == "adapter-import":
        return import_result(args.run_dir.resolve(), args.bundle)
    raise ContractError("UNKNOWN_ASSET_COMMAND")


def main(argv=None) -> int:
    args = parser().parse_args(argv)
    try:
        if args.timeline:
            from .timeline import measured
            with measured(args.timeline, args.command, args.timing_category):
                result = execute(args)
        else:
            result = execute(args)
        print(json.dumps(result, ensure_ascii=False, indent=2, sort_keys=True))
        status = result.get("status")
        if isinstance(status, dict):
            status = status.get("status")
        return 2 if status in {"failed", "failed_no_resubmit", "failed_visual_qa", "timed_out", "indeterminate", "rejected"} else 0
    except (ContractError, OSError, RuntimeError, ValueError) as exc:
        print(json.dumps({"status": "rejected", "error": type(exc).__name__,
                          "reason": str(exc) if isinstance(exc, ContractError) else "LOCAL_INPUT_OR_IO_ERROR"}))
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
