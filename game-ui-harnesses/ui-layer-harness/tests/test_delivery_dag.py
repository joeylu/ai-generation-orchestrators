import _bootstrap  # Enable source-layout imports for unittest discovery.
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from PIL import Image, ImageDraw
from ai_ui_layers import delivery_dag as delivery
from ai_ui_layers import experimental_executor as exchange
from ai_ui_layers.evaluate import read, save, digest
from ai_ui_layers.preview_partial import preview
from test_planning_dag import FakeModel


class DeliveryTests(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory(); self.addCleanup(tmp.cleanup)
        self.root = Path(tmp.name)
        self.image = self.root/'reference.png'; Image.new('RGB',(1000,1000)).save(self.image)
        self.viewer = self.root/'viewer'; self.viewer.mkdir()
        (self.viewer/'viewer.html').write_text('<html></html>')
        (self.viewer/'viewer.js').write_text('void 0;')
        self.run = delivery.init(self.image,self.root/'run',self.viewer)
        self.model = FakeModel(); self.dag = delivery.DeliveryDag(self.run,self.model)

    def complete_media(self):
        job = self.run/'generation'; config = read(job/'job.json')
        exchange.authorize(job,config['digest'],'fixture authorization only')
        roles = {a['id']:a['role'] for a in read(job/'snapshot/execution-plan.candidate.json')['assets']}
        while exchange.status(job)['status'] == 'ready':
            request = exchange.next_request(job)
            raw = self.root/'raw.png'
            im = Image.new('RGBA',(1000,1000),(25,40,60,255) if roles[request['asset']]=='background' else (0,0,0,0))
            if roles[request['asset']] != 'background': ImageDraw.Draw(im).rectangle((100,100,899,899),fill=(80,90,100,255))
            im.save(raw); exchange.receive(job,request['submissionDigest'],raw)

    @staticmethod
    def fixture_registration(config, output, model_call=None):
        output.mkdir()
        preview(config,output/'preview')
        save(output/'result.json',dict(driver='injected-test-double',humanVisualAcceptance=False))

    def test_authorization_wait_then_delivery_and_idempotent_resume(self):
        result = self.dag.execute()
        self.assertEqual(result['status'],'awaiting_authorization')
        self.assertEqual(len(self.model.calls),2)
        self.assertEqual(self.dag.execute()['status'],'awaiting_authorization')
        self.assertFalse((self.run/'registration').exists())
        self.complete_media()
        with patch('ai_ui_layers.delivery_dag.register',side_effect=self.fixture_registration) as reg:
            result = self.dag.execute()
            self.assertEqual(result['status'],'delivered_pending_visual_review')
            before = digest(self.run/'delivery/ui-layers.zip')
            self.dag.execute()
            self.assertEqual(before,digest(self.run/'delivery/ui-layers.zip'))
            self.assertEqual(reg.call_count,1)
        self.assertEqual(len(self.model.calls),2)
        self.assertFalse(result['humanVisualAcceptance'])

    def test_pending_media_is_never_resubmitted(self):
        self.dag.execute(); job=self.run/'generation'
        exchange.authorize(job,read(job/'job.json')['digest'],'fixture')
        request=exchange.next_request(job)
        self.assertEqual(self.dag.execute()['status'],'awaiting_result')
        with self.assertRaisesRegex(ValueError,'NOT_READY'):exchange.next_request(job)
        self.assertEqual(exchange.status(job)['assignedCalls'],1)
        exchange.fail(job,request['submissionDigest'],'fixture indeterminate')
        self.assertEqual(self.dag.execute()['status'],'blocked_no_resubmit')
        self.assertFalse((self.run/'registration').exists())

    def test_localization_failure_stops_package_and_no_retry(self):
        self.dag.execute(); self.complete_media()
        with patch('ai_ui_layers.delivery_dag.register',side_effect=TimeoutError('uncertain model')) as reg:
            with self.assertRaises(TimeoutError):self.dag.execute()
            with self.assertRaisesRegex(ValueError,'NO_RESUBMIT'):self.dag.execute()
            self.assertEqual(reg.call_count,1)
        self.assertFalse((self.run/'delivery').exists())

    def test_changed_raw_or_viewer_rejected_before_downstream(self):
        self.dag.execute(); self.complete_media()
        job=self.run/'generation'; raw=next((job/'attempts').glob('*/raw.png'))
        raw.write_bytes(b'changed')
        with self.assertRaisesRegex(ValueError,'RESULT_CHANGED'):self.dag.execute()
        (self.run/'.dag/inputs/viewer.js').write_text('changed')
        with self.assertRaisesRegex(ValueError,'INPUT_CHANGED'):self.dag.execute()

    def test_frozen_target_skips_media_and_package(self):
        root=delivery.init(self.image,self.root/'frozen-only',target='frozen')
        result=delivery.DeliveryDag(root,FakeModel()).execute()
        self.assertEqual(result['status'],'frozen')
        self.assertFalse((root/'generation').exists())

    def test_resume_after_registration_does_not_repeat_localization(self):
        self.dag.execute(); self.complete_media()
        self.dag.node('raw_complete',self.dag.collect_raw)
        self.dag.node('registration',lambda:self.fixture_registration(
            self.run/'registration-input.json',self.run/'registration'))
        with patch('ai_ui_layers.delivery_dag.register',side_effect=AssertionError('must not rerun')):
            self.assertEqual(self.dag.execute()['status'],'delivered_pending_visual_review')

    def test_planning_checkpoint_can_continue_in_nested_dag(self):
        from ai_ui_layers import planning_dag
        plan=planning_dag.init(self.run/'.dag/inputs/reference.png',self.run/'planning',12)
        nested=planning_dag.Dag(plan,self.model)
        nested.node('m1',nested.m1)
        self.assertEqual(self.dag.execute()['status'],'awaiting_authorization')
        self.assertEqual(len(self.model.calls),2)

    def test_nested_planning_failure_is_reported_as_stopped(self):
        def unavailable(folder,sid,first):raise TimeoutError('fixture connection failure')
        dag=delivery.DeliveryDag(self.run,unavailable)
        with self.assertRaises(TimeoutError):dag.execute()
        self.assertEqual(dag.status()['status'],'stopped_no_retry')
        self.assertFalse((self.run/'generation').exists())


if __name__ == '__main__': unittest.main()
