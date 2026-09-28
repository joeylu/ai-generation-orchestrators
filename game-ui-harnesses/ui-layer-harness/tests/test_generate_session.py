import _bootstrap
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from ai_ui_layers import generate_session
from ai_ui_layers.generate_session import build_session_prompt


class GenerateSessionPromptTests(unittest.TestCase):
    def test_long_frozen_prompt_is_data_not_model_transcription(self):
        frozen=('图标 "引号" `刻度` ${保留} \\路径\n'*240)+'[{"tip":"浅色"}]'
        message=build_session_prompt(dict(prompt=frozen,referenced_image_paths=['reference.png']),
                                     'full-only',True)
        self.assertNotIn(frozen,message)
        self.assertIn('frozen.structuredContent',message)

    def test_session_uses_only_fixed_relay_code(self):
        frozen='First line.\nKeep the leaf tip and the attached tag.'
        message=build_session_prompt({'prompt':frozen,'referenced_image_paths':['reference.png']})
        self.assertTrue(message.endswith('\n'+generate_session.frozen_args.RELAY_CODE))
        self.assertNotIn(frozen,message)

    def test_sheet_crop_mode_describes_both_attached_crops(self):
        message=build_session_prompt(dict(prompt='Keep both buttons.',
            referenced_image_paths=['communication.png','settings.png']),'sheet-crops-only')
        self.assertIn('source crops in sheet-cell order',message)
        self.assertIn('no full reference attachment',message)
        self.assertNotIn('Image 1 is the full reference',message)

    def test_background_mode_is_program_data_not_model_instruction(self):
        args=dict(prompt='Exact frozen foreground prompt.',referenced_image_paths=['reference.png'])
        foreground=build_session_prompt(args,'full-only',True)
        background=build_session_prompt(args,'full-only',False)
        self.assertEqual(foreground,background)
        self.assertNotIn(args['prompt'],foreground)

    def test_serial_requests_keep_separate_session_evidence(self):
        class FakeProcess:
            returncode=0
            def __init__(self, args, stdin, stdout, stderr, cwd, shell):
                assert shell is False
                stdout.write(b'{"type":"thread.started","thread_id":"fixture"}\n')
            def communicate(self, data, timeout):return (None,None)
        with tempfile.TemporaryDirectory() as tmp:
            job=Path(tmp)
            snapshot=job/'snapshot';snapshot.mkdir()
            (snapshot/'execution-plan.candidate.json').write_text(json.dumps(dict(assets=[
                dict(id='asset-0',output_mode='opaque_canvas'),
                dict(id='asset-1',output_mode='keyed_component')])),encoding='utf-8')
            requests=[dict(asset=f'asset-{i}',submissionDigest=f'digest-{i}',
                           arguments=dict(prompt='Exact prompt',referenced_image_paths=[str(job/'reference.png')]))
                      for i in range(2)]
            argv=['codex','--ephemeral','--output-schema','schema.json','--image','old.png',
                  'features.image_generation=false']
            with patch.object(generate_session,'next_request',side_effect=requests), \
                 patch.object(generate_session,'load_job',return_value=({'referenceMode':'full-only'},{})), \
                 patch.object(generate_session,'command',side_effect=lambda *args: argv.copy()), \
                 patch.object(generate_session.shutil,'which',return_value='codex'), \
                 patch.object(generate_session.subprocess,'Popen',FakeProcess):
                generate_session.run(job)
                generate_session.run(job)
            for i in range(2):
                folder=job/'generation-sessions'/f'digest-{i}'
                self.assertEqual(json.loads((folder/'tool-request.json').read_text())['asset'],f'asset-{i}')
                self.assertEqual(json.loads((folder/'session-result.json').read_text())['submissionDigest'],f'digest-{i}')
                self.assertEqual(json.loads((folder/'dispatch.json').read_text())['transparentBackground'],bool(i))
                payload=json.loads((folder/'frozen-image-arguments.json').read_text())
                self.assertEqual(payload['arguments'],dict(prompt='Exact prompt',
                    num_last_images_to_include=1,transparent_background=bool(i)))
                self.assertEqual(json.loads((folder/'dispatch.json').read_text())['imageArgumentsSha256'],
                                 generate_session.digest(folder/'frozen-image-arguments.json'))

    def test_nonzero_cli_exit_marks_reserved_request_terminal(self):
        class FailedProcess:
            returncode=1
            def __init__(self, args, stdin, stdout, stderr, cwd, shell):
                assert shell is False
                stdout.write(b'{"type":"turn.failed"}\n')
            def communicate(self, data, timeout):return (None,None)
        with tempfile.TemporaryDirectory() as tmp:
            job=Path(tmp).resolve()
            snapshot=job/'snapshot';snapshot.mkdir()
            (snapshot/'execution-plan.candidate.json').write_text(json.dumps(dict(assets=[
                dict(id='asset',output_mode='keyed_component')])),encoding='utf-8')
            request=dict(asset='asset',submissionDigest='digest',arguments=dict(
                prompt='Exact prompt',referenced_image_paths=[str(job/'reference.png')]))
            argv=['codex','--ephemeral','--output-schema','schema.json','--image','old.png',
                  'features.image_generation=false']
            with patch.object(generate_session,'next_request',return_value=request), \
                 patch.object(generate_session,'load_job',return_value=({'referenceMode':'full-only'},{})), \
                 patch.object(generate_session,'command',return_value=argv), \
                 patch.object(generate_session.shutil,'which',return_value='codex'), \
                 patch.object(generate_session.subprocess,'Popen',FailedProcess), \
                 patch.object(generate_session,'fail') as failed:
                generate_session.run(job)
            failed.assert_called_once_with(job,'digest','CLI exited nonzero; provider acceptance indeterminate')
            result=json.loads((job/'generation-sessions/digest/session-result.json').read_text())
            self.assertEqual(result['receiptStatus'],'indeterminate_no_resubmit')

    def test_missing_cli_does_not_reserve_a_compute_call(self):
        with tempfile.TemporaryDirectory() as tmp, \
             patch.object(generate_session.shutil,'which',return_value=None), \
             patch.object(generate_session,'next_request') as reserve:
            with self.assertRaisesRegex(ValueError,'CODEX_CLI_UNAVAILABLE'):
                generate_session.run(tmp)
            reserve.assert_not_called()
            self.assertFalse((Path(tmp)/'generation-sessions').exists())

    def test_process_start_failure_marks_reserved_request_terminal(self):
        with tempfile.TemporaryDirectory() as tmp:
            job=Path(tmp);snapshot=job/'snapshot';snapshot.mkdir()
            (snapshot/'execution-plan.candidate.json').write_text(json.dumps(dict(assets=[
                dict(id='asset',output_mode='keyed_component')])),encoding='utf-8')
            request=dict(asset='asset',submissionDigest='digest',arguments=dict(
                prompt='Exact prompt',referenced_image_paths=['reference.png']))
            argv=['codex','--ephemeral','--output-schema','schema.json','--image','old.png',
                  'features.image_generation=false','-']
            with patch.object(generate_session,'next_request',return_value=request), \
                 patch.object(generate_session,'load_job',return_value=({'referenceMode':'full-only'},{})), \
                 patch.object(generate_session,'command',return_value=argv), \
                 patch.object(generate_session.shutil,'which',return_value='codex'), \
                 patch.object(generate_session.subprocess,'Popen',side_effect=OSError('synthetic startup failure')) as start, \
                 patch.object(generate_session,'fail') as failed:
                generate_session.run(job)
            start.assert_called_once()
            failed.assert_called_once_with(job.resolve(),'digest','CLI process start failed; reserved request terminal')
            result=json.loads((job/'generation-sessions/digest/session-result.json').read_text())
            self.assertEqual(result['failureCode'],'PROCESS_START_FAILED')
            self.assertEqual(result['receiptStatus'],'indeterminate_no_resubmit')

    def test_timeout_or_io_uncertainty_stops_child_without_redispatch(self):
        for error,code in ((generate_session.subprocess.TimeoutExpired('synthetic-cli',900),'TIMEOUT_NO_RETRY'),
                           (OSError('synthetic pipe failure'),'PROCESS_IO_FAILED')):
            with self.subTest(code=code),tempfile.TemporaryDirectory() as tmp:
                calls=[]
                class InterruptedProcess:
                    returncode=None
                    def __init__(self,*args,**kwargs):calls.append('start')
                    def communicate(self,data=None,timeout=None):
                        calls.append('communicate')
                        if data is not None:raise error
                    def kill(self):calls.append('kill');self.returncode=-9
                job=Path(tmp);snapshot=job/'snapshot';snapshot.mkdir()
                (snapshot/'execution-plan.candidate.json').write_text(json.dumps(dict(assets=[
                    dict(id='asset',output_mode='keyed_component')])),encoding='utf-8')
                request=dict(asset='asset',submissionDigest='digest',arguments=dict(
                    prompt='Exact prompt',referenced_image_paths=['reference.png']))
                argv=['codex','--ephemeral','--output-schema','schema.json','--image','old.png',
                      'features.image_generation=false','-']
                with patch.object(generate_session,'next_request',return_value=request) as reserve, \
                     patch.object(generate_session,'load_job',return_value=({'referenceMode':'full-only'},{})), \
                     patch.object(generate_session,'command',return_value=argv), \
                     patch.object(generate_session.shutil,'which',return_value='codex'), \
                     patch.object(generate_session.subprocess,'Popen',InterruptedProcess), \
                     patch.object(generate_session,'fail') as failed:
                    generate_session.run(job)
                reserve.assert_called_once();failed.assert_called_once()
                self.assertEqual(calls,['start','communicate','kill','communicate'])
                result=json.loads((job/'generation-sessions/digest/session-result.json').read_text())
                self.assertEqual(result['failureCode'],code)
                self.assertEqual(result['receiptStatus'],'indeterminate_no_resubmit')


if __name__=='__main__':unittest.main()
