import _bootstrap
from unittest.mock import patch
from test_received_bundle import ReceivedBundleTests
from ai_ui_layers.finish_received import finish
from ai_ui_layers.evaluate import read


class FinishReceivedTests(ReceivedBundleTests):
    def test_incomplete_bundle_never_starts_postprocessing(self):
        with patch('ai_ui_layers.finish_received.extract') as extract:
            with self.assertRaisesRegex(ValueError, 'INCOMPLETE_RECEIVED_BUNDLE'):
                finish(self.job, read(self.job/'job.json')['digest'], self.root/'out', self.root)
            extract.assert_not_called()
        self.assertFalse((self.root/'out').exists())

    def test_wrong_digest_never_creates_output(self):
        with self.assertRaisesRegex(ValueError, 'JOB_DIGEST_MISMATCH'):
            finish(self.job, '0'*64, self.root/'out', self.root)
        self.assertFalse((self.root/'out').exists())

    def test_failed_extraction_is_recorded_and_never_packaged(self):
        for n in ('viewer.html', 'viewer.js'):
            (self.root/n).write_text('offline test viewer')
        with patch('ai_ui_layers.finish_received.inspect_sources', return_value={}), \
             patch('ai_ui_layers.finish_received.extract', side_effect=ValueError('SHEET_VISUAL_ISSUES')), \
             patch('ai_ui_layers.finish_received.register') as register, \
             patch('ai_ui_layers.finish_received.build') as build:
            with self.assertRaisesRegex(ValueError, 'SHEET_VISUAL_ISSUES'):
                finish(self.job, read(self.job/'job.json')['digest'], self.root/'out', self.root)
            register.assert_not_called(); build.assert_not_called()
        result=read(self.root/'out/result.json')
        self.assertEqual(result['status'], 'blocked_no_retry')
        self.assertFalse(result['originalDagPromoted'])
        self.assertEqual(result['generationCalls'], 0)
