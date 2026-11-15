"""Bounded recovery tests use fake curl telemetry and tiny local fixtures only."""
import importlib.util
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch
import uuid

spec = importlib.util.spec_from_file_location('scene_bounded_recovery_test', Path(__file__).parents[1] / 'model_recovery.py')
worker = importlib.util.module_from_spec(spec); spec.loader.exec_module(worker)
spec = importlib.util.spec_from_file_location('scene_range_fetch_test', Path(__file__).parents[1] / 'range_fetch.py')
fetch = importlib.util.module_from_spec(spec); spec.loader.exec_module(fetch)


class RecoveryTests(unittest.TestCase):
    def setUp(self):
        base = Path(os.environ.get('SCENE_CPU_TEST_TEMP_ROOT', tempfile.gettempdir())).resolve()
        self.root = base / ('scene-recovery-test-' + uuid.uuid4().hex); self.root.mkdir(mode=0o777)
        def cleanup():
            resolved = self.root.resolve()
            assert resolved.parent == base and resolved.name.startswith('scene-recovery-test-')
            shutil.rmtree(resolved)
        self.addCleanup(cleanup)
        self.bodies = {'model.safetensors': b'abcdef', 'config.json': b'{}', 'preprocessor_config.json': b'p', 'processor_config.json': b'xx'}
        self.catalog = [{'path': k, 'byteLength': len(v), 'sha256': worker.setup.sha(v)} for k, v in self.bodies.items()]
        p = patch.object(worker.setup, 'ARTIFACTS', self.catalog); p.start(); self.addCleanup(p.stop)
        p = patch.object(worker.setup, 'ignored', return_value=True); p.start(); self.addCleanup(p.stop)
        parent = worker.seal({'format': 'ai_scene_local_model_resume_plan_v1', 'setupId': 'test.parent.resume', 'repository': worker.setup.REPOSITORY,
          'revision': worker.setup.REVISION, 'files': self.catalog, 'downloadBytes': 8, 'completeBytes': 11,
          'prefix': {'parentPlanSha256': '0' * 64, 'failureSha256': '1' * 64, 'byteLength': 3, 'sha256': worker.setup.sha(b'abc')},
          'destination': '.ai-frame-animation/tools/scene-sam2', 'scope': 'copy-frozen-prefix-one-range-and-locked-configs',
          'packageInstall': False, 'inference': False, 'notes': 'Synthetic parent.'})
        parentDir = self.root / parent['destination'] / parent['sha256']; parentDir.mkdir(parents=True)
        (parentDir / 'resume-plan.json').write_bytes(worker.canonical(parent))
        failure = worker.seal({'planSha256': parent['sha256'], 'status': 'stopped-no-automatic-retry'})
        (parentDir / 'resume-failure.json').write_bytes(worker.canonical(failure))
        self.prefix = parentDir / 'model.safetensors.part'; self.prefix.write_bytes(b'abc')
        self.cache = self.root / 'metadata.json'
        metadata = worker.seal({'repository': worker.setup.REPOSITORY, 'revision': worker.setup.REVISION,
          'files': [{'name': k, 'text': v.decode()} for k, v in self.bodies.items() if k != 'model.safetensors']})
        self.cache.write_bytes(worker.canonical(metadata))
        self.curl = self.root / 'fake-curl.exe'; self.curl.write_bytes(b'fake-curl')
        self.plan = worker.seal({'format': 'ai_scene_bounded_model_recovery_plan_v1', 'recoveryId': 'test.bounded',
          'repository': worker.setup.REPOSITORY, 'revision': worker.setup.REVISION, 'files': self.catalog,
          'prefix': {'parentPlanSha256': parent['sha256'], 'failureSha256': failure['sha256'], 'byteLength': 3, 'sha256': worker.setup.sha(b'abc')},
          'cacheSha256': worker.setup.sha(self.cache.read_bytes()), 'curlSha256': worker.setup.sha(self.curl.read_bytes()),
          'policy': {'maximumRequests': 8, 'maximumBodyBytes': 6, 'maximumSeconds': 300, 'perRequestSeconds': 60,
                     'zeroProgressLimit': 2, 'maximumRedirectsPerRequest': 5, 'continueAfterShortResponse': True, 'fullDownloadFallback': False},
          'destination': parent['destination'], 'scope': 'bounded-curl-tail-and-verified-cached-configs', 'packageInstall': False,
          'inference': False, 'notes': 'Synthetic bounded recovery.'})
        self.decision = {'decisionId': 'test.recovery.approval', 'decision': 'approve-bounded-recovery', 'targetSha256': self.plan['sha256'], 'notes': 'Synthetic double.'}
        self.out = self.root / self.plan['destination'] / self.plan['sha256']; self.calls = []

    def runner(self, sequence):
        def run(args, **kwargs):
            self.calls.append(args)
            body, code, status, override = sequence[len(self.calls) - 1]
            interval = args[args.index('--range') + 1]; output = Path(args[args.index('--output') + 1]); output.write_bytes(body)
            headers = {'content-range': [override or f'bytes {interval}/6']} if status == 206 else {}
            telemetry = {'metrics': {'http_code': status, 'size_download': len(body), 'url_effective': 'https://private.invalid/?signature=secret'}, 'headers': headers}
            return SimpleNamespace(returncode=code, stdout=json.dumps(telemetry).encode(), stderr=b'not-exported')
        return run

    def install(self, sequence):
        return worker.install(self.root, self.plan, self.decision, self.cache, self.curl, self.runner(sequence))

    def test_short_response_progress_completes_within_one_explicit_budget(self):
        result = self.install([(b'de', 18, 206, None), (b'f', 0, 206, None)])
        self.assertEqual(result['requests'], 2); self.assertEqual(result['receivedBodyBytes'], 3)
        self.assertEqual(result['status'], 'all-four-files-verified'); self.assertEqual(result['cachedConfigBytes'], 5)
        self.assertEqual(self.prefix.read_bytes(), b'abc')
        for name, body in self.bodies.items(): self.assertEqual((self.out / name).read_bytes(), body)
        records = '\n'.join(p.read_text() for p in self.out.glob('*.json'))
        self.assertNotIn('signature', records); self.assertNotIn('private.invalid', records)
        self.assertEqual(json.loads((self.out / 'request-01.json').read_bytes())['status'], 'incomplete-response')
        self.assertEqual(self.calls[1][self.calls[1].index('--range') + 1], '5-5')

    def test_exact_full_response_needs_one_request(self):
        result = self.install([(b'def', 0, 206, None)])
        self.assertEqual(result['requests'], 1); self.assertEqual(result['modelLoads'], 0)

    def test_authorization_required_before_output(self):
        with self.assertRaisesRegex(ValueError, 'explicit_bounded_recovery_authorization_required'):
            worker.install(self.root, self.plan, None, self.cache, self.curl, self.runner([]))
        self.assertFalse(self.out.exists()); self.assertEqual(self.calls, [])

    def test_range_ignored_stops_with_no_full_fallback(self):
        with self.assertRaisesRegex(ValueError, 'recovery_range_response_required'):
            self.install([(b'', 63, 200, None)])
        self.assertEqual(len(self.calls), 1); self.assertEqual(self.prefix.read_bytes(), b'abc')

    def test_two_zero_progress_attempts_stop(self):
        with self.assertRaisesRegex(ValueError, 'recovery_no_progress'):
            self.install([(b'', 28, 0, None), (b'', 28, 0, None)])
        self.assertEqual(len(self.calls), 2)

    def test_corrupt_tail_cannot_pass_whole_identity(self):
        with self.assertRaisesRegex(ValueError, 'recovery_whole_identity'):
            self.install([(b'xyz', 0, 206, None)])
        self.assertFalse((self.out / 'model.safetensors').exists())

    def test_modified_cached_configs_or_curl_stop_preflight(self):
        self.cache.write_bytes(b'changed')
        with self.assertRaisesRegex(ValueError, 'recovery_cache_identity'):
            worker.preflight(self.root, self.plan, self.cache, self.curl)
        self.assertFalse(self.out.exists())

    def test_wrong_range_is_not_appended(self):
        with self.assertRaisesRegex(ValueError, 'recovery_range_response_required'):
            self.install([(b'def', 0, 206, 'bytes 2-4/6')])
        self.assertEqual((self.out / 'model.safetensors.part').read_bytes(), b'abc')

    def test_no_overwrite_or_policy_expansion(self):
        self.install([(b'def', 0, 206, None)])
        with self.assertRaisesRegex(ValueError, 'fresh_ignored_target_required'):
            self.install([])
        changed = {k: v for k, v in self.plan.items() if k != 'sha256'}; changed['policy'] = {**changed['policy'], 'maximumRequests': 100}
        with self.assertRaisesRegex(ValueError, 'recovery_bounds'):
            worker.preflight(self.root, worker.seal(changed), self.cache, self.curl)

    def test_eight_request_budget_stops_even_when_short_responses_make_progress(self):
        self.prefix.write_bytes(b'a')
        changed = {k: v for k, v in self.plan.items() if k != 'sha256'}
        changed['prefix'] = {**changed['prefix'], 'byteLength': 1, 'sha256': worker.setup.sha(b'a')}
        changed['policy'] = {**changed['policy'], 'maximumBodyBytes': 10}
        self.plan = worker.seal(changed); self.decision['targetSha256'] = self.plan['sha256']
        self.out = self.root / self.plan['destination'] / self.plan['sha256']
        sequence = []
        for byte in [b'b', b'c', b'd', b'e']:
            sequence.extend([(b'', 28, 0, None), (byte, 18, 206, None)])
        with self.assertRaisesRegex(ValueError, 'recovery_budget_exhausted'):
            self.install(sequence)
        self.assertEqual(len(self.calls), 8)
        self.assertEqual(json.loads((self.out / 'recovery-failure.json').read_bytes())['requests'], 8)
        self.assertFalse((self.out / 'model.safetensors').exists())

    def test_elapsed_transfer_window_stops_before_another_request(self):
        with patch.object(worker.time, 'monotonic', side_effect=[0, 301]):
            with self.assertRaisesRegex(ValueError, 'recovery_budget_exhausted'):
                self.install([])
        self.assertEqual(self.calls, [])

    def v2(self):
        p = patch.object(fetch.worker.setup, 'ARTIFACTS', self.catalog); p.start(); self.addCleanup(p.stop)
        changed = {k: v for k, v in self.plan.items() if k not in ['sha256', 'curlSha256']}
        changed.update(format='ai_scene_bounded_model_recovery_plan_v2', scope='bounded-urllib-ranges-and-verified-cached-configs',
                       transport={'profile': 'stdlib-urllib-system-settings-locked-https',
                                  'pythonSha256': worker.resume.fingerprint(worker.sys.executable)[1],
                                  'fetcherSha256': worker.resume.fingerprint(Path(worker.__file__).with_name('range_fetch.py'))[1]})
        changed['policy'] = {**changed['policy'], 'maximumRequests': 6, 'maximumSeconds': 180,
                             'perRequestSeconds': 30, 'maximumRangeBytes': 262144}
        self.plan = worker.seal(changed); self.decision['targetSha256'] = self.plan['sha256']
        self.out = self.root / self.plan['destination'] / self.plan['sha256']

    def v2_runner(self, sequence, killed_first=False):
        def run(args, **kwargs):
            self.calls.append(args)
            self.assertNotIn('--proxy', args); self.assertNotIn('--curl', args)
            self.assertEqual(kwargs['timeout'], 30)
            number = int(args[args.index('--request-number') + 1]); directory = Path(args[args.index('--output-dir') + 1])
            body, status, override, encoding = sequence[len(self.calls) - 1]
            def opener(request, timeout):
                self.assertEqual(timeout, 30)
                self.assertEqual(request.full_url, f'https://huggingface.co/{worker.setup.REPOSITORY}/resolve/{worker.setup.REVISION}/model.safetensors')
                interval = request.get_header('Range').removeprefix('bytes=')
                response = io.BytesIO(body); response.status = status
                response.headers = {'Content-Range': override or f'bytes {interval}/6', 'Content-Encoding': encoding}
                return response
            try:
                code = fetch.transfer(directory, number, 30, opener)
            except ValueError:
                code = 65
            if killed_first and len(self.calls) == 1:
                raise subprocess.TimeoutExpired(args, 30)
            return SimpleNamespace(returncode=code, stdout=b'', stderr=b'not-exported')
        return run

    def test_urllib_v2_short_ranges_complete_with_cached_configs_and_dispatch_receipts(self):
        self.v2()
        result = worker.install(self.root, self.plan, self.decision, self.cache, None,
                                self.v2_runner([(b'de', 206, None, 'identity'), (b'f', 206, None, 'identity')]))
        self.assertEqual(result['status'], 'all-four-files-verified'); self.assertEqual(result['requests'], 2)
        self.assertEqual((self.out / 'model.safetensors').read_bytes(), b'abcdef')
        self.assertEqual(self.prefix.read_bytes(), b'abc')
        self.assertTrue((self.out / 'request-01-dispatched.json').exists())
        with self.assertRaises(FileExistsError): fetch.transfer(self.out, 1, 30, lambda *_: self.fail('duplicate network call'))

    def test_urllib_v2_killed_partial_is_preserved_and_next_offset_advances(self):
        self.v2()
        result = worker.install(self.root, self.plan, self.decision, self.cache, None,
                                self.v2_runner([(b'de', 206, None, 'identity'), (b'f', 206, None, 'identity')], killed_first=True))
        self.assertEqual(result['requests'], 2)
        second = json.loads((self.out / 'request-02-started.json').read_bytes())
        self.assertEqual(second['rangeStart'], 5)
        self.assertEqual((self.out / 'fragment-01.part').read_bytes(), b'de')

    def test_urllib_v2_ignored_range_stops_without_copying_body(self):
        self.v2()
        with self.assertRaisesRegex(ValueError, 'recovery_range_response_required'):
            worker.install(self.root, self.plan, self.decision, self.cache, None,
                           self.v2_runner([(b'abcdef', 200, None, 'identity')]))
        self.assertEqual(len(self.calls), 1); self.assertFalse((self.out / 'fragment-01.part').exists())
        self.assertEqual((self.out / 'model.safetensors.part').read_bytes(), b'abc')

    def test_urllib_v2_encoded_response_stops_before_body(self):
        self.v2()
        with self.assertRaisesRegex(ValueError, 'recovery_transport_stopped'):
            worker.install(self.root, self.plan, self.decision, self.cache, None,
                           self.v2_runner([(b'def', 206, None, 'gzip')]))
        self.assertFalse((self.out / 'fragment-01.part').exists())

    def test_urllib_v2_bad_fetcher_identity_stops_before_output(self):
        self.v2()
        body = {k: v for k, v in self.plan.items() if k != 'sha256'}
        body['transport'] = {**body['transport'], 'fetcherSha256': '0' * 64}
        with self.assertRaisesRegex(ValueError, 'recovery_python_identity'):
            worker.preflight(self.root, worker.seal(body), self.cache, None)
        self.assertFalse(self.out.exists())

    def test_urllib_v2_rejects_native_curl_or_expanded_chunk_policy(self):
        self.v2()
        with self.assertRaisesRegex(ValueError, 'recovery_transport_ambiguous'):
            worker.preflight(self.root, self.plan, self.cache, self.curl)
        body = {k: v for k, v in self.plan.items() if k != 'sha256'}
        body['policy'] = {**body['policy'], 'maximumRangeBytes': 1000000}
        with self.assertRaisesRegex(ValueError, 'recovery_bounds'):
            worker.preflight(self.root, worker.seal(body), self.cache, None)

    def test_urllib_redirect_rejects_non_public_host_and_sixth_redirect(self):
        redirect = fetch.LockedRedirect()
        req = worker.setup.urllib.request.Request('https://huggingface.co/public')
        with self.assertRaisesRegex(ValueError, 'range_redirect_rejected'):
            redirect.redirect_request(req, None, 302, 'redirect', {}, 'https://private.invalid/target')
        redirect.count = 5
        with self.assertRaisesRegex(ValueError, 'range_redirect_limit'):
            redirect.redirect_request(req, None, 302, 'redirect', {}, 'https://huggingface.co/target')

    def test_urllib_v2_authorization_is_required_before_any_child_or_output(self):
        self.v2()
        with self.assertRaisesRegex(ValueError, 'explicit_bounded_recovery_authorization_required'):
            worker.install(self.root, self.plan, None, self.cache, None, lambda *_args, **_kwargs: self.fail('unapproved process'))
        self.assertFalse(self.out.exists())

    def test_urllib_v2_large_tail_is_split_into_capped_contiguous_ranges(self):
        # Larger synthetic bytes exercise the cap; no model or image is constructed.
        self.catalog[0].update(byteLength=524296, sha256=worker.setup.sha(b'a' * 524296))
        parent = worker.seal({'format': 'ai_scene_local_model_resume_plan_v1', 'setupId': 'test.large.parent',
            'repository': worker.setup.REPOSITORY, 'revision': worker.setup.REVISION, 'files': self.catalog,
            'downloadBytes': 524298, 'completeBytes': 524301,
            'prefix': {'parentPlanSha256': '0' * 64, 'failureSha256': '1' * 64, 'byteLength': 3, 'sha256': worker.setup.sha(b'aaa')},
            'destination': self.plan['destination'], 'scope': 'copy-frozen-prefix-one-range-and-locked-configs',
            'packageInstall': False, 'inference': False, 'notes': 'Synthetic large range fixture.'})
        directory = self.root / parent['destination'] / parent['sha256']; directory.mkdir()
        (directory / 'resume-plan.json').write_bytes(worker.canonical(parent))
        failure = worker.seal({'planSha256': parent['sha256'], 'status': 'stopped-no-automatic-retry'})
        (directory / 'resume-failure.json').write_bytes(worker.canonical(failure))
        self.prefix = directory / 'model.safetensors.part'; self.prefix.write_bytes(b'aaa')
        body = {k: v for k, v in self.plan.items() if k != 'sha256'}
        body['prefix'] = {'parentPlanSha256': parent['sha256'], 'failureSha256': failure['sha256'], 'byteLength': 3, 'sha256': worker.setup.sha(b'aaa')}
        body['policy'] = {**body['policy'], 'maximumBodyBytes': (524296 - 3) * 2}
        self.plan = worker.seal(body); self.v2(); observed = []
        def run(args, **kwargs):
            number = int(args[args.index('--request-number') + 1]); target = Path(args[args.index('--output-dir') + 1])
            def opener(request, timeout):
                start, end = map(int, request.get_header('Range').removeprefix('bytes=').split('-'))
                observed.append((start, end)); response = io.BytesIO(b'a' * (end - start + 1))
                response.status = 206; response.headers = {'Content-Range': f'bytes {start}-{end}/524296'}; return response
            return SimpleNamespace(returncode=fetch.transfer(target, number, 30, opener), stdout=b'', stderr=b'')
        result = worker.install(self.root, self.plan, self.decision, self.cache, None, run)
        self.assertEqual(observed, [(3, 262146), (262147, 524290), (524291, 524295)])
        self.assertEqual(result['receivedBodyBytes'], 524293); self.assertEqual(self.prefix.read_bytes(), b'aaa')


if __name__ == '__main__': unittest.main()
