import _bootstrap  # Enable source-layout imports for unittest discovery.
import tempfile
import json
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
        self.review_calls=[]
        mock_review=patch('ai_ui_layers.single_material_review.call_model',
                          side_effect=lambda folder:DeliveryTests.fixture_review(self,folder))
        mock_review.start();self.addCleanup(mock_review.stop)

    def fixture_review(self,folder):
        key=read(folder/'request.json')['materialId'];self.review_calls.append(key)
        save(folder/'draft.json',dict(materialIds=[key],findings=[]))
        return dict(exitCode=0,turnCompleted=True,unexpectedEvents=[],
                    responseSha256=digest(folder/'draft.json'))

    def test_user_notes_bound_through_all_planning_turns_and_tamper_blocks(self):
        notes=self.root/'notes.txt';notes.write_text('The pale inner strip is the thumb.',encoding='utf-8')
        run=delivery.init(self.image,self.root/'with-notes',self.viewer,planning_notes=notes)
        notes.write_text('External source changed after init.',encoding='utf-8')
        model=FakeModel(repair=True);result=delivery.DeliveryDag(run,model).execute()
        self.assertEqual(result['status'],'awaiting_authorization')
        for stage in ['m1','m2','repair','rereview']:
            prompt=(run/'planning'/stage/'prompt.md').read_text(encoding='utf-8')
            self.assertIn('The pale inner strip is the thumb.',prompt)
            self.assertNotIn('External source changed',prompt)
        for path in [run/'.dag/inputs/planning-notes.txt',run/'planning/.dag/inputs/planning-notes.txt']:
            data=path.read_bytes();path.write_text('tampered',encoding='utf-8')
            with self.assertRaisesRegex(ValueError,'INPUT_CHANGED'):
                delivery.DeliveryDag(run,model).verify()
            path.write_bytes(data)

    def complete_media(self, clipped=False):
        job = self.run/'generation'; config = read(job/'job.json')
        exchange.authorize(job,config['digest'],'fixture authorization only')
        roles = {a['id']:a['role'] for a in read(job/'snapshot/execution-plan.candidate.json')['assets']}
        while exchange.status(job)['status'] == 'ready':
            request = exchange.next_request(job)
            raw = self.root/'raw.png'
            im = Image.new('RGBA',(1000,1000),(25,40,60,255) if roles[request['asset']]=='background' else (0,0,0,0))
            if roles[request['asset']] != 'background': ImageDraw.Draw(im).rectangle((0 if clipped else 100,100,899,899),fill=(80,90,100,255))
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
        roles={a['id']:a['role'] for a in read(self.run/'generation/snapshot/execution-plan.candidate.json')['assets']}
        self.assertEqual(set(self.review_calls),{key for key,role in roles.items() if role!='background'})
        self.assertEqual(len(self.review_calls),len(set(self.review_calls)))
        self.assertEqual(len(self.model.calls),2)
        self.assertFalse(result['humanVisualAcceptance'])

    def finding_model(self,category='style',magnitude='major'):
        def model(folder):
            key=read(folder/'request.json')['materialId'];self.review_calls.append(key)
            save(folder/'draft.json',dict(materialIds=[key],findings=[dict(materialId=key,
                category=category,magnitude=magnitude,ownership='clear',referenceState='not-applicable',
                generatedState='not-applicable',evidence='The received artwork is brighter.',
                suggestion='Compare the original colors.')]))
            return dict(exitCode=0,turnCompleted=True,unexpectedEvents=[],responseSha256=digest(folder/'draft.json'))
        return model

    def test_visual_blocker_stops_before_registration_and_cannot_resume(self):
        self.dag.execute();self.complete_media()
        self.dag.material_model=self.finding_model()
        with patch('ai_ui_layers.delivery_dag.register',side_effect=AssertionError('must not register')):
            with self.assertRaisesRegex(ValueError,'SINGLE_MATERIAL_REVIEW_BLOCKED'):self.dag.execute()
            with self.assertRaisesRegex(ValueError,'NO_RESUBMIT'):self.dag.execute()
        self.assertEqual(len(self.review_calls),1)
        result=self.dag.status()
        self.assertEqual(result['status'],'stopped_no_retry')
        self.assertEqual(result['materialReview']['records'][0]['blockers'][0]['category'],'style')
        self.assertFalse((self.run/'registration-input.json').exists())
        self.assertFalse((self.run/'delivery').exists())

    def test_review_transport_failure_stops_without_retry_or_delivery(self):
        self.dag.execute();self.complete_media()
        def failed(folder):
            self.review_calls.append(folder)
            save(folder/'transport.json',dict(exitCode=1,turnCompleted=False,unexpectedEvents=[]))
            raise ValueError('TRANSPORT_OR_ISOLATION_FAILURE')
        self.dag.material_model=failed
        with self.assertRaisesRegex(ValueError,'SINGLE_MATERIAL_REVIEW_BLOCKED'):self.dag.execute()
        with self.assertRaisesRegex(ValueError,'NO_RESUBMIT'):self.dag.execute()
        self.assertEqual(len(self.review_calls),1)
        self.assertEqual(self.dag.status()['materialReview']['records'][0]['status'],'indeterminate_review_no_retry')
        self.assertFalse((self.run/'registration').exists())

    def test_warning_is_bound_into_package_and_review_tampering_blocks_resume(self):
        self.dag.execute();self.complete_media()
        self.dag.material_model=self.finding_model(magnitude='minor')
        with patch('ai_ui_layers.delivery_dag.register',side_effect=self.fixture_registration):
            result=self.dag.execute()
        self.assertEqual(result['status'],'delivered_pending_visual_review')
        import zipfile
        with zipfile.ZipFile(self.run/'delivery/ui-layers.zip') as archive:
            review=json.loads(archive.read('review.json'))
        warning=result['materialReview']['warnings'][0]
        self.assertTrue(any(warning['reviewSha256'] in issue for issue in review['issues']))
        self.assertFalse(review['humanVisualAcceptance'])
        response=next((self.run/'material-review').glob('*/review/draft.json'))
        response.write_text('{}',encoding='utf-8')
        with self.assertRaisesRegex(ValueError,'COMPLETED_OUTPUT_CHANGED'):self.dag.execute()

    def test_malformed_review_never_reaches_registration(self):
        self.dag.execute();self.complete_media()
        def malformed(folder):
            self.review_calls.append(folder);save(folder/'draft.json',dict(materialIds=[],findings=[]))
            return dict(exitCode=0,turnCompleted=True,unexpectedEvents=[],responseSha256=digest(folder/'draft.json'))
        self.dag.material_model=malformed
        with self.assertRaisesRegex(ValueError,'SHEET_IDENTITY_MISMATCH'):self.dag.execute()
        with self.assertRaisesRegex(ValueError,'NO_RESUBMIT'):self.dag.execute()
        self.assertEqual(len(self.review_calls),1)
        self.assertFalse((self.run/'registration').exists())

    def test_clipped_raw_stops_before_any_visual_model_call(self):
        self.dag.execute();self.complete_media(clipped=True)
        with self.assertRaisesRegex(ValueError,'MATERIAL_GATE_FAILED'):self.dag.execute()
        self.assertEqual(self.review_calls,[])
        self.assertEqual(self.dag.status()['materialReview']['modelCalls'],0)
        self.assertFalse((self.run/'registration').exists())

    def test_interrupted_review_is_not_dispatched_again(self):
        self.dag.execute();self.complete_media()
        def interrupted(folder):
            self.review_calls.append(folder)
            raise KeyboardInterrupt('interrupted after dispatch')
        self.dag.material_model=interrupted
        with self.assertRaises(KeyboardInterrupt):self.dag.execute()
        self.assertEqual(self.dag.status()['status'],'stopped_no_retry')
        with self.assertRaisesRegex(ValueError,'NO_RESUBMIT'):self.dag.execute()
        self.assertEqual(len(self.review_calls),1)
        self.assertFalse((self.run/'delivery').exists())

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

    def test_frozen_strip_policy_flows_to_registration_and_binds_derived_files(self):
        fake=FakeModel()
        def model(folder,sid,first):
            fake(folder,sid,first)
            if first:
                plan=read(folder/'draft.json')
                plan['materials'].append(dict(id='plain-strip',label='Plain thumb',role='foreground',
                    zOrder=255,bboxNorm=[.95,.1,.96,.9],preserveText=[],adaptationPolicy='simple-strip'))
                plan['objects'].append(dict(id='thumb-object',label='Plain thumb',kind='decoration',
                    bboxNorm=[.95,.1,.96,.9],materialId='plain-strip'))
                (folder/'draft.json').write_text(json.dumps(plan),encoding='utf-8')
                receipt=read(folder/'transport.json');receipt['responseSha256']=digest(folder/'draft.json')
                (folder/'transport.json').write_text(json.dumps(receipt),encoding='utf-8')
        dag=delivery.DeliveryDag(self.run,model)
        self.assertEqual(dag.execute()['status'],'awaiting_authorization')
        self.complete_media()
        dag.node('raw_complete',dag.collect_raw)
        inputs=read(self.run/'registration-input.json')
        derived=self.run/'adaptation/plain-strip/adapted.png'
        self.assertEqual(Path(inputs['materials']['plain-strip']),derived)
        evidence=read(self.run/'adaptation/result.json')['materials']['plain-strip']
        self.assertEqual(evidence['targetArtworkSize'],[10,800])
        self.assertFalse(evidence['generationRatioAccurate'])
        self.assertEqual(evidence['sourceSha256'],digest(self.run/'generation/attempts/plain-strip/raw.png'))
        self.assertEqual(evidence['outputSha256'],digest(derived))
        dag.verify()
        with patch('ai_ui_layers.delivery_dag.register',side_effect=self.fixture_registration):
            result=dag.execute()
        self.assertEqual(result['status'],'delivered_pending_visual_review')
        self.assertFalse(result['humanVisualAcceptance'])
        derived.write_bytes(b'tamper')
        with self.assertRaisesRegex(ValueError,'COMPLETED_OUTPUT_CHANGED'):dag.verify()

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
