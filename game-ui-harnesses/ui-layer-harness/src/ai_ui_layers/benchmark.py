"""Fixed reference regression measurements using immutable local evidence only."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import shutil
import time

from .evaluate import read, save, digest
from .experimental_executor import verified
from .freeze_visual import body_digest
from .package_baseline_audit import _bound, _region
from . import host_timing
from .validation_scope import scope

STAGES = ('planning_generate', 'planning_review', 'planning_repair', 'planning_rereview',
          'images', 'material_review', 'body_observation', 'composite_review')


def inspect_run(run):
    """Read historical checkpoints as evidence; never resume with new code."""
    from .host_delivery import _verify_control, _files
    root = Path(run).resolve()
    checkpoint = _verify_control(root, 'checkpoint.json')
    current_files = _files(root)
    integrity = current_files == checkpoint['files']
    config = verified(root/'config.json')
    state = _verify_control(root, 'state.json')
    if state['configDigest'] != config['digest']:
        raise ValueError('BENCHMARK_CONFIG_CHANGED')
    completed = state['stage'] in ('complete', 'diagnostic_complete')
    if not integrity and state['stage'] != 'failed':
        raise ValueError('BENCHMARK_CHECKPOINT_FILES_CHANGED')
    # A terminal failure is useful first-attempt evidence even when its media
    # checkpoint is unusable. Never replay it or describe its media as verified.
    # Reservation counts still require the exact checkpoint-bound file set.
    count_files = {name:sha for name,sha in current_files.items()
                   if name.endswith(('submission.json','scope.json')) or name=='config.json'}
    if count_files != {name:sha for name,sha in checkpoint['files'].items()
                       if name.endswith(('submission.json','scope.json')) or name=='config.json'}:
        raise ValueError('BENCHMARK_CALL_EVIDENCE_CHANGED')
    original = Path(config['original']).resolve()
    if not original.is_relative_to(root) or current_files.get(original.relative_to(root).as_posix()) != checkpoint['files'].get(original.relative_to(root).as_posix()):
        raise ValueError('BENCHMARK_REFERENCE_CHANGED')
    counts = {stage:0 for stage in STAGES}
    for folder in (root/'scopes').iterdir():
        if not (folder/'scope.json').is_file():
            continue
        stage = verified(folder/'scope.json')['stage']
        if stage not in counts:
            raise ValueError('BENCHMARK_UNKNOWN_SCOPE_STAGE')
        counts[stage] += len(list(folder.glob('*-submission.json')))
    counts['images'] = len(list((root/'images/attempts').glob('*/submission.json')))
    counts['body_observation'] = len(list((root/'body/attempts').glob('*/submission.json')))
    # Diagnostic completion is execution only, never a visual or completeness pass.
    result = dict(checkpointSha256=digest(root/'checkpoint.json'), configDigest=config['digest'],
        observedInventorySha256=body_digest(current_files),
        runtimeDigest=hashlib.sha256(json.dumps(config['runtime'],sort_keys=True).encode()).hexdigest(),
        executionCompleted=completed, stage=state['stage'], callCounts=counts,
        checkpointIntegrityPassed=integrity, deliveryEvidenceUsable=integrity and completed,
        diagnosticDeliveryEvidenceUsable=False,
        referenceSha256=digest(original),
        generationMode=config.get('generationMode'), automaticRetries=0,
        timing=host_timing.report(root), humanVisualAcceptance=False)
    if not completed:
        reason=state.get('reason','unknown')
        result.update(failureCode=reason if re.fullmatch(r'[A-Z][A-Z0-9_]{0,127}',reason) else
                      'NON_CODE_FAILURE_PRESERVED_IN_SOURCE', inventory=None, geometry=None)
        if not integrity or state['stage'] != 'failed' or not (root/'final-review/request.json').is_file():
            return result
        # A failed final call does not invalidate already frozen delivery bytes.
        # This is measurement only: execution stays failed and replay stays forbidden.
        from . import composite_review
        folder, request, _ = composite_review.verify(root)
        review_scope = verified(root/'scopes/composite_review-composite/scope.json')
        if (review_scope['stage'] != composite_review.STAGE or
                review_scope['requestSha256'] != digest(folder/'request.json') or
                Path(review_scope['requestPath']).resolve() != (folder/'request.json').resolve() or
                Path(review_scope['requestDirectory']).resolve() != folder.resolve()):
            raise ValueError('BENCHMARK_DIAGNOSTIC_SCOPE_CHANGED')
        result['diagnosticDeliveryEvidenceUsable'] = True
    name = ('final-composite-warning-report.json' if (root/'final-composite-warning-report.json').is_file()
            else 'visual-warning-report.json')
    warning = read(root/name)
    delivery = root/warning.get('diagnosticDelivery', 'delivery')
    if not delivery.resolve().is_relative_to(root):
        raise ValueError('BENCHMARK_DELIVERY_PATH_ESCAPE')
    excluded = set(warning.get('excludedUncertainMaterialIds', []))
    excluded.update(warning.get('layoutRegistration', {}).get('excludedUncertainMaterialIds', []))
    result.update(measure_delivery(root/'frozen', delivery, root/'layout-output', excluded))
    return result


def measure_delivery(frozen, delivery, layout, excluded=()):
    frozen, delivery, layout = map(Path, (frozen, delivery, layout))
    archive = delivery/'viewport-ui-layers.zip'
    checked = _bound(archive, digest(archive))
    plan = read(frozen/('evidence/revised-visual-plan.json' if (frozen/'evidence/revised-visual-plan.json').is_file()
                        else 'evidence/m1-draft.json'))
    expected = sorted(row['id'] for row in plan['materials'])
    layers = checked['composition']['layers']
    produced = sorted(row['id'] for row in layers)
    geometry = {row['id']:_region(row, checked['viewport']['worldShift']) for row in layers}
    layout_result = read(layout/'result.json') if (layout/'result.json').is_file() else {}
    summary = read(layout/'host-layout-summary.json') if (layout/'host-layout-summary.json').is_file() else {}
    constraints = {row['id']:dict(residualPixels=row['residualPixels'], passed=row['passed'])
                   for row in layout_result.get('constraints', [])}
    internal = {row['materialId']+':'+kind:dict(passed=row['geometryPassed'], residualPixels=row['residualPixels'])
                for kind, key in (('divider','internalDividerChecks'),('band','internalBandChecks'))
                for row in summary.get(key, [])}
    return dict(referenceSha256=checked['viewport']['originalReferenceSha256'],
        referenceSize=checked['viewport']['originalSize'], archiveSha256=checked['archiveSha256'],
        layerSha256=checked['layerSha256'], previewSha256=hashlib.sha256(checked['preview']).hexdigest(),
        inventory=dict(plannedMaterialIds=expected, deliveredMaterialIds=produced,
            missingMaterialIds=sorted(set(expected)-set(produced)), excludedMaterialIds=sorted(excluded),
            complete=set(expected)==set(produced) and not excluded,
            completenessBasis='material identities only; source artwork completeness not accepted'),
        geometry=dict(storageRegions=geometry, constraints=constraints, internalChecks=internal,
            scope='stored support in original coordinates plus declared constraints/bands/dividers; no semantic body observation',
            semanticGeometryAccepted=False))


def compare(expected, actual, tolerance=2):
    """Known deficits remain visible. Only additional deficits count as regressions."""
    regressions = []
    if expected['firstAttemptCompleted'] and not actual['firstAttemptCompleted']:
        regressions.append(dict(metric='firstAttempt', code='FIRST_ATTEMPT_STOPPED'))
    current = actual['selected']
    baseline = expected['selected']
    # Old fixed suites omit the two optional repair stages: their bound baseline is zero.
    # Count regressions remain visible even when execution stopped before delivery.
    for stage in STAGES:
        old = expected['totalCallCounts'].get(stage, 0)
        new = actual['totalCallCounts'].get(stage, 0)
        if new > old:
            regressions.append(dict(metric='calls', code='CALL_COUNT_INCREASED', stage=stage,
                                    baseline=old, actual=new))
    if current['referenceSha256'] != baseline['referenceSha256']:
        raise ValueError('BENCHMARK_REFERENCE_CHANGED')
    if not current['executionCompleted']:
        if baseline['executionCompleted'] or not current.get('diagnosticDeliveryEvidenceUsable'):
            regressions.append(dict(metric='execution', code='NO_COMPLETED_ATTEMPT'))
        if not current.get('diagnosticDeliveryEvidenceUsable'):
            return regressions
    required = set(baseline['inventory']['plannedMaterialIds'])
    for field, ids in (('plannedMaterialIds',required),
                       ('deliveredMaterialIds',set(baseline['inventory']['deliveredMaterialIds']))):
        missing = sorted(ids-set(current['inventory'][field]))
        if missing:
            regressions.append(dict(metric='materialCompleteness', code='MATERIAL_IDS_LOST', field=field, materialIds=missing))
    excluded = sorted(set(current['inventory']['excludedMaterialIds'])-set(baseline['inventory']['excludedMaterialIds']))
    if excluded:
        regressions.append(dict(metric='materialCompleteness',code='NEW_UNCERTAIN_EXCLUSIONS',materialIds=excluded))
    for mid, old in baseline['geometry']['storageRegions'].items():
        new = current['geometry']['storageRegions'].get(mid)
        if new is not None and max(abs(a-b) for a,b in zip(new,old)) > tolerance:
            regressions.append(dict(metric='geometry', code='STORAGE_REGION_DRIFT', materialId=mid,
                                    delta=[a-b for a,b in zip(new,old)]))
    for key in ('constraints', 'internalChecks'):
        for cid, old in baseline['geometry'][key].items():
            new = current['geometry'][key].get(cid)
            if new is None or old['passed'] and not new['passed']:
                regressions.append(dict(metric='geometry', code='GEOMETRY_CHECK_LOST_OR_FAILED', check=cid))
            elif old['residualPixels'] is not None and new['residualPixels'] is not None:
                def maximum(value):
                    if isinstance(value,list):return max((maximum(v) for v in value),default=0)
                    return abs(value)
                if maximum(new['residualPixels']) > maximum(old['residualPixels'])+tolerance:
                    regressions.append(dict(metric='geometry',code='GEOMETRY_RESIDUAL_INCREASED',check=cid))
            elif old['residualPixels'] is not None and new['residualPixels'] is None:
                regressions.append(dict(metric='geometry',code='GEOMETRY_MEASUREMENT_LOST',check=cid))
    return regressions


def replay_identity(original, replayed):
    return dict(archiveBytesIdentical=original['archiveSha256']==replayed['archiveSha256'],
                layerBytesIdentical=original['layerSha256']==replayed['layerSha256'],
                previewBytesIdentical=original['previewSha256']==replayed['previewSha256'])


def replay(run, output, *, profile_local=False):
    """Allowlisted deterministic replay; no old authorizations/receipts are copied."""
    from . import received_diagnostic_delivery as diagnostic, host_layout_registration as layout
    from .host_sheet_fallback import review_runs
    from .local_profile import LocalProfile, archive_methods
    profiler=LocalProfile(profile_local)
    root, output = Path(run).resolve(), Path(output).resolve()
    if output.exists() or output.is_relative_to(root) or root.is_relative_to(output):
        raise ValueError('FRESH_BENCHMARK_REPLAY_OUTPUT_REQUIRED')
    if not inspect_run(root)['deliveryEvidenceUsable']:
        raise ValueError('BENCHMARK_COMPLETED_VERIFIED_RUN_REQUIRED')
    config = verified(root/'config.json')
    output.mkdir(parents=True)
    for name in ('reference.png','placements.json','evidence/revised-visual-plan.json','evidence/m1-draft.json'):
        source = root/'frozen'/name
        if source.is_file():
            target = output/'frozen'/name
            target.parent.mkdir(parents=True,exist_ok=True)
            shutil.copyfile(source,target)
    for name in ('frozen-layout-contract.json','inputs/layoutContract.json'):
        source = root/name
        if source.is_file():
            target = output/name;target.parent.mkdir(parents=True,exist_ok=True)
            shutil.copyfile(source,target)
    viewer = output/'viewer';viewer.mkdir()
    for name in ('viewer.html','viewer.js'):shutil.copyfile(root/'viewer'/name,viewer/name)
    config = dict(config,viewer=str(viewer))
    if config.get('layoutContract'):config['layoutContract']=str(output/'inputs/layoutContract.json')
    started = time.perf_counter()
    with host_timing.capture() as timings, scope():
        job = verified(root/'images/job.json')
        contract = profiler.call('prepare_received',diagnostic.prepare,root/'images',job['digest'],output/'diagnostic-contract',
            config['canvasPolicyInstruction'],sheet_composite_policy=config.get('sheetCompositePolicy'),
            background_policy=config['backgroundPolicy'],review_runs=review_runs(root) or None,
            body_job=root/'body' if (root/'body/job.json').is_file() else None)
        result = profiler.call('deliver_received',diagnostic.deliver,output/'diagnostic-contract',contract['diagnosticDigest'],
                                    output/'diagnostic-output',viewer)
        registration = profiler.call('register_layout',layout.finish,output,config)
    measurement = profiler.call('validate_artifacts',measure_delivery,output/'frozen',output/registration['delivery'],output/'layout-output',
                                   result.get('excludedUncertainMaterialIds',[]))
    measurement.update(executionCompleted=True,localSeconds=timings,elapsedSeconds=time.perf_counter()-started,
                       generationCalls=0,modelCalls=0,compositeReviewReplayed=False,humanVisualAcceptance=False)
    if profile_local:
        profile=profiler.report();profile['archiveMethods']=archive_methods(output)
        save(output/'local-profile.json',profile)
        measurement['localProfile']=dict(path='local-profile.json',sha256=digest(output/'local-profile.json'),
            policy=profile['policy'],overheadIncluded=True)
    save(output/'measurement.json',measurement)
    return measurement


def run_suite(suite_path, evidence_path, output, *, replay_received=False, profile_local=False):
    if profile_local and not replay_received:raise ValueError('LOCAL_PROFILE_REPLAY_REQUIRED')
    suite, evidence = read(Path(suite_path)), read(Path(evidence_path))
    output = Path(output).resolve()
    if output.exists():raise ValueError('FRESH_BENCHMARK_OUTPUT_REQUIRED')
    expected = {row['id']:row for row in suite['cases']}
    provided = {row['id']:row for row in evidence['cases']}
    if (len(expected)!=len(suite['cases']) or any(re.fullmatch(r'[a-z0-9][a-z0-9-]{0,63}',cid) is None for cid in expected)
            or len(provided)!=len(evidence['cases']) or set(expected)!=set(provided)):
        raise ValueError('EXACT_BENCHMARK_CASE_SET_REQUIRED')
    roots = [Path(p).resolve() for row in evidence['cases'] for p in row['attempts']]
    if any(output.is_relative_to(root) or root.is_relative_to(output) for root in roots):
        raise ValueError('BENCHMARK_OUTPUT_OVERLAPS_EVIDENCE')
    output.mkdir(parents=True)
    cases = []
    for cid, baseline in expected.items():
        paths = provided[cid]['attempts']
        if not paths:raise ValueError('ORDERED_BENCHMARK_ATTEMPTS_REQUIRED')
        attempts = [inspect_run(path) for path in paths]
        if any(row['referenceSha256'] != baseline['reference']['sha256'] for row in attempts):
            raise ValueError('BENCHMARK_REFERENCE_CHANGED')
        selected_index = max((i for i,row in enumerate(attempts) if row['executionCompleted']),default=-1)
        if selected_index == -1:
            selected_index = max((i for i,row in enumerate(attempts) if row.get('diagnosticDeliveryEvidenceUsable')),
                                 default=len(attempts)-1)
        selected = attempts[selected_index]
        if selected.get('referenceSha256') != baseline['reference']['sha256'] and selected['executionCompleted']:
            raise ValueError('BENCHMARK_REFERENCE_CHANGED')
        actual = dict(id=cid,firstAttemptCompleted=attempts[0]['executionCompleted'],
            firstAttemptBasis='first listed immutable attempt; later success never overwrites it',
            attemptCount=len(attempts),attempts=attempts,selected=selected,
            totalCallCounts={stage:sum(row['callCounts'][stage] for row in attempts) for stage in STAGES})
        if replay_received and selected['executionCompleted']:
            from .host_sheet_fallback import review_runs
            from .host_review import runtime_files
            runs = review_runs(paths[selected_index])
            incompatible = any(read(Path(path)/'request.json')['runtime'] != runtime_files() for path in runs)
            if incompatible:
                actual['replay'] = dict(status='requires-original-material-review-runtime',
                    generationCalls=0,modelCalls=0,historicalReviewBindingsChanged=False)
            else:
                replayed = (replay(paths[selected_index],output/cid,profile_local=True) if profile_local
                            else replay(paths[selected_index],output/cid))
                actual['replay'] = replayed
                actual['replayIdentity'] = replay_identity(selected,replayed)
                actual['selected'] = dict(selected,**replayed)
        actual['regressions'] = compare(baseline['baseline'],actual,suite.get('geometryTolerancePixels',2))
        if 'replayIdentity' in actual and not all(actual['replayIdentity'].values()):
            actual['regressions'].append(dict(metric='artifactIdentity',code='DETERMINISTIC_REPLAY_BYTES_CHANGED'))
        # Recheck immutable checkpoint AND inventory after read-only measurement too.
        after = [inspect_run(path) for path in paths]
        if any(old[key] != new[key] for old,new in zip(attempts,after)
               for key in ('checkpointSha256','observedInventorySha256')):
            raise ValueError('BENCHMARK_SOURCE_CHANGED')
        cases.append(actual)
    constraints=[check for row in cases for check in (row['selected'].get('geometry') or {}).get('constraints',{}).values()]
    internal=[check for row in cases for check in (row['selected'].get('geometry') or {}).get('internalChecks',{}).values()]
    result = dict(kind='ui_layer_complex_benchmark_v1',suiteSha256=digest(Path(suite_path)),
        evidenceSelectionSha256=digest(Path(evidence_path)),cases=cases,
        regressionCount=sum(len(row['regressions']) for row in cases),
        firstAttemptCompletedCount=sum(row['firstAttemptCompleted'] for row in cases),
        selectedExecutionCompletedCount=sum(row['selected']['executionCompleted'] for row in cases),
        failedDiagnosticMeasurementCount=sum(not row['selected']['executionCompleted'] and
            row['selected'].get('diagnosticDeliveryEvidenceUsable',False) for row in cases),
        inventoryCompleteCount=sum(bool((row['selected'].get('inventory') or {}).get('complete')) for row in cases),
        geometrySummary=dict(checkedConstraintCount=len(constraints),passedConstraintCount=sum(c['passed'] for c in constraints),
            checkedInternalCount=len(internal),passedInternalCount=sum(c['passed'] for c in internal),
            scope='result-declared checks only; excluded or unmodeled geometry not accepted'),
        generationCalls=0,modelCalls=0,humanVisualAcceptance=False,
        callCountBasis='consumed local reservations, not provider execution or billing telemetry',
        timingScope='new program measurements only; historical stage times remain unavailable')
    save(output/'report.json',result)
    return result


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action',choices=['benchmark'])
    for name in ('suite','evidence','output'):parser.add_argument('--'+name,required=True)
    parser.add_argument('--replay-received',action='store_true')
    parser.add_argument('--profile-local',action='store_true',help='Offline replay self-time costs; includes profiler overhead')
    args=parser.parse_args()
    result=run_suite(args.suite,args.evidence,args.output,replay_received=args.replay_received,profile_local=args.profile_local)
    print(json.dumps(result,ensure_ascii=False,allow_nan=False))
    if result['regressionCount']:raise SystemExit(1)
