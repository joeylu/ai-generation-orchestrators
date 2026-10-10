"""Bound warning-mode fallback; a diagnostic export never certifies cutouts."""
from pathlib import Path

import numpy as np
from PIL import Image

from .evaluate import read, save, digest
from .experimental_executor import load_job, status, verified
from .extract_sheets import partition_cells
from .sheet_pixels import STRICT_SEAM


POLICY = 'diagnostic-on-sheet-partition-warning-v1'
LOCAL_POLICY = 'continue-reviewed-materials-on-sheet-warning-v2'
STOP = 'stop-v1'
FAST = 'final-composite-first-v1'
EXHAUSTIVE = 'every-reviewed-foreground-v1'
PREPARATION_POLICY = 'record-native-clipping-for-diagnostic-v1'
RECOVERABLE = frozenset(('SHEET_CONTOUR_TOUCHES_CELL_BOUNDARY',
    'SHEET_AMBIGUOUS_EMPTY_BANDS', 'SHEET_NEAREST_TRANSPARENT_SEAM_TIE',
    'SHEET_UNUSED_CELL_NOT_EMPTY'))


def configure(config):
    config.setdefault('sheetFailurePolicy', LOCAL_POLICY if config.get('visualReviewMode') == 'warning' else STOP)
    if config['sheetFailurePolicy'] not in (POLICY, LOCAL_POLICY, STOP):
        raise ValueError('HOST_SHEET_FAILURE_POLICY')
    if config['sheetFailurePolicy'] in (POLICY, LOCAL_POLICY) and config.get('visualReviewMode') != 'warning':
        raise ValueError('SHEET_DIAGNOSTIC_FALLBACK_REQUIRES_WARNING_MODE')
    config.setdefault('bodyReviewPolicy', FAST if local(config) else EXHAUSTIVE)
    if (config['bodyReviewPolicy'] not in (FAST,EXHAUSTIVE)
            or config['bodyReviewPolicy']==FAST and not local(config)):
        raise ValueError('BOUND_WARNING_BODY_REVIEW_POLICY_REQUIRED')
    from .host_material_review import IDENTITY_POLICY
    if local(config):
        config.setdefault('materialPreparationPolicy',PREPARATION_POLICY)
        config.setdefault('identityObservationPolicy',IDENTITY_POLICY)
    if 'materialPreparationPolicy' in config and (config['materialPreparationPolicy']!=PREPARATION_POLICY or not local(config)):
        raise ValueError('BOUND_WARNING_PREPARATION_POLICY_REQUIRED')
    if 'identityObservationPolicy' in config and (config['identityObservationPolicy']!=IDENTITY_POLICY or not local(config)):
        raise ValueError('BOUND_WARNING_IDENTITY_POLICY_REQUIRED')


def enabled(config):
    # Missing means historical stop behavior, even for an old warning-mode run.
    return config.get('visualReviewMode') == 'warning' and config.get('sheetFailurePolicy') in (POLICY, LOCAL_POLICY)


def local(config):
    return enabled(config) and config['sheetFailurePolicy'] == LOCAL_POLICY


def review_runs(root):
    excluded = {w['requestId'] for w in warnings(root) if w['category']=='material-preparation'}
    return sorted(str(p.parent) for p in (Path(root)/'reviews').glob('*/result.json') if p.parent.name not in excluded)


def warnings(root):
    root=Path(root); result=[]
    for name in ('sheet-fallback.json','material-preparation-fallback.json'):
        if (root/name).exists():result.extend(verified(root/name)['warnings'])
    for path in sorted((root/'material-identity-fallback').glob('*.json')):
        result.extend(verified(path)['warnings'])
    return result


def final_composite_first(config):
    return local(config) and config.get('bodyReviewPolicy')==FAST


def prepare_body(root, config):
    """New fast runs use no body calls; historical/exhaustive runs retain selection."""
    if final_composite_first(config):
        return False
    from . import received_diagnostic_delivery as diagnostic, host_body_observation
    from .diagnostic_material_replay import checked_reviews, candidate_sources
    root = Path(root)
    job = verified(root/'images/job.json')
    checked = diagnostic._checked(root/'images', job['digest'])
    replay = checked_reviews(checked, review_runs(root))
    unresolved = {w['requestId'] for w in warnings(root)}
    if set(replay['unreviewedRequestIds']) != unresolved:
        raise ValueError('SHEET_FALLBACK_REVIEW_COVERAGE_CHANGED')
    visual = checked[5]
    ids = sorted(m['id'] for m in visual['materials'] if m['role'] == 'foreground' and m['id'] in replay['materials'])
    if not ids:
        return False
    sources = candidate_sources(checked, root/'fallback-sources', replay)
    body_config = dict(snapshot=str(root/'frozen'), snapshotDigest=job['snapshotDigest'],
        materials=sources, materialAuthors=config['materialAuthors'], diagnosticMaterialIds=ids,
        canvasPolicy=config['canvasPolicy'], canvasPolicyInstruction=config['canvasPolicyInstruction'],
        canvasPolicyInstructionSha256=config['canvasPolicyInstructionSha256'], backgroundPolicy=config['backgroundPolicy'],
        maximumCallSeconds=config['maximumModelCallSeconds'], destination=config['bodyDestination'], reviewerId=config['bodyReviewer'])
    for key in ('bodyObservationPolicy','bodyFitPolicy','bodyCoveragePolicy','bodyUnresolvedPolicy'):
        if key in config:body_config[key] = config[key]
    save(root/'body-input.json', body_config)
    host_body_observation.prepare(root/'body-input.json',root/'body',config['maximumBodyCalls'],
        model=config['bodyModel'],effort=config['bodyEffort'])
    return True


def findings(job, config):
    """Check all sheets before reserving reviews; do not change raw pixels/files."""
    if not enabled(config):
        return []
    job = Path(job).resolve()
    actual, index = load_job(job)
    if status(job)['status'] != 'raw_complete':
        raise ValueError('COMPLETE_RECEIVED_REQUEST_SET_REQUIRED')
    from .freeze_visual import inspect
    from . import reuse_pipeline, material_reuse
    reuse = reuse_pipeline.snapshot_input(job/'snapshot', inspect(job/'snapshot',actual['snapshotDigest']))
    warnings = []
    for key in actual['assets']:
        row = index[key]
        if row.get('kind') != 'sheet':
            continue
        raw = job / 'attempts' / key / 'raw.png'
        receipt = verified(raw.parent / 'received.json')
        before = digest(raw)
        if before != receipt['rawSha256']:
            raise ValueError('RESULT_CHANGED')
        with Image.open(raw) as source:
            if ('A' not in source.getbands() or source.format != 'PNG'
                    or source.getexif().get(274, 1) != 1 or list(source.size) != receipt['size']):
                raise ValueError('RECEIVED_PNG_MISMATCH')
            pixels = np.array(source.convert('RGBA'))
        alpha = pixels[:, :, 3]
        if alpha.min() != 0 or alpha.max() <= 1:
            raise ValueError('SHEET_NATIVE_ALPHA_REQUIRED')
        # Mirror the existing preparation only in memory. Diagnostic exports
        # retain the *raw* RGBA, including these faint and hidden-RGB pixels.
        pixels[alpha <= 1] = 0
        try:
            partition_cells(Image.fromarray(pixels), row, config.get('sheetSeamPolicy', STRICT_SEAM))
        except ValueError as error:
            if str(error) not in RECOVERABLE:
                raise
            warnings.append(dict(category='sheet-partition', severity='warning',
                code=str(error), requestId=key, materialIds=material_reuse.expanded_ids(reuse,row['materialIds']),
                rawSha256=before, independentSeparationVerified=False,
                finalCompositeReviewPending=True))
        if digest(raw) != before:
            raise ValueError('SHEET_INPUT_CHANGED')
    return warnings


def build(root, config, warnings):
    """Finish a diagnostic; replay good reviews/observations under the v2 policy."""
    from . import received_diagnostic_delivery as diagnostic
    from . import host_body_observation
    from .body_viewport_delivery import BACKGROUND_POLICY
    root = Path(root)
    unresolved_body = host_body_observation.status(root/'body').get('unresolvedMaterialIds', []) if (root/'body/job.json').exists() else []
    if not enabled(config) or not warnings and not unresolved_body and not final_composite_first(config):
        raise ValueError('BOUND_SHEET_FALLBACK_REQUIRED')
    job = verified(root / 'images/job.json')
    runs = review_runs(root) if local(config) else []
    frozen = diagnostic.prepare(root / 'images', job['digest'], root / 'diagnostic-contract',
        config['canvasPolicyInstruction'],
        background_policy=BACKGROUND_POLICY if config['backgroundPolicy'] == BACKGROUND_POLICY else None,
        review_runs=runs or None, body_job=root/'body' if local(config) and (root/'body/job.json').exists() else None)
    if local(config):
        replay=verified(root/'diagnostic-contract/diagnostic.json').get('materialReplay')
        unreviewed=set(replay['unreviewedRequestIds']) if replay else set(job['assets'])
        if unreviewed!={w['requestId'] for w in warnings}:
            raise ValueError('SHEET_FALLBACK_REVIEW_COVERAGE_CHANGED')
    result = diagnostic.deliver(root / 'diagnostic-contract', frozen['diagnosticDigest'],
        root / 'diagnostic-output', config['viewer'])
    planning = read(root / 'frozen/planning-warnings.json')['warnings']
    records = [*warnings, *[w for w in result['qualityWarnings'] if w['requestId'] not in {r['requestId'] for r in warnings}]]
    review = result.get('materialReviewReplay', {})
    material_warnings = review.get('warnings', [])
    body = result.get('bodyReplay', {})
    unresolved_warnings = [dict(category='body-correspondence',severity='warning',
        code='BODY_OBSERVATION_UNRESOLVED',materialIds=[r['materialId']],
        responseSha256=r['responseSha256'],originalSealStatus=r['originalSealStatus'],
        sourceCompletenessAccepted=False) for r in body.get('unresolvedObservations', [])]
    records.extend(unresolved_warnings)
    body_warnings = [dict(materialId=r['materialId'], **{name:read(root/'body/attempts'/r['materialId']/'response.json')[name]
        for name in ('geometryDifferences','materialIssues')}) for r in body.get('replayedObservations', [])]
    body_count = sum(len(w['geometryDifferences'])+len(w['materialIssues']) for w in body_warnings)
    placement_warnings=[w for w in read(root/'diagnostic-output/visual-warning-report.json')['warnings']
        if w.get('code')=='BODY_OBSERVATION_NOT_AVAILABLE']
    report = dict(kind='ui_visual_warning_report_v1', deliveryMode='diagnostic',
        bodyReviewPolicy=config.get('bodyReviewPolicy',EXHAUSTIVE),
        sheetFailurePolicy=config['sheetFailurePolicy'], planning=planning, material=[*records,*material_warnings],
        body=body_warnings, placement=placement_warnings,
        warningCount=len(planning) + len(records) + len(material_warnings) + body_count + len(placement_warnings),
        diagnosticExecutionCompleted=True,
        executionCompleted=False, fullAutomaticDagPassed=False,
        strictVisualReviewPassed=False, humanVisualAcceptance=False,
        finalCompositeVisualAcceptancePending=True,
        unresolvedMaterialIds=sorted({mid for w in records for mid in w.get('materialIds', [])}),
        diagnosticDelivery='diagnostic-output/delivery', additionalGenerationCalls=0,
        replayGenerationCalls=0, replayModelCalls=0,
        **({'additionalModelCalls':0} if not local(config) else {}),
        reviewedRequestIds=review.get('reviewedRequestIds', []),
        observedMaterialIds=[r['materialId'] for r in body.get('replayedObservations', [])],
        continuedMaterialReviewCalls=len(runs), continuedBodyObservationCalls=
            len(body.get('replayedObservations', []))+len(body.get('unresolvedObservations', [])))
    save(root / 'visual-warning-report.json', report)
    return report
