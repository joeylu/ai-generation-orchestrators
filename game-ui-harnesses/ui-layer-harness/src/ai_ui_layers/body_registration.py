"""Explicit whole-material body registration, independent of reference crop size."""
from pathlib import Path
import math
import numpy as np
from PIL import Image
from .evaluate import read, save, digest
from .freeze_visual import body_digest
from .postprocess_visual import assess
from . import body_coverage

POLICY = 'reference-body-v1'
POLICY_SUPPORT = 'reference-body-support-v1'
KIND = 'ui_whole_body_registration_v1'
FIT_POLICY = 'uniform-observed-body-residual-v2'
RELATIVE_FIT_POLICY = 'uniform-observed-body-relative-residual-v3'


def validate_fit_policy(policy, visual_policy):
    if policy is None:
        return None
    from .visual_policy import validate
    if visual_policy is None or validate(visual_policy).get('minorGeometry') != 'record':
        raise ValueError('APPROXIMATE_VISUAL_POLICY_REQUIRED_FOR_BODY_FIT')
    fields = {'kind', 'maximumResidualPixels', 'denseBoundaryMarginPixels'}
    relative = isinstance(policy, dict) and policy.get('kind') == RELATIVE_FIT_POLICY
    if relative:
        fields |= {'minimumResidualPixels', 'maximumResidualFraction'}
    if (not isinstance(policy, dict) or set(policy) != fields
            or policy['kind'] not in (FIT_POLICY, RELATIVE_FIT_POLICY)
            or type(policy['maximumResidualPixels']) not in (int, float)
            or not math.isfinite(policy['maximumResidualPixels']) or not 0 <= policy['maximumResidualPixels'] <= 128
            or type(policy['denseBoundaryMarginPixels']) is not int
            or not 0 <= policy['denseBoundaryMarginPixels'] <= 8):
        raise ValueError('EXPLICIT_FINITE_BODY_FIT_POLICY_REQUIRED')
    if relative:
        floor, fraction = policy['minimumResidualPixels'], policy['maximumResidualFraction']
        if (type(floor) not in (int, float) or not math.isfinite(floor)
                or not 0 <= floor <= min(8, policy['maximumResidualPixels'])
                or type(fraction) not in (int, float) or not math.isfinite(fraction)
                or not 0 < fraction <= .05):
            raise ValueError('EXPLICIT_FINITE_BODY_FIT_POLICY_REQUIRED')
    return policy


def dense_body_margin(raw, body, fit_policy=None, *, coverage_policy=None, outside_support=None, visual_policy=None):
    """Guard against an inner-icon anchor; retain every alpha pixel at render."""
    body_coverage.validate_policy(coverage_policy)
    if coverage_policy is not None:
        if fit_policy is None:
            raise ValueError('EXTERNAL_EFFECTS_REQUIRE_EXPLICIT_BODY_FIT')
        return body_coverage.check(raw, body, fit_policy['denseBoundaryMarginPixels'], outside_support,
                                   visual_policy=visual_policy)
    if outside_support is not None:
        raise ValueError('EXTERNAL_EFFECTS_REQUIRE_EXPLICIT_COVERAGE_POLICY')
    core = raw.getchannel('A').point(lambda a: 255 if a >= 128 else 0).getbbox()
    if core is None:
        raise ValueError('BODY_CORE_NOT_OBSERVABLE')
    outside = [max(0, body[0]-core[0]), max(0, body[1]-core[1]),
               max(0, core[2]-body[2]), max(0, core[3]-body[3])]
    maximum = 0 if fit_policy is None else fit_policy['denseBoundaryMarginPixels']
    if max(outside) > maximum:
        raise ValueError('SOURCE_BODY_OMITS_DENSE_ARTWORK')
    return dict(sourceDenseAlphaBox=list(core), outsideBodyPixels=outside,
                maximumNativeBoundaryMarginPixels=maximum, alphaPixelsRemoved=0)


def fit_body(source_size, target_size, visual_policy=None, fit_policy=None):
    """One uniform centered fit; appearance tolerance is explicit and reportable."""
    if visual_policy is not None:
        from .visual_policy import validate
        validate(visual_policy)
    from .visual_policy import warnings_only
    warning_mode = warnings_only(visual_policy)
    fit_warnings = []
    bw, bh = source_size
    validate_fit_policy(fit_policy, visual_policy)
    if fit_policy is not None:
        # Least-squares fit of four complete-body corners, with one scale and
        # centered translation. No independent axis scaling or shape repair.
        tw, th = target_size
        scale = (bw*tw + bh*th) / (bw*bw + bh*bh)
        residual = [abs(bw*scale-tw), abs(bh*scale-th)]
        corner = math.hypot(*residual) / 2
        ratio = (bw/bh)/(tw/th)
        difference = max(ratio, 1/ratio)-1
        if difference > .25 + 1e-12 and any(value > 1 for value in residual):
            if not warning_mode:raise ValueError('BODY_PROPORTIONS_GROSSLY_DIFFER')
            fit_warnings.append('BODY_PROPORTIONS_GROSSLY_DIFFER')
        maximum = fit_policy['maximumResidualPixels']
        relative_report = {}
        if fit_policy['kind'] == RELATIVE_FIT_POLICY:
            diagonal = math.hypot(tw, th)
            maximum = min(maximum, max(fit_policy['minimumResidualPixels'],
                diagonal * fit_policy['maximumResidualFraction']))
            relative_report = dict(referenceBodyDiagonalPixels=diagonal,
                cornerResidualFraction=corner/diagonal,
                effectiveMaximumResidualPixels=maximum)
        if corner > maximum + 1e-9:
            if not warning_mode:raise ValueError('UNIFORM_FIT_RESIDUAL_EXCEEDED')
            fit_warnings.append('UNIFORM_FIT_RESIDUAL_EXCEEDED')
        return scale, dict(kind='ui_approximate_body_fit_v3' if relative_report else 'ui_approximate_body_fit_v2', visualPolicy=visual_policy,
            fitPolicy=fit_policy, fittedBodySize=[bw*scale, bh*scale], sizeDifferencePixels=residual,
            symmetricAspectDifference=difference, coarseAspectGuard=.25,
            maximumCornerResidualPixels=corner, **relative_report, axisStretch=False, rotation=0,
            status='recorded-pending-human-review', humanVisualAcceptance=False,
            **(dict(visualFitWarnings=fit_warnings, fitThresholdsAdvisory=True) if warning_mode else {}))
    scale = min(target_size[0] / bw, target_size[1] / bh)
    residual = [abs(source_size[i] * scale - target_size[i]) for i in (0, 1)]
    approximate = visual_policy is not None and visual_policy.get('minorGeometry') == 'record'
    if not approximate:
        if any(value > 1 for value in residual):
            raise ValueError('BODY_PROPORTIONS_DIFFER')
        return scale, None
    ratio = (bw / bh) / (target_size[0] / target_size[1])
    difference = max(ratio, 1 / ratio) - 1
    # A coarse guard against incompatible whole-body anchors, not a pixel-fidelity
    # target. Genuine material review still blocks major or uncertain distortion.
    if difference > .25 + 1e-12 and any(value > 1 for value in residual):
        if not warning_mode:raise ValueError('BODY_PROPORTIONS_GROSSLY_DIFFER')
        fit_warnings.append('BODY_PROPORTIONS_GROSSLY_DIFFER')
    return scale, dict(kind='ui_approximate_body_fit_v1', visualPolicy=visual_policy,
        sourceAspect=bw / bh, targetAspect=target_size[0] / target_size[1],
        symmetricAspectDifference=difference, coarseAspectGuard=.25,
        fittedBodySize=[bw * scale, bh * scale], sizeDifferencePixels=residual,
        axisStretch=False, minorShapePolicy='record after independent material review',
        status='recorded-pending-human-review', humanVisualAcceptance=False,
        **(dict(visualFitWarnings=fit_warnings, fitThresholdsAdvisory=True) if warning_mode else {}))


def _box(value, size):
    if not isinstance(value, list) or len(value) != 4 or any(type(v) is not int for v in value):
        raise ValueError('INTEGER_BODY_BOX_REQUIRED')
    l, t, r, b = value
    if not 0 <= l < r <= size[0] or not 0 <= t < b <= size[1]:
        raise ValueError('BODY_BOX_OUT_OF_BOUNDS')
    return value


def checked_inputs(config, placements, foreground_ids):
    """New mode has exact evidence coverage; absence never selects legacy fitting."""
    policy = config.get('registrationPolicy', 'legacy-region-fit')
    if policy not in ('legacy-region-fit', POLICY, POLICY_SUPPORT):
        raise ValueError('UNKNOWN_REGISTRATION_POLICY')
    entries = config.get('wholePlacements', {})
    if not isinstance(entries, dict):
        raise ValueError('WHOLE_PLACEMENTS_OBJECT_REQUIRED')
    if policy == 'legacy-region-fit':
        if entries:
            raise ValueError('BODY_POLICY_REQUIRED')
        return {}
    if config.get('partPlacements') or config.get('frameBoundsMaterials'):
        raise ValueError('BODY_POLICY_CONFLICTING_OVERRIDES')
    if set(entries) != set(foreground_ids):
        raise ValueError('COMPLETE_BODY_EVIDENCE_REQUIRED')
    result = {}
    for mid, entry in entries.items():
        if not isinstance(entry, dict) or set(entry) != {'path', 'sha256'}:
            raise ValueError('BOUND_BODY_CONTRACT_REQUIRED')
        path = Path(entry['path'])
        if digest(path) != entry['sha256']:
            raise ValueError('BODY_CONTRACT_CHANGED')
        result[mid] = dict(path=str(path.resolve()), sha256=entry['sha256'])
    return result


def load_body_contract(source, reference, entry, material_id, snapshot_digest, coverage_policy=None):
    """Check identical observation bindings for fixed-canvas and viewport routes."""
    body_coverage.validate_policy(coverage_policy)
    path = Path(entry['path'])
    contract_sha = digest(path)
    if contract_sha != entry['sha256']:
        raise ValueError('BODY_CONTRACT_CHANGED')
    contract = read(path)
    fields = {'kind', 'snapshotDigest', 'materialId', 'sourceSha256', 'referenceSha256',
              'sourceBodyBox', 'targetBodyBox', 'evidence', 'issues'}
    modern = coverage_policy == body_coverage.POLICY
    if modern:
        fields.add(body_coverage.FIELD)
    if (not isinstance(contract, dict) or set(contract) != fields
            or contract['kind'] != (body_coverage.CONTRACT_KIND if modern else KIND)):
        raise ValueError('BODY_CONTRACT_KIND_OR_FIELDS')
    if contract['snapshotDigest'] != snapshot_digest or contract['materialId'] != material_id:
        raise ValueError('BODY_CONTRACT_SCOPE_MISMATCH')
    source_sha, reference_sha = digest(source), digest(reference)
    if contract['sourceSha256'] != source_sha or contract['referenceSha256'] != reference_sha:
        raise ValueError('BODY_INPUT_CHANGED')
    evidence = contract['evidence']
    if (not isinstance(evidence, dict) or set(evidence) != {'path', 'sha256', 'basis'}
            or not isinstance(evidence['basis'], str) or not evidence['basis'].strip()):
        raise ValueError('BODY_OBSERVATION_EVIDENCE_REQUIRED')
    evidence_path = Path(evidence['path'])
    if digest(evidence_path) != evidence['sha256']:
        raise ValueError('BODY_OBSERVATION_CHANGED')
    if not isinstance(contract['issues'], list) or contract['issues']:
        raise ValueError('BODY_OBSERVATION_UNRESOLVED')
    observation=read(evidence_path)
    observation_fields={'kind','snapshotDigest','materialId','sourceSha256','referenceSha256',
                        'sourceBodyBox','targetBodyBox','boundaryStatus','issues'}
    if modern:
        observation_fields.add(body_coverage.FIELD)
    if (not isinstance(observation,dict) or set(observation)!=observation_fields
            or observation['kind']!=(body_coverage.OBSERVATION_KIND if modern else 'ui_body_observation_v1')):
        raise ValueError('BODY_OBSERVATION_FORMAT')
    for name in ('snapshotDigest','materialId','sourceSha256','referenceSha256','sourceBodyBox','targetBodyBox'):
        if observation[name]!=contract[name]:raise ValueError('BODY_OBSERVATION_SCOPE_MISMATCH')
    if observation['boundaryStatus']!='complete' or observation['issues']!=[]:
        raise ValueError('BODY_OBSERVATION_UNRESOLVED')
    if modern:
        body_coverage.declarations(contract[body_coverage.FIELD])
        if observation[body_coverage.FIELD] != contract[body_coverage.FIELD]:
            raise ValueError('BODY_OBSERVATION_SCOPE_MISMATCH')
    return contract, observation


def process(source, reference, entry, region, material_id, snapshot_digest, output, policy=POLICY,
            visual_policy=None, fit_policy=None, coverage_policy=None):
    """Apply one observed body mapping to every existing RGBA pixel, never repaint."""
    if policy not in (POLICY, POLICY_SUPPORT):
        raise ValueError('UNKNOWN_REGISTRATION_POLICY')
    source, reference, output = Path(source), Path(reference), Path(output)
    contract, observation = load_body_contract(source, reference, entry, material_id, snapshot_digest, coverage_policy)
    path = Path(entry['path']); contract_sha = entry['sha256']
    evidence = contract['evidence']; evidence_path = Path(evidence['path'])
    source_sha, reference_sha = contract['sourceSha256'], contract['referenceSha256']
    with Image.open(source) as im:
        raw = im.convert('RGBA')
    with Image.open(reference) as im:
        reference_size = im.size
    region = _box(region, reference_size)
    target = _box(contract['targetBodyBox'], reference_size)
    body = _box(contract['sourceBodyBox'], raw.size)
    if not region[0] <= target[0] < target[2] <= region[2] or not region[1] <= target[1] < target[3] <= region[3]:
        raise ValueError('TARGET_BODY_OUTSIDE_MATERIAL')
    target_size = [target[2]-target[0], target[3]-target[1]]
    report = assess(raw, target_size)
    if report['keyEvidence']['route'] != 'native-alpha-preserved':
        raise ValueError('BODY_REGISTRATION_REQUIRES_NATIVE_ALPHA')
    if report['issues']:
        raise ValueError('BODY_RAW_GATE_FAILED:'+','.join(report['issues']))
    if not raw.crop(body).getchannel('A').getbbox():
        raise ValueError('EMPTY_SOURCE_BODY')
    # A whole-body anchor cannot select only an internal icon and silently
    # enlarge its backing. Dense artwork outside it requires explicit review;
    # wholly translucent subjects need another registration policy.
    validate_fit_policy(fit_policy, visual_policy)
    dense_margin = dense_body_margin(raw, body, fit_policy, coverage_policy=coverage_policy,
                                    outside_support=contract.get(body_coverage.FIELD), visual_policy=visual_policy)
    bw, bh = body[2]-body[0], body[3]-body[1]
    scale, appearance = fit_body([bw, bh], target_size, visual_policy, fit_policy)
    content_box = raw.getchannel('A').getbbox()  # Preserve ALL nonzero alpha, including faint shadows.
    target_center = [(target[0]+target[2])/2, (target[1]+target[3])/2]
    body_center = [(body[0]+body[2])/2, (body[1]+body[3])/2]
    shift=[target_center[i]-body_center[i]*scale for i in (0,1)]
    xy=[shift[i]-region[i] for i in (0,1)]
    out_size = [region[2]-region[0], region[3]-region[1]]
    theoretical=[content_box[i]*scale+xy[i%2] for i in range(4)]
    if policy == POLICY and (theoretical[0]<0 or theoretical[1]<0 or theoretical[2]>out_size[0] or theoretical[3]>out_size[1]):
        raise ValueError('BODY_TRANSFORM_WOULD_CLIP_ALPHA')
    # One inverse mapping for both axes: no independent raster-size rounding.
    # Sample beyond the intended canvas to detect interpolation spill before cropping.
    padding=math.ceil(2*scale)+2
    if policy == POLICY_SUPPORT:
        # Render the bounded transformed support in reference coordinates.
        # A guard band detects interpolation spill beyond that support or the reference.
        absolute=[theoretical[i]+region[i%2] for i in range(4)]
        if (absolute[0]<0 or absolute[1]<0 or absolute[2]>reference_size[0]
                or absolute[3]>reference_size[1]):
            raise ValueError('BODY_TRANSFORM_WOULD_CLIP_REFERENCE')
        candidate=[min(region[0],math.floor(absolute[0])),
                   min(region[1],math.floor(absolute[1])),
                   max(region[2],math.ceil(absolute[2])),
                   max(region[3],math.ceil(absolute[3]))]
        expanded=[candidate[2]-candidate[0]+2*padding,
                  candidate[3]-candidate[1]+2*padding]
        coefficients=(1/scale,0,(candidate[0]-shift[0]-padding)/scale,
                      0,1/scale,(candidate[1]-shift[1]-padding)/scale)
    else:
        expanded=[v+2*padding for v in out_size]
        coefficients=(1/scale,0,(-xy[0]-padding)/scale,0,1/scale,(-xy[1]-padding)/scale)
    if expanded[0]*expanded[1]>16_777_216:raise ValueError('BODY_TRANSFORM_PIXEL_LIMIT')
    rendered=raw.transform(tuple(expanded),Image.Transform.AFFINE,coefficients,Image.Resampling.BICUBIC)
    visible=rendered.getchannel('A').getbbox()
    if policy == POLICY_SUPPORT:
        if visible is None:
            raise ValueError('BODY_TRANSFORM_WOULD_CLIP_REFERENCE')
        visible_absolute=[visible[i]+candidate[i%2]-padding for i in range(4)]
        if (visible_absolute[0]<0 or visible_absolute[1]<0
                or visible_absolute[2]>reference_size[0]
                or visible_absolute[3]>reference_size[1]):
            raise ValueError('BODY_TRANSFORM_WOULD_CLIP_REFERENCE')
        # Include the complete alpha support and the original ownership area.
        # The latter remains the authoritative home of the observed target body.
        layer_region=[min(candidate[0],visible_absolute[0]),
                      min(candidate[1],visible_absolute[1]),
                      max(candidate[2],visible_absolute[2]),
                      max(candidate[3],visible_absolute[3])]
        if (layer_region[0]<0 or layer_region[1]<0 or layer_region[2]>reference_size[0]
                or layer_region[3]>reference_size[1]):
            raise ValueError('BODY_TRANSFORM_WOULD_CLIP_REFERENCE')
        canvas=rendered.crop((layer_region[0]-candidate[0]+padding,
                              layer_region[1]-candidate[1]+padding,
                              layer_region[2]-candidate[0]+padding,
                              layer_region[3]-candidate[1]+padding))
        out_size=[layer_region[2]-layer_region[0],layer_region[3]-layer_region[1]]
        xy=[shift[i]-layer_region[i] for i in (0,1)]
        theoretical=[content_box[i]*scale+xy[i%2] for i in range(4)]
        # Express the reported inverse map in the saved PNG's local coordinates.
        coefficients=(1/scale,0,(-xy[0]-padding)/scale,0,1/scale,(-xy[1]-padding)/scale)
    else:
        if (visible is None or visible[0]<padding or visible[1]<padding
                or visible[2]>out_size[0]+padding or visible[3]>out_size[1]+padding):
            raise ValueError('BODY_TRANSFORM_WOULD_CLIP_ALPHA')
        layer_region=region
        canvas=rendered.crop((padding,padding,out_size[0]+padding,out_size[1]+padding))
    pixels = np.array(canvas)
    pixels[pixels[:,:,3] == 0, :3] = 0
    canvas = Image.fromarray(pixels, 'RGBA')
    if (digest(source) != source_sha or digest(reference) != reference_sha
            or digest(path) != contract_sha or digest(evidence_path) != evidence['sha256']):
        raise ValueError('BODY_INPUT_CHANGED_DURING_TRANSFORM')
    output.mkdir(parents=True, exist_ok=False)
    canvas.save(output/'material.png')
    # Bound document, not a mutable external path, permits deterministic receipt replay.
    save(output/'body-contract.json', contract)
    report.update(kind='ui_body_registration_result_v1', status='processed_pending_visual_review',
        sourceSha256=source_sha, referenceSha256=reference_sha,
        snapshotDigest=snapshot_digest, materialId=material_id,
        placementContractSha256=contract_sha, bodyContract=contract,
        bodyContractSha256=digest(output/'body-contract.json'),
        targetSize=out_size, materialSha256=digest(output/'material.png'),
        fitting=dict(mode=policy, sourceBodyBox=body, targetBodyBox=target,
                     layerCanvasRegion=layer_region, sourceFullAlphaBox=list(content_box),
                     uniformScale=scale, rasterScaleXY=[scale,scale], offsetInRegion=xy,
                     inverseAffine=list(coefficients), samplingPadding=padding,
                     sourceFullAlphaTheoreticalBoxInRegion=theoretical,
                     transformedAlphaBox=list(canvas.getchannel('A').getbbox()),
                     referenceRegistration='explicit bound visual body observations, not crop fitting',
                     alphaPolicy='preserve all nonzero-alpha support; no threshold clipping; zero hidden RGB'),
        generationCalls=0, modelCalls=0, humanVisualAcceptance=False)
    if policy == POLICY_SUPPORT:
        report['fitting']['ownershipRegion']=region
        report['bodyContractCanonicalDigest']=body_digest(contract)
    if appearance is not None:
        report['fitting']['appearanceTolerance'] = appearance
        if fit_policy is not None:
            report['fitting']['denseBoundaryCheck'] = dense_margin
        if any(value > 1 for value in appearance['sizeDifferencePixels']):
            report['warnings'].append('APPROXIMATE_BODY_PROPORTIONS_RECORDED')
    if coverage_policy is not None:
        report['fitting']['bodyCoveragePolicy'] = coverage_policy
    report['warnings'].extend(row['code'] + (':' + row['side'] if 'side' in row else '')
                              for row in dense_margin.get('visualCoverageWarnings', []))
    save(output/'report.json', report)
    return report
