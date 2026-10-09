"""New-run whole-body delivery with complete storage and an original-size viewport.

This deterministic entry point consumes genuine bound body observations. It does
not revise an archive, acquire observations, or grant visual acceptance.
"""
import hashlib
import json
import math
from pathlib import Path
import shutil
import tempfile

import numpy as np

from PIL import Image

from .body_registration import POLICY, POLICY_SUPPORT, _box, checked_inputs, fit_body, validate_fit_policy, dense_body_margin, load_body_contract
from . import body_coverage
from .evaluate import digest, read, save
from .freeze_visual import inspect, body_digest
from .layer_package import write_package, composite, portable_text, check_composition
from .postprocess_visual import assess
from .viewport_geometry_revision import POLICY as CANVAS_POLICY, transform, _wrapper

BACKGROUND_POLICY = 'uniform-whole-canvas-opaque-contain-edgepad-v1'
from . import background_region_pipeline as bg_region


def validate_contract(source, reference, entry, region, material_id, snapshot_digest, visual_policy=None,
                      fit_policy=None, coverage_policy=None):
    """Retain strict source/body gates while leaving storage bounds to the caller."""
    source, reference = Path(source), Path(reference)
    path = Path(entry['path'])
    contract, observation = load_body_contract(source, reference, entry, material_id, snapshot_digest, coverage_policy)
    evidence = contract['evidence']
    with Image.open(source) as image:
        if image.format != 'PNG' or image.getexif().get(274, 1) != 1:
            raise ValueError('ORIENTED_PNG_REQUIRED')
        raw = image.convert('RGBA')
    with Image.open(reference) as image:
        reference_size = image.size
    region = _box(region, reference_size)
    target = _box(contract['targetBodyBox'], reference_size)
    body = _box(contract['sourceBodyBox'], raw.size)
    if not (region[0] <= target[0] < target[2] <= region[2]
            and region[1] <= target[1] < target[3] <= region[3]):
        raise ValueError('TARGET_BODY_OUTSIDE_MATERIAL')
    target_size = [target[2] - target[0], target[3] - target[1]]
    report = assess(raw, target_size)
    if report['keyEvidence']['route'] != 'native-alpha-preserved':
        raise ValueError('BODY_REGISTRATION_REQUIRES_NATIVE_ALPHA')
    if report['issues']:
        raise ValueError('BODY_RAW_GATE_FAILED:' + ','.join(report['issues']))
    if not raw.crop(body).getchannel('A').getbbox():
        raise ValueError('EMPTY_SOURCE_BODY')
    validate_fit_policy(fit_policy, visual_policy)
    dense_margin = dense_body_margin(raw, body, fit_policy, coverage_policy=coverage_policy,
                                    outside_support=contract.get(body_coverage.FIELD))
    bw, bh = body[2] - body[0], body[3] - body[1]
    scale, appearance = fit_body([bw, bh], target_size, visual_policy, fit_policy)
    translation = [(target[i] + target[i + 2]) / 2 - (body[i] + body[i + 2]) / 2 * scale for i in (0, 1)]
    if (digest(source) != contract['sourceSha256'] or digest(reference) != contract['referenceSha256']
            or digest(path) != entry['sha256'] or digest(Path(evidence['path'])) != evidence['sha256']):
        raise ValueError('BODY_INPUT_CHANGED_DURING_TRANSFORM')
    geometry = dict(sourceBodyBox=body, targetBodyBox=target,
                    uniformScale=scale, translation=translation, ownershipRegion=region)
    if appearance is not None:
        geometry['appearanceTolerance'] = appearance
        if fit_policy is not None:
            geometry['denseBoundaryCheck'] = dense_margin
    if coverage_policy is not None:
        geometry['bodyCoveragePolicy'] = coverage_policy
    return dict(contract=contract, observation=observation, rawReport=report, geometry=geometry)


def _policy(config):
    instruction = config.get('canvasPolicyInstruction')
    if (config.get('canvasPolicy') != CANVAS_POLICY or not isinstance(instruction, str)
            or not instruction.strip() or config.get('canvasPolicyInstructionSha256') !=
            hashlib.sha256(instruction.encode('utf-8')).hexdigest()):
        raise ValueError('EXPLICIT_BOUND_VIEWPORT_POLICY_REQUIRED')
    return CANVAS_POLICY


def _background(source, size, policy):
    """An explicitly frozen whole-canvas rule, without invented body observations."""
    with Image.open(source) as image:
        if image.format != 'PNG' or image.getexif().get(274, 1) != 1 or image.mode not in ('RGB', 'RGBA'):
            raise ValueError('ORIENTED_RGB_OR_RGBA_BACKGROUND_REQUIRED')
        mode = image.mode; raw = image.convert('RGBA')
    if raw.getchannel('A').getextrema() != (255, 255):
        raise ValueError('BACKGROUND_NATIVE_OPAQUE_REQUIRED')
    if policy is None:
        if mode != 'RGBA' or raw.size != size:
            raise ValueError('FROZEN_BACKGROUND_WHOLE_ORIGINAL_SIZE_REQUIRED')
        return None, dict(policy='frozen opaque whole original size; identity only',
                          originalMode=mode, sourceSize=list(raw.size), uniformScale=1,
                          translation=[0, 0], axisStretch=False, byteIdentity=True)
    if policy==bg_region.POLICY:
        if raw.size!=size:raise ValueError('BG_REGION_EXACT_SOURCE_CANVAS_REQUIRED')
        return None,dict(policy=policy,originalMode=mode,sourceSize=list(raw.size),uniformScale=1,
                         translation=[0,0],axisStretch=False,byteIdentity=True)
    if policy != BACKGROUND_POLICY:
        raise ValueError('UNKNOWN_BACKGROUND_POLICY')
    w, h = raw.size; cw, ch = size
    scale = min(cw / w, ch / h); tx = (cw - w * scale) / 2; ty = (ch - h * scale) / 2
    left = max(2, math.ceil(tx / scale) + 2); top = max(2, math.ceil(ty / scale) + 2)
    right = max(2, math.ceil((cw - tx) / scale - w) + 2)
    bottom = max(2, math.ceil((ch - ty) / scale - h) + 2)
    if (w + left + right) * (h + top + bottom) > 16_777_216:
        raise ValueError('RENDER_PIXEL_LIMIT')
    padded = Image.fromarray(np.pad(np.array(raw), ((top, bottom), (left, right), (0, 0)), mode='edge'))
    rendered = padded.transform(size, Image.Transform.AFFINE,
        (1 / scale, 0, left - tx / scale, 0, 1 / scale, top - ty / scale), resample=Image.Resampling.BICUBIC)
    if rendered.getchannel('A').getextrema() != (255, 255):
        raise ValueError('BACKGROUND_EDGEPAD_OPACITY_FAILED')
    geometry = dict(policy=policy, originalMode=mode, sourceSize=[w, h], uniformScale=scale,
                    translation=[tx, ty], axisStretch=False, sourcePadding=[left, top, right, bottom],
                    backgroundEdgePadding=[tx, ty, cw-(tx+w*scale), ch-(ty+h*scale)],
                    sourceFullAlphaBox=[0, 0, w, h], layerCanvasRegion=[0, 0, cw, ch],
                    alphaSupportClipped=False, implicitClamp=False, byteIdentity=False,
                    basis='explicit frozen whole-canvas rule; opaque border edge extension',
                    sampling='one uniform cubic affine; complete source footprint retained')
    return rendered, geometry


def _unchanged(inputs):
    if any(digest(path) != expected for path, expected in inputs.items()):
        raise ValueError('BODY_INPUT_CHANGED_DURING_TRANSFORM')


def _unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError('DUPLICATE_INPUT_FIELD')
        result[key] = value
    return result


def build(config_path, output, viewer, warnings=()):
    """Package new-run materials and wholePlacements without generation or models."""
    config_path, output, viewer = Path(config_path).resolve(), Path(output).resolve(), Path(viewer).resolve()
    config = json.loads(config_path.read_text(encoding='utf-8'), object_pairs_hook=_unique_object)
    _policy(config)
    if config.get('backgroundPolicy') not in (None, BACKGROUND_POLICY,bg_region.POLICY):
        raise ValueError('UNKNOWN_BACKGROUND_POLICY')
    if config.get('registrationPolicy') not in (POLICY, POLICY_SUPPORT):
        raise ValueError('BODY_POLICY_REQUIRED')
    snapshot = Path(config['snapshot']).resolve()
    frozen = inspect(snapshot, config['snapshotDigest'])
    bg_bound=bg_region.snapshot_input(snapshot,frozen)
    if (config.get('backgroundPolicy')==bg_region.POLICY)!=(bg_bound is not None):
        raise ValueError('BG_REGION_IDENTITY_SCOPE_REQUIRED')
    from .visual_policy import snapshot_policy
    visual_policy = snapshot_policy(snapshot, frozen)
    fit_policy = validate_fit_policy(config.get('bodyFitPolicy'), visual_policy)
    coverage_policy = body_coverage.validate_policy(config.get('bodyCoveragePolicy'))
    path = snapshot / 'evidence/revised-visual-plan.json'
    visual = read(path if path.exists() else snapshot / 'evidence/m1-draft.json')
    rows = read(snapshot / 'placements.json')['materials']
    material_ids = [m['id'] for m in visual['materials']]
    bg_proof=None
    if bg_bound is not None:
        from .host_material_review import verify_extraction
        binding=config.get('reviewedBackgroundExtraction')
        if not binding or digest(Path(binding['path'])/'result.json')!=binding['sha256']:
            raise ValueError('BG_REGION_REVIEWED_EXTRACTION_REQUIRED')
        verified_snapshot,extraction=verify_extraction(binding['path'])
        if inspect(verified_snapshot)['digest']!=frozen['digest'] or extraction['materials']!=config['materials']:
            raise ValueError('BG_REGION_DELIVERY_SOURCE_CHANGED')
        records=[r for r in extraction['records'] if r['materialId']==bg_bound['materialId']]
        if len(records)!=1 or 'backgroundRegion' not in records[0]:raise ValueError('BG_REGION_REVIEWED_CANDIDATE_REQUIRED')
        bg_proof=dict(records[0]['backgroundRegion'],reviewSha256=records[0]['reviewSha256'],
            sourceSha256=bg_bound['plan']['artifacts']['source.png']['sha256'],
            editMaskSha256=bg_bound['plan']['artifacts']['edit-mask.png']['sha256'],
            blendMaskSha256=bg_bound['plan']['artifacts']['blend-mask.png']['sha256'],
            protectedChangedPixels=0,maskCoverageProven=False,policy=bg_region.POLICY)
        bg_region.check_final(config['materials'][bg_bound['materialId']],snapshot,bg_bound)
    reuse_records={}
    if frozen.get('materialReusePolicy'):
        from .host_material_review import verify_extraction
        binding=config.get('reviewedReuseExtraction')
        if not binding or digest(Path(binding['path'])/'result.json')!=binding['sha256']:
            raise ValueError('REUSE_REVIEWED_EXTRACTION_REQUIRED')
        verified_snapshot,extraction=verify_extraction(binding['path'])
        if (inspect(verified_snapshot)['digest']!=frozen['digest'] or extraction['snapshotDigest']!=frozen['digest']
                or extraction['materials']!=config['materials']):raise ValueError('REUSE_DELIVERY_SOURCE_CHANGED')
        for row in extraction['records']:
            if 'prototypeMaterialId' in row:
                reuse_records[row['materialId']]={key:row[key] for key in (
                    'prototypeMaterialId','prototypeSourceSha256','reuseContractSha256','reuseMappingSha256',
                    'derivation','sourceSha256','sourceBox','receiptSha256','reviewSha256')}
                reuse_records[row['materialId']]['scopedMappingSha256']=reuse_records[row['materialId']].pop('reuseMappingSha256')
    placement_ids = [p['id'] for p in rows]
    if (len(material_ids) != len(set(material_ids)) or len(placement_ids) != len(set(placement_ids))
            or set(config['materials']) != set(material_ids) or set(placement_ids) != set(material_ids)):
        raise ValueError('COMPLETE_LAYER_SET_REQUIRED')
    if len({p['drawIndex'] for p in rows}) != len(rows):
        raise ValueError('AMBIGUOUS_ORDER')
    rows = sorted(rows, key=lambda p: p['drawIndex'])
    materials = {m['id']: m for m in visual['materials']}
    entries = checked_inputs(config, {p['id']: p for p in rows},
                             {m['id'] for m in visual['materials'] if m['role'] == 'foreground'})
    reference = snapshot / 'reference.png'
    with Image.open(reference) as image:
        if image.format != 'PNG' or image.getexif().get(274, 1) != 1:
            raise ValueError('ORIENTED_PNG_REQUIRED')
        original_size = image.size
    inputs = {config_path: digest(config_path), reference: digest(reference)}
    checked = {}
    for row in rows:
        mid = row['id']; source = Path(config['materials'][mid]).resolve()
        inputs[source] = digest(source)
        if row['xy'] != row['sourceRegion'][:2]:
            raise ValueError('BODY_OWNERSHIP_MISMATCH')
        if materials[mid]['role'] == 'foreground':
            checked[mid] = validate_contract(source, reference, entries[mid], row['sourceRegion'], mid, frozen['digest'],
                                             visual_policy=visual_policy, fit_policy=fit_policy,
                                             coverage_policy=coverage_policy)
            contract = checked[mid]['contract']
            inputs[Path(entries[mid]['path']).resolve()] = entries[mid]['sha256']
            inputs[Path(contract['evidence']['path']).resolve()] = contract['evidence']['sha256']
        else:
            with Image.open(source) as image:
                if (image.format != 'PNG' or image.getexif().get(274, 1) != 1
                        or row['sourceRegion'] != [0, 0, *original_size]):
                    raise ValueError('FROZEN_BACKGROUND_WHOLE_ORIGINAL_SIZE_REQUIRED')
            # Validate the frozen rule before output creation; rendering itself is
            # repeated inside the temporary build from the fingerprint-bound raw.
            _background(source, original_size, config.get('backgroundPolicy'))
    if output.exists() or any(output.is_relative_to(p) or p.is_relative_to(output) for p in [snapshot, viewer, *inputs]):
        raise ValueError('FRESH_INDEPENDENT_OUTPUT_REQUIRED')
    issues = ['该回拼尚待视觉验收；完整图层存储与原图尺寸显示已执行。']
    for warning in config.get('bodyObservationWarnings', []):
        issues.append(portable_text('[body observation] ' + json.dumps(warning, ensure_ascii=False, sort_keys=True)))
    for mid, checked_body in checked.items():
        appearance = checked_body['geometry'].get('appearanceTolerance')
        if appearance is not None and any(value > 1 for value in appearance['sizeDifferencePixels']):
            issues.append('[approximate body proportions] ' + mid + ': ' + json.dumps(appearance, sort_keys=True))
    for warning in warnings:
        if isinstance(warning, str):
            issues.append(portable_text(warning))
        else:
            issues.append(portable_text('[visual warning: ' + warning['category'] + '] ' + warning['materialId']
                + ': ' + warning['evidence'] + ' Suggestion: ' + warning['suggestion']
                + ' Review SHA-256: ' + warning['reviewSha256']))
    if (snapshot / 'planning-warnings.json').exists():
        issues.extend('[planning warning] ' + w['code'] + ': ' + w['description'] + ' Suggestion: '
                      + w['suggestedChange'] for w in read(snapshot / 'planning-warnings.json')['warnings'])
    with tempfile.TemporaryDirectory(prefix='body-viewport-') as temporary:
        temp = Path(temporary); sources = {}; layers = []; records = []; regions = []
        for i, row in enumerate(rows):
            mid = row['id']; material = materials[mid]; source = Path(config['materials'][mid])
            proof = dict(materialId=mid, sourceSha256=inputs[source.resolve()], role=material['role'])
            if bg_bound is not None and mid==bg_bound['materialId']:proof['backgroundRegion']=bg_proof
            if mid in reuse_records:proof['materialReuse']=reuse_records[mid]
            if mid in checked:
                image, geometry = transform(source, checked[mid]['geometry'])
                region = geometry['layerCanvasRegion']; stored = temp / f'layer-{i}.png'; image.save(stored)
                contract = dict(checked[mid]['contract'])
                contract['evidence'] = dict(sha256=contract['evidence']['sha256'], basis=portable_text(contract['evidence']['basis']))
                proof.update(bodyContract=contract, observation=checked[mid]['observation'], geometry=geometry,
                             bodyContractCanonicalDigest=body_digest(checked[mid]['contract']))
            else:
                image, geometry = _background(source, original_size, config.get('backgroundPolicy'))
                stored = source; region = [0, 0, *original_size]
                if image is not None:
                    stored = temp / f'layer-{i}.png'; image.save(stored)
                proof['backgroundGeometry'] = geometry
            regions.append(region)
            sources[mid] = dict(path=str(stored), sha256=digest(stored))
            layers.append(dict(id=mid, name=material['label'], role=material['role'], path=f'layers/layer-{i+1:03}.png',
                               x=region[0], y=region[1], width=region[2]-region[0], height=region[3]-region[1], visible=True))
            proof.update(originalCoordinateStorageRegion=region, storedSha256=digest(stored)); records.append(proof)
        w, h = original_size
        bounds = [min(0, *[r[0] for r in regions]), min(0, *[r[1] for r in regions]),
                  max(w, *[r[2] for r in regions]), max(h, *[r[3] for r in regions])]
        shift = [-bounds[0], -bounds[1]]; world_size = [bounds[2]-bounds[0], bounds[3]-bounds[1]]
        for layer in layers:
            layer['x'] += shift[0]; layer['y'] += shift[1]
        composition = dict(kind='ui_layer_composition_v1', canvas=dict(width=world_size[0], height=world_size[1]),
                           coordinates='top-left-pixels', order='array-back-to-front', textPolicy=visual['textPolicy'],
                           backgroundMode=visual['backgroundMode'], reference='reference.png', preview='preview.png', layers=layers)
        # Check the UNION canvas before allocating its reference. Individually
        # bounded layers can still imply an excessively large expanded world.
        check_composition(composition)
        with Image.open(reference) as image:
            extended = Image.new('RGBA', tuple(world_size)); extended.paste(image.convert('RGBA'), tuple(shift))
            extended.save(temp / 'reference.png')
        viewport = dict(kind='ui_original_viewport_v1', policy=CANVAS_POLICY, worldBoundsInOriginalCoordinates=bounds,
                        worldShift=shift, originalSize=list(original_size), worldSize=world_size,
                        worldViewportBox=[shift[0], shift[1], shift[0]+w, shift[1]+h],
                        originalReferenceSha256=inputs[reference], worldReferenceSha256=digest(temp/'reference.png'),
                        displayPolicy='exact original viewport slice; complete layer alpha retained in world storage')
        # Portable proof is also embedded in review.json and therefore checksum-bound
        # inside the standard package. External source paths never enter delivery.
        provenance = dict(kind='ui_new_run_body_viewport_delivery_v1', snapshotDigest=frozen['digest'],
                          canvasPolicy=CANVAS_POLICY, viewport=viewport, records=records,
                          generationCalls=0, modelCalls=0, humanVisualAcceptance=False)
        from .visual_policy import warnings_only
        if warnings_only(visual_policy):
            provenance.update(visualReviewMode='warning', visualPolicy=visual_policy,
                              strictVisualReviewPassed=False, finalCompositeVisualAcceptancePending=True)
        issues.append('Body viewport proof: ' + json.dumps(provenance, ensure_ascii=False, sort_keys=True))
        _unchanged(inputs); inspect(snapshot, config['snapshotDigest'])
        package = write_package(temp/'reference.png', composition, sources, output, viewer, issues)
        if bg_bound is not None:
            layer=next(l for l in composition['layers'] if l['id']==bg_bound['materialId'])
            final=output/'package'/layer['path']
            if digest(final)!=bg_proof['candidateSha256']:raise ValueError('BG_REGION_PACKAGE_BYTE_IDENTITY_CHANGED')
            bg_region.check_final(final,snapshot,bg_bound)
        world = composite(output/'package', composition)
        world.crop(viewport['worldViewportBox']).save(output/'viewport-preview.png')
        shutil.copyfile(reference, output/'original-reference.png'); save(output/'viewport.json', viewport)
        wrapper = _wrapper(output)
        _unchanged(inputs); inspect(snapshot, config['snapshotDigest'])
        save(output/'body-provenance.json', provenance)
        result = dict(package, status='pending-human-review', policy=CANVAS_POLICY,
                      viewport=viewport, viewportArchiveSha256=wrapper['sha256'], viewportArchiveBytes=wrapper['bytes'],
                      provenanceSha256=digest(output/'body-provenance.json'), generationCalls=0, modelCalls=0,
                      humanVisualAcceptance=False)
        save(output/'package-result.json', result)
        return result
