"""Provider-neutral planning prompt routing, with local test doubles only."""
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from PIL import Image
from ai_ui_decomposition.common import sha256
from ai_ui_decomposition.repository_workflow import RepositoryWorkflow


class RecordingProvider:
    def __init__(self, response):
        self.response = response
        self.calls = []

    def plan(self, reference, instruction, **kwargs):
        self.calls.append((reference, instruction))
        return self.response


class ShopWorkflowProfileTests(unittest.TestCase):
    def test_compiler_diagnostics_preserve_fields_without_raw_paths(self):
        from ai_ui_decomposition.repository_workflow import compile_error
        self.assertEqual(compile_error(ValueError('SHOP_FACTS_FIELDS:rows.items[2]')),
                         {'errorCode':'SHOP_FACTS_FIELDS','field':'rows.items[2]'})
        self.assertEqual(compile_error(ValueError('NATIVE_INPUT_FIELDS')),
                         {'errorCode':'NATIVE_INPUT_FIELDS'})
        for message in ('SHOP_FACTS_FIELDS:C:/private/input.json',
                        'model error with private payload',
                        'SHOP_FACTS_FIELDS:' + 'x'*101):
            self.assertEqual(compile_error(ValueError(message)),
                             {'errorCode':'REPOSITORY_COMPILE_REJECTED'})

    def run_vision(self, profile, response):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        root = Path(temp.name)
        original = root / 'original.png'
        Image.new('RGB', (400, 600), 'white').save(original)
        output = root / 'vision'; output.mkdir()
        options = dict(componentRoot=str(root), providerConfig={'test': 'double'})
        if profile is not None:
            options['planningProfile'] = profile
        fake = RecordingProvider(response)
        context = dict(job=str(root), output=str(output), node='vision', receipts={},
                       spec=dict(fixture=False, reference='original.png',
                                 referenceSha256=sha256(original), canvas=[400, 600], stageTimeout=30))
        with patch('ai_ui_decomposition.headless.load_provider', return_value=fake):
            result = RepositoryWorkflow(options).run(context)
        return result, fake, output

    def test_shop_profile_uses_compact_schema_prompt(self):
        result, fake, output = self.run_vision('shop-facts-v1', json.dumps({'kind': 'ui_shop_facts_v1'}))
        self.assertEqual(result['status'], 'ok')
        self.assertEqual(len(fake.calls), 1)
        self.assertIn('ui_shop_facts_v1', fake.calls[0][1])
        self.assertNotIn('exactly draft and observations', fake.calls[0][1])
        for field in ('"rows"', '"editingState"', '"glyphPaletteRects"', '"runtimeDerivations"'):
            self.assertIn(field, fake.calls[0][1], 'The MCP prompt must carry its schema rather than a local docs path.')
        self.assertEqual(json.loads((output/'response.json').read_text()), {'kind': 'ui_shop_facts_v1'})

    def test_legacy_prompt_is_unchanged(self):
        _, fake, _ = self.run_vision(None, '{}')
        self.assertIn('exactly draft and observations', fake.calls[0][1])

    def test_shop_response_has_bounded_size(self):
        with self.assertRaisesRegex(ValueError, 'REPOSITORY_VISION_RESPONSE_LIMIT'):
            self.run_vision('shop-facts-v1', ' ' * 65537)

    def test_unknown_profile_fails_before_provider(self):
        with self.assertRaisesRegex(ValueError, 'REPOSITORY_PLANNING_PROFILE'):
            RepositoryWorkflow(dict(componentRoot='unused', planningProfile='all-components-auto'))

    def test_compact_profile_rejects_other_response_shapes(self):
        for response in ([], {}, {'kind': 'ui_native_delivery_input_v1'}):
            with self.subTest(response=response), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                reference = root / 'original.png'
                Image.new('RGB', (400, 600), 'white').save(reference)
                source = root / 'nodes/vision/output/response.json'
                source.parent.mkdir(parents=True)
                source.write_text(json.dumps(response), encoding='utf-8')
                output = root / 'compiled'
                output.mkdir()
                context = dict(job=str(root), output=str(output), node='compile',
                    spec=dict(fixture=False, reference=reference.name,
                              stageTimeout=30, maximumCalls=8),
                    receipts=dict(vision=dict(artifacts=dict(response=dict(
                        path='response.json', sha256=sha256(source))))))
                adapter = RepositoryWorkflow(dict(componentRoot=str(root),
                    planningProfile='shop-facts-v1'))
                if not isinstance(response, dict):
                    with self.assertRaisesRegex(ValueError, 'JSON_OBJECT_REQUIRED'):
                        adapter.run(context)
                    continue
                result = adapter.run(context)
                self.assertEqual(result['status'], 'invalid')
                self.assertEqual(result['data']['errorCode'], 'SHOP_FACTS_PROFILE_REQUIRED')

    def test_supplied_compact_facts_freeze_without_generation(self):
        from ai_ui_decomposition import workflow
        from ai_ui_decomposition.common import read_json, digest
        from ai_ui_decomposition.shop_facts import synthetic_facts
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            reference = root / 'original.png'
            Image.new('RGB', (640, 480), '#203040').save(reference)
            facts = synthetic_facts(sha256(reference), [640, 480])
            consumer = Path(__file__).resolve().parents[2] / 'ui-component-harness'
            job = root / 'job'
            workflow.create_job(reference, job,
                factory='ai_ui_decomposition.repository_workflow:create',
                options=dict(componentRoot=str(consumer), response=facts,
                             planningProfile='shop-facts-v1', generationMode='file'),
                maximum_calls=9, stage_timeout=60)
            result = workflow.advance(job, allow_vision=True, max_nodes=2)
            compiled_receipt = read_json(job / 'nodes/compile/receipt.json')
            self.assertEqual(compiled_receipt['status'], 'ok', compiled_receipt.get('data'))
            result = workflow.advance(job)
            self.assertEqual(result['status'], 'awaiting_authorization', result)
            self.assertFalse((job / 'nodes/generate').exists())
            self.assertFalse((job / 'authorization.json').exists())
            prepared = job / 'nodes/compile/output/prepared'
            report = read_json(prepared / 'shop-facts-expansion.json')
            self.assertEqual(report['factsDigest'], digest(facts))
            self.assertEqual(report['status'], 'compiled_not_generated')
            self.assertFalse(report['human_visual_acceptance'])
            self.assertEqual(read_json(prepared / 'response.json')['version'], '1.2')
