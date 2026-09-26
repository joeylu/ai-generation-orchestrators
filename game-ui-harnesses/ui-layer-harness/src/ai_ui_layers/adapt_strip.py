"""Explicit deterministic adaptation for user-approved simple strip artwork."""
import argparse
from pathlib import Path
import io
import json
import hashlib
import numpy as np
from PIL import Image
from .evaluate import digest, save


def adapt(source, expected_sha256, width, height, output, policy):
    if policy != 'simple-strip': raise ValueError('EXPLICIT_SIMPLE_STRIP_POLICY_REQUIRED')
    if any(type(v) is not int or not 1 <= v <= 4096 for v in (width,height)):
        raise ValueError('TARGET_SIZE')
    source=Path(source);output=Path(output);raw=source.read_bytes()
    if hashlib.sha256(raw).hexdigest()!=expected_sha256:raise ValueError('SOURCE_CHANGED')
    with Image.open(io.BytesIO(raw)) as im:
        if im.format!='PNG' or 'A' not in im.getbands() or im.getexif().get(274,1)!=1:
            raise ValueError('ORIENTED_ALPHA_PNG_REQUIRED')
        if im.width*im.height>67108864:raise ValueError('SOURCE_SIZE')
        pixels=np.array(im.convert('RGBA'))
    alpha=pixels[:,:,3]
    if alpha.min()!=0 or alpha.max()<=1:raise ValueError('EMPTY_OR_OPAQUE_SOURCE')
    count=int(np.count_nonzero(alpha==1));pixels[alpha<=1]=0
    prepared=Image.fromarray(pixels);box=prepared.getchannel('A').getbbox()
    if box[0]==0 or box[1]==0 or box[2]==prepared.width or box[3]==prepared.height:
        raise ValueError('SOURCE_CONTOUR_TOUCHES_CANVAS')
    cropped=prepared.crop(box)
    # Premultiplied resampling avoids hidden RGB bleeding into soft edges.
    adapted=cropped.convert('RGBa').resize((width,height),Image.Resampling.LANCZOS).convert('RGBA')
    a=np.array(adapted);a[a[:,:,3]==0]=0;adapted=Image.fromarray(a)
    canvas=Image.new('RGBA',(width+4,height+4));canvas.paste(adapted,(2,2))
    output.mkdir(parents=True,exist_ok=False)
    (output/'raw.png').write_bytes(raw);prepared.save(output/'prepared.png')
    cropped.save(output/'source-crop.png');canvas.save(output/'adapted.png')
    result=dict(kind='ui_simple_strip_adaptation_v1',policy=policy,
        status='adapted_pending_visual_review',sourceSha256=expected_sha256,
        preparedSha256=digest(output/'prepared.png'),outputSha256=digest(output/'adapted.png'),
        alphaFloor=1,clearedFaintAlphaPixels=count,sourceBox=list(box),targetArtworkSize=[width,height],
        outputPadding=2,scaleX=width/cropped.width,scaleY=height/cropped.height,
        resampling='premultiplied-lanczos',generationRatioAccurate=False,
        humanVisualAcceptance=False,automaticRetries=0)
    save(output/'result.json',result)
    return result


def validate_policy(visual, material, size):
    policy=material.get('adaptationPolicy','preserve')
    if policy not in ('preserve','simple-strip','horizontal-frame-slice'):raise ValueError('ADAPTATION_POLICY')
    if policy=='preserve':return
    owned=[o for o in visual['objects'] if o['materialId']==material['id']]
    if policy=='horizontal-frame-slice':
        core=[o for o in owned if o['kind'] in ('card','panel')]
        ends=[o for o in owned if o['kind']=='decoration']
        if (material['role']!='foreground' or material.get('preserveText') or
            len(core)!=1 or len(core)+len(ends)!=len(owned) or
            min(size)<=0 or size[0]/size[1]<3):
            raise ValueError('INELIGIBLE_HORIZONTAL_FRAME:'+material['id'])
        left,_,right,_=material['bboxNorm']
        end_fraction=max(8,round(size[1]/3))/size[0]
        end_left=left+(right-left)*end_fraction
        end_right=right-(right-left)*end_fraction
        if any(not isinstance(o.get('bboxNorm'),list) or len(o['bboxNorm'])!=4 or
               not (o['bboxNorm'][2]<=end_left or o['bboxNorm'][0]>=end_right)
               for o in ends):
            raise ValueError('INELIGIBLE_HORIZONTAL_FRAME:'+material['id'])
        return
    if (material['role']!='foreground' or material.get('preserveText') or
        len(owned)!=1 or owned[0]['kind']!='decoration' or
        min(size)<=0 or max(size)/min(size)<4):
        raise ValueError('INELIGIBLE_SIMPLE_STRIP:'+material['id'])


def adapt_materials(snapshot, sources, output, pre_adapted=None):
    """Use only reviewed, frozen policy; retain input provenance for every adaptation."""
    from .evaluate import read
    from .freeze_visual import inspect
    snapshot=Path(snapshot);output=Path(output)
    frozen=inspect(snapshot)
    visual_path=snapshot/'evidence/revised-visual-plan.json'
    if not visual_path.exists():visual_path=snapshot/'evidence/m1-draft.json'
    visual=read(visual_path)
    assets={a['id']:a for a in read(snapshot/'execution-plan.candidate.json')['assets']}
    result=dict(sources);evidence={};pre_adapted=pre_adapted or {}
    if not set(pre_adapted)<=set(sources):raise ValueError('UNKNOWN_PRE_ADAPTED_MATERIAL')
    for material in visual['materials']:
        key=material['id'];size=assets[key]['output_size']
        validate_policy(visual,material,size)
        policy=material.get('adaptationPolicy','preserve')
        if key in pre_adapted:
            report=pre_adapted[key]
            if (policy!='horizontal-frame-slice' or report.get('policy')!=policy or
                report.get('targetArtworkSize')!=size or digest(Path(sources[key]))!=report.get('outputSha256')):
                raise ValueError('PRE_ADAPTED_SOURCE_MISMATCH:'+key)
            evidence[key]=report
            continue
        if policy=='preserve':continue
        source=Path(sources[key])
        if policy=='simple-strip':
            evidence[key]=adapt(source,digest(source),*size,output/key,policy)
        else:
            from .adapt_frame import adapt as adapt_frame
            evidence[key]=adapt_frame(source,digest(source),*size,output/key,policy)
        result[key]=str(output/key/'adapted.png')
    if evidence:
        output.mkdir(parents=True,exist_ok=True)
        save(output/'result.json',dict(kind='ui_material_adaptations_v1',
            snapshotDigest=frozen['digest'],materials=evidence,humanVisualAcceptance=False))
    return result


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--source',required=True);p.add_argument('--source-sha256',required=True)
    p.add_argument('--width',type=int,required=True);p.add_argument('--height',type=int,required=True)
    p.add_argument('--output',required=True);p.add_argument('--policy',choices=['simple-strip'],required=True)
    a=p.parse_args()
    print(json.dumps(adapt(a.source,a.source_sha256,a.width,a.height,a.output,a.policy),indent=2))
