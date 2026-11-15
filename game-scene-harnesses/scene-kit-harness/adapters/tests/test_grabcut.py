"""Synthetic adapter tests; replace GrabCut and connectedComponents entirely."""
import hashlib
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

import numpy as np
from PIL import Image


spec = importlib.util.spec_from_file_location('scene_cpu_adapter_under_test', Path(__file__).parents[1] / 'grabcut.py')
adapter = importlib.util.module_from_spec(spec); spec.loader.exec_module(adapter)


class CvDouble:
    GC_INIT_WITH_MASK = 1

    def __init__(self, fail=False):
        self.calls = 0
        self.fail = fail

    def setRNGSeed(self, seed):
        pass

    def grabCut(self, image, labels, rect, bg, fg, iterations, mode):
        self.calls += 1
        if self.fail:
            raise RuntimeError('Synthetic failure with no real CPU processing')
        labels[labels == 2] = 0

    def connectedComponents(self, binary, connectivity):
        labels = np.zeros(binary.shape, np.int32)
        component = 0
        for y, x in np.argwhere(binary):
            if labels[y, x]:
                continue
            component += 1
            todo = [(int(x), int(y))]; labels[y, x] = component
            while todo:
                px, py = todo.pop()
                for yy in range(max(0, py - 1), min(binary.shape[0], py + 2)):
                    for xx in range(max(0, px - 1), min(binary.shape[1], px + 2)):
                        if binary[yy, xx] and not labels[yy, xx]:
                            labels[yy, xx] = component; todo.append((xx, yy))
        return component + 1, labels


class GrabcutAdapterTests(unittest.TestCase):
    def setUp(self):
        base = Path(os.environ.get('SCENE_CPU_TEST_TEMP_ROOT', tempfile.gettempdir())).resolve()
        self.root = base / ('scene-cpu-test-' + uuid.uuid4().hex)
        self.root.mkdir(mode=0o777)
        def cleanup():
            # Verify the exact isolated target before any recursive removal.
            resolved = self.root.resolve()
            assert resolved.parent == base and resolved.name.startswith('scene-cpu-test-')
            shutil.rmtree(resolved)
        self.addCleanup(cleanup)
        self.inputs = self.root / 'input'; self.inputs.mkdir()
        self.out = self.root / 'result'; self.config = self.root / 'private.json'; self.config.write_text('{}')
        source = io.BytesIO(); Image.fromarray(np.full((12, 16, 4), 255, np.uint8)).save(source, format='PNG')
        raw = source.getvalue(); (self.inputs / 'reference-native.png').write_bytes(raw)
        regions = []
        for index, name in enumerate(['sky.actual', 'ground.actual']):
            labels = np.full((12, 16), 2, np.uint8); labels[index * 6:(index + 1) * 6] = 3
            labels[2, 2] = 1 if index == 0 else 0
            labels[9, 2] = 0 if index == 0 else 1
            if index == 0:
                labels[10, 10] = 3  # Deliberate disconnected unseeded false-positive.
            pixels = np.repeat((labels * 85)[..., None], 4, axis=2); pixels[..., 3] = 255
            stream = io.BytesIO(); Image.fromarray(pixels).save(stream, format='PNG'); data = stream.getvalue()
            path = self.inputs / 'seeds' / f'{name}.png'; path.parent.mkdir(exist_ok=True); path.write_bytes(data)
            regions.append({'instanceId': name, 'path': f'seeds/{name}.png', 'sha256': adapter.sha(data), 'byteLength': len(data),
                            'foregroundPixels': int(np.count_nonzero(labels == 1)), 'backgroundPixels': int(np.count_nonzero(labels == 0))})
        self.plan = {'format': 'ai_scene_seeded_segmentation_plan_v1', 'targetSha256': '0' * 64, 'rawSha256': adapter.sha(raw),
                     'source': {'path': 'reference-native.png', 'sha256': adapter.sha(raw), 'byteLength': len(raw)},
                     'pixelSize': {'width': 16, 'height': 12}, 'generationCalls': 0, 'automaticRetry': False, 'maximumCalls': 2,
                     'regions': regions, 'algorithm': {'backend': 'opencv-grabcut-cpu', 'threads': 1, 'openCL': False, 'iterations': 3, 'rngSeed': 1729,
                     'initialization': 'explicit-mask-labels', 'outsideRoi': 'probable-background-not-hard-mask', 'otherForegroundSeeds': 'definite-background',
                     'componentPolicy': 'retain-components-touching-definite-foreground'}}
        self.save_plan()
        self.evidence = {'backend': 'opencv-grabcut-cpu', 'opencv': '0.0.0', 'distribution': '0.0.0', 'numpy': '0.0.0',
                         'threads': 1, 'openCL': False, 'installedFiles': 1, 'installedInventorySha256': '0' * 64}

    def save_plan(self):
        (self.inputs / 'seed-plan.json').write_bytes(adapter.canonical(adapter.sealed(self.plan)))

    def execute(self, cv):
        with patch.object(adapter, 'runtime', return_value=(cv, np, self.evidence)):
            return adapter.run(self.inputs, self.config, self.out)

    def test_candidates_preserve_seeds_remove_unseeded_component_and_write_portable_unreviewed_result(self):
        cv = CvDouble(); result = self.execute(cv)
        adapter.unseal(result)
        self.assertEqual(cv.calls, 2)
        self.assertEqual(result['generationCalls'], 0)
        self.assertEqual(result['status'], 'cpu-candidates-unreviewed')
        self.assertEqual(result['masks'][0]['selectedPixels'], 96)
        pixels = np.array(Image.open(self.out / 'masks/sky.actual.png'))
        self.assertEqual(pixels[2, 2, 0], 255)
        self.assertEqual(pixels[10, 10, 0], 0)
        self.assertNotIn(str(self.root), json.dumps(result))
        self.assertEqual(result['implementationSha256'], hashlib.sha256(Path(adapter.__file__).read_bytes()).hexdigest())
        self.assertTrue((self.out / 'started.json').is_file())

    def test_failed_cpu_call_stops_remaining_items_and_preserves_failure(self):
        cv = CvDouble(fail=True)
        with self.assertRaisesRegex(ValueError, 'cpu_operation_failed'):
            self.execute(cv)
        self.assertEqual(cv.calls, 1)
        failure = json.loads((self.out / 'failure.json').read_bytes()); adapter.unseal(failure)
        self.assertEqual(failure['calls'], 1)
        self.assertFalse((self.out / 'cpu-result.json').exists())

    def test_changed_second_seed_stops_before_any_cpu_call(self):
        (self.inputs / self.plan['regions'][1]['path']).write_bytes(b'changed')
        cv = CvDouble()
        with self.assertRaisesRegex(ValueError, 'seed_identity'):
            self.execute(cv)
        self.assertEqual(cv.calls, 0)
        self.assertTrue((self.out / 'failure.json').is_file())

    def test_existing_output_is_never_overwritten(self):
        self.out.mkdir(); cv = CvDouble()
        with self.assertRaisesRegex(ValueError, 'fresh_output_required'):
            self.execute(cv)
        self.assertEqual(cv.calls, 0)

    def test_versioned_package_paths_are_safe_while_traversal_remains_rejected(self):
        self.assertEqual(adapter.relative(self.root, 'package-5.0.0.dist-info/METADATA'), self.root / 'package-5.0.0.dist-info/METADATA')
        for path in ['../secret', 'package/../secret', 'package/./file', 'C:/private/file']:
            with self.assertRaisesRegex(ValueError, 'portable_path_required'):
                adapter.relative(self.root, path)


if __name__ == '__main__':
    unittest.main()
