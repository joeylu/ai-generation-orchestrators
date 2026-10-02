"""Offline mixed extraction exercises the real exchange and singleton reviewer."""
import _bootstrap
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from PIL import Image, ImageDraw
from jsonschema import ValidationError

from ai_ui_layers import delivery_dag as delivery, experimental_executor as exchange
from ai_ui_layers.evaluate import read, save, digest
from ai_ui_layers.extract_sheets import extract
from ai_ui_layers.freeze_visual import inspect
import test_visual_policy as fixtures

policy=fixtures.policy
overwrite=fixtures.overwrite


class MixedPolicyReviewTests(unittest.TestCase):
    def setUp(self):
        temporary=tempfile.TemporaryDirectory();self.addCleanup(temporary.cleanup)
        self.root=Path(temporary.name)
        image=self.root/'reference.png';Image.new('RGB',(1000,1000),(30,40,50)).save(image)
        policy_file=self.root/'policy.json';save(policy_file,policy())
        viewer=self.root/'viewer';viewer.mkdir()
        for name in ('viewer.html','viewer.js'):(viewer/name).write_text('fixture')
        self.run=delivery.init(image,self.root/'run',viewer,max_calls=16,visual_policy=policy_file)
        _,model=fixtures.VisualPolicyTests.model_with_policy_review()
        self.calls=[]
        self.dag=delivery.DeliveryDag(self.run,model,sheet_model=self.model,material_model=self.model)
        self.dag.execute();self.job=self.run/'generation'
        self.snapshot=self.job/'snapshot';self.sha=inspect(self.snapshot)['digest']
        self.rows=read(self.snapshot/'requests.json')['requests']
        self.singles=[r['asset'] for r in self.rows if r.get('kind')!='sheet']
        self.assertTrue(self.singles)
        self.assertTrue(any(r.get('kind')=='sheet' for r in self.rows))
        exchange.authorize(self.job,read(self.job/'job.json')['digest'],'offline fixture approval')
        while exchange.status(self.job)['status']=='ready':
            request=exchange.next_request(self.job)
            if 'materialIds' in request:
                columns,rows=request['grid'];raw=Image.new('RGBA',(columns*100,rows*100))
                draw=ImageDraw.Draw(raw)
                for i,_ in enumerate(request['materialIds']):
                    x=i%columns*100;y=i//columns*100
                    draw.rectangle((x+15,y+15,x+84,y+84),fill=(70,90,110,220))
            elif request['asset']=='asset-scene':raw=Image.new('RGB',(240,240),(40,50,60))
            else:
                raw=Image.new('RGBA',(240,240))
                ImageDraw.Draw(raw).rectangle((20,20,219,219),fill=(80,90,100,255))
            path=self.root/'raw.png';raw.save(path)
            exchange.receive(self.job,request['submissionDigest'],path)
        self.sources={r['asset']:str(self.job/'attempts'/r['asset']/'raw.png') for r in self.rows}
        self.jobs={key:self.job for key in self.singles}

    def model(self,folder):
        self.calls.append(folder)
        request=read(folder/'request.json')
        ids=request.get('materialIds',[request.get('materialId')])
        save(folder/'draft.json',dict(materialIds=ids,findings=[]))
        return dict(exitCode=0,turnCompleted=True,unexpectedEvents=[],
                    responseSha256=digest(folder/'draft.json'))

    def extraction(self,name='extraction',material_model=None,**kwargs):
        return extract(self.snapshot,self.sha,self.sources,self.root/name,self.model,
                       received_jobs=self.jobs,material_model=material_model or self.model,**kwargs)

    def test_complete_mixed_route_reviews_each_singleton_and_binds_receipts(self):
        before={p:digest(p) for p in self.job.rglob('*') if p.is_file()}
        result=self.extraction()
        self.assertEqual(result['modelCalls'],len(self.rows))
        self.assertEqual(len(self.calls),len(self.rows))
        self.assertFalse(result['humanVisualAcceptance'])
        plan=read(self.snapshot/'execution-plan.candidate.json')
        self.assertEqual(set(result['materials']),{m['id'] for m in plan['assets']})
        for key in self.singles:
            request=read(self.root/'extraction'/key/'review/request.json')
            receipt=exchange.verified(self.job/'attempts'/key/'received.json')
            self.assertEqual(request['submissionDigest'],receipt['submissionDigest'])
            self.assertEqual(request['jobDigest'],read(self.job/'job.json')['digest'])
            self.assertEqual(request['rawSha256'],digest(Path(self.sources[key])))
            self.assertEqual(request['visualPolicySha256'],inspect(self.snapshot)['visualPolicySha256'])
        self.assertEqual(before,{p:digest(p) for p in self.job.rglob('*') if p.is_file()})

    def test_missing_received_jobs_fails_before_any_model_call(self):
        with self.assertRaisesRegex(ValueError,'VISUAL_POLICY_SINGLE_REVIEW_ROUTE_REQUIRED'):
            extract(self.snapshot,self.sha,self.sources,self.root/'blocked',self.model)
        self.assertEqual(self.calls,[])
        self.assertEqual(read(self.root/'blocked/result.json')['modelCalls'],0)

    def test_wrong_source_fails_before_any_model_call(self):
        wrong=self.root/'wrong.png';Image.new('RGB',(240,240),(1,2,3)).save(wrong)
        self.sources[self.singles[0]]=str(wrong)
        with self.assertRaisesRegex(ValueError,'SINGLETON_RECEIVED_SOURCE_MISMATCH'):self.extraction()
        self.assertEqual(self.calls,[])

    def test_broken_receipt_binding_fails_before_any_model_call(self):
        path=self.job/'attempts'/self.singles[0]/'received.json'
        receipt=exchange.verified(path);receipt.pop('digest');receipt['submissionDigest']='0'*64
        from ai_ui_layers.freeze_visual import body_digest
        overwrite(path,dict(receipt,digest=body_digest(receipt)))  # Deliberate corrupt fixture.
        with self.assertRaisesRegex(ValueError,'RESULT_BINDING'):self.extraction()
        self.assertEqual(self.calls,[])

    def test_foreground_technical_gate_blocks_opaque_material_before_its_review(self):
        assets=read(self.snapshot/'execution-plan.candidate.json')['assets']
        key=next(a['id'] for a in assets if a['role']=='important_component' and a['id'] in self.singles)
        job=self.root/'opaque-job';config=exchange.prepare(self.snapshot,self.sha,job,[key])
        exchange.authorize(job,config['digest'],'offline fixture approval')
        request=exchange.next_request(job)
        raw=self.root/'opaque.png';Image.new('RGB',(240,240),(80,90,100)).save(raw)
        exchange.receive(job,request['submissionDigest'],raw)
        self.sources[key]=str(job/'attempts'/key/'raw.png');self.jobs[key]=job
        with self.assertRaisesRegex(ValueError,'SINGLETON_VISUAL_REVIEW_BLOCKED'):self.extraction()
        result=read(self.root/'extraction'/key/'result.json')
        self.assertEqual(result['reason'],'MATERIAL_GATE_FAILED')
        self.assertEqual(result['modelCalls'],0)
        self.assertTrue(all(read(folder/'request.json').get('materialId')!=key for folder in self.calls))

    def test_singleton_blocker_stops_remaining_reviews(self):
        def blocked(folder):
            result=self.model(folder);asset=read(folder/'request.json')['materialId']
            overwrite(folder/'draft.json',dict(materialIds=[asset],findings=[dict(
                materialId=asset,category='missing-artwork',styleAspect='other',
                referenceState='not-applicable',generatedState='not-applicable',
                magnitude='major',ownership='clear',evidence='Owned contour absent.',
                suggestion='Stop for a new decision.')]))
            result['responseSha256']=digest(folder/'draft.json');return result
        with self.assertRaisesRegex(ValueError,'SINGLETON_VISUAL_REVIEW_BLOCKED'):
            self.extraction(material_model=blocked)
        self.assertEqual(len(self.calls),1)
        self.assertEqual(read(self.root/'extraction/result.json')['modelCalls'],1)
        with self.assertRaises(FileExistsError):self.extraction()
        self.assertEqual(len(self.calls),1)

    def test_transport_failure_is_terminal_with_one_call(self):
        def failed(folder):
            self.calls.append(folder)
            save(folder/'transport.json',dict(exitCode=1,turnCompleted=False,unexpectedEvents=[]))
            raise ValueError('TRANSPORT_OR_ISOLATION_FAILURE')
        with self.assertRaisesRegex(ValueError,'SINGLETON_VISUAL_REVIEW_BLOCKED'):
            self.extraction(material_model=failed)
        self.assertEqual(len(self.calls),1)
        self.assertEqual(read(self.root/'extraction/result.json')['modelCalls'],1)

    def test_policy_schema_cannot_be_downgraded(self):
        def invalid(folder):
            result=self.model(folder);asset=read(folder/'request.json')['materialId']
            overwrite(folder/'draft.json',dict(materialIds=[asset],findings=[dict(
                materialId=asset,category='style',referenceState='not-applicable',
                generatedState='not-applicable',magnitude='minor',ownership='clear',
                evidence='Slight hue difference.',suggestion='Record.')]))
            result['responseSha256']=digest(folder/'draft.json');return result
        with self.assertRaises(ValidationError):self.extraction(material_model=invalid)
        self.assertEqual(len(self.calls),1)

    def test_receipt_mutation_during_review_fails_closed(self):
        def mutate(folder):
            result=self.model(folder)
            path=self.job/'attempts'/self.singles[0]/'received.json'
            path.write_bytes(path.read_bytes()+b' ')
            return result
        with self.assertRaisesRegex(ValueError,'SINGLETON_RECEIPT_CHANGED'):
            self.extraction(material_model=mutate)
        self.assertEqual(len(self.calls),1)

    def test_review_attachment_mutation_fails_closed(self):
        def mutate(folder):
            result=self.model(folder)
            path=folder/'prompt.md';path.write_text('changed',encoding='utf-8')
            return result
        with self.assertRaisesRegex(ValueError,'MATERIAL_REVIEW_INPUT_CHANGED'):
            self.extraction(material_model=mutate)
        self.assertEqual(len(self.calls),1)

    def test_warning_is_preserved_with_review_digest(self):
        def warning(folder):
            result=self.model(folder);asset=read(folder/'request.json')['materialId']
            overwrite(folder/'draft.json',dict(materialIds=[asset],findings=[dict(
                materialId=asset,category='style',styleAspect='color-tone',
                referenceState='not-applicable',generatedState='not-applicable',
                magnitude='minor',ownership='clear',evidence='Slightly warmer hue.',suggestion='Record.')]))
            result['responseSha256']=digest(folder/'draft.json');return result
        result=self.extraction(material_model=warning)
        self.assertEqual(len(result['warnings']),len(self.singles))
        self.assertEqual(len(result['decisions']),len(self.singles))
        self.assertTrue(all(w['reviewSha256'] and w['requestId'] in self.singles for w in result['warnings']))

    def test_automatic_dag_uses_distinct_material_and_sheet_models(self):
        material_calls=[]
        def material(folder):material_calls.append(folder);return self.model(folder)
        self.dag.material_model=material
        self.dag.collect_raw()
        self.assertEqual(len(material_calls),len(self.singles))
        self.assertEqual(len(self.calls),len(self.rows))
        self.assertTrue((self.run/'registration-input.json').is_file())

    def test_finish_received_routes_actual_job_before_registration(self):
        from ai_ui_layers.finish_received import finish
        with patch('ai_ui_layers.single_material_review.call_model',side_effect=self.model), \
             patch('ai_ui_layers.extract_sheets.call_model',side_effect=self.model), \
             patch('ai_ui_layers.finish_received.register',side_effect=ValueError('OFFLINE_REGISTRATION_STOP')), \
             patch('ai_ui_layers.finish_received.build') as build:
            with self.assertRaisesRegex(ValueError,'OFFLINE_REGISTRATION_STOP'):
                finish(self.job,read(self.job/'job.json')['digest'],self.root/'finished',self.root/'viewer')
            build.assert_not_called()
        self.assertEqual(len(self.calls),len(self.rows))
        self.assertEqual(read(self.root/'finished/extraction/result.json')['modelCalls'],len(self.rows))
        self.assertEqual(read(self.root/'finished/result.json')['stage'],'registration')


if __name__=='__main__':unittest.main()
