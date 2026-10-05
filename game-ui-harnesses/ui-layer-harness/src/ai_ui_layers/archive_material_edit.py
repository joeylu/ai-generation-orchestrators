"""Archive-bound single-use native edit exchange; never invokes a model/tool."""
import hashlib
import json
from pathlib import Path
import shutil
import zipfile
from PIL import Image
from .evaluate import read, save, digest
from .layer_package import validate_archive, composite


def _hash(value):
    return hashlib.sha256(json.dumps(value,sort_keys=True,separators=(',', ':'),
        ensure_ascii=False,allow_nan=False).encode()).hexdigest()


def _png(path):
    with Image.open(path) as image:
        image.load()
        if image.format != 'PNG' or image.getexif().get(274,1) != 1:
            raise ValueError('NATIVE_ORIENTED_PNG_REQUIRED')
        return list(image.size)


def _native_alpha(path, role):
    with Image.open(path) as image:
        alpha=image.convert('RGBA').getchannel('A')
        if role=='background':
            if alpha.getextrema()!=(255,255):raise ValueError('EDIT_BACKGROUND_OPAQUE_REQUIRED')
        elif image.mode!='RGBA' or alpha.getextrema()[0]!=0 or not alpha.getbbox():
            raise ValueError('EDIT_NATIVE_TRANSPARENT_ALPHA_REQUIRED')


def freeze(source_archive, layer_id, output, *, purpose, owned, delete, reference_region=None,
           geometry_intent=None):
    archive=Path(source_archive).resolve();job=Path(output).resolve()
    validate_archive(archive)
    if geometry_intent is not None and geometry_intent!='reference-visible-structure':
        raise ValueError('EDIT_GEOMETRY_INTENT_INVALID')
    if not isinstance(purpose,str) or not purpose.strip():raise ValueError('EDIT_PURPOSE_REQUIRED')
    for values in (owned,delete):
        if not isinstance(values,list) or not values or any(not isinstance(v,str) or not v.strip() for v in values):
            raise ValueError('EXPLICIT_OWNED_AND_DELETE_REQUIRED')
    if job.exists():raise ValueError('FRESH_EDIT_JOB_REQUIRED')
    with zipfile.ZipFile(archive) as z:
        composition=json.loads(z.read('composition.json'))
        matches=[row for row in composition['layers'] if row['id']==layer_id]
        if len(matches)!=1:raise ValueError('KNOWN_ARCHIVE_LAYER_REQUIRED')
        layer=matches[0];job.mkdir(parents=True);package=job/'source-package';package.mkdir()
        for name in z.namelist():
            path=package/name;path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(z.read(name))
    composite(package,composition)
    shutil.copyfile(package/layer['path'],job/'source.png')
    shutil.copyfile(package/'reference.png',job/'reference.png')
    size=_png(job/'reference.png');_png(job/'source.png')
    if size != [composition['canvas']['width'],composition['canvas']['height']]:
        raise ValueError('REFERENCE_CANVAS_MISMATCH')
    if reference_region is not None:
        if (not isinstance(reference_region,list) or len(reference_region)!=4 or
            any(type(v) is not int for v in reference_region) or
            not 0<=reference_region[0]<reference_region[2]<=size[0] or
            not 0<=reference_region[1]<reference_region[3]<=size[1]):
            raise ValueError('REFERENCE_REGION_INVALID')
        with Image.open(job/'reference.png') as image:image.crop(reference_region).save(job/'reference-crop.png')
    args=dict(purpose=purpose,owned=list(owned),delete=list(delete),referenceRegion=reference_region)
    if geometry_intent is not None:args['geometryIntent']=geometry_intent
    save(job/'arguments.json',args)
    prompt=('Edit only the actual source.png material using the original reference.png'+
        (' and reference-crop.png' if reference_region is not None else '')+' as visual evidence.\n'+
        'Purpose: '+purpose+'\nPreserve ONLY these owned surfaces/details: '+json.dumps(owned,ensure_ascii=False)+
        '\nDELETE each listed child and its entire decoration/frame, including empty frames: '+json.dumps(delete,ensure_ascii=False)+
        '\nRecover the underlying owned surface naturally where deleted children occupied it. '+
        'Preserve the owned outer silhouette, texture, lighting and native '+
        ('fully opaque background pixels. Return one genuine native opaque PNG with the complete background '+
         f'at original reference aspect ratio {size[0]}:{size[1]} ({size[0]} by {size[1]} pixels). '
         if layer['role']=='background' else
         'continuous transparent alpha. Return one genuine native transparent PNG with the complete owned material. ')+
        'Do not alpha-crop, fit to an ownership rectangle, redraw geometry programmatically, '+
        'leave placeholder frames, add children, or use a recomposed preview as reference.\n')
    if geometry_intent=='reference-visible-structure':
        prompt=('Geometry intent: reference-visible-structure.\n'+
            ('Image 1 is reference-crop.png, the primary visible structure target. Image 2 is the full '+
             'original reference.png, providing placement and clipping context. Image 3 is source.png, '+
             'only owned texture/detail evidence, never the primary geometry or aspect-ratio target.\n'
             if reference_region is not None else
             'Image 1 is the full original reference.png, the primary visible structure target and placement '+
             'and clipping context. Image 2 is source.png, only owned texture/detail evidence, never the '+
             'primary geometry or aspect-ratio target.\n')+
            'Edit the actual source.png material using the full original reference.png'+
            (' and its reference-crop.png local detail' if reference_region is not None else '')+
            ' as the authority for visible structure. The full original reference determines the visible '+
            'native body silhouette, proportions and internal relative layout; the local crop supplies detail '+
            'in that full-reference context. source.png supplies ONLY owned texture and detail material evidence. '+
            'Replace any confirmed incorrect old silhouette or proportions with the reference-visible structure.\n'+
            'Purpose: '+purpose+'\nRetain ONLY these owned surfaces/details: '+json.dumps(owned,ensure_ascii=False)+
            '\nDELETE each listed child and its entire decoration/frame, including empty frames: '+json.dumps(delete,ensure_ascii=False)+
            '\nRecover the underlying owned surface naturally where deleted children occupied it. '+
            'Do not bake deleted children into the body texture or shadow. Reproduce only the actually visible '+
            'fragment and true original-canvas clipping boundary when the reference cuts off an object. '+
            'Do not infer hidden boundaries or extend the object beyond what the original reference shows. '+
            'An ownership/sourceRegion rectangle is not the body silhouette or a required bounding rectangle. '+
            ('Keep the background fully opaque and preserve the positions of visible physical scene objects. '+
             'Return one genuine native opaque PNG with the complete visible background at original reference '+
             f'aspect ratio {size[0]}:{size[1]} ({size[0]} by {size[1]} pixels). '
             if layer['role']=='background' else
             'Separate the native visible body, its reference-supported soft shadow/glow, and transparent canvas. '+
             'Outside the body retain only the real soft light visible in the reference; produce no isolated '+
             'fragments or unrelated halos. All remaining canvas must have alpha exactly zero. Preserve continuous '+
             'natural alpha at edges and in real soft light; do not erase faint alpha. Return one genuine native '+
             'transparent PNG with the complete reference-visible owned material. ')+
            'Do not alpha-crop, force rectangular registration, fit or deform to an ownership rectangle, '+
            'hand-draw or redraw geometry programmatically, hand-edit masks, leave placeholder frames, add children, '+
            'or use a recomposed preview as reference.\n')
    (job/'prompt.md').write_text(prompt,encoding='utf-8')
    referenced=[str(job/'source.png'),str(job/'reference.png')]
    if reference_region is not None:referenced.append(str(job/'reference-crop.png'))
    if geometry_intent=='reference-visible-structure':
        referenced=([str(job/'reference-crop.png')] if reference_region is not None else [])+[
            str(job/'reference.png'),str(job/'source.png')]
    save(job/'image-gen-arguments.json',dict(prompt=prompt,referenced_image_paths=referenced,
                                          transparent_background=layer['role']!='background'))
    save(job/'schema.json',dict(kind='ui_native_material_edit_return_v1',required=[
        'submissionDigest','returnedSha256','hostObservedNativeReturn','notCryptographicallyProviderVerified'],
        returnedFormat='PNG',nativeAlphaRequired=layer['role']!='background',
        alphaPolicy='fully-opaque' if layer['role']=='background' else 'native-continuous-transparent'))
    files={p.relative_to(job).as_posix():digest(p) for p in sorted(job.rglob('*')) if p.is_file()}
    request=dict(kind='ui_archive_material_edit_request_v1',sourceArchive=str(archive),
        sourceArchiveSha256=digest(archive),layerId=layer_id,originalLayer=layer,args=args,
        sourceSha256=digest(job/'source.png'),referenceSha256=digest(job/'reference.png'),
        files=files,maximumCalls=1,automaticRetry=False,humanVisualAcceptance=False,
        strictBodyRegistrationPassed=False,originalDagPromoted=False)
    if geometry_intent is not None:request['geometryIntent']=geometry_intent
    request['digest']=_hash(request);save(job/'request.json',request)
    save(job/'preparation.json',dict(requestSha256=digest(job/'request.json')))
    return dict(status='frozen_awaiting_compute_authorization',digest=request['digest'],generationCalls=0)


def verify_frozen(job):
    job=Path(job).resolve();request=read(job/'request.json')
    body={k:v for k,v in request.items() if k!='digest'}
    if (request.get('kind')!='ui_archive_material_edit_request_v1' or _hash(body)!=request['digest'] or
        read(job/'preparation.json')['requestSha256']!=digest(job/'request.json')):
        raise ValueError('EDIT_REQUEST_CHANGED')
    for name,sha in request['files'].items():
        path=(job/name).resolve()
        if not path.is_relative_to(job) or digest(path)!=sha:raise ValueError('EDIT_FROZEN_INPUT_CHANGED')
    if 'geometryIntent' in request or 'geometryIntent' in request['args']:
        if (request.get('geometryIntent')!='reference-visible-structure' or
            request['args'].get('geometryIntent')!=request['geometryIntent'] or
            read(job/'arguments.json')!=request['args'] or
            not (job/'prompt.md').read_text(encoding='utf-8').startswith(
                'Geometry intent: reference-visible-structure.\n')):
            raise ValueError('EDIT_GEOMETRY_INTENT_CHANGED')
    archive=Path(request['sourceArchive']);validate_archive(archive)
    if digest(archive)!=request['sourceArchiveSha256']:raise ValueError('EDIT_SOURCE_ARCHIVE_CHANGED')
    with zipfile.ZipFile(archive) as z:
        for name in z.namelist():
            if (job/'source-package'/name).read_bytes()!=z.read(name):raise ValueError('EDIT_SOURCE_PACKAGE_CHANGED')
        layers=json.loads(z.read('composition.json'))['layers']
        matches=[row for row in layers if row['id']==request['layerId']]
        if len(matches)!=1 or matches[0]!=request['originalLayer']:raise ValueError('EDIT_LAYER_CHANGED')
        if ((job/'source.png').read_bytes()!=z.read(matches[0]['path']) or
            (job/'reference.png').read_bytes()!=z.read('reference.png')):raise ValueError('EDIT_SOURCE_BINDING_CHANGED')
    return request


def authorize(job, digest_value, actual_user_instruction):
    job=Path(job).resolve();request=verify_frozen(job)
    if request['digest']!=digest_value:raise ValueError('EDIT_AUTHORIZATION_DIGEST_MISMATCH')
    if not isinstance(actual_user_instruction,str) or not actual_user_instruction.strip():
        raise ValueError('ACTUAL_USER_INSTRUCTION_REQUIRED')
    authorization=dict(kind='ui_archive_material_edit_authorization_v1',requestDigest=digest_value,
        requestSha256=digest(job/'request.json'),actualUserInstruction=actual_user_instruction,maximumCalls=1)
    save(job/'authorization.json',authorization)
    return dict(status='authorized_one_native_edit',requestDigest=digest_value,
                authorizationDigest=digest(job/'authorization.json'))


def frozen_arguments(job):
    job=Path(job).resolve();request=verify_frozen(job)
    arguments=read(job/'image-gen-arguments.json')
    references=[str(job/'source.png'),str(job/'reference.png')]
    if request['args']['referenceRegion'] is not None:references.append(str(job/'reference-crop.png'))
    if request.get('geometryIntent')=='reference-visible-structure':
        references=([str(job/'reference-crop.png')] if request['args']['referenceRegion'] is not None else [])+[
            str(job/'reference.png'),str(job/'source.png')]
    expected=dict(prompt=(job/'prompt.md').read_text(encoding='utf-8'),referenced_image_paths=references,
                  transparent_background=request['originalLayer']['role']!='background')
    if arguments!=expected:raise ValueError('EDIT_FROZEN_IMAGE_ARGUMENTS_CHANGED')
    return arguments


def next_request(job):
    job=Path(job).resolve();request=verify_frozen(job);authorization=read(job/'authorization.json')
    if (authorization.get('requestDigest')!=request['digest'] or
        authorization.get('requestSha256')!=digest(job/'request.json') or authorization.get('maximumCalls')!=1):
        raise ValueError('EDIT_AUTHORIZATION_CHANGED')
    submission=dict(kind='ui_archive_material_edit_submission_v1',requestDigest=request['digest'],
        requestSha256=digest(job/'request.json'),authorizationSha256=digest(job/'authorization.json'),
        status='awaiting_result_no_resubmit',automaticRetry=False)
    submission['digest']=_hash(submission);save(job/'submission.json',submission)
    return dict(submissionDigest=submission['digest'],status=submission['status'],
        sourcePath=str(job/'source.png'),referencePath=str(job/'reference.png'),
        prompt=(job/'prompt.md').read_text(encoding='utf-8'),arguments=frozen_arguments(job))


def receive(job, submission_digest, actual_returned_path, native_tool_evidence):
    job=Path(job).resolve();request=verify_frozen(job);submission=read(job/'submission.json')
    if (submission.get('digest')!=submission_digest or
        _hash({k:v for k,v in submission.items() if k!='digest'})!=submission_digest or
        submission.get('requestDigest')!=request['digest'] or
        submission.get('requestSha256')!=digest(job/'request.json') or
        submission.get('authorizationSha256')!=digest(job/'authorization.json')):
        raise ValueError('EDIT_SUBMISSION_DIGEST_MISMATCH')
    with (job/'receive.lock').open('x',encoding='utf-8') as reservation:reservation.write('terminal native return reservation\n')
    returned=Path(actual_returned_path).resolve();evidence=Path(native_tool_evidence).resolve()
    evidence_doc=read(evidence)
    expected=dict(kind='ui_native_material_edit_return_v1',submissionDigest=submission_digest,
        returnedSha256=digest(returned),hostObservedNativeReturn=True,notCryptographicallyProviderVerified=True)
    if evidence_doc!=expected:raise ValueError('EDIT_NATIVE_RETURN_EVIDENCE_MISMATCH')
    size=_png(returned)
    _native_alpha(returned,request['originalLayer']['role'])
    shutil.copyfile(returned,job/'raw.png');shutil.copyfile(evidence,job/'native-evidence.json')
    receipt=dict(kind='ui_host_observed_native_edit_receipt_v1',layerId=request['layerId'],
        requestSha256=digest(job/'request.json'),authorizationSha256=digest(job/'authorization.json'),
        submissionDigest=submission_digest,submissionSha256=digest(job/'submission.json'),
        rawSha256=digest(job/'raw.png'),size=size,nativeEvidenceSha256=digest(job/'native-evidence.json'),
        actualReturnedPath=str(returned),notProviderReceipt=True,notCryptographicallyProviderVerified=True,
        humanVisualAcceptance=False,strictBodyRegistrationPassed=False,originalDagPromoted=False)
    save(job/'received.json',receipt)
    return dict(status='native_return_received_pending_geometry',rawSha256=receipt['rawSha256'])


def verify_received(job):
    job=Path(job).resolve();request=verify_frozen(job);authorization=read(job/'authorization.json')
    submission=read(job/'submission.json');receipt=read(job/'received.json');evidence=read(job/'native-evidence.json')
    if (authorization.get('requestDigest')!=request['digest'] or
        authorization.get('requestSha256')!=digest(job/'request.json') or
        authorization.get('maximumCalls')!=1 or not authorization.get('actualUserInstruction') or
        _hash({k:v for k,v in submission.items() if k!='digest'})!=submission.get('digest') or
        submission.get('requestDigest')!=request['digest'] or
        submission.get('authorizationSha256')!=digest(job/'authorization.json') or
        submission.get('requestSha256')!=digest(job/'request.json') or
        submission.get('status')!='awaiting_result_no_resubmit'):
        raise ValueError('EDIT_AUTHORIZATION_SUBMISSION_CHAIN_CHANGED')
    expected=dict(kind='ui_host_observed_native_edit_receipt_v1',layerId=request['layerId'],
        requestSha256=digest(job/'request.json'),authorizationSha256=digest(job/'authorization.json'),
        submissionDigest=submission['digest'],submissionSha256=digest(job/'submission.json'),
        rawSha256=digest(job/'raw.png'),size=_png(job/'raw.png'),nativeEvidenceSha256=digest(job/'native-evidence.json'),
        actualReturnedPath=receipt.get('actualReturnedPath'),notProviderReceipt=True,
        notCryptographicallyProviderVerified=True,humanVisualAcceptance=False,
        strictBodyRegistrationPassed=False,originalDagPromoted=False)
    if (receipt!=expected or not (job/'receive.lock').is_file() or evidence!=dict(
        kind='ui_native_material_edit_return_v1',submissionDigest=submission['digest'],
        returnedSha256=expected['rawSha256'],hostObservedNativeReturn=True,notCryptographicallyProviderVerified=True)):
        raise ValueError('EDIT_NATIVE_RECEIPT_CHAIN_CHANGED')
    _native_alpha(job/'raw.png',request['originalLayer']['role'])
    binding=dict(sourceArchiveSha256=request['sourceArchiveSha256'],layerId=request['layerId'],
        requestSha256=digest(job/'request.json'),authorizationSha256=digest(job/'authorization.json'),
        submissionDigest=submission['digest'],rawSha256=receipt['rawSha256'],
        nativeEvidenceSha256=receipt['nativeEvidenceSha256'],receiptSha256=digest(job/'received.json'))
    return dict(layerId=request['layerId'],rawPath=job/'raw.png',referencePath=job/'reference.png',binding=binding)
