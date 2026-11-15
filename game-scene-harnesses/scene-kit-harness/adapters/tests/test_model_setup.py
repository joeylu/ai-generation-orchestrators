"""Tiny synthetic downloads only. Never contacts a server or loads a model."""
import importlib.util
import io
import json
import os
from pathlib import Path
import shutil
import tempfile
import unittest
from unittest.mock import patch
import uuid
from urllib.error import HTTPError

spec = importlib.util.spec_from_file_location('scene_model_setup_under_test', Path(__file__).parents[1] / 'model_setup.py')
setup = importlib.util.module_from_spec(spec); spec.loader.exec_module(setup)


class ModelSetupTests(unittest.TestCase):
    def setUp(self):
        base = Path(os.environ.get('SCENE_CPU_TEST_TEMP_ROOT', tempfile.gettempdir())).resolve()
        self.root = base / ('scene-model-test-' + uuid.uuid4().hex); self.root.mkdir(mode=0o777)
        def cleanup():
            resolved = self.root.resolve()
            assert resolved.parent == base and resolved.name.startswith('scene-model-test-')
            shutil.rmtree(resolved)
        self.addCleanup(cleanup)
        artifacts = [{'path': 'model.safetensors', 'byteLength': 3, 'sha256': setup.sha(b'abc')}]
        self.mock_catalog = patch.object(setup, 'ARTIFACTS', artifacts); self.mock_catalog.start(); self.addCleanup(self.mock_catalog.stop)
        self.mock_ignore = patch.object(setup, 'ignored', return_value=True); self.mock_ignore.start(); self.addCleanup(self.mock_ignore.stop)
        self.plan = setup.seal({'format': 'ai_scene_local_model_setup_plan_v1', 'setupId': 'synthetic.setup', 'repository': setup.REPOSITORY,
                    'revision': setup.REVISION, 'files': artifacts, 'downloadBytes': 3, 'destination': '.ai-frame-animation/tools/scene-sam2',
                    'scope': 'locked-public-model-files-only', 'packageInstall': False, 'inference': False, 'notes': 'Synthetic download only.'})
        self.decision = {'decisionId': 'synthetic.approval', 'decision': 'approve-setup', 'targetSha256': self.plan['sha256'], 'notes': 'Synthetic double.'}
        self.output = self.root / self.plan['destination'] / self.plan['sha256']

    def test_preflight_has_no_network_or_output(self):
        result = setup.preflight(self.root, self.plan)
        self.assertEqual(result['networkRequests'], 0); self.assertFalse(self.output.exists())

    def test_setup_requires_exact_explicit_authorization_before_output_or_download(self):
        for receipt in [None, {**self.decision, 'targetSha256': '0' * 64}, {**self.decision, 'decision': 'accept'}]:
            with self.assertRaisesRegex(ValueError, 'explicit_setup_authorization_required'):
                setup.install(self.root, self.plan, receipt, opener=lambda url: self.fail('Unexpected network'))
            self.assertFalse(self.output.exists())

    def test_verified_download_stays_bounded_and_cannot_repeat(self):
        urls = []
        def opener(url):
            urls.append(url); return io.BytesIO(b'abc')
        result = setup.install(self.root, self.plan, self.decision, opener=opener)
        self.assertEqual((self.output / 'model.safetensors').read_bytes(), b'abc')
        self.assertEqual(result['status'], 'locked-model-files-verified'); self.assertEqual(result['inferenceCalls'], 0)
        self.assertEqual(urls, [f'https://huggingface.co/{setup.REPOSITORY}/resolve/{setup.REVISION}/model.safetensors'])
        with self.assertRaisesRegex(ValueError, 'fresh_ignored_target_required'):
            setup.install(self.root, self.plan, self.decision, opener=lambda url: self.fail('Unexpected repeat'))

    def test_wrong_download_retains_partial_and_failure_without_model_load(self):
        with self.assertRaisesRegex(ValueError, 'setup_download_identity'):
            setup.install(self.root, self.plan, self.decision, opener=lambda url: io.BytesIO(b'bad'))
        self.assertTrue((self.output / 'model.safetensors.part').is_file())
        self.assertTrue((self.output / 'setup-failure.json').is_file())
        self.assertFalse((self.output / 'model.safetensors').exists())
        self.assertFalse((self.output / 'setup-result.json').exists())

    def test_resealed_changed_catalog_or_scope_is_rejected(self):
        for key, value in [('destination', '../elsewhere'), ('inference', True), ('files', [])]:
            body = {k: v for k, v in self.plan.items() if k != 'sha256'}; body[key] = value
            with self.assertRaisesRegex(ValueError, 'setup_catalog_or_scope'):
                setup.preflight(self.root, setup.seal(body))

    def test_redirect_rejects_private_hosts_and_plain_http(self):
        handler = setup.PublicRedirect()
        for url in ['http://huggingface.co/a', 'https://127.0.0.1/private', 'https://evil.invalid/file', 'https://user:pass@huggingface.co/a']:
            with self.assertRaisesRegex(ValueError, 'setup_redirect_rejected'):
                handler.redirect_request(None, None, 302, '', {}, url)

    def test_failed_open_records_http_status_without_echoing_private_download_url(self):
        def opener(url):
            raise HTTPError('https://private.invalid/file?token=secret', 503, 'Unavailable', {}, None)
        with self.assertRaisesRegex(ValueError, 'setup_download_failed'):
            setup.install(self.root, self.plan, self.decision, opener=opener)
        failure = json.loads((self.output / 'setup-failure.json').read_bytes())
        self.assertEqual(failure['phase'], 'download-open')
        self.assertEqual(failure['httpStatus'], 503)
        self.assertEqual(failure['errorType'], 'HTTPError')
        self.assertNotIn('private.invalid', json.dumps(failure))
        self.assertNotIn('secret', json.dumps(failure))


if __name__ == '__main__':
    unittest.main()
