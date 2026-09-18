"""Fixed, local DAG with immutable receipts and process-enforced stage deadlines.

Trusted deployment adapters implement nodes; model responses never select code.
No queue, daemon, automatic provider resubmission, or deployment integration.
"""
from __future__ import annotations

import importlib.util
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import time

from .common import digest, load_verified_image, read_json, require, safe_relative, sha256, write_json

NODES = {'vision', 'compile', 'repair', 'compile_repaired', 'freeze', 'generate', 'process', 'review', 'acceptance', 'deliver'}
EXTERNAL = {'vision', 'repair', 'generate', 'review'}


def _staged(spec):
    return spec.get('options',{}).get('deliveryProfile') == 'staged-draft-v1'


def _node_order(spec):
    head = ('vision','compile','repair','compile_repaired','freeze','generate','process','review')
    return head + (('acceptance','deliver') if _staged(spec) else ('deliver',))


def _record(path, body):
    record = {**body, 'digest': digest(body)}
    write_json(path, record)
    return record


def _read(path):
    row = read_json(path, max_bytes=16*1024*1024)
    require(row.get('digest') == digest({k:v for k,v in row.items() if k != 'digest'}), 'WORKFLOW_RECORD_CHANGED')
    return row


def _adapter_hash(factory):
    require(isinstance(factory, str) and factory.count(':') == 1, 'WORKFLOW_FACTORY')
    module, name = factory.split(':')
    require(all(s.isidentifier() for s in module.split('.')) and name.isidentifier(), 'WORKFLOW_FACTORY')
    spec = importlib.util.find_spec(module)
    require(spec is not None and spec.origin and Path(spec.origin).is_file(), 'WORKFLOW_FACTORY_MISSING')
    return sha256(Path(spec.origin))


def create_job(reference, job, *, factory, options=None, maximum_calls=8,
               stage_timeout=120, active_timeout=1200, fixture=False):
    """Creating a job performs no provider call. Options are trusted local config."""
    require(type(maximum_calls) is int and 1 <= maximum_calls <= 32, 'WORKFLOW_BUDGET')
    require(type(stage_timeout) is int and 1 <= stage_timeout <= 3600, 'WORKFLOW_TIMEOUT')
    require(type(active_timeout) is int and 1 <= active_timeout <= 86400, 'WORKFLOW_TIMEOUT')
    require(type(fixture) is bool and isinstance(options or {}, dict), 'WORKFLOW_OPTIONS')
    options=dict(options or {})
    if factory=='ai_ui_decomposition.repository_workflow:create':
        # Select the new graph once, before job hashing. Existing jobs without
        # this immutable option retain their old node order.
        options.setdefault('deliveryProfile','staged-draft-v1')
        options.setdefault('materialPreflight','after-generation-v1')
        require(options['materialPreflight'] in ('per-image-v1','after-generation-v1'),'MATERIAL_PREFLIGHT_MODE')
        require(options['deliveryProfile'] in ('legacy-v1','staged-draft-v1'),'REPOSITORY_DELIVERY_PROFILE')
    picture, evidence = load_verified_image(Path(reference))
    binding = _adapter_hash(factory)
    job = Path(job).resolve(); require(not job.exists(), 'WORKFLOW_EXISTS')
    job.mkdir(parents=True)
    suffix = Path(reference).suffix.lower()
    require(re.fullmatch(r'\.[a-z0-9]{1,8}', suffix), 'WORKFLOW_REFERENCE_EXTENSION')
    target = job/'input'/('original'+suffix); target.parent.mkdir()
    shutil.copyfile(reference, target)
    require(sha256(target) == evidence['sha256'], 'WORKFLOW_REFERENCE_CHANGED')
    _record(job/'job.json', dict(kind='ui_local_workflow_v1', version='1.0',
        reference=target.relative_to(job).as_posix(), referenceSha256=evidence['sha256'], canvas=list(picture.size),
        factory=factory, adapterSha256=binding, options=options or {}, maximumCalls=maximum_calls,
        stageTimeout=stage_timeout, activeTimeout=active_timeout, fixture=fixture,
        fileBridgeVersion='1.1', maximumRepairCalls=1, maximumVisionCalls=3, automaticGenerationRetries=0, human_visual_acceptance=False))
    return inspect_job(job)


def _load(job):
    job = Path(job).resolve(); spec = _read(job/'job.json')
    require(spec.get('kind') == 'ui_local_workflow_v1' and spec.get('version') == '1.0', 'WORKFLOW_VERSION')
    require(spec.get('fileBridgeVersion') in (None,'1.1'),'WORKFLOW_BRIDGE_VERSION')
    require(sha256(safe_relative(job,spec['reference'])) == spec['referenceSha256'], 'WORKFLOW_REFERENCE_CHANGED')
    require(_adapter_hash(spec['factory']) == spec['adapterSha256'], 'WORKFLOW_ADAPTER_CHANGED')
    return job,spec


def _receipts(job, spec):
    rows = {}
    found={p.name:p for p in (job/'nodes').glob('*')} if (job/'nodes').exists() else {}
    require(set(found)<=set(_node_order(spec)),'WORKFLOW_NODE')
    for name in _node_order(spec):
        if name not in found: continue
        directory=found[name]
        require(directory.name in NODES, 'WORKFLOW_NODE')
        start = _read(directory/'started.json')
        require(start['jobDigest'] == spec['digest'] and start['node'] == directory.name, 'WORKFLOW_NODE_BINDING')
        require(_next(rows,spec)==name and start['dependencies']=={k:v['digest'] for k,v in rows.items()}, 'WORKFLOW_DEPENDENCY_CHANGED')
        if (directory/'receipt.json').exists():
            receipt = _read(directory/'receipt.json')
            require(receipt['startDigest'] == start['digest'], 'WORKFLOW_RECEIPT_BINDING')
            for ref in receipt.get('artifacts',{}).values():
                require(sha256(safe_relative(directory/'output', ref['path'])) == ref['sha256'], 'WORKFLOW_ARTIFACT_CHANGED')
            rows[directory.name] = receipt
        else:
            if name=='review' and (directory/'bridge.json').exists():
                from .workflow_review_bridge import pending_status
                rows[name]=pending_status(job,spec,start,rows)
            elif name=='generate' and (directory/'bridge.json').exists():
                from .workflow_bridge import pending_status
                rows[name]=pending_status(job,spec,start,rows)
            else:
                rows[directory.name] = {'status':'indeterminate','node':directory.name,'external':directory.name in EXTERNAL}
    return rows


def _next(rows,spec=None):
    for name in ('vision','compile'):
        if name not in rows: return name
        if rows[name]['status'] not in ('ok','invalid'): return None
    if rows['compile']['status'] == 'invalid':
        for name in ('repair','compile_repaired'):
            if name not in rows: return name
            if rows[name]['status'] != 'ok': return None
    tail=('freeze','generate','process','review') + (('acceptance','deliver') if _staged(spec or {}) else ('deliver',))
    for name in tail:
        if name not in rows: return name
        if rows[name]['status'] != 'ok': return None
        if name=='review' and rows[name]['data']['decision']!='accept':return None
    return None


def inspect_job(job):
    job,spec = _load(job); rows = _receipts(job,spec)
    failed = next((r for r in rows.values() if r['status'] in ('failed','indeterminate','timed_out')), None)
    state = 'ready'; next_node = _next(rows,spec)
    if failed: state = failed['status']
    elif any(r.get('status')=='awaiting_external' for r in rows.values()): state='awaiting_external'
    elif rows.get('compile_repaired',{}).get('status') == 'invalid': state = 'rejected'
    elif rows.get('review',{}).get('data',{}).get('decision') in ('reject','unknown'):state='rejected'
    elif 'deliver' in rows:
        state = ('fixture_complete' if spec['fixture'] else
                 'completed_diagnostic_draft' if rows['deliver']['data'].get('acceptance')=='blocked_reference' else 'completed_draft')
    elif next_node == 'generate' and not (job/'authorization.json').exists(): state = 'awaiting_authorization'
    elif next_node == 'review' and _staged(spec): state = 'awaiting_review'
    if (job/'authorization.json').exists(): _authorization(job,spec,rows)
    if (job/'budget-exhausted.json').exists():
        marker=_read(job/'budget-exhausted.json');require(marker['jobDigest']==spec['digest'],'WORKFLOW_BUDGET_BINDING')
        state='timed_out'; next_node=None
    recovered_seconds=0
    for charge in (job/'recovered').glob('*/recovery.json') if (job/'recovered').exists() else []:
        r=_read(charge);require(r['jobDigest']==spec['digest'],'WORKFLOW_RECOVERY_BINDING');recovered_seconds+=r['chargedSeconds']
    return dict(kind='ui_local_workflow_status_v1',status=state,nextNode=next_node,
                jobDigest=spec['digest'],nodes={k:v['status'] for k,v in rows.items()},
                activeSeconds=sum(r.get('elapsedSeconds',0) for r in rows.values())+recovered_seconds,
                externalRequests=rows.get('generate',{}).get('requests',[]),
                errorCode=(failed or {}).get('data',{}).get('errorCode'),
                automaticResubmit=False,human_visual_acceptance=False)


def _authorization(job,spec,rows):
    a = _read(job/'authorization.json'); frozen = rows.get('freeze')
    require(frozen is not None and a['jobDigest']==spec['digest'] and a['freezeDigest']==frozen['digest']
            and a['planDigest']==frozen['data']['planDigest'] and a['maximumCalls']==frozen['data']['maximumCalls'],
            'WORKFLOW_AUTHORIZATION_CHANGED')
    return a


def authorize(job, plan_digest):
    """Explicit user/deployment consent, bound to this job and immutable freeze."""
    job,spec=_load(job); rows=_receipts(job,spec)
    require(inspect_job(job)['status']=='awaiting_authorization','WORKFLOW_NOT_AWAITING_AUTHORIZATION')
    frozen=rows['freeze'];require(plan_digest==frozen['data']['planDigest'],'WORKFLOW_AUTHORIZATION_PLAN_MISMATCH')
    _record(job/'authorization.json',dict(jobDigest=spec['digest'],freezeDigest=frozen['digest'],planDigest=plan_digest,
        maximumCalls=frozen['data']['maximumCalls'],singleUse=True,automaticRetries=0))
    return inspect_job(job)


def _validate_result(node, result, output, spec):
    require(set(result)=={'status','data','artifacts'},'WORKFLOW_RESULT_FIELDS')
    require(result['status']=='ok' or
            (result['status']=='invalid' and node in ('compile','compile_repaired')) or
            (result['status']=='failed' and node=='process' and
             spec.get('options',{}).get('materialPreflight')=='after-generation-v1'),
            'WORKFLOW_RESULT_STATUS')
    require(isinstance(result['data'],dict) and isinstance(result['artifacts'],dict),'WORKFLOW_RESULT_DATA')
    refs={}
    for key,path in result['artifacts'].items():
        require(isinstance(key,str) and re.fullmatch(r'[a-z][a-z0-9_-]{0,63}',key),'WORKFLOW_ARTIFACT_NAME')
        resolved=safe_relative(output,path); require(resolved.is_file() and not resolved.is_symlink(),'WORKFLOW_ARTIFACT_MISSING')
        refs[key]={'path':path,'sha256':sha256(resolved)}
    if node=='freeze' and result['status']=='ok':
        require(isinstance(result['data'].get('planDigest'),str) and re.fullmatch(r'[0-9a-f]{64}',result['data']['planDigest']),'WORKFLOW_PLAN_DIGEST')
        count=result['data'].get('maximumCalls')
        require(type(count) is int and 0 <= count <= spec['maximumCalls'],'WORKFLOW_GENERATION_BUDGET')
        require('plan' in refs and digest(read_json(safe_relative(output,refs['plan']['path'])))==result['data']['planDigest'], 'WORKFLOW_FROZEN_PLAN_CHANGED')
    if node=='deliver' and result['status']=='ok':
        require(result['data'].get('human_visual_acceptance') is False,'WORKFLOW_HUMAN_ACCEPTANCE')
        allowed={'fixture_only'} if spec['fixture'] else {'passed'} | ({'blocked_reference'} if _staged(spec) else set())
        require(result['data'].get('acceptance') in allowed and bool(refs),'WORKFLOW_ACCEPTANCE_REQUIRED')
        if result['data'].get('acceptance')=='blocked_reference':
            require(result['data'].get('referenceComparison')=='blocked' and
                    bool(result['data'].get('unknownFields')) and 'diagnostic' in refs,
                    'WORKFLOW_DIAGNOSTIC_REQUIRED')
    if node=='review':
        require(result['data'].get('decision') in ('accept','reject','unknown'),'WORKFLOW_REVIEW_DECISION')
        require(result['data'].get('human_visual_acceptance') is False,'WORKFLOW_HUMAN_ACCEPTANCE')
    return refs


def advance(job, *, allow_vision=False, max_nodes=8):
    """Advance completed dependencies only; external calls require fresh receipts.

    An incomplete started marker is never automatically retried. Deterministic
    incomplete nodes can be recovered explicitly into a fresh output directory.
    Authorization waiting time is excluded from active execution budget.
    """
    require(type(max_nodes) is int and 1<=max_nodes<=8,'WORKFLOW_ADVANCE_LIMIT')
    job,spec=_load(job)
    for _ in range(max_nodes):
        status=inspect_job(job)
        if status['status'] not in ('ready','awaiting_review') or status['nextNode'] is None: return status
        rows=_receipts(job,spec);node=status['nextNode']
        if node in ('vision','repair','review'): require(allow_vision is True,'WORKFLOW_VISION_AUTHORIZATION_REQUIRED')
        if node=='review' and spec['options'].get('reviewMode')=='file':
            from .workflow_review_bridge import export_review
            return export_review(job)
        if node=='generate':
            _authorization(job,spec,rows)
            if spec['options'].get('generationMode')=='file':
                from .workflow_bridge import export_generation
                return export_generation(job)
        remaining=spec['activeTimeout']-status['activeSeconds']
        if remaining<=0:
            _record(job/'budget-exhausted.json',dict(jobDigest=spec['digest']))
            return inspect_job(job)
        directory=job/'nodes'/node;directory.mkdir(parents=True,exist_ok=True)
        start=_record(directory/'started.json',dict(jobDigest=spec['digest'],node=node,
            dependencies={k:v['digest'] for k,v in rows.items()},startedAt=time.time()))
        output=directory/'output';output.mkdir()
        seconds=min(spec['stageTimeout'],remaining)
        context=dict(job=str(job),node=node,output=str(output),spec=spec,receipts=rows,timeoutSeconds=seconds)
        write_json(directory/'context.json',context)
        began=time.monotonic()
        try:
            # One process per node: a provider ignoring timeout cannot block the parent.
            # Driver processes must not spawn detached work; remote cancellation is not implied.
            completed=subprocess.run([sys.executable,'-m','ai_ui_decomposition.workflow_worker',str(directory/'context.json')],
                stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=seconds)
            if completed.returncode!=0:
                code='WORKFLOW_NODE_FAILED'
                if (directory/'error.json').is_file():
                    error=read_json(directory/'error.json')
                    if error.get('kind')=='ui_workflow_node_error_v1' and re.fullmatch(r'[A-Z][A-Z0-9_]{0,99}',str(error.get('code',''))):code=error['code']
                from .common import ContractError
                raise ContractError(code)
            result=read_json(directory/'result.json')
            artifacts=_validate_result(node,result,output,spec)
            body=dict(status=result['status'],data=result['data'],artifacts=artifacts)
        except subprocess.TimeoutExpired:
            body=dict(status='timed_out',reason='NODE_DEADLINE_NO_RESUBMIT',data={},artifacts={})
        except Exception as exc:
            # Neither raw provider exception nor model response belongs in public status.
            from .common import ContractError
            code=str(exc) if isinstance(exc,ContractError) and re.fullmatch(r'[A-Z][A-Z0-9_]{0,99}',str(exc)) else 'WORKFLOW_NODE_FAILED'
            body=dict(status='failed',reason='NODE_FAILED_NO_RESUBMIT',data={'errorCode':code},artifacts={})
        _record(directory/'receipt.json',dict(**body,node=node,startDigest=start['digest'],elapsedSeconds=time.monotonic()-began))
        if node=='process' and _staged(spec):
            # Always yield the real default preview, even with provider review.
            # A separate advance/export-review call is required to continue.
            return inspect_job(job)
    return inspect_job(job)


def recover_local(job, node):
    """Archive a crash-interrupted local node, without altering historical receipts."""
    # process/freeze may mutate batch-owned state; only pure compiler nodes are replayable.
    require(node in {'compile','compile_repaired'},'WORKFLOW_EXTERNAL_RECOVERY_FORBIDDEN')
    job,spec=_load(job);rows=_receipts(job,spec)
    require(rows.get(node,{}).get('status')=='indeterminate','WORKFLOW_RECOVERY_NOT_INDETERMINATE')
    directory=job/'nodes'/node
    # Preserve one interrupted attempt only: repeated local crashes need a new job.
    destination=job/'recovered'/node;require(not destination.exists(),'WORKFLOW_RECOVERY_LIMIT')
    destination.parent.mkdir(exist_ok=True)
    require(directory.resolve().is_relative_to(job) and destination.resolve().is_relative_to(job),'WORKFLOW_RECOVERY_PATH')
    directory.rename(destination)
    started=_read(destination/'started.json')
    _record(destination/'recovery.json',dict(jobDigest=spec['digest'],chargedSeconds=min(spec['stageTimeout'],max(0,time.time()-started['startedAt']))))
    return inspect_job(job)
