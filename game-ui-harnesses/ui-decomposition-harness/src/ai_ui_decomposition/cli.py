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
    studio = commands.add_parser('studio-acceptance', help='Local real Studio scroll input and complete save/export roundtrip; no media')
    for name in ('source','component-root','output'):
        studio.add_argument('--'+name, required=True, type=Path)
    studio.add_argument('--timeout-seconds',type=int,default=600)
    composition = commands.add_parser('composition-check', help='Evidence-bound background ownership and advisory visible row spacing')
    for name in ('bundle','screenshot','plan','output'):
        composition.add_argument('--'+name,required=True,type=Path)
    strategy = commands.add_parser("material-strategy", help="Separate control geometry from comparable icon boards; no generation")
    strategy.add_argument("--observations", required=True, type=Path)
    strategy.add_argument("--output", required=True, type=Path)
    delivery_check = commands.add_parser("delivery-check", help="Bound state, font and runtime visual pre-delivery checks")
    delivery_check.add_argument("--config", required=True, type=Path)
    delivery_check.add_argument("--output", required=True, type=Path)
    region_qa = commands.add_parser("region-qa", help="Offline same-state regional pixel comparison")
    for name in ("reference", "rendered", "policy", "output"):
        region_qa.add_argument("--" + name, required=True, type=Path)
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
    automatic.add_argument("--visual-qa-policy", choices=("strict", "advisory"), default="strict")
    automatic.add_argument("--output-format", choices=("psd", "png_zip"), default="psd")
    automatic.add_argument("--allow-provider-calls-and-unreviewed-draft", action="store_true")
    job_status = commands.add_parser("job-status")
    job_status.add_argument("--job-dir", required=True, type=Path)
    inspect = commands.add_parser("inspect")
    inspect.add_argument("--delivery", required=True, type=Path)
    export = commands.add_parser("export")
    export.add_argument("--delivery", required=True, type=Path)
    export.add_argument("--format", choices=("png_zip",), help="Additional ZIP export from an existing verified delivery; does not rewrite its plan")
    component_handoff = commands.add_parser(
        "component-handoff", help="Package one self-contained ZIP for ui-component-harness")
    component_handoff.add_argument("--delivery", required=True, type=Path)
    component_handoff.add_argument("--component-bundle", required=True, type=Path)
    component_handoff.add_argument("--appearance-binding", required=True, type=Path)
    component_handoff.add_argument('--legacy-without-reference', action='store_true', help='Explicitly export a legacy runtime-only package, not visual-comparison ready')
    for option in ('reference-original', 'reference-state', 'acceptance-scope', 'reference-mapping', 'reference-derived'):
        component_handoff.add_argument('--' + option, type=Path)
    switch_handoff = commands.add_parser('switch-state-handoff', help='Offline authenticated Switch stateImages rebind; preserve reference bytes')
    for option in ('source', 'binding', 'component-root', 'output'):
        switch_handoff.add_argument('--' + option, required=True, type=Path)
    upgrade = commands.add_parser('reference-handoff', help='Create a v2 self-contained reference ZIP from an existing draft; offline')
    for option in ('source', 'original', 'state', 'scope', 'mapping', 'output'):
        upgrade.add_argument('--' + option, required=True, type=Path)
    upgrade.add_argument('--derived', type=Path)
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
    split_board = commands.add_parser(
        "split-board", help="Offline split of a native-transparent 4x4 component asset board")
    split_board.add_argument("--source", required=True, type=Path)
    split_board.add_argument("--output", required=True, type=Path)
    split_board.add_argument("--document", required=True)
    supplemental = commands.add_parser(
        "split-supplemental-boards",
        help="Offline split of native-transparent 4x6 interactive and 4x3 structural role boards")
    supplemental.add_argument("--interactive", required=True, type=Path)
    supplemental.add_argument("--structural", required=True, type=Path)
    supplemental.add_argument("--output", required=True, type=Path)
    supplemental.add_argument("--document", required=True)
    for name in ("result-binding", "reuse-result"):
        command = commands.add_parser(name)
        command.add_argument("--run-dir", required=True, type=Path)
        command.add_argument("--asset", required=True)
        if name == "reuse-result":
            command.add_argument("--source-run", required=True, type=Path)
            command.add_argument("--source-asset", required=True)
    return root


def execute(args) -> dict:
    if args.command=='studio-acceptance':
        from .studio_acceptance import run_studio
        return run_studio(args.source.resolve(),args.component_root.resolve(),args.output.resolve(),args.timeout_seconds)
    if args.command=='composition-check':
        from .studio_acceptance import run_composition
        return run_composition(args.bundle.resolve(),args.screenshot.resolve(),args.plan.resolve(),args.output.resolve())
    if args.command == "material-strategy":
        from .material_strategy import write_strategy
        return write_strategy(args.observations,args.output)
    if args.command == "delivery-check":
        from .delivery_check import check_delivery
        return check_delivery(args.config, args.output)
    if args.command == "region-qa":
        from .region_qa import compare_regions
        return compare_regions(args.reference, args.rendered, args.policy, args.output)
    if args.command == "component-handoff":
        from .component_handoff import export_component_handoff
        from .common import require
        require(args.legacy_without_reference or all((args.reference_original, args.reference_state, args.acceptance_scope, args.reference_mapping)), 'REFERENCE_ARGUMENTS_REQUIRED')
        require(not args.legacy_without_reference or not any((args.reference_original, args.reference_state, args.acceptance_scope, args.reference_mapping, args.reference_derived)), 'REFERENCE_LEGACY_ARGUMENT_CONFLICT')
        return export_component_handoff(args.delivery, args.component_bundle,
                                        args.appearance_binding, reference_original=args.reference_original,
                                        reference_state=args.reference_state, acceptance_scope=args.acceptance_scope,
                                        reference_mapping=args.reference_mapping, reference_derived=args.reference_derived)
    if args.command == 'switch-state-handoff':
        from .switch_handoff import rebind
        return rebind(args.source.resolve(), args.binding.resolve(), args.component_root.resolve(), args.output.resolve())
    if args.command == 'reference-handoff':
        from .reference_delivery import upgrade_reference_handoff
        return upgrade_reference_handoff(args.source, args.original, args.state, args.scope, args.mapping, args.output, args.derived)
    if args.command == "split-supplemental-boards":
        from .supplemental_boards import split_supplemental_boards
        return split_supplemental_boards(
            args.interactive, args.structural, args.output, args.document)
    if args.command == "split-board":
        from .asset_board import split_asset_board
        return split_asset_board(args.source, args.output, args.document)
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
                        authorized=True, provider_binding=digest(config),
                        visual_qa_policy=args.visual_qa_policy, output_format=args.output_format)
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
        scene = read_json(args.delivery.resolve() / "scene.json")
        if scene["document"]["format"] == "png_zip" or getattr(args, "format", None) == "png_zip":
            from .png_zip import export_png_zip
            return export_png_zip(args.delivery.resolve(), additional_export=getattr(args, "format", None) == "png_zip")
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
        return 2 if result.get("status") in {"failed_no_resubmit", "failed_visual_qa"} else 0
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
