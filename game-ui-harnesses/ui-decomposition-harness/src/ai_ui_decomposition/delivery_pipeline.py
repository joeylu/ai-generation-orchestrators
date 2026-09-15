"""One bounded, local entry for existing v2 artwork -> verified draft.

No provider, arbitrary commands, automatic repairs or generated acceptance data.
Every stage runs the versioned public tool and final conclusions come from its
actual receipt, never directory names or caller-written status strings.
"""
import math
from pathlib import Path
import shutil
import subprocess
import zipfile

from .acceptance_execution import AcceptanceExecution
from .common import ContractError, read_json, require, safe_relative, sha256, write_json


def _input(base, entry):
    require(isinstance(entry,dict) and set(entry)=={'path','sha256'},'DELIVERY_RUN_INPUT')
    path=safe_relative(base,entry['path'])
    require(path.is_file() and sha256(path)==entry['sha256'],'DELIVERY_RUN_INPUT_CHANGED')
    return path


def validate_state_receipt(receipt, handoff_sha):
    require(receipt.get('kind')=='ui_state_acceptance_v1' and receipt.get('status')=='technical_passed'
            and receipt.get('handoffSha256')==handoff_sha and receipt.get('scope',{}).get('mode')=='full'
            and receipt.get('layoutCoverage')=='required_checked'
            and receipt.get('visualObservationCoverage')=='checked'
            and bool(receipt.get('visualObservationSha256')),'DELIVERY_RUN_STATEFUL_RECEIPT_REQUIRED')


def compile_world_regions(inspection, canvas):
    """Derive screenshot rectangles from actual renderer bounds, not local props."""
    regions=[]
    for node in inspection['nodes']:
        if not node.get('visible'): continue
        b=node['bounds']
        x=max(0,math.floor(b['x']));y=max(0,math.floor(b['y']))
        right=min(canvas['width'],math.ceil(b['x']+b['width']))
        bottom=min(canvas['height'],math.ceil(b['y']+b['height']))
        if right>x and bottom>y:
            regions.append(dict(id=node['id'],bounds=[x,y,right-x,bottom-y]))
    return dict(kind='ui_runtime_regions_v1',coordinateSpace='runtime-world',regions=regions,
                source='actual-default-inspection',human_visual_acceptance=False)


def run_delivery(plan_path, component_root, output, timeout_seconds=1200):
    from .stateful import accept
    from .studio_acceptance import run_studio
    execution=AcceptanceExecution(timeout_seconds)
    require(not output.exists(),'OUTPUT_EXISTS');output.mkdir(parents=True)
    report=dict(kind='ui_delivery_run_v1',status='failed',human_visual_acceptance=False,
                mediaCalls=0,automaticRepairs=0,outputRole='unreviewed_draft',
                latencyScope='existing-v2-artwork-through-local-acceptance; generation excluded')
    target=output/'ui.component-handoff.draft.zip'
    try:
        execution.start('plan')
        plan=read_json(plan_path)
        require(set(plan)=={'kind','source','stateEvidence'} and plan['kind']=='ui_delivery_run_plan_v1','DELIVERY_RUN_PLAN')
        base=plan_path.resolve().parent
        source=_input(base,plan['source']);evidence=_input(base,plan['stateEvidence'])
        require(read_json(evidence).get('handoffSha256')==sha256(source),'DELIVERY_RUN_EVIDENCE_CHANGED')
        with zipfile.ZipFile(source) as archive:
            require(len(archive.namelist())==len(set(archive.namelist())),'DELIVERY_RUN_DUPLICATE_MEMBER')
            require(sum(i.file_size for i in archive.infolist())<=256*1024*1024,'DELIVERY_RUN_ARCHIVE_LIMIT')
            for name in archive.namelist():safe_relative(output,name)
            import json
            manifest=json.loads(archive.read('handoff.json'))
            require(manifest.get('kind')=='ai_ui_component_handoff_v2' and manifest.get('human_visual_acceptance') is False,
                    'DELIVERY_RUN_V2_DRAFT_REQUIRED')
        report.update(sourceSha256=sha256(source),planSha256=sha256(plan_path),stateEvidenceSha256=sha256(evidence))
        # Freeze one input for all subsequent stages, even if a caller edits source.
        candidate=output/'candidate.zip';shutil.copyfile(source,candidate)
        require(sha256(candidate)==report['sourceSha256'],'DELIVERY_RUN_SOURCE_CHANGED')
        execution.start('stateful-and-layout')
        state=accept(candidate,evidence,component_root,output/'stateful',timeout_seconds=max(1,math.floor(execution.remaining())),require_visual_layout=True)
        validate_state_receipt(state,report['sourceSha256'])
        report['stateful']=dict(status=state['status'],receiptSha256=sha256(output/'stateful/acceptance.json'))
        capture=read_json(output/'stateful/default-capture.json')
        require(capture.get('kind')=='ui_runtime_capture_v1' and capture.get('handoffSha256')==report['sourceSha256']
                and capture.get('bundleSha256')==sha256(output/'stateful/consumed.json'),'DELIVERY_RUN_CAPTURE_CHANGED')
        _input(output/'stateful',capture['screenshot'])
        inspection=read_json(_input(output/'stateful',capture['inspection']),max_bytes=64*1024*1024)
        bundle=read_json(output/'stateful/consumed.json',max_bytes=64*1024*1024)
        write_json(output/'runtime-regions.json',compile_world_regions(inspection,bundle['document']['canvas']))
        execution.start('studio-roundtrip')
        require(execution.remaining()>11,'DELIVERY_RUN_STUDIO_BUDGET')
        studio=run_studio(candidate,component_root,output/'studio',min(1800,math.floor(execution.remaining())-10))
        require(studio['status']=='technical_passed' and studio['referenceEvidence']['status']=='byte_identical','DELIVERY_RUN_STUDIO_RECEIPT_REQUIRED')
        report['studio']=dict(status=studio['status'],receiptSha256=sha256(output/'studio/receipt.json'))
        execution.start('reference-comparison')
        # This official command owns mapping/replay/unknown handling. Its report
        # remains distinct from the real-input stateful and Studio receipts.
        result=subprocess.run(['node',str(component_root/'scripts/cli.mjs'),'reference-accept',str(candidate),'--output',str(output/'reference')],
                              capture_output=True,text=True,timeout=execution.remaining())
        ref=read_json(output/'reference/report.json',max_bytes=64*1024*1024)
        require(ref.get('kind')=='ui-reference-acceptance-report' and ref.get('inputSha256')==report['sourceSha256']
                and ref.get('status') in ('technical_passed','visual_failed','blocked','partially_verified')
                and result.returncode in (0,2,3),'DELIVERY_RUN_REFERENCE_FAILED')
        report['referenceComparison']=dict(status=ref['status'],unknownFields=ref.get('unknownFields',[]),receiptSha256=sha256(output/'reference/report.json'))
        if ref['status']=='technical_passed':
            comparison=ref.get('comparison',{})
            require(not ref.get('unknownFields') and comparison.get('counts',{}).get('passed',0)>0
                    and comparison.get('counts',{}).get('failed')==0 and comparison.get('counts',{}).get('unverified')==0
                    and any(s.get('status')=='passed' and s.get('pixels',0)>0 for s in comparison.get('scopes',[])),
                    'DELIVERY_RUN_REFERENCE_COVERAGE_REQUIRED')
        if ref['status']!='technical_passed':execution.finish('blocked' if ref['status']=='blocked' else 'failed')
        execution.start('publish')
        # A visual failure is a diagnosis, never an accepted final ZIP.
        if ref['status']=='technical_passed':
            shutil.copyfile(candidate,target)
            require(sha256(target)==report['sourceSha256'],'DELIVERY_RUN_OUTPUT_CHANGED')
            report['status']='machine_checks_passed_human_review_required'
            report['delivery']=dict(path=target.name,sha256=sha256(target))
        else:
            report['status']='blocked_reference' if ref['status']=='blocked' else 'failed_visual_qa'
            report['diagnosticCandidate']=dict(path=candidate.name,sha256=sha256(candidate))
            execution.finish('not_run')
        execution.remaining()
    except subprocess.TimeoutExpired:
        report['error']='DELIVERY_RUN_TIMEOUT'
    except (ContractError,OSError,ValueError,KeyError,zipfile.BadZipFile) as exc:
        report['error']=str(exc) if isinstance(exc,ContractError) else 'DELIVERY_RUN_INVALID_INPUT_OR_TOOL_OUTPUT'
    finally:
        if report['status']!='machine_checks_passed_human_review_required':target.unlink(missing_ok=True)
        report['execution']=execution.report(failed=report['status']=='failed')
        write_json(output/'delivery-run.json',report)
    return report
