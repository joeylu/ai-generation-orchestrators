"""Regroup verified frozen planning without changing model answers or artwork."""
from pathlib import Path
import time

from .evaluate import read, save, digest
from .freeze_visual import inspect, body_digest
from .execution_preflight import preflight
from .generation_groups import build_groups, COMPACT_CONTROL_V2
from .context_references import prompt, request_references
from .visual_policy import snapshot_policy, generation_guidance


def regroup(source, expected_digest, output, maximum_calls):
    source=Path(source).resolve();output=Path(output).resolve();started=time.perf_counter()
    parent=inspect(source,expected_digest);preflight(source,expected_digest)
    if output.exists() or output.is_relative_to(source) or source.is_relative_to(output):
        raise ValueError('FRESH_SEPARATE_REGROUP_OUTPUT_REQUIRED')
    if (type(maximum_calls) is not int or not 1<=maximum_calls<=128 or
            parent.get('generationReference')!='context-crops' or
            parent.get('contextPromptVersion') not in ('v7','v8','v9','v10','v11','v12','v13') or
            parent.get('planningDriver')!='host-model-exchange-v1' or
            parent.get('policy')!='visual-plan-v5-experiment-v1' or
            any(parent.get(key) for key in ('visualTexturePolicy','materialReusePolicy','backgroundRegionPolicy'))):
        raise ValueError('REGROUP_REVIEWED_CONTEXT_PLAN_REQUIRED')
    visual_path=source/'evidence/revised-visual-plan.json'
    if not visual_path.exists():visual_path=source/'evidence/m1-draft.json'
    visual=read(visual_path);plan=read(source/'execution-plan.candidate.json')
    groups=build_groups(visual,plan,COMPACT_CONTROL_V2)
    if groups['plannedCalls']>maximum_calls:raise ValueError('REGROUP_CALL_LIMIT_EXCEEDED')
    policy=snapshot_policy(source,parent)
    output.mkdir(parents=True)
    # Only copy the manifest allowlist. Never copy attempt/auth/host state.
    replace={'generation-groups.json','requests.json','compile-report.json'}
    preserved={name:sha for name,sha in parent['files'].items()
        if name not in replace and not name.startswith('sheets/')}
    for name,sha in preserved.items():
        target=output/name;target.parent.mkdir(parents=True,exist_ok=True)
        target.write_bytes((source/name).read_bytes())
        if digest(target)!=sha:raise ValueError('REGROUP_SOURCE_CHANGED')
    save(output/'generation-groups.json',groups)
    refs=read(output/'generation-references.json');assets={a['id']:a for a in plan['assets']};rows=[]
    for group in groups['groups']:
        key=group['id'];mids=group['materialIds']
        if group['mode']=='single':
            asset=assets[key]
            row=dict(asset=key,reference='reference.png',crop='materials/'+key+'/reference-crop.png',
                prompt='materials/'+key+'/prompt.txt',outputSize=asset['output_size'],sourceRegion=asset['source_region'],
                plannedCalls=1,automaticRetries=0)
        else:
            folder=output/'sheets'/key;folder.mkdir(parents=True)
            text=prompt(visual,plan,mids,group,version=parent['contextPromptVersion'])+generation_guidance(policy,edit_only=parent['contextPromptVersion'] in ('v12','v13'))+'\n'
            (folder/'prompt.txt').write_text(text,encoding='utf-8')
            row=dict(asset=key,kind='sheet',materialIds=mids,grid=group['grid'],reference='reference.png',
                prompt='sheets/'+key+'/prompt.txt',outputSize=group['outputSize'],plannedCalls=1,automaticRetries=0)
        row.update(generationReference='context-crops',references=request_references(refs,mids));rows.append(row)
    requests=read(source/'requests.json');requests['requests']=rows;requests['kind']='ui_visual_requests_preview_v2'
    save(output/'requests.json',requests)
    report=read(source/'compile-report.json')
    report.update(plannedCalls=len(rows),maximumCalls=maximum_calls,elapsedSeconds=time.perf_counter()-started)
    save(output/'compile-report.json',report)
    lineage=dict(kind='ui_frozen_grouping_revision_v1',parentSnapshotDigest=expected_digest,
        parentSourcePlanSha256=parent['sourcePlanSha256'],parentReviewSha256=parent['reviewSha256'],
        groupingPolicy=COMPACT_CONTROL_V2,preservedFiles=preserved,
        modelCalls=0,generationCalls=0,originalAnswersChanged=False,materialOwnershipChanged=False)
    save(output/'grouping-lineage.json',lineage)
    manifest={k:v for k,v in parent.items() if k!='digest'}
    manifest.update(plannedCalls=len(rows),maximumCalls=maximum_calls,
        elapsedSeconds=time.perf_counter()-started,regroupedFromSnapshotDigest=expected_digest,
        files={p.relative_to(output).as_posix():digest(p) for p in sorted(output.rglob('*')) if p.is_file()})
    manifest['digest']=body_digest(manifest);save(output/'snapshot.json',manifest)
    inspect(source,expected_digest);preflight(output,manifest['digest'])
    return dict(status='regrouped_verified_snapshot',digest=manifest['digest'],
        materialCount=manifest['materialCount'],plannedCalls=len(rows),modelCalls=0,generationCalls=0)


def main():
    import argparse,json
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command',choices=['regroup-reviewed-snapshot'])
    parser.add_argument('--source',required=True);parser.add_argument('--digest',required=True)
    parser.add_argument('--output',required=True);parser.add_argument('--max-calls',type=int,required=True)
    args=parser.parse_args()
    print(json.dumps(regroup(args.source,args.digest,args.output,args.max_calls),ensure_ascii=False))
