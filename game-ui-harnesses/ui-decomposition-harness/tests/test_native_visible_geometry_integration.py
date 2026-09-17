"""Offline native-input -> materialized geometry gate integration coverage."""
import io
import json
from pathlib import Path
import subprocess
import tempfile
import unittest

from PIL import Image, ImageDraw

from ai_ui_decomposition import batch
from ai_ui_decomposition.acceptance_execution import AcceptanceExecution
from ai_ui_decomposition.adapter import export_request, import_result, seal_result
from ai_ui_decomposition.common import read_json, sha256, write_json
from ai_ui_decomposition.delivery_adapter import compile_delivery, prepare_handoff
from ai_ui_decomposition.handoff_build import build_handoff
from test_native_delivery import native_fixture


class NativeVisibleGeometryIntegrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.root = Path(cls.tmp.name)
        cls.consumer = Path(__file__).resolve().parents[2] / 'ui-component-harness'
        fixtures = cls.root / 'fixtures'
        subprocess.run([
            'node', str(Path(__file__).with_name('stateful-fixtures.mjs')),
            str(cls.consumer), str(fixtures),
        ], check=True, capture_output=True)

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def _compile_and_prepare(self, name, minimum_width):
        fixture = self.root / 'fixtures' / 'CheckBox'
        request, raws = native_fixture(fixture)
        target_row = next(row for row in request['materials']
                          if row['layerId'] != 'background')
        target = target_row['layerId']
        target_row['groupId'] = None
        request['version'] = '1.1'
        request['visibleGeometryRequirements'] = [{
            'materialId': target,
            'alphaThreshold': 1,
            'minimumOccupancy': {'width': minimum_width},
            'reservedRects': [],
            'textWorldRects': [],
            'imageWorldRect': None,
        }]

        output = self.root / name
        output.mkdir()
        compiled = output / 'compiled'
        compile_delivery(fixture / 'reference.png', request, compiled,
                         self.consumer, 8)
        batch.freeze(compiled / 'plan.json', output / 'generation', 'one',
                     capability_request=compiled / 'capabilities.json',
                     component_document=compiled / 'semantic-document.json',
                     layout_spacing=compiled / 'layout-spacing.json')
        run = output / 'generation' / 'runs' / 'one'
        plan = read_json(compiled / 'plan.json')
        for asset in plan['assets']:
            key = asset['id']
            bundle = output / ('request-' + key)
            export_request(run, key, bundle)
            if key == target:
                width, height = asset['output_size']
                image = Image.new('RGB', (width, height), '#F808F8')
                ImageDraw.Draw(image).rectangle(
                    (width // 4, 1, max(width // 4, 3 * width // 4 - 1), height - 2),
                    fill=(30, 30, 30),
                )
            elif key.startswith('board-'):
                board = read_json(compiled / ('strategy-' + key[6:] + '.json'))['boards'][0]
                image = Image.new('RGB', board['canvas'], '#F808F8')
                for slot in board['slots']:
                    part = Image.open(io.BytesIO(raws[slot['asset_id']])).convert('RGBA')
                    left, top, right, bottom = slot['search_window']
                    image.paste(part, ((left + right - part.width) // 2,
                                       (top + bottom - part.height) // 2), part)
            else:
                image = Image.open(io.BytesIO(raws[key])).convert('RGB')
            result = output / (key + '.png')
            image.save(result)
            seal_result(bundle, result)
            import_result(run, bundle)

        build = prepare_handoff(compiled, run, output / 'prepared', self.consumer)
        return output, build, target

    def test_native_materialized_gate_rejects_narrow_alpha_and_accepts_sufficient_width(self):
        failed_root, failed_build, failed_material = self._compile_and_prepare('too-narrow', 0.8)
        failed_plan = read_json(failed_build)
        self.assertIn('visibleMaterialGeometry', failed_plan)
        geometry_path = failed_build.parent / failed_plan['visibleMaterialGeometry']['path']
        self.assertEqual(sha256(geometry_path), failed_plan['visibleMaterialGeometry']['sha256'])
        geometry = read_json(geometry_path)
        specification = geometry['checks'][0]
        self.assertEqual(specification['materialId'], failed_material)
        material_records = read_json(
            failed_build.parent / failed_plan['run']['path'] / 'materials' / 'materials.json'
        )['assets']
        material = next(row for row in material_records if row['asset'] == failed_material)
        self.assertEqual(specification['sourceSha256'], sha256(
            failed_build.parent / failed_plan['run']['path'] / material['path']))
        with self.assertRaisesRegex(ValueError, 'VISIBLE_MATERIAL_GEOMETRY_REJECTED'):
            build_handoff(failed_build, self.consumer, failed_root / 'rejected',
                          AcceptanceExecution(90))
        failed_report = read_json(failed_root / 'rejected' / 'visible-material-geometry.json')
        self.assertEqual(failed_report['status'], 'failed')
        self.assertFalse((failed_root / 'rejected' / 'assembly').exists())

        passed_root, passed_build, _ = self._compile_and_prepare('sufficient-width', 0.4)
        build_handoff(passed_build, self.consumer, passed_root / 'accepted',
                      AcceptanceExecution(90))
        passed_report = read_json(passed_root / 'accepted' / 'visible-material-geometry.json')
        self.assertEqual(passed_report['status'], 'passed')
        self.assertTrue((passed_root / 'accepted' / 'assembly').exists())

    def test_native_1_1_rejects_unknown_layer_and_boolean_threshold_at_preflight(self):
        fixture = self.root / 'fixtures' / 'CheckBox'
        request, _raws = native_fixture(fixture)
        request['version'] = '1.1'
        request['visibleGeometryRequirements'] = [{
            'materialId': 'missing-layer', 'alphaThreshold': 1,
            'minimumOccupancy': {'width': 0.5}, 'reservedRects': [],
            'textWorldRects': [], 'imageWorldRect': None,
        }]
        with self.assertRaisesRegex(ValueError, 'NATIVE_VISIBLE_GEOMETRY_MATERIAL_MISSING'):
            compile_delivery(fixture / 'reference.png', request, self.root / 'unknown-layer',
                             self.consumer, 8)

        request['visibleGeometryRequirements'][0]['materialId'] = next(
            row['layerId'] for row in request['materials'] if row['layerId'] != 'background'
        )
        request['visibleGeometryRequirements'][0]['alphaThreshold'] = True
        with self.assertRaisesRegex(ValueError, 'NATIVE_VISIBLE_GEOMETRY_ALPHA_THRESHOLD'):
            compile_delivery(fixture / 'reference.png', request, self.root / 'boolean-threshold',
                             self.consumer, 8)

        request['visibleGeometryRequirements'][0]['alphaThreshold'] = 1
        request['version'] = '9.0'
        with self.assertRaisesRegex(ValueError, 'NATIVE_INPUT_VERSION'):
            compile_delivery(fixture / 'reference.png', request, self.root / 'unknown-version',
                             self.consumer, 8)

    def test_compiled_requirement_digest_rejects_response_edit_before_processing(self):
        fixture = self.root / 'fixtures' / 'CheckBox'
        request, _raws = native_fixture(fixture)
        target = next(row['layerId'] for row in request['materials']
                      if row['layerId'] != 'background')
        request['version'] = '1.1'
        request['visibleGeometryRequirements'] = [{
            'materialId': target, 'alphaThreshold': 1,
            'minimumOccupancy': {'width': 0.5}, 'reservedRects': [],
            'textWorldRects': [], 'imageWorldRect': None,
        }]
        output = self.root / 'tampered-response'
        output.mkdir()
        compiled = output / 'compiled'
        compile_delivery(fixture / 'reference.png', request, compiled,
                         self.consumer, 8)
        batch.freeze(compiled / 'plan.json', output / 'generation', 'one',
                     capability_request=compiled / 'capabilities.json',
                     component_document=compiled / 'semantic-document.json',
                     layout_spacing=compiled / 'layout-spacing.json')
        response = read_json(compiled / 'response.json')
        response['visibleGeometryRequirements'][0]['minimumOccupancy']['width'] = 0.6
        (compiled / 'response.json').write_text(
            json.dumps(response, ensure_ascii=False, indent=2) + '\n', encoding='utf-8'
        )
        with self.assertRaisesRegex(ValueError, 'NATIVE_VISIBLE_GEOMETRY_PLAN_BINDING'):
            prepare_handoff(compiled, output / 'generation' / 'runs' / 'one',
                            output / 'prepared', self.consumer)
        self.assertFalse((output / 'generation' / 'runs' / 'one' / 'materials').exists())


if __name__ == '__main__':
    unittest.main()
