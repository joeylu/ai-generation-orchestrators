import tempfile
from pathlib import Path
import unittest
from unittest.mock import patch
from PIL import Image

from ai_ui_decomposition import workflow as w
from ai_ui_decomposition.workflow_bridge import export_generation,receive_generation as raw_receive,record_submission
from ai_ui_decomposition.adapter import builtin_image_arguments
from ai_ui_decomposition.common import sha256,read_json,write_json
from workflow_fixture import draft


def receive_generation(job,request_digest,source):
    # Test caller explicitly records its one simulated invocation before receiving.
    for path in (job/'nodes/generate/output/requests').glob('*/assignment.json'):
        if read_json(path)['requestDigest']==request_digest and not (path.parent/'submission.json').exists():
            args=path.parent/'fixture-arguments.json';write_json(args,builtin_image_arguments(path.parent))
            record_submission(job,request_digest,args)
    return raw_receive(job,request_digest,source)


class WorkflowBridgeTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.base=Path(self.tmp.name)
        ref=self.base/'reference.png';Image.new('RGB',(200,160),'#102030').save(ref)
        self.raw=self.base/'raw.png';Image.new('RGB',(200,160),'#F808F8').save(self.raw)
        self.square=self.base/'square.png';Image.new('RGB',(200,200),'#F808F8').save(self.square)
        consumer=Path(__file__).resolve().parents[2]/'ui-component-harness'
        response=dict(draft=draft(),observations=dict(version='delivery-observations-1',referenceSha256=sha256(ref),geometryCorrections=[],panelFooters=[dict(componentId='panel',innerBottom=140,minimumGap=8,evidence='Fixture measured boundary')],materials=[dict(componentId='panel',description='Empty panel'),dict(componentId='action',description='Empty button')]))
        self.job=self.base/'job'
        w.create_job(ref,self.job,factory='ai_ui_decomposition.repository_workflow:create',options=dict(componentRoot=str(consumer),response=response,generationMode='file'),maximum_calls=4,stage_timeout=60)
        self.assertEqual(w.advance(self.job,allow_vision=True)['status'],'awaiting_authorization')
    def tearDown(self):self.tmp.cleanup()
    def authorize(self):
        plan=read_json(self.job/'nodes/freeze/receipt.json')['data']['planDigest'];w.authorize(self.job,plan)
    def test_no_authorization_and_no_duplicate_assignment(self):
        with self.assertRaisesRegex(ValueError,'BRIDGE_NOT_READY'):export_generation(self.job)
        self.assertFalse((self.job/'nodes/generate').exists())
        self.authorize();assigned=w.advance(self.job)
        self.assertEqual(assigned['status'],'awaiting_external')
        with self.assertRaisesRegex(ValueError,'ALREADY_ASSIGNED'):export_generation(self.job)
        self.assertEqual(w.advance(self.job)['status'],'awaiting_external')
    def test_all_results_resume_and_detect_tamper(self):
        self.authorize();assigned=export_generation(self.job);first=assigned
        with self.assertRaisesRegex(ValueError,'REQUEST_DIGEST'):receive_generation(self.job,'0'*64,self.raw)
        result=receive_generation(self.job,assigned['requestDigest'],self.raw)
        with self.assertRaisesRegex(ValueError,'ALREADY_RECEIVED'):receive_generation(self.job,assigned['requestDigest'],self.raw)
        while result['status']=='awaiting_external':
            assigned=export_generation(self.job);result=receive_generation(self.job,assigned['requestDigest'],self.square if assigned['request'].startswith('board-') else self.raw)
        self.assertEqual(result['nextNode'],'process');self.assertEqual(result['nodes']['generate'],'ok')
        self.assertFalse((self.job/'nodes/process').exists())
        (Path(first['bundle'])/'result.png').write_bytes(b'changed')
        with self.assertRaisesRegex(ValueError,'ARTIFACT_CHANGED'):w.inspect_job(self.job)
    def test_deadline_and_late_return_never_resubmit(self):
        self.authorize();assigned=export_generation(self.job)
        start=read_json(self.job/'nodes/generate/started.json')['startedAt']
        with patch('ai_ui_decomposition.workflow_bridge.time.time',return_value=start+61):
            self.assertEqual(w.inspect_job(self.job)['status'],'timed_out')
            with self.assertRaisesRegex(ValueError,'NOT_WAITING'):receive_generation(self.job,assigned['requestDigest'],self.raw)
            with self.assertRaisesRegex(ValueError,'NOT_READY'):export_generation(self.job)
    def test_tampered_assignment_and_interrupted_export(self):
        self.authorize();assigned=export_generation(self.job)
        bundle=Path(assigned['bundle']);(bundle/'prompt.txt').write_text('changed')
        with self.assertRaisesRegex(ValueError,'ADAPTER_INPUT_CHANGED'):w.inspect_job(self.job)
        (bundle/'assignment.json').unlink()
        self.assertEqual(w.inspect_job(self.job)['status'],'indeterminate')
        with self.assertRaisesRegex(ValueError,'EXTERNAL_RECOVERY_FORBIDDEN'):w.recover_local(self.job,'generate')
    def test_concurrent_mutation_rejected(self):
        self.authorize();(self.job/'bridge.lock').write_text('fixture interrupted writer')
        with self.assertRaises(FileExistsError):export_generation(self.job)
        self.assertFalse((self.job/'nodes/generate').exists())
    def test_interrupted_receive_is_not_waiting_or_replayed(self):
        self.authorize();assigned=export_generation(self.job)
        with patch('ai_ui_decomposition.workflow_bridge.import_result',side_effect=RuntimeError('fixture interruption')):
            with self.assertRaises(RuntimeError):receive_generation(self.job,assigned['requestDigest'],self.raw)
        self.assertEqual(w.inspect_job(self.job)['status'],'indeterminate')
        with self.assertRaisesRegex(ValueError,'NOT_WAITING'):receive_generation(self.job,assigned['requestDigest'],self.raw)
    def test_self_consistent_assignment_cannot_change_request_identity(self):
        self.authorize();assigned=export_generation(self.job)
        path=Path(assigned['bundle'])/'assignment.json';body=read_json(path)
        body.pop('digest');body['requestDigest']='0'*64
        path.unlink();w._record(path,body)
        with self.assertRaisesRegex(ValueError,'ASSIGNMENT_CHANGED'):w.inspect_job(self.job)
    def test_submission_required_and_mismatch_rejected(self):
        self.authorize();a=export_generation(self.job)
        with self.assertRaisesRegex(ValueError,'SUBMISSION_REQUIRED'):raw_receive(self.job,a['requestDigest'],self.raw)
        args=builtin_image_arguments(Path(a['bundle']));args['prompt']+='changed'
        path=self.base/'bad-args.json';write_json(path,args)
        with self.assertRaisesRegex(ValueError,'ARGUMENTS_MISMATCH'):record_submission(self.job,a['requestDigest'],path)
        self.assertFalse((Path(a['bundle'])/'submission.json').exists())
    def test_wrong_board_ratio_stops_before_next_assignment(self):
        self.authorize();a=export_generation(self.job)
        while not a['request'].startswith('board-'):
            receive_generation(self.job,a['requestDigest'],self.raw);a=export_generation(self.job)
        wrong=self.base/'wide.png';Image.new('RGB',(400,200),'#F808F8').save(wrong)
        status=receive_generation(self.job,a['requestDigest'],wrong)
        self.assertEqual(status['status'],'failed');self.assertEqual(status['errorCode'],'BOARD_RELATIVE_CANVAS_ASPECT')
        self.assertFalse((Path(a['bundle'])/'accepted.json').exists())
        self.assertTrue((Path(a['bundle'])/'result.png').exists())
        with self.assertRaisesRegex(ValueError,'NOT_READY'):export_generation(self.job)
    def test_submission_progress_and_duplicate_intent(self):
        self.authorize();a=export_generation(self.job);bundle=Path(a['bundle'])
        args=self.base/'args.json';write_json(args,builtin_image_arguments(bundle))
        record_submission(self.job,a['requestDigest'],args)
        self.assertEqual(w.inspect_job(self.job)['externalRequests'][0]['phase'],'invocation_recorded')
        with self.assertRaises(ValueError):record_submission(self.job,a['requestDigest'],args)


if __name__=='__main__':unittest.main()
