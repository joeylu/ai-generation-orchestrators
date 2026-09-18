"""Offline receipt doubles test classification; no claimed browser execution."""
import tempfile
from pathlib import Path
import unittest
from ai_ui_decomposition.common import write_json,read_json,sha256,ContractError
from ai_ui_decomposition.workflow_diagnostics import classify_delivery


class DiagnosticTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.root=Path(self.tmp.name);self.candidate=self.root/'candidate.zip'
        self.candidate.write_bytes(b'offline fixture, not a delivered archive');self.sha=sha256(self.candidate)

    def fixture(self,status='blocked_reference',unknown=None,failed=0):
        unknown=['search.focused'] if unknown is None else unknown
        state=dict(kind='ui_state_acceptance_v1',status='technical_passed',handoffSha256=self.sha,
            scope={'mode':'full'},layoutCoverage='required_checked',visualObservationCoverage='checked',visualObservationSha256='a'*64)
        studio=dict(kind='ui_studio_receipt_v1',status='technical_passed',handoffSha256=self.sha,referenceEvidence={'status':'byte_identical'})
        expected='blocked' if status=='blocked_reference' else 'technical_passed'
        ref=dict(kind='ui-reference-acceptance-report',inputSha256=self.sha,status=expected,unknownFields=unknown,
            comparison={'counts':{'failed':failed,'passed':0 if unknown else 1,'unverified':1 if unknown else 0},'scopes':[{'status':'passed','pixels':1}]})
        report=dict(kind='ui_delivery_run_v1',status=status,sourceSha256=self.sha,human_visual_acceptance=False)
        for key,name,body in [('stateful','stateful/acceptance.json',state),('studio','studio/receipt.json',studio),('referenceComparison','reference/report.json',ref)]:
            write_json(self.root/name,body);report[key]=dict(status=body['status'],receiptSha256=sha256(self.root/name))
        report['referenceComparison']['unknownFields']=unknown
        report['diagnosticCandidate' if unknown else 'delivery']=dict(path='candidate.zip',sha256=self.sha)
        write_json(self.root/'delivery-run.json',report)
        return self.root/'delivery-run.json'

    def test_unknown_remains_blocked_and_same_candidate(self):
        result=classify_delivery(self.fixture(),self.sha)
        self.assertEqual(result['acceptance'],'blocked_reference')
        self.assertEqual(result['unknownFields'],['search.focused'])
        self.assertEqual(result['candidate'],self.candidate)
        self.assertFalse(result['human_visual_acceptance'])

    def test_reference_pass_remains_distinct(self):
        result=classify_delivery(self.fixture('machine_checks_passed_human_review_required',[]),self.sha)
        self.assertEqual(result['acceptance'],'passed')

    def test_failed_comparison_cannot_escape_as_unknown_draft(self):
        with self.assertRaisesRegex(ContractError,'VISUAL_FAILED'):
            classify_delivery(self.fixture(failed=1),self.sha)

    def test_technical_failure_cannot_be_diagnostic_success(self):
        with self.assertRaisesRegex(ContractError,'TECHNICAL_ACCEPTANCE_BLOCKED'):
            classify_delivery(self.fixture('failed'),self.sha)

    def test_tampered_receipt_and_changed_reviewed_candidate_reject(self):
        report=self.fixture()
        with self.assertRaisesRegex(ContractError,'BINDING'):classify_delivery(report,'0'*64)
        (self.root/'studio/receipt.json').write_text('{}')
        with self.assertRaisesRegex(ContractError,'RECEIPT_CHANGED'):classify_delivery(report,self.sha)

    def test_missing_unknown_cannot_label_blocked_as_diagnostic(self):
        with self.assertRaisesRegex(ContractError,'UNKNOWN_REQUIRED'):
            classify_delivery(self.fixture(unknown=[]),self.sha)
