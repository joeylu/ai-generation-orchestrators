"""Actual native request fixtures: edit/remove/keep, without completion commands."""
import _bootstrap
from copy import deepcopy
import re
import unittest

from ai_ui_layers import context_references as context, experimental_executor as exchange
from ai_ui_layers import host_layout_registration as layout, layout_generation as geometry
from ai_ui_layers import sheet_layout_reference as board
from ai_ui_layers.compile_visual import compile_plan, render_prompt
from ai_ui_layers.evaluate import read, digest
from ai_ui_layers.execution_preflight import preflight
from ai_ui_layers.visual_policy import warning_policy, generation_guidance
import test_context_references as fixtures

save=fixtures.save


def assert_edit_only(case, prompt):
    case.assertNotRegex(prompt, re.compile(
        r'reconstruct|rebuild|redraw|restore|fill removed|continue .*surface|surface .*continued|'
        r'through the occluded|重建|重绘|重画|补全', re.I))


class ReferenceEditTests(unittest.TestCase):
    setUp=fixtures.ContextReferencesTests.setUp
    bind=fixtures.ContextReferencesTests.bind
    frozen=fixtures.ContextReferencesTests.frozen

    def test_background_uses_original_only_and_has_no_completion_requirement(self):
        self.visual['backgroundMode']='scene-only';self.bind()
        folder,manifest=self.frozen(version='v12')
        preflight(folder,manifest['digest'])
        job=self.root/'job';config=exchange.prepare(folder,manifest['digest'],job)
        row=next(r for r in read(folder/'requests.json')['requests'] if r['asset']=='asset-scene')
        args=exchange.frozen_request_arguments(job,config,row)
        self.assertEqual(args['referenced_image_paths'],[str((job/'snapshot/reference.png').resolve())])
        self.assertIn('去掉原参考图中的所有 UI，只保留背景',args['prompt'])
        self.assertIn('位置、大小、轮廓、颜色不变',args['prompt'])
        assert_edit_only(self,args['prompt'])

    def test_policy_suffix_and_foregrounds_are_edit_only_but_legacy_is_unchanged(self):
        for policy in (None,warning_policy()):
            plan,_=compile_plan(self.visual,[1000,1000],'a'*64,generation_reference='context-crops',
                context_prompt_version='v12',visual_policy=policy)
            for asset in plan['assets']:
                prompt=render_prompt(asset);assert_edit_only(self,prompt)
                if asset['role']!='background':
                    self.assertIn('Edit the attached reference crops',prompt)
                    self.assertIn('KEEP',prompt);self.assertIn('DELETE',prompt)
                    self.assertIn('transparent margin',prompt)
            background=next(a for a in plan['assets'] if a['role']=='background')['prompt']
            self.assertNotIn('显式视觉策略',background)
        self.assertIn('只补全',generation_guidance(warning_policy()))
        assert_edit_only(self,generation_guidance(warning_policy(),edit_only=True))
        old,_=compile_plan(self.visual,[1000,1000],'a'*64,generation_reference='context-crops',
            context_prompt_version='v11')
        self.assertIn('Restore the existing surface',next(a for a in old['assets'] if a['id']=='asset-panel')['prompt'])

    def test_small_sheet_attaches_one_combined_board_in_one_request(self):
        folder,manifest=self.frozen(version='v12')
        job=self.root/'job';config=exchange.prepare(folder,manifest['digest'],job)
        row=next(r for r in read(folder/'requests.json')['requests'] if r.get('kind')=='sheet')
        self.assertLessEqual(len(row['references']),5)
        args=exchange.frozen_request_arguments(job,config,row)
        self.assertEqual(config['sheetReferencePolicy'],exchange.SHEET_REFERENCE_POLICY)
        self.assertEqual(args['referenced_image_paths'],
            [str((job/'context-boards'/row['asset']/board.BOARD).resolve())])
        self.assertIn(row['asset'],config['contextBoardReferences'])
        self.assertIn('Edit the attached reference board',args['prompt'])
        self.assertEqual(row['plannedCalls'],1)
        assert_edit_only(self,args['prompt'])

    def test_explicit_board_uses_v3_without_changing_reference_pixels_or_legacy_prompt(self):
        folder,manifest=self.frozen(version='v12')
        row=next(r for r in read(folder/'requests.json')['requests'] if r.get('kind')=='sheet')
        old_metadata,old_pixels,old_prompt=board.build(folder,row,prompt_version='v2')
        metadata,pixels,prompt=board.build(folder,row,prompt_version='v3')
        self.assertEqual(metadata,old_metadata);self.assertEqual(pixels,old_pixels)
        self.assertIn('continue KEEP surface',old_prompt)
        assert_edit_only(self,prompt)
        job=self.root/'board-job'
        config=exchange.prepare(folder,manifest['digest'],job,assets=[row['asset']],reference_mode='sheet-layout-board')
        self.assertEqual(config['sheetLayoutReference']['promptVersion'],'v3')
        args=exchange.frozen_request_arguments(job,config,row)
        self.assertEqual(len(args['referenced_image_paths']),1)
        self.assertEqual(args['prompt'],prompt.rstrip('\n'))
        assert_edit_only(self,args['prompt'])

    def test_internal_geometry_suffix_preserves_reference_lines_without_reconstruction(self):
        folder,manifest=self.frozen(version='v12')
        mid='asset-panel'
        box=next(p['sourceRegion'] for p in read(folder/'placements.json')['materials'] if p['id']==mid)
        target=box[1]+(box[3]-box[1])//2
        contract=self.root/'contract.json'
        save(contract,dict(kind=layout.KIND,referenceSha256=digest(folder/'reference.png'),
            materials=[dict(materialId=mid,mode='frame',measurementAlphaThreshold=128,
                            horizontalDividerTargets=[target])],constraints=[],knownDifferences=[]))
        layout.freeze(self.root,dict(layoutContract=str(contract),layoutContractSha256=digest(contract),
            layoutRegistrationPolicy=layout.POLICY))
        job=self.root/'job';config=exchange.prepare(folder,manifest['digest'],job,
            layout_contract=self.root/'frozen-layout-contract.json')
        self.assertEqual(config['layoutGeneration']['promptPolicy'],geometry.REFERENCE_EDIT)
        for row in read(folder/'requests.json')['requests']:
            args=exchange.frozen_request_arguments(job,config,row);assert_edit_only(self,args['prompt'])
            if row['asset']==mid:
                self.assertIn('REFERENCE EDIT',args['prompt'])
                self.assertIn('exactly 1 independent thin horizontal divider',args['prompt'])
                self.assertIn(str(target),args['prompt'])

    def test_exact_text_exceptions_and_preserve_underlay_scope_remain(self):
        visual=deepcopy(self.visual);visual['backgroundMode']='preserve-underlay'
        material=next(m for m in visual['materials'] if m['role']=='background')
        material['preserveText']=['SIGN A','9']
        prompt=context.background_edit_prompt(visual,material,edit_only=True)
        self.assertIn('["SIGN A","9"]',prompt)
        self.assertIn('未导出的 UI 和遮暗',prompt)
        assert_edit_only(self,prompt)

    def test_cleanup_of_v12_material_keeps_reference_edit_policy_including_geometry_suffix(self):
        from ai_ui_layers import material_cleanup as cleanup
        import test_material_cleanup as cleanup_fixture
        folder,manifest=self.frozen(version='v12')
        mid='asset-panel';source=self.root/'source'
        cleanup_fixture.MaterialCleanupTests.make_source(self,folder,manifest['digest'],source,mid)
        box=next(p['sourceRegion'] for p in read(folder/'placements.json')['materials'] if p['id']==mid)
        contract=self.root/'contract.json'
        save(contract,dict(kind=layout.KIND,referenceSha256=digest(folder/'reference.png'),
            materials=[dict(materialId=mid,mode='frame',measurementAlphaThreshold=128,
                            horizontalDividerTargets=[(box[1]+box[3])//2])],constraints=[],knownDifferences=[]))
        layout.freeze(self.root,dict(layoutContract=str(contract),layoutContractSha256=digest(contract),
            layoutRegistrationPolicy=layout.POLICY))
        for i,policy in enumerate((None,cleanup.REFERENCE_INPUT_POLICY)):
            with self.subTest(inputPolicy=policy):
                job=self.root/('cleanup-'+str(i))
                config=cleanup.prepare_cleanup(folder,manifest['digest'],job,mid,source,
                    layout_contract=self.root/'frozen-layout-contract.json',input_policy=policy)
                _,index=exchange.load_job(job)
                self.assertEqual(config['cleanup']['promptVersion'],
                    cleanup.REFERENCE_EDIT_PROMPT_VERSION if policy else cleanup.EDIT_PROMPT_VERSION)
                self.assertEqual(config['layoutGeneration']['promptPolicy'],geometry.REFERENCE_EDIT)
                args=exchange.frozen_request_arguments(job,config,index[mid])
                self.assertEqual(len(args['referenced_image_paths']),2)
                assert_edit_only(self,args['prompt'])
                self.assertIn('Edit the original reference',args['prompt'])
                self.assertIn('REFERENCE EDIT',args['prompt'])

    def test_protected_background_appendix_has_no_fill_or_replacement_requirement(self):
        from ai_ui_layers import background_region_pipeline as region
        prompt=region.generation_guidance(dict(plan=dict(size=[1024,1536])),edit_only=True)
        assert_edit_only(self,prompt)
        self.assertNotIn('replacement',prompt)
        self.assertIn('Remove separately owned UI',prompt)


class DenseReferenceEditTests(unittest.TestCase):
    import test_compact_control_groups as fixtures
    setUp=fixtures.CompactControlHostTests.setUp
    add_coins=fixtures.CompactControlHostTests.add_coins
    prepare=fixtures.CompactControlHostTests.prepare

    def test_historical_v13_host_six_material_sheet_dispatches_one_v5_edit_board(self):
        from ai_ui_layers.generation_groups import COMPACT_CONTROL_POLICY
        self.add_coins()
        self.prepare(generationGroupingPolicy=COMPACT_CONTROL_POLICY,maximumBodyCalls=1,contextPromptVersion='v13')
        snapshot=self.run/'frozen';self.assertEqual(read(snapshot/'snapshot.json')['contextPromptVersion'],'v13')
        job=self.run/'images';config,index=exchange.load_job(job)
        row=next(r for r in index.values() if len(r.get('materialIds',[]))==6)
        descriptor=config['contextBoardReferences'][row['asset']]
        self.assertEqual(descriptor['promptVersion'],'v5')
        args=exchange.frozen_request_arguments(job,config,row)
        self.assertEqual(args['referenced_image_paths'],
            [str((job/'context-boards'/row['asset']/board.BOARD).resolve())])
        self.assertEqual(row['plannedCalls'],1)
        self.assertIn('Edit the attached reference board',args['prompt'])
        assert_edit_only(self,args['prompt'])


if __name__=='__main__':unittest.main()
