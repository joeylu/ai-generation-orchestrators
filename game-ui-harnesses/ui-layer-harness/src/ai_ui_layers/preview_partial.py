"""Offline partial reconstruction from explicit existing raw materials; no generation."""
import argparse
from pathlib import Path
from PIL import Image, ImageDraw
from .evaluate import read, save, digest
from .freeze_visual import inspect
from .postprocess_visual import process
from .place_parts import place
from .short_prompt import carries_foreground
from .registration_policy import integrated_surface


def preview(config_path, output):
    config=read(Path(config_path));output=Path(output)
    if 'surfaceDetails' in config or 'fontPaths' in config:raise ValueError('PROGRAMMATIC_UI_DRAWING_REMOVED')
    snapshot=Path(config['snapshot']);inspect(snapshot,config['snapshotDigest'])
    plan=read(snapshot/'execution-plan.candidate.json')
    placements=read(snapshot/'placements.json')['materials']
    assets={a['id']:a for a in plan['assets']}
    overrides=config.get('partPlacements',{})
    visual=read(snapshot/'evidence/revised-visual-plan.json') if (snapshot/'evidence/revised-visual-plan.json').exists() else read(snapshot/'evidence/m1-draft.json')
    if not set(overrides)<=set(config['materials']):raise ValueError('UNUSED_PART_PLACEMENT')
    if visual.get('surfaceDetails') or ((snapshot/'surface-details.json').exists() and read(snapshot/'surface-details.json')):
        raise ValueError('RETIRED_DRAWING_PLAN_REQUIRES_REPLAN')
    ids={p['id'] for p in placements}
    if not set(config['materials']) <= ids:raise ValueError('UNKNOWN_MATERIAL')
    frame_overrides=config.get('frameBoundsMaterials',[])
    if not isinstance(frame_overrides,list) or len(frame_overrides)!=len(set(frame_overrides)):
        raise ValueError('INVALID_FRAME_OVERRIDES')
    if not set(frame_overrides)<=set(config['materials']):raise ValueError('UNUSED_FRAME_OVERRIDE')
    if set(frame_overrides)&set(overrides):raise ValueError('CONFLICTING_PLACEMENT_OVERRIDES')
    carriers={m['id'] for m in visual['materials'] if carries_foreground(visual,m)}
    integrated={m['id']:integrated_surface(visual,m) for m in visual['materials'] if integrated_surface(visual,m) is not None}
    if set(integrated)&set(overrides):raise ValueError('INTEGRATED_SURFACE_REQUIRES_WHOLE_PLACEMENT')
    if not set(frame_overrides)<=carriers:raise ValueError('FRAME_OVERRIDE_REQUIRES_CARRIER_PANEL')
    output.mkdir(parents=True,exist_ok=False)
    canvas=Image.new('RGBA',tuple(plan['canvas']))
    records=[]
    for row in sorted(placements,key=lambda r:r['drawIndex']):
        key=row['id']
        if key not in config['materials']:continue
        raw=Path(config['materials'][key]);folder=output/key
        if key in overrides:
            expected=[o['id'] for o in visual['objects'] if o['materialId']==key]
            report=place(raw,snapshot/'reference.png',overrides[key],row['sourceRegion'],expected,folder)
        else:report=process(raw,row['outputSize'],folder,background=assets[key]['role']=='background',
                            fit_mode='frame-bounds' if key in frame_overrides or key in integrated else row.get('fitMode','contain'))
        if key in integrated:
            report['registrationPolicy']={'mode':'whole-material-frame-bounds','outerObjectId':integrated[key],
                'basis':'one card/button with bounded owned details; explicit outer box equals material region or null auxiliary box uses declared material bounds; no measured reference silhouette',
                'internalRepositioning':False}
        records.append({'id':key,'source':str(raw),'sourceSha256':digest(raw),
                        'xy':row['xy'],'report':report})
        if report['status']=='blocked':continue
        with Image.open(folder/'material.png') as im:canvas.alpha_composite(im,tuple(row['xy']))
    canvas.save(output/'partial-transparent.png')
    w,h=canvas.size
    checker=Image.new('RGBA',(w,h),(224,224,224,255));draw=ImageDraw.Draw(checker)
    for y in range(0,h,32):
        for x in range(0,w,32):
            if (x//32+y//32)%2:draw.rectangle((x,y,x+31,y+31),fill=(244,244,244,255))
    checker.alpha_composite(canvas)
    with Image.open(snapshot/'reference.png') as im:reference=im.convert('RGB')
    comparison=Image.new('RGB',(w*2,h),'white')
    comparison.paste(reference,(0,0));comparison.paste(checker.convert('RGB'),(w,0))
    comparison.save(output/'reference-vs-partial.png')
    report={'kind':'partial-placement-preview-v1','snapshotDigest':config['snapshotDigest'],
            'frameBoundsOverrides':frame_overrides,
            'generationCalls':0,'humanVisualAcceptance':False,'records':records,
            'scope':'Only supplied materials; absent layers remain absent, never overlaid on the original.',
            'registration':'Explicit per-object boxes where supplied; declared frame bounds for carrier fits; remaining materials use approximate centered contain.'}
    save(output/'report.json',report)
    return report

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--config',required=True);p.add_argument('--output',required=True)
    p.add_argument('--auto-register',action='store_true',help='Localize generated control groups with a read-only model call before placement')
    a=p.parse_args()
    if a.auto_register:
        from .automatic_registration import run
        run(a.config,a.output)
    else:preview(a.config,a.output)
