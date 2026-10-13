"""One independent review of a frozen recomposition; no model invocation here."""
from pathlib import Path

from jsonschema import Draft202012Validator

from .evaluate import read, save, digest
from .host_timing import measured
from .experimental_executor import record, verified
from . import host_review

POLICY = 'final-composite-once-v1'
LEGACY = 'per-request-v1'
FIELD = 'materialReviewPolicy'
KEY = 'composite'
STAGE = 'composite_review'


def configure(config, *, fast):
    config.setdefault(FIELD, POLICY if fast else LEGACY)
    if config[FIELD] not in (POLICY, LEGACY) or config[FIELD] == POLICY and not fast:
        raise ValueError('BOUND_WARNING_COMPOSITE_REVIEW_POLICY_REQUIRED')


def enabled(config):
    # An absent field preserves all historical per-request scopes.
    return config.get(FIELD) == POLICY


def required_calls(config, image_calls):
    return 1 if enabled(config) else image_calls


def schema(material_ids):
    return dict(type='object', additionalProperties=False, required=['summary', 'findings'], properties=dict(
        summary=dict(type='string', minLength=1, maxLength=3000),
        findings=dict(type='array', maxItems=128, items=dict(type='object', additionalProperties=False,
            required=['category', 'materialIds', 'evidence'], properties=dict(
                category=dict(enum=['ownership', 'missing', 'duplicate', 'placement', 'shape', 'style', 'text', 'other']),
                materialIds=dict(type='array', minItems=1, uniqueItems=True,
                                 items=dict(type='string', enum=material_ids)),
                evidence=dict(type='string', minLength=1, maxLength=2000))))))


@measured('composite_review')
def prepare(root, config):
    root = Path(root)
    report = read(root/'visual-warning-report.json')
    delivery = root/report['diagnosticDelivery']
    if delivery.resolve() not in ((root/'layout-output/delivery').resolve(), (root/'diagnostic-output/delivery').resolve()):
        raise ValueError('COMPOSITE_DELIVERY_PATH_INVALID')
    folder = root/'final-review'
    folder.mkdir()
    mapping = read(delivery/'package/composition.json')
    visual_path=root/'frozen/evidence/revised-visual-plan.json'
    visual=read(visual_path if visual_path.exists() else root/'frozen/evidence/m1-draft.json')
    material_ids = [row['id'] for row in visual['materials']]
    images = []
    for source_name, name, purpose in (
        ('original-reference.png', 'reference.png', 'Original artwork and text locations; text removal is a requirement to check in the recomposition.'),
        ('viewport-preview.png', 'recomposition.png', 'Final assembled viewport at original dimensions.'),
        ('comparison/candidate-material-atlas.png', 'materials.png', 'All delivered candidate materials; use for locating issues only.'),
    ):
        source = delivery/source_name
        (folder/name).write_bytes(source.read_bytes())
        images.append(dict(file=name, sha256=digest(folder/name), purpose=purpose))
    layers={row['id']:row for row in mapping['layers']}
    modes={row['materialId']:row['mode'] for row in visual.get('layoutRegistration',{}).get('materials',[])}
    material_map = [dict(materialId=row['id'], referenceBoxNorm=row['bboxNorm'],
                         preserveText=row.get('preserveText',[]),
                         ownedObjects=[dict(objectId=obj['id'],kind=obj['kind'],
                             referenceBoxNorm=obj.get('bboxNorm'),appearance=obj['label'])
                             for obj in visual['objects'] if obj['materialId']==row['id']],
                         registrationMode=modes.get(row['id']),
                         delivered=row['id'] in layers,
                         path=layers[row['id']]['path'] if row['id'] in layers else None)
                    for row in visual['materials']]
    output_roles=config.get('contextPromptVersion') in ('v14','v15','v16')
    if output_roles:
        from .output_role_prompt import is_substrate
        for row,material in zip(material_map,visual['materials']):
            row['outputRole']=(visual['backgroundMode']+'-background' if material['role']=='background' else
                'clean-substrate' if is_substrate(visual,material) else 'owned-artwork')
    prompt = (
        'Compare the original reference with the final recomposition in ONE independent visual review. '
        'Inspect the original and recomposition at full size; the material atlas is supplementary. '
        'Check missing/duplicate artwork, foreign subjects and backing retained in layers, placement, '
        'occlusion, frame/band alignment, proportions, appearance and transparency. '
        'Compare internal artwork size and offsets, coin/icon scale, border thickness, protruding ornaments '
        'and clearances to separately owned controls, not only outer frame alignment. Empty label space must '
        'stay empty rather than being filled by enlarged or recentered graphics. The material map includes '
        'original-plan owned object locators and appearance; they are unmeasured reference hints, not masks '
        'or observations of the generated content. A uniform/frame registration mode or passed edge '
        'constraint does not certify internal geometry or absence of occlusion. '
        'TEXT REQUIREMENT: ordinary labels and numbers must be removed; this is a target, not an assertion that removal succeeded. '
        'Inspect the actual recomposition for retained or newly invented labels and numbers before evaluating style. '
        'Report visible residual ordinary text as category text, including text copied unchanged from the original. '
        'Each material preserveText list contains the ONLY exact text exceptions that must remain as in the reference; '
        'an empty list permits no ordinary text. Do not report the expected absence of ordinary text as a defect. '
        'Keep owned single-character icon pictograms as artwork. '
        'Report only concrete visible differences with known material IDs and concise evidence. '
        'No per-material checklist, separate review calls, repair proposal, regeneration, or self-granted acceptance. '
        'Findings are warnings and do not stop packaging or authorize a retry. Return only responseSchema JSON. '
        'An empty findings list does not certify every individual cutout or human acceptance.')
    if output_roles:
        prompt += (
            ' OUTPUT-ROLE COVERAGE: inspect the atlas as well as the recomposition for each role present: '
            'background, clean-substrate, owned-artwork, controls and status decorations. '
            'A background or substrate can retain forbidden content hidden by upper opaque layers; '
            'report this as ownership even when the assembled viewport conceals it. '
            'In scene-only-background the entire UI is absent; preserve-underlay-background keeps '
            'unexported UI. A clean-substrate contains no separately owned child illustrations, icons, '
            'buttons or badges. Distinguish a duplicated illustration from an enlarged single illustration '
            'before judging scale. Check every repeated control for text residue, not just one example. '
            'In summary state which present roles could be checked and which could not be resolved from '
            'these images. Do not infer that a hidden or tiny layer passed. Use the same one call and schema.')
    packet = dict(kind='ui_final_composite_review_packet_v1', prompt=prompt,
                  images=images, materials=material_map, responseSchema=schema(material_ids),
                  maximumCalls=1, perRequestReviewCalls=0, bodyObservationCalls=0, automaticRetries=0)
    save(folder/'dispatch.json', packet)
    inputs = {p.name: digest(p) for p in folder.iterdir() if p.is_file()}
    request = record(folder/'request.json', dict(kind='ui_final_composite_review_request_v1',
        policy=POLICY, requestId=KEY, inputs=inputs, materialIds=material_ids,
        diagnosticDelivery=str(delivery.relative_to(root)),
        deliveryFiles={p.relative_to(delivery).as_posix(): digest(p) for p in delivery.rglob('*') if p.is_file()},
        materialAuthors=config['materialAuthors'], reviewerId=config['materialReviewer'],
        model=config['materialModel'], effort=config['materialEffort'],
        packetPath=str(folder/'dispatch.json'), packetSha256=digest(folder/'dispatch.json'),
        maximumCalls=1, automaticRetries=0, humanVisualAcceptance=False))
    return folder, request


def verify(root):
    root = Path(root)
    folder = root/'final-review'
    request = verified(folder/'request.json')
    if request['policy'] != POLICY or request['requestId'] != KEY:
        raise ValueError('COMPOSITE_REVIEW_POLICY_CHANGED')
    host_review._bound_files(folder, request['inputs'])
    delivery = root/request['diagnosticDelivery']
    if delivery.resolve() not in ((root/'layout-output/delivery').resolve(), (root/'diagnostic-output/delivery').resolve()):
        raise ValueError('COMPOSITE_DELIVERY_PATH_INVALID')
    host_review._bound_files(delivery, request['deliveryFiles'])
    packet = read(folder/'dispatch.json')
    if packet['responseSchema'] != schema(request['materialIds']):
        raise ValueError('COMPOSITE_REVIEW_SCHEMA_CHANGED')
    return folder, request, packet


def receive(root, response, *, host_attestation, dispatch_evidence, return_evidence):
    folder, request, packet = verify(root)
    for path, name in ((response, 'response.json'), (host_attestation, 'attestation.json'),
                       (dispatch_evidence, 'dispatch-evidence.bin'), (return_evidence, 'return-evidence.bin')):
        with (folder/name).open('xb') as stream:
            stream.write(Path(path).read_bytes())
    expected = dict(kind='ui_host_composite_review_attestation_v1',
        requestSha256=digest(folder/'request.json'), responseSha256=digest(folder/'response.json'),
        reviewerId=request['reviewerId'], materialAuthors=request['materialAuthors'],
        model=request['model'], effort=request['effort'], independentCall=True,
        hostAssertedModelResponse=True, notProviderReceipt=True, notCryptographicallyPlatformVerified=True,
        dispatchEvidenceSha256=digest(folder/'dispatch-evidence.bin'),
        returnEvidenceSha256=digest(folder/'return-evidence.bin'))
    if read(folder/'attestation.json') != expected:
        raise ValueError('COMPOSITE_HOST_ATTESTATION_MISMATCH')
    if expected['reviewerId'] in request['materialAuthors'] or expected['dispatchEvidenceSha256'] == expected['returnEvidenceSha256']:
        raise ValueError('INDEPENDENT_COMPOSITE_REVIEW_REQUIRED')
    answer = read(folder/'response.json')
    Draft202012Validator(packet['responseSchema']).validate(answer)
    result = record(folder/'result.json', dict(kind='ui_final_composite_review_result_v1',
        policy=POLICY, requestSha256=digest(folder/'request.json'), responseSha256=digest(folder/'response.json'),
        attestationSha256=digest(folder/'attestation.json'), summary=answer['summary'],
        warnings=[dict(row, severity='warning', code='FINAL_COMPOSITE_VISUAL_DIFFERENCE') for row in answer['findings']],
        completed=True, actualReviewCalls=1, perRequestReviewCalls=0, bodyObservationCalls=0,
        independentMaterialDeliveryComplete=False, strictVisualReviewPassed=False,
        humanVisualAcceptance=False, automaticRetries=0))
    return result
