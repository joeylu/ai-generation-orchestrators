import _bootstrap  # Enable source-layout imports for unittest discovery.
from pathlib import Path
import tempfile
import unittest
from PIL import Image
from ai_ui_layers.evaluate import read, save, digest
from ai_ui_layers.compile_visual import compile_plan, compile_run, HARNESS


class VisualCompileTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.root=Path(self.tmp.name);self.run=self.root/'run'
        for stage in ('m1','m2'): (self.run/stage).mkdir(parents=True)
        self.visual=read(HARNESS/'planning-harness/examples/visual-plan.json')
        self.visual['unknowns']=[]
        m1=self.run/'m1';m2=self.run/'m2'
        Image.new('RGB',(1000,1000)).save(m1/'reference.png')
        (m1/'prompt.md').write_text('fixture',encoding='utf-8')
        (m1/'schema.json').write_bytes((HARNESS/'planning-harness/schemas/visual-plan.schema.json').read_bytes())
        save(m1/'draft.json',self.visual)
        save(self.run/'request.json',{'inputs':{n:digest(m1/n) for n in ('reference.png','prompt.md','schema.json')}})
        save(m2/'draft.json',{'issues':[]})
        save(m2/'schema.json',{'type':'object','required':['issues'],'properties':{'issues':{'type':'array'}}})
        for n in ('prompt.md','review-source.md','review-overlay.png'):(m2/n).write_bytes(b'fixture')
        save(m2/'request.json',{'sourcePlanSha256':digest(m1/'draft.json'),
            'inputs':{n:digest(m2/n) for n in ('prompt.md','schema.json','review-overlay.png','review-source.md')}})
        save(self.run/'result.json',{'sourcePlanSha256':digest(m1/'draft.json'),'reviewSha256':digest(m2/'draft.json'),
                                   'sameSessionVerified':True,'unknownIssueIds':[]})

    def test_geometry_ownership_and_stable_paint_order(self):
        plan, placements=compile_plan(self.visual,[1000,1000],'a'*64)
        panel=next(a for a in plan['assets'] if a['id']=='asset-panel')
        self.assertEqual(panel['source_region'],[100,50,900,900])
        self.assertEqual(panel['output_size'],[800,850])
        self.assertNotIn('foreground_support',panel)
        self.assertIn('crest',panel['prompt'])
        self.assertIn('coin-a',panel['prompt'])
        self.assertEqual(next(p for p in placements if p['id']=='asset-panel')['centerXY'],[500,475])
        self.assertEqual(next(p for p in placements if p['id']=='asset-panel')['fitMode'],'frame-bounds')
        self.assertTrue(all(p['fitMode']=='contain' for p in placements if p['id']!='asset-panel'))
        self.visual['materials'].reverse()
        self.assertEqual(compile_plan(self.visual,[1000,1000],'a'*64)[0],plan)

    def test_offline_compilation_writes_real_crops_but_never_freezes(self):
        output=self.root/'out';report=compile_run(self.run,output,5)
        self.assertEqual(report['materialCount'],5)
        self.assertEqual(report['generationCalls'],0)
        self.assertFalse(report['freezeExecuted'])
        self.assertEqual(len(report['blockers']),3)
        self.assertFalse(list(output.rglob('batch.json')))
        with Image.open(output/'materials/asset-panel/reference-crop.png') as crop:
            self.assertEqual(crop.size,(800,850))
        self.assertEqual(digest(output/'reference.png'),digest(self.run/'m1/reference.png'))

    def test_changed_plan_and_over_budget_rejected_before_output(self):
        output=self.root/'out'
        with self.assertRaisesRegex(ValueError,'CALL_LIMIT_EXCEEDED'):
            compile_run(self.run,output,4)
        self.assertFalse(output.exists())
        with (self.run/'m1/draft.json').open('a',encoding='utf-8') as f:f.write(' ')
        with self.assertRaisesRegex(ValueError,'PLAN_CHANGED'):
            compile_run(self.run,output)
        self.assertFalse(output.exists())


if __name__=='__main__':unittest.main()
