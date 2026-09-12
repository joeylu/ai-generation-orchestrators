import copy
import json
import shutil
import subprocess
import tempfile
import unittest
import zipfile
from pathlib import Path

from PIL import Image
from ai_ui_decomposition.common import ContractError, read_json, write_json
from ai_ui_decomposition.reference_delivery import reference_members, upgrade_reference_handoff, validate_states
from ai_ui_decomposition.runtime import init_plan
from ai_ui_decomposition.component_handoff import export_component_handoff


class ReferenceDeliveryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.root = Path(self.temp.name)
        self.original = self.root / 'input.PNG'
        Image.new('RGB', (20, 10), '#aabbcc').save(self.original, format='PNG')
        self.bundle = {'document': {'canvas': {'width': 20, 'height': 10}, 'root': {'id': 'root', 'type': 'Container', 'children': [
            {'id': 'toggle', 'type': 'Switch', 'props': {'checked': False}}]}}}
        self.state = {'kind': 'ui-reference-state', 'schemaVersion': '1.0', 'components': [
            {'componentId': 'toggle', 'componentType': 'Switch', 'fields': {'checked': {'status': 'unknown', 'reason': 'Occluded'}}}]}
        self.scope = {'kind': 'ui-acceptance-scope', 'schemaVersion': '1.0', 'referenceState': 'reference/reference-state.json', 'human_visual_acceptance': False,
                      'components': [{'componentId': cid, 'mode': 'compare', 'reason': 'Offline fixture'} for cid in ('root', 'toggle')], 'derivedTestStates': []}
        self.mapping = {'coordinateSpace': 'raw-image-pixel-edges-to-runtime-canvas', 'sourceSize': [20, 10], 'targetSize': [20, 10], 'crop': [0, 0, 20, 10], 'rotationDegrees': 0, 'flipX': False, 'flipY': False, 'scale': [1, 1], 'offset': [0, 0]}
        self.flush()

    def tearDown(self):
        self.temp.cleanup()

    def flush(self):
        for name in ('state', 'scope', 'mapping'):
            (self.root / (name+'.json')).write_text(json.dumps(getattr(self, name)), encoding='utf8')

    def build(self, derived=None):
        self.flush()
        return reference_members(self.original, self.root/'state.json', self.root/'scope.json', self.root/'mapping.json', self.bundle, derived)

    def test_original_exact_bytes_extension_and_unknown(self):
        members, manifest, unknown = self.build()
        self.assertEqual(members['reference/original.PNG'], self.original.read_bytes())
        self.assertEqual(unknown, ['toggle.checked'])
        self.assertEqual(manifest['original']['width'], 20)

    def test_absent_original_rejected(self):
        self.original.unlink()
        with self.assertRaisesRegex(ContractError, 'REFERENCE_ORIGINAL_REQUIRED'): self.build()

    def test_dimensions_and_mapping_rejected(self):
        for field, value, code in [('sourceSize', [21, 10], 'REFERENCE_SIZE_MISMATCH'), ('scale', [2, 1], 'REFERENCE_MAPPING_BOUNDS'), ('crop', [-1, 0, 20, 10], 'REFERENCE_CROP_INVALID')]:
            old = copy.deepcopy(self.mapping); self.mapping[field] = value
            with self.assertRaisesRegex(ContractError, code): self.build()
            self.mapping = old
        del self.mapping['rotationDegrees']
        with self.assertRaisesRegex(ContractError, 'REFERENCE_MAPPING_INCOMPLETE'): self.build()

    def test_unknown_no_fabricated_value_or_missing_reason(self):
        self.state['components'][0]['fields']['checked']['value'] = False
        with self.assertRaisesRegex(ContractError, 'REFERENCE_STATE_UNKNOWN'): self.build()

    def test_missing_component_and_derived_observation_rejected(self):
        self.state['components'][0]['componentId'] = 'missing'
        with self.assertRaisesRegex(ContractError, 'REFERENCE_STATE_COMPONENT'): self.build()
        self.state['components'][0]['componentId'] = 'toggle'
        self.state['components'][0]['fields']['checked'] = {'status': 'contract-derived', 'value': True, 'evidence': 'Not observed'}
        with self.assertRaisesRegex(ContractError, 'REFERENCE_STATE_EVIDENCE'): self.build()

    def test_derived_image_independent_source_and_transform(self):
        Image.new('RGB', (10, 20)).save(self.root/'rotated.png')
        mapping = {**self.mapping, 'targetSize': [10, 20], 'rotationDegrees': 90}
        config = self.root/'derived.json'
        write_json(config, {'images': [{'file': 'rotated.png', 'mapping': mapping}]})
        members, reference, _ = self.build(config)
        self.assertEqual(members['reference/derived-1.png'], (self.root/'rotated.png').read_bytes())
        self.assertEqual(reference['derivatives'][0]['source'], 'reference/original.PNG')
        config.write_text(json.dumps({'images': [{'file': '../rotated.png', 'mapping': mapping}]}), encoding='utf8')
        with self.assertRaisesRegex(ContractError, 'UNSAFE_PATH'): self.build(config)

    def test_init_preserves_original_jpeg_and_orientation_provenance(self):
        source = self.root/'camera.jpg'; image = Image.new('RGB', (20, 10))
        exif = Image.Exif(); exif[274] = 6; image.save(source, exif=exif)
        init_plan(source, self.root/'project/plan.json', 'fixture', 'fixture')
        self.assertEqual(source.read_bytes(), (self.root/'project/inputs/original.jpg').read_bytes())
        evidence = read_json(self.root/'project/inputs/reference-provenance.json')
        self.assertEqual(evidence['mapping']['rotationDegrees'], 90)
        self.assertEqual(evidence['normalized']['size'], [10, 20])

    def test_python_export_to_official_consumer_cli_in_isolation(self):
        component = Path(__file__).resolve().parents[2]/'ui-component-harness'
        script = """
import {writeFile} from 'node:fs/promises';
const root=process.argv[1], output=process.argv[2];
const {componentHandoffFixture}=await import(root+'/tests/helpers/component-handoff-fixture.ts');
await writeFile(output,await componentHandoffFixture());
"""
        old = self.root/'old.zip'
        subprocess.run(['node', '--input-type=module', '-e', script, component.as_uri(), str(old)], check=True, capture_output=True)
        with zipfile.ZipFile(old) as archive:
            bundle = json.loads(archive.read('component.ui-bundle.json'))
        Image.new('RGB', (500, 400)).save(self.original, format='PNG')
        self.mapping.update(sourceSize=[500, 400], targetSize=[500, 400], crop=[0, 0, 500, 400])
        observed = lambda value: {'status': 'observed', 'value': value, 'evidence': 'Local fixture state'}
        self.state['components'] = [
            {'componentId': 'apply-switch', 'componentType': 'Switch', 'fields': {'checked': observed(True)}},
            {'componentId': 'apply-select', 'componentType': 'Select', 'fields': {'selectedId': observed('low'), 'popupOpen': observed(True)}}]
        self.scope['components'] = [{'componentId': cid, 'mode': 'compare', 'reason': 'Fixture'} for cid in ('root', 'apply-switch', 'apply-select', 'apply-button')]
        self.flush()
        output = self.root/'v2.zip'
        result = upgrade_reference_handoff(old, self.original, self.root/'state.json', self.root/'scope.json', self.root/'mapping.json', output)
        self.assertTrue(result['visualComparisonReady'])
        isolated = self.root/'isolated'; isolated.mkdir(); shutil.copyfile(output, isolated/'only.zip')
        # Only the ZIP is supplied to the consumer, from a directory without input plans/materials.
        subprocess.run(['node', str(component/'scripts/cli.mjs'), 'component-handoff', 'only.zip', '--output', 'bundle.json', '--reference-output', 'reference.json'], cwd=isolated, check=True, capture_output=True)
        self.assertEqual(read_json(isolated/'reference.json')['status'], 'complete')
        with zipfile.ZipFile(output) as archive:
            self.assertEqual(archive.read('reference/original.PNG'), self.original.read_bytes())
        with self.assertRaisesRegex(ContractError, 'REFERENCE_OUTPUT_EXISTS'):
            upgrade_reference_handoff(old, self.original, self.root/'state.json', self.root/'scope.json', self.root/'mapping.json', output)

    def test_normal_exporter_packages_reference_contract(self):
        from test_headless import FakeProvider
        from ai_ui_decomposition.headless import auto_run
        from ai_ui_decomposition.common import sha256
        Image.new('RGB', (64, 48)).save(self.original, format='PNG')
        job = self.root/'job'
        auto_run(self.original, job, FakeProvider(), maximum_calls=4, timeout_seconds=60, authorized=True, output_format='png_zip')
        document = {'schemaVersion': '0.2', 'id': 'reference-fixture', 'canvas': {'width': 64, 'height': 48},
                    'root': {'id': 'root', 'type': 'Container', 'layout': {'x': 0, 'y': 0, 'width': 64, 'height': 48},
                             'props': {'style': {'opacity': 1}}, 'children': []}}
        # This unit exercises the producer path; official consumer validation is tested above
        # with its complete, independently authored component fixture.
        target = self.root/'target.json'; write_json(target, {'document': document})
        delivery = job/'delivery'; binding = self.root/'binding.json'
        receipt = read_json(delivery/'png-zip-export.json')
        write_json(binding, {'kind': 'ui-appearance-binding', 'version': '0.2', 'bindings': [],
                            'deliveryDigest': read_json(delivery/'delivery.json')['digest'],
                            'sceneSha256': sha256(delivery/'scene.json'), 'archiveSha256': receipt['zip_sha256']})
        self.state['components'] = []
        self.scope['components'] = [{'componentId': 'root', 'mode': 'compare', 'reason': 'Fixture'}]
        self.mapping.update(sourceSize=[64, 48], targetSize=[64, 48], crop=[0, 0, 64, 48]); self.flush()
        result = export_component_handoff(delivery, target, binding, reference_original=self.original,
                                         reference_state=self.root/'state.json', acceptance_scope=self.root/'scope.json', reference_mapping=self.root/'mapping.json')
        self.assertEqual(result['reference_evidence'], 'complete')
        with zipfile.ZipFile(delivery/result['file']) as archive:
            self.assertEqual(archive.read('reference/original.PNG'), self.original.read_bytes())
            self.assertEqual(json.loads(archive.read('handoff.json'))['kind'], 'ai_ui_component_handoff_v2')
