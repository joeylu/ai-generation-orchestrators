import copy
from pathlib import Path
import tempfile
import time
import unittest
from PIL import Image
from ai_ui_decomposition import workflow as w
from ai_ui_decomposition.common import ContractError,read_json,sha256
from ai_ui_decomposition.vision_draft import compile_draft
from workflow_fixture import draft


class WorkflowTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.root=Path(self.tmp.name);self.ref=self.root/'ref.png';Image.new('RGB',(200,160),'#102030').save(self.ref);self.job=self.root/'job'
    def tearDown(self):self.tmp.cleanup()
    def create(self,options=None,**kwargs):
        return w.create_job(self.ref,self.job,factory='workflow_fixture:create',options=options,stage_timeout=kwargs.pop('stage_timeout',15),fixture=True,**kwargs)
    def advance(self,**kwargs):return w.advance(self.job,allow_vision=True,**kwargs)
    def approve(self):
        frozen=w._read(self.job/'nodes/freeze/receipt.json');return w.authorize(self.job,frozen['data']['planDigest'])
    def calls(self):return (self.job/'fixture-calls.txt').read_text().splitlines()
    def test_full_offline_dag_and_repeat_no_calls(self):
        self.create();r=self.advance();self.assertEqual(r['status'],'awaiting_authorization');self.assertNotIn('generate',self.calls())
        self.assertEqual(sha256(self.ref),sha256(self.job/'input/original.png'))
        self.approve();r=self.advance();self.assertEqual(r['status'],'fixture_complete')
        calls=self.calls();self.assertEqual(self.advance()['status'],'fixture_complete');self.assertEqual(calls,self.calls())
        self.assertFalse(r['human_visual_acceptance'])
    def test_one_repair(self):
        self.create({'invalid':'once'});self.assertEqual(self.advance()['status'],'awaiting_authorization');self.assertEqual(self.calls().count('repair'),1)
    def test_two_invalid_responses_terminal(self):
        self.create({'invalid':'twice'});self.assertEqual(self.advance()['status'],'rejected');calls=self.calls();self.advance();self.assertEqual(calls,self.calls());self.assertNotIn('freeze',calls)
    def test_vision_permission_before_start(self):
        self.create()
        with self.assertRaisesRegex(ContractError,'VISION_AUTHORIZATION'):w.advance(self.job)
        self.assertFalse((self.job/'nodes').exists())
    def test_wrong_authorization(self):
        self.create();self.advance()
        with self.assertRaisesRegex(ContractError,'PLAN_MISMATCH'):w.authorize(self.job,'0'*64)
        self.assertFalse((self.job/'authorization.json').exists())
    def test_hard_timeout_and_no_retry(self):
        self.create({'slow':'vision'},stage_timeout=1);started=time.monotonic();self.assertEqual(self.advance()['status'],'timed_out');self.assertLess(time.monotonic()-started,4)
        calls=self.calls();self.advance();self.assertEqual(calls,self.calls())
    def test_provider_failure_redacted_and_not_retried(self):
        self.create({'crash':'generate'});self.advance();self.approve();self.assertEqual(self.advance()['status'],'failed');calls=self.calls();self.advance();self.assertEqual(calls,self.calls())
        self.assertNotIn('token=',(self.job/'nodes/generate/receipt.json').read_text())
    def test_completed_stage_resume(self):
        self.create();self.advance(max_nodes=1);self.assertEqual(self.advance()['status'],'awaiting_authorization');self.assertEqual(self.calls().count('vision'),1)
    def test_artifact_tamper(self):
        self.create();self.advance(max_nodes=1);(self.job/'nodes/vision/output/response.json').write_text('{}')
        with self.assertRaisesRegex(ContractError,'ARTIFACT_CHANGED'):self.advance()
    def test_reference_tamper(self):
        self.create();(self.job/'input/original.png').write_bytes(b'changed')
        with self.assertRaisesRegex(ContractError,'REFERENCE_CHANGED'):self.advance()
    def test_pending_external_forbids_recovery(self):
        self.create();spec=w._read(self.job/'job.json');w._record(self.job/'nodes/vision/started.json',dict(jobDigest=spec['digest'],node='vision',dependencies={},startedAt=time.time()))
        self.assertEqual(self.advance()['status'],'indeterminate')
        with self.assertRaisesRegex(ContractError,'RECOVERY_FORBIDDEN'):w.recover_local(self.job,'vision')
    def test_local_crash_recovery_preserves_history(self):
        self.create();self.advance(max_nodes=1);spec=w._read(self.job/'job.json');rows=w._receipts(self.job,spec)
        w._record(self.job/'nodes/compile/started.json',dict(jobDigest=spec['digest'],node='compile',dependencies={k:v['digest'] for k,v in rows.items()},startedAt=time.time()))
        w.recover_local(self.job,'compile');self.assertTrue((self.job/'recovered/compile/started.json').exists());self.assertEqual(self.advance()['status'],'awaiting_authorization')
    def test_bad_paths_rejected(self):
        with self.assertRaises(ContractError):w._validate_result('vision',dict(status='ok',data={},artifacts={'bad':'../outside'}),self.root,{})
    def test_rejected_review_stops_delivery(self):
        self.create({'review':'reject'});self.advance();self.approve();self.assertEqual(self.advance()['status'],'rejected');self.assertNotIn('deliver',self.calls())
    def test_review_permission_before_start(self):
        self.create();self.advance();self.approve()
        with self.assertRaisesRegex(ContractError,'VISION_AUTHORIZATION'):w.advance(self.job)
        self.assertNotIn('review',self.calls());self.assertEqual(self.advance()['status'],'fixture_complete')
    def test_cli_status_and_init_read_only(self):
        from ai_ui_decomposition.cli import main
        self.create();self.assertEqual(main(['workflow-status','--job',str(self.job)]),0);self.assertFalse((self.job/'fixture-calls.txt').exists())
    def test_budget_stops_before_generate(self):
        self.create(maximum_calls=1);self.assertEqual(self.advance()['status'],'failed');self.assertNotIn('generate',self.calls())
    def test_compile_contract_errors(self):
        for change in (lambda d:d['nodes'].append(copy.deepcopy(d['nodes'][0])),lambda d:d['nodes'][1].update(parentId='missing'),lambda d:d['nodes'][1].update(rect=[500,0,20,20])):
            value=draft();change(value)
            with self.assertRaises(ValueError):compile_draft(value)


if __name__=='__main__':unittest.main()
