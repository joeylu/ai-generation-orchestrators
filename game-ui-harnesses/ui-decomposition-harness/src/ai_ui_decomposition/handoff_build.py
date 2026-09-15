"""Compile a data-only plan from a verified processed run; never author receipts.

The existing finalizer owns scene/delivery bytes. The official consumer owns the
semantic digest and import. This entry fills binding hashes and emits the next
run plan, so an Agent does not need a sample-specific packaging script.
"""
import copy
import json
import math
from pathlib import Path
import shutil
import subprocess

from .common import read_json, require, safe_relative, sha256, write_json
from .delivery_pipeline import _input


def build_handoff(plan_path, component_root, output, execution):
    from .assembly import finalize
    from .png_zip import export_png_zip
    from .component_handoff import export_component_handoff
    from .layout_gate import check_layout_requirements
    require(not output.exists(),'OUTPUT_EXISTS');output.mkdir(parents=True)
    plan=read_json(plan_path,max_bytes=64*1024*1024);base=plan_path.resolve().parent
    required={'kind','run','componentBundle','appearance','referenceOriginal','referenceState',
              'acceptanceScope','referenceMapping','layoutSpacing','layoutRequirements','visualObservations','stateEvidence'}
    require(set(plan)==required and plan['kind']=='ui_handoff_build_plan_v1','HANDOFF_BUILD_PLAN')
    run=plan['run'];require(set(run)=={'path','batchSha256','materialsSha256'},'HANDOFF_BUILD_RUN')
    directory=safe_relative(base,run['path'])
    require(sha256(directory/'batch.json')==run['batchSha256'] and
            sha256(directory/'materials/materials.json')==run['materialsSha256'],'HANDOFF_BUILD_RUN_CHANGED')
    names=('componentBundle','referenceOriginal','referenceState','acceptanceScope','referenceMapping',
           'layoutSpacing','layoutRequirements','visualObservations')
    paths={k:_input(base,plan[k]) for k in names}
    appearance=copy.deepcopy(plan['appearance'])
    require(set(appearance)=={'registration','bindings'},'HANDOFF_BUILD_APPEARANCE')
    require(set(plan['stateEvidence'])=={'kind','components'} and plan['stateEvidence']['kind']=='ui_state_evidence_v1',
            'HANDOFF_BUILD_STATE_SPEC')
    execution.start('finalize-materials')
    receipt=finalize(directory,output/'assembly',draft=True)
    archive=export_png_zip(output/'assembly',additional_export=True)
    execution.start('compile-contracts')
    # Canonical document hash is computed by the current official consumer.
    script="import fs from 'node:fs';import {validateBundle} from './lib/bundle.js';import {appearanceDocumentSha256} from './lib/appearance-binding.js';const b=await validateBundle(JSON.parse(fs.readFileSync(process.argv[1],'utf8')));console.log(await appearanceDocumentSha256(b.document));"
    result=subprocess.run(['node','--input-type=module','-e',script,str(paths['componentBundle'])],cwd=component_root,
                          capture_output=True,text=True,timeout=execution.remaining())
    require(result.returncode==0,'HANDOFF_BUILD_DOCUMENT_INVALID')
    appearance.update(kind='ui-appearance-binding',version='0.2',documentSha256=result.stdout.strip(),
                      deliveryDigest=receipt['digest'],sceneSha256=sha256(output/'assembly/scene.json'),archiveSha256=archive['zip_sha256'])
    write_json(output/'appearance-binding.json',appearance)
    exported=export_component_handoff(output/'assembly',paths['componentBundle'],output/'appearance-binding.json',
        reference_original=paths['referenceOriginal'],reference_state=paths['referenceState'],
        acceptance_scope=paths['acceptanceScope'],reference_mapping=paths['referenceMapping'],layout_spacing=paths['layoutSpacing'])
    candidate=output/'assembly'/exported['file']
    result=subprocess.run(['node',str(component_root/'scripts/cli.mjs'),'component-handoff',str(candidate),'--output',str(output/'consumed.json')],
                          capture_output=True,text=True,timeout=execution.remaining())
    require(result.returncode==0,'HANDOFF_BUILD_IMPORT_FAILED')
    checks=check_layout_requirements(read_json(output/'consumed.json',max_bytes=64*1024*1024),read_json(paths['layoutRequirements']),read_json(paths['visualObservations']))
    write_json(output/'layout-check.json',checks)
    require(checks['status']=='passed','HANDOFF_BUILD_LAYOUT_REJECTED')
    inputs=output/'acceptance-inputs';inputs.mkdir()
    def copy_input(source,name):
        target=inputs/name;shutil.copyfile(source,target)
        require(sha256(target)==sha256(source),'HANDOFF_BUILD_COPY_CHANGED')
        return dict(path=name,sha256=sha256(target))
    source_ref=copy_input(candidate,'source.zip')
    evidence=copy.deepcopy(plan['stateEvidence'])
    evidence.update(handoffSha256=source_ref['sha256'],reference=copy_input(paths['referenceOriginal'],'reference'+paths['referenceOriginal'].suffix),
                    visualObservations=copy_input(paths['visualObservations'],'observations.json'),
                    layoutRequirements=copy_input(paths['layoutRequirements'],'layout.json'))
    write_json(inputs/'evidence.json',evidence)
    write_json(inputs/'run-plan.json',dict(kind='ui_delivery_run_plan_v1',source=source_ref,stateEvidence=dict(path='evidence.json',sha256=sha256(inputs/'evidence.json'))))
    return inputs/'run-plan.json'


def build_and_run(plan_path,component_root,output,timeout_seconds=1200):
    from .acceptance_execution import AcceptanceExecution
    from .delivery_pipeline import run_delivery
    execution=AcceptanceExecution(timeout_seconds)
    require(not output.exists(),'OUTPUT_EXISTS');output.mkdir(parents=True)
    report=dict(kind='ui_handoff_job_v1',status='failed',mediaCalls=0,human_visual_acceptance=False,
                latencyScope='verified processed materials to local delivery; generation excluded')
    try:
        execution.start('plan')
        run_plan=build_handoff(plan_path,component_root,output/'build',execution)
        execution.start('acceptance')
        result=run_delivery(run_plan,component_root,output/'acceptance',max(1,math.floor(execution.remaining())))
        report.update(status=result['status'],acceptanceReceiptSha256=sha256(output/'acceptance/delivery-run.json'))
        if 'delivery' in result:report['delivery']={**result['delivery'],'path':'acceptance/'+result['delivery']['path']}
        execution.finish('passed' if report['status']=='machine_checks_passed_human_review_required' else 'blocked' if report['status']=='blocked_reference' else 'failed')
        execution.remaining()
    except Exception as exc:
        # Preserve the failed stage and diagnostics; no automatic second attempt.
        report['error']=str(exc) if isinstance(exc,ValueError) else type(exc).__name__
    finally:
        report['execution']=execution.report(failed=report['status']=='failed')
        write_json(output/'handoff-job.json',report)
    return report
