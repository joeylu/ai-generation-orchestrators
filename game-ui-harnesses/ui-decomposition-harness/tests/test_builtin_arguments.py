import unittest
from ai_ui_decomposition import adapter,batch
from ai_ui_decomposition.common import ContractError,read_json


class BuiltinArgumentsTests(unittest.TestCase):
    def test_exact_prompt_and_references_are_read_from_verified_bundle(self):
        import test_harness
        f=test_harness.HarnessTests();f.setUp();self.addCleanup(f.tearDown)
        batch.freeze(f.root/'plan.json',f.workspace,'payload');run=f.workspace/'runs/payload';bundle=f.root/'request'
        adapter.export_request(run,'button',bundle);args=adapter.builtin_image_arguments(bundle)
        self.assertEqual(args['prompt'],read_json(bundle/'request.json')['prompt'])
        self.assertEqual(args['referenced_image_paths'],[str((bundle/'input/reference.png').resolve()),str((bundle/'input/crop.png').resolve())])
        actual=f.root/'actual.txt';actual.write_text(args['prompt']+' changed provenance',encoding='utf-8')
        report=adapter.audit_submitted_prompt(bundle,actual,f.root/'audit.json')
        self.assertEqual(report['status'],'request_prompt_mismatch');self.assertTrue(report['changes'])
        self.assertFalse(report['human_visual_acceptance'])
        with (bundle/'prompt.txt').open('a',encoding='utf-8') as out:out.write('changed marker')
        with self.assertRaisesRegex(ContractError,'ADAPTER_INPUT_CHANGED'):adapter.builtin_image_arguments(bundle)
