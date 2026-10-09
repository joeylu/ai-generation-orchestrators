"""Independent diagnostic export of genuine receipts; never promotes a failed DAG."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import shutil
import zipfile

import numpy as np
from PIL import Image

from .evaluate import read, save, digest
from .experimental_executor import record, verified
from .freeze_visual import inspect
from .host_review import runtime_files, _bound_files
from .host_material_review import source, files
from . import reuse_pipeline, material_reuse, background_region_pipeline as bg_pipeline
from . import background_region, viewport_geometry_revision as viewport
from .diagnostic_sheet_partition import partition
from .layer_package import write_package, check_composition

POLICY = 'received-pixel-preserving-diagnostic-v1'
GEOMETRY_POLICY = 'measured-alpha-proxy-expanded-storage-v1'
FLAGS = dict(strictBodyRegistrationPassed=False, fullAutomaticDagPassed=False,
             humanVisualAcceptance=False, originalDagPromoted=False,
             generationCalls=0, modelCalls=0, materialReviewPassed=False,
             sourceCompletenessAccepted=False, alphaQualityAccepted=False)


def _fresh(output, inputs):
    output = Path(output).resolve()
    if output.exists() or any(output.is_relative_to(Path(p).resolve()) for p in inputs):
        raise ValueError('FRESH_INDEPENDENT_DIAGNOSTIC_OUTPUT_REQUIRED')
    return output


def _checked(job, expected_digest):
    job = Path(job).resolve()
    config = verified(job / 'job.json')
    if config['digest'] != expected_digest:
        raise ValueError('DIAGNOSTIC_RECEIVED_JOB_CHANGED')
    snapshot = job / 'snapshot'
    manifest = inspect(snapshot, config['snapshotDigest'])
    rows = read(snapshot / 'requests.json')['requests']
    if set(config['assets']) != {r['asset'] for r in rows}:
        raise ValueError('COMPLETE_RECEIVED_REQUEST_SET_REQUIRED')
    bindings = []
    for row in rows:
        actual_config, actual_row, receipt, raw = source(job, row['asset'])
        if actual_config != config or actual_row != row or digest(raw) != receipt['rawSha256']:
            raise ValueError('DIAGNOSTIC_RECEIVED_SCOPE_CHANGED')
        bindings.append(dict(requestId=row['asset'], jobDigest=config['digest'],
            submissionDigest=receipt['submissionDigest'], rawSha256=receipt['rawSha256'],
            receiptSha256=digest(job / 'attempts' / row['asset'] / 'received.json')))
    p = snapshot / 'evidence/revised-visual-plan.json'
    visual = read(p if p.exists() else snapshot / 'evidence/m1-draft.json')
    reuse = reuse_pipeline.snapshot_input(snapshot, manifest, visual)
    background = bg_pipeline.snapshot_input(snapshot, manifest, visual)
    return job, config, snapshot, manifest, rows, visual, reuse, background, bindings


def _cleanup_checked(checked, selections):
    """Only genuine singleton edits of this exact original receipt are eligible."""
    if not isinstance(selections,list) or not selections:
        raise ValueError('DIAGNOSTIC_CLEANUP_SELECTION_REQUIRED')
    job,config,snapshot,manifest,rows,visual,reuse,background,bindings=checked
    by_id={r['asset']:r for r in rows};original={b['requestId']:b for b in bindings}
    owned={m['id']:m for m in visual['materials']};reused=set()
    if reuse is not None:
        for group in reuse['groups']:
            reused.update([group['prototypeMaterialId'],*group['instanceMaterialIds']])
    result=[];seen=set()
    for item in selections:
        if not isinstance(item,dict) or set(item)!={'materialId','cleanupJob','cleanupJobDigest'}:
            raise ValueError('DIAGNOSTIC_CLEANUP_SELECTION_FIELDS')
        if any(not isinstance(item[k],str) or not item[k] for k in item):
            raise ValueError('DIAGNOSTIC_CLEANUP_SELECTION_FIELDS')
        mid=item['materialId'];row=by_id.get(mid)
        if (mid in seen or mid not in owned or mid in reused or owned[mid]['role']=='background' or
                row is None or row.get('kind')=='sheet' or row.get('materialIds',[mid])!=[mid]):
            raise ValueError('DIAGNOSTIC_CLEANUP_FOREGROUND_SINGLETON_REQUIRED')
        seen.add(mid);edit_job=Path(item['cleanupJob']).resolve()
        actual,edit_row,receipt,raw=source(edit_job,mid)
        binding=actual.get('cleanup')
        if (actual['digest']!=item['cleanupJobDigest'] or not isinstance(binding,dict) or
                actual['snapshotDigest']!=config['snapshotDigest'] or actual['assets']!=[mid] or
                Path(binding['sourceJob']).resolve()!=job or binding['sourceRequestId']!=mid or
                binding['materialId']!=mid or edit_row!=row):
            raise ValueError('DIAGNOSTIC_CLEANUP_SOURCE_MISMATCH')
        # source() replays load_job/verify_cleanup, including genuine old-source
        # authorization, source pixels, catalog, context, policy and prompt.
        lineage=read(edit_job/'cleanup/source-lineage.json')
        if (lineage['jobDigest']!=config['digest'] or lineage['snapshotDigest']!=manifest['digest'] or
                lineage['rawSha256']!=original[mid]['rawSha256'] or
                lineage['submissionDigest']!=original[mid]['submissionDigest']):
            raise ValueError('DIAGNOSTIC_CLEANUP_SOURCE_MISMATCH')
        auth=verified(edit_job/'authorization.json')
        submission=verified(edit_job/'attempts'/mid/'submission.json')
        if (auth['jobDigest']!=actual['digest'] or auth['snapshotDigest']!=actual['snapshotDigest'] or
                auth['maximumCalls']!=1 or auth['automaticRetries']!=0 or not auth['approval'].strip() or
                submission['authorizationDigest']!=auth['digest'] or receipt['submissionDigest']!=submission['digest'] or
                digest(raw)!=receipt['rawSha256']):
            raise ValueError('DIAGNOSTIC_CLEANUP_RECEIPT_MISMATCH')
        bound_files=files(edit_job)
        _bound_files(edit_job,bound_files)
        result.append({**item,'cleanupJob':str(edit_job),'cleanupJobFiles':bound_files,
            'sourceRawSha256':lineage['rawSha256'],'cleanupRawSha256':receipt['rawSha256'],
            'cleanupReceiptSha256':digest(edit_job/'attempts'/mid/'received.json')})
    return result


def _portable_cleanup(bindings):
    return [{k:b[k] for k in ('materialId','sourceRawSha256','cleanupRawSha256','cleanupReceiptSha256')}
            for b in bindings]


def prepare(job, expected_digest, output, canvas_policy_instruction, cleanup_jobs=None, *, body_job=None):
    """Freeze a zero-compute diagnostic contract, independently of strict delivery."""
    checked = _checked(job, expected_digest)
    job, config, snapshot, manifest, rows, visual, reuse, background, bindings = checked
    cleanup_bindings=_cleanup_checked(checked,cleanup_jobs) if cleanup_jobs is not None else []
    if body_job is not None and cleanup_bindings:
        raise ValueError('DIAGNOSTIC_BODY_CLEANUP_MIX_NOT_SUPPORTED')
    from .diagnostic_body_replay import checked_replay
    body_replay=checked_replay(checked,body_job) if body_job is not None else None
    if not isinstance(canvas_policy_instruction, str) or not canvas_policy_instruction.strip():
        raise ValueError('EXPLICIT_BOUND_VIEWPORT_POLICY_REQUIRED')
    output = _fresh(output, [job,*[b['cleanupJob'] for b in cleanup_bindings],
                            *([body_job] if body_replay else [])])
    output.mkdir(parents=True)
    value = record(output / 'diagnostic.json', dict(kind='ui_received_diagnostic_delivery_v3' if body_replay else
        'ui_received_diagnostic_delivery_v2' if cleanup_bindings else 'ui_received_diagnostic_delivery_v1',
        policy=POLICY, geometryPolicy=GEOMETRY_POLICY, receivedJob=str(job),
        receivedJobDigest=expected_digest, receivedJobFiles=files(job),
        snapshotDigest=manifest['digest'], runtime=runtime_files(), sourceBindings=bindings,
        **({'cleanupBindings':cleanup_bindings} if cleanup_bindings else {}),
        **({'bodyReplay':body_replay} if body_replay else {}),
        canvasPolicy=viewport.POLICY, canvasPolicyInstruction=canvas_policy_instruction,
        canvasPolicyInstructionSha256=hashlib.sha256(canvas_policy_instruction.encode()).hexdigest(),
        scope='Independent diagnostic only; unresolved sheet, ownership, clipping and visual findings remain unresolved.',
        **FLAGS))
    return dict(status='diagnostic_policy_frozen', diagnosticDigest=value['digest'], **FLAGS)


def proxy_geometry(image, owner):
    """A declared ownership target is only a proxy, never an observed body result."""
    alpha = image.getchannel('A')
    full = alpha.getbbox()
    if full is None:
        raise ValueError('EMPTY_DIAGNOSTIC_SOURCE')
    measured = alpha.point(lambda a: 255 if a >= 8 else 0).getbbox()
    body = measured or full
    if len(owner) != 4 or any(type(v) is not int for v in owner) or min(owner[2]-owner[0], owner[3]-owner[1]) <= 0:
        raise ValueError('DIAGNOSTIC_TARGET_GEOMETRY')
    scale = min((owner[2]-owner[0])/(body[2]-body[0]),
                (owner[3]-owner[1])/(body[3]-body[1]))
    shift = [(owner[i]+owner[i+2])/2 - (body[i]+body[i+2])*scale/2 for i in (0, 1)]
    a = np.asarray(alpha)
    edge = np.concatenate((a[0, :], a[-1, :], a[:, 0], a[:, -1]))
    return dict(uniformScale=scale, translation=shift, sourceMeasuredAlphaBox=list(measured) if measured else None,
        measurementThreshold=8, measurementIsGeometryOnly=True, sourceUnthresholded=True,
        ownershipRegion=owner, observedBody=False, positionBasis=GEOMETRY_POLICY,
        sourceOuterBoundaryNonzeroAlphaCount=int(np.count_nonzero(edge)),
        sourceOuterBoundaryMaximumAlpha=int(edge.max()), sourceCompletenessAccepted=False,
        sourceBoundaryPaddingProvesCompleteness=False, alphaQualityAccepted=False)


def _portable_bindings(bindings):
    return [dict(b) for b in bindings]


def _sources_archive(output, rows, job, split_records, reuse_records, background_proof, cleanup_bindings=()):
    """Preserve every genuine raw file and every cell, including unowned sidecars."""
    root = output / 'source-evidence'
    (root / 'raw').mkdir(parents=True)
    for row in rows:
        shutil.copyfile(job / 'attempts' / row['asset'] / 'raw.png', root / 'raw' / (row['asset']+'.png'))
    if cleanup_bindings:
        (root/'cleanup-raw').mkdir()
        for b in cleanup_bindings:
            mid=b['materialId']
            shutil.copyfile(Path(b['cleanupJob'])/'attempts'/mid/'raw.png',root/'cleanup-raw'/(mid+'.png'))
    save(root / 'diagnostic-evidence.json', dict(policy=POLICY, sheetPartitions=split_records,
        reuseDerivations=reuse_records, backgroundProtection=background_proof,
        **({'cleanupReplacements':_portable_cleanup(cleanup_bindings)} if cleanup_bindings else {}),**FLAGS))
    inventory = {p.relative_to(root).as_posix():dict(sha256=digest(p), bytes=p.stat().st_size)
                 for p in sorted(root.rglob('*')) if p.is_file()}
    save(root / 'checksums.json', dict(kind='ui_diagnostic_sources_v1', files=inventory))
    archive = output / 'diagnostic-sources.zip'
    with zipfile.ZipFile(archive, 'x', compression=zipfile.ZIP_STORED) as z:
        for p in sorted(root.rglob('*')):
            if p.is_file():
                info = zipfile.ZipInfo(p.relative_to(root).as_posix(), (2020,1,1,0,0,0))
                info.external_attr = 0o100644 << 16
                z.writestr(info, p.read_bytes())
    with zipfile.ZipFile(archive) as z:
        if z.testzip() is not None or set(z.namelist()) != set(inventory) | {'checksums.json'}:
            raise ValueError('DIAGNOSTIC_SOURCE_ARCHIVE_INVENTORY')
        for name, expected in inventory.items():
            raw = z.read(name)
            if expected != dict(sha256=hashlib.sha256(raw).hexdigest(), bytes=len(raw)):
                raise ValueError('DIAGNOSTIC_SOURCE_ARCHIVE_CHANGED')
    return dict(sha256=digest(archive), bytes=archive.stat().st_size, files=len(inventory)+1)


def deliver(contract_dir, expected_digest, output, viewer):
    """Render a new diagnostic artifact, without editing receipts or failed states."""
    contract_dir = Path(contract_dir).resolve()
    contract = verified(contract_dir / 'diagnostic.json')
    if (contract['digest'] != expected_digest or contract['kind'] not in (
            'ui_received_diagnostic_delivery_v1','ui_received_diagnostic_delivery_v2','ui_received_diagnostic_delivery_v3')
            or contract['policy'] != POLICY or contract['geometryPolicy'] != GEOMETRY_POLICY
            or contract['runtime'] != runtime_files() or contract['canvasPolicy'] != viewport.POLICY
            or contract['canvasPolicyInstructionSha256'] != hashlib.sha256(contract['canvasPolicyInstruction'].encode()).hexdigest()
            or any(contract.get(k) != v for k, v in FLAGS.items())):
        raise ValueError('DIAGNOSTIC_CONTRACT_CHANGED')
    job = Path(contract['receivedJob']).resolve()
    _bound_files(job, contract['receivedJobFiles'])
    checked = _checked(job, contract['receivedJobDigest'])
    job, config, snapshot, manifest, rows, visual, reuse, background, bindings = checked
    if manifest['digest'] != contract['snapshotDigest'] or bindings != contract['sourceBindings']:
        raise ValueError('DIAGNOSTIC_SOURCE_SCOPE_CHANGED')
    cleanup_bindings=[]
    if contract['kind']=='ui_received_diagnostic_delivery_v2':
        selected=[{k:b[k] for k in ('materialId','cleanupJob','cleanupJobDigest')} for b in contract.get('cleanupBindings',[])]
        cleanup_bindings=_cleanup_checked(checked,selected)
        if cleanup_bindings!=contract['cleanupBindings']:raise ValueError('DIAGNOSTIC_CLEANUP_BINDING_CHANGED')
    elif 'cleanupBindings' in contract:raise ValueError('DIAGNOSTIC_CLEANUP_CONTRACT_VERSION')
    body_replay=None
    if contract['kind']=='ui_received_diagnostic_delivery_v3':
        from .diagnostic_body_replay import checked_replay
        frozen_replay=contract['bodyReplay']
        _bound_files(Path(frozen_replay['bodyJob']),frozen_replay['bodyJobFiles'])
        body_replay=checked_replay(checked,frozen_replay['bodyJob'])
        if body_replay!=frozen_replay:raise ValueError('DIAGNOSTIC_BODY_REPLAY_CHANGED')
    elif 'bodyReplay' in contract:raise ValueError('DIAGNOSTIC_BODY_CONTRACT_VERSION')
    observed={r['materialId']:r for r in body_replay['replayedObservations']} if body_replay else {}
    placements = sorted(read(snapshot / 'placements.json')['materials'], key=lambda p:p['drawIndex'])
    owned = {m['id']:m for m in visual['materials']}
    if (len(owned) != len(visual['materials']) or {p['id'] for p in placements} != set(owned)
            or len({p['drawIndex'] for p in placements}) != len(placements)):
        raise ValueError('COMPLETE_LAYER_SET_REQUIRED')
    for mid in owned:
        if re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_-]{0,127}', mid) is None:
            raise ValueError('DIAGNOSTIC_MATERIAL_PATH')
    output = _fresh(output, [contract_dir, job, snapshot,*[b['cleanupJob'] for b in cleanup_bindings],
                            *([body_replay['bodyJob']] if body_replay else [])])
    output.mkdir(parents=True)
    cuts = output / 'source-evidence/cells'
    cuts.mkdir(parents=True)
    sources = {}; provenance = {}; splits = []
    by_key = {b['requestId']:b for b in bindings}
    for row in rows:
        key = row['asset']; raw = job / 'attempts' / key / 'raw.png'
        with Image.open(raw) as opened:
            image = opened.convert('RGBA')
        if row.get('kind') == 'sheet':
            boxes, evidence = partition(image, row)
            splits.append(dict(requestId=key, sourceSha256=digest(raw), **evidence))
            for i, box in enumerate(evidence['partitionBoxes']):
                path = cuts / (key+'-cell-'+str(i)+'.png')
                image.crop(box).save(path)
            for i, (mid, box) in enumerate(zip(row['materialIds'], boxes)):
                sources[mid] = str(cuts / (key+'-cell-'+str(i)+'.png'))
                provenance[mid] = dict(by_key[key], sourceBox=box)
        else:
            sources[key] = str(raw)
            provenance[key] = dict(by_key[key])
    for b in cleanup_bindings:
        mid=b['materialId'];sources[mid]=str(Path(b['cleanupJob'])/'attempts'/mid/'raw.png')
        provenance[mid]=dict(materialId=mid,sourceSha256=b['cleanupRawSha256'],
                            cleanupReplacesSourceSha256=b['sourceRawSha256'])
    derived = material_reuse.derive(reuse, sources, output / 'reused-cells', provenance)
    sources = derived['materials']
    if set(sources) != set(owned):
        raise ValueError('COMPLETE_LAYER_SET_REQUIRED')
    bg_proof = None
    if background is not None:
        mid = background['materialId']
        raw = Path(sources[mid])
        report = background_region.apply(snapshot / 'background-region', background['plan']['digest'],
            raw, digest(raw), output / 'protected-background', candidate_mode='RGBA')
        sources[mid] = str(output / 'protected-background/candidate.png')
        bg_pipeline.check_final(sources[mid], snapshot, background)
        bg_proof = dict(materialId=mid, regionDigest=background['plan']['digest'],
            rawSha256=digest(raw), candidateSha256=digest(Path(sources[mid])),
            reportSha256=digest(output / 'protected-background/report.json'),
            protectedChangedPixels=report['protectedChangedPixels'], coreMatchesProposal=report['coreMatchesProposal'],
            reviewPerformed=False, maskCoverageProven=False)
    rendered_dir = output / 'materials'; rendered_dir.mkdir()
    with Image.open(snapshot / 'reference.png') as im:
        width, height = im.size
    layers = []; package_sources = {}; geometry = []; regions = []
    for index, placement in enumerate(placements):
        mid = placement['id']; path = Path(sources[mid])
        with Image.open(path) as im:
            image = im.convert('RGBA')
        if owned[mid]['role'] == 'background':
            if image.size != (width,height) or image.getchannel('A').getextrema() != (255,255):
                raise ValueError('DIAGNOSTIC_WHOLE_OPAQUE_BACKGROUND_REQUIRED')
            fitting = dict(uniformScale=1, translation=[0,0], observedBody=False,
                positionBasis='exact-original-background-canvas', ownershipRegion=placement['sourceRegion'])
        else:
            if image.getchannel('A').getextrema()[0] != 0:
                raise ValueError('DIAGNOSTIC_NATIVE_ALPHA_REQUIRED')
            if mid in observed:
                fitting=dict(observed[mid]['geometry'], observedBody=True,
                    positionBasis='source-bound-host-body-diagnostic-replay-v1')
            else:
                fitting = proxy_geometry(image, placement['sourceRegion'])
        rendered, fitted = viewport.transform(path, fitting)
        region = fitted['layerCanvasRegion']; regions.append(region)
        target = rendered_dir / (mid+'.png')
        if background is not None and mid == background['materialId']:
            # The protected background is an opaque RGBA identity source. Keep
            # its exact encoded bytes and color profile in the final layer.
            shutil.copyfile(path,target)
            bg_pipeline.check_final(target,snapshot,background)
            fitted.update(byteIdentity=True,protectedBackgroundFinalPixelCheck=True)
        else:
            rendered.save(target)
        package_sources[mid] = dict(path=str(target), sha256=digest(target))
        layers.append(dict(id=mid, name=owned[mid]['label'], role=owned[mid]['role'],
            path=f'layers/layer-{index+1:03}.png', x=region[0], y=region[1],
            width=rendered.width, height=rendered.height, visible=True))
        geometry.append(dict(materialId=mid, sourceSha256=digest(path), storedSha256=digest(target), **fitted))
    bounds = [min(0,*[r[0] for r in regions]), min(0,*[r[1] for r in regions]),
              max(width,*[r[2] for r in regions]), max(height,*[r[3] for r in regions])]
    shift = [-bounds[0],-bounds[1]]; size = (bounds[2]-bounds[0],bounds[3]-bounds[1])
    for layer in layers:
        layer['x'] += shift[0]; layer['y'] += shift[1]
    composition = dict(kind='ui_layer_composition_v1', canvas=dict(width=size[0],height=size[1]),
        coordinates='top-left-pixels', order='array-back-to-front', textPolicy=visual['textPolicy'],
        backgroundMode=visual['backgroundMode'], reference='reference.png', preview='preview.png', layers=layers)
    check_composition(composition)
    world_reference = output / 'world-reference.png'
    with Image.open(snapshot / 'reference.png') as im:
        world = Image.new('RGBA',size); world.paste(im.convert('RGBA'),tuple(shift)); world.save(world_reference)
    issues = ['Diagnostic only; strict material review, body observation and full automatic DAG did not pass.',
        'Raw PNGs are unchanged; uniform cubic rendering may quantize alpha. Source clipping, ownership duplication and sheet ambiguity remain pending human review.',
        'Unobserved materials use measured-alpha proxies. Source-bound host observations, when present, are explicitly identified. Expanded storage does not prove source completeness.']
    issues += ['Sheet diagnosis: '+json.dumps(s, ensure_ascii=False, sort_keys=True) for s in splits]
    issues += ['Placement diagnosis: '+json.dumps(g, ensure_ascii=False, sort_keys=True) for g in geometry]
    result = write_package(world_reference, composition, package_sources, output / 'delivery', viewer, issues)
    delivery = output / 'delivery'
    view = dict(kind='ui_original_viewport_v1', policy=viewport.POLICY,
        worldBoundsInOriginalCoordinates=bounds, worldShift=shift, originalSize=[width,height], worldSize=list(size),
        worldViewportBox=[shift[0],shift[1],shift[0]+width,shift[1]+height],
        originalReferenceSha256=digest(snapshot / 'reference.png'), worldReferenceSha256=digest(world_reference),
        displayPolicy='exact original viewport slice; complete rendered support retained in world storage')
    save(delivery / 'viewport.json',view)
    with Image.open(delivery / 'package/preview.png') as im:
        im.crop(view['worldViewportBox']).save(delivery / 'viewport-preview.png')
    shutil.copyfile(snapshot / 'reference.png', delivery / 'original-reference.png')
    wrapper = viewport._wrapper(delivery)
    archive = _sources_archive(output, rows, job, splits, derived['records'], bg_proof,cleanup_bindings)
    _bound_files(job, contract['receivedJobFiles'])
    for b in cleanup_bindings:_bound_files(Path(b['cleanupJob']),b['cleanupJobFiles'])
    if body_replay:_bound_files(Path(body_replay['bodyJob']),body_replay['bodyJobFiles'])
    result.update(status='diagnostic-pending-human-review', policy=POLICY, geometryPolicy=GEOMETRY_POLICY,
        diagnosticDigest=expected_digest, snapshotDigest=manifest['digest'], sourceBindings=_portable_bindings(bindings),
        geometry=geometry, sheetPartitions=splits, reuseDerivations=derived['records'], backgroundProtection=bg_proof,
        viewport=view, viewportArchive=wrapper, sourceArchive=archive, **FLAGS)
    if cleanup_bindings:result['cleanupReplacements']=_portable_cleanup(cleanup_bindings)
    if body_replay:
        from .diagnostic_body_replay import portable
        result['bodyReplay']=portable(body_replay)
    save(output / 'result.json',result)
    return result


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('action', choices=['prepare-received-diagnostic','deliver-received-diagnostic'])
    p.add_argument('--received-job'); p.add_argument('--job-digest'); p.add_argument('--contract')
    p.add_argument('--diagnostic-digest'); p.add_argument('--canvas-policy-instruction')
    p.add_argument('--cleanup-jobs',help='JSON list of source-bound received foreground singleton cleanup selections')
    p.add_argument('--body-job',help='Read-only genuine host body returns for partial diagnostic replay; never resumes the job')
    p.add_argument('--output',required=True); p.add_argument('--viewer')
    a = p.parse_args()
    if a.action == 'prepare-received-diagnostic':
        if not all((a.received_job,a.job_digest,a.canvas_policy_instruction)) or any((a.contract,a.diagnostic_digest,a.viewer)):
            p.error('prepare requires only received-job, job-digest, canvas-policy-instruction and output')
        result = prepare(a.received_job,a.job_digest,a.output,a.canvas_policy_instruction,
                         read(Path(a.cleanup_jobs)) if a.cleanup_jobs else None,body_job=a.body_job)
    else:
        if not all((a.contract,a.diagnostic_digest,a.viewer)) or any((a.received_job,a.job_digest,a.canvas_policy_instruction,a.cleanup_jobs,a.body_job)):
            p.error('deliver requires only contract, diagnostic-digest, viewer and output')
        result = deliver(a.contract,a.diagnostic_digest,a.output,a.viewer)
    print(json.dumps(result,ensure_ascii=False))
