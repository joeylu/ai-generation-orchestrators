import _bootstrap
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from ai_ui_layers import generate_session
from ai_ui_layers.generate_session import build_session_prompt


class GenerateSessionPromptTests(unittest.TestCase):
    def test_frozen_prompt_ends_message_without_closing_marker(self):
        frozen='First line.\nKeep the leaf tip and the attached tag.'
        message=build_session_prompt({'prompt':frozen,'referenced_image_paths':['reference.png']})
        self.assertTrue(message.endswith('\n'+frozen))
        self.assertNotIn('</image_prompt>',message)

    def test_sheet_crop_mode_describes_both_attached_crops(self):
        message=build_session_prompt(dict(prompt='Keep both buttons.',
            referenced_image_paths=['communication.png','settings.png']),'sheet-crops-only')
        self.assertIn('source crops in sheet-cell order',message)
        self.assertIn('no full reference attachment',message)
        self.assertNotIn('Image 1 is the full reference',message)

    def test_serial_requests_keep_separate_session_evidence(self):
        class FakeProcess:
            returncode=0
            def __init__(self, args, stdin, stdout, stderr, cwd):
                stdout.write(b'{"type":"thread.started","thread_id":"fixture"}\n')
            def communicate(self, data, timeout):return (None,None)
        with tempfile.TemporaryDirectory() as tmp:
            job=Path(tmp)
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

    def test_nonzero_cli_exit_marks_reserved_request_terminal(self):
        class FailedProcess:
            returncode=1
            def __init__(self, args, stdin, stdout, stderr, cwd):
                stdout.write(b'{"type":"turn.failed"}\n')
            def communicate(self, data, timeout):return (None,None)
        with tempfile.TemporaryDirectory() as tmp:
            job=Path(tmp)
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


if __name__=='__main__':unittest.main()
