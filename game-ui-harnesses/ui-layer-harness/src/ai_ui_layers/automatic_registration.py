"""One read-only localization call per generated control group, then deterministic placement."""
import argparse
import copy
import json
from pathlib import Path
import shutil
import tempfile
import numpy as np
from PIL import Image
from jsonschema import Draft202012Validator
from .compile_visual import HARNESS
from .codex_call import command, CLI_MODEL, CLI_EFFORT
from .session_review import invoke
from .evaluate import read,save,digest
from .freeze_visual import inspect
from .place_parts import box
from .preview_partial import preview
from .registration_policy import integrated_surface
from .postprocess_visual import process

BASE=HARNESS/'planning-harness'
OBSERVATION_MAX_EDGE=1536


def observation_image(source, destination):
    """Bound the actual attachment size; preserve the original as pixel authority."""
    with Image.open(source) as im:
        original=im.size
        image=im.convert('RGBA')
        image.thumbnail((OBSERVATION_MAX_EDGE,OBSERVATION_MAX_EDGE),Image.Resampling.LANCZOS)
        image.save(destination)
    return dict(originalSize=list(original),observationSize=list(image.size),
                originalSha256=digest(Path(source)),observationSha256=digest(destination),
                mapping='floor-rational-half-open-edges')


def original_box(values, mapping):
    observed=mapping['observationSize'];original=mapping['originalSize']
    checked=box(values,observed)
    mapped=[v*original[i%2]//observed[i%2] for i,v in enumerate(checked)]
    return box(mapped,original)


def original_coordinates(answer, source_mapping, reference_mapping):
    result=copy.deepcopy(answer)
    for part in result['parts']:
        for fragment in part['fragments']:
            fragment['sourceBox']=original_box(fragment['sourceBox'],source_mapping)
            fragment['targetBox']=original_box(fragment['targetBox'],reference_mapping)
    return result


def candidates(visual):
    result=[]
    for m in visual['materials']:
        if integrated_surface(visual,m) is not None: continue
        objects=[o for o in visual['objects'] if o['materialId']==m['id']]
        if m['role']=='foreground' and sum(o['kind'] in ('button','card','icon') for o in objects)>=2 \
                and not any(o['kind'] in ('panel','illustration','background') for o in objects):
            result.append(m['id'])
    return result


def call_model(folder):
    # Codex runs in a separate temporary cwd; bind every attachment/output first.
    folder=Path(folder).resolve()
    exe=shutil.which('codex')
    if not exe:raise ValueError('CODEX_NOT_FOUND')
    with tempfile.TemporaryDirectory(prefix='ui-registration-') as cwd:
        args=command(exe,folder,Path(cwd),CLI_MODEL,CLI_EFFORT)
        images=[folder/'reference.png',folder/'generated.png']
        if (folder/'detail-compare.png').is_file():images.append(folder/'detail-compare.png')
        args[args.index('--image')+1]=','.join(map(str,images))
        return invoke(args,folder,cwd,(folder/'prompt.md').read_text(encoding='utf-8'))


def overlap(a,b):
    return max(a[0],b[0])<min(a[2],b[2]) and max(a[1],b[1])<min(a[3],b[3])


def refine_source_bounds(answer, raw):
    """Snap approximate model source boxes to nearby existing alpha, never invent target geometry."""
    result=copy.deepcopy(answer);changes=[]
    support=np.asarray(raw.convert('RGBA').getchannel('A'))>=8
    proposed=[box(f['sourceBox'],raw.size) for p in answer['parts'] for f in p['fragments']]
    for part in result['parts']:
        for index,fragment in enumerate(part['fragments']):
            l,t,r,b=box(fragment['sourceBox'],raw.size)
            if not support[t:b,l:r].any():raise ValueError('EMPTY_SOURCE_FRAGMENT')
            # Limited search only: large omissions and neighbouring-object collisions still fail validation.
            dx=max(8,int((r-l)*.05));dy=max(8,int((b-t)*.05))
            # Include eight pixels of localization tolerance in addition to proportional margin.
            dx+=8;dy+=8
            ll,tt,rr,bb=max(0,l-dx),max(0,t-dy),min(raw.width,r+dx),min(raw.height,b+dy)
            # Do not expand through the gap towards a neighbouring model-identified object.
            for ol,ot,orr,ob in proposed:
                if [ol,ot,orr,ob]==[l,t,r,b]:continue
                if max(t,ot)<min(b,ob):
                    if orr<=l:ll=max(ll,(orr+l)//2)
                    if r<=ol:rr=min(rr,(r+ol)//2)
                if max(l,ol)<min(r,orr):
                    if ob<=t:tt=max(tt,(ob+t)//2)
                    if b<=ot:bb=min(bb,(b+ot)//2)
            y,x=np.nonzero(support[tt:bb,ll:rr])
            if not len(x):raise ValueError('EMPTY_SOURCE_FRAGMENT')
            refined=[ll+int(x.min()),tt+int(y.min()),ll+int(x.max())+1,tt+int(y.max())+1]
            # Support touching the interior search edge means the full contour was not found.
            if (refined[0]==ll and ll>0) or (refined[1]==tt and tt>0) or (refined[2]==rr and rr<raw.width) or (refined[3]==bb and bb<raw.height):
                raise ValueError('SOURCE_CONTOUR_EXCEEDS_LOCAL_SEARCH')
            if refined!=fragment['sourceBox']:
                changes.append(dict(objectId=part['objectId'],fragmentIndex=index,before=fragment['sourceBox'],after=refined))
            fragment['sourceBox']=refined
    return result,changes


def validate_answer(answer, schema, objects, region, raw, reference_size):
    Draft202012Validator(schema).validate(answer)
    if answer['issues']:raise ValueError('MODEL_REPORTED_ISSUES: '+json.dumps(answer['issues'],ensure_ascii=False))
    parts=answer['parts'];ids=[p['objectId'] for p in parts];owned={o['id']:o for o in objects}
    if len(ids)!=len(set(ids)) or set(ids)!=set(owned):raise ValueError('PART_OWNERSHIP_MISMATCH')
    alpha=np.asarray(raw.convert('RGBA').getchannel('A'));support=alpha>=8
    if not (alpha.min()==0 and support.any()):raise ValueError('REGISTRATION_REQUIRES_NATIVE_ALPHA')
    covered=np.zeros(support.shape,dtype=bool);sources=[];targets=[];result=[]
    for p in parts:
        fragments=p['fragments']
        if p['fitMode']=='frame-bounds' and (len(fragments)!=1 or owned[p['objectId']]['kind'] not in ('button','card')):
            raise ValueError('UNSAFE_FRAME_FIT')
        for f in fragments:
            source=box(f['sourceBox'],raw.size);target=box(f['targetBox'],reference_size)
            if not (region[0]<=target[0]<target[2]<=region[2] and region[1]<=target[1]<target[3]<=region[3]):
                raise ValueError('TARGET_OUTSIDE_MATERIAL')
            if any(overlap(source,s) for s in sources) or any(overlap(target,t) for t in targets):
                raise ValueError('OVERLAPPING_FRAGMENTS')
            l,t,r,b=source
            if not support[t:b,l:r].any():raise ValueError('EMPTY_SOURCE_FRAGMENT')
            covered[t:b,l:r]=True;sources.append(source);targets.append(target)
        if len(fragments)==1:result.append(dict(objectId=p['objectId'],fitMode=p['fitMode'],**fragments[0]))
        else:result.append(dict(objectId=p['objectId'],fragments=fragments))
    coverage=float((support&covered).sum()/support.sum())
    if coverage<.98:raise ValueError('GENERATED_ARTWORK_OMITTED')
    return result,coverage


def run(config_path, output, model_call=None, selected=None):
    config=read(Path(config_path));output=Path(output).resolve()
    snapshot=Path(config['snapshot']).resolve();inspect(snapshot,config['snapshotDigest'])
    path=snapshot/'evidence/revised-visual-plan.json'
    visual=read(path if path.exists() else snapshot/'evidence/m1-draft.json')
    placements={p['id']:p for p in read(snapshot/'placements.json')['materials']}
    if not set(config['materials'])<=set(placements):raise ValueError('UNKNOWN_MATERIAL')
    if config.get('partPlacements'):raise ValueError('AUTOMATIC_ENTRY_REJECTS_MANUAL_PLACEMENTS')
    eligible=candidates(visual)
    selected=[k for k in eligible if k in config['materials']] if selected is None else selected
    if len(selected)!=len(set(selected)) or not set(selected)<=set(eligible)&set(config['materials']):
        raise ValueError('INVALID_REGISTRATION_SELECTION')
    output.mkdir(parents=True,exist_ok=False)
    config['materials']={k:str(Path(v).resolve()) for k,v in config['materials'].items()}
    config['snapshot']=str(snapshot)
    reference=snapshot/'reference.png'
    inputs={'reference':digest(reference),**{k:digest(Path(v)) for k,v in config['materials'].items()}}
    driver='codex-cli' if model_call is None else getattr(model_call,'driver','injected-test-double')
    whole=[dict(materialId=m['id'],outerObjectId=integrated_surface(visual,m),mode='whole-material-frame-bounds')
           for m in visual['materials'] if m['id'] in config['materials'] and integrated_surface(visual,m) is not None]
    save(output/'request.json',dict(config=config,selected=selected,integratedSurfaces=whole,inputs=inputs,
         driver=driver,generationCalls=0,automaticResubmissions=0))
    config['partPlacements']={};calls=0;reports=[]
    try:
        # Run the existing whole-material gates before spending localization calls.
        # Selected groups still require their per-part placement validation below.
        assets={a['id']:a for a in read(snapshot/'execution-plan.candidate.json')['assets']}
        integrated={r['materialId'] for r in whole}
        raw_checks=[]
        for key,source in config['materials'].items():
            if key in selected:continue
            row=placements[key]
            checked=process(Path(source),row['outputSize'],output/'raw-preflight'/key,
                            background=assets[key]['role']=='background',
                            fit_mode='frame-bounds' if key in integrated else row.get('fitMode','contain'))
            raw_checks.append(dict(materialId=key,sourceSha256=checked['sourceSha256'],
                                   status=checked['status'],issues=checked['issues']))
        save(output/'raw-preflight.json',dict(materials=raw_checks,generationCalls=0,modelCalls=0))
        if any(r['status']=='blocked' for r in raw_checks):
            raise ValueError('MATERIAL_POSTPROCESS_BLOCKED')
        for i,key in enumerate(selected):
            folder=output/('localize-'+str(i+1));folder.mkdir()
            source=Path(config['materials'][key]);objects=[o for o in visual['objects'] if o['materialId']==key]
            reference_mapping=observation_image(reference,folder/'reference.png')
            source_mapping=observation_image(source,folder/'generated.png')
            save(folder/'observation-mapping.json',dict(reference=reference_mapping,generated=source_mapping))
            (folder/'schema.json').write_bytes((BASE/'schemas/material-registration.schema.json').read_bytes())
            with Image.open(source) as im:raw=im.convert('RGBA')
            with Image.open(reference) as im:reference_size=im.size
            region=placements[key]['sourceRegion']
            observed_region=[v*reference_mapping['observationSize'][i%2]//reference_size[i%2]
                             for i,v in enumerate(region)]
            data=dict(materialId=key,referenceSize=reference_mapping['observationSize'],
                      generatedSize=source_mapping['observationSize'],
                      referenceMaterialRegion=observed_region,objects=objects)
            prompt=(BASE/'prompts/material-registration.md').read_text(encoding='utf-8')+'\n'+json.dumps(data,ensure_ascii=False)
            (folder/'prompt.md').write_text(prompt,encoding='utf-8')
            fingerprints={n:digest(folder/n) for n in ('reference.png','generated.png','schema.json','prompt.md','observation-mapping.json')}
            save(folder/'request.json',dict(inputs=fingerprints,materialId=key))
            print(json.dumps(dict(stage='localize',material=key)),flush=True)
            calls+=1;transport=(model_call or call_model)(folder)
            if transport.get('exitCode')!=0 or not transport.get('turnCompleted') or transport.get('unexpectedEvents') or transport.get('failure'):
                raise ValueError('LOCALIZATION_TRANSPORT_FAILED')
            if transport.get('responseSha256')!=digest(folder/'draft.json'):raise ValueError('RESPONSE_CHANGED')
            if any(digest(folder/n)!=h for n,h in fingerprints.items()):raise ValueError('INPUT_CHANGED')
            answer=read(folder/'draft.json');schema=read(folder/'schema.json')
            Draft202012Validator(schema).validate(answer)
            if answer['issues']:raise ValueError('MODEL_REPORTED_ISSUES: '+json.dumps(answer['issues'],ensure_ascii=False))
            answer=original_coordinates(answer,source_mapping,reference_mapping)
            save(folder/'original-coordinate-answer.json',answer)
            answer,adjustments=refine_source_bounds(answer,raw)
            save(folder/'source-bound-refinement.json',dict(adjustments=adjustments,basis='local existing alpha bounds; target boxes unchanged'))
            parts,coverage=validate_answer(answer,schema,objects,
                                           placements[key]['sourceRegion'],raw,reference_size)
            contract=folder/'placement.json'
            save(contract,dict(kind='material-parts-placement-v1',sourceSha256=inputs[key],referenceSha256=inputs['reference'],
                 parts=parts,observationSource='model-localization',responseSha256=digest(folder/'draft.json')))
            config['partPlacements'][key]=str(contract)
            reports.append(dict(materialId=key,coverage=coverage,elapsedSeconds=transport.get('elapsedSeconds'),
                                placementSha256=digest(contract)))
        if digest(reference)!=inputs['reference'] or any(digest(Path(v))!=inputs[k] for k,v in config['materials'].items()):
            raise ValueError('INPUT_CHANGED')
        cp=output/'preview-input.json';save(cp,config)
        assembled=preview(cp,output/'preview')
        if any(r['report']['status']=='blocked' for r in assembled['records']):raise ValueError('MATERIAL_POSTPROCESS_BLOCKED')
        result=dict(status='awaiting_visual_review',localizations=reports,integratedSurfaces=whole,modelCalls=0 if driver=='recorded-response-replay' else calls,
                    localizationSteps=calls,driver=driver,
                    generationCalls=0,automaticResubmissions=0,humanVisualAcceptance=False)
    except Exception as exc:
        result=dict(status='blocked_no_retry',reason=str(exc),localizations=reports,modelCalls=0 if driver=='recorded-response-replay' else calls,
                    localizationSteps=calls,driver=driver,
                    generationCalls=0,automaticResubmissions=0,humanVisualAcceptance=False)
        save(output/'result.json',result)
        raise
    save(output/'result.json',result)
    return result


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--config',required=True);p.add_argument('--output',required=True)
    p.add_argument('--materials',nargs='+',help='Optional eligible subset; default all available control groups')
    a=p.parse_args();print(json.dumps(run(a.config,a.output,selected=a.materials),ensure_ascii=False))
