"""Freeze a v5 experimental planning snapshot; never creates a legacy runnable batch."""
import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import time

from .compile_visual import compile_run, verify_run, selected_paths
from .evaluate import read, save, digest


def body_digest(value):
    return hashlib.sha256(json.dumps(value,sort_keys=True,separators=(',', ':'),
                                    ensure_ascii=False,allow_nan=False).encode('utf-8')).hexdigest()


def freeze(run, output, max_calls, generation_mode="single"):
    started=time.perf_counter();run=Path(run);output=Path(output)
    visual=verify_run(run)
    plan_path,review_path=selected_paths(run)
    if visual['unknowns']:
        raise ValueError('UNRESOLVED_UNKNOWNS')
    # Rebuild from bound inputs rather than accepting editable compiled candidates.
    report=compile_run(run, output, max_calls, generation_mode)
    if verify_run(run)!=visual or digest(plan_path)!=report['sourcePlanSha256']:
        raise ValueError('INPUT_CHANGED_DURING_FREEZE')
    evidence=output/'evidence';evidence.mkdir()
    stages=[] if (run/'revision.json').exists() else [('m1',['draft.json','schema.json','prompt.md']),
                        ('m2',['draft.json','schema.json','prompt.md','request.json','review-source.md','review-overlay.png'])]
    for stage,names in stages:
        for name in names:
            (evidence/(stage+'-'+name)).write_bytes((run/stage/name).read_bytes())
    if (run/'revision.json').exists():
        lineage=read(run/'revision.json')
        save(evidence/'revision-lineage.json',{k:v for k,v in lineage.items() if k!='parent'})
        for source,name in [('source-plan.json','parent-candidate.json'),
                            ('parent-review/draft.json','parent-review.json'),
                            ('m1/schema.json','m1-schema.json')]:
            (evidence/name).write_bytes((run/source).read_bytes())
    if plan_path!=run/'m1/draft.json':
        for stage in ('repair','rereview','repair2','rereview2'):
            for path in (run/stage).glob('*'):
                if path.is_file():(evidence/(stage+'-'+path.name)).write_bytes(path.read_bytes())
        (evidence/'revised-visual-plan.json').write_bytes(plan_path.read_bytes())
    if digest(plan_path)!=report['sourcePlanSha256'] or digest(review_path)!=report['reviewSha256']:
        raise ValueError('EVIDENCE_CHANGED_DURING_FREEZE')
    from .planning_review_policy import split
    save(output/'planning-warnings.json',dict(warnings=split(read(review_path))[1],reviewSha256=digest(review_path)))
    plan=read(output/'execution-plan.candidate.json')
    requests=[]
    for asset,item in zip(plan['assets'],report['artifacts']):
        requests.append({'asset':asset['id'],'reference':'reference.png','crop':item['crop'],
                         'prompt':item['prompt'],'outputSize':asset['output_size'],
                         'sourceRegion':asset['source_region'],'plannedCalls':1,'automaticRetries':0})
    request_kind='ui_visual_requests_preview_v1'
    if generation_mode=='sheets':
        from .generation_groups import sheet_prompt
        singles={r['asset']:r for r in requests};requests=[]
        for group in read(output/'generation-groups.json')['groups']:
            if group['mode']=='single':
                requests.append(singles[group['id']]);continue
            folder=output/'sheets'/group['id'];folder.mkdir(parents=True)
            prompt=folder/'prompt.txt';prompt.write_text(sheet_prompt(visual,plan,group)+'\n',encoding='utf-8')
            requests.append(dict(asset=group['id'],kind='sheet',materialIds=group['materialIds'],grid=group['grid'],
                reference='reference.png',prompt=prompt.relative_to(output).as_posix(),outputSize=group['outputSize'],
                plannedCalls=1,automaticRetries=0))
        request_kind='ui_visual_requests_preview_v2'
    save(output/'requests.json',{'kind':request_kind,'dispatchEnabled':False,'requests':requests})
    files={p.relative_to(output).as_posix():digest(p) for p in sorted(output.rglob('*')) if p.is_file()}
    snapshot={'kind':'ui_visual_frozen_experiment_v1','policy':'visual-plan-v5-experiment-v1',
              'status':'frozen_experimental_snapshot','executable':False,
              'productionReady':False,'humanVisualAcceptance':False,'generationCalls':0,
              'sourcePlanSha256':report['sourcePlanSha256'],'reviewSha256':report['reviewSha256'],
              'materialCount':report['materialCount'],'plannedCalls':report['plannedCalls'],
              'maximumCalls':max_calls,'legacyCompatibilityBlockers':report['blockers'],
              'checks':['bound inputs and review','empty M2 issues','no unresolved unknowns',
                        'v5 schema and relationships','legacy plan structure','explicit call limit',
                        'deterministic crops and prompts','artifact hashes'],
              'elapsedSeconds':time.perf_counter()-started,'files':files}
    snapshot['digest']=body_digest(snapshot)
    save(output/'snapshot.json',snapshot)
    inspect(output,snapshot['digest'])
    return snapshot


def inspect(folder, expected_digest=None):
    folder=Path(folder).resolve();snapshot=read(folder/'snapshot.json')
    actual=body_digest({k:v for k,v in snapshot.items() if k!='digest'})
    if snapshot.get('kind')!='ui_visual_frozen_experiment_v1' or snapshot.get('digest')!=actual:
        raise ValueError('SNAPSHOT_CHANGED')
    if expected_digest is not None and actual!=expected_digest:
        raise ValueError('UNEXPECTED_SNAPSHOT')
    for name,sha in snapshot['files'].items():
        path=PurePosixPath(name)
        target=(folder/name).resolve()
        if path.is_absolute() or '..' in path.parts or '\\' in name or ':' in name or not target.is_relative_to(folder):
            raise ValueError('SNAPSHOT_PATH_ESCAPE')
        if not target.is_file() or digest(target)!=sha:
            raise ValueError('ARTIFACT_CHANGED:'+name)
    return snapshot


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--run');parser.add_argument('--output',required=True)
    parser.add_argument('--max-calls',type=int,default=128)
    parser.add_argument('--inspect',action='store_true');parser.add_argument('--expected-digest')
    args=parser.parse_args()
    if not args.inspect and not args.run:parser.error('--run is required to freeze')
    result=inspect(args.output,args.expected_digest) if args.inspect else freeze(args.run,args.output,args.max_calls)
    print(json.dumps({k:result[k] for k in ('status','materialCount','plannedCalls','executable','elapsedSeconds','digest')},ensure_ascii=False))
