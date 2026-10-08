"""Offline, single-use host geometry evidence for candidates; no model calls."""
import hashlib
import itertools
import json
import math
from pathlib import Path
import re
import shutil
import zipfile

from jsonschema import Draft202012Validator
from PIL import Image
from .evaluate import read, save, digest
from .layer_package import validate_archive, composite

POLICY = 'host-observed-geometry-candidate-v1'
DEFAULT_POLICY = 'host-observed-geometry-candidate-v2'
PROMPT = '''Observe only the frozen source.png and full original reference.png.
Source coordinates are local PNG pixels; target coordinates are full reference pixels.
The originalLayer/sourceRegion describes ownership and placement, never a body box.
Do not use alpha support, ownership bounds or imagined hidden edges as body geometry.
For complete, report genuinely visible whole body boxes with visual evidence.
For visible-landmarks, leave both boxes null and identify at least three spatially
separated, non-collinear actual visible corresponding points in each image.
For uncertain or not-whole leave boxes null. Never infer occluded boundaries.
Separate geometryIssues from materialIssues: retain material faults even if geometry
can be used for a candidate. This observation cannot promote strict registration.
Return only the JSON schema answer. Do not claim generation or platform receipts.
'''
MEASUREMENT_PROMPT = '''Observe the frozen full original reference.png and the native-source display evidence.
Use source-over-light.png and source-over-dark.png for visible source appearance.
These opaque RGB previews composite source.png with its actual continuous alpha,
at identity position and native size. Their pixels use the same source coordinates.
source.png retains unmodified native bytes for identity; hidden RGB where alpha is
zero is invisible artwork, not a leftover background. source-alpha.png visualizes
opacity only: never use its extent as the semantic body boundary.
Source coordinates are local PNG pixels; target coordinates are full reference pixels.
The originalLayer/sourceRegion describes ownership and placement, never a body box.
Do not use alpha support, ownership bounds or imagined hidden edges as body geometry.
For complete, report genuinely visible whole body boxes with visual evidence.
For visible-landmarks, leave both boxes null and identify at least three spatially
separated, non-collinear actual visible corresponding points in each image.
For uncertain or not-whole leave boxes null. Never infer occluded boundaries.
geometryIssues records blockers to reliable measurement, such as ambiguous edges,
wrong correspondence, clipping or incomplete body. These blockers remain unresolved.
geometryDifferences records measurable differences in size, position, aspect ratio
or corresponding point layout when the coordinates can be reliably observed.
A measurable difference alone does not make the observation uncertain. Report its
evidence without judging whether it fits: the deterministic uniform fitter owns
the frozen residual ceiling and rejects excessive error. Never adjust coordinates
to make a fit pass, and never replace visual evidence with the ownership rectangle.
materialIssues retains visible style, glow, alpha, content and ownership faults.
Do not describe hidden RGB as visible backing. Use both composites to distinguish
real opacity from display artifacts. Uncertainty remains an explicit finding.
This observation cannot promote strict registration or human visual acceptance.
Return only the JSON schema answer. Do not claim generation or platform receipts.
'''
PREVIEW_BACKGROUNDS = {'source-over-light.png': (240, 240, 240),
                       'source-over-dark.png': (32, 32, 32)}
DISPLAY_EVIDENCE = dict(kind='ui_host_geometry_alpha_display_v1',
    coordinates='source-native-pixels', transform='identity-no-resize',
    nativeSourceUnmodified=True,
    opaqueRgbComposites={name:list(color) for name,color in PREVIEW_BACKGROUNDS.items()},
    alphaPreview='source-alpha.png', alphaIsBodyGeometry=False)


def _canonical(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':'),
                                    ensure_ascii=False, allow_nan=False).encode()).hexdigest()


def schema(policy=POLICY):
    if policy not in (POLICY, DEFAULT_POLICY):
        raise ValueError('GEOMETRY_CANDIDATE_POLICY_REQUIRED')
    point = dict(type='array', items=dict(type='number'), minItems=2, maxItems=2)
    box = dict(anyOf=[dict(type='null'), dict(type='array', items=dict(type='number'),
                                             minItems=4, maxItems=4)])
    text = dict(type='string', minLength=1, maxLength=4096)
    fields = dict(kind=dict(const='ui_host_geometry_answer_v1'), layerId=text,
        boundaryStatus=dict(enum=['complete', 'visible-landmarks', 'uncertain', 'not-whole']),
        sourceBodyBox=box, targetBodyBox=box,
        landmarkPairs=dict(type='array', maxItems=128, items=dict(type='object',
            additionalProperties=False, required=['id', 'source', 'target', 'evidence'],
            properties=dict(id=text, source=point, target=point, evidence=text))),
        geometryIssues=dict(type='array', maxItems=128, items=text),
        materialIssues=dict(type='array', maxItems=128, items=text), evidence=text)
    if policy == DEFAULT_POLICY:
        fields['kind'] = dict(const='ui_host_geometry_answer_v2')
        fields['geometryDifferences'] = dict(type='array', maxItems=128, items=text)
    return dict(type='object', additionalProperties=False, required=list(fields), properties=fields)


def _source_previews(source):
    """Opaque display evidence only; native bytes, geometry and alpha stay intact."""
    with Image.open(source) as image:
        image.load()
        rgba = image.convert('RGBA')
    previews = {name:Image.alpha_composite(Image.new('RGBA', rgba.size, (*color, 255)),
                 rgba).convert('RGB') for name,color in PREVIEW_BACKGROUNDS.items()}
    previews['source-alpha.png'] = rgba.getchannel('A').convert('RGB')
    return previews


def _verify_previews(item, request):
    if request.get('displayEvidence') != DISPLAY_EVIDENCE:
        raise ValueError('GEOMETRY_DISPLAY_EVIDENCE_CHANGED')
    for name, expected in _source_previews(item/'source.png').items():
        _png(item/name, request['sourceSize'])
        with Image.open(item/name) as actual:
            if actual.mode != 'RGB' or actual.tobytes() != expected.tobytes():
                raise ValueError('GEOMETRY_ALPHA_PREVIEW_CHANGED:'+name)


def _png(path, size=None):
    with Image.open(path) as image:
        image.load()
        if image.format != 'PNG' or image.getexif().get(274, 1) != 1:
            raise ValueError('ORIGINAL_ORIENTED_PNG_REQUIRED')
        if size is not None and list(image.size) != size:
            raise ValueError('PNG_SIZE_CHANGED')
        return list(image.size)


def prepare(source_archive, output_directory, material_ids=None, observation_policy=None, *, source_overrides=None):
    archive = Path(source_archive).resolve(); output = Path(output_directory).resolve()
    policy = DEFAULT_POLICY if observation_policy is None else observation_policy
    if policy not in (POLICY, DEFAULT_POLICY):
        raise ValueError('GEOMETRY_CANDIDATE_POLICY_REQUIRED')
    if output.exists():
        raise ValueError('FRESH_OUTPUT_REQUIRED')
    validated = validate_archive(archive)
    with zipfile.ZipFile(archive) as z:
        composition = json.loads(z.read('composition.json'))
        layers = {row['id']: row for row in composition['layers']}
        ids = list(layers) if material_ids is None else list(material_ids)
        if not ids or len(ids) != len(set(ids)) or any(mid not in layers for mid in ids):
            raise ValueError('KNOWN_UNIQUE_MATERIAL_IDS_REQUIRED')
        if source_overrides is not None and (not isinstance(source_overrides,dict) or not set(source_overrides)<=set(ids)):
            raise ValueError('SELECTED_LAYER_SOURCE_OVERRIDES_REQUIRED')
        overrides={}
        for mid, edit_job in (source_overrides or {}).items():
            from .archive_material_edit import verify_received
            verified=verify_received(edit_job)
            if (verified['layerId']!=mid or verified['binding']['sourceArchiveSha256']!=validated['sha256']
                    or Path(verified['referencePath']).read_bytes()!=z.read('reference.png')):
                raise ValueError('EDIT_OVERRIDE_ARCHIVE_LAYER_SCOPE_MISMATCH')
            overrides[mid]=(Path(edit_job).resolve(),verified)
        output.mkdir(parents=True)
        package = output/'source-package'; package.mkdir()
        for name in z.namelist():
            target = package/name; target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(z.read(name))
    reference_size = _png(package/'reference.png')
    if reference_size != [composition['canvas']['width'], composition['canvas']['height']]:
        raise ValueError('REFERENCE_CANVAS_MISMATCH')
    composite(package, composition)  # Validate every real independent PNG in the complete ZIP.
    rows = []
    for index, mid in enumerate(ids):
        item = output/'items'/f'{index:03}'; item.mkdir(parents=True)
        layer = layers[mid]
        source_override=None
        if mid in overrides:
            edit_job,verified=overrides[mid]
            shutil.copyfile(verified['rawPath'],item/'source.png')
            evidence=item/'edit-evidence';evidence.mkdir()
            names=('request.json','preparation.json','arguments.json','image-gen-arguments.json','schema.json','prompt.md',
                   'authorization.json','submission.json','received.json','native-evidence.json','receive.lock')
            for name in names:shutil.copyfile(edit_job/name,evidence/name)
            shutil.copyfile(edit_job/'source.png',evidence/'original-source.png')
            shutil.copyfile(edit_job/'reference.png',evidence/'original-reference.png')
            source_override=dict(kind='ui_verified_archive_material_edit_source_v1',job=str(edit_job),
                binding=verified['binding'],chainFiles={p.name:digest(p) for p in sorted(evidence.iterdir())})
        else:
            shutil.copyfile(package/layer['path'], item/'source.png')
        shutil.copyfile(package/'reference.png', item/'reference.png')
        modern = policy == DEFAULT_POLICY
        save(item/'schema.json', schema(policy))
        (item/'prompt.md').write_text(MEASUREMENT_PROMPT if modern else PROMPT, encoding='utf-8')
        names = ['source.png', 'reference.png', 'schema.json', 'prompt.md']
        if modern:
            for name, preview in _source_previews(item/'source.png').items():
                preview.save(item/name); names.append(name)
        inputs = {name: digest(item/name) for name in names}
        request = dict(kind='ui_host_geometry_request_v2' if modern else 'ui_host_geometry_request_v1', sourceArchive=str(archive),
            sourceArchiveSha256=validated['sha256'], sourcePackageManifestSha256=digest(package/'manifest.json'),
            layerId=mid, originalLayer=layer, sourceRegion=[layer['x'], layer['y'],
                layer['x']+layer['width'], layer['y']+layer['height']],
            sourceSha256=inputs['source.png'], sourceSize=_png(item/'source.png'),
            referenceSha256=inputs['reference.png'], referenceSize=reference_size,
            schemaSha256=inputs['schema.json'], promptSha256=inputs['prompt.md'], inputs=inputs,
            inputsSha256=_canonical(inputs), policy=policy, modelCallsMaximum=1, automaticRetry=False,
            humanVisualAcceptance=False, strictBodyRegistrationPassed=False, originalDagPromoted=False)
        if source_override is not None:request['sourceOverride']=source_override
        if modern:request['displayEvidence']=DISPLAY_EVIDENCE
        save(item/'request.json', request)
        save(item/'preparation.json', dict(requestSha256=digest(item/'request.json')))
        rows.append(dict(layerId=mid, directory=item.relative_to(output).as_posix(),
                         requestSha256=digest(item/'request.json')))
    save(output/'request.json', dict(kind='ui_host_geometry_batch_v2' if policy==DEFAULT_POLICY else 'ui_host_geometry_batch_v1', items=rows,
        sourceArchiveSha256=validated['sha256'], policy=policy, generationCalls=0))
    return dict(status='awaiting_host_geometry_observation', items=rows, generationCalls=0)


def verify_prepared(directory):
    item = Path(directory).resolve(); request = read(item/'request.json')
    if digest(item/'request.json') != read(item/'preparation.json')['requestSha256']:
        raise ValueError('GEOMETRY_REQUEST_CHANGED')
    policy = request.get('policy'); modern = policy == DEFAULT_POLICY
    if (policy not in (POLICY, DEFAULT_POLICY)
            or request.get('kind') != ('ui_host_geometry_request_v2' if modern else 'ui_host_geometry_request_v1')
            or request.get('modelCallsMaximum') != 1 or request.get('automaticRetry') is not False):
        raise ValueError('GEOMETRY_REQUEST_CONTRACT_CHANGED')
    expected = {'source.png', 'reference.png', 'schema.json', 'prompt.md'}
    if modern:expected.update([*PREVIEW_BACKGROUNDS, 'source-alpha.png'])
    if set(request['inputs']) != expected or _canonical(request['inputs']) != request['inputsSha256']:
        raise ValueError('GEOMETRY_INPUT_BINDING_CHANGED')
    for name, sha in request['inputs'].items():
        if digest(item/name) != sha:
            raise ValueError('GEOMETRY_INPUT_CHANGED:'+name)
    for field, name in (('sourceSha256','source.png'), ('referenceSha256','reference.png'),
                        ('schemaSha256','schema.json'), ('promptSha256','prompt.md')):
        if request[field] != request['inputs'][name]:
            raise ValueError('GEOMETRY_INPUT_BINDING_CHANGED')
    if read(item/'schema.json') != schema(policy) or (item/'prompt.md').read_text(encoding='utf-8') != (MEASUREMENT_PROMPT if modern else PROMPT):
        raise ValueError('GEOMETRY_SCHEMA_OR_PROMPT_CHANGED')
    archive = Path(request['sourceArchive']); validated = validate_archive(archive)
    if validated['sha256'] != request['sourceArchiveSha256']:
        raise ValueError('GEOMETRY_SOURCE_ARCHIVE_CHANGED')
    package = item.parent.parent/'source-package'
    with zipfile.ZipFile(archive) as z:
        for name in z.namelist():
            path = package/name
            if not path.is_file() or path.read_bytes() != z.read(name):
                raise ValueError('GEOMETRY_SOURCE_PACKAGE_CHANGED')
        composition = json.loads(z.read('composition.json'))
        matches = [row for row in composition['layers'] if row['id'] == request['layerId']]
        if len(matches) != 1 or matches[0] != request['originalLayer']:
            raise ValueError('GEOMETRY_ORIGINAL_LAYER_CHANGED')
        layer = matches[0]
        if request['sourceRegion'] != [layer['x'],layer['y'],layer['x']+layer['width'],layer['y']+layer['height']]:
            raise ValueError('GEOMETRY_ORIGINAL_REGION_CHANGED')
        override=request.get('sourceOverride')
        if override is not None:
            from .archive_material_edit import verify_received
            if override.get('kind')!='ui_verified_archive_material_edit_source_v1':
                raise ValueError('TYPED_VERIFIED_EDIT_OVERRIDE_REQUIRED')
            verified=verify_received(override['job'])
            if (verified['layerId']!=request['layerId'] or verified['binding']!=override['binding']
                    or verified['binding']['sourceArchiveSha256']!=request['sourceArchiveSha256']
                    or Path(verified['rawPath']).read_bytes()!=(item/'source.png').read_bytes()
                    or Path(verified['referencePath']).read_bytes()!=z.read('reference.png')):
                raise ValueError('EDIT_OVERRIDE_CHAIN_CHANGED')
            actual={p.name:digest(p) for p in sorted((item/'edit-evidence').iterdir())}
            if actual!=override['chainFiles']:raise ValueError('EDIT_OVERRIDE_FROZEN_CHAIN_CHANGED')
            for name in actual:
                source_name={'original-source.png':'source.png','original-reference.png':'reference.png'}.get(name,name)
                if digest(Path(override['job'])/source_name)!=actual[name]:
                    raise ValueError('EDIT_OVERRIDE_FROZEN_CHAIN_CHANGED')
        elif (item/'source.png').read_bytes() != z.read(layer['path']):
            raise ValueError('GEOMETRY_ORIGINAL_INPUT_MISMATCH')
        if (item/'reference.png').read_bytes() != z.read('reference.png'):
            raise ValueError('GEOMETRY_ORIGINAL_INPUT_MISMATCH')
    if digest(package/'manifest.json') != request['sourcePackageManifestSha256']:
        raise ValueError('GEOMETRY_MANIFEST_CHANGED')
    _png(item/'source.png', request['sourceSize']); _png(item/'reference.png', request['referenceSize'])
    if modern:_verify_previews(item, request)
    return request


def _coordinates(values, size, box=False):
    if any(type(v) not in (int, float) or not math.isfinite(v) for v in values):
        raise ValueError('FINITE_GEOMETRY_COORDINATES_REQUIRED')
    if any(not 0 <= value <= size[index % 2] for index, value in enumerate(values)):
        raise ValueError('GEOMETRY_COORDINATES_OUTSIDE_IMAGE')
    if box and (values[0] >= values[2] or values[1] >= values[3]):
        raise ValueError('POSITIVE_BODY_BOX_REQUIRED')


def _noncollinear(points):
    for a, b, c in itertools.combinations(points, 3):
        area = abs((b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]))
        if area > 1e-6 and all(math.dist(p, q) >= 1 for p, q in ((a,b),(a,c),(b,c))):
            return True
    return False


def assess(request, answer):
    # Component exchanges also reuse the legacy answer validator under their own
    # independently verified request policy. Only an explicit v2 request selects v2.
    policy = DEFAULT_POLICY if request.get('policy') == DEFAULT_POLICY else POLICY
    Draft202012Validator(schema(policy)).validate(answer)
    if answer['layerId'] != request['layerId']:
        raise ValueError('GEOMETRY_LAYER_ID_MISMATCH')
    complete = answer['boundaryStatus'] == 'complete'
    for field, size in (('sourceBodyBox', request['sourceSize']), ('targetBodyBox', request['referenceSize'])):
        if (answer[field] is None) == complete:
            raise ValueError('COMPLETE_BODY_BOXES_OR_NULL_PARTIAL_REQUIRED')
        if answer[field] is not None:
            _coordinates(answer[field], size, box=True)
    pairs = answer['landmarkPairs']
    if len({p['id'] for p in pairs}) != len(pairs):
        raise ValueError('UNIQUE_LANDMARK_IDS_REQUIRED')
    for pair in pairs:
        _coordinates(pair['source'], request['sourceSize']); _coordinates(pair['target'], request['referenceSize'])
    landmarks = answer['boundaryStatus'] == 'visible-landmarks'
    if landmarks and (not _noncollinear([p['source'] for p in pairs])
                      or not _noncollinear([p['target'] for p in pairs])):
        raise ValueError('THREE_SEPARATED_NONCOLLINEAR_VISIBLE_LANDMARKS_REQUIRED')
    usable = (complete or landmarks) and not answer['geometryIssues']
    result = dict(status='geometry_usable_candidate' if usable else 'unresolved',
        geometryUsableCandidate=usable, boundaryStatus=answer['boundaryStatus'],
        geometryIssues=answer['geometryIssues'], materialIssues=answer['materialIssues'],
        humanVisualAcceptance=False, strictBodyRegistrationPassed=False, originalDagPromoted=False)
    if policy == DEFAULT_POLICY:result['geometryDifferences'] = answer['geometryDifferences']
    return result


def _attestation(item, request):
    attestation = read(item/'answer/host-attestation.json')
    reviewer = attestation.get('reviewerId'); authors = attestation.get('materialAuthors')
    if (not isinstance(authors, list) or not authors or len(set(authors)) != len(authors)
            or any(not isinstance(v, str) or re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}', v) is None
                   for v in [reviewer, *authors])):
        raise ValueError('HOST_IDENTITIES_REQUIRED')
    if reviewer in authors:
        raise ValueError('INDEPENDENT_GEOMETRY_REVIEWER_REQUIRED')
    expected = dict(kind='ui_host_geometry_attestation_v1', requestSha256=digest(item/'request.json'),
        responseSha256=digest(item/'answer/response.json'), inputsSha256=request['inputsSha256'],
        reviewerId=reviewer, materialAuthors=authors, hostAssertedModelResponse=True,
        notProviderReceipt=True, notCryptographicallyPlatformVerified=True,
        dispatchEvidenceSha256=digest(item/'answer/dispatch.bin'),
        returnEvidenceSha256=digest(item/'answer/return.bin'))
    if attestation != expected or expected['dispatchEvidenceSha256'] == expected['returnEvidenceSha256']:
        raise ValueError('GEOMETRY_HOST_ATTESTATION_BINDING_MISMATCH')
    return expected


def receive(directory, response_path, *, host_attestation_path, dispatch_evidence_path, return_evidence_path):
    item = Path(directory).resolve(); request = verify_prepared(item)
    # Reserve before reading/copying a return; failed receives are also terminal.
    with (item/'receive.lock').open('x', encoding='utf-8') as reserved:
        reserved.write('single-use host geometry receive\n')
    answer_dir = item/'answer'; answer_dir.mkdir()
    for source, name in ((response_path,'response.json'), (host_attestation_path,'host-attestation.json'),
                         (dispatch_evidence_path,'dispatch.bin'), (return_evidence_path,'return.bin')):
        shutil.copyfile(source, answer_dir/name)
    _attestation(item, request)
    answer = read(answer_dir/'response.json'); result = assess(request, answer)
    verify_prepared(item)
    result['files'] = {p.name:digest(p) for p in sorted(answer_dir.iterdir())}
    result['requestSha256'] = digest(item/'request.json')
    save(item/'result.json', result)
    return result


def verify_response(directory):
    item = Path(directory).resolve(); request = verify_prepared(item)
    _attestation(item, request)
    answer = read(item/'answer/response.json'); result = read(item/'result.json')
    expected = assess(request, answer)
    expected.update(files={p.name:digest(p) for p in sorted((item/'answer').iterdir())},
                    requestSha256=digest(item/'request.json'))
    if expected != result or not (item/'receive.lock').is_file():
        raise ValueError('GEOMETRY_SEALED_RESULT_CHANGED')
    return request, answer, item/'source.png', item/'reference.png'
