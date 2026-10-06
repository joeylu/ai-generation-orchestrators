"""Fresh opt-in protected backgrounds, bound to genuine raw acquisition.

Masks are caller declarations and visual references, never inferred segmentation
or API inpainting masks. No receipt, approval, or prior terminal is modified.
"""
from pathlib import Path
import tempfile
import numpy as np
from PIL import Image
from jsonschema import Draft202012Validator
from .evaluate import read, save, digest
from . import background_region as region

POLICY = 'exact-source-canvas-protected-region-v1'
PREFIX = 'background-region-'
NAMES = (*region.FILES, 'plan.json')


def copy_inputs(source, expected_digest, destination):
    region.inspect(source, expected_digest)
    destination = Path(destination)
    for name in NAMES:
        (destination/(PREFIX+name)).write_bytes((Path(source)/name).read_bytes())


def _validate(plan, visual, reference_sha):
    if (plan['artifacts']['source.png']['sha256'] != reference_sha
            or plan['backgroundMode'] != 'scene-only' or plan['textPolicy'] != 'remove-business-text'
            or visual['backgroundMode'] != 'scene-only' or visual['textPolicy'] != 'remove-business-text'):
        raise ValueError('BG_REGION_HOST_SOURCE_OR_SCOPE')
    backgrounds = [m for m in visual['materials'] if m['role'] == 'background']
    if (len(backgrounds) != 1 or backgrounds[0]['bboxNorm'] != [0,0,1,1]
            or backgrounds[0].get('adaptationPolicy', 'preserve') != 'preserve'):
        raise ValueError('BG_REGION_SINGLE_FULL_CANVAS_BACKGROUND_REQUIRED')
    return dict(plan=plan, materialId=backgrounds[0]['id'])


def planning_input(root, visual=None):
    root=Path(root);config=read(root/'.dag/config.json')
    present = {PREFIX+n for n in NAMES} & set(config['inputs'])
    if not present and 'backgroundRegionDigest' not in config:return None
    if present != {PREFIX+n for n in NAMES} or config.get('planningDriver')!='host-model-exchange-v1':
        raise ValueError('BG_REGION_HOST_INPUTS_REQUIRED')
    with tempfile.TemporaryDirectory() as temporary:
        target=Path(temporary)
        for name in NAMES:
            source=root/'.dag/inputs'/(PREFIX+name)
            if digest(source)!=config['inputs'][PREFIX+name]:raise ValueError('BG_REGION_HOST_INPUT_CHANGED')
            (target/name).write_bytes(source.read_bytes())
        plan=region.inspect(target,config['backgroundRegionDigest'])
    return _validate(plan,visual or read(root/'m1/draft.json'),digest(root/'m1/reference.png'))


def schema(base, bound):
    if bound is None:return base
    from copy import deepcopy
    result=deepcopy(base)
    result.setdefault('required',[]).append('backgroundRegionAudit')
    result['properties']['backgroundRegionAudit']=dict(type='object',additionalProperties=False,
        required=['regionDigest','materialId','scopeCoverageConfirmed','noObviousProtectedUI',
                  'backgroundOwnershipConfirmed','evidence'],properties=dict(
        regionDigest={'const':bound['plan']['digest']},materialId={'const':bound['materialId']},
        scopeCoverageConfirmed={'type':'boolean'},noObviousProtectedUI={'type':'boolean'},
        backgroundOwnershipConfirmed={'type':'boolean'},evidence={'type':'string','minLength':1,'pattern':r'\S'}))
    return result


def validate_review(answer,bound):
    if bound is None:return
    Draft202012Validator(schema(dict(type='object',properties={}),bound)).validate(answer)
    if any(answer['backgroundRegionAudit'][k] is not True for k in (
            'scopeCoverageConfirmed','noObviousProtectedUI','backgroundOwnershipConfirmed')):
        raise ValueError('BG_REGION_MASK_SCOPE_REVIEW_NOT_CONFIRMED')


def guidance(bound):
    if bound is None:return ''
    return ('\nIndependently inspect the explicit binary edit mask, blend mask and tinted preview against '
        'the clean original. Magenta is replacement core; amber is transition; unchanged preview pixels '
        'are protected source. Confirm declared replacement scope coverage, no obvious separately owned '
        'UI or business text left in protected pixels, and background ownership. If uncertain return false '
        'with specific evidence. Check source features to preserve. This review is limited visual scope '
        'evidence, not exact segmentation certification. Planning bounding boxes are ownership regions, '
        'never precise occlusion masks. maskCoverageProven remains false.\n')


def snapshot_input(folder,manifest,visual=None):
    folder=Path(folder);files=manifest.get('files',{})
    present='background-region/plan.json' in files
    region_files=any(name.startswith('background-region/') for name in files) or (folder/'background-region').exists()
    if not region_files and not any(k in manifest for k in ('backgroundRegionDigest','backgroundRegionPolicy','backgroundRegionMaterialId')):return None
    if not present or manifest.get('backgroundRegionPolicy')!=POLICY:raise ValueError('BG_REGION_SNAPSHOT_METADATA')
    plan=region.inspect(folder/'background-region',manifest['backgroundRegionDigest'])
    if any('background-region/'+n not in manifest['files'] for n in NAMES):raise ValueError('BG_REGION_SNAPSHOT_UNBOUND')
    if visual is None:
        p=folder/'evidence/revised-visual-plan.json'
        visual=read(p if p.exists() else folder/'evidence/m1-draft.json')
    bound=_validate(plan,visual,digest(folder/'reference.png'))
    if manifest.get('backgroundRegionMaterialId')!=bound['materialId']:raise ValueError('BG_REGION_MATERIAL_CHANGED')
    config=read(folder/'evidence/host-review-config.json')
    if config.get('backgroundRegionDigest')!=plan['digest']:raise ValueError('BG_REGION_REVIEW_PLAN_CHANGED')
    for name in NAMES:
        if config['inputs'].get(PREFIX+name)!=digest(folder/'background-region'/name):raise ValueError('BG_REGION_REVIEW_INPUT_CHANGED')
    validate_review(read(folder/'evidence/m2-draft.json'),bound)
    return bound


def frozen_schema(folder,config,visual,reference_sha,base):
    present={PREFIX+n for n in NAMES}&set(config['inputs'])
    if 'backgroundRegionDigest' not in config:
        if present:raise ValueError('BG_REGION_FROZEN_METADATA_REQUIRED')
        return base,None
    if present!={PREFIX+n for n in NAMES}:raise ValueError('BG_REGION_FROZEN_INPUTS_REQUIRED')
    with tempfile.TemporaryDirectory() as temporary:
        target=Path(temporary)
        for name in NAMES:(target/name).write_bytes((Path(folder)/'evidence'/('host-input-'+PREFIX+name)).read_bytes())
        plan=region.inspect(target,config['backgroundRegionDigest'])
    bound=_validate(plan,visual,reference_sha)
    return schema(base,bound),bound


def generation_guidance(bound):
    return ('\nProtected background proposal: return an opaque PNG on the EXACT original source canvas '
        +str(bound['plan']['size'])+' pixels, without resizing or color-profile changes. Added binary edit '
        'mask and tinted preview are visual reference attachments only; no API inpainting mask is supplied. '
        'Propose replacement background for the declared edit scope; a deterministic program preserves '
        'every source pixel outside it and blends using frozen weights. Do not treat any rectangular '
        'planning bbox as a precise silhouette or segmentation mask. Preserve background ownership '
        'and ordinary-text removal. Remove separately owned UI/characters within the permitted scope. '
        'Match adjacent original scene color, texture, lighting and contour continuity at every edit '
        'boundary; do not introduce rectangular patch edges. Do not repeat or relocate protected scene '
        'objects into the permitted regions. Retain explicitly allowed scene decorative lettering; '
        'only ordinary business/UI text is removed. Hidden scenery is a plausible fill, not known truth. '
        'No mask inference or automatic repair.\n')


def verify_candidate(output,snapshot,manifest,raw,raw_sha):
    output=Path(output);bound=snapshot_input(snapshot,manifest)
    binding=read(output/'background-region-binding.json')
    expected=dict(regionDigest=bound['plan']['digest'],materialId=bound['materialId'],
        rawSha256=raw_sha,candidateSha256=digest(output/'protected-background/candidate.png'),
        reportSha256=digest(output/'protected-background/report.json'))
    if binding!=expected or digest(raw)!=raw_sha:raise ValueError('BG_REGION_CANDIDATE_BINDING_CHANGED')
    with tempfile.TemporaryDirectory() as temporary:
        replay=Path(temporary)/'replay'
        region.apply(Path(snapshot)/'background-region',bound['plan']['digest'],raw,raw_sha,replay,candidate_mode='RGBA')
        actual=output/'protected-background'
        if {p.name for p in actual.iterdir()}!={p.name for p in replay.iterdir()}:
            raise ValueError('BG_REGION_CANDIDATE_FILES_CHANGED')
        for p in replay.iterdir():
            if p.read_bytes()!=(actual/p.name).read_bytes():raise ValueError('BG_REGION_CANDIDATE_REPLAY_CHANGED')
    return binding


def check_final(source,snapshot,bound):
    """Exact canvas and protected source pixels after every downstream stage."""
    root=Path(snapshot)/'background-region'
    with Image.open(source) as image:
        if image.format!='PNG' or image.size!=tuple(bound['plan']['size']) or image.getexif().get(274,1)!=1:
            raise ValueError('BG_REGION_FINAL_CANVAS_CHANGED')
        pixels=np.array(image.convert('RGBA'))
    with Image.open(root/'source.png') as image:original=np.array(image.convert('RGBA'))
    with Image.open(root/'edit-mask.png') as image:protected=np.array(image)==0
    if not np.all(pixels[:,:,3]==255) or not np.array_equal(pixels[protected],original[protected]):
        raise ValueError('BG_REGION_FINAL_PROTECTION_CHANGED')
