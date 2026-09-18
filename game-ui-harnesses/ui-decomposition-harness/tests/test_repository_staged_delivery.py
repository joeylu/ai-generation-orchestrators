"""No media/browser: real repository delivery code with offline receipt fixtures."""
from pathlib import Path
import shutil
import unittest
from unittest.mock import patch
import test_workflow_diagnostics as diagnostic_fixtures
from ai_ui_decomposition.common import write_json,read_json,sha256,ContractError
from ai_ui_decomposition.repository_workflow import RepositoryWorkflow
from ai_ui_decomposition import workflow


class RepositoryStagedDeliveryTests(unittest.TestCase):
    def setUp(self):
        # Reuse data builders, not inherited test methods or live result receipts.
        self.fixture=diagnostic_fixtures.DiagnosticTests();self.fixture.setUp();self.addCleanup(self.fixture.doCleanups)
        self.root=self.fixture.root;self.fixture.fixture()
        self.job=self.root/'job';self.job.mkdir()
        (self.job/'original.png').write_bytes(b'original fixture')
        self.rows={}
        for node,key,name,body in [('compile','plan','plan.json',b'{}'),('freeze','batch','batch.json',b'{}'),
                ('process','candidate','candidate.zip',self.fixture.candidate.read_bytes()),
                ('process','run_plan','run-plan.json',b'{}')]:
            p=self.job/'nodes'/node/'output'/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(body)
            self.rows.setdefault(node,dict(artifacts={} ))['artifacts'][key]=dict(path=name,sha256=sha256(p))
        self.rows['review']=dict(data={'decision':'accept'})
        self.options=dict(componentRoot=str(self.root),deliveryProfile='staged-draft-v1')
        self.spec=dict(fixture=False,reference='original.png',stageTimeout=30,options=self.options)
        self.adapter=RepositoryWorkflow(self.options)

    def call(self,node):
        out=self.job/'nodes'/node/'output';out.mkdir(parents=True)
        result=self.adapter.run(dict(job=str(self.job),output=str(out),node=node,
            spec=self.spec,receipts=self.rows,timeoutSeconds=30))
        refs=workflow._validate_result(node,result,out,self.spec)
        self.rows[node]=dict(data=result['data'],artifacts=refs)
        return result,out

    def fake_acceptance(self,plan,root,out,seconds):
        out.mkdir(parents=True)
        for name in ('delivery-run.json','candidate.zip','stateful','studio','reference'):
            source=self.root/name;target=out/name
            if source.is_dir():shutil.copytree(source,target)
            else:shutil.copyfile(source,target)
        return read_json(out/'delivery-run.json')

    def test_real_adapter_preserves_diagnostic_archive_and_sidecars(self):
        with patch('ai_ui_decomposition.delivery_pipeline.run_delivery',side_effect=self.fake_acceptance) as run:
            result,_=self.call('acceptance');run.assert_called_once()
        self.assertEqual(result['data']['acceptance'],'blocked_reference')
        delivered,out=self.call('deliver')
        self.assertEqual((out/'ui.component-handoff.draft.zip').read_bytes(),self.fixture.candidate.read_bytes())
        diagnostic=read_json(out/'diagnostic.json')
        self.assertFalse(diagnostic['acceptedFinal']);self.assertFalse(diagnostic['human_visual_acceptance'])
        self.assertEqual(diagnostic['unknownFields'],['search.focused'])
        self.assertEqual(delivered['data']['referenceComparison'],'blocked')

    def test_review_rejection_prevents_acceptance_call(self):
        self.rows['review']['data']['decision']='reject'
        with patch('ai_ui_decomposition.delivery_pipeline.run_delivery') as run:
            with self.assertRaisesRegex(ContractError,'REVIEW_REQUIRED'):self.call('acceptance')
            run.assert_not_called()

    def test_changed_candidate_after_acceptance_prevents_delivery(self):
        with patch('ai_ui_decomposition.delivery_pipeline.run_delivery',side_effect=self.fake_acceptance):self.call('acceptance')
        (self.job/'nodes/process/output/candidate.zip').write_bytes(b'changed')
        with self.assertRaisesRegex(ContractError,'INPUT_CHANGED'):self.call('deliver')
