"""Single-use serial image exchange for a pure asset batch. No component DAG."""
from contextlib import contextmanager
from pathlib import Path
import sys
import time

from . import batch
from .adapter import export_request, seal_result, import_result, builtin_image_arguments
from .common import digest, read_json, write_json, require, sha256, MAX_IMAGE_BYTES


def _record(path, body):
    record = {**body, 'digest': digest(body)}
    write_json(path, record)
    return record


def _read(path):
    record = read_json(path)
    require(record.get('digest') == digest({k:v for k,v in record.items() if k!='digest'}), 'ASSET_GENERATION_RECORD_CHANGED')
    return record


@contextmanager
def _lock(run):
    path = run/'assets-generation.lock'
    handle = path.open('x')
    try:
        yield
    finally:
        handle.close()
        path.unlink()


def _batch(run):
    frozen, plan = batch.load(run)
    require(plan['document']['format']=='png_zip', 'PNG_ZIP_PLAN_REQUIRED')
    require('bounded_execution' not in frozen, 'ASSET_LOOP_REPLACEMENTS_UNSUPPORTED')
    require(frozen['dispatch_order'] and len(frozen['dispatch_order'])<=32 and
            all('cached_result' not in a for a in plan['assets']), 'ASSET_LOOP_FRESH_GENERATION_REQUIRED')
    return frozen, plan


def authorize(run, plan_digest, approval):
    run=Path(run).resolve()
    with _lock(run):
        frozen,plan=_batch(run)
        require(plan_digest==digest(plan), 'ASSET_GENERATION_PLAN_CHANGED')
        require(isinstance(approval,str) and bool(approval.strip()), 'EXPLICIT_GENERATION_APPROVAL_REQUIRED')
        require(all(batch.state(run,e)=='prepared' for e in frozen['requests'].values()), 'ASSET_GENERATION_ALREADY_STARTED')
        return _record(run/'assets-authorization.json', dict(kind='ui_assets_generation_authorization_v1',
            batchDigest=frozen['digest'],planDigest=plan_digest,maximumCalls=len(frozen['dispatch_order']),
            approval=approval,automaticRetries=0))


def status(run):
    run=Path(run).resolve();frozen,plan=_batch(run)
    require((run/'assets-authorization.json').is_file(), 'ASSET_GENERATION_NOT_AUTHORIZED')
    auth=_read(run/'assets-authorization.json')
    require(auth.get('kind')=='ui_assets_generation_authorization_v1' and auth.get('batchDigest')==frozen['digest'] and
            auth.get('planDigest')==digest(plan) and auth.get('maximumCalls')==len(frozen['dispatch_order']) and
            auth.get('automaticRetries')==0, 'ASSET_GENERATION_AUTHORIZATION_CHANGED')
    states={};assigned=0
    for key in frozen['dispatch_order']:
        entry=frozen['requests'][key];state=batch.state(run,entry);directory=run/'assets-exchange'/key
        if state!='prepared':
            assigned+=1
            require((directory/'submission.json').is_file(), 'ASSET_GENERATION_INCOMPLETE_ASSIGNMENT')
            submitted=_read(directory/'submission.json')
            handoff=read_json(directory/'handoff.json')
            require(submitted['authorizationDigest']==auth['digest'] and
                    handoff['batch_digest']==frozen['digest'] and handoff['asset']==key and
                    submitted['requestDigest']==handoff['request_digest'] and
                    sha256(directory/'request.json')==entry['request_sha256'] and
                    submitted['arguments']==builtin_image_arguments(directory), 'ASSET_GENERATION_SUBMISSION_CHANGED')
            if state=='received':
                accepted=_read(directory/'accepted.json')
                require(accepted['submissionDigest']==submitted['digest'] and
                        accepted['sourceSha256']==sha256(directory/'result.png') and
                        accepted['manifestSha256']==sha256(directory/'result.json') and
                        accepted['receiptSha256']==sha256(run/'requests'/entry['id']/'received.json') and
                        accepted['sourceSha256']==sha256(run/'requests'/entry['id']/'raw.png'), 'ASSET_GENERATION_RESULT_CHANGED')
        else:
            require(not directory.exists(), 'ASSET_GENERATION_INCOMPLETE_ASSIGNMENT')
        states[key]=state
    failed=any(s not in {'prepared','reserved','received'} for s in states.values())
    current='failed_no_resubmit' if failed else 'awaiting_external' if 'reserved' in states.values() else 'ready'
    complete=all(s=='received' for s in states.values())
    return dict(status='generation_complete' if complete else current, nextNode='process' if complete else 'generate',
                jobDigest=frozen['digest'],planDigest=digest(plan),maximumCalls=auth['maximumCalls'],
                assignedCalls=assigned,requests=states,automaticRetries=0)


def exchange(run, request_digest=None, source=None):
    run=Path(run).resolve();start=time.perf_counter()
    require((request_digest is None)==(source is None), 'EXCHANGE_RESULT_PAIR_REQUIRED')
    with _lock(run):
        current=status(run);frozen,_=_batch(run)
        if request_digest is not None:
            require(current['status']=='awaiting_external', 'ASSET_GENERATION_NOT_WAITING')
            pending=[k for k,v in current['requests'].items() if v=='reserved']
            require(len(pending)==1, 'ASSET_GENERATION_PENDING_COUNT')
            directory=run/'assets-exchange'/pending[0];submitted=_read(directory/'submission.json')
            require(submitted['requestDigest']==request_digest, 'ASSET_GENERATION_REQUEST_MISMATCH')
            seal_result(directory,Path(source));import_result(run,directory)
            entry=frozen['requests'][pending[0]]
            _record(directory/'accepted.json',dict(submissionDigest=submitted['digest'],
                sourceSha256=sha256(directory/'result.png'),manifestSha256=sha256(directory/'result.json'),
                receiptSha256=sha256(run/'requests'/entry['id']/'received.json')))
            current=status(run)
        if current['status']=='generation_complete':
            return dict(status=current,nextRequest=None,timings={'totalSeconds':time.perf_counter()-start})
        require(current['status']=='ready', 'ASSET_GENERATION_NO_RESUBMIT')
        key=next(k for k in frozen['dispatch_order'] if current['requests'][k]=='prepared')
        directory=run/'assets-exchange'/key
        handoff=export_request(run,key,directory);arguments=builtin_image_arguments(directory)
        auth=_read(run/'assets-authorization.json')
        submitted=_record(directory/'submission.json',dict(authorizationDigest=auth['digest'],
            requestDigest=handoff['request_digest'],arguments=arguments,
            evidenceBasis='caller invocation intent, not provider execution attestation',recordedAt=time.time()))
        return dict(status=status(run),nextRequest=dict(asset=key,requestDigest=handoff['request_digest'],
            arguments=arguments,submissionDigest=submitted['digest']),timings={'totalSeconds':time.perf_counter()-start})


def export_loop(run, output, output_root, python=None, node='node', returned_response=None, output_root_mode='direct'):
    from .loop_entry import write_loop
    run=Path(run).resolve();output=Path(output).resolve();current=status(run)
    recovery={}
    require(output_root_mode in {'direct','session-child'},'LOOP_ROOT_MODE')
    if returned_response is None:
        require(current['status']=='ready' and current['assignedCalls']==0, 'LOOP_EXPORT_NOT_AUTHORIZED_FRESH')
    else:
        pending=[k for k,v in current['requests'].items() if v=='reserved']
        require(current['status']=='awaiting_external' and len(pending)==1,'LOOP_RECOVERY_NOT_WAITING')
        response=Path(returned_response).resolve()
        # The durable tool response contains a full PNG in base64, not just metadata.
        payload=read_json(response,max_bytes=4*((MAX_IMAGE_BYTES+2)//3)+2_097_152)
        event=payload['events'][-1] if payload.get('kind')=='ui_generation_loop_events_v1' and payload.get('events') else payload
        submitted=_read(run/'assets-exchange'/pending[0]/'submission.json')
        require(event.get('event')=='tool-returned' and event.get('requestDigest')==submitted['requestDigest'] and
                isinstance(event.get('response'),dict),'LOOP_RECOVERY_RESPONSE_MISMATCH')
        recovery=dict(returnedResponse=str(response),returnedResponseSha256=sha256(response),
            returnedRequestDigest=submitted['requestDigest'],assignedCalls=current['assignedCalls'])
    root=Path(__file__).resolve().parent
    config=dict(product='assets',job=str(run),jobDigest=current['jobDigest'],maximumCalls=current['maximumCalls'],
        python=str(python or sys.executable),node=str(node),packageRoot=str(root.parent),
        bridge=str(root/'generation-loop-bridge.mjs'),outputRoot=str(Path(output_root).resolve()),
        journal=str(output.parent/'journal'),transport=str(output.parent/'transport'))
    config.update(recovery)
    config['outputRootMode']=output_root_mode
    return write_loop(config,output,current['planDigest'])
