import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from PIL import Image
from ai_ui_decomposition import workflow as w
from ai_ui_decomposition.common import read_json
from ai_ui_decomposition.workflow_review_bridge import export_review,receive_review


class ReviewBridgeTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.base=Path(self.tmp.name);self.job=self.base/'job'
        ref=self.base/'original.png';Image.new('RGB',(200,160),'#102030').save(ref)
        w.create_job(ref,self.job,factory='workflow_fixture:create',options={'reviewMode':'file'},fixture=True,stage_timeout=60)
        w.advance(self.job,allow_vision=True)
        w.authorize(self.job,read_json(self.job/'nodes/freeze/receipt.json')['data']['planDigest'])
        self.assignment=w.advance(self.job,allow_vision=True)
        self.assertEqual(self.assignment['status'],'awaiting_external')
        self.response=self.base/'response.json'
        self.write_response()
    def tearDown(self):self.tmp.cleanup()
    def write_response(self,decision='accept',score=90):
        self.response.write_text(json.dumps(dict(decision=decision,overall_score=score,checks={k:score for k in ['layout_fidelity','component_coverage','text_policy','cutout_cleanliness']},issues=[])),encoding='utf-8')
    def receive(self,digest=None):return receive_review(self.job,digest or self.assignment['requestDigest'],self.response)
    def test_accept_delivers_fixture_only_and_duplicate_rejected(self):
        status=self.receive();self.assertEqual(status['nextNode'],'deliver')
        with self.assertRaisesRegex(ValueError,'NOT_WAITING'):self.receive()
        status=w.advance(self.job);self.assertEqual(status['status'],'fixture_complete')
        self.assertFalse(status['human_visual_acceptance'])
        report=read_json(self.job/'nodes/review/output/review.json')
        self.assertEqual(report['reference_sha256'],read_json(self.job/'job.json')['referenceSha256'])
    def test_reject_blocks_delivery(self):
        self.write_response('reject',60);self.assertEqual(self.receive()['status'],'rejected')
        self.assertEqual(w.advance(self.job)['status'],'rejected');self.assertFalse((self.job/'nodes/deliver').exists())
    def test_invalid_schema_score_and_wrong_digest(self):
        with self.assertRaisesRegex(ValueError,'REQUEST_DIGEST'):self.receive('0'*64)
        self.write_response(score=60)
        with self.assertRaisesRegex(ValueError,'ACCEPT_POLICY'):self.receive()
        self.response.write_text('{"passed":true,"human_visual_acceptance":true}')
        with self.assertRaises(ValueError):self.receive()
        self.assertFalse((self.job/'nodes/review/receipt.json').exists())
    def test_changed_input_and_no_redispatch(self):
        with self.assertRaisesRegex(ValueError,'NO_RESUBMIT'):export_review(self.job)
        self.assertEqual(w.advance(self.job)['status'],'awaiting_external')
        (self.job/'nodes/review/output/input/preview.png').write_bytes(b'changed')
        with self.assertRaisesRegex(ValueError,'INPUT_CHANGED'):self.receive()
    def test_timeout_rejects_late_response(self):
        start=read_json(self.job/'nodes/review/started.json')['startedAt']
        with patch('ai_ui_decomposition.workflow_review_bridge.time.time',return_value=start+61):
            self.assertEqual(w.inspect_job(self.job)['status'],'timed_out')
            with self.assertRaisesRegex(ValueError,'NOT_WAITING'):self.receive()
            self.assertFalse((self.job/'nodes/review/receipt.json').exists())
    def test_interrupted_receive_never_replayed(self):
        import ai_ui_decomposition.common as common
        actual=common.write_json
        def fail(path,value):
            if Path(path).name=='review.json':raise RuntimeError('fixture crash')
            return actual(path,value)
        with patch.object(common,'write_json',side_effect=fail):
            with self.assertRaises(RuntimeError):self.receive()
        self.assertEqual(w.inspect_job(self.job)['status'],'indeterminate')
        with self.assertRaisesRegex(ValueError,'NOT_WAITING'):self.receive()


if __name__=='__main__':unittest.main()
