"""One final preflight preserves all frozen policies and current-byte checks."""
import _bootstrap
import os
import unittest
from unittest.mock import patch

from ai_ui_layers import experimental_executor as exchange, sheet_layout_reference as board
from ai_ui_layers.evaluate import read, save, digest
from ai_ui_layers.freeze_visual import inspect, body_digest
from ai_ui_layers.visual_policy import warning_policy
import test_visual_texture_pipeline as fixtures


class LoadJobPreflightTests(unittest.TestCase):
    frozen = fixtures.VisualTexturePipelineTests.frozen

    def setUp(self):
        fixtures.VisualTexturePipelineTests.setUp(self)
        policy = self.base / 'policy.json'
        save(policy, warning_policy())
        original_init = fixtures.init
        original_model = fixtures.FakeModel
        class PolicyModel(original_model):
            def __call__(self, folder, sid, first):
                super().__call__(folder, sid, first)
                if folder.name != 'm1':
                    answer = read(folder/'draft.json')
                    for row in answer['smallMaterialAudit'].values():
                        for part in row['parts']:
                            part['deferredAppearance'] = None
                    fixtures.overwrite(folder/'draft.json', answer)
                    receipt = read(folder/'transport.json')
                    receipt['responseSha256'] = digest(folder/'draft.json')
                    fixtures.overwrite(folder/'transport.json', receipt)
        with patch.object(fixtures, 'init', side_effect=lambda *args, **kwargs:
                          original_init(*args, **kwargs, visual_policy=policy)), \
                patch.object(fixtures, 'FakeModel', PolicyModel):
            snapshot = self.frozen(version='v13')
        manifest = inspect(snapshot)
        row = next(row for row in read(snapshot/'requests.json')['requests']
                   if row.get('kind') == 'sheet')
        self.job = self.base / 'job'
        self.config = exchange.prepare(snapshot, manifest['digest'], self.job, [row['asset']])

    def test_three_capabilities_share_one_preflight_per_load(self):
        self.assertIn('visualTexturePolicy', self.config)
        self.assertIn('visualPolicySha256', self.config)
        self.assertEqual(self.config['generationReference'], 'context-crops')
        with patch.object(exchange, 'preflight', wraps=exchange.preflight) as checked, \
                patch.object(board, 'verify', wraps=board.verify) as boards:
            first = exchange.load_job(self.job)
            self.assertEqual(checked.call_count, 1)
            self.assertEqual(exchange.load_job(self.job), first)
            self.assertEqual(checked.call_count, 2)
            self.assertEqual(boards.call_count, 2)

    def after_board(self, mutation):
        original = board.verify
        def verify(*args, **kwargs):
            result = original(*args, **kwargs)
            mutation()
            return result
        return patch.object(board, 'verify', side_effect=verify)

    def test_optional_input_added_after_board_verification_is_rejected(self):
        with self.after_board(lambda: (self.job/'snapshot/surface-details.json').write_text('[1]')):
            with self.assertRaisesRegex(ValueError, 'RETIRED_DRAWING_PLAN'):
                exchange.load_job(self.job)

    def test_same_length_mtime_tamper_after_board_verification_is_rejected(self):
        path = self.job/'snapshot/reference.png'
        original = path.read_bytes()
        stamp = path.stat()
        def change():
            path.write_bytes(original[:-1] + bytes([original[-1] ^ 1]))
            os.utime(path, ns=(stamp.st_atime_ns, stamp.st_mtime_ns))
        with self.after_board(change):
            with self.assertRaisesRegex(ValueError, 'ARTIFACT_CHANGED:reference.png'):
                exchange.load_job(self.job)

    def test_each_policy_binding_remains_required(self):
        for field, reason in [('visualTexturesSha256', 'VISUAL_TEXTURE_JOB_MISMATCH'),
                              ('visualPolicySha256', 'VISUAL_POLICY_JOB_MISMATCH'),
                              ('generationReference', 'FROZEN_CONTEXT_REFERENCE_REQUIRED')]:
            with self.subTest(field=field):
                config = {key: value for key, value in self.config.items() if key != 'digest'}
                config[field] = 'changed'
                fixtures.overwrite(self.job/'job.json', dict(config, digest=body_digest(config)))
                with self.assertRaisesRegex(ValueError, reason):
                    exchange.load_job(self.job)

    def test_combined_board_is_still_verified(self):
        path = next((self.job/'context-boards').rglob('*.png'))
        original = path.read_bytes()
        path.write_bytes(original[:-1] + bytes([original[-1] ^ 1]))
        with self.assertRaises(ValueError):
            exchange.load_job(self.job)


if __name__ == '__main__':
    unittest.main()
