"""Offline adapter tests: tiny synthetic masks and model/processor doubles only."""
import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import shutil
import socket
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch
import uuid
import numpy as np
from PIL import Image

spec = importlib.util.spec_from_file_location('scene_sam2_test', Path(__file__).parents[1] / 'sam2.py')
adapter = importlib.util.module_from_spec(spec); spec.loader.exec_module(adapter)


class Sam2Tests(unittest.TestCase):
    def setUp(self):
        base = Path(os.environ.get('SCENE_CPU_TEST_TEMP_ROOT', tempfile.gettempdir())).resolve()
        self.root = base / ('scene-sam2-test-' + uuid.uuid4().hex); self.root.mkdir(mode=0o777)
        def cleanup():
            resolved = self.root.resolve(); assert resolved.parent == base and resolved.name.startswith('scene-sam2-test-')
            shutil.rmtree(resolved)
        self.addCleanup(cleanup); self.input = self.root / 'input'; self.input.mkdir(); self.out = self.root / 'out'
        stream = io.BytesIO(); Image.fromarray(np.full((12, 16, 4), 255, np.uint8)).save(stream, format='PNG'); self.raw = stream.getvalue()
        (self.input / 'reference-native.png').write_bytes(self.raw)
        self.config = self.root / 'private.json'; self.config.write_text('{}')
        self.model_files = [{'path': 'weights.bin', 'byteLength': 3, 'sha256': adapter.sha(b'abc')}]
        self.body = {'format': 'ai_scene_prompt_segmentation_plan_v1', 'specSha256': '0' * 64, 'targetSha256': '1' * 64,
            'rawSha256': adapter.sha(self.raw), 'source': {'path': 'reference-native.png', 'byteLength': len(self.raw), 'sha256': adapter.sha(self.raw)},
            'pixelSize': {'width': 16, 'height': 12}, 'modelFiles': self.model_files, 'modelFilesSha256': adapter.sha(adapter.canonical(self.model_files)),
            'runtimeSha256': '2' * 64, 'producerSha256': adapter.sha(Path(adapter.__file__).read_bytes()),
            'regions': [{'instanceId': 'sky.actual', 'box': {'x': 0, 'y': 0, 'width': 16, 'height': 6},
                         'points': [{'x': 2, 'y': 2, 'label': 1}, {'x': 2, 'y': 9, 'label': 0}]},
                        {'instanceId': 'ground.actual', 'box': None, 'points': [{'x': 2, 'y': 9, 'label': 1}, {'x': 2, 'y': 2, 'label': 0}]}],
            'algorithm': {'profile': 'point-box-cpu-v1', 'device': 'cpu', 'dtype': 'float32', 'threads': 1, 'threshold': 0,
                'boxPolicy': 'prompt-only-not-hard-crop', 'promptMismatchPolicy': 'report-without-mask-repair',
                'maskPostprocessing': 'native-size-threshold-only', 'overlapPolicy': 'unique-or-unknown'},
            'maximumModelLoads': 1, 'maximumCalls': 2, 'networkRequests': 0, 'automaticRetry': False, 'generationCalls': 0}
        self.save(); self.calls = 0; self.loads = 0

    def save(self):
        self.plan = adapter.sealed(self.body); (self.input / 'prompt-plan.json').write_bytes(adapter.canonical(self.plan))

    def factory(self, config, plan):
        self.loads += 1
        def predict(image, region):
            self.calls += 1; mask = np.zeros((12, 16), np.bool_)
            mask[:6] = region['instanceId'] == 'sky.actual'; mask[6:] = region['instanceId'] == 'ground.actual'
            if region['instanceId'] == 'sky.actual':
                mask[2, 2] = False; mask[9, 2] = True  # Deliberate prompt disagreement must remain.
                mask[11, 15] = True  # Outside the prompt box must not be hard-clipped.
            return mask
        return SimpleNamespace(predict=predict)

    def test_single_load_per_subject_once_preserves_raw_mask_errors_and_outside_box(self):
        result = adapter.run(self.input, self.config, self.out, self.factory)
        self.assertEqual(self.loads, 1); self.assertEqual(self.calls, 2); self.assertEqual(result['modelLoads'], 1)
        self.assertEqual(result['networkRequests'], 0); self.assertEqual(result['status'], 'unreviewed-prompt-candidates')
        mask = np.array(Image.open(self.out / 'masks/sky.actual.png'))
        self.assertEqual(mask[2, 2, 0], 0); self.assertEqual(mask[9, 2, 0], 255); self.assertEqual(mask[11, 15, 0], 255)
        self.assertEqual((self.input / 'reference-native.png').read_bytes(), self.raw)
        self.assertNotIn(str(self.root), json.dumps(result)); self.assertTrue((self.out / 'reserved-ground.actual.json').exists())

    def test_bad_prompt_and_producer_hash_stop_before_factory_or_output(self):
        self.body['regions'][0]['points'][0]['x'] = 16; self.save()
        with self.assertRaisesRegex(ValueError, 'sam2_point'): adapter.run(self.input, self.config, self.out, self.factory)
        self.assertEqual(self.loads, 0); self.assertFalse(self.out.exists())
        self.body['regions'][0]['points'][0]['x'] = 2; self.body['producerSha256'] = '0' * 64; self.save()
        with self.assertRaisesRegex(ValueError, 'sam2_producer_changed'): adapter.run(self.input, self.config, self.out, self.factory)

    def test_failure_retains_first_mask_and_does_not_retry_second(self):
        def factory(config, plan):
            backend = self.factory(config, plan)
            def predict(image, region):
                if region['instanceId'] == 'ground.actual':
                    self.calls += 1; raise RuntimeError('Synthetic failure')
                return backend.predict(image, region)
            return SimpleNamespace(predict=predict)
        with self.assertRaisesRegex(ValueError, 'sam2_operation_failed'): adapter.run(self.input, self.config, self.out, factory)
        failure = json.loads((self.out / 'failure.json').read_bytes()); adapter.unseal(failure)
        self.assertEqual(failure['calls'], 2); self.assertEqual(len(failure['masks']), 1)
        self.assertEqual(self.calls, 2); self.assertFalse((self.out / 'prompt-result.json').exists())

    def test_network_is_blocked_before_a_factory_can_connect(self):
        def factory(_config, _plan):
            socket.create_connection(('example.invalid', 443))
            self.fail('network guard did not stop')
        with self.assertRaisesRegex(ValueError, 'sam2_network_forbidden'): adapter.run(self.input, self.config, self.out, factory)
        self.assertEqual(json.loads((self.out / 'failure.json').read_bytes())['calls'], 0)

    def test_non_binary_or_wrong_frame_output_is_not_repaired(self):
        with self.assertRaisesRegex(ValueError, 'sam2_output_binary_frame'):
            adapter.run(self.input, self.config, self.out, lambda *_: SimpleNamespace(predict=lambda *_: np.ones((12, 16), np.uint8)))
        self.assertFalse((self.out / 'masks/sky.actual.png').exists())

    def test_no_overwrite_of_a_prior_success(self):
        adapter.run(self.input, self.config, self.out, self.factory)
        with self.assertRaisesRegex(ValueError, 'sam2_fresh_output_required'): adapter.run(self.input, self.config, self.out, self.factory)
        self.assertEqual(self.loads, 1)

    def test_cpu_local_version_metadata_names_are_valid_without_allowing_path_escape(self):
        directory = self.root / 'torch-2.10.0+cpu.dist-info'; directory.mkdir()
        (directory / 'METADATA').write_bytes(b'Synthetic CPU wheel metadata')
        self.assertEqual(adapter.read(adapter.installed_relative(self.root, 'torch-2.10.0+cpu.dist-info/METADATA')),
                         b'Synthetic CPU wheel metadata')
        for unsafe in ['../outside', '/outside', 'C:/outside', 'torch/../../outside', 'torch\\outside']:
            with self.assertRaisesRegex(ValueError, 'sam2_installed_relative_path'): adapter.installed_relative(self.root, unsafe)

    def test_model_loader_uses_local_cpu_safetensors_and_rejects_missing_weights(self):
        site = Path(np.__file__).resolve().parent.parent; calls = []; missing = []
        model = SimpleNamespace(to=lambda **kwargs: calls.append(('to', kwargs)) or model,
                                eval=lambda: model, parameters=lambda: [SimpleNamespace(device=SimpleNamespace(type='cpu'))])
        def load_model(path, **kwargs):
            calls.append(('load', kwargs)); return model, {'missing_keys': list(missing)}
        torch = SimpleNamespace(__file__=str(site / 'torch/__init__.py'), version=SimpleNamespace(cuda=None), float32='float32',
            set_num_threads=lambda n: calls.append(('threads', n)), set_num_interop_threads=lambda n: None,
            use_deterministic_algorithms=lambda yes: None, manual_seed=lambda seed: None, get_num_threads=lambda: 1)
        transformers = SimpleNamespace(__file__=str(site / 'transformers/__init__.py'),
            Sam2VideoModel=SimpleNamespace(from_pretrained=load_model),
            Sam2VideoProcessor=SimpleNamespace(from_pretrained=lambda path, **kwargs: calls.append(('processor', kwargs)) or object()))
        modules = {'torch': torch, 'transformers': transformers,
            'torchvision': SimpleNamespace(__file__=str(site / 'torchvision/__init__.py')),
            'safetensors': SimpleNamespace(__file__=str(site / 'safetensors/__init__.py'))}
        with patch.object(adapter, 'verify_runtime', return_value=(site, self.root)), patch.dict(sys.modules, modules):
            adapter.Sam2Cpu({}, self.plan)
            options = next(value for key, value in calls if key == 'load')
            self.assertTrue(options['local_files_only']); self.assertTrue(options['use_safetensors']); self.assertFalse(options['trust_remote_code'])
            self.assertEqual(next(value for key, value in calls if key == 'to')['device'], 'cpu')
            missing.append('synthetic.missing')
            with self.assertRaisesRegex(ValueError, 'sam2_weight_mapping'): adapter.Sam2Cpu({}, self.plan)


if __name__ == '__main__': unittest.main()
