import _bootstrap
import contextlib
import io
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import Mock, patch
from PIL import Image
from ai_ui_layers import delivery_dag, planning_dag
from ai_ui_layers.codex_call import transport_failure_details
from ai_ui_layers.evaluate import read, save
from ai_ui_layers.session_review import invoke, TransportFailure
from test_planning_dag import FakeModel, SID


class TransportFailureTests(unittest.TestCase):
    def receipt(self, **changes):
        return dict(dict(exitCode=0,turnCompleted=True,unexpectedEvents=[],
                         elapsedSeconds=1.25,transportNotices=5), **changes)

    def test_recovered_notices_are_not_a_terminal_failure(self):
        self.assertIsNone(transport_failure_details(self.receipt()))

    def test_timeout_is_distinguished_from_exit_incomplete_and_tool_failures(self):
        cases=[(dict(failure='TIMEOUT_NO_RETRY',exitCode=1,turnCompleted=False),'TIMEOUT_NO_RETRY'),
               (dict(exitCode=1),'CLI_EXIT_FAILED'),
               (dict(turnCompleted=False),'NO_FINAL_MODEL_RECEIPT'),
               (dict(unexpectedEvents=['unexpected_item:mcp_tool_call']),'UNEXPECTED_MODEL_EVENTS')]
        for changes,expected in cases:
            with self.subTest(expected=expected):
                self.assertEqual(transport_failure_details(self.receipt(**changes))['failureCode'],expected)

    def test_diagnostics_do_not_echo_unknown_messages_or_untyped_values(self):
        details=transport_failure_details(self.receipt(failure='https://private.invalid/?credential=secret',
            exitCode='private-path',elapsedSeconds=float('nan'),transportNotices='private-message',
            timeoutSeconds='private-setting'))
        self.assertEqual(details,dict(failureCode='TRANSPORT_OR_ISOLATION_FAILURE',turnCompleted=True))

    def call_double(self, folder, raw, timeout=False, exit_code=0):
        process=Mock(returncode=exit_code)
        if timeout:process.communicate.side_effect=[subprocess.TimeoutExpired('fixture',900),(None,None)]
        def launch(*args, **kwargs):
            kwargs['stdout'].write(raw.encode('utf-8'))
            return process
        with patch('ai_ui_layers.session_review.subprocess.Popen',side_effect=launch) as launch_mock:
            try:
                result=invoke(['fixture-cli'],folder,folder,'fixture prompt')
            except TransportFailure as error:
                result=error
            launch_mock.assert_called_once()
        return process,result

    def test_timeout_receipt_and_partial_stream_are_preserved_without_resubmission(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder=Path(tmp);raw='{"type":"thread.started","thread_id":"'+SID+'"}\n{"type":'
            process,error=self.call_double(folder,raw,timeout=True,exit_code=1)
            self.assertIsInstance(error,TransportFailure)
            self.assertEqual(str(error),'TRANSPORT_OR_ISOLATION_FAILURE')
            self.assertEqual(error.details['failureCode'],'TIMEOUT_NO_RETRY')
            self.assertEqual(error.details['timeoutSeconds'],900)
            self.assertEqual((folder/'events.jsonl').read_text(encoding='utf-8'),raw)
            receipt=read(folder/'transport.json')
            self.assertEqual(receipt['failure'],'TIMEOUT_NO_RETRY')
            self.assertEqual(receipt['unexpectedEvents'],['invalid_event_log'])
            self.assertFalse(receipt['turnCompleted'])
            process.kill.assert_called_once()
            self.assertEqual(process.communicate.call_args_list[0].kwargs['timeout'],900)
            with patch('ai_ui_layers.session_review.subprocess.Popen') as launch:
                with self.assertRaises(FileExistsError):invoke(['fixture-cli'],folder,folder,'fixture')
                launch.assert_not_called()

    def test_invalid_events_without_timeout_are_terminal(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder=Path(tmp)
            process,error=self.call_double(folder,'{"type":')
            self.assertEqual(error.details['failureCode'],'INVALID_MODEL_EVENTS')
            self.assertEqual(read(folder/'transport.json')['failure'],'INVALID_MODEL_EVENTS')
            process.kill.assert_not_called()

    def test_process_start_failure_has_a_receipt_without_raw_exception(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder=Path(tmp)
            with patch('ai_ui_layers.session_review.subprocess.Popen',side_effect=OSError('private-location')) as launch:
                with self.assertRaises(TransportFailure) as raised:
                    invoke(['fixture-cli'],folder,folder,'fixture')
                launch.assert_called_once()
            self.assertEqual(raised.exception.details['failureCode'],'PROCESS_START_FAILED')
            self.assertNotIn('private-location',(folder/'transport.json').read_text(encoding='utf-8'))

    def test_complete_recovered_stream_keeps_existing_success_gate(self):
        raw='\n'.join(json.dumps(event) for event in (
            dict(type='error',message='Reconnecting... 1/5'),dict(type='turn.completed',usage=dict(input_tokens=12))))
        with tempfile.TemporaryDirectory() as tmp:
            process,result=self.call_double(Path(tmp),raw)
            self.assertEqual(result['transportNotices'],1)
            self.assertTrue(result['turnCompleted'])
            process.kill.assert_not_called()

    def test_public_cli_keeps_one_json_and_nonzero_exit_with_safe_details(self):
        class FailedDag:
            root=Path('fixture')
            def __init__(self,_):pass
            def verify(self):pass
            def execute(self):
                raise TransportFailure(dict(failure='TIMEOUT_NO_RETRY',exitCode=1,
                    turnCompleted=False,elapsedSeconds=900,transportNotices=5,timeoutSeconds=900))
        out=io.StringIO()
        with patch.object(sys,'argv',['ui_layer.py','resume','--output','fixture']), \
             patch.object(delivery_dag,'DeliveryDag',FailedDag),contextlib.redirect_stdout(out):
            with self.assertRaises(SystemExit) as stopped:delivery_dag.main()
        self.assertEqual(stopped.exception.code,1)
        result=json.loads(out.getvalue())
        self.assertEqual(result['reason'],'TRANSPORT_OR_ISOLATION_FAILURE')
        self.assertFalse(result['automaticRetry'])
        self.assertEqual(result['failureDetails']['failureCode'],'TIMEOUT_NO_RETRY')

    def test_dag_status_records_failed_stage_and_never_replays_it(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);Image.new('RGB',(1000,1000)).save(root/'source.png')
            run=planning_dag.init(root/'source.png',root/'run')
            fake=FakeModel();calls=[]
            def model(folder,sid,first):
                calls.append(folder.name)
                if first:return fake(folder,sid,first)
                receipt=dict(failure='TIMEOUT_NO_RETRY',exitCode=1,turnCompleted=False,
                    unexpectedEvents=[],elapsedSeconds=900,timeoutSeconds=900,transportNotices=5)
                save(folder/'transport.json',receipt)
                raise TransportFailure(receipt)
            dag=planning_dag.Dag(run,model)
            with self.assertRaises(TransportFailure):dag.execute()
            result=dag.status()
            self.assertEqual(result['nodes']['m2'],'failed')
            self.assertEqual(result['modelCallFailures']['m2']['failureCode'],'TIMEOUT_NO_RETRY')
            self.assertEqual(read(run/'.dag/m2/failed.json')['failureDetails'],result['modelCallFailures']['m2'])
            with self.assertRaisesRegex(ValueError,'NO_RESUBMIT'):dag.execute()
            self.assertEqual(calls,['m1','m2'])
            self.assertEqual(result['mediaGenerationCalls'],0)
            self.assertFalse((run/'frozen').exists())


if __name__=='__main__':unittest.main()
