"""Offline native foreground component extraction and original geometry evidence."""
import hashlib
import io
import json
from pathlib import Path
import re
import shutil
import tempfile
import zipfile

from PIL import Image
from .evaluate import read, save, digest
from .layer_package import validate_archive
from .archive_material_edit import _png, _native_alpha
from . import host_geometry_observation as geo

POLICY='reference-only-owned-component-extraction-v1'
OBSERVATION_POLICY='host-observed-component-geometry-candidate-v1'
FLAGS=dict(humanVisualAcceptance=False,strictBodyRegistrationPassed=False,originalDagPromoted=False)


def _hash(value):
    return hashlib.sha256(json.dumps(value,sort_keys=True,separators=(',', ':'),
        ensure_ascii=False,allow_nan=False).encode()).hexdigest()


def _id(value):
    if not isinstance(value,str) or re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_-]{0,127}',value) is None:
        raise ValueError('COMPONENT_SAFE_ID_REQUIRED')


def load_archive(path):
    """Return verified world storage and authentic original reference separately."""
    path=Path(path).resolve()
    with zipfile.ZipFile(path) as z:
        wrapper='world-ui-layers.zip' in z.namelist()
    if wrapper:
        from .viewport_geometry_revision import validate_viewport_archive
        validate_viewport_archive(path)
        with zipfile.ZipFile(path) as z:
            inner=z.read('world-ui-layers.zip');reference=z.read('original-reference.png')
            viewport=json.loads(z.read('viewport.json'))
        with tempfile.TemporaryDirectory(prefix='component-inner-') as temporary:
            inner_path=Path(temporary)/'inner.zip';inner_path.write_bytes(inner);validate_archive(inner_path)
        shift=viewport['worldShift'];size=viewport['originalSize']
    else:
        validate_archive(path);inner=path.read_bytes();shift=[0,0]
        with zipfile.ZipFile(io.BytesIO(inner)) as z:reference=z.read('reference.png')
        with Image.open(io.BytesIO(reference)) as image:size=list(image.size)
    with zipfile.ZipFile(io.BytesIO(inner)) as z:files={n:z.read(n) for n in z.namelist()}
    with Image.open(io.BytesIO(reference)) as image:
        if image.format!='PNG' or image.getexif().get(274,1)!=1 or list(image.size)!=size:
            raise ValueError('COMPONENT_ORIGINAL_REFERENCE_REQUIRED')
    composition=json.loads(files['composition.json'])
    if not wrapper and size!=[composition['canvas']['width'],composition['canvas']['height']]:
        raise ValueError('COMPONENT_REFERENCE_CANVAS_MISMATCH')
    return dict(sourceArchiveSha256=digest(path),innerArchiveSha256=hashlib.sha256(inner).hexdigest(),
        composition=composition,files=files,referenceBytes=reference,
        originalSize=size,worldShift=shift)


def _references(job,component):
    return ([str(job/'reference-crop.png')] if component['referenceRegion'] is not None else [])+[
        str(job/'reference.png')]


def freeze(source_archive,parent_layer_id,component_id,output,*,name,purpose,owned,delete,reference_region):
    archive=Path(source_archive).resolve();job=Path(output).resolve();loaded=load_archive(archive)
    _id(parent_layer_id);_id(component_id)
    layers={r['id']:r for r in loaded['composition']['layers']}
    if parent_layer_id not in layers:raise ValueError('COMPONENT_KNOWN_PARENT_REQUIRED')
    if component_id in layers:raise ValueError('COMPONENT_NEW_UNIQUE_ID_REQUIRED')
    if any(not isinstance(v,str) or not v.strip() for v in (name,purpose)):
        raise ValueError('COMPONENT_NAME_PURPOSE_REQUIRED')
    for values in (owned,delete):
        if not isinstance(values,list) or not values or any(not isinstance(v,str) or not v.strip() for v in values):
            raise ValueError('COMPONENT_EXPLICIT_OWNED_DELETE_REQUIRED')
    w,h=loaded['originalSize']
    if reference_region is not None and (not isinstance(reference_region,list) or len(reference_region)!=4 or
        any(type(v) is not int for v in reference_region) or
        not 0<=reference_region[0]<reference_region[2]<=w or not 0<=reference_region[1]<reference_region[3]<=h):
        raise ValueError('COMPONENT_REFERENCE_REGION_INVALID')
    if job.exists():raise ValueError('COMPONENT_FRESH_JOB_REQUIRED')
    component=dict(name=name,role='foreground',referenceRegion=reference_region,owned=list(owned),delete=list(delete),purpose=purpose)
    job.mkdir(parents=True)
    for n,data in loaded['files'].items():
        p=job/'source-package'/n;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(data)
    (job/'parent.png').write_bytes(loaded['files'][layers[parent_layer_id]['path']])
    (job/'reference.png').write_bytes(loaded['referenceBytes']);_png(job/'parent.png');_png(job/'reference.png')
    if reference_region is not None:
        with Image.open(job/'reference.png') as image:image.crop(reference_region).save(job/'reference-crop.png')
    prompt=('Input policy: '+POLICY+'.\nExtract one independent foreground component from ONLY the original '+
        ('reference-crop.png (Image 1) and full original reference.png (Image 2).' if reference_region is not None else
         'reference.png (Image 1).')+' No old parent PNG is supplied to the image tool.\n'+
        'Component ID: '+component_id+'; parent provenance ID: '+parent_layer_id+'; name: '+name+
        '\nPurpose: '+purpose+'\nOwned surfaces/details: '+json.dumps(owned,ensure_ascii=False)+
        '\nExclude these complete children/frames/contents: '+json.dumps(delete,ensure_ascii=False)+
        '\nThe original visible component silhouette, proportions and internal relative layout are the sole '+
        'geometry target. Preserve exact lettering and decorative text explicitly retained by purpose/owned; '+
        'do not inherit removal instructions from historical labels. Do not bake excluded child frames into '+
        'this component. Parent bounds and reference crop are context, never the component body rectangle. '+
        'Reproduce only visible fragments and true original-canvas clipping; do not infer hidden edges. '+
        'Separate native component body, genuine reference soft shadow/glow and transparent canvas. Retain '+
        'continuous natural alpha and genuine faint soft light; remaining canvas must have alpha zero. '+
        'No unrelated halos or isolated fragments. Return one genuine native transparent RGBA PNG. '+
        'Do not alpha-crop, erase faint alpha, fit/deform to a rectangle, hand-draw geometry, hand-edit masks '+
        'or use a recomposed preview.\n')
    save(job/'arguments.json',dict(parentLayerId=parent_layer_id,componentId=component_id,inputPolicy=POLICY,component=component))
    (job/'prompt.md').write_text(prompt,encoding='utf-8')
    save(job/'image-gen-arguments.json',dict(prompt=prompt,referenced_image_paths=_references(job,component),transparent_background=True))
    save(job/'schema.json',dict(kind='ui_native_component_return_v1',nativeAlphaRequired=True,returnedFormat='PNG'))
    request=dict(kind='ui_archive_component_request_v1',sourceArchive=str(archive),
        sourceArchiveSha256=loaded['sourceArchiveSha256'],innerArchiveSha256=loaded['innerArchiveSha256'],
        parentLayerId=parent_layer_id,componentId=component_id,parentLayer=layers[parent_layer_id],component=component,
        parentSha256=digest(job/'parent.png'),referenceSha256=digest(job/'reference.png'),
        originalSize=loaded['originalSize'],worldShift=loaded['worldShift'],inputPolicy=POLICY,
        maximumCalls=1,automaticRetry=False,files={p.relative_to(job).as_posix():digest(p)
            for p in sorted(job.rglob('*')) if p.is_file()},**FLAGS)
    request['digest']=_hash(request);save(job/'request.json',request)
    save(job/'preparation.json',dict(requestSha256=digest(job/'request.json')))
    return dict(status='frozen_awaiting_compute_authorization',digest=request['digest'],generationCalls=0)


def verify_frozen(job):
    job=Path(job).resolve();r=read(job/'request.json')
    if (r.get('kind')!='ui_archive_component_request_v1' or r.get('inputPolicy')!=POLICY or
        r.get('maximumCalls')!=1 or r.get('automaticRetry') is not False or
        any(r.get(k) is not False for k in FLAGS) or
        _hash({k:v for k,v in r.items() if k!='digest'})!=r.get('digest') or
        read(job/'preparation.json')['requestSha256']!=digest(job/'request.json')):
        raise ValueError('COMPONENT_REQUEST_CHANGED')
    for n,s in r['files'].items():
        p=(job/n).resolve()
        if not p.is_relative_to(job) or digest(p)!=s:raise ValueError('COMPONENT_FROZEN_INPUT_CHANGED')
    loaded=load_archive(r['sourceArchive']);layers={l['id']:l for l in loaded['composition']['layers']}
    if r['component'].get('role')!='foreground':raise ValueError('COMPONENT_FOREGROUND_REQUIRED')
    _id(r['componentId']);_id(r['parentLayerId'])
    if (loaded['sourceArchiveSha256']!=r['sourceArchiveSha256'] or loaded['innerArchiveSha256']!=r['innerArchiveSha256'] or
        layers.get(r['parentLayerId'])!=r['parentLayer'] or r['componentId'] in layers or
        loaded['originalSize']!=r['originalSize'] or loaded['worldShift']!=r['worldShift']):
        raise ValueError('COMPONENT_ARCHIVE_PARENT_CHANGED')
    for n,data in loaded['files'].items():
        if (job/'source-package'/n).read_bytes()!=data:raise ValueError('COMPONENT_SOURCE_PACKAGE_CHANGED')
    if ((job/'parent.png').read_bytes()!=loaded['files'][r['parentLayer']['path']] or
        (job/'reference.png').read_bytes()!=loaded['referenceBytes'] or
        digest(job/'parent.png')!=r['parentSha256'] or digest(job/'reference.png')!=r['referenceSha256']):
        raise ValueError('COMPONENT_SOURCE_REFERENCE_CHANGED')
    expected=dict(parentLayerId=r['parentLayerId'],componentId=r['componentId'],inputPolicy=POLICY,component=r['component'])
    native=dict(prompt=(job/'prompt.md').read_text('utf-8'),referenced_image_paths=_references(job,r['component']),transparent_background=True)
    if read(job/'arguments.json')!=expected or read(job/'image-gen-arguments.json')!=native:
        raise ValueError('COMPONENT_ARGUMENTS_CHANGED')
    return r


def frozen_arguments(job):
    job=Path(job).resolve();verify_frozen(job);return read(job/'image-gen-arguments.json')


def authorize(job,digest_value,actual_user_instruction):
    job=Path(job).resolve();r=verify_frozen(job)
    if r['digest']!=digest_value:raise ValueError('COMPONENT_AUTHORIZATION_DIGEST_MISMATCH')
    if not isinstance(actual_user_instruction,str) or not actual_user_instruction.strip():
        raise ValueError('ACTUAL_USER_INSTRUCTION_REQUIRED')
    save(job/'authorization.json',dict(kind='ui_component_authorization_v1',requestDigest=digest_value,
        requestSha256=digest(job/'request.json'),actualUserInstruction=actual_user_instruction,maximumCalls=1))
    save(job/'authorization-binding.json',dict(kind='ui_component_authorization_binding_v1',
        requestDigest=digest_value,requestSha256=digest(job/'request.json'),
        authorizationSha256=digest(job/'authorization.json'),parentLayerId=r['parentLayerId'],componentId=r['componentId']))
    return dict(status='authorized_one_native_component',requestDigest=digest_value,authorizationDigest=digest(job/'authorization.json'))


def _authorization(job,r):
    a=read(job/'authorization.json')
    expected_binding=dict(kind='ui_component_authorization_binding_v1',requestDigest=r['digest'],
        requestSha256=digest(job/'request.json'),authorizationSha256=digest(job/'authorization.json'),
        parentLayerId=r['parentLayerId'],componentId=r['componentId'])
    if (a.get('kind')!='ui_component_authorization_v1' or a.get('requestDigest')!=r['digest'] or
        a.get('requestSha256')!=digest(job/'request.json') or a.get('maximumCalls')!=1 or
        read(job/'authorization-binding.json')!=expected_binding or
        not isinstance(a.get('actualUserInstruction'),str) or not a['actualUserInstruction'].strip()):
        raise ValueError('COMPONENT_AUTHORIZATION_CHANGED')


def next_request(job):
    job=Path(job).resolve();r=verify_frozen(job);_authorization(job,r)
    submission=dict(kind='ui_component_submission_v1',requestDigest=r['digest'],requestSha256=digest(job/'request.json'),
        authorizationSha256=digest(job/'authorization.json'),parentLayerId=r['parentLayerId'],componentId=r['componentId'],
        status='awaiting_result_no_resubmit',automaticRetry=False)
    submission['digest']=_hash(submission);save(job/'submission.json',submission)
    return dict(submissionDigest=submission['digest'],status=submission['status'],referencePath=str(job/'reference.png'),
        parentPath=str(job/'parent.png'),prompt=(job/'prompt.md').read_text('utf-8'),arguments=frozen_arguments(job))


def _submission(job,r):
    _authorization(job,r);s=read(job/'submission.json')
    expected=dict(kind='ui_component_submission_v1',requestDigest=r['digest'],requestSha256=digest(job/'request.json'),
        authorizationSha256=digest(job/'authorization.json'),parentLayerId=r['parentLayerId'],componentId=r['componentId'],
        status='awaiting_result_no_resubmit',automaticRetry=False)
    if s!={**expected,'digest':_hash(expected)}:raise ValueError('COMPONENT_SUBMISSION_CHANGED')
    return s


def _evidence(r,s,raw):
    return dict(kind='ui_native_component_return_v1',submissionDigest=s['digest'],parentLayerId=r['parentLayerId'],
        componentId=r['componentId'],referenceSha256=r['referenceSha256'],returnedSha256=digest(raw),
        hostObservedNativeReturn=True,notCryptographicallyProviderVerified=True)


def _receipt(job,r,s,path):
    return dict(kind='ui_host_observed_component_receipt_v1',parentLayerId=r['parentLayerId'],componentId=r['componentId'],
        sourceArchiveSha256=r['sourceArchiveSha256'],innerArchiveSha256=r['innerArchiveSha256'],referenceSha256=r['referenceSha256'],
        requestSha256=digest(job/'request.json'),authorizationSha256=digest(job/'authorization.json'),
        submissionDigest=s['digest'],submissionSha256=digest(job/'submission.json'),rawSha256=digest(job/'raw.png'),
        nativeEvidenceSha256=digest(job/'native-evidence.json'),size=_png(job/'raw.png'),actualReturnedPath=path,
        notProviderReceipt=True,notCryptographicallyProviderVerified=True,**FLAGS)


def receive(job,submission_digest,actual_returned_path,native_tool_evidence):
    job=Path(job).resolve();r=verify_frozen(job);s=_submission(job,r)
    if submission_digest!=s['digest']:raise ValueError('COMPONENT_SUBMISSION_DIGEST_MISMATCH')
    with (job/'receive.lock').open('x',encoding='utf-8') as f:f.write('terminal native component return\n')
    raw=Path(actual_returned_path).resolve();evidence=Path(native_tool_evidence).resolve()
    if read(evidence)!=_evidence(r,s,raw):raise ValueError('COMPONENT_NATIVE_EVIDENCE_MISMATCH')
    _png(raw);_native_alpha(raw,'foreground')
    shutil.copyfile(raw,job/'raw.png');shutil.copyfile(evidence,job/'native-evidence.json')
    save(job/'received.json',_receipt(job,r,s,str(raw)))
    return dict(status='native_component_received_pending_geometry',rawSha256=digest(job/'raw.png'))


def verify_received(job):
    job=Path(job).resolve();r=verify_frozen(job);s=_submission(job,r);receipt=read(job/'received.json')
    if (not (job/'receive.lock').is_file() or receipt!=_receipt(job,r,s,receipt.get('actualReturnedPath')) or
        read(job/'native-evidence.json')!=_evidence(r,s,job/'raw.png')):
        raise ValueError('COMPONENT_RECEIPT_CHANGED')
    _native_alpha(job/'raw.png','foreground')
    binding={k:receipt[k] for k in ('sourceArchiveSha256','innerArchiveSha256','parentLayerId','componentId',
        'referenceSha256','requestSha256','authorizationSha256','submissionDigest','rawSha256','nativeEvidenceSha256')}
    binding['receiptSha256']=digest(job/'received.json')
    return dict(layerId=r['componentId'],parentLayerId=r['parentLayerId'],rawPath=job/'raw.png',
        referencePath=job/'reference.png',binding=binding,component=r['component'])


OBSERVATION_PROMPT=geo.PROMPT.replace('The originalLayer/sourceRegion describes ownership and placement, never a body box.',
    'Observe the component-owned target described by component/scope. Parent identity and bounds are provenance, '+
    'never the component body or its target geometry. Original reference coordinates exclude worldShift. '+
    'Judge only this child, preserving its explicitly owned lettering/details; do not measure the whole parent.')


def prepare_observation(job,output):
    job=Path(job).resolve();item=Path(output).resolve();v=verify_received(job);r=verify_frozen(job)
    if item.exists() or item.is_relative_to(job) or job.is_relative_to(item):
        raise ValueError('COMPONENT_FRESH_OBSERVATION_REQUIRED')
    item.mkdir(parents=True);shutil.copyfile(v['rawPath'],item/'source.png');shutil.copyfile(v['referencePath'],item/'reference.png')
    save(item/'schema.json',geo.schema());(item/'prompt.md').write_text(OBSERVATION_PROMPT,encoding='utf-8')
    inputs={n:digest(item/n) for n in ('source.png','reference.png','schema.json','prompt.md')}
    scope=dict(kind='ui_component_owned_target_v1',componentId=v['layerId'],parentLayerId=v['parentLayerId'],
        referenceRegion=v['component']['referenceRegion'],parentBoundsAreNotBody=True)
    request=dict(kind='ui_host_component_geometry_request_v1',policy=OBSERVATION_POLICY,editJobPath=str(job),
        layerId=v['layerId'],componentId=v['layerId'],parentLayerId=v['parentLayerId'],
        sourceArchiveSha256=r['sourceArchiveSha256'],innerArchiveSha256=r['innerArchiveSha256'],
        parentSha256=r['parentSha256'],
        sourceSha256=inputs['source.png'],referenceSha256=inputs['reference.png'],sourceSize=_png(item/'source.png'),
        referenceSize=_png(item/'reference.png'),inputs=inputs,inputsSha256=_hash(inputs),
        component=v['component'],scope=scope,editBinding=v['binding'],modelCallsMaximum=1,automaticRetry=False,**FLAGS)
    save(item/'request.json',request);save(item/'preparation.json',dict(requestSha256=digest(item/'request.json')))
    return dict(status='awaiting_host_component_geometry_observation',directory=str(item),requestSha256=digest(item/'request.json'),generationCalls=0)


def _verify_observation_prepared(item):
    r=read(item/'request.json')
    if (digest(item/'request.json')!=read(item/'preparation.json')['requestSha256'] or
        r.get('kind')!='ui_host_component_geometry_request_v1' or r.get('policy')!=OBSERVATION_POLICY or
        any(r.get(k) is not False for k in FLAGS) or
        r.get('modelCallsMaximum')!=1 or r.get('automaticRetry') is not False):
        raise ValueError('COMPONENT_OBSERVATION_REQUEST_CHANGED')
    v=verify_received(r['editJobPath'])
    edit_request=verify_frozen(r['editJobPath'])
    inputs={n:digest(item/n) for n in ('source.png','reference.png','schema.json','prompt.md')}
    expected_scope=dict(kind='ui_component_owned_target_v1',componentId=v['layerId'],parentLayerId=v['parentLayerId'],
        referenceRegion=v['component']['referenceRegion'],parentBoundsAreNotBody=True)
    if (r['layerId']!=v['layerId'] or r['componentId']!=v['layerId'] or r['parentLayerId']!=v['parentLayerId'] or
        r['component']!=v['component'] or r['editBinding']!=v['binding'] or r['scope']!=expected_scope or
        r['sourceArchiveSha256']!=v['binding']['sourceArchiveSha256'] or
        r['innerArchiveSha256']!=v['binding']['innerArchiveSha256'] or
        r['parentSha256']!=edit_request['parentSha256'] or
        r['inputs']!=inputs or r['inputsSha256']!=_hash(inputs) or r['sourceSha256']!=inputs['source.png'] or
        r['referenceSha256']!=inputs['reference.png'] or r['sourceSha256']!=v['binding']['rawSha256'] or
        r['referenceSha256']!=v['binding']['referenceSha256'] or
        (item/'source.png').read_bytes()!=v['rawPath'].read_bytes() or
        (item/'reference.png').read_bytes()!=v['referencePath'].read_bytes() or
        read(item/'schema.json')!=geo.schema() or (item/'prompt.md').read_text('utf-8')!=OBSERVATION_PROMPT):
        raise ValueError('COMPONENT_OBSERVATION_BINDING_CHANGED')
    if _png(item/'source.png')!=r['sourceSize'] or _png(item/'reference.png')!=r['referenceSize']:
        raise ValueError('COMPONENT_OBSERVATION_SIZE_CHANGED')
    return r


def receive_observation(item,response,*,host_attestation_path,dispatch_evidence_path,return_evidence_path):
    item=Path(item).resolve();r=_verify_observation_prepared(item)
    with (item/'receive.lock').open('x',encoding='utf-8') as f:f.write('terminal original component observation\n')
    answer_dir=item/'answer';answer_dir.mkdir()
    for source,name in ((response,'response.json'),(host_attestation_path,'host-attestation.json'),
        (dispatch_evidence_path,'dispatch.bin'),(return_evidence_path,'return.bin')):
        shutil.copyfile(source,answer_dir/name)
    geo._attestation(item,r);answer=read(answer_dir/'response.json');result=geo.assess(r,answer)
    _verify_observation_prepared(item)
    result.update(files={p.name:digest(p) for p in sorted(answer_dir.iterdir())},requestSha256=digest(item/'request.json'))
    save(item/'result.json',result)
    receipt=dict(kind='ui_original_component_observation_receipt_v1',requestSha256=digest(item/'request.json'),
        inputsSha256=r['inputsSha256'],editBinding=r['editBinding'],resultSha256=digest(item/'result.json'),
        answerFiles=result['files'],notCryptographicallyPlatformVerified=True,**FLAGS)
    receipt['digest']=_hash(receipt);save(item/'observation-receipt.json',receipt)
    return result


def verify_observation(item):
    item=Path(item).resolve();r=_verify_observation_prepared(item);geo._attestation(item,r)
    answer=read(item/'answer/response.json');expected=geo.assess(r,answer)
    expected.update(files={p.name:digest(p) for p in sorted((item/'answer').iterdir())},requestSha256=digest(item/'request.json'))
    if not (item/'receive.lock').is_file() or read(item/'result.json')!=expected:
        raise ValueError('COMPONENT_OBSERVATION_RESULT_CHANGED')
    receipt=dict(kind='ui_original_component_observation_receipt_v1',requestSha256=digest(item/'request.json'),
        inputsSha256=r['inputsSha256'],editBinding=r['editBinding'],resultSha256=digest(item/'result.json'),
        answerFiles=expected['files'],notCryptographicallyPlatformVerified=True,**FLAGS)
    receipt['digest']=_hash(receipt)
    if read(item/'observation-receipt.json')!=receipt:
        raise ValueError('COMPONENT_OBSERVATION_RECEIPT_CHANGED')
    return r,answer,item/'source.png',item/'reference.png'
