"""Deterministic observed geometry candidate revisions. No generation or acceptance."""
from copy import deepcopy
import hashlib
import itertools
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
from .experimental_executor import record, verified
from .layer_package import validate_archive, composite, write_package, portable_text
from . import host_geometry_observation as observation

KIND = 'ui_observed_geometry_revision_v1'
POLICY = 'observed-uniform-geometry-candidate-v1'
SCHEMA = dict(type='object', additionalProperties=False,
    required=['kind','sourceArchive','sourceArchiveSha256','observations','fitPolicy'],
    properties=dict(kind=dict(const=KIND),sourceArchive=dict(type='string',minLength=1),
        sourceArchiveSha256=dict(type='string',pattern='^[0-9a-f]{64}$'),
        fitPolicy=dict(type='object',additionalProperties=False,required=['maximumResidualPixels'],
            properties=dict(maximumResidualPixels=dict(type='number',minimum=0,maximum=128))),
        observations=dict(type='array',minItems=1,maxItems=256,items=dict(type='object',
            additionalProperties=False,required=['layerId','directory','requestSha256','resultSha256'],
            properties=dict(layerId=dict(type='string',minLength=1),directory=dict(type='string',minLength=1),
                requestSha256=dict(type='string',pattern='^[0-9a-f]{64}$'),
                resultSha256=dict(type='string',pattern='^[0-9a-f]{64}$'))))))


def fit(answer, maximum_residual_pixels):
    """Fit one positive scalar and translation; never infer a hidden box."""
    if type(maximum_residual_pixels) not in (int,float) or not math.isfinite(maximum_residual_pixels) or not 0 <= maximum_residual_pixels <= 128:
        raise ValueError('FINITE_RESIDUAL_POLICY_REQUIRED')
    if answer['boundaryStatus'] == 'complete':
        a,b = (np.asarray(answer[k],dtype=float) for k in ('sourceBodyBox','targetBodyBox'))
        if a.shape != (4,) or b.shape != (4,) or not np.isfinite(a).all() or not np.isfinite(b).all() or np.any(a[2:]<=a[:2]) or np.any(b[2:]<=b[:2]):
            raise ValueError('FINITE_POSITIVE_BODY_BOX_REQUIRED')
        source = np.array([[a[0],a[1]],[a[2],a[1]],[a[0],a[3]],[a[2],a[3]]])
        target = np.array([[b[0],b[1]],[b[2],b[1]],[b[0],b[3]],[b[2],b[3]]])
        centered = source-source.mean(axis=0)
        scale = float(np.sum(centered*(target-target.mean(axis=0)))/np.sum(centered*centered))
        shift = target.mean(axis=0)-scale*source.mean(axis=0)
        basis = 'observed-complete-body-boxes'
    elif answer['boundaryStatus'] == 'visible-landmarks':
        source = np.asarray([p['source'] for p in answer['landmarkPairs']],dtype=float)
        target = np.asarray([p['target'] for p in answer['landmarkPairs']],dtype=float)
        if source.shape != target.shape or source.ndim != 2 or source.shape[1] != 2 or not np.isfinite(source).all() or not np.isfinite(target).all() or not observation._noncollinear(source.tolist()) or not observation._noncollinear(target.tolist()):
            raise ValueError('VISIBLE_NONCOLLINEAR_LANDMARKS_REQUIRED')
        for points in (source,target):
            if not any(abs(np.linalg.det(np.asarray([b-a,c-a])))>1 and
                       all(float(np.linalg.norm(p-q))>=2 for p,q in ((a,b),(a,c),(b,c)))
                       for a,b,c in itertools.combinations(points,3)):
                raise ValueError('VISIBLE_LANDMARK_SPREAD_REQUIRED')
        centered = source-source.mean(axis=0)
        scale = float(np.sum(centered*(target-target.mean(axis=0)))/np.sum(centered*centered))
        shift = target.mean(axis=0)-scale*source.mean(axis=0)
        basis = 'actual-visible-landmarks-no-hidden-boundaries'
    else:
        raise ValueError('UNRESOLVED_OBSERVATION')
    if not math.isfinite(scale) or scale <= 0 or not np.isfinite(shift).all():
        raise ValueError('POSITIVE_UNIFORM_SCALE_REQUIRED')
    residuals = np.linalg.norm(source*scale+shift-target,axis=1)
    if float(max(residuals)) > maximum_residual_pixels+1e-9:
        raise ValueError('UNIFORM_FIT_RESIDUAL_EXCEEDED')
    return dict(basis=basis,uniformScale=scale,translation=shift.tolist(),
                residualPixels=residuals.tolist(),maximumResidualPixels=maximum_residual_pixels,
                rootMeanSquareResidualPixels=float(np.sqrt(np.mean(residuals**2))),
                candidateResidualWarning=bool(max(residuals)>1),
                sourcePointSpan=np.ptp(source,axis=0).tolist(),targetPointSpan=np.ptp(target,axis=0).tolist(),
                rotation=0,axisStretch=False,hiddenBoundaryInference=False)


def transform(source, geometry, canvas_size, original_layer, *, allow_identity=True):
    """Fit semantic geometry, store complete unthresholded support, reject clipping."""
    with Image.open(source) as image:
        if image.format != 'PNG' or image.getexif().get(274,1)!=1:
            raise ValueError('ORIENTED_PNG_REQUIRED')
        original_mode=image.mode;image.load();raw=image.convert('RGBA')
    geometry=dict(geometry,originalMode=original_mode)
    array=np.array(raw); full=raw.getchannel('A').getbbox()
    if full is None:raise ValueError('EMPTY_SOURCE')
    s=geometry['uniformScale']; tx,ty=geometry['translation']
    if type(s) not in (int,float) or not math.isfinite(s) or s<=0 or not all(type(v) in (int,float) and math.isfinite(v) for v in (tx,ty)):
        raise ValueError('FINITE_POSITIVE_TRANSFORM_REQUIRED')
    theoretical=[full[0]*s+tx,full[1]*s+ty,full[2]*s+tx,full[3]*s+ty]
    if not (0<=theoretical[0]<theoretical[2]<=canvas_size[0] and 0<=theoretical[1]<theoretical[3]<=canvas_size[1]):
        raise ValueError('FULL_ALPHA_SUPPORT_OUTSIDE_CANVAS')
    hidden=int(np.count_nonzero((array[:,:,3]==0)&np.any(array[:,:,:3]!=0,axis=2)))
    # A true identity retains archive bytes, including the original storage extent.
    if allow_identity and raw.size==(original_layer['width'],original_layer['height']) and abs(s-1)<1e-12 and abs(tx-original_layer['x'])<1e-12 and abs(ty-original_layer['y'])<1e-12 and hidden==0:
        return None,dict(geometry,sourceFullAlphaBox=list(full),sourceAlphaThreshold=0,
            layerCanvasRegion=[original_layer['x'],original_layer['y'],original_layer['x']+raw.width,original_layer['y']+raw.height],byteIdentity=True)
    array[array[:,:,3]==0,:3]=0; raw=Image.fromarray(array)
    # Render beyond canvas first: cubic filter support must be tested, never clipped.
    guard=2*s+2
    region=[math.floor(theoretical[0]-guard),math.floor(theoretical[1]-guard),
            math.ceil(theoretical[2]+guard),math.ceil(theoretical[3]+guard)]
    size=(region[2]-region[0],region[3]-region[1])
    if size[0]*size[1]>16_777_216:raise ValueError('RENDER_PIXEL_LIMIT')
    rendered=raw.transform(size,Image.Transform.AFFINE,
        (1/s,0,(region[0]-tx)/s,0,1/s,(region[1]-ty)/s),resample=Image.Resampling.BICUBIC)
    alpha=rendered.getchannel('A').getbbox()
    if alpha is None:raise ValueError('EMPTY_RENDER')
    absolute=[alpha[i]+region[i%2] for i in range(4)]
    if not (0<=absolute[0]<absolute[2]<=canvas_size[0] and 0<=absolute[1]<absolute[3]<=canvas_size[1]):
        raise ValueError('FILTER_SUPPORT_OUTSIDE_CANVAS')
    rendered=rendered.crop(alpha); pixels=np.array(rendered);pixels[pixels[:,:,3]==0,:3]=0
    return Image.fromarray(pixels),dict(geometry,sourceFullAlphaBox=list(full),sourceAlphaThreshold=0,
        transformedTheoreticalSupport=theoretical,layerCanvasRegion=absolute,byteIdentity=False,
        sourceHiddenRgbPixelsNormalized=hidden,alphaSupportClipped=False,implicitClamp=False,
        sampling='uniform cubic; full nonzero alpha storage; resampled alpha is not pixel exact')


def background_transform(source, answer, canvas_size, original_layer, *, allow_identity=True):
    """Only observed whole source/canvas backgrounds may use opaque edge padding."""
    with Image.open(source) as image:
        if image.format!='PNG' or image.getexif().get(274,1)!=1:raise ValueError('ORIENTED_PNG_REQUIRED')
        original_mode=image.mode;image.load();raw=image.convert('RGBA')
    w,h=raw.size;cw,ch=canvas_size
    if (answer['boundaryStatus']!='complete' or answer['sourceBodyBox']!=[0,0,w,h]
            or answer['targetBodyBox']!=[0,0,cw,ch]):
        raise ValueError('BACKGROUND_OBSERVED_WHOLE_CANVAS_REQUIRED')
    if raw.getchannel('A').getextrema()!=(255,255):raise ValueError('BACKGROUND_NATIVE_OPAQUE_REQUIRED')
    s=min(cw/w,ch/h);tx=(cw-w*s)/2;ty=(ch-h*s)/2
    # Extend the authentic opaque border in source coordinates before one uniform
    # affine. The owned source footprint is fully contained and never clipped.
    left=max(2,math.ceil(tx/s)+2);top=max(2,math.ceil(ty/s)+2)
    right=max(2,math.ceil((cw-tx)/s-w)+2);bottom=max(2,math.ceil((ch-ty)/s-h)+2)
    if (w+left+right)*(h+top+bottom)>16_777_216:raise ValueError('RENDER_PIXEL_LIMIT')
    padded=Image.fromarray(np.pad(np.array(raw),((top,bottom),(left,right),(0,0)),mode='edge'))
    rendered=padded.transform(canvas_size,Image.Transform.AFFINE,
        (1/s,0,left-tx/s,0,1/s,top-ty/s),resample=Image.Resampling.BICUBIC)
    if rendered.getchannel('A').getextrema()!=(255,255):raise ValueError('BACKGROUND_EDGEPAD_OPACITY_FAILED')
    body=np.array([[0,0],[w,0],[0,h],[w,h]],dtype=float)
    target=np.array([[0,0],[cw,0],[0,ch],[cw,ch]],dtype=float)
    residual=np.linalg.norm(body*s+[tx,ty]-target,axis=1)
    geometry=dict(basis='observed-whole-canvas-background-uniform-contain-edgepad',
        originalMode=original_mode,uniformScale=s,translation=[tx,ty],rotation=0,axisStretch=False,
        sourceFullAlphaBox=[0,0,w,h],sourceAlphaThreshold=0,layerCanvasRegion=[0,0,cw,ch],
        transformedTheoreticalSupport=[tx,ty,tx+w*s,ty+h*s],
        residualPixels=residual.tolist(),candidateResidualWarning=bool(max(residual)>1),
        backgroundEdgePadding=[tx,ty,cw-(tx+w*s),ch-(ty+h*s)],
        canvasAspectMismatch=(w*ch!=h*cw),alphaSupportClipped=False,implicitClamp=False,
        hiddenBoundaryInference=False,byteIdentity=False,
        sampling='uniform cubic with explicit opaque source edge extension; no axis stretch')
    if allow_identity and original_mode=='RGBA' and raw.size==canvas_size and original_layer['x']==0 and original_layer['y']==0:
        return None,dict(geometry,byteIdentity=True)
    return rendered,geometry


def _tree(root):
    root=Path(root).resolve()
    return {p.relative_to(root).as_posix():digest(p) for p in sorted(root.rglob('*')) if p.is_file()}


def _preflight(spec):
    Draft202012Validator(SCHEMA).validate(spec)
    tolerance=spec['fitPolicy']['maximumResidualPixels']
    if not math.isfinite(tolerance):raise ValueError('FINITE_RESIDUAL_POLICY_REQUIRED')
    archive=Path(spec['sourceArchive']).resolve()
    if validate_archive(archive)['sha256']!=spec['sourceArchiveSha256']:raise ValueError('SOURCE_ARCHIVE_CHANGED')
    with zipfile.ZipFile(archive) as z:
        composition=json.loads(z.read('composition.json')); layers={l['id']:l for l in composition['layers']}
        reference_sha=hashlib.sha256(z.read('reference.png')).hexdigest()
    proofs={}
    for row in spec['observations']:
        mid=row['layerId'];item=Path(row['directory']).resolve()
        if mid in proofs or mid not in layers:raise ValueError('KNOWN_UNIQUE_LAYER_REQUIRED')
        if digest(item/'request.json')!=row['requestSha256'] or digest(item/'result.json')!=row['resultSha256']:
            raise ValueError('OBSERVATION_BINDING_CHANGED')
        request,answer,source,reference=observation.verify_response(item)
        if 'sourceOverride' in request and request['sourceOverride'].get('kind')!='ui_verified_archive_material_edit_source_v1':
            raise ValueError('TYPED_VERIFIED_SOURCE_OVERRIDE_REQUIRED')
        if (request['layerId']!=mid or request['sourceArchiveSha256']!=spec['sourceArchiveSha256']
                or request['originalLayer']!=layers[mid] or request['referenceSha256']!=reference_sha):
            raise ValueError('OBSERVATION_ARCHIVE_SCOPE_MISMATCH')
        proofs[mid]=(request,answer,source,observation.assess(request,answer))
    return proofs


def freeze(selection, output):
    selection=Path(selection).resolve();output=Path(output).resolve();spec=read(selection)
    _preflight(spec)
    roots=[Path(row['directory']).resolve().parent.parent for row in spec['observations']]
    files={str(selection):digest(selection),str(Path(spec['sourceArchive']).resolve()):spec['sourceArchiveSha256']}
    inventories={str(root):_tree(root) for root in roots}
    if output.exists() or any(output.is_relative_to(Path(p)) or Path(p).is_relative_to(output) for p in [*files,*inventories]):
        raise ValueError('FRESH_INDEPENDENT_OUTPUT_REQUIRED')
    output.mkdir(parents=True);save(output/'selection.json',spec);save(output/'schema.json',SCHEMA)
    return record(output/'freeze.json',dict(kind=KIND,policy=POLICY,selectionSha256=digest(output/'selection.json'),
        schemaSha256=digest(output/'schema.json'),files=files,inventories=inventories,generationCalls=0,modelCalls=0))


def _unchanged(config):
    for path,sha in config['files'].items():
        if digest(Path(path))!=sha:raise ValueError('FROZEN_INPUT_CHANGED')
    for path,inventory in config['inventories'].items():
        if _tree(path)!=inventory:raise ValueError('FROZEN_EVIDENCE_TREE_CHANGED')


def _public(value):
    if isinstance(value,str):
        try:return portable_text(value)
        except ValueError:return '[Nonportable observation text retained in local provenance]'
    if isinstance(value,list):return [_public(v) for v in value]
    if isinstance(value,dict):return {k:_public(v) for k,v in value.items() if k not in ('job','sourceArchive','actualReturnedPath','directory')}
    return value


def revise(frozen, expected_digest, output, viewer):
    frozen=Path(frozen).resolve();output=Path(output).resolve();viewer=Path(viewer).resolve()
    config=verified(frozen/'freeze.json')
    if config.get('kind')!=KIND or config.get('policy')!=POLICY or config['digest']!=expected_digest:
        raise ValueError('FREEZE_BINDING_MISMATCH')
    if digest(frozen/'selection.json')!=config['selectionSha256'] or digest(frozen/'schema.json')!=config['schemaSha256'] or read(frozen/'schema.json')!=SCHEMA:
        raise ValueError('FROZEN_SELECTION_CHANGED')
    _unchanged(config);spec=read(frozen/'selection.json');proofs=_preflight(spec)
    if output.exists() or any(output.is_relative_to(Path(p)) or Path(p).is_relative_to(output) for p in [frozen,viewer,*config['files'],*config['inventories']]):
        raise ValueError('FRESH_INDEPENDENT_OUTPUT_REQUIRED')
    with tempfile.TemporaryDirectory(prefix='observed-geometry-') as temporary:
        temp=Path(temporary);original=temp/'original';original.mkdir()
        with zipfile.ZipFile(spec['sourceArchive']) as z:
            for name in z.namelist():
                path=original/name;path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(z.read(name))
        composition=read(original/'composition.json');before=composite(original,composition)
        with Image.open(original/'preview.png') as preview:
            if preview.mode!='RGBA' or preview.size!=before.size or preview.tobytes()!=before.tobytes():raise ValueError('SOURCE_PREVIEW_MISMATCH')
        previous=deepcopy(composition);sources={l['id']:dict(path=str(original/l['path']),sha256=digest(original/l['path'])) for l in composition['layers']}
        records=[]
        for index,layer in enumerate(composition['layers']):
            mid=layer['id'];row=dict(layerId=mid,status='unchanged',reason='no-frozen-observation')
            if mid in proofs:
                request,answer,source,assessment=proofs[mid]
                row.update(observation=answer,assessment=assessment,requestSha256=next(r['requestSha256'] for r in spec['observations'] if r['layerId']==mid))
                row['sourceEvidence']={k:deepcopy(request[k]) for k in
                    ('sourceArchiveSha256','sourcePackageManifestSha256','sourceSha256','sourceSize','referenceSha256','referenceSize','sourceOverride') if k in request}
                if not assessment['geometryUsableCandidate']:
                    row['reason']='unresolved-observed-geometry'
                else:
                    try:
                        if layer['role']=='background':
                            image,geometry=background_transform(source,answer,before.size,layer,allow_identity='sourceOverride' not in request)
                        else:
                            geometry=fit(answer,spec['fitPolicy']['maximumResidualPixels'])
                            image,geometry=transform(source,geometry,before.size,layer,allow_identity='sourceOverride' not in request)
                        row.update(geometry=geometry,status='geometry-candidate',reason='observed-uniform-fit')
                        if image is not None:
                            path=temp/f'render-{index}.png';image.save(path);region=geometry['layerCanvasRegion']
                            layer.update(x=region[0],y=region[1],width=image.width,height=image.height)
                            sources[mid]=dict(path=str(path),sha256=digest(path))
                        else:row.update(status='unchanged',reason='exact-identity-fit')
                    except ValueError as error:row.update(reason=str(error))
            records.append(row)
        inherited=read(original/'review.json')['issues']
        issues=list(inherited)+['Observed geometry candidate only; strict registration and human acceptance remain false.']
        for row in records:issues.append('Observed geometry evidence: '+json.dumps(_public(row),ensure_ascii=False,sort_keys=True))
        _unchanged(config);output.mkdir(parents=True)
        try:
            package=write_package(original/'reference.png',composition,sources,output/'delivery',viewer,issues)
            published=output/'delivery/package';after=composite(published,composition)
            with Image.open(published/'preview.png') as image:
                if image.tobytes()!=after.tobytes():raise ValueError('OUTPUT_PIXEL_COMPOSITION_MISMATCH')
            old={l['id']:l for l in previous['layers']}
            for layer,row in zip(composition['layers'],records):
                if row['status']=='unchanged' and (layer!=old[layer['id']] or (published/layer['path']).read_bytes()!=(original/layer['path']).read_bytes()):
                    raise ValueError('UNCHANGED_LAYER_IDENTITY_FAILED')
            _unchanged(config)
            provenance=dict(kind=KIND,policy=POLICY,frozenDigest=expected_digest,sourceArchiveSha256=spec['sourceArchiveSha256'],
                sourceManifest=read(original/'manifest.json'),sourceReview=read(original/'review.json'),records=records,
                strictBodyRegistrationPassed=False,fullAutomaticDagPassed=False,humanVisualAcceptance=False,
                originalDagPromoted=False,generationCalls=0,modelCalls=0,packageSha256=package['sha256'])
            save(output/'revision-provenance.json',provenance)
            result=dict(package,status='pending-human-review',policy=POLICY,records=records,
                strictBodyRegistrationPassed=False,fullAutomaticDagPassed=False,humanVisualAcceptance=False,
                originalDagPromoted=False,generationCalls=0,modelCalls=0,provenanceSha256=digest(output/'revision-provenance.json'))
            save(output/'result.json',result);return result
        except Exception:
            if (output/'delivery').exists():shutil.rmtree(output/'delivery')
            raise
