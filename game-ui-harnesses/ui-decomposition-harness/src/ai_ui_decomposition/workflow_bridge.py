"""Local single-writer file transport. Never invokes or resubmits a provider.

The existing batch dispatch order is authoritative (serial unless its contract
permits otherwise). Export is a one-use assignment, not proof of a media call.
"""
from contextlib import contextmanager
from pathlib import Path
import re
import time

from . import batch, workflow as w
from .adapter import export_request, seal_result, import_result, _verified_handoff,builtin_image_arguments
from .common import require, safe_relative, sha256, write_json,read_json,ContractError


@contextmanager
def _lock(job):
    path=Path(job)/'bridge.lock'
    handle=path.open('x')
    try: yield
    finally: handle.close();path.unlink()


def _run(job,rows):
    ref=rows['freeze']['artifacts']['batch']
    path=safe_relative(job/'nodes/freeze/output',ref['path'])
    require(sha256(path)==ref['sha256'],'BRIDGE_BATCH_CHANGED')
    return path.parent


def pending_status(job,spec,start,rows):
    directory=job/'nodes/generate';marker=w._read(directory/'bridge.json')
    require(marker['startDigest']==start['digest'] and marker['jobDigest']==spec['digest'],'BRIDGE_BINDING')
    run=_run(job,rows);frozen,_=batch.load(run)
    require(marker['batchDigest']==frozen['digest'],'BRIDGE_BATCH_CHANGED')
    state='awaiting_external';progress=[]
    for key in frozen['dispatch_order']:
        bundle=directory/'output/requests'/key
        current=batch.state(run,frozen['requests'][key])
        if current=='prepared':
            if bundle.exists():state='indeterminate'
            continue
        if not (bundle/'assignment.json').exists():state='indeterminate';continue
        assignment=w._read(bundle/'assignment.json');handoff=_verified_handoff(bundle)
        entry=frozen['requests'][key]
        require(assignment['startDigest']==start['digest'] and assignment['handoffDigest']==handoff['digest']
                and assignment['requestDigest']==handoff['request_digest']
                and handoff['request_id']==entry['id'] and sha256(bundle/'request.json')==entry['request_sha256']
                and handoff['batch_digest']==frozen['digest'] and handoff['asset']==key,'BRIDGE_ASSIGNMENT_CHANGED')
        require(not bundle.is_symlink() and all(not p.is_symlink() for p in bundle.rglob('*')),'BRIDGE_SYMLINK')
        phase='assigned';submission=None
        if (bundle/'submission.json').exists():
            submission=w._read(bundle/'submission.json')
            require(submission['assignmentDigest']==assignment['digest'] and
                submission['arguments']==builtin_image_arguments(bundle),'BRIDGE_SUBMISSION_CHANGED')
            phase='invocation_recorded'
        if current=='received':
            if not (bundle/'accepted.json').exists():state='indeterminate';continue
            accepted=w._read(bundle/'accepted.json')
            require(accepted['assignmentDigest']==assignment['digest'] and
                    sha256(bundle/'result.png')==accepted['imageSha256'] and
                    sha256(bundle/'result.json')==accepted['manifestSha256'],'BRIDGE_RESULT_CHANGED')
            if spec.get('fileBridgeVersion')=='1.1':
                require(submission is not None and accepted['submissionDigest']==submission['digest'],'BRIDGE_SUBMISSION_CHANGED')
            phase='received'
        elif current=='reserved' and ((bundle/'result.png').exists() or (bundle/'result.json').exists()):
            state='indeterminate'
        elif current!='reserved':state='indeterminate'
        progress.append(dict(request=key,phase=phase,invocationRecordedAt=submission['recordedAt'] if submission else None))
    elapsed=max(0,time.time()-start['startedAt'])
    if elapsed>=marker['timeoutSeconds']:state='timed_out'
    return dict(status=state,node='generate',external=True,elapsedSeconds=elapsed,requests=progress)


def record_submission(job,request_digest,arguments_path):
    """Caller records exact arguments immediately BEFORE its one tool call."""
    job,spec=w._load(job)
    with _lock(job):
        require(w.inspect_job(job)['status']=='awaiting_external','BRIDGE_NOT_WAITING')
        rows=w._receipts(job,spec);w._authorization(job,spec,rows)
        root=job/'nodes/generate/output/requests'
        matches=[p.parent for p in root.glob('*/assignment.json') if w._read(p)['requestDigest']==request_digest]
        require(len(matches)==1,'BRIDGE_REQUEST_DIGEST');bundle=matches[0]
        require(not (bundle/'accepted.json').exists(),'BRIDGE_RESULT_ALREADY_RECEIVED')
        arguments=read_json(Path(arguments_path));require(arguments==builtin_image_arguments(bundle),'BRIDGE_SUBMISSION_ARGUMENTS_MISMATCH')
        row=w._record(bundle/'submission.json',dict(version='1.0',assignmentDigest=w._read(bundle/'assignment.json')['digest'],
            arguments=arguments,recordedAt=time.time(),evidenceBasis='caller-recorded invocation intent; not provider execution attestation'))
        return dict(requestDigest=request_digest,submissionDigest=row['digest'],recordedAt=row['recordedAt'])


def export_generation(job):
    job,spec=w._load(job)
    require(spec['factory']=='ai_ui_decomposition.repository_workflow:create' and
            spec['options'].get('generationMode')=='file','BRIDGE_MODE_REQUIRED')
    with _lock(job):
        status=w.inspect_job(job);rows=w._receipts(job,spec)
        require(status['status'] in ('ready','awaiting_external'),'BRIDGE_NOT_READY')
        require(status['nextNode']=='generate' or status['status']=='awaiting_external','BRIDGE_NOT_GENERATION')
        w._authorization(job,spec,rows)
        run=_run(job,rows);frozen,plan=batch.load(run)
        require(rows['freeze']['data']['planDigest']==w.digest(plan) and
                rows['freeze']['data']['maximumCalls']==frozen['maximum_calls'],'BRIDGE_PLAN_CHANGED')
        directory=job/'nodes/generate'
        if not directory.exists():
            remaining=spec['activeTimeout']-status['activeSeconds']
            require(remaining>0,'BRIDGE_BUDGET_EXHAUSTED')
            directory.mkdir(parents=True)
            start=w._record(directory/'started.json',dict(jobDigest=spec['digest'],node='generate',
                dependencies={k:v['digest'] for k,v in rows.items()},startedAt=time.time()))
            (directory/'output').mkdir()
            w._record(directory/'bridge.json',dict(version='1.0',jobDigest=spec['digest'],startDigest=start['digest'],
                batchDigest=frozen['digest'],timeoutSeconds=min(spec['stageTimeout'],remaining),automaticRetries=0))
        start=w._read(directory/'started.json')
        key=next((k for k in frozen['dispatch_order'] if batch.state(run,frozen['requests'][k])!='received'),None)
        require(key is not None,'BRIDGE_NO_PENDING_REQUEST')
        require(batch.state(run,frozen['requests'][key])=='prepared','BRIDGE_ALREADY_ASSIGNED_NO_RESUBMIT')
        bundle=directory/'output/requests'/key
        handoff=export_request(run,key,bundle)
        assignment=w._record(bundle/'assignment.json',dict(version='1.0',startDigest=start['digest'],
            handoffDigest=handoff['digest'],requestDigest=handoff['request_digest'],automaticRetries=0,
            evidenceBasis='one-use file assignment; not provider invocation attestation'))
        return dict(**w.inspect_job(job),request=key,requestDigest=assignment['requestDigest'],bundle=str(bundle))


def receive_generation(job,request_digest,source):
    job,spec=w._load(job)
    with _lock(job):
        require(w.inspect_job(job)['status']=='awaiting_external','BRIDGE_NOT_WAITING')
        rows=w._receipts(job,spec);w._authorization(job,spec,rows)
        run=_run(job,rows);frozen,_=batch.load(run);directory=job/'nodes/generate';out=directory/'output'
        bundles=[p.parent for p in (out/'requests').glob('*/assignment.json')
                 if w._read(p)['requestDigest']==request_digest]
        require(len(bundles)==1,'BRIDGE_REQUEST_DIGEST')
        bundle=bundles[0];assignment=w._read(bundle/'assignment.json')
        require(batch.state(run,frozen['requests'][bundle.name])=='reserved','BRIDGE_RESULT_ALREADY_RECEIVED')
        if spec.get('fileBridgeVersion')=='1.1':require((bundle/'submission.json').is_file(),'BRIDGE_SUBMISSION_REQUIRED')
        # Existing adapter validates actual PNG bytes, request binding and copy identity.
        seal_result(bundle,Path(source))
        comp='compile_repaired' if 'compile_repaired' in rows else 'compile'
        planref=rows[comp]['artifacts']['plan']
        compiled=safe_relative(job/'nodes'/comp/'output',planref['path']).parent
        from .material_preflight import check_material
        try:check_material(compiled,bundle.name,bundle/'result.png')
        except ContractError as exc:
            code=str(exc) if re.fullmatch(r'[A-Z][A-Z0-9_]{0,99}',str(exc)) else 'WORKFLOW_NODE_FAILED'
            w._record(bundle/'rejected.json',dict(errorCode=code,rawSha256=sha256(bundle/'result.png'),receivedAt=time.time()))
            start=w._read(directory/'started.json')
            refs={f'file-{i:04d}':dict(path=p.relative_to(out).as_posix(),sha256=sha256(p)) for i,p in enumerate(sorted(out.rglob('*'))) if p.is_file()}
            w._record(directory/'receipt.json',dict(status='failed',reason='MATERIAL_PREFLIGHT_REJECTED',
                data={'errorCode':code},artifacts=refs,node='generate',startDigest=start['digest'],elapsedSeconds=max(0,time.time()-start['startedAt'])))
            return w.inspect_job(job)
        import_result(run,bundle)
        submission=w._read(bundle/'submission.json') if (bundle/'submission.json').exists() else None
        w._record(bundle/'accepted.json',dict(assignmentDigest=assignment['digest'],imageSha256=sha256(bundle/'result.png'),
            manifestSha256=sha256(bundle/'result.json'),receivedAt=time.time(),
            submissionDigest=submission['digest'] if submission else None))
        if all(batch.state(run,frozen['requests'][k])=='received' for k in frozen['dispatch_order']):
            require(w.inspect_job(job)['status']=='awaiting_external','BRIDGE_DEADLINE_EXCEEDED')
            write_json(out/'generation.json',dict(requests=len(frozen['dispatch_order']),batchDigest=frozen['digest'],automaticRetries=0))
            result=dict(status='ok',data={'transport':'file','providerInvocationAttested':False},
                artifacts={f'file-{i:04d}':p.relative_to(out).as_posix() for i,p in enumerate(sorted(out.rglob('*'))) if p.is_file()})
            refs=w._validate_result('generate',result,out,spec);start=w._read(directory/'started.json')
            w._record(directory/'receipt.json',dict(status='ok',data=result['data'],artifacts=refs,node='generate',
                startDigest=start['digest'],elapsedSeconds=max(0,time.time()-start['startedAt'])))
        return w.inspect_job(job)
