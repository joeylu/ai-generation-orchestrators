"""Independent serial image exchange. Host invokes image tool; no automatic retries."""
import argparse
from contextlib import contextmanager
import io
import json
from pathlib import Path
import secrets
import time

from PIL import Image
from evaluate import read, save, digest
from freeze_visual import inspect, body_digest
from execution_preflight import preflight


def record(path, body):
    result={**body, 'digest':body_digest(body)};save(path,result);return result


def verified(path):
    value=read(path)
    if value.get('digest')!=body_digest({k:v for k,v in value.items() if k!='digest'}):
        raise ValueError('RECORD_CHANGED')
    return value


@contextmanager
def lock(job):
    path=job/'exchange.lock'
    handle=path.open('x')
    try:yield
    finally:handle.close();path.unlink()


def prepare(snapshot, expected_digest, output, assets=None, prompt_override=None, reference_mode=None):
    snapshot=Path(snapshot);output=Path(output)
    checked=preflight(snapshot,expected_digest);manifest=inspect(snapshot,expected_digest)
    all_rows=read(snapshot/'requests.json')['requests']
    if reference_mode is None:
        compiled=read(snapshot/'execution-plan.candidate.json')['assets']
        reference_mode='full-only' if all(a['prompt'].startswith('visual-material-prompt-v3:\n') for a in compiled) else 'full-and-crop'
    if reference_mode not in ('full-and-crop','full-only'):raise ValueError('REFERENCE_MODE')
    known={r['asset'] for r in all_rows};selected=assets or [r['asset'] for r in all_rows]
    if len(selected)!=len(set(selected)) or not set(selected)<=known:
        raise ValueError('INVALID_ASSET_SELECTION')
    override=None
    if prompt_override is not None:
        if len(selected)!=1:raise ValueError('PROMPT_VARIANT_SINGLE_ASSET_REQUIRED')
        override=Path(prompt_override).read_bytes()
        if not override.decode('utf-8').strip():raise ValueError('EMPTY_PROMPT_VARIANT')
    output.mkdir(parents=True,exist_ok=False);copied=output/'snapshot';copied.mkdir()
    for name in [*manifest['files'],'snapshot.json']:
        target=copied/name;target.parent.mkdir(parents=True,exist_ok=True)
        target.write_bytes((snapshot/name).read_bytes())
    inspect(copied,expected_digest)
    (output/'attempts').mkdir()
    variant={}
    if override is not None:
        (output/'prompt-variant.txt').write_bytes(override)
        variant={'promptVariant':{'asset':selected[0],'sha256':digest(output/'prompt-variant.txt')}}
    return record(output/'job.json',{'kind':'ui_experimental_image_job_v1','snapshotDigest':expected_digest,
        'policy':'independent-visual-plan-v5-v1','referenceMode':reference_mode,'assets':selected,'maximumCalls':len(selected),
        'automaticRetries':0,'inputChecks':checked['inputChecks'],'createdAt':time.time(),
        'scope':'Raw image acquisition only; old brief evidence is not claimed. Postprocessing and visual acceptance are separate.',**variant})


def load_job(job):
    config=verified(job/'job.json')
    if config.get('kind')!='ui_experimental_image_job_v1':raise ValueError('JOB_KIND')
    inspect(job/'snapshot',config['snapshotDigest'])
    rows=read(job/'snapshot/requests.json')['requests']
    index={r['asset']:r for r in rows}
    if not set(config['assets'])<=index.keys():raise ValueError('JOB_ASSETS')
    if 'promptVariant' in config:
        variant=config['promptVariant']
        if config['assets']!=[variant['asset']] or digest(job/'prompt-variant.txt')!=variant['sha256']:
            raise ValueError('PROMPT_VARIANT_CHANGED')
    return config,index


def authorize(job, job_digest, approval):
    job=Path(job)
    with lock(job):
        config,_=load_job(job)
        if config['digest']!=job_digest or not approval.strip():raise ValueError('EXPLICIT_BOUND_APPROVAL_REQUIRED')
        if any((job/'attempts').iterdir()):raise ValueError('ALREADY_STARTED')
        return record(job/'authorization.json',{'kind':'ui_experimental_compute_approval_v1',
            'jobDigest':job_digest,'snapshotDigest':config['snapshotDigest'],'approval':approval,
            'maximumCalls':config['maximumCalls'],'automaticRetries':0})


def status(job):
    job=Path(job);config,index=load_job(job)
    auth=verified(job/'authorization.json') if (job/'authorization.json').exists() else None
    if auth and (auth['jobDigest']!=config['digest'] or auth['maximumCalls']!=config['maximumCalls']):
        raise ValueError('AUTHORIZATION_CHANGED')
    states={}
    for asset in config['assets']:
        folder=job/'attempts'/asset
        if not folder.exists():states[asset]='prepared';continue
        if not auth or not (folder/'submission.json').exists():
            states[asset]='interrupted_no_resubmit';continue
        submission=verified(folder/'submission.json')
        if submission['authorizationDigest']!=auth['digest'] or submission['asset']!=asset:
            raise ValueError('SUBMISSION_CHANGED')
        if submission['requestDigest']!=body_digest(index[asset]):raise ValueError('REQUEST_CHANGED')
        terminal=[n for n in ('received.json','failed.json') if (folder/n).exists()]
        if len(terminal)>1:raise ValueError('CONFLICTING_TERMINAL_STATE')
        if terminal:
            result=verified(folder/terminal[0])
            if result['submissionDigest']!=submission['digest']:raise ValueError('RESULT_BINDING')
            if terminal[0]=='received.json':
                if digest(folder/'raw.png')!=result['rawSha256']:raise ValueError('RESULT_CHANGED')
                states[asset]='raw_received'
            else:states[asset]='failed_no_resubmit'
        else:states[asset]='awaiting_result_no_resubmit'
    values=list(states.values())
    current=('awaiting_authorization' if not auth else
             'blocked_no_resubmit' if any(v in ('interrupted_no_resubmit','failed_no_resubmit') for v in values) else
             'awaiting_result' if 'awaiting_result_no_resubmit' in values else
             'raw_complete' if all(v=='raw_received' for v in values) else 'ready')
    return {'status':current,'jobDigest':config['digest'],'maximumCalls':config['maximumCalls'],
            'assignedCalls':sum(v!='prepared' for v in values),'requests':states,
            'postprocessing':'not_run','humanVisualAcceptance':False}


def next_request(job):
    job=Path(job)
    with lock(job):
        current=status(job)
        if current['status']!='ready':raise ValueError('NOT_READY_NO_RESUBMIT')
        config,index=load_job(job);auth=verified(job/'authorization.json')
        asset=next(k for k,v in current['requests'].items() if v=='prepared')
        row=index[asset];folder=job/'attempts'/asset;folder.mkdir()
        submission=record(folder/'submission.json',{'asset':asset,'authorizationDigest':auth['digest'],
            'requestDigest':body_digest(row),'nonce':secrets.token_hex(16),'createdAt':time.time(),
            'evidenceBasis':'One invocation intent reserved; not proof of a provider call.'})
        snapshot=(job/'snapshot').resolve()
        prompt_path=job/'prompt-variant.txt' if 'promptVariant' in config else snapshot/row['prompt']
        references=[str(snapshot/row['reference'])]
        if config.get('referenceMode','full-and-crop')=='full-and-crop':references.append(str(snapshot/row['crop']))
        return {'asset':asset,'submissionDigest':submission['digest'],
                'arguments':{'prompt':prompt_path.read_text(encoding='utf-8').rstrip('\n'),
                             'referenced_image_paths':references},
                'automaticRetries':0}


def receive(job, submission_digest, source):
    job=Path(job);source=Path(source)
    with lock(job):
        current=status(job)
        if current['status']!='awaiting_result':raise ValueError('NO_PENDING_REQUEST')
        pending=[k for k,v in current['requests'].items() if v=='awaiting_result_no_resubmit']
        if len(pending)!=1:raise ValueError('PENDING_COUNT')
        asset=pending[0];folder=job/'attempts'/asset;submission=verified(folder/'submission.json')
        if submission['digest']!=submission_digest:raise ValueError('WRONG_SUBMISSION')
        try:
            if source.stat().st_size>64*1024*1024:raise ValueError('IMAGE_TOO_LARGE')
            data=source.read_bytes()
            with Image.open(io.BytesIO(data)) as image:
                if image.format!='PNG' or image.width*image.height>67108864:raise ValueError('PNG_REQUIRED')
                image.load();width,height=image.size
                if image.getexif().get(274,1)!=1:raise ValueError('IMAGE_ORIENTATION')
                _,index=load_job(job);w,h=index[asset]['outputSize']
                alpha=image.convert('RGBA').getchannel('A').getextrema()
                if alpha[1]==0:raise ValueError('EMPTY_IMAGE')
                plan=read(job/'snapshot/execution-plan.candidate.json')
                background=next(a for a in plan['assets'] if a['id']==asset)['role']=='background'
                if background and abs((width/height)/(w/h)-1)>.05:raise ValueError('ASPECT_MISMATCH')
                if background and alpha!= (255,255):raise ValueError('BACKGROUND_NOT_OPAQUE')
            with (folder/'raw.png').open('xb') as stream:stream.write(data)
            return record(folder/'received.json',{'submissionDigest':submission_digest,'rawSha256':digest(folder/'raw.png'),
                'size':[width,height],'status':'raw_received','provenance':'host-supplied provider result; not independently attested',
                'alphaQualityAccepted':False,'humanVisualAcceptance':False,'postprocessing':'not_run'})
        except (OSError,ValueError) as exc:
            record(folder/'failed.json',{'submissionDigest':submission_digest,'reason':type(exc).__name__,
                                        'status':'rejected_no_resubmit'})
            raise


def fail(job, submission_digest, reason):
    job=Path(job)
    with lock(job):
        current=status(job)
        if current['status']!='awaiting_result':raise ValueError('NO_PENDING_REQUEST')
        asset=next(k for k,v in current['requests'].items() if v=='awaiting_result_no_resubmit')
        folder=job/'attempts'/asset
        if verified(folder/'submission.json')['digest']!=submission_digest:raise ValueError('WRONG_SUBMISSION')
        return record(folder/'failed.json',{'submissionDigest':submission_digest,'reason':reason,
                                          'status':'indeterminate_no_resubmit'})


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);sub=parser.add_subparsers(dest='cmd',required=True)
    p=sub.add_parser('prepare');p.add_argument('--snapshot',required=True);p.add_argument('--expected-digest',required=True)
    p.add_argument('--output',required=True);p.add_argument('--asset',action='append')
    for name in ('status','authorize','next','receive','fail'):
        p=sub.add_parser(name);p.add_argument('--job',required=True)
        if name=='authorize':p.add_argument('--job-digest',required=True);p.add_argument('--approval',required=True)
        if name in ('receive','fail'):p.add_argument('--submission-digest',required=True)
        if name=='receive':p.add_argument('--source',required=True)
        if name=='fail':p.add_argument('--reason',required=True)
    a=parser.parse_args()
    if a.cmd=='prepare':result=prepare(a.snapshot,a.expected_digest,a.output,a.asset)
    elif a.cmd=='authorize':result=authorize(a.job,a.job_digest,a.approval)
    elif a.cmd=='next':result=next_request(a.job)
    elif a.cmd=='receive':result=receive(a.job,a.submission_digest,a.source)
    elif a.cmd=='fail':result=fail(a.job,a.submission_digest,a.reason)
    else:result=status(a.job)
    print(json.dumps(result,ensure_ascii=False,indent=2))
