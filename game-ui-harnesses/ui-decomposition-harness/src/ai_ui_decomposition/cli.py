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
    delivery_run=commands.add_parser('delivery-run',help='Bounded local v2 layout, real-state, Studio and reference acceptance; no media')
    for name in ('plan','component-root','output'):delivery_run.add_argument('--'+name,required=True,type=Path)
    delivery_run.add_argument('--timeout-seconds',type=int,default=1200)
    handoff_job=commands.add_parser('handoff-job',help='Compile one data-only plan from verified processed materials and run local acceptance; no media')
    for name in ('plan','component-root','output'):handoff_job.add_argument('--'+name,required=True,type=Path)
    handoff_job.add_argument('--timeout-seconds',type=int,default=1200)
    revision=commands.add_parser('appearance-revision',help='Deterministic official semantic/layout revision preserving v2 artwork and reference bytes')
    for name in ('source','bundle','binding','component-root','output'):revision.add_argument('--'+name,required=True,type=Path)
    revision.add_argument('--derived-states',type=Path,help='Append explicit authorized derived state descriptions; never replace observed state or comparison scope')
    studio = commands.add_parser('studio-acceptance', help='Local real Studio scroll input and complete save/export roundtrip; no media')
    for name in ('source','component-root','output'):
        studio.add_argument('--'+name, required=True, type=Path)
    studio.add_argument('--timeout-seconds',type=int,default=600)
    composition = commands.add_parser('composition-check', help='Evidence-bound background ownership and advisory visible row spacing')
    for name in ('bundle','screenshot','plan','output'):
        composition.add_argument('--'+name,required=True,type=Path)
    capability = commands.add_parser('capability-check', help='Check explicit component layout/state requirements before media generation')
    capability.add_argument('--request', required=True, type=Path)
    capability.add_argument('--output', required=True, type=Path)
    approval=commands.add_parser('execution-authorize',help='Record explicit approval for a frozen bounded request envelope; no generation')
    approval.add_argument('--run-dir',required=True,type=Path)
    approval.add_argument('--approval',required=True)
    issue=commands.add_parser('execution-issue',help='Record a hash-bound blocking observation for a known returned result')
    issue.add_argument('--run-dir',required=True,type=Path)
    for field in ('asset','category','evidence'):issue.add_argument('--'+field,required=True)
    select=commands.add_parser('execution-select',help='Select successful frozen requests into a zero-call reuse plan')
    for field in ('run-dir','source-plan','output'):select.add_argument('--'+field,required=True,type=Path)
    value_text = commands.add_parser('value-text-handoff', help='Attach explicit valueTextBindings through the official consumer CLI')
    for name in ('source', 'bindings', 'component-root', 'output'):
        value_text.add_argument('--'+name, required=True, type=Path)
    repair = commands.add_parser('material-repair-plan', help='Compile an offline replacement plan; no generation')
    for name in ('run-dir', 'source-plan', 'audit', 'output'):
        repair.add_argument('--'+name, required=True, type=Path)
    repair.add_argument('--id', required=True)
    repair.add_argument('--reuse-source-run', action='append', type=Path, default=[])
    audit = commands.add_parser('material-audit', help='Offline functional material triage; no compute or export approval')
    audit.add_argument('--run-dir', required=True, type=Path)
    audit.add_argument('--output', required=True, type=Path)
    audit.add_argument('--observations', type=Path)
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
    freeze.add_argument('--capabilities', type=Path, help='Explicit plan-bound component capability request; unsupported profiles block freeze')
    freeze.add_argument('--component-document',type=Path,help='Semantic document/bundle for required spacing preflight')
    freeze.add_argument('--layout-spacing',type=Path,help='Explicit producer spacing plan 1.1')
    freeze.add_argument('--execution-policy',type=Path,help='Frozen conditional replacement requests and bounded compute envelope')
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
    component_handoff.add_argument('--layout-spacing',type=Path,help='Required spacing plan 1.1 for ScrollView or Panel buttons')
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
    if args.command=='handoff-job':
        from .handoff_build import build_and_run
        return build_and_run(args.plan.resolve(),args.component_root.resolve(),args.output.resolve(),args.timeout_seconds)
    if args.command=='delivery-run':
        from .delivery_pipeline import run_delivery
        return run_delivery(args.plan.resolve(),args.component_root.resolve(),args.output.resolve(),args.timeout_seconds)
    if args.command=='appearance-revision':
        from .appearance_revision import revise
        return revise(args.source.resolve(),args.bundle.resolve(),args.binding.resolve(),args.component_root.resolve(),args.output.resolve(),args.derived_states.resolve() if args.derived_states else None)
    if args.command=='studio-acceptance':
        from .studio_acceptance import run_studio
        return run_studio(args.source.resolve(),args.component_root.resolve(),args.output.resolve(),args.timeout_seconds)
    if args.command=='composition-check':
        from .studio_acceptance import run_composition
        return run_composition(args.bundle.resolve(),args.screenshot.resolve(),args.plan.resolve(),args.output.resolve())
    if args.command=='execution-authorize':
        from .bounded_execution import authorize
        return authorize(args.run_dir,args.approval)
    if args.command=='execution-issue':
        from .bounded_execution import issue
        return issue(args.run_dir,args.asset,args.category,args.evidence)
    if args.command=='execution-select':
        from .bounded_execution import select_plan
        return select_plan(args.run_dir,args.source_plan,args.output)
    if args.command == 'capability-check':
        from .capabilities import check_file
        return check_file(args.request,args.output)
    if args.command == 'value-text-handoff':
        from .value_text_handoff import attach
        return attach(args.source.resolve(), args.bindings.resolve(), args.component_root.resolve(), args.output.resolve())
    if args.command == 'material-repair-plan':
        from .material_repair import compile_plan
        return compile_plan(args.run_dir.resolve(), args.source_plan.resolve(), args.audit.resolve(),
                            args.output.resolve(), args.id, args.reuse_source_run)
    if args.command == 'material-audit':
        from .material_audit import audit
        return audit(args.run_dir.resolve(), args.output.resolve(), args.observations)
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
                                        reference_mapping=args.reference_mapping, reference_derived=args.reference_derived,
                                        layout_spacing=args.layout_spacing)
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
        return batch.freeze(args.plan, args.workspace, args.run, capability_request=args.capabilities, execution_policy=args.execution_policy, component_document=args.component_document, layout_spacing=args.layout_spacing)
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
        return 2 if result.get("status") in {"failed", "blocked_reference", "failed_no_resubmit", "failed_visual_qa", "needs_repair", "capability_blocked"} else 0
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
