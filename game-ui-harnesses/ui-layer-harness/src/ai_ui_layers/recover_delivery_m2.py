"""Explicit new-run recovery of a verified M1 after interrupted M2; never retries media."""
import argparse
from pathlib import Path
from jsonschema import Draft202012Validator
from . import delivery_dag as delivery
from . import planning_dag as planning
from .evaluate import read, save, digest
from .session_review import session_id


def recover(source, output, reason):
    source=Path(source).resolve(); output=Path(output).resolve(); old=source/'planning'
    if not reason.strip(): raise ValueError('RECOVERY_REASON_REQUIRED')
    if (source/'generation').exists(): raise ValueError('PLANNING_ONLY_RECOVERY')
    # Archived runtime may differ: verify archived artifacts, then explicitly bind the new runtime.
    for root in (source,old):
        config=read(root/'.dag/config.json')
        if digest(root/'.dag/config.json')!=read(root/'.dag/config-digest.json')['sha256']: raise ValueError('CONFIG_CHANGED')
        for name,sha in config['inputs'].items():
            if digest(root/'.dag/inputs'/name)!=sha: raise ValueError('INPUT_CHANGED')
        for done in (root/'.dag').glob('*/done.json'):
            for name,sha in read(done)['outputs'].items():
                if digest(root/name)!=sha: raise ValueError('COMPLETED_OUTPUT_CHANGED')
    if not (old/'.dag/m1/done.json').exists() or not (old/'.dag/check/done.json').exists(): raise ValueError('M1_NOT_COMPLETE')
    if not (old/'.dag/m2/started.json').exists() or (old/'.dag/m2/done.json').exists(): raise ValueError('M2_NOT_INTERRUPTED')
    if any((old/'.dag'/name).exists() for name in ('repair','rereview','freeze')): raise ValueError('LATER_STAGE_EXISTS')
    receipt=read(old/'m1/transport.json')
    if receipt.get('failure') or receipt['exitCode'] or not receipt['turnCompleted'] or receipt['unexpectedEvents']:
        raise ValueError('M1_RECEIPT_INVALID')
    if receipt['responseSha256']!=digest(old/'m1/draft.json'): raise ValueError('M1_CHANGED')
    if read(old/'session.json')['sessionId']!=session_id(old/'m1/events.jsonl'): raise ValueError('SESSION_CHANGED')
    Draft202012Validator(read(old/'m1/schema.json')).validate(read(old/'m1/draft.json'))
    evidence={p.relative_to(source).as_posix():digest(p) for p in source.rglob('*') if p.is_file() and p.name!='lock'}
    config=read(source/'.dag/config.json')
    root=delivery.init(source/'.dag/inputs/reference.png',output,source/'.dag/inputs',config['target'],config['maxCalls'])
    new=planning.init(root/'.dag/inputs/reference.png',root/'planning',config['maxCalls'])
    # Do not silently apply changed prompts/schema to a reused M1 answer.
    current=read(new/'.dag/config.json')
    if current['inputs']!=read(old/'.dag/config.json')['inputs']: raise ValueError('PLANNING_INPUTS_CHANGED')
    def import_m1():
        (new/'m1').mkdir()
        for name in ('draft.json','schema.json','prompt.md','reference.png','transport.json','events.jsonl','dispatch.json','stderr.log'):
            p=old/'m1'/name
            if p.exists(): (new/'m1'/name).write_bytes(p.read_bytes())
        for name in ('session.json','request.json'): (new/name).write_bytes((old/name).read_bytes())
        save(new/'m1-reuse.json',dict(kind='verified_completed_m1_reuse_v1',reason=reason,
             source=str(source),sourceFiles=evidence,newModelCalls=0,sourceElapsedSeconds=receipt['elapsedSeconds'],
             sourceRuntime=read(old/'.dag/config.json')['runtime'],newRuntime=current['runtime'],
             disclosure='Original M2 interruption retained; new M2 explicitly requested, not an automatic retry.'))
    planning.Dag(new).node('m1',import_m1)
    # Pin recovery provenance in a delivery checkpoint too.
    delivery.DeliveryDag(root).node('recovery',lambda:save(root/'recovery.json',read(new/'m1-reuse.json')))
    if any(digest(source/name)!=sha for name,sha in evidence.items()): raise ValueError('SOURCE_CHANGED_DURING_RECOVERY')
    return root


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--source',required=True);p.add_argument('--output',required=True);p.add_argument('--reason',required=True)
    a=p.parse_args();print(recover(a.source,a.output,a.reason))
