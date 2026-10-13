"""Ownership-removal conflict regression across native image request paths."""
import _bootstrap
from copy import deepcopy
import unittest

from ai_ui_layers import owned_content_prompt as scoped, output_role_prompt as legacy
from ai_ui_layers import sheet_layout_reference as board, experimental_executor as exchange
from ai_ui_layers.compile_visual import compile_plan, render_prompt
from ai_ui_layers.execution_preflight import preflight
from ai_ui_layers.evaluate import read
import test_context_references as fixtures


class OwnedContentPromptTests(unittest.TestCase):
    setUp=fixtures.ContextReferencesTests.setUp
    bind=fixtures.ContextReferencesTests.bind
    frozen=fixtures.ContextReferencesTests.frozen

    def assert_scoped(self,prompt):
        self.assertIn(scoped.TEXT,prompt)
        self.assertNotIn(legacy.TEXT,prompt)
        self.assertNotIn('Keep neighboring icons',prompt)
        self.assertNotIn('Fill only removed glyph footprints',prompt)

    def test_v16_routes_all_native_paths_and_keeps_board_pixels(self):
        snapshot,manifest=self.frozen(version='v16')
        self.assertEqual(preflight(snapshot,manifest['digest'])['inputChecks'],'passed')
        job=self.root/'scoped-job'
        config=exchange.prepare(snapshot,manifest['digest'],job)
        self.assertEqual({v['promptVersion'] for v in config['contextBoardReferences'].values()},{'v9'})
        _,index=exchange.load_job(job)
        for row in index.values():
            self.assert_scoped(exchange.frozen_request_arguments(job,config,row)['prompt'])
        row=next(r for r in index.values() if r.get('kind')=='sheet')
        old_meta,old_png,old_prompt=board.build(snapshot,row,prompt_version='v8')
        meta,png,prompt=board.build(snapshot,row,prompt_version='v9')
        self.assertEqual((meta,png),(old_meta,old_png))
        self.assertIn(legacy.TEXT,old_prompt)
        self.assert_scoped(prompt)
        self.assertLess(prompt.index(scoped.SCOPE),prompt.index(scoped.FIDELITY))
        self.assertEqual(exchange.status(job)['assignedCalls'],0)

    def test_substrate_and_fixed_picture_have_distinct_retention_scope(self):
        before=deepcopy(self.visual)
        for fixed in (False,True):
            visual=deepcopy(before)
            if fixed:
                visual['objects'].append(dict(id='fixed-picture',materialId='asset-panel',
                    kind='illustration',label='Fixed landscape with subjects',bboxNorm=None))
            plan,_=compile_plan(visual,[1000,1000],'a'*64,generation_reference='context-crops',context_prompt_version='v16')
            prompt=render_prompt(next(a for a in plan['assets'] if a['id']=='asset-panel'))
            self.assert_scoped(prompt)
            self.assertIn('FINAL ASSET: '+('owned-artwork' if fixed else 'clean-substrate'),prompt)
            self.assertIn(scoped.FIDELITY,prompt)
            if fixed:self.assertIn('fixed-picture',prompt)
        self.assertEqual(self.visual,before)


if __name__=='__main__':unittest.main()
