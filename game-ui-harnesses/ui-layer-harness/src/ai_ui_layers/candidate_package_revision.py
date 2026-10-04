"""Explicit alpha-support candidate revisions; no model calls or strict promotion."""
from copy import deepcopy
import argparse
import hashlib
import json
import math
from pathlib import Path
import shutil
import tempfile
import zipfile

import numpy as np
from PIL import Image
from jsonschema import Draft202012Validator

from .accepted_materials import received, replay
from .evaluate import read, save, digest
from .experimental_executor import record, verified, load_job
from .freeze_visual import inspect
from .layer_package import composite, portable_text, validate_archive, write_package
from .package_revision import _png, _bind_tree, _unchanged

KIND='ui_candidate_package_revision_v1'
POLICY='uniform-axis-edge-anchor-alpha-support-v1'
SHA=dict(type='string',pattern='^[a-f0-9]{64}$')
FILE=dict(type='object',additionalProperties=False,required=['path','sha256'],
          properties=dict(path=dict(type='string',minLength=1),sha256=SHA))
ENTRY=dict(type='object',additionalProperties=False,
    required=['materialId','snapshot','snapshotDigest','job','requestId','uniformAxis','edgeAnchor','hostReview','bodyEvidence'],
    properties=dict(materialId=dict(type='string',minLength=1),snapshot=dict(type='string'),snapshotDigest=SHA,
        job=dict(type='string'),requestId=dict(type='string'),uniformAxis=dict(enum=['width','height']),
        edgeAnchor=dict(enum=['top-left','bottom-left']),
        hostReview=dict(type='object',additionalProperties=False,
            required=['directory','requestSha256','resultSha256','producerRuntime'],
            properties=dict(directory=dict(type='string'),requestSha256=SHA,resultSha256=SHA,producerRuntime=dict(type='string'))),
        bodyEvidence=dict(type='object',additionalProperties=False,required=['request','response','result','schema'],
            properties=dict(request=FILE,response=FILE,result=FILE,schema=FILE))))
SCHEMA=dict(type='object',additionalProperties=False,
    required=['kind','sourceArchive','sourceArchiveSha256','replacements','knownDifferences'],
    properties=dict(kind=dict(const=KIND),sourceArchive=dict(type='string'),sourceArchiveSha256=SHA,
        replacements=dict(type='array',minItems=1,maxItems=128,items=ENTRY),
        knownDifferences=dict(type='array',minItems=1,maxItems=128,items=dict(type='string',minLength=1))))


def _file(binding,bound):
    path=Path(binding['path']).resolve()
    if digest(path)!=binding['sha256']:raise ValueError('CANDIDATE_EVIDENCE_CHANGED')
    bound[str(path)]=binding['sha256'];return path


def _host_review(entry, raw, lineage, bound, inventories):
    """Replay a completed historical exchange without rebinding its runtime."""
    from . import host_material_review as host
    from .host_review import _bound_files
    from .ownership_observation import inventory, extend_schema
    from .sheet_review_policy import schema_for
    from .visual_policy import snapshot_policy
    binding=entry['hostReview'];root=Path(binding['directory']).resolve()
    if (digest(root/'request.json')!=binding['requestSha256'] or
            digest(root/'result.json')!=binding['resultSha256']):raise ValueError('CANDIDATE_HOST_REVIEW_CHANGED')
    _bind_tree(root,bound,inventories)
    request=read(root/'request.json');result=read(root/'result.json')
    if request.get('kind')!='ui_host_output_review_request_v2':raise ValueError('CANDIDATE_OWNERSHIP_REVIEW_REQUIRED')
    if digest(root/'request.json')!=read(root/'preparation.json')['requestSha256']:
        raise ValueError('CANDIDATE_HOST_PREPARATION_CHANGED')
    producer=Path(binding['producerRuntime']).resolve()
    _bound_files(producer,request['runtime'])
    for name,sha in request['runtime'].items():bound[str((producer/name).resolve())]=sha
    _bound_files(root,request['inputs']);_bound_files(Path(entry['job']),request['sourceFiles'])
    if (request['jobDigest']!=lineage['jobDigest'] or request['requestId']!=entry['requestId'] or
            request['snapshotDigest']!=entry['snapshotDigest'] or request['rawSha256']!=digest(raw) or
            request['submissionDigest']!=lineage['submissionDigest'] or request['materialIds']!=[entry['materialId']]):
        raise ValueError('CANDIDATE_HOST_SOURCE_MISMATCH')
    reservation=Path(request['reservation']).resolve()
    if digest(reservation)!=request['reservationSha256'] or read(reservation)['output']!=str(root):
        raise ValueError('CANDIDATE_HOST_RESERVATION_CHANGED')
    bound[str(reservation)]=digest(reservation)
    snapshot=Path(entry['snapshot']);manifest=inspect(snapshot,entry['snapshotDigest'])
    policy=snapshot_policy(snapshot,manifest)
    visual_path=snapshot/'evidence/revised-visual-plan.json'
    visual=read(visual_path if visual_path.exists() else snapshot/'evidence/m1-draft.json')
    catalog=inventory(visual,read(snapshot/'execution-plan.candidate.json'),[entry['materialId']])
    if (read(root/'review/ownership-inventory.json')!=catalog or
            digest(root/'review/ownership-inventory.json')!=request['ownershipInventorySha256'] or
            read(root/'review/schema.json')!=extend_schema(schema_for(policy),catalog)):
        raise ValueError('CANDIDATE_HOST_CATALOG_CHANGED')
    if result.get('status') not in ('blocked_no_retry','reviewed_pending_visual_acceptance'):
        raise ValueError('CANDIDATE_COMPLETED_HOST_REVIEW_REQUIRED')
    _bound_files(root/'review',result['outputs'])
    if read(root/'review/exchange-provenance.json')!=host.provenance(root,request):
        raise ValueError('CANDIDATE_HOST_PROVENANCE_CHANGED')
    if {k:v for k,v in result.items() if k!='outputs'}!=host.assess(root,request,policy):
        raise ValueError('CANDIDATE_HOST_ASSESSMENT_CHANGED')
    return dict(result=result,answer=read(root/'review/draft.json'),producerRuntime=request['runtime'],
                requestSha256=binding['requestSha256'],resultSha256=binding['resultSha256'])


def _body(entry,raw,reference_sha,placement,bound,inventories):
    bindings=entry['bodyEvidence'];paths={key:_file(value,bound) for key,value in bindings.items()}
    request=read(paths['request']);answer=read(paths['response']);result=read(paths['result'])
    Draft202012Validator(read(paths['schema'])).validate(answer)
    if (request.get('materialId')!=entry['materialId'] or request.get('snapshotDigest')!=entry['snapshotDigest'] or
            request.get('sourceSha256')!=digest(raw) or request.get('referenceSha256')!=reference_sha or
            request.get('schemaSha256')!=digest(paths['schema'])):raise ValueError('CANDIDATE_BODY_SOURCE_MISMATCH')
    if request.get('ownershipRegion')!=placement['sourceRegion']:raise ValueError('CANDIDATE_BODY_OWNER_MISMATCH')
    with Image.open(raw) as image:
        if request.get('sourceSize')!=list(image.size):raise ValueError('CANDIDATE_BODY_SOURCE_SIZE')
    if 'responseSha256' in result and result['responseSha256']!=digest(paths['response']):
        raise ValueError('CANDIDATE_BODY_RESPONSE_CHANGED')
    if 'answer' in result and result['answer']!=answer:raise ValueError('CANDIDATE_BODY_ANSWER_CHANGED')
    status=result.get('status')
    if status not in ('body_observation_unresolved','body_registration_blocked','body_registered_pending_visual_review'):
        raise ValueError('CANDIDATE_COMPLETED_BODY_RESULT_REQUIRED')
    if status!='body_registered_pending_visual_review' and 'responseSha256' not in result:
        raise ValueError('CANDIDATE_BODY_RESPONSE_BINDING_REQUIRED')
    if status=='body_registered_pending_visual_review':
        # A successful historical strict result is checked on its own terms;
        # it is never substituted for the candidate placement below.
        root=paths['result'].parent;_bind_tree(root,bound,inventories)
        observation=read(root/'observation.json');contract=read(root/'contract.json')
        for key,expected in dict(materialId=entry['materialId'],snapshotDigest=entry['snapshotDigest'],
                sourceSha256=digest(raw),referenceSha256=reference_sha,
                sourceBodyBox=answer.get('sourceBodyBox'),targetBodyBox=answer.get('targetBodyBox'),issues=answer.get('issues')).items():
            if observation.get(key)!=expected or contract.get(key)!=expected:raise ValueError('CANDIDATE_REGISTERED_BODY_MISMATCH')
        if answer.get('boundaryStatus')!='complete' or answer.get('issues'):
            raise ValueError('CANDIDATE_REGISTERED_BODY_UNRESOLVED')
        preview=root/'preview';report=read(preview/'report.json')
        if digest(preview/'report.json')!=result.get('previewReportSha256'):raise ValueError('CANDIDATE_BODY_PREVIEW_CHANGED')
        rows=[r for r in report['records'] if r['id']==entry['materialId']]
        if len(rows)!=1 or rows[0]['report'].get('bodyContract')!=contract:
            raise ValueError('CANDIDATE_BODY_PREVIEW_SCOPE')
        with tempfile.TemporaryDirectory(prefix='ui-candidate-body-proof-') as temporary:
            replay(dict(entry,sourceMaterialId=entry['materialId']),rows[0],placement,'foreground',
                   reference_sha,Path(temporary)/'strict-replay')
    return dict(request=request,response=answer,result=result,
                fingerprints={key:value['sha256'] for key,value in bindings.items()},
                observerAssertionOnly=True,humanVisualAcceptance=False)


def _preflight(spec,bound,inventories):
    Draft202012Validator(SCHEMA).validate(spec)
    for issue in spec['knownDifferences']:portable_text(issue)
    ids=[e['materialId'] for e in spec['replacements']]
    if len(ids)!=len(set(ids)):raise ValueError('CANDIDATE_DUPLICATE_MATERIAL')
    archive=Path(spec['sourceArchive']).resolve()
    if digest(archive)!=spec['sourceArchiveSha256']:raise ValueError('CANDIDATE_SOURCE_ARCHIVE_CHANGED')
    validate_archive(archive);bound[str(archive)]=digest(archive)
    with zipfile.ZipFile(archive) as zipped:
        composition=json.loads(zipped.read('composition.json'));reference_sha=hashlib.sha256(zipped.read('reference.png')).hexdigest()
    layers={row['id']:row for row in composition['layers']};proofs={}
    for entry in spec['replacements']:
        mid=entry['materialId'];snapshot=Path(entry['snapshot']).resolve();job=Path(entry['job']).resolve()
        manifest=inspect(snapshot,entry['snapshotDigest']);_bind_tree(snapshot,bound,inventories);_bind_tree(job,bound,inventories)
        config,index=load_job(job)
        if 'cleanup' in config:_bind_tree(Path(config['cleanup']['sourceJob']),bound,inventories)
        if config['snapshotDigest']!=manifest['digest'] or entry['requestId']!=mid or index[mid].get('kind')=='sheet':
            raise ValueError('CANDIDATE_SINGLETON_SOURCE_REQUIRED')
        raw,row,lineage=received(job,mid,reference_sha)
        if mid not in layers or layers[mid]['role']!='foreground':raise ValueError('CANDIDATE_FOREGROUND_ONLY')
        placements=sorted(read(snapshot/'placements.json')['materials'],key=lambda p:p['drawIndex'])
        if [p['id'] for p in placements]!=[p['id'] for p in composition['layers']]:raise ValueError('CANDIDATE_LAYER_ORDER_MISMATCH')
        placement=next(p for p in placements if p['id']==mid)
        visual_path=snapshot/'evidence/revised-visual-plan.json'
        visual=read(visual_path if visual_path.exists() else snapshot/'evidence/m1-draft.json')
        if (visual['textPolicy']!=composition['textPolicy'] or visual['backgroundMode']!=composition['backgroundMode'] or
                next(m for m in visual['materials'] if m['id']==mid)['role']!='foreground'):
            raise ValueError('CANDIDATE_VISUAL_POLICY_MISMATCH')
        review=_host_review(entry,raw,lineage,bound,inventories)
        body=_body(entry,raw,reference_sha,placement,bound,inventories)
        proofs[mid]=dict(raw=raw,placement=placement,lineage=lineage,hostReview=review,bodyEvidence=body)
    return proofs


def freeze(selection,output):
    """Freeze a read-only explicit candidate selection and all existing evidence."""
    selection=Path(selection).resolve();output=Path(output).resolve()
    spec=read(selection);bound={str(selection):digest(selection)};inventories={}
    _preflight(spec,bound,inventories)
    if output.exists() or any(output.is_relative_to(Path(p)) or Path(p).is_relative_to(output)
                              for p in [*bound,*inventories]):raise ValueError('CANDIDATE_FRESH_INDEPENDENT_OUTPUT_REQUIRED')
    _unchanged(bound,inventories);output.mkdir(parents=True)
    save(output/'selection.json',spec);save(output/'schema.json',SCHEMA)
    return record(output/'freeze.json',dict(kind=KIND,policy=POLICY,selectionSha256=digest(output/'selection.json'),
        schemaSha256=digest(output/'schema.json'),verifiedInputs=bound,
        inventories={k:sorted(v) for k,v in inventories.items()},generationCalls=0,modelCalls=0))


def transform(raw,owner,reference_size,axis,anchor):
    """One explicit uniform scale, with complete unthresholded alpha support."""
    if axis not in ('width','height') or anchor not in ('top-left','bottom-left'):raise ValueError('CANDIDATE_GEOMETRY_POLICY')
    with Image.open(raw) as image:
        if image.format!='PNG' or image.getexif().get(274,1)!=1:raise ValueError('CANDIDATE_PNG_REQUIRED')
        source=image.convert('RGBA');source.load()
    pixels=np.array(source)
    # Normalize only invisible RGB on an in-memory copy. The received raw bytes
    # and every alpha value remain untouched; no threshold or key removal occurs.
    hidden=int(np.count_nonzero((pixels[:,:,3]==0)&np.any(pixels[:,:,:3]!=0,axis=2)))
    pixels[pixels[:,:,3]==0,:3]=0;source=Image.fromarray(pixels)
    full=source.getchannel('A').getbbox()
    if full is None or source.getchannel('A').getextrema()[0]!=0:raise ValueError('CANDIDATE_NATIVE_ALPHA_REQUIRED')
    cropped=source.crop(full);guarded=Image.new('RGBA',(cropped.width+4,cropped.height+4));guarded.paste(cropped,(2,2))
    selected=0 if axis=='width' else 1
    target=owner[selected+2]-owner[selected]
    if target<=4:raise ValueError('CANDIDATE_OWNER_TOO_SMALL')
    scale=(target-4)/guarded.size[selected]
    size=tuple(math.ceil(v*scale-1e-10)+4 for v in guarded.size)
    if size[0]*size[1]>16_777_216:raise ValueError('CANDIDATE_LAYER_PIXEL_LIMIT')
    x=owner[0];y=owner[1] if anchor=='top-left' else owner[3]-size[1]
    region=[x,y,x+size[0],y+size[1]]
    if not (0<=x<region[2]<=reference_size[0] and 0<=y<region[3]<=reference_size[1]):
        raise ValueError('CANDIDATE_SUPPORT_OUTSIDE_REFERENCE_NO_SHRINK')
    rendered=guarded.transform(size,Image.Transform.AFFINE,(1/scale,0,-2/scale,0,1/scale,-2/scale),
                               resample=Image.Resampling.BICUBIC)
    array=np.array(rendered);array[array[:,:,3]==0,:3]=0;rendered=Image.fromarray(array)
    alpha=array[:,:,3]
    if not np.any(alpha):raise ValueError('CANDIDATE_EMPTY_RENDER')
    if np.any(alpha[:2,:]) or np.any(alpha[-2:,:]) or np.any(alpha[:,:2]) or np.any(alpha[:,-2:]):
        raise ValueError('CANDIDATE_TRANSPARENT_GUARD_FAILED')
    geometry=dict(policy=POLICY,uniformAxis=axis,edgeAnchor=anchor,ownershipRegion=owner,
        sourceFullAlphaBox=list(full),sourceAlphaThreshold=0,uniformScale=scale,
        sourceHiddenRgbPixelsNormalized=hidden,
        sourceTransparentSamplingGuard=2,outputTransparentSamplingGuard=2,layerCanvasRegion=region,
        actualRenderedSupportBox=list(rendered.getchannel('A').getbbox()),observedBody=False,
        strictBodyRegistrationPassed=False,alphaSupportClipped=False,implicitShrink=False,implicitClamp=False,
        sampling='uniform cubic; full nonzero support retained before resampling; alpha values not pixel-exact',
        humanVisualAcceptance=False)
    return rendered,geometry


def _portable(value):
    if isinstance(value,str):
        try:return portable_text(value)
        except ValueError:return '[Nonportable local evidence text; inspect revision provenance]'
    if isinstance(value,list):return [_portable(v) for v in value]
    if isinstance(value,dict):return {k:_portable(v) for k,v in value.items() if k not in ('actualObserverId','producerRuntime')}
    return value


def revise(frozen,expected_digest,output,viewer):
    """Publish a complete candidate ZIP without weakening strict revise-package."""
    frozen=Path(frozen).resolve();output=Path(output).resolve();viewer=Path(viewer).resolve()
    config=verified(frozen/'freeze.json')
    if config.get('kind')!=KIND or config.get('policy')!=POLICY or config['digest']!=expected_digest:
        raise ValueError('CANDIDATE_FREEZE_BINDING')
    if digest(frozen/'selection.json')!=config['selectionSha256'] or digest(frozen/'schema.json')!=config['schemaSha256'] or read(frozen/'schema.json')!=SCHEMA:
        raise ValueError('CANDIDATE_SELECTION_CHANGED')
    bound=dict(config['verifiedInputs']);inventories={k:set(v) for k,v in config['inventories'].items()}
    _unchanged(bound,inventories);spec=read(frozen/'selection.json')
    proofs=_preflight(spec,bound,inventories);_bind_tree(frozen,bound,inventories);_bind_tree(viewer,bound,inventories)
    if output.exists():raise FileExistsError('OUTPUT_EXISTS')
    if any(output.is_relative_to(Path(p)) or Path(p).is_relative_to(output) for p in [*bound,*inventories]):
        raise ValueError('CANDIDATE_OUTPUT_INPUT_OVERLAP')
    output.mkdir(parents=True)
    try:
        with tempfile.TemporaryDirectory(prefix='ui-candidate-revision-') as temporary:
            temp=Path(temporary);original=temp/'original';original.mkdir()
            with zipfile.ZipFile(spec['sourceArchive']) as zipped:
                for name in zipped.namelist():
                    path=original/name;path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(zipped.read(name))
            composition=read(original/'composition.json');previous=deepcopy(composition)
            for layer in previous['layers']:_png(original/layer['path'],layer)
            before=composite(original,previous)
            with Image.open(original/'preview.png') as image:
                if image.mode!='RGBA' or image.size!=before.size or image.tobytes()!=before.tobytes():
                    raise ValueError('CANDIDATE_SOURCE_PREVIEW_MISMATCH')
            with Image.open(original/'reference.png') as reference:
                if reference.size!=before.size:raise ValueError('CANDIDATE_REFERENCE_GEOMETRY')
            old={l['id']:l for l in previous['layers']};layers={l['id']:l for l in composition['layers']}
            sources={mid:dict(path=str(original/layer['path']),sha256=digest(original/layer['path'])) for mid,layer in old.items()}
            allowed=np.zeros((before.height,before.width),dtype=bool);records=[]
            for index,entry in enumerate(spec['replacements']):
                mid=entry['materialId'];proof=proofs[mid]
                image,geometry=transform(proof['raw'],proof['placement']['sourceRegion'],before.size,entry['uniformAxis'],entry['edgeAnchor'])
                region=geometry['layerCanvasRegion'];path=temp/(str(index)+'.png');image.save(path)
                for box in ([old[mid]['x'],old[mid]['y'],old[mid]['x']+old[mid]['width'],old[mid]['y']+old[mid]['height']],region):
                    allowed[box[1]:box[3],box[0]:box[2]]=True
                layers[mid].update(x=region[0],y=region[1],width=image.width,height=image.height)
                sources[mid]=dict(path=str(path),sha256=digest(path))
                records.append(dict(materialId=mid,geometry=geometry,receipt=proof['lineage'],
                    hostReview=proof['hostReview'],bodyEvidence=proof['bodyEvidence']))
            after=Image.new('RGBA',before.size)
            for layer in composition['layers']:
                with Image.open(sources[layer['id']]['path']) as image:after.alpha_composite(image,(layer['x'],layer['y']))
            if np.any(np.asarray(before)[~allowed]!=np.asarray(after)[~allowed]):raise ValueError('CANDIDATE_UNRELATED_PIXELS_CHANGED')
            inherited=read(original/'review.json')['issues']
            issues=list(inherited)+spec['knownDifferences']+[
                'Explicit candidate revision: alpha-support axis/edge placement only; no observed-body or strict registration claim.',
                'Every blocked host/body result remains unresolved. Whole-image human acceptance is required; no DAG promoted.']
            for row in records:
                public=dict(materialId=row['materialId'],geometry=row['geometry'],
                    hostResult=row['hostReview']['result'],hostAnswer=row['hostReview']['answer'],
                    bodyResult=row['bodyEvidence']['result'],bodyAnswer=row['bodyEvidence']['response'])
                issues.append('Candidate evidence: '+json.dumps(_portable(public),ensure_ascii=False,sort_keys=True))
            for issue in issues:portable_text(issue)
            _unchanged(bound,inventories)
            package=write_package(original/'reference.png',composition,sources,output/'delivery',viewer,issues)
            published=output/'delivery/package'
            for mid,layer in old.items():
                if mid not in proofs and (layers[mid]!=layer or (published/layer['path']).read_bytes()!=(original/layer['path']).read_bytes()):
                    raise ValueError('CANDIDATE_UNREPLACED_LAYER_CHANGED')
            if composite(published,composition).tobytes()!=after.tobytes():raise ValueError('CANDIDATE_OUTPUT_PREVIEW_MISMATCH')
            _unchanged(bound,inventories)
            provenance=dict(kind=KIND,policy=POLICY,frozenDigest=expected_digest,sourceArchiveSha256=spec['sourceArchiveSha256'],
                verifiedInputs=bound,replacements=records,knownDifferences=spec['knownDifferences'],inheritedIssues=inherited,
                retainedLayerProviderLineage='inherited; not newly verified',keptLayerBytesExact=True,
                unchangedOutsideReplacementCanvasUnion=True,replacementReceiptReplayPassed=True,
                observedBody=False,strictBodyRegistrationPassed=False,fullAutomaticDagPassed=False,
                humanVisualAcceptance=False,originalDagPromoted=False,generationCalls=0,modelCalls=0,packageSha256=package['sha256'])
            save(output/'revision-provenance.json',provenance)
            result=dict(package,status='pending-human-review',policy=POLICY,replacements=records,
                keptLayerBytesExact=True,unchangedOutsideReplacementCanvasUnion=True,
                observedBody=False,strictBodyRegistrationPassed=False,fullAutomaticDagPassed=False,
                humanVisualAcceptance=False,originalDagPromoted=False,generationCalls=0,modelCalls=0,
                provenanceSha256=digest(output/'revision-provenance.json'))
            save(output/'result.json',result);return result
    except Exception as error:
        if (output/'delivery').exists():shutil.rmtree(output/'delivery')
        save(output/'result.json',dict(status='candidate_revision_blocked_no_retry',reason=str(error),
            fullAutomaticDagPassed=False,humanVisualAcceptance=False,generationCalls=0,modelCalls=0))
        raise


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);sub=parser.add_subparsers(dest='action',required=True)
    p=sub.add_parser('freeze');p.add_argument('--selection',required=True);p.add_argument('--output',required=True)
    p=sub.add_parser('revise');p.add_argument('--frozen',required=True);p.add_argument('--expected-digest',required=True)
    p.add_argument('--output',required=True);p.add_argument('--viewer',required=True)
    a=parser.parse_args()
    result=freeze(a.selection,a.output) if a.action=='freeze' else revise(a.frozen,a.expected_digest,a.output,a.viewer)
    print(json.dumps(result,ensure_ascii=True,indent=2))
