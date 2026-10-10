"""Offline synthetic fixture for the observed long native-alpha border failure."""
from pathlib import Path
import tempfile
import unittest
from PIL import Image, ImageDraw

import _bootstrap
from ai_ui_layers.evaluate import digest
from ai_ui_layers.postprocess_visual import assess
from ai_ui_layers.native_clipping_warning import native_clipping_evidence


class NativeClippingTests(unittest.TestCase):
    def fixture(self, folder):
        raw = Path(folder)/'raw.png'
        image = Image.new('RGBA', (200, 80))
        ImageDraw.Draw(image).rectangle((0, 30, 199, 40), fill=(20, 100, 140, 220))
        image.save(raw)
        sha = digest(raw); target = [180, 10]
        report = dict(assess(image, target), status='blocked', sourceSha256=sha, targetSize=target)
        prepared = dict(status='blocked_no_retry', reason='MATERIAL_GATE_FAILED', modelCalls=0, rawSha256=sha)
        return raw, sha, target, report, prepared

    def test_only_diagnostic_warning_and_preserve_raw(self):
        with tempfile.TemporaryDirectory() as folder:
            args = self.fixture(folder); before = args[0].read_bytes()
            result = native_clipping_evidence(*args)
            self.assertEqual(result['code'], 'POSSIBLY_CLIPPED_SOURCE')
            self.assertFalse(result['sourceCompletenessAccepted'])
            self.assertFalse(result['independentSeparationVerified'])
            self.assertEqual(args[0].read_bytes(), before)

    def test_unexpected_gate_or_alpha_failure_is_never_recovered(self):
        for issues in (['KEY_BACKGROUND_REQUIRED'], ['POSSIBLY_CLIPPED_SOURCE', 'UNKNOWN'], []):
            with self.subTest(issues=issues), tempfile.TemporaryDirectory() as folder:
                args = self.fixture(folder); args[3]['issues'] = issues
                self.assertIsNone(native_clipping_evidence(*args))

    def test_changed_received_bytes_remain_hard_failure(self):
        with tempfile.TemporaryDirectory() as folder:
            args = self.fixture(folder)
            args[0].write_bytes(args[0].read_bytes() + b'changed')
            with self.assertRaisesRegex(ValueError, 'RESULT_CHANGED'):
                native_clipping_evidence(*args)

    def test_changed_report_or_target_remain_hard_failure(self):
        for field, value in (('targetSize', [1, 1]), ('marginsLTRB', [1, 1, 1, 1])):
            with self.subTest(field=field), tempfile.TemporaryDirectory() as folder:
                args = self.fixture(folder); args[3][field] = value
                with self.assertRaisesRegex(ValueError, 'PREPARATION_'):
                    native_clipping_evidence(*args)


if __name__ == '__main__':
    unittest.main()
