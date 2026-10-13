"""Regressions for substrate/child duplication and divergent native prompts."""
import _bootstrap
from copy import deepcopy
import json
import unittest

from ai_ui_layers import context_references as context, output_role_prompt as roles
from ai_ui_layers import experimental_executor as exchange, sheet_layout_reference as board
from ai_ui_layers.compile_visual import compile_plan, render_prompt
from ai_ui_layers.execution_preflight import preflight
from ai_ui_layers.evaluate import read, digest
import test_context_references as fixtures


def records(prompt, prefix):
    return [json.loads(line[len(prefix):]) for line in prompt.splitlines() if line.startswith(prefix)]


class OutputRolePromptTests(unittest.TestCase):
    setUp=fixtures.ContextReferencesTests.setUp
    bind=fixtures.ContextReferencesTests.bind
    frozen=fixtures.ContextReferencesTests.frozen

    def card(self):
        obj=next(o for o in self.visual['objects'] if o['id']=='panel')
        obj['kind']='card'
        obj['label']='Pale paper backing, slender rounded double border and fixed corner marks'
        self.bind()

    def test_card_with_separate_children_is_substrate_but_fixed_illustration_is_not(self):
        self.card()
        material=next(m for m in self.visual['materials'] if m['id']=='asset-panel')
        self.assertTrue(roles.is_substrate(self.visual,material))
        fixed=deepcopy(self.visual)
        fixed['objects'].append(dict(id='fixed-picture',materialId=material['id'],kind='illustration',
            label='Fixed portrait and its landscape inside the card',bboxNorm=None))
        self.assertFalse(roles.is_substrate(fixed,material))
        # Merely being a card, or touching a later neighbor, is insufficient.
        separate=deepcopy(self.visual)
        for m in separate['materials']:
            if m['id']!=material['id']:m['zOrder']=0
        self.assertFalse(roles.is_substrate(separate,material))
        fixed['objects'][-1]['kind']='unknown'
        self.assertFalse(roles.is_substrate(fixed,material))

    def test_standalone_declares_empty_substrate_without_changing_ownership(self):
        self.card();before=deepcopy(self.visual)
        plan,_=compile_plan(self.visual,[1000,1000],'a'*64,generation_reference='context-crops',context_prompt_version='v14')
        prompt=render_prompt(next(a for a in plan['assets'] if a['id']=='asset-panel'))
        self.assertIn('FINAL ASSET: clean-substrate',prompt)
        self.assertIn('Continue the existing surface across removed overlays',prompt)
        keep=records(prompt,'KEEP: ')[0]
        self.assertEqual({o['id'] for o in keep},{'panel','crest'})
        foreign=records(prompt,'REMOVE: ')[0]
        self.assertEqual({o['materialId'] for o in foreign},{'asset-buy-button','asset-coin-a','asset-coin-b'})
        self.assertTrue(all(o['relation']=='overlay' for o in foreign))
        self.assertNotIn('excludeArtwork',prompt)
        self.assertEqual(self.visual,before)
        fixed=deepcopy(self.visual)
        fixed['objects'].append(dict(id='fixed-picture',materialId='asset-panel',kind='illustration',
            label='Fixed portrait and its landscape',bboxNorm=None))
        plan,_=compile_plan(fixed,[1000,1000],'a'*64,generation_reference='context-crops',context_prompt_version='v14')
        prompt=render_prompt(next(a for a in plan['assets'] if a['id']=='asset-panel'))
        self.assertIn('FINAL ASSET: owned-artwork',prompt)
        self.assertIn('fixed-picture',prompt)

    def test_native_standalone_and_board_share_text_and_content_contract(self):
        self.card()
        # A foreground object's label contains ordinary CJK; this is evidence,
        # never an implicit exception to removal.
        next(o for o in self.visual['objects'] if o['id']=='coin-a')['label']='Gold icon with 购买 label'
        next(m for m in self.visual['materials'] if m['id']=='asset-coin-b')['preserveText']=['LV.9']
        self.bind()
        snapshot,manifest=self.frozen(version='v14')
        self.assertEqual(preflight(snapshot,manifest['digest'])['inputChecks'],'passed')
        before={p.relative_to(snapshot).as_posix():digest(p) for p in snapshot.rglob('*') if p.is_file()}
        job=self.root/'job';config=exchange.prepare(snapshot,manifest['digest'],job)
        _,index=exchange.load_job(job)
        sheet=next(row for row in index.values() if row.get('kind')=='sheet')
        self.assertEqual(config['contextBoardReferences'][sheet['asset']]['promptVersion'],'v7')
        single=exchange.frozen_request_arguments(job,config,index['asset-buy-button'])
        combined=exchange.frozen_request_arguments(job,config,sheet)
        self.assertEqual(len(combined['referenced_image_paths']),1)
        for args in (single,combined):
            self.assertIn(roles.TEXT,args['prompt'])
            self.assertIn(roles.FIDELITY,args['prompt'])
            self.assertIn('including their outlines, shadows and glow',args['prompt'])
        self.assertEqual(records(combined['prompt'],'preserveText: '),
            [next(m for m in self.visual['materials'] if m['id']==key)['preserveText'] for key in sheet['materialIds']])
        self.assertEqual(config['maximumCalls'],len(index))
        self.assertEqual(config['automaticRetries'],0)
        self.assertFalse((job/'authorization.json').exists())
        self.assertEqual(before,{p.relative_to(snapshot).as_posix():digest(p) for p in snapshot.rglob('*') if p.is_file()})

    def test_board_maps_foreign_object_anchors_to_same_whole_board_coordinates(self):
        # Parent contains anchored decoration. In a child's cell its DELETE
        # locator must be remapped with the parent, rather than left crop-local.
        snapshot,manifest=self.frozen(version='v14')
        row=next(row for row in read(snapshot/'requests.json')['requests'] if row.get('kind')=='sheet')
        metadata,pixels,prompt=board.build(snapshot,row,prompt_version='v7')
        foreign=records(prompt,'REMOVE: ')
        for cell,ref,removed in zip(metadata['cells'],row['references'],foreign):
            parent=next(owner for owner in removed if owner['materialId']=='asset-panel')
            crest=next(o for o in parent['objects'] if o['objectId']=='crest')
            original=next(o for o in self.visual['objects'] if o['id']=='crest')['bboxNorm']
            local=context.local_box(original,ref,[1000,1000])
            expected=board._map_box(local,cell['boardCropBox'][:2],
                [*ref['referenceSize'],metadata['integerScale']],metadata['outputSize'])
            self.assertEqual(crest['referenceBox'],expected)
        old_metadata,old_pixels,_=board.build(snapshot,row,prompt_version='v5')
        self.assertEqual((metadata,pixels),(old_metadata,old_pixels))

    def test_background_includes_positive_identity_and_exact_removal_scope(self):
        self.visual['backgroundMode']='scene-only'
        bg=next(m for m in self.visual['materials'] if m['role']=='background')
        next(o for o in self.visual['objects'] if o['id']=='scene')['label']='Dark blue background with a faint cyan bottom glow'
        before=deepcopy(self.visual)
        prompt=roles.background(self.visual,bg)
        self.assertIn('Dark blue background with a faint cyan bottom glow',prompt)
        self.assertIn('ENTIRE UI assembly',prompt)
        self.assertIn('Erasing words alone is insufficient',prompt)
        self.assertIn('full opaque PNG',prompt)
        self.assertIn('asset-panel',prompt)
        self.assertEqual(before,self.visual)
        self.visual['backgroundMode']='preserve-underlay';bg['preserveText']=['SIGN A']
        prompt=roles.background(self.visual,bg)
        self.assertNotIn('ENTIRE UI assembly',prompt)
        self.assertIn('Keep unexported UI, dimming',prompt)
        self.assertIn('preserveText: ["SIGN A"]',prompt)

    def test_v13_prompts_revalidate_and_cannot_be_upgraded_in_place(self):
        self.card()
        snapshot,manifest=self.frozen(version='v13')
        before={p.relative_to(snapshot).as_posix():digest(p) for p in snapshot.rglob('*') if p.is_file()}
        job=self.root/'old';config=exchange.prepare(snapshot,manifest['digest'],job)
        self.assertEqual({d['promptVersion'] for d in config['contextBoardReferences'].values()},{'v5'})
        self.assertEqual(preflight(snapshot,manifest['digest'])['inputChecks'],'passed')
        self.assertEqual(before,{p.relative_to(snapshot).as_posix():digest(p) for p in snapshot.rglob('*') if p.is_file()})


if __name__=='__main__':unittest.main()
