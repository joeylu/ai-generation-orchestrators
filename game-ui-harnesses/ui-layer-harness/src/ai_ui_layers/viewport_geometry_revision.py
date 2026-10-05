"""Optional candidate world storage with an unchanged original display viewport."""
from copy import deepcopy
import hashlib
import io
import json
import math
from pathlib import Path
import shutil
import tempfile
import zipfile
import numpy as np
from PIL import Image
from .evaluate import read,save,digest
from .experimental_executor import record,verified
from .layer_package import composite,write_package,validate_archive,check_composition
from . import observed_geometry_revision as observed

POLICY='expanded-support-original-viewport-v1'
KIND='ui_viewport_geometry_revision_v1'
FLAGS=dict(strictBodyRegistrationPassed=False,fullAutomaticDagPassed=False,
           humanVisualAcceptance=False,originalDagPromoted=False,generationCalls=0,modelCalls=0)
WRAPPER_FILES={'world-ui-layers.zip','viewport.json','viewport-preview.png','original-reference.png',
               'viewport-checksums.json'}


def _canonical(value):
    return hashlib.sha256(json.dumps(value,sort_keys=True,separators=(',', ':'),
        ensure_ascii=False,allow_nan=False).encode()).hexdigest()


def validate_viewport_archive(archive):
    """Validate the new wrapper independently of the unchanged standard ZIP contract."""
    archive=Path(archive)
    with zipfile.ZipFile(archive) as z:
        names=z.namelist()
        if (set(names)!=WRAPPER_FILES or len(names)!=len(WRAPPER_FILES) or names!=sorted(names)
                or any(info.compress_type!=zipfile.ZIP_STORED for info in z.infolist()) or z.testzip() is not None):
            raise ValueError('VIEWPORT_WRAPPER_MEMBERS_OR_CRC')
        checksums=json.loads(z.read('viewport-checksums.json'))
        if (checksums.get('kind')!='ui_viewport_layers_wrapper_v1' or checksums.get('policy')!=POLICY
                or set(checksums.get('files',{}))!=WRAPPER_FILES-{'viewport-checksums.json'}):
            raise ValueError('VIEWPORT_WRAPPER_CHECKSUM_CONTRACT')
        for name,entry in checksums['files'].items():
            data=z.read(name)
            if entry!=dict(sha256=hashlib.sha256(data).hexdigest(),bytes=len(data)):
                raise ValueError('VIEWPORT_WRAPPER_CHECKSUM_MISMATCH')
        viewport=json.loads(z.read('viewport.json'))
        with tempfile.TemporaryDirectory(prefix='viewport-validate-') as temporary:
            root=Path(temporary);inner=root/'world-ui-layers.zip';inner.write_bytes(z.read('world-ui-layers.zip'))
            validated=validate_archive(inner)
            with zipfile.ZipFile(inner) as layers:
                package=root/'package';package.mkdir()
                for name in layers.namelist():
                    path=package/name;path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(layers.read(name))
                composition=read(package/'composition.json');world=composite(package,composition)
                with Image.open(package/'preview.png') as image:
                    if world.tobytes()!=image.convert('RGBA').tobytes():raise ValueError('WRAPPER_WORLD_RECOMPOSITION')
            w,h=viewport['originalSize'];shift=viewport['worldShift'];box=viewport['worldViewportBox']
            if (viewport.get('policy')!=POLICY or viewport['worldSize']!=list(world.size) or
                box!=[shift[0],shift[1],shift[0]+w,shift[1]+h] or
                not 0<=box[0]<box[2]<=world.width or not 0<=box[1]<box[3]<=world.height):
                raise ValueError('WRAPPER_VIEWPORT_BOUNDS')
            with Image.open(io.BytesIO(z.read('viewport-preview.png'))) as image:
                if image.size!=(w,h) or image.convert('RGBA').tobytes()!=world.crop(box).tobytes():
                    raise ValueError('WRAPPER_VIEWPORT_SLICE')
            original=z.read('original-reference.png')
            if hashlib.sha256(original).hexdigest()!=viewport['originalReferenceSha256']:
                raise ValueError('WRAPPER_ORIGINAL_REFERENCE_IDENTITY')
            with Image.open(io.BytesIO(original)) as image:
                if image.size!=(w,h):raise ValueError('WRAPPER_ORIGINAL_REFERENCE_SIZE')
                expected=Image.new('RGBA',world.size);expected.paste(image.convert('RGBA'),tuple(shift))
            with Image.open(package/'reference.png') as image:
                if image.convert('RGBA').tobytes()!=expected.tobytes():raise ValueError('WRAPPER_REFERENCE_EXTENSION')
    return dict(status='viewport-wrapper-integrity-passed',sha256=digest(archive),bytes=archive.stat().st_size,
                innerPackageSha256=validated['sha256'],**FLAGS)


def _wrapper(delivery):
    names=WRAPPER_FILES-{'viewport-checksums.json'}
    values={name:(delivery/('ui-layers.zip' if name=='world-ui-layers.zip' else name)).read_bytes() for name in names}
    checksums=dict(kind='ui_viewport_layers_wrapper_v1',policy=POLICY,
        files={name:dict(sha256=hashlib.sha256(data).hexdigest(),bytes=len(data)) for name,data in sorted(values.items())})
    save(delivery/'viewport-checksums.json',checksums)
    values['viewport-checksums.json']=(delivery/'viewport-checksums.json').read_bytes()
    archive=delivery/'viewport-ui-layers.zip'
    with zipfile.ZipFile(archive,'x',compression=zipfile.ZIP_STORED) as z:
        for name,data in sorted(values.items()):
            info=zipfile.ZipInfo(name,(2020,1,1,0,0,0));info.external_attr=0o100644<<16;z.writestr(info,data)
    return validate_viewport_archive(archive)


def transform(source, geometry):
    """Render all support before removing zero-alpha padding; never clamp to viewport."""
    with Image.open(source) as image:
        image.load()
        if image.format!='PNG' or image.getexif().get(274,1)!=1:raise ValueError('ORIENTED_PNG_REQUIRED')
        mode=image.mode;raw=image.convert('RGBA')
    pixels=np.array(raw);pixels[pixels[:,:,3]==0,:3]=0;raw=Image.fromarray(pixels)
    full=raw.getchannel('A').getbbox()
    if full is None:raise ValueError('EMPTY_SOURCE')
    s=geometry['uniformScale'];tx,ty=geometry['translation']
    if not all(type(v) in (int,float) and math.isfinite(v) for v in (s,tx,ty)) or s<=0:
        raise ValueError('FINITE_POSITIVE_TRANSFORM_REQUIRED')
    theoretical=[full[0]*s+tx,full[1]*s+ty,full[2]*s+tx,full[3]*s+ty]
    if abs(s-1)<1e-12 and abs(tx-round(tx))<1e-12 and abs(ty-round(ty))<1e-12:
        rendered=raw.crop(full);absolute=[full[i]+round((tx,ty)[i%2]) for i in range(4)]
        sampling='integer translation; source alpha preserved exactly'
    else:
        guard=2*s+2
        region=[math.floor(theoretical[0]-guard),math.floor(theoretical[1]-guard),
                math.ceil(theoretical[2]+guard),math.ceil(theoretical[3]+guard)]
        size=(region[2]-region[0],region[3]-region[1])
        if size[0]*size[1]>16_777_216:raise ValueError('RENDER_PIXEL_LIMIT')
        rendered=raw.transform(size,Image.Transform.AFFINE,
            (1/s,0,(region[0]-tx)/s,0,1/s,(region[1]-ty)/s),resample=Image.Resampling.BICUBIC)
        alpha=rendered.getchannel('A').getbbox()
        if alpha is None:raise ValueError('EMPTY_RENDER')
        if alpha[0]==0 or alpha[1]==0 or alpha[2]==size[0] or alpha[3]==size[1]:
            raise ValueError('RENDER_GUARD_SUPPORT_TOUCHES_BOUNDARY')
        absolute=[alpha[i]+region[i%2] for i in range(4)];rendered=rendered.crop(alpha)
        sampling='uniform cubic; complete nonzero support; alpha may quantize during resampling'
    result=np.array(rendered);result[result[:,:,3]==0,:3]=0
    return Image.fromarray(result),dict(geometry,originalMode=mode,sourceFullAlphaBox=list(full),
        transformedTheoreticalSupport=theoretical,layerCanvasRegion=absolute,sourceAlphaThreshold=0,
        storagePaddingRemoval='zero-alpha-only',alphaSupportClipped=False,implicitClamp=False,
        sampling=sampling)


def _build(spec, proofs, temp):
    original=temp/'original';original.mkdir()
    with zipfile.ZipFile(spec['sourceArchive']) as z:
        for name in z.namelist():
            path=original/name;path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(z.read(name))
    composition=read(original/'composition.json');before=composite(original,composition)
    with Image.open(original/'preview.png') as image:
        if image.convert('RGBA').tobytes()!=before.tobytes():raise ValueError('SOURCE_PREVIEW_MISMATCH')
    previous=deepcopy(composition);sources={};records=[];regions=[]
    for index,layer in enumerate(composition['layers']):
        mid=layer['id'];source=original/layer['path']
        region=[layer['x'],layer['y'],layer['x']+layer['width'],layer['y']+layer['height']]
        row=dict(layerId=mid,status='unchanged',reason='no-frozen-observation',
                 originalLayer=deepcopy(layer),sourceSha256=digest(source))
        if mid in proofs:
            request,answer,actual,assessment=proofs[mid]
            row.update(observation=answer,assessment=assessment,
                sourceEvidence={k:deepcopy(request[k]) for k in ('sourceArchiveSha256','sourceSha256',
                    'sourceSize','referenceSha256','referenceSize','sourceOverride') if k in request})
            if not assessment['geometryUsableCandidate']:row['reason']='unresolved-observed-geometry'
            else:
                try:
                    if layer['role']=='background':
                        image,geometry=observed.background_transform(actual,answer,before.size,layer,
                            allow_identity='sourceOverride' not in request)
                    else:
                        fitted=observed.fit(answer,spec['fitPolicy']['maximumResidualPixels'])
                        image,geometry=transform(actual,fitted)
                    region=geometry['layerCanvasRegion']
                    if image is not None:
                        source=temp/f'render-{index}.png';image.save(source)
                        layer.update(x=region[0],y=region[1],width=image.width,height=image.height)
                        row.update(status='geometry-candidate',reason='observed-uniform-fit-expanded-storage')
                    else:row['reason']='exact-identity-fit'
                    row['geometry']=geometry
                except ValueError as exc:row['reason']=str(exc)
        sources[mid]=dict(path=str(source),sha256=digest(source));regions.append(region)
        row['originalCoordinateStorageRegion']=region;row['storedSha256']=digest(source);records.append(row)
    width,height=before.size
    bounds=[min(0,*[r[0] for r in regions]),min(0,*[r[1] for r in regions]),
            max(width,*[r[2] for r in regions]),max(height,*[r[3] for r in regions])]
    shift=[-bounds[0],-bounds[1]];world_size=(bounds[2]-bounds[0],bounds[3]-bounds[1])
    composition['canvas']=dict(width=world_size[0],height=world_size[1])
    for layer,row in zip(composition['layers'],records):
        layer['x']+=shift[0];layer['y']+=shift[1];row['worldLayer']=deepcopy(layer)
    check_composition(composition)
    reference=temp/'world-reference.png'
    with Image.open(original/'reference.png') as image:
        extended=Image.new('RGBA',world_size);extended.paste(image.convert('RGBA'),tuple(shift));extended.save(reference)
    folder=temp/'world';folder.mkdir();(folder/'layers').mkdir()
    for layer in composition['layers']:shutil.copyfile(sources[layer['id']]['path'],folder/layer['path'])
    world=composite(folder,composition);world.save(temp/'world-preview.png')
    viewport=dict(kind='ui_original_viewport_v1',policy=POLICY,worldBoundsInOriginalCoordinates=bounds,
        worldShift=shift,originalSize=[width,height],worldSize=list(world_size),
        worldViewportBox=[shift[0],shift[1],shift[0]+width,shift[1]+height],
        originalReferenceSha256=digest(original/'reference.png'),worldReferenceSha256=digest(reference),
        displayPolicy='exact original viewport slice; complete layer alpha retained in world storage')
    world.crop(viewport['worldViewportBox']).save(temp/'viewport-preview.png')
    proposal=dict(kind=KIND,policy=POLICY,sourceArchiveSha256=spec['sourceArchiveSha256'],
                  fitPolicy=spec['fitPolicy'],viewport=viewport,records=records,**FLAGS)
    proposal['proposalDigest']=_canonical(proposal)
    return original,previous,composition,sources,proposal,reference


def _inputs(selection,spec):
    roots={str(Path(row['directory']).resolve().parent.parent) for row in spec['observations']}
    # External verified native jobs are frozen too, without copying their logs.
    for request,_,_,_ in observed._preflight(spec).values():
        if 'sourceOverride' in request:roots.add(str(Path(request['sourceOverride']['job']).resolve()))
    return dict(files={str(selection):digest(selection),str(Path(spec['sourceArchive']).resolve()):spec['sourceArchiveSha256']},
                inventories={root:observed._tree(root) for root in sorted(roots)})


def _fresh(output, paths):
    if output.exists() or any(output.is_relative_to(Path(p).resolve()) or Path(p).resolve().is_relative_to(output) for p in paths):
        raise ValueError('FRESH_INDEPENDENT_OUTPUT_REQUIRED')


def draft(selection, output, viewer):
    selection=Path(selection).resolve();output=Path(output).resolve();viewer=Path(viewer).resolve()
    spec=read(selection);proofs=observed._preflight(spec);inputs=_inputs(selection,spec)
    _fresh(output,[selection,viewer,*inputs['files'],*inputs['inventories']])
    with tempfile.TemporaryDirectory(prefix='viewport-proposal-') as temporary:
        temp=Path(temporary);_,_,_,_,proposal,_=_build(spec,proofs,temp)
        observed._unchanged(inputs);output.mkdir(parents=True)
        for name in ('world-preview.png','viewport-preview.png'):shutil.copyfile(temp/name,output/name)
        save(output/'viewport.json',proposal['viewport'])
        result=dict(proposal,status='unapproved-policy-proposal',approved=False,
            artifacts={name:digest(output/name) for name in ('world-preview.png','viewport-preview.png','viewport.json')})
        save(output/'proposal.json',result);return result


def freeze(selection, output, actual_user_policy_instruction):
    if not isinstance(actual_user_policy_instruction,str) or not actual_user_policy_instruction.strip():
        raise ValueError('EXPLICIT_ACTUAL_USER_POLICY_INSTRUCTION_REQUIRED')
    selection=Path(selection).resolve();output=Path(output).resolve();spec=read(selection)
    proofs=observed._preflight(spec);inputs=_inputs(selection,spec)
    _fresh(output,[*inputs['files'],*inputs['inventories']])
    with tempfile.TemporaryDirectory(prefix='viewport-freeze-') as temporary:
        _,_,_,_,proposal,_=_build(spec,proofs,Path(temporary))
    observed._unchanged(inputs);output.mkdir(parents=True)
    save(output/'selection.json',spec);save(output/'schema.json',observed.SCHEMA)
    save(output/'policy-authorization.json',dict(kind='ui_viewport_policy_authorization_v1',policy=POLICY,
        actualUserPolicyInstruction=actual_user_policy_instruction,proposalDigest=proposal['proposalDigest'],
        viewport=proposal['viewport'],sourceArchiveSha256=spec['sourceArchiveSha256']))
    return record(output/'freeze.json',dict(kind=KIND,policy=POLICY,approved=True,
        selectionSha256=digest(output/'selection.json'),schemaSha256=digest(output/'schema.json'),
        authorizationSha256=digest(output/'policy-authorization.json'),proposalDigest=proposal['proposalDigest'],
        **inputs,**FLAGS))


def revise(frozen, expected_digest, output, viewer):
    frozen=Path(frozen).resolve();output=Path(output).resolve();viewer=Path(viewer).resolve()
    config=verified(frozen/'freeze.json')
    if (config.get('kind')!=KIND or config.get('policy')!=POLICY or config.get('approved') is not True
            or config['digest']!=expected_digest):raise ValueError('APPROVED_VIEWPORT_FREEZE_REQUIRED')
    for name,field in (('selection.json','selectionSha256'),('schema.json','schemaSha256'),
                       ('policy-authorization.json','authorizationSha256')):
        if digest(frozen/name)!=config[field]:raise ValueError('FROZEN_VIEWPORT_CONTRACT_CHANGED')
    if read(frozen/'schema.json')!=observed.SCHEMA:raise ValueError('FROZEN_VIEWPORT_SCHEMA_CHANGED')
    authorization=read(frozen/'policy-authorization.json')
    if (authorization.get('policy')!=POLICY or not authorization.get('actualUserPolicyInstruction')
            or authorization.get('proposalDigest')!=config['proposalDigest']):
        raise ValueError('EXPLICIT_VIEWPORT_POLICY_AUTHORIZATION_REQUIRED')
    observed._unchanged(config);spec=read(frozen/'selection.json');proofs=observed._preflight(spec)
    _fresh(output,[frozen,viewer,*config['files'],*config['inventories']])
    with tempfile.TemporaryDirectory(prefix='viewport-revision-') as temporary:
        temp=Path(temporary);original,previous,composition,sources,proposal,reference=_build(spec,proofs,temp)
        if proposal['proposalDigest']!=config['proposalDigest'] or proposal['viewport']!=authorization['viewport']:
            raise ValueError('APPROVED_PROPOSAL_CHANGED')
        observed._unchanged(config);output.mkdir(parents=True)
        issues=list(read(original/'review.json')['issues'])+[
            'Expanded world support candidate; original viewport display only; strict and human acceptance remain false.',
            'Viewport contract: '+json.dumps(proposal['viewport'],sort_keys=True)]
        issues.extend('Geometry: '+json.dumps(observed._public(row),ensure_ascii=False,sort_keys=True) for row in proposal['records'])
        package=write_package(reference,composition,sources,output/'delivery',viewer,issues)
        validate_archive(output/'delivery/ui-layers.zip')
        published=output/'delivery/package';world=composite(published,composition)
        with Image.open(published/'preview.png') as image:
            if image.tobytes()!=world.tobytes():raise ValueError('WORLD_RECOMPOSITION_MISMATCH')
        viewport=world.crop(proposal['viewport']['worldViewportBox']);viewport.save(output/'delivery/viewport-preview.png')
        with Image.open(temp/'viewport-preview.png') as image:
            if image.tobytes()!=viewport.tobytes():raise ValueError('VIEWPORT_SLICE_MISMATCH')
        shutil.copyfile(original/'reference.png',output/'delivery/original-reference.png')
        save(output/'delivery/viewport.json',proposal['viewport'])
        wrapper=_wrapper(output/'delivery')
        for layer,row in zip(composition['layers'],proposal['records']):
            if row['status']=='unchanged' and (published/layer['path']).read_bytes()!=(original/layer['path']).read_bytes():
                raise ValueError('UNCHANGED_NATIVE_BYTES_CHANGED')
        observed._unchanged(config)
        provenance=dict(proposal,frozenDigest=expected_digest,authorizationSha256=config['authorizationSha256'],
            sourceManifest=read(original/'manifest.json'),sourceReview=read(original/'review.json'),
            originalComposition=previous,packageSha256=package['sha256'])
        save(output/'revision-provenance.json',provenance)
        result=dict(package,status='pending-human-review',policy=POLICY,viewport=proposal['viewport'],
            viewportArchiveSha256=wrapper['sha256'],viewportArchiveBytes=wrapper['bytes'],
            innerPackageSha256=package['sha256'],
            records=proposal['records'],proposalDigest=proposal['proposalDigest'],
            companionFiles={name:digest(output/'delivery'/name) for name in
                ('viewport.json','viewport-preview.png','original-reference.png','viewport-checksums.json')},
            provenanceSha256=digest(output/'revision-provenance.json'),**FLAGS)
        save(output/'result.json',result);return result
