"""Explicit user-directed material ownership merge; preserves historical M2 provenance."""
import copy
from pathlib import Path
from PIL import Image
from .compile_visual import compile_plan, render_prompt, validate, check_relations
from .freeze_visual import inspect, body_digest
from .evaluate import read, save, digest


def merge(snapshot, expected_digest, output, source_ids, target_id, instruction):
    snapshot=Path(snapshot);output=Path(output)
    parent=inspect(snapshot,expected_digest)
    visual=copy.deepcopy(read(snapshot/'evidence/m1-draft.json'))
    index={m['id']:m for m in visual['materials']}
    if not instruction.strip() or not source_ids or len(set(source_ids))!=len(source_ids):raise ValueError('EXPLICIT_MERGE_REQUIRED')
    if target_id in source_ids or not set(source_ids+[target_id])<=index.keys():raise ValueError('MERGE_IDS')
    target=index[target_id]
    for key in source_ids:
        a=index[key]['bboxNorm'];b=target['bboxNorm']
        if index[key]['role']!='foreground' or target['role']!='foreground' or not (b[0]<=a[0]<a[2]<=b[2] and b[1]<=a[1]<a[3]<=b[3]):raise ValueError('MERGE_REQUIRES_CONTAINED_FOREGROUND')
    for obj in visual['objects']:
        if obj['materialId'] in source_ids:obj['materialId']=target_id
    visual['materials']=[m for m in visual['materials'] if m['id'] not in source_ids]
    if check_relations(visual) or visual['unknowns']:raise ValueError('INVALID_REVISED_PLAN')
    output.mkdir(parents=True,exist_ok=False);evidence=output/'evidence';evidence.mkdir()
    (evidence/'parent-snapshot.json').write_bytes((snapshot/'snapshot.json').read_bytes())
    for name in ('m1-draft.json','m2-draft.json'):(evidence/('historical-'+name)).write_bytes((snapshot/'evidence'/name).read_bytes())
    save(evidence/'revised-visual-plan.json',visual)
    save(evidence/'user-directed-merge.json',{'instruction':instruction,'sources':source_ids,'target':target_id,
         'parentSnapshotDigest':expected_digest,'newM2ReviewPerformed':False,'reviewBasis':'explicit user ownership amendment; historical M2 does not review the revision'})
    (output/'reference.png').write_bytes((snapshot/'reference.png').read_bytes())
    with Image.open(output/'reference.png') as im:
        picture=im.convert('RGBA')
    plan,placements=compile_plan(visual,picture.size,digest(output/'reference.png'))
    # Preserve each merged picture as a complete visual unit, without sample-specific counts.
    for asset in plan['assets']:
        if asset['id']==target_id:asset['prompt']+=' Keep the merged illustration, its original internal scene and its owned frame together as a complete picture, at their original relative position and scale. Do not extract a transparent character silhouette from inside the picture.'
    validate(plan,source_base=output)
    save(output/'execution-plan.candidate.json',plan);save(output/'placements.json',{'basis':'declared material regions; approximate registration','materials':placements})
    rows=[]
    for asset in plan['assets']:
        folder=output/'materials'/asset['id'];folder.mkdir(parents=True)
        picture.crop(asset['source_region']).save(folder/'reference-crop.png')
        (folder/'prompt.txt').write_text(render_prompt(asset)+'\n',encoding='utf-8')
        rows.append({'asset':asset['id'],'reference':'reference.png','crop':(folder/'reference-crop.png').relative_to(output).as_posix(),
                     'prompt':(folder/'prompt.txt').relative_to(output).as_posix(),'outputSize':asset['output_size'],
                     'sourceRegion':asset['source_region'],'plannedCalls':1,'automaticRetries':0})
    save(output/'requests.json',{'kind':'ui_visual_requests_preview_v1','dispatchEnabled':False,'requests':rows})
    result={'kind':'ui_visual_frozen_experiment_v1','policy':'user-directed-contained-merge-v1','status':'frozen_experimental_snapshot',
            'executable':False,'productionReady':False,'humanVisualAcceptance':False,'generationCalls':0,
            'sourcePlanSha256':digest(evidence/'revised-visual-plan.json'),'parentSnapshotDigest':expected_digest,
            'newM2ReviewPerformed':False,'materialCount':len(rows),'plannedCalls':len(rows),'maximumCalls':len(rows),
            'legacyCompatibilityBlockers':parent['legacyCompatibilityBlockers'],
            'files':{p.relative_to(output).as_posix():digest(p) for p in sorted(output.rglob('*')) if p.is_file()}}
    result['digest']=body_digest(result);save(output/'snapshot.json',result);inspect(output,result['digest'])
    return result
