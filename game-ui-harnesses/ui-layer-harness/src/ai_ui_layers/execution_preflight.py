"""Read-only execution input checks for experimental snapshots. No provider calls."""
import argparse
import json
from pathlib import Path
import time

from PIL import Image
from .freeze_visual import inspect
from .compile_visual import validate, render_prompt
from .evaluate import read


def preflight(folder, expected_digest):
    started=time.perf_counter();folder=Path(folder)
    snapshot=inspect(folder,expected_digest)
    if (folder/'surface-details.json').exists() and read(folder/'surface-details.json'):
        raise ValueError('RETIRED_DRAWING_PLAN_REQUIRES_REPLAN')
    required={'execution-plan.candidate.json','reference.png','requests.json'}
    if not required <= snapshot['files'].keys():
        raise ValueError('UNBOUND_EXECUTION_INPUT')
    plan=read(folder/'execution-plan.candidate.json');validate(plan,source_base=folder)
    requests=read(folder/'requests.json')
    if requests.get('kind') not in ('ui_visual_requests_preview_v1','ui_visual_requests_preview_v2') or requests.get('dispatchEnabled') is not False:
        raise ValueError('REQUEST_PREVIEW_REQUIRED')
    rows=requests['requests'];assets=plan['assets']
    grouped=requests['kind']=='ui_visual_requests_preview_v2'
    if not (len(rows)==snapshot['plannedCalls']<=snapshot['maximumCalls']) or (not grouped and len(rows)!=len(assets)):
        raise ValueError('REQUEST_COUNT_MISMATCH')
    if not grouped and ([r['asset'] for r in rows]!=[a['id'] for a in assets]
                        or any('kind' in r or 'materialIds' in r for r in rows)):
        raise ValueError('REQUEST_PLAN_MISMATCH')
    context=requests.get('generationReference')=='context-crops'
    if requests.get('generationReference','full') not in ('full','context-crops'):
        raise ValueError('GENERATION_REFERENCE')
    if snapshot.get('generationReference','full')!=requests.get('generationReference','full'):
        raise ValueError('CONTEXT_REFERENCE_MODE_MISMATCH')
    with Image.open(folder/'reference.png') as source:
        reference=source.convert('RGBA')
    context_document=None
    context_prompt_version=snapshot.get('contextPromptVersion','v1')
    if context:
        if context_prompt_version not in ('v1','v2'):
            raise ValueError('CONTEXT_PROMPT_VERSION')
        report=read(folder/'compile-report.json')
        if report.get('contextPromptVersion', 'v1')!=context_prompt_version:
            raise ValueError('CONTEXT_PROMPT_VERSION_MISMATCH')
        from .context_references import verify as verify_context, request_references, prompt as context_prompt
        from .compile_visual import compile_plan
        from .evaluate import digest
        visual_path=folder/'evidence/revised-visual-plan.json'
        if not visual_path.exists():visual_path=folder/'evidence/m1-draft.json'
        visual=read(visual_path)
        rebuilt,_=compile_plan(visual,reference.size,digest(folder/'reference.png'),plan['id'],
                               'context-crops',context_prompt_version=context_prompt_version)
        if rebuilt!=plan:raise ValueError('CONTEXT_PLAN_COMPILER_MISMATCH')
        context_document=verify_context(folder,plan,snapshot,reference)
    elif ('generation-references.json' in snapshot['files'] or
          'contextPromptVersion' in snapshot or
          any(a['prompt'].startswith(('visual-material-context-prompt-v1:\n',
                                      'visual-material-context-prompt-v2:\n')) for a in assets) or
          any('generationReference' in row or 'references' in row for row in rows)):
        raise ValueError('CONTEXT_REFERENCE_MODE_MISMATCH')
    if grouped:
        from .generation_groups import build_groups, sheet_prompt, CONTEXT_GROUP_POLICY
        visual_path=folder/'evidence/revised-visual-plan.json'
        if not visual_path.exists():visual_path=folder/'evidence/m1-draft.json'
        if 'generation-groups.json' not in snapshot['files']:raise ValueError('GENERATION_GROUPS_CHANGED')
        frozen_groups=read(folder/'generation-groups.json')
        if (frozen_groups.get('policy')==CONTEXT_GROUP_POLICY)!=context:
            raise ValueError('CONTEXT_GROUP_POLICY_MISMATCH')
        visual=read(visual_path);groups=build_groups(visual,plan,frozen_groups.get('policy'))
        if frozen_groups!=groups:
            raise ValueError('GENERATION_GROUPS_CHANGED')
        if len(groups['groups'])!=len(rows):raise ValueError('REQUEST_COUNT_MISMATCH')
        for row,group in zip(rows,groups['groups']):
            if row['asset']!=group['id']:raise ValueError('GROUP_REQUEST_MISMATCH')
            if group['mode']=='sheet':
                expected=dict(asset=group['id'],kind='sheet',materialIds=group['materialIds'],grid=group['grid'],
                    reference='reference.png',prompt='sheets/'+group['id']+'/prompt.txt',
                    outputSize=group['outputSize'],plannedCalls=1,automaticRetries=0)
                if context:expected.update(generationReference='context-crops',
                    references=request_references(context_document,group['materialIds']))
                if row!=expected or row['prompt'] not in snapshot['files']:raise ValueError('GROUP_REQUEST_MISMATCH')
                compiled=(folder/row['prompt']).read_text(encoding='utf-8')
                allowed=(sheet_prompt(visual,plan,group)+'\n',
                         sheet_prompt(visual,plan,group,legacy_repeated_descriptions=True)+'\n',
                         sheet_prompt(visual,plan,group,legacy_repeated_descriptions=True,
                                      legacy_without_attached_props=True)+'\n')
                if context:allowed=(context_prompt(visual,plan,group['materialIds'],group,
                                                   version=context_prompt_version)+'\n',)
                if compiled not in allowed:
                    raise ValueError('PROMPT_COMPILER_MISMATCH')
            elif row.get('kind') or 'materialIds' in row:
                raise ValueError('GROUP_REQUEST_MISMATCH')
        covered=[key for row in rows for key in row.get('materialIds',[row['asset']])]
        if len(covered)!=len(set(covered)) or set(covered)!={a['id'] for a in assets}:
            raise ValueError('MATERIAL_OWNERSHIP_MISMATCH')
    index={a['id']:a for a in assets}
    for row in rows:
        if row.get('kind')=='sheet':continue
        asset=index[row['asset']]
        if context:
            expected=dict(asset=asset['id'],reference='reference.png',crop='materials/'+asset['id']+'/reference-crop.png',
                prompt='materials/'+asset['id']+'/prompt.txt',outputSize=asset['output_size'],
                sourceRegion=asset['source_region'],plannedCalls=1,automaticRetries=0,
                generationReference='context-crops',references=request_references(context_document,[asset['id']]))
            if row!=expected:raise ValueError('CONTEXT_REQUEST_MISMATCH')
        if row['asset']!=asset['id'] or row['sourceRegion']!=asset['source_region'] or row['outputSize']!=asset['output_size']:
            raise ValueError('REQUEST_PLAN_MISMATCH')
        if row['reference']!='reference.png' or row['plannedCalls']!=1 or row['automaticRetries']!=0:
            raise ValueError('REQUEST_POLICY_MISMATCH')
        if row['crop'] not in snapshot['files'] or row['prompt'] not in snapshot['files']:
            raise ValueError('UNBOUND_EXECUTION_INPUT')
        if (folder/row['prompt']).read_text(encoding='utf-8')!=render_prompt(asset)+'\n':
            raise ValueError('PROMPT_COMPILER_MISMATCH')
        with Image.open(folder/row['crop']) as crop:
            expected=reference.crop(asset['source_region'])
            if crop.size!=expected.size or crop.convert('RGBA').tobytes()!=expected.tobytes():
                raise ValueError('CROP_REFERENCE_MISMATCH')
    total=sum(a['output_size'][0]*a['output_size'][1] for a in assets)
    return {'kind':'ui_visual_execution_preflight_v1','snapshotDigest':snapshot['digest'],
            'inputChecks':'passed','requestCount':len(rows),'totalTargetPixels':total,
            'generationCalls':0,'dispatchEnabled':False,'status':'execution_route_required',
            'legacyCompatibilityBlockers':snapshot['legacyCompatibilityBlockers'],
            **({'generationReference':'context-crops'} if context else {}),
            'elapsedSeconds':time.perf_counter()-started}


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--snapshot',required=True);parser.add_argument('--expected-digest',required=True)
    args=parser.parse_args()
    print(json.dumps(preflight(args.snapshot,args.expected_digest),ensure_ascii=False,indent=2))
