import tempfile
import unittest
from pathlib import Path
from jsonschema import Draft202012Validator
from evaluate import read,save
from compile_visual import compile_plan,HARNESS
from preview_partial import preview
from codex_call import transport_schema

class DecorationOwnershipTests(unittest.TestCase):
    def setUp(self):
        self.schema=read(HARNESS/'planning-harness/schemas/visual-plan.schema.json')
        self.plan=read(HARNESS/'planning-harness/examples/visual-plan.json');self.plan['unknowns']=[]
        self.plan['objects'].append({'id':'ornament','label':'Outlined diamonds, glowing divider and decorative lettering KEEP GOING','kind':'decoration','materialId':'asset-panel','bboxNorm':None})
    def test_generated_asset_preserves_decorative_text_and_style(self):
        plan,_=compile_plan(self.plan,[1000,1000],'a'*64)
        prompt=next(a['prompt'] for a in plan['assets'] if a['id']=='asset-panel')
        self.assertIn('KEEP GOING',prompt)
        self.assertIn('decorative lettering exactly as visible',prompt)
        self.assertIn('No program will redraw',prompt)
        self.assertNotIn('restored as editable overlays',prompt)
    def test_retired_contract_cannot_silently_lose_artwork(self):
        self.plan['surfaceDetails']=[{'id':'legacy'}]
        self.assertTrue(list(Draft202012Validator(self.schema).iter_errors(self.plan)))
        with self.assertRaisesRegex(ValueError,'UNRESOLVED_PLAN'):compile_plan(self.plan,[1000,1000],'a'*64)
    def test_preview_rejects_drawing_configuration_before_output(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);config=root/'config.json';save(config,{'surfaceDetails':'retired'})
            with self.assertRaisesRegex(ValueError,'PROGRAMMATIC_UI_DRAWING_REMOVED'):preview(config,root/'out')
            self.assertFalse((root/'out').exists())
    def test_model_schema_remains_supported_and_does_not_mutate_storage(self):
        original=read(HARNESS/'planning-harness/schemas/visual-plan.schema.json')
        strict=transport_schema(original)
        self.assertNotIn('surfaceDetails',strict['properties'])
        self.assertEqual(set(strict['required']),set(strict['properties']))
        self.assertEqual(original,self.schema)
    def test_owned_wordmark_retains_glyphs(self):
        self.plan['objects'][-1]['kind']='logo'
        plan,_=compile_plan(self.plan,[1000,1000],'a'*64)
        self.assertIn('Do not remove its glyphs',plan['assets'][1]['prompt'])
