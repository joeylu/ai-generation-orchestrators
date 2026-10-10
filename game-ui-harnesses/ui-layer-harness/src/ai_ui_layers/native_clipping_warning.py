"""Bound native-alpha clipping suspicion, for diagnostic warning output only."""
from pathlib import Path
from PIL import Image
from .evaluate import digest
from .postprocess_visual import assess


def native_clipping_evidence(raw, expected_sha, target, report, prepared):
    """A visual suspicion may produce a diagnostic, never an accepted cutout."""
    if (prepared.get('status') != 'blocked_no_retry'
            or prepared.get('reason') != 'MATERIAL_GATE_FAILED'
            or prepared.get('modelCalls') != 0
            or report.get('status') != 'blocked'
            or report.get('issues') != ['POSSIBLY_CLIPPED_SOURCE']
            or report.get('keyEvidence') != {'passed': True, 'route': 'native-alpha-preserved'}):
        return None
    raw = Path(raw)
    if digest(raw) != expected_sha:
        raise ValueError('RESULT_CHANGED')
    if (report.get('sourceSha256') != expected_sha
            or prepared.get('rawSha256') != expected_sha
            or report.get('targetSize') != list(target)):
        raise ValueError('PREPARATION_SOURCE_EVIDENCE_CHANGED')
    with Image.open(raw) as image:
        image.load()
        if image.format != 'PNG' or 'A' not in image.getbands() or image.getexif().get(274, 1) != 1:
            raise ValueError('RECEIVED_PNG_MISMATCH')
        actual = assess(image, target)
    if any(report.get(name) != value for name, value in actual.items()):
        raise ValueError('PREPARATION_VISUAL_REPORT_CHANGED')
    if actual['issues'] != ['POSSIBLY_CLIPPED_SOURCE']:
        raise ValueError('PREPARATION_NOT_VISUAL_CLIPPING')
    return dict(category='material-preparation', severity='warning',
        code='POSSIBLY_CLIPPED_SOURCE', rawSha256=expected_sha,
        originalPreparationStatus='blocked_no_retry', sourceCompletenessAccepted=False,
        independentSeparationVerified=False, finalCompositeReviewPending=True,
        additionalGenerationCalls=0, automaticRetries=0)
