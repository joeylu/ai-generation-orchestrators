"""Freeze an explicit user-directed visual-plan amendment, not a new M2 approval."""
from pathlib import Path
from PIL import Image
from jsonschema import Draft202012Validator
from compile_visual import HARNESS,compile_plan,render_prompt,validate
from freeze_visual import inspect,body_digest
from evaluate import read,save,digest


def freeze_amendment(parent, expected, visual, output, instruction):
    parent=Path(parent);output=Path(output);old=inspect(parent,expected)
    if not instruction.strip():raise ValueError('INSTRUCTION_REQUIRED')
    Draft202012Validator(read(HARNESS/'planning-harness/schemas/visual-plan.schema.json')).validate(visual)
    if visual['unknowns']:raise ValueError('UNRESOLVED_UNKNOWNS')
    with Image.open(parent/'reference.png') as im:picture=im.convert('RGBA')
    plan,placements=compile_plan(visual,picture.size,digest(parent/'reference.png'))
    output.mkdir(parents=True,exist_ok=False);evidence=output/'evidence';evidence.mkdir()
    save(evidence/'revised-visual-plan.json',visual)
    save(evidence/'amendment.json',{'instruction':instruction,'parentSnapshotDigest':expected,'newM2ReviewPerformed':False})
    (evidence/'parent-snapshot.json').write_bytes((parent/'snapshot.json').read_bytes())
    (output/'reference.png').write_bytes((parent/'reference.png').read_bytes())
    validate(plan,source_base=output)
    save(output/'execution-plan.candidate.json',plan)
    save(output/'placements.json',{'basis':'declared material regions; approximate registration','materials':placements})
    rows=[]
    for asset in plan['assets']:
        folder=output/'materials'/asset['id'];folder.mkdir(parents=True)
        picture.crop(asset['source_region']).save(folder/'reference-crop.png')
        (folder/'prompt.txt').write_text(render_prompt(asset)+'\n',encoding='utf-8')
        rows.append({'asset':asset['id'],'reference':'reference.png','crop':(folder/'reference-crop.png').relative_to(output).as_posix(),
                     'prompt':(folder/'prompt.txt').relative_to(output).as_posix(),'sourceRegion':asset['source_region'],
                     'outputSize':asset['output_size'],'plannedCalls':1,'automaticRetries':0})
    save(output/'requests.json',{'kind':'ui_visual_requests_preview_v1','dispatchEnabled':False,'requests':rows})
    report={'kind':'ui_visual_frozen_experiment_v1','policy':'explicit-user-amendment-v1','status':'frozen_experimental_snapshot',
            'executable':False,'productionReady':False,'humanVisualAcceptance':False,'newM2ReviewPerformed':False,
            'materialCount':len(rows),'plannedCalls':len(rows),'maximumCalls':len(rows),
            'parentSnapshotDigest':expected,'sourcePlanSha256':digest(evidence/'revised-visual-plan.json'),
            'legacyCompatibilityBlockers':old['legacyCompatibilityBlockers'],
            'files':{p.relative_to(output).as_posix():digest(p) for p in sorted(output.rglob('*')) if p.is_file()}}
    report['digest']=body_digest(report);save(output/'snapshot.json',report);inspect(output,report['digest'])
    return report
