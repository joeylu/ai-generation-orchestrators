"""Exercise the real controller/file review bridge with synthetic offline art."""
import json
from pathlib import Path
import tempfile
import unittest
from PIL import Image
from ai_ui_decomposition import workflow as w
from ai_ui_decomposition.common import read_json,ContractError
from ai_ui_decomposition.workflow_review_bridge import export_review,receive_review


class StagedWorkflowTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.root=Path(self.tmp.name);ref=self.root/'original.png';Image.new('RGB',(200,160),'#102030').save(ref)
        self.job=self.root/'job'
        w.create_job(ref,self.job,factory='workflow_fixture:create',fixture=True,stage_timeout=60,
            options={'deliveryProfile':'staged-draft-v1','reviewMode':'file'})
        w.advance(self.job,allow_vision=True)
        w.authorize(self.job,read_json(self.job/'nodes/freeze/receipt.json')['data']['planDigest'])

    def response(self,assignment,decision):
        source=self.root/'review.json';score=90 if decision=='accept' else 50
        source.write_text(json.dumps(dict(decision=decision,overall_score=score,
            checks={k:score for k in ['layout_fidelity','component_coverage','text_policy','cutout_cleanliness']},issues=[])))
        return receive_review(self.job,assignment['requestDigest'],source)

    def test_yields_before_review_and_acceptance_runs_only_after_review(self):
        status=w.advance(self.job,allow_vision=True)
        self.assertEqual(status['status'],'awaiting_review')
        self.assertFalse((self.job/'nodes/review').exists())
        self.assertFalse((self.job/'nodes/acceptance').exists())
        assignment=export_review(self.job)
        self.assertEqual(w.advance(self.job)['status'],'awaiting_external')
        self.assertEqual(self.response(assignment,'accept')['nextNode'],'acceptance')
        self.assertEqual(w.advance(self.job)['status'],'fixture_complete')
        calls=(self.job/'fixture-calls.txt').read_text().splitlines()
        self.assertLess(calls.index('process'),calls.index('acceptance'))
        self.assertLess(calls.index('acceptance'),calls.index('deliver'))

    def test_rejected_preview_never_starts_expensive_acceptance(self):
        w.advance(self.job,allow_vision=True);assignment=export_review(self.job)
        self.assertEqual(self.response(assignment,'reject')['status'],'rejected')
        self.assertEqual(w.advance(self.job)['status'],'rejected')
        self.assertFalse((self.job/'nodes/acceptance').exists())
        self.assertFalse((self.job/'nodes/deliver').exists())

    def test_changed_preview_blocks_review_no_acceptance(self):
        w.advance(self.job,allow_vision=True)
        (self.job/'nodes/process/output/fixture-preview.png').write_bytes(b'changed')
        with self.assertRaisesRegex(ContractError,'ARTIFACT_CHANGED'):export_review(self.job)
        self.assertFalse((self.job/'nodes/acceptance').exists())
