"""Synthetic range recovery; no network, real checkpoint or inference."""
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

spec = importlib.util.spec_from_file_location('scene_model_resume_under_test', Path(__file__).parents[1] / 'model_resume.py')
resume = importlib.util.module_from_spec(spec); spec.loader.exec_module(resume)


class Response(io.BytesIO):
    def __init__(self, body, status=200, headers=None):
        super().__init__(body); self.status = status; self.headers = headers or {}


class ResumeTests(unittest.TestCase):
    def setUp(self):
        base = Path(os.environ.get('SCENE_CPU_TEST_TEMP_ROOT', tempfile.gettempdir())).resolve()
        self.root = base / ('scene-resume-test-' + uuid.uuid4().hex); self.root.mkdir(mode=0o777)
        def cleanup():
            resolved = self.root.resolve()
            assert resolved.parent == base and resolved.name.startswith('scene-resume-test-')
            shutil.rmtree(resolved)
        self.addCleanup(cleanup)
        self.contents = {'model.safetensors': b'abcdef', 'config.json': b'{}', 'preprocessor_config.json': b'p', 'processor_config.json': b'xx'}
        self.catalog = [{'path': k, 'byteLength': len(v), 'sha256': resume.setup.sha(v)} for k, v in self.contents.items()]
        p = patch.object(resume.setup, 'ARTIFACTS', self.catalog); p.start(); self.addCleanup(p.stop)
        p = patch.object(resume.setup, 'ignored', return_value=True); p.start(); self.addCleanup(p.stop)
        parent = resume.seal({'format': 'ai_scene_local_model_setup_plan_v1', 'setupId': 'test.parent', 'repository': resume.setup.REPOSITORY,
                 'revision': resume.setup.REVISION, 'files': self.catalog, 'downloadBytes': 11, 'destination': '.ai-frame-animation/tools/scene-sam2',
                 'scope': 'locked-public-model-files-only', 'packageInstall': False, 'inference': False, 'notes': 'Synthetic parent.'})
        folder = self.root / parent['destination'] / parent['sha256']; folder.mkdir(parents=True)
        (folder / 'setup-plan.json').write_bytes(resume.canonical(parent))
        failure = resume.seal({'format': 'ai_scene_local_model_setup_failure_v1', 'planSha256': parent['sha256'], 'status': 'stopped-no-automatic-retry'})
        (folder / 'setup-failure.json').write_bytes(resume.canonical(failure))
        self.prefix = folder / 'model.safetensors.part'; self.prefix.write_bytes(b'abc')
        self.plan = resume.seal({'format': 'ai_scene_local_model_resume_plan_v1', 'setupId': 'test.resume', 'repository': resume.setup.REPOSITORY,
                     'revision': resume.setup.REVISION, 'files': self.catalog, 'downloadBytes': 8, 'completeBytes': 11,
                     'prefix': {'parentPlanSha256': parent['sha256'], 'failureSha256': failure['sha256'], 'byteLength': 3, 'sha256': resume.setup.sha(b'abc')},
                     'destination': parent['destination'], 'scope': 'copy-frozen-prefix-one-range-and-locked-configs',
                     'packageInstall': False, 'inference': False, 'notes': 'Synthetic range only.'})
        self.decision = {'decisionId': 'test.resume.approval', 'decision': 'approve-resume', 'targetSha256': self.plan['sha256'], 'notes': 'Test double.'}
        self.output = self.root / self.plan['destination'] / self.plan['sha256']; self.calls = []

    def opener(self, url, headers):
        self.calls.append((url, headers)); name = url.rsplit('/', 1)[1]
        if name == 'model.safetensors':
            self.assertEqual(headers['Range'], 'bytes=3-5')
            return Response(b'def', 206, {'Content-Range': 'bytes 3-5/6', 'Content-Length': '3'})
        return Response(self.contents[name])

    def test_preflight_hashes_prefix_without_network_or_output(self):
        result = resume.preflight(self.root, self.plan)
        self.assertEqual(result['downloadBytes'], 8); self.assertEqual(result['networkRequests'], 0)
        self.assertFalse(self.output.exists()); self.assertEqual(self.calls, [])

    def test_exact_resume_preserves_original_and_verifies_whole_file_plus_configs(self):
        result = resume.install(self.root, self.plan, self.decision, self.opener)
        self.assertEqual(result['status'], 'all-four-files-verified'); self.assertEqual(result['artifactRequests'], 4)
        self.assertEqual(result['copiedPrefixBytes'], 3); self.assertEqual(result['downloadedBytes'], 8)
        self.assertEqual(self.prefix.read_bytes(), b'abc'); self.assertEqual(result['modelLoads'], 0)
        for name, body in self.contents.items():
            self.assertEqual((self.output / name).read_bytes(), body)

    def test_missing_or_wrong_authorization_never_copies_or_requests(self):
        for decision in [None, {**self.decision, 'decision': 'accept'}, {**self.decision, 'targetSha256': '0' * 64}]:
            with self.assertRaisesRegex(ValueError, 'explicit_resume_authorization_required'):
                resume.install(self.root, self.plan, decision, self.opener)
        self.assertFalse(self.output.exists()); self.assertEqual(self.calls, [])

    def test_changed_prefix_is_rejected_before_output_or_network(self):
        self.prefix.write_bytes(b'abz')
        with self.assertRaisesRegex(ValueError, 'resume_prefix_changed'):
            resume.install(self.root, self.plan, self.decision, self.opener)
        self.assertFalse(self.output.exists()); self.assertEqual(self.calls, [])

    def test_server_ignoring_range_stops_without_full_download_fallback(self):
        calls = []
        def ignore(url, headers):
            calls.append(url); return Response(b'abcdef', 200)
        with self.assertRaisesRegex(ValueError, 'resume_range_response_required'):
            resume.install(self.root, self.plan, self.decision, ignore)
        self.assertEqual(len(calls), 1); self.assertEqual(self.prefix.read_bytes(), b'abc')
        self.assertEqual((self.output / 'model.safetensors.part').read_bytes(), b'abc')
        self.assertFalse((self.output / 'model.safetensors').exists())

    def test_wrong_content_range_stops_before_reading_tail(self):
        def wrong(url, headers):
            return Response(b'def', 206, {'Content-Range': 'bytes 2-4/6'})
        with self.assertRaisesRegex(ValueError, 'resume_range_response_required'):
            resume.install(self.root, self.plan, self.decision, wrong)
        self.assertTrue((self.output / 'resume-failure.json').exists())
        self.assertEqual((self.output / 'model.safetensors.part').read_bytes(), b'abc')

    def test_corrupt_tail_cannot_pass_full_identity_or_trigger_metadata_requests(self):
        calls = []
        def bad(url, headers):
            calls.append(url); return Response(b'xyz', 206, {'Content-Range': 'bytes 3-5/6', 'Content-Length': '3'})
        with self.assertRaisesRegex(ValueError, 'resume_full_identity'):
            resume.install(self.root, self.plan, self.decision, bad)
        self.assertEqual(len(calls), 1); self.assertFalse((self.output / 'model.safetensors').exists())
        self.assertEqual(self.prefix.read_bytes(), b'abc')
        failure = json.loads((self.output / 'resume-failure.json').read_bytes())
        self.assertEqual(failure['verifiedArtifacts'], [])

    def test_short_tail_preserves_partial_without_accepting_file(self):
        def short(url, headers):
            return Response(b'de', 206, {'Content-Range': 'bytes 3-5/6', 'Content-Length': '3'})
        with self.assertRaisesRegex(ValueError, 'resume_tail_length'):
            resume.install(self.root, self.plan, self.decision, short)
        self.assertEqual((self.output / 'model.safetensors.part').read_bytes(), b'abcde')
        self.assertFalse((self.output / 'model.safetensors').exists())

    def test_already_used_output_cannot_repeat(self):
        resume.install(self.root, self.plan, self.decision, self.opener)
        count = len(self.calls)
        with self.assertRaisesRegex(ValueError, 'fresh_ignored_target_required'):
            resume.install(self.root, self.plan, self.decision, self.opener)
        self.assertEqual(len(self.calls), count)


if __name__ == '__main__':
    unittest.main()
