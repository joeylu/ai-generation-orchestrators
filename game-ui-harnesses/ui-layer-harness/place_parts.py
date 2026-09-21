"""Deterministic per-object placement of parts from one generated material."""
from pathlib import Path
from PIL import Image
from evaluate import read,save,digest
from postprocess_visual import fit_native


def box(value, size):
    if not isinstance(value,list) or len(value)!=4 or any(type(v)!=int for v in value):raise ValueError('INTEGER_BOX_REQUIRED')
    l,t,r,b=value
    if not (0<=l<r<=size[0] and 0<=t<b<=size[1]):raise ValueError('BOX_OUT_OF_BOUNDS')
    return value


def place(source, reference, contract_path, region, expected_ids, output):
    source=Path(source);reference=Path(reference);output=Path(output)
    contract=read(Path(contract_path))
    if contract.get('kind')!='material-parts-placement-v1':raise ValueError('PLACEMENT_KIND')
    if contract['sourceSha256']!=digest(source) or contract['referenceSha256']!=digest(reference):raise ValueError('PLACEMENT_SOURCE_CHANGED')
    parts=contract['parts'];ids=[p['objectId'] for p in parts]
    if len(ids)!=len(set(ids)) or set(ids)!=set(expected_ids):raise ValueError('PART_OWNERSHIP_MISMATCH')
    with Image.open(source) as im:raw=im.convert('RGBA')
    with Image.open(reference) as im:reference_size=im.size
    box(region,reference_size)
    pieces=[]
    for part in parts:
        if 'fragments' in part:
            if 'sourceBox' in part or 'targetBox' in part:raise ValueError('AMBIGUOUS_PART_GEOMETRY')
            if not isinstance(part['fragments'],list) or not part['fragments']:raise ValueError('EMPTY_FRAGMENTS')
            if any(not isinstance(f,dict) or set(f)!={'sourceBox','targetBox'} for f in part['fragments']):
                raise ValueError('INVALID_FRAGMENT_FIELDS')
            pieces.extend(dict(objectId=part['objectId'],fragmentIndex=i,**fragment)
                          for i,fragment in enumerate(part['fragments']))
        else:pieces.append(part)
    for part in pieces:
        if part.get('fitMode','contain') not in ('contain','frame-bounds'):raise ValueError('UNKNOWN_FIT_MODE')
        box(part['sourceBox'],raw.size);target=box(part['targetBox'],reference_size)
        if not (region[0]<=target[0]<target[2]<=region[2] and region[1]<=target[1]<target[3]<=region[3]):raise ValueError('TARGET_OUTSIDE_MATERIAL')
    output.mkdir(parents=True,exist_ok=False)
    canvas=Image.new('RGBA',(region[2]-region[0],region[3]-region[1]))
    records=[]
    for part in pieces:
        target=part['targetBox'];crop=raw.crop(part['sourceBox'])
        result,fitting=fit_native(crop,[target[2]-target[0],target[3]-target[1]],part.get('fitMode','contain'))
        # Index filenames avoid interpreting object IDs as filesystem paths.
        filename='part-'+str(len(records)+1)+'.png';result.save(output/filename)
        xy=[target[0]-region[0],target[1]-region[1]]
        canvas.alpha_composite(result,tuple(xy))
        records.append({**part,'file':filename,'fitting':fitting,'xyInMaterial':xy})
    canvas.save(output/'material.png')
    report={'kind':'material-parts-placement-result-v1','status':'processed_pending_visual_review',
            'sourceSha256':digest(source),'referenceSha256':digest(reference),
            'placementContractSha256':digest(Path(contract_path)),'materialSha256':digest(output/'material.png'),
            'generationCalls':0,'humanVisualAcceptance':False,'parts':records,
            'basis':'Explicit visual observations in reference and generated-image pixel coordinates; no new model call.'}
    save(output/'report.json',report)
    return report
