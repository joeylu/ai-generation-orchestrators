"""Classify authenticated delivery outcomes without converting unknown to pass."""
from .common import read_json, require, sha256, safe_relative
from .delivery_pipeline import validate_state_receipt


def classify_delivery(receipt_path, candidate_sha):
    report=read_json(receipt_path)
    base=receipt_path.parent
    require(report.get('kind')=='ui_delivery_run_v1' and
            report.get('human_visual_acceptance') is False and
            report.get('sourceSha256')==candidate_sha,'WORKFLOW_ACCEPTANCE_BINDING')
    status=report.get('status')
    require(status in {'machine_checks_passed_human_review_required','blocked_reference'},
            'REPOSITORY_TECHNICAL_ACCEPTANCE_BLOCKED')
    paths={'stateful':base/'stateful/acceptance.json',
           'studio':base/'studio/receipt.json','referenceComparison':base/'reference/report.json'}
    for name,path in paths.items():
        entry=report.get(name,{})
        require(path.is_file() and sha256(path)==entry.get('receiptSha256'),
                'WORKFLOW_ACCEPTANCE_RECEIPT_CHANGED')
    validate_state_receipt(read_json(paths['stateful']),candidate_sha)
    studio=read_json(paths['studio'])
    require(studio.get('kind')=='ui_studio_receipt_v1' and studio.get('status')=='technical_passed' and
            studio.get('handoffSha256')==candidate_sha and
            studio.get('referenceEvidence',{}).get('status')=='byte_identical',
            'WORKFLOW_STUDIO_RECEIPT_REQUIRED')
    reference=read_json(paths['referenceComparison'])
    require(reference.get('kind')=='ui-reference-acceptance-report' and
            reference.get('inputSha256')==candidate_sha,'WORKFLOW_REFERENCE_BINDING')
    expected='blocked' if status=='blocked_reference' else 'technical_passed'
    require(reference.get('status')==expected and
            report['referenceComparison'].get('status')==expected,'WORKFLOW_REFERENCE_STATUS')
    comparison=reference.get('comparison',{})
    counts=comparison.get('counts',{})
    require(counts.get('failed')==0,'WORKFLOW_REFERENCE_VISUAL_FAILED')
    if expected=='technical_passed':
        require(counts.get('passed',0)>0 and counts.get('unverified')==0 and
                any(s.get('status')=='passed' and s.get('pixels',0)>0 for s in comparison.get('scopes',[])),
                'WORKFLOW_REFERENCE_COVERAGE_REQUIRED')
    unknown=reference.get('unknownFields',[])
    require(unknown==report['referenceComparison'].get('unknownFields',[]), 'WORKFLOW_UNKNOWN_CHANGED')
    require(isinstance(unknown,list) and all(isinstance(v,str) and v for v in unknown) and
            (bool(unknown) if expected=='blocked' else not unknown), 'WORKFLOW_UNKNOWN_REQUIRED')
    key='diagnosticCandidate' if expected=='blocked' else 'delivery'
    candidate=safe_relative(base,report[key]['path'])
    require(report[key]['sha256']==candidate_sha and sha256(candidate)==candidate_sha,
            'WORKFLOW_CANDIDATE_CHANGED')
    return dict(acceptance='blocked_reference' if expected=='blocked' else 'passed',
        referenceComparison=expected,unknownFields=unknown,human_visual_acceptance=False,
        candidate=candidate,receiptSha256=sha256(receipt_path))
