"""Archive-bound native background edits with deterministic rectangular pixel exchange.

Never invokes a provider. Native bytes are retained; only the declared pixel region
is exchanged. Canvas identity is geometry provenance, not visual acceptance.
"""
import hashlib
import io
from pathlib import Path
import shutil

from PIL import Image
from .evaluate import read, save, digest
from .archive_component_exchange import load_archive, _hash, _id
from .archive_material_edit import _png, _native_alpha

POLICY = 'native-background-region-exchange-v1'
FLAGS = dict(humanVisualAcceptance=False, strictBodyRegistrationPassed=False,
             originalDagPromoted=False)


def _scope(purpose, region, owned, delete, size):
    if not isinstance(purpose, str) or not purpose.strip():
        raise ValueError('BACKGROUND_PURPOSE_REQUIRED')
    for values in (owned, delete):
        if not isinstance(values, list) or not values or any(
                not isinstance(v, str) or not v.strip() for v in values):
            raise ValueError('BACKGROUND_EXPLICIT_SCOPE_REQUIRED')
    w, h = size
    if (not isinstance(region, list) or len(region) != 4 or
            any(type(v) is not int for v in region) or
            not 0 <= region[0] < region[2] <= w or
            not 0 <= region[1] < region[3] <= h):
        raise ValueError('BACKGROUND_EDIT_REGION_INVALID')
    return dict(purpose=purpose, editRegion=list(region), owned=list(owned), delete=list(delete))


def _source(loaded, layer_id):
    _id(layer_id)
    rows = [r for r in loaded['composition']['layers'] if r['id'] == layer_id]
    if len(rows) != 1 or rows[0]['role'] != 'background':
        raise ValueError('BACKGROUND_KNOWN_BACKGROUND_REQUIRED')
    layer = rows[0]
    shift = loaded['worldShift']
    if (layer['x'] - shift[0] != 0 or layer['y'] - shift[1] != 0 or
            [layer['width'], layer['height']] != loaded['originalSize']):
        raise ValueError('BACKGROUND_ORIGINAL_CANVAS_IDENTITY_REQUIRED')
    data = loaded['files'][layer['path']]
    with Image.open(io.BytesIO(data)) as image:
        image.load()
        if (image.format != 'PNG' or image.getexif().get(274, 1) != 1 or
                list(image.size) != loaded['originalSize'] or
                image.convert('RGBA').getchannel('A').getextrema() != (255, 255)):
            raise ValueError('BACKGROUND_OPAQUE_ORIGINAL_SIZE_PNG_REQUIRED')
    return layer, data


def _native_arguments(job, prompt):
    return dict(prompt=prompt, referenced_image_paths=[str(job/'source.png'),
        str(job/'reference.png'), str(job/'reference-crop.png')], transparent_background=False)


def freeze(source_archive, layer_id, output, *, purpose, edit_region, owned, delete):
    archive, job = Path(source_archive).resolve(), Path(output).resolve()
    loaded = load_archive(archive)
    layer, data = _source(loaded, layer_id)
    scope = _scope(purpose, edit_region, owned, delete, loaded['originalSize'])
    if job.exists():
        raise ValueError('BACKGROUND_FRESH_JOB_REQUIRED')
    job.mkdir(parents=True)
    (job/'source.png').write_bytes(data)
    (job/'reference.png').write_bytes(loaded['referenceBytes'])
    with Image.open(job/'reference.png') as image:
        image.crop(edit_region).save(job/'reference-crop.png')
    prompt = ('Input policy: '+POLICY+'.\nImage 1 is the current actual source.png; '
        'Image 2 is the full authentic original reference.png; Image 3 is its edit-region crop.\n'
        'Purpose: '+purpose+'\nOwned: '+str(owned)+'\nDelete: '+str(delete)+
        '\nDeclared edit region (integer half-open original pixels): '+str(edit_region)+
        '\nThe declared region includes the misplaced objects and their intended positions; '
        'this input declaration is not an inference about occluded boundaries. Preserve visible '
        'physical scene positions using the true original, and preserve all source outside the '
        'declared region. Return one genuine native fully opaque PNG with exactly '+
        str(loaded['originalSize'])+' pixels and normal orientation. No resize, mask processing, '
        'programmatic redrawing or recomposed preview. The deterministic program will copy '
        'returned RGBA pixels only inside the region and preserve source RGBA outside it.\n')
    (job/'prompt.md').write_text(prompt, encoding='utf-8')
    save(job/'arguments.json', dict(layerId=layer_id, inputPolicy=POLICY, **scope))
    save(job/'image-gen-arguments.json', _native_arguments(job, prompt))
    save(job/'schema.json', dict(kind='ui_native_background_edit_return_v1',
        returnedFormat='PNG', returnedSize=loaded['originalSize'], alphaPolicy='fully-opaque'))
    r = dict(kind='ui_archive_background_edit_request_v1', sourceArchive=str(archive),
        sourceArchiveSha256=loaded['sourceArchiveSha256'], innerArchiveSha256=loaded['innerArchiveSha256'],
        layerId=layer_id, originalLayer=layer, originalSize=loaded['originalSize'],
        worldShift=loaded['worldShift'], sourceSha256=digest(job/'source.png'),
        referenceSha256=digest(job/'reference.png'), scope=scope, inputPolicy=POLICY,
        maximumCalls=1, automaticRetry=False, files={p.name:digest(p)
            for p in sorted(job.iterdir()) if p.is_file()}, **FLAGS)
    r['digest'] = _hash(r)
    save(job/'request.json', r)
    save(job/'preparation.json', dict(requestSha256=digest(job/'request.json')))
    return dict(status='frozen_awaiting_compute_authorization', digest=r['digest'], generationCalls=0)


def verify_frozen(job):
    job = Path(job).resolve()
    r = read(job/'request.json')
    if (r.get('kind') != 'ui_archive_background_edit_request_v1' or r.get('inputPolicy') != POLICY or
            r.get('maximumCalls') != 1 or r.get('automaticRetry') is not False or
            any(r.get(k) is not False for k in FLAGS) or
            _hash({k:v for k,v in r.items() if k != 'digest'}) != r.get('digest') or
            read(job/'preparation.json') != dict(requestSha256=digest(job/'request.json'))):
        raise ValueError('BACKGROUND_REQUEST_CHANGED')
    expected_files = {'source.png', 'reference.png', 'reference-crop.png', 'prompt.md',
                      'arguments.json', 'image-gen-arguments.json', 'schema.json'}
    if set(r['files']) != expected_files:
        raise ValueError('BACKGROUND_FROZEN_INPUT_CHANGED')
    for name, sha in r['files'].items():
        if digest(job/name) != sha:
            raise ValueError('BACKGROUND_FROZEN_INPUT_CHANGED')
    loaded = load_archive(r['sourceArchive'])
    layer, data = _source(loaded, r['layerId'])
    scope = r['scope']
    if scope != _scope(scope['purpose'], scope['editRegion'], scope['owned'], scope['delete'], loaded['originalSize']):
        raise ValueError('BACKGROUND_SCOPE_CHANGED')
    if (loaded['sourceArchiveSha256'] != r['sourceArchiveSha256'] or
            loaded['innerArchiveSha256'] != r['innerArchiveSha256'] or layer != r['originalLayer'] or
            loaded['originalSize'] != r['originalSize'] or loaded['worldShift'] != r['worldShift'] or
            (job/'source.png').read_bytes() != data or
            (job/'reference.png').read_bytes() != loaded['referenceBytes'] or
            digest(job/'source.png') != r['sourceSha256'] or digest(job/'reference.png') != r['referenceSha256']):
        raise ValueError('BACKGROUND_ARCHIVE_BINDING_CHANGED')
    with Image.open(job/'reference.png') as image, Image.open(job/'reference-crop.png') as crop:
        expected = image.crop(scope['editRegion']).convert('RGBA')
        if crop.size != expected.size or crop.convert('RGBA').tobytes() != expected.tobytes():
            raise ValueError('BACKGROUND_REFERENCE_CROP_CHANGED')
    if (read(job/'arguments.json') != dict(layerId=r['layerId'], inputPolicy=POLICY, **scope) or
            read(job/'image-gen-arguments.json') != _native_arguments(job, (job/'prompt.md').read_text('utf-8')) or
            read(job/'schema.json') != dict(kind='ui_native_background_edit_return_v1',
                returnedFormat='PNG', returnedSize=r['originalSize'], alphaPolicy='fully-opaque')):
        raise ValueError('BACKGROUND_ARGUMENTS_CHANGED')
    return r


def frozen_arguments(job):
    job = Path(job).resolve()
    verify_frozen(job)
    return read(job/'image-gen-arguments.json')


def authorize(job, digest_value, actual_user_instruction):
    job = Path(job).resolve()
    r = verify_frozen(job)
    if digest_value != r['digest']:
        raise ValueError('BACKGROUND_AUTHORIZATION_DIGEST_MISMATCH')
    if not isinstance(actual_user_instruction, str) or not actual_user_instruction.strip():
        raise ValueError('ACTUAL_USER_INSTRUCTION_REQUIRED')
    save(job/'authorization.json', dict(kind='ui_background_authorization_v1',
        requestDigest=r['digest'], requestSha256=digest(job/'request.json'),
        actualUserInstruction=actual_user_instruction, maximumCalls=1))
    save(job/'authorization-binding.json', dict(authorizationSha256=digest(job/'authorization.json')))
    return dict(status='authorized_one_native_background_edit', authorizationDigest=digest(job/'authorization.json'))


def _authorization(job, r):
    a = read(job/'authorization.json')
    if (a.get('kind') != 'ui_background_authorization_v1' or a.get('requestDigest') != r['digest'] or
            a.get('requestSha256') != digest(job/'request.json') or a.get('maximumCalls') != 1 or
            not isinstance(a.get('actualUserInstruction'), str) or not a['actualUserInstruction'].strip() or
            read(job/'authorization-binding.json') != dict(authorizationSha256=digest(job/'authorization.json'))):
        raise ValueError('BACKGROUND_AUTHORIZATION_CHANGED')


def _submission_body(job, r):
    return dict(kind='ui_background_submission_v1', requestDigest=r['digest'],
        requestSha256=digest(job/'request.json'), authorizationSha256=digest(job/'authorization.json'),
        layerId=r['layerId'], status='awaiting_result_no_resubmit', automaticRetry=False)


def next_request(job):
    job = Path(job).resolve()
    r = verify_frozen(job)
    _authorization(job, r)
    s = _submission_body(job, r)
    s['digest'] = _hash(s)
    save(job/'submission.json', s)
    return dict(submissionDigest=s['digest'], status=s['status'], arguments=frozen_arguments(job),
                sourcePath=str(job/'source.png'), referencePath=str(job/'reference.png'))


def _submission(job, r):
    _authorization(job, r)
    s = read(job/'submission.json')
    body = _submission_body(job, r)
    if s != {**body, 'digest':_hash(body)}:
        raise ValueError('BACKGROUND_SUBMISSION_CHANGED')
    return s


def _evidence(r, s, raw):
    return dict(kind='ui_native_background_edit_return_v1', submissionDigest=s['digest'],
        layerId=r['layerId'], sourceSha256=r['sourceSha256'], referenceSha256=r['referenceSha256'],
        returnedSha256=digest(raw), hostObservedNativeReturn=True, notCryptographicallyProviderVerified=True)


def _returned(raw, size):
    if _png(raw) != size:
        raise ValueError('BACKGROUND_NATIVE_SIZE_REQUIRED')
    _native_alpha(raw, 'background')


def _pixels(path):
    with Image.open(path) as image:
        return image.convert('RGBA')


def _outside(image, box):
    w, h = image.size
    left, top, right, bottom = box
    return b''.join(image.crop(b).tobytes() for b in
        [(0,0,w,top), (0,top,left,bottom), (right,top,w,bottom), (0,bottom,w,h)])


def _copy(source, raw, box):
    candidate = source.copy()
    candidate.paste(raw.crop(box), (box[0], box[1]))
    return candidate


def _proof(r, source, raw, candidate):
    box = r['scope']['editRegion']
    sha = lambda data: hashlib.sha256(data).hexdigest()
    outside = _outside(source, box)
    if outside != _outside(candidate, box) or candidate.crop(box).tobytes() != raw.crop(box).tobytes():
        raise ValueError('BACKGROUND_REGION_PIXEL_PROOF_FAILED')
    return dict(kind='ui_background_region_pixel_proof_v1', editRegion=box,
        size=r['originalSize'], outsideSourceRgbaSha256=sha(outside),
        outsideCandidateRgbaSha256=sha(_outside(candidate, box)),
        insideRawRgbaSha256=sha(raw.crop(box).tobytes()),
        insideCandidateRgbaSha256=sha(candidate.crop(box).tobytes()),
        sourceRgbaSha256=sha(source.tobytes()), rawRgbaSha256=sha(raw.tobytes()),
        candidateRgbaSha256=sha(candidate.tobytes()), pixelCopyOnly=True, **FLAGS)


def _receipt(job, r, s, path):
    return dict(kind='ui_host_observed_background_edit_receipt_v1', layerId=r['layerId'],
        sourceArchiveSha256=r['sourceArchiveSha256'], innerArchiveSha256=r['innerArchiveSha256'],
        parentSha256=r['sourceSha256'], sourceSha256=r['sourceSha256'], referenceSha256=r['referenceSha256'],
        requestSha256=digest(job/'request.json'), authorizationSha256=digest(job/'authorization.json'),
        submissionDigest=s['digest'], submissionSha256=digest(job/'submission.json'),
        rawSha256=digest(job/'raw.png'), candidateSha256=digest(job/'candidate.png'),
        nativeEvidenceSha256=digest(job/'native-evidence.json'), regionProofSha256=digest(job/'region-proof.json'),
        editRegion=r['scope']['editRegion'], size=r['originalSize'], actualReturnedPath=path,
        geometryBasis='original-canvas-size-and-source-identity-only',
        notProviderReceipt=True, notCryptographicallyProviderVerified=True, **FLAGS)


def receive(job, submission_digest, actual_returned_path, native_tool_evidence):
    job = Path(job).resolve()
    r = verify_frozen(job)
    s = _submission(job, r)
    with (job/'receive.lock').open('x', encoding='utf-8') as stream:
        stream.write('terminal native background return\n')
    if submission_digest != s['digest']:
        raise ValueError('BACKGROUND_SUBMISSION_DIGEST_MISMATCH')
    raw, evidence = Path(actual_returned_path).resolve(), Path(native_tool_evidence).resolve()
    if read(evidence) != _evidence(r, s, raw):
        raise ValueError('BACKGROUND_NATIVE_EVIDENCE_MISMATCH')
    _returned(raw, r['originalSize'])
    shutil.copyfile(raw, job/'raw.png')
    shutil.copyfile(evidence, job/'native-evidence.json')
    source_image, raw_image = _pixels(job/'source.png'), _pixels(job/'raw.png')
    candidate = _copy(source_image, raw_image, r['scope']['editRegion'])
    candidate.save(job/'candidate.png')
    save(job/'region-proof.json', _proof(r, source_image, raw_image, candidate))
    save(job/'received.json', _receipt(job, r, s, str(raw)))
    return dict(status='background_region_candidate_received', candidateSha256=digest(job/'candidate.png'), **FLAGS)


def verify_received(job):
    job = Path(job).resolve()
    r = verify_frozen(job)
    s = _submission(job, r)
    receipt = read(job/'received.json')
    if (not (job/'receive.lock').is_file() or
            receipt != _receipt(job, r, s, receipt.get('actualReturnedPath')) or
            read(job/'native-evidence.json') != _evidence(r, s, job/'raw.png')):
        raise ValueError('BACKGROUND_RECEIPT_CHANGED')
    _returned(job/'raw.png', r['originalSize'])
    _returned(job/'candidate.png', r['originalSize'])
    source, raw, candidate = (_pixels(job/n) for n in ('source.png','raw.png','candidate.png'))
    replay = _copy(source, raw, r['scope']['editRegion'])
    if replay.tobytes() != candidate.tobytes() or read(job/'region-proof.json') != _proof(r, source, raw, candidate):
        raise ValueError('BACKGROUND_PIXEL_COPY_REPLAY_CHANGED')
    keys = ('sourceArchiveSha256','innerArchiveSha256','parentSha256','sourceSha256','referenceSha256',
            'requestSha256','authorizationSha256','submissionDigest','submissionSha256','rawSha256',
            'candidateSha256','nativeEvidenceSha256','regionProofSha256')
    binding = {k:receipt[k] for k in keys}
    binding['receiptSha256'] = digest(job/'received.json')
    return dict(layerId=r['layerId'], candidatePath=job/'candidate.png',
        editRegion=r['scope']['editRegion'], binding=binding, **FLAGS)
