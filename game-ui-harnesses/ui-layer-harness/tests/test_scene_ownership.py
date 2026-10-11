"""A background person behind sparse UI must not become foreground artwork."""
import _bootstrap
from copy import deepcopy
import unittest

from ai_ui_layers import context_references as context, experimental_executor as exchange
from ai_ui_layers import sheet_layout_reference as board
from ai_ui_layers.compile_visual import compile_plan, render_prompt
from ai_ui_layers.evaluate import read
import test_context_references as fixtures
from test_reference_edit_prompts import assert_edit_only


class SceneOwnershipTests(unittest.TestCase):
    setUp=fixtures.ContextReferencesTests.setUp
    bind=fixtures.ContextReferencesTests.bind
    frozen=fixtures.ContextReferencesTests.frozen

    def add_person(self):
        self.visual['backgroundMode']='scene-only'
        self.visual['objects'].append(dict(id='scene-person',materialId='asset-scene',
            kind='illustration',label='Background expedition person with dark blue coat and scarf',bboxNorm=None))
        self.visual['objects'].append(dict(id='distant-rock',materialId='asset-scene',
            kind='illustration',label='Distant rock outside the UI crop',bboxNorm=[0,0,.05,.05]))
        self.bind()

    def test_new_direct_foreground_deletes_scene_person_but_keeps_background_and_old_version(self):
        self.add_person()
        for version in ('v12','v13'):
            plan,_=compile_plan(self.visual,[1000,1000],'a'*64,generation_reference='context-crops',
                context_prompt_version=version)
            foreground=render_prompt(next(a for a in plan['assets'] if a['id']=='asset-coin-a'))
            self.assertEqual('scene-person' in foreground,version=='v13')
            self.assertNotIn('distant-rock',foreground)
            assert_edit_only(self,foreground)
            background=render_prompt(next(a for a in plan['assets'] if a['id']=='asset-scene'))
            self.assertIn('只保留背景',background)
            self.assertNotIn('DELETE',background)
            self.assertNotIn('BACKGROUND OWNERSHIP',background)

    def test_actual_single_board_dispatch_contains_scene_removal_without_changing_input_pixels(self):
        self.add_person()
        snapshot,manifest=self.frozen(version='v13')
        row=next(r for r in read(snapshot/'requests.json')['requests'] if r.get('kind')=='sheet')
        metadata,old_pixels,old_prompt=board.build(snapshot,row,prompt_version='v3')
        new_metadata,pixels,prompt=board.build(snapshot,row,prompt_version='v4')
        self.assertEqual(metadata,new_metadata);self.assertEqual(old_pixels,pixels)
        self.assertNotIn('scene-person',old_prompt)
        self.assertIn('scene-person',prompt)
        self.assertIn('BACKGROUND OWNERSHIP',prompt)
        self.assertIn('an owned illustration retains its own depicted subjects',prompt)
        assert_edit_only(self,prompt)
        job=self.root/'scene-job';config=exchange.prepare(snapshot,manifest['digest'],job)
        descriptor=config['contextBoardReferences'][row['asset']]
        self.assertEqual(descriptor['promptVersion'],'v5')
        args=exchange.frozen_request_arguments(job,config,row)
        self.assertEqual(len(args['referenced_image_paths']),1)
        self.assertIn('scene-person',args['prompt'])
        assert_edit_only(self,args['prompt'])


if __name__=='__main__':unittest.main()
