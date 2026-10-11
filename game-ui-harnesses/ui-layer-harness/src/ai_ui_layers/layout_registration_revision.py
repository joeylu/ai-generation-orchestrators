"""Declared layout correction candidates; no generation or observed-body claim."""
import argparse
import json
import math
from pathlib import Path
import shutil
import tempfile
import zipfile

import numpy as np
from PIL import Image
from jsonschema import Draft202012Validator

from .evaluate import read, save, digest
from .layer_package import validate_archive, write_package, composite, check_composition, portable_text
from . import viewport_geometry_revision as viewport

KIND = 'ui_declared_layout_revision_v1'
POLICY = 'declared-edge-preserving-layout-candidate-v1'
FLAGS = dict(viewport.FLAGS, observedBody=False, materialReviewPassed=False,
             sourceCompletenessAccepted=False, alphaQualityAccepted=False)
BOX = dict(type='array',items=dict(type='integer'),minItems=4,maxItems=4)
SHA = dict(type='string',pattern='^[0-9a-f]{64}$')
POINTS = dict(type='array',maxItems=256,items=dict(type='array',items=dict(type='number'),minItems=2,maxItems=2))
REPLACEMENT=dict(type='object',additionalProperties=False,
    required=['jobDirectory','jobDigest','reviewDirectory','reviewRequestSha256','reviewResultSha256'],
    properties=dict(jobDirectory=dict(type='string',minLength=1),jobDigest=SHA,
        reviewDirectory=dict(type='string',minLength=1),reviewRequestSha256=SHA,reviewResultSha256=SHA))
ENDPOINT = dict(type='object',additionalProperties=False,required=['materialId','edge'],properties=dict(
    materialId=dict(type='string',minLength=1),edge=dict(enum=['left','right','top','bottom','centerX','centerY'])))
SCHEMA = dict(type='object',additionalProperties=False,
    required=['kind','policy','sourceArchive','sourceArchiveSha256','originalReferenceSha256',
              'materials','constraints','knownDifferences'],properties=dict(
        kind=dict(const=KIND),policy=dict(const=POLICY),sourceArchive=dict(type='string',minLength=1),
        sourceArchiveSha256=SHA,originalReferenceSha256=SHA,
        knownDifferences=dict(type='array',maxItems=128,items=dict(type='string',minLength=1)),
        materials=dict(type='array',minItems=1,maxItems=128,items=dict(type='object',additionalProperties=False,
            required=['materialId','mode','targetBox','measurementAlphaThreshold'],properties=dict(
                materialId=dict(type='string',minLength=1),mode=dict(enum=['uniform','frame']),targetBox=BOX,
                measurementAlphaThreshold=dict(type='integer',minimum=1,maximum=255),
                xLandmarks=POINTS,yLandmarks=POINTS,
                receivedReplacement=REPLACEMENT,
                sourceOverride=dict(type='object',additionalProperties=False,required=['path','sha256'],
                    properties=dict(path=dict(type='string',minLength=1),sha256=SHA))))),
        constraints=dict(type='array',maxItems=256,items=dict(type='object',additionalProperties=False,
            required=['id','a','b','expectedDelta','tolerancePixels'],properties=dict(
                id=dict(type='string',minLength=1),a=ENDPOINT,b=ENDPOINT,
                expectedDelta=dict(type='number'),tolerancePixels=dict(type='number',minimum=0,maximum=16))))))


def _box(box, size=None):
    if (len(box)!=4 or any(type(v) is not int for v in box) or
            box[2]<=box[0] or box[3]<=box[1] or size is not None and
            not (0<=box[0]<box[2]<=size[0] and 0<=box[1]<box[3]<=size[1])):
        raise ValueError('LAYOUT_POSITIVE_BOX_REQUIRED')


def _axis(a, b, target_a, target_b, cap, scale, landmarks, length):
    pairs=[(float(a),float(target_a)),(float(b),float(target_b))]
    for pair in landmarks:
        if (not all(type(v) in (int,float) and math.isfinite(v) for v in pair) or
                not a<pair[0]<b or not target_a<pair[1]<target_b):
            raise ValueError('LAYOUT_LANDMARK_OUTSIDE_BODY')
        pairs.append(tuple(pair))
    if cap>0:
        # Internal section edges may sit close to the frame. Retain smaller
        # uniform corners rather than colliding with a frozen internal anchor.
        if landmarks:
            cap=min(cap,*[min(p-a,b-p,(q-target_a)/scale,(target_b-q)/scale)/2
                          for p,q in landmarks])
        pairs += [(a+cap,target_a+cap*scale),(b-cap,target_b-cap*scale)]
    pairs.sort()
    for previous,current in zip(pairs,pairs[1:]):
        if current[0]<=previous[0] or current[1]<=previous[1]:
            raise ValueError('LAYOUT_MONOTONE_ANCHORS_REQUIRED')
    if a>0:
        p,q=pairs[:2];s=(q[1]-p[1])/(q[0]-p[0]);pairs.insert(0,(0,p[1]-p[0]*s))
    if b<length:
        p,q=pairs[-2:];s=(q[1]-p[1])/(q[0]-p[0]);pairs.append((length,q[1]+(length-q[0])*s))
    # Shared integer destination boundaries prevent holes and overlapping cells.
    result=[(p,round(q)) for p,q in pairs]
    if any(q[1]<=p[1] for p,q in zip(result,result[1:])):
        raise ValueError('LAYOUT_SUBPIXEL_CELL_COLLAPSED')
    return result


def render(source, spec):
    """Map the whole unthresholded source; alpha threshold only measures a proxy."""
    with Image.open(source) as opened:
        if (opened.format!='PNG' or opened.getexif().get(274,1)!=1 or
                opened.width*opened.height>16_777_216):
            raise ValueError('LAYOUT_ORIENTED_PNG_REQUIRED')
        image=opened.convert('RGBA')
    full=image.getchannel('A').getbbox()
    if full is None or image.getchannel('A').getextrema()[0]!=0:
        raise ValueError('LAYOUT_NONEMPTY_FOREGROUND_ALPHA_REQUIRED')
    threshold=spec['measurementAlphaThreshold']
    body=image.getchannel('A').point(lambda a:255 if a>=threshold else 0).getbbox()
    if body is None:raise ValueError('LAYOUT_EMPTY_MEASURED_PROXY')
    target=spec['targetBox'];_box(target)
    sw,sh=body[2]-body[0],body[3]-body[1]
    tw,th=target[2]-target[0],target[3]-target[1]
    if spec['mode']=='uniform':
        if spec.get('xLandmarks') or spec.get('yLandmarks'):
            raise ValueError('LAYOUT_UNIFORM_LANDMARKS_FORBIDDEN')
        scale=min(tw/sw,th/sh)
        shift=[(target[i]+target[i+2]-(body[i]+body[i+2])*scale)/2 for i in (0,1)]
        rendered,geometry=viewport.transform(source,dict(uniformScale=scale,translation=shift,axisStretch=False))
        mapped=[body[i]*scale+shift[i%2] for i in range(4)]
    else:
        # Horizontal controls retain the ends' height scale. Other frames retain
        # uniformly scaled corners while only their middle bands change extent.
        scale=th/sh if sw/sh>=2 else min(tw/sw,th/sh)
        cx=min(32,sw/4,sh/2,tw/(4*scale))
        cy=min(32,sh/4,sw/2,th/(4*scale))
        xs=_axis(body[0],body[2],target[0],target[2],cx,scale,spec.get('xLandmarks',[]),image.width)
        ys=_axis(body[1],body[3],target[1],target[3],cy,scale,spec.get('yLandmarks',[]),image.height)
        region=[xs[0][1]-2,ys[0][1]-2,xs[-1][1]+2,ys[-1][1]+2]
        size=(region[2]-region[0],region[3]-region[1])
        if size[0]*size[1]>16_777_216:raise ValueError('LAYOUT_RENDER_PIXEL_LIMIT')
        mesh=[]
        for (sl,dl),(sr,dr) in zip(xs,xs[1:]):
            for (st,dt),(sb,db) in zip(ys,ys[1:]):
                mesh.append(((dl-region[0],dt-region[1],dr-region[0],db-region[1]),
                             (sl,st,sl,sb,sr,sb,sr,st)))
        rendered=image.convert('RGBa').transform(size,Image.Transform.MESH,mesh,
            resample=Image.Resampling.BICUBIC).convert('RGBA')
        pixels=np.array(rendered);pixels[pixels[:,:,3]==0]=0;rendered=Image.fromarray(pixels)
        mapped=list(target)
        geometry=dict(layerCanvasRegion=region,axisStretch=True,cornerUniformScale=scale,
            sourceXToReferenceX=[list(p) for p in xs],sourceYToReferenceY=[list(p) for p in ys],
            originalMode=image.mode,sourceFullAlphaBox=list(full),alphaSupportClipped=False,
            implicitClamp=False,sampling='premultiplied cubic mesh with shared destination edges')
    measured=rendered.getchannel('A').point(lambda a:255 if a>=threshold else 0).getbbox()
    if measured is None:raise ValueError('LAYOUT_EMPTY_RENDERED_PROXY')
    region=geometry['layerCanvasRegion']
    actual=[measured[i]+region[i%2] for i in range(4)]
    geometry.update(materialId=spec['materialId'],mode=spec['mode'],targetBox=target,
        measuredSourceProxy=list(body),measurementAlphaThreshold=threshold,
        measurementIsGeometryOnly=True,sourceUnthresholded=True,observedBody=False,
        positionBasis=POLICY,mappedTargetBox=mapped,registeredProxyBox=actual,
        constraintMeasurementBasis='post-render-alpha-threshold',
        targetBoxResidualPixels=[actual[i]-target[i] for i in range(4)],
        sourcePixelsResampled=True,sourceCompletenessAccepted=False,humanVisualAcceptance=False)
    return rendered,geometry


def assess_constraints(constraints, boxes):
    def coordinate(endpoint):
        box=boxes[endpoint['materialId']];edge=endpoint['edge']
        return {'left':box[0],'right':box[2],'top':box[1],'bottom':box[3],
                'centerX':(box[0]+box[2])/2,'centerY':(box[1]+box[3])/2}[edge]
    results=[]
    for constraint in constraints:
        if not all(math.isfinite(constraint[key]) for key in ('expectedDelta','tolerancePixels')):
            raise ValueError('LAYOUT_FINITE_CONSTRAINT_REQUIRED')
        if (constraint['a']['edge'] in ('left','right','centerX')) != (constraint['b']['edge'] in ('left','right','centerX')):
            raise ValueError('LAYOUT_CONSTRAINT_AXES_MISMATCH')
        actual=coordinate(constraint['a'])-coordinate(constraint['b'])
        residual=actual-constraint['expectedDelta']
        results.append(dict(constraint,actualDelta=actual,residualPixels=residual,
            passed=abs(residual)<=constraint['tolerancePixels']+1e-9))
    return results


def _native_hashes(review):
    """Read program-owned geometry bound inside the verified source ZIP manifest."""
    result={}
    for issue in review['issues']:
        if isinstance(issue,str) and issue.startswith('Placement diagnosis: '):
            row=json.loads(issue[len('Placement diagnosis: '):])
            key=row['materialId']
            if key in result:raise ValueError('LAYOUT_DUPLICATE_NATIVE_BINDING')
            result[key]=row['sourceSha256']
    return result


def _replacement(row, reference_sha, bind):
    """Accept one genuinely received, independently reviewed edit of this native source."""
    from . import experimental_executor as ex, host_material_review as host
    from .accepted_materials import received
    value=row['receivedReplacement'];mid=row['materialId'];job=Path(value['jobDirectory']).resolve()
    review=Path(value['reviewDirectory']).resolve()
    if 'sourceOverride' in row:raise ValueError('LAYOUT_REPLACEMENT_OVERRIDE_CONFLICT')
    config,_=ex.load_job(job)
    if (config['digest']!=value['jobDigest'] or config.get('maximumCalls')!=1 or
            config.get('assets')!=[mid] or config.get('cleanup',{}).get('materialId')!=mid):
        raise ValueError('LAYOUT_BOUND_SINGLE_MATERIAL_EDIT_REQUIRED')
    for name,key in (('request.json','reviewRequestSha256'),('result.json','reviewResultSha256')):
        if digest(review/name)!=value[key]:raise ValueError('LAYOUT_REPLACEMENT_REVIEW_CHANGED')
    request,result=host.verify_run(review)
    raw,_,lineage=received(job,mid,reference_sha)
    if (request['jobDigest']!=config['digest'] or request['requestId']!=mid or
            request['materialIds']!=[mid] or request['rawSha256']!=lineage['rawSha256']):
        raise ValueError('LAYOUT_REPLACEMENT_REVIEW_SOURCE_MISMATCH')
    parent=read(job/'cleanup/source-lineage.json')
    if (parent['materialId']!=mid or
            parent['sourceRequestId']!=config['cleanup']['sourceRequestId'] or
            parent['sourceRequestId']!=mid and not parent.get('materialSourceSha256')):
        raise ValueError('LAYOUT_REPLACEMENT_SINGLE_NATIVE_SOURCE_REQUIRED')
    for folder in (job,review,Path(config['cleanup']['sourceJob'])):
        for path in sorted(folder.rglob('*')):
            if path.is_file():bind(path,digest(path))
    return raw,dict(jobDigest=config['digest'],sourceNativeSha256=parent.get('materialSourceSha256',parent['rawSha256']),
        **(dict(sourceSheetSha256=parent['rawSha256'],sourceRequestId=parent['sourceRequestId'],
            sourceBox=parent['sourceBox'],sourceCellPolicy=parent['sourceCellPolicy']) if parent.get('materialSourceSha256') else {}),
        receivedRawSha256=lineage['rawSha256'],reviewRequestSha256=value['reviewRequestSha256'],
        reviewResultSha256=value['reviewResultSha256'],reviewStatus=result['status'])


def revise(plan_path, output, viewer):
    """Publish an independent candidate; neither repair nor resume a frozen run."""
    plan_path,output,viewer=map(lambda p:Path(p).resolve(),(plan_path,output,viewer))
    plan_sha=digest(plan_path);spec=read(plan_path)
    if digest(plan_path)!=plan_sha:raise ValueError('LAYOUT_SOURCE_CHANGED')
    Draft202012Validator(SCHEMA).validate(spec)
    ids=[row['materialId'] for row in spec['materials']]
    if len(ids)!=len(set(ids)):raise ValueError('LAYOUT_DUPLICATE_MATERIAL')
    constraint_ids=[row['id'] for row in spec['constraints']]
    if len(constraint_ids)!=len(set(constraint_ids)):raise ValueError('LAYOUT_DUPLICATE_CONSTRAINT')
    archive=Path(spec['sourceArchive']).resolve()
    inputs={}
    def bind(path, sha):
        path=Path(path).resolve()
        if path in inputs and inputs[path]!=sha:raise ValueError('LAYOUT_CONFLICTING_INPUT_BINDING')
        inputs[path]=sha
    bind(plan_path,plan_sha);bind(archive,spec['sourceArchiveSha256'])
    for name in ('viewer.html','viewer.js'):bind(viewer/name,digest(viewer/name))
    for row in spec['materials']:
        _box(row['targetBox'])
        if 'sourceOverride' in row:
            value=row['sourceOverride'];bind(value['path'],value['sha256'])
    replacements={row['materialId']:_replacement(row,spec['originalReferenceSha256'],bind)
                  for row in spec['materials'] if 'receivedReplacement' in row}
    if output.exists() or any(output.is_relative_to(p) or p.is_relative_to(output) or
            p!=plan_path and output.is_relative_to(p.parent) for p in inputs):
        raise ValueError('FRESH_INDEPENDENT_LAYOUT_OUTPUT_REQUIRED')
    def unchanged():
        if any(digest(path)!=sha for path,sha in inputs.items()):raise ValueError('LAYOUT_SOURCE_CHANGED')
    unchanged();viewport.validate_viewport_archive(archive)
    for issue in spec['knownDifferences']:portable_text(issue)
    with tempfile.TemporaryDirectory(prefix='ui-layout-candidate-') as temporary:
        temp=Path(temporary);old=temp/'old';old.mkdir()
        with zipfile.ZipFile(archive) as wrapper:
            original_bytes=wrapper.read('original-reference.png')
            old_view=json.loads(wrapper.read('viewport.json'))
            inner=temp/'source.zip';inner.write_bytes(wrapper.read('world-ui-layers.zip'))
            previous_preview=wrapper.read('viewport-preview.png')
        original=temp/'original.png';original.write_bytes(original_bytes)
        if digest(original)!=spec['originalReferenceSha256']:raise ValueError('LAYOUT_ORIGINAL_REFERENCE_CHANGED')
        validate_archive(inner)
        with zipfile.ZipFile(inner) as source:
            for name in source.namelist():
                p=old/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(source.read(name))
        composition=read(old/'composition.json');review=read(old/'review.json');native=_native_hashes(review)
        layers={row['id']:row for row in composition['layers']}
        if not set(ids)<=set(layers):raise ValueError('LAYOUT_UNKNOWN_MATERIAL')
        if any(layers[key]['role']!='foreground' for key in ids):raise ValueError('LAYOUT_FOREGROUND_ONLY')
        for constraint in spec['constraints']:
            if any(constraint[key]['materialId'] not in ids for key in ('a','b')):
                raise ValueError('LAYOUT_CONSTRAINT_REQUIRES_REGISTERED_MATERIAL')
        width,height=old_view['originalSize'];old_shift=old_view['worldShift']
        rendered_dir=temp/'rendered';rendered_dir.mkdir();sources={};records=[];regions=[];boxes={}
        selected={row['materialId']:row for row in spec['materials']}
        for layer in composition['layers']:
            key=layer['id'];source=old/layer['path']
            if key in selected:
                row=selected[key];_box(row['targetBox'],(width,height))
                replacement=None
                if key in replacements:
                    source,replacement=replacements[key]
                    if native.get(key)!=replacement['sourceNativeSha256']:
                        raise ValueError('LAYOUT_REPLACEMENT_NATIVE_LINEAGE_MISMATCH')
                if 'sourceOverride' in row:
                    override=row['sourceOverride']
                    if native.get(key)!=override['sha256']:raise ValueError('LAYOUT_NATIVE_LINEAGE_MISMATCH')
                    source=Path(override['path']).resolve()
                    if digest(source)!=override['sha256']:raise ValueError('LAYOUT_SOURCE_CHANGED')
                rendered,geometry=render(source,row);target=rendered_dir/(str(len(records))+'.png');rendered.save(target)
                region=geometry['layerCanvasRegion'];boxes[key]=geometry['registeredProxyBox']
                records.append(dict(geometry,sourceSha256=digest(source),storedSha256=digest(target),
                    nativeSourceReused='sourceOverride' in row,status='declared-layout-candidate',
                    **({'receivedReplacement':replacement} if replacement else {})))
                sources[key]=dict(path=str(target),sha256=digest(target))
            else:
                region=[layer['x']-old_shift[0],layer['y']-old_shift[1],
                        layer['x']-old_shift[0]+layer['width'],layer['y']-old_shift[1]+layer['height']]
                sources[key]=dict(path=str(source),sha256=digest(source))
                records.append(dict(materialId=key,status='unchanged',byteIdentity=True,
                    sourceSha256=digest(source),storedSha256=digest(source),layerCanvasRegion=region))
            regions.append(region);layer.update(x=region[0],y=region[1],width=region[2]-region[0],height=region[3]-region[1])
        constraints=assess_constraints(spec['constraints'],boxes)
        bounds=[min(0,*[r[0] for r in regions]),min(0,*[r[1] for r in regions]),
                max(width,*[r[2] for r in regions]),max(height,*[r[3] for r in regions])]
        shift=[-bounds[0],-bounds[1]];size=(bounds[2]-bounds[0],bounds[3]-bounds[1])
        composition['canvas']=dict(width=size[0],height=size[1])
        for layer in composition['layers']:layer['x']+=shift[0];layer['y']+=shift[1]
        check_composition(composition)
        world_reference=temp/'reference.png'
        with Image.open(original) as image:
            world=Image.new('RGBA',size);world.paste(image.convert('RGBA'),tuple(shift));world.save(world_reference)
        issues=list(review['issues'])+list(spec['knownDifferences'])+[
            'Declared layout correction candidate only; alpha bounds remain unobserved proxies.',
            'Explicit edge-preserving remapping overrides preserve sizing for this candidate only; original plans and sources remain unchanged.',
            'Source content, ownership and style differences remain unresolved. No strict registration or visual acceptance is asserted.']
        issues += ['Layout constraint: '+json.dumps(row,ensure_ascii=False,sort_keys=True) for row in constraints if not row['passed']]
        unchanged();output.mkdir(parents=True,exist_ok=False)
        result=write_package(world_reference,composition,sources,output/'delivery',viewer,issues)
        published=output/'delivery/package';world=composite(published,composition)
        view=dict(kind='ui_original_viewport_v1',policy=viewport.POLICY,worldBoundsInOriginalCoordinates=bounds,
            worldShift=shift,originalSize=[width,height],worldSize=list(size),
            worldViewportBox=[shift[0],shift[1],shift[0]+width,shift[1]+height],
            originalReferenceSha256=digest(original),worldReferenceSha256=digest(world_reference),
            displayPolicy='exact original viewport slice; full source domain retained in expanded storage')
        world.crop(view['worldViewportBox']).save(output/'delivery/viewport-preview.png')
        shutil.copyfile(original,output/'delivery/original-reference.png');save(output/'delivery/viewport.json',view)
        wrapper=viewport._wrapper(output/'delivery')
        (output/'before.png').write_bytes(previous_preview)
        with Image.open(original) as image:original_view=image.convert('RGBA')
        with Image.open(output/'before.png') as image:before=image.convert('RGBA')
        after=world.crop(view['worldViewportBox'])
        board=Image.new('RGBA',(width*3,height))
        for index,image in enumerate((original_view,before,after)):board.paste(image,(index*width,0))
        board.save(output/'original-before-after.png')
        unchanged()
        # Paths remain in the local selection, never in the portable package.
        shutil.copyfile(plan_path,output/'layout-plan.json')
        provenance=dict(kind=KIND,policy=POLICY,selectionSha256=inputs[plan_path],
            sourceArchiveSha256=spec['sourceArchiveSha256'],sourceReview=review,
            sourceManifestSha256=digest(old/'manifest.json'),records=records,constraints=constraints,**FLAGS)
        save(output/'revision-provenance.json',provenance)
        result.update(status='layout-candidate-pending-human-review',policy=POLICY,records=records,
            constraints=constraints,layoutConstraintsPassed=all(row['passed'] for row in constraints),
            sourceArchiveSha256=spec['sourceArchiveSha256'],selectionSha256=inputs[plan_path],
            viewport=view,viewportArchive=wrapper,**FLAGS)
        save(output/'result.json',result)
        return result


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action',choices=['revise-layout-candidate'])
    for name in ('plan','output','viewer'):parser.add_argument('--'+name,required=True)
    args=parser.parse_args()
    print(json.dumps(revise(args.plan,args.output,args.viewer),ensure_ascii=False,allow_nan=False))


if __name__=='__main__':main()
