"""Offline fixtures for background editing, grouping and uncertain cutouts."""
import _bootstrap
from copy import deepcopy
import unittest
import zipfile

from PIL import Image

from ai_ui_layers import context_references as context, experimental_executor as exchange
from ai_ui_layers import generation_groups as groups, host_sheet_fallback as fallback
from ai_ui_layers import received_diagnostic_delivery as diagnostic
from ai_ui_layers.evaluate import read, digest
from ai_ui_layers.execution_preflight import preflight
from ai_ui_layers.host_material_review import files
from ai_ui_layers.viewport_geometry_revision import validate_viewport_archive
import test_context_references as context_fixture
import test_host_sheet_fallback as sheet_fixture


class BackgroundEditTests(unittest.TestCase):
    setUp=context_fixture.ContextReferencesTests.setUp
    frozen=context_fixture.ContextReferencesTests.frozen
    bind=context_fixture.ContextReferencesTests.bind

    def test_v11_dispatches_the_original_once_with_a_minimal_edit_prompt(self):
        self.visual['backgroundMode']='scene-only';self.bind()
        folder,manifest=self.frozen(version='v11')
        self.assertEqual(preflight(folder,manifest['digest'])['generationReference'],'context-crops')
        job=self.root/'minimal-background-job'
        config=exchange.prepare(folder,manifest['digest'],job)
        row=next(r for r in read(folder/'requests.json')['requests'] if r['asset']=='asset-scene')
        args=exchange.frozen_request_arguments(job,config,row)
        self.assertEqual(args['referenced_image_paths'],[str((job/'snapshot/reference.png').resolve())])
        self.assertEqual(digest(job/'snapshot/reference.png'),digest(folder/'reference.png'))
        self.assertIn('去掉原参考图中的所有 UI，只保留背景',args['prompt'])
        self.assertIn('位置、大小、轮廓、颜色不变',args['prompt'])
        self.assertNotIn('Reconstruct',args['prompt'])
        self.assertNotIn('Retain these visible details',args['prompt'])
        self.assertNotIn('OWNERSHIP FIRST',args['prompt'])

    def test_background_descriptions_cannot_instruct_a_redraw_but_text_exceptions_survive(self):
        visual=deepcopy(read(self.run/'m1/draft.json'))
        material=next(m for m in visual['materials'] if m['role']=='background')
        material['preserveText']=['SIGN A','9']
        before=context.background_edit_prompt(visual,material)
        material['label']='REDRAW ALL SUBJECTS BIGGER'
        for obj in visual['objects']:
            if obj['materialId']==material['id']:obj['label']='ADD A SECOND SUBJECT'
        self.assertEqual(before,context.background_edit_prompt(visual,material))
        self.assertIn('["SIGN A","9"]',before)
        self.assertIn('不移动、放大、重画或复制',before)

    def test_warning_policy_does_not_append_foreground_reconstruction_to_background(self):
        from ai_ui_layers.compile_visual import compile_plan
        from ai_ui_layers.visual_policy import warning_policy
        compiled,_=compile_plan(self.visual,[1000,1000],'a'*64,generation_reference='context-crops',
            context_prompt_version='v11',visual_policy=warning_policy())
        background=next(a for a in compiled['assets'] if a['role']=='background')['prompt']
        self.assertNotIn('显式视觉策略',background)
        self.assertNotIn('透明 alpha',background)
        self.assertTrue(any('显式视觉策略' in a['prompt'] for a in compiled['assets'] if a['role']!='background'))

    def test_preserve_underlay_does_not_remove_unexported_ui_or_dimming(self):
        visual=deepcopy(read(self.run/'m1/draft.json'));visual['backgroundMode']='preserve-underlay'
        material=next(m for m in visual['materials'] if m['role']=='background')
        text=context.background_edit_prompt(visual,material)
        self.assertNotIn('所有 UI',text)
        self.assertIn('未导出的 UI 和遮暗',text)
        for m in visual['materials']:
            if m['role']=='foreground':self.assertIn(m['label'],text)

    def test_v10_is_still_explicitly_reconstructive(self):
        folder,_=self.frozen(version='v10')
        text=(folder/'materials/asset-scene/prompt.txt').read_text('utf-8')
        self.assertIn('Retain these visible details',text)
        self.assertIn('COMPOSITION LOCK',text)


class BalancedSheetTests(unittest.TestCase):
    def controls(self,sizes):
        return (dict(objects=[dict(materialId=str(i),kind='icon') for i in range(len(sizes))]),
            dict(assets=[dict(id=str(i),role='important_component',output_size=list(size))
                for i,size in enumerate(sizes)]))

    def test_five_icons_use_balanced_grid_and_keep_one_empty_slot(self):
        visual,plan=self.controls([(80,80)]*5)
        old=groups.build_groups(visual,plan,groups.COMPACT_CONTROL_V3)
        new=groups.build_groups(visual,plan,groups.COMPACT_CONTROL_V4)
        self.assertEqual(old['groups'][0]['grid'],[5,1])
        self.assertEqual(new['plannedCalls'],1)
        row=new['groups'][0]
        self.assertEqual(row['grid'],[3,2])
        self.assertEqual(row['materialIds'],['0','1','2','3','4'])
        self.assertLessEqual(max(row['outputSize'])/min(row['outputSize']),1.5)
        self.assertGreaterEqual(.8*min(row['outputSize'][i]//row['grid'][i]/80 for i in (0,1)),1)

    def test_large_rail_cannot_shrink_small_readout_in_same_sheet(self):
        visual,plan=self.controls([(1000,200),(170,40),(180,40)])
        self.assertEqual(groups.build_groups(visual,plan,groups.COMPACT_CONTROL_V3)['plannedCalls'],1)
        new=groups.build_groups(visual,plan,groups.COMPACT_CONTROL_V4)
        self.assertEqual(new['materialCount'],3)
        self.assertEqual(new['plannedCalls'],2)
        self.assertEqual(new['groups'][0]['materialIds'],['0'])
        self.assertEqual(new['groups'][1]['materialIds'],['1','2'])

    def test_dense_board_budgets_context_rim_before_m2_not_only_body(self):
        visual,plan=self.controls([(1100,180)]*6)
        old=groups.build_groups(visual,plan,groups.COMPACT_CONTROL_V3)
        self.assertEqual(old['plannedCalls'],1)
        new=groups.build_groups(visual,plan,groups.COMPACT_CONTROL_V4)
        self.assertEqual(new['plannedCalls'],2)
        self.assertEqual([len(g['materialIds']) for g in new['groups']],[5,1])
        self.assertEqual(new['materialCount'],6)


class UncertainCompositeTests(unittest.TestCase):
    setUp=sheet_fixture.HostSheetFallbackTests.setUp
    prepare=sheet_fixture.HostSheetFallbackTests.prepare
    acquire=sheet_fixture.HostSheetFallbackTests.acquire

    def test_failed_crops_are_archived_but_not_rendered_as_independent_artwork(self):
        self.prepare(sheetFailurePolicy=fallback.POLICY)
        bad=self.acquire()
        job=self.run/'images';before=files(self.run)
        contract=self.base/'new-hidden-contract'
        config=read(job/'job.json')
        frozen=diagnostic.prepare(job,config['digest'],contract,'Fixture viewport unchanged.',
            background_policy=read(self.run/'config.json')['backgroundPolicy'],
            sheet_composite_policy=fallback.COMPOSITE_POLICY)
        output=self.base/'new-hidden-export'
        result=diagnostic.deliver(contract,frozen['diagnosticDigest'],output,read(self.run/'config.json')['viewer'])
        failed=next(s for s in result['sheetPartitions'] if s['requestId']==bad)
        ids={c['materialId'] for c in failed['cells'] if c['used']}
        self.assertEqual(set(result['excludedUncertainMaterialIds']),ids)
        composition=read(output/'delivery/package/composition.json')
        self.assertEqual({m['id'] for m in self.plan['materials']}-{r['id'] for r in composition['layers']},ids)
        self.assertEqual(result['layerCount'],len(self.plan['materials'])-len(ids))
        with zipfile.ZipFile(output/'diagnostic-sources.zip') as z:
            self.assertEqual(z.read('raw/'+bad+'.png'),(job/'attempts'/bad/'raw.png').read_bytes())
        with Image.open(job/'attempts'/bad/'raw.png') as source:
            rebuilt=Image.new('RGBA',source.size)
            for i,box in enumerate(failed['partitionBoxes']):
                with Image.open(output/'source-evidence/cells'/(bad+'-cell-'+str(i)+'.png')) as cell:
                    rebuilt.paste(cell,box[:2])
            self.assertEqual(rebuilt.tobytes(),source.convert('RGBA').tobytes())
        report=read(output/'visual-warning-report.json')
        self.assertTrue(any(w.get('code')=='UNCERTAIN_SHEET_CELLS_EXCLUDED_FROM_COMPOSITE' for w in report['warnings']))
        self.assertFalse(result['sourceCompletenessAccepted'])
        self.assertFalse(result['humanVisualAcceptance'])
        validate_viewport_archive(output/'delivery/viewport-ui-layers.zip')
        self.assertEqual(files(self.run),before)

    def test_policy_is_bound_and_historical_diagnostics_keep_their_visibility(self):
        self.assertEqual(diagnostic.excluded_sheet_materials({},['a']),set())
        self.assertEqual(diagnostic.excluded_sheet_materials(dict(sheetCompositePolicy=fallback.COMPOSITE_POLICY),['a']),{'a'})
        with self.assertRaisesRegex(ValueError,'DIAGNOSTIC_SHEET_COMPOSITE_POLICY'):
            diagnostic.excluded_sheet_materials(dict(sheetCompositePolicy='unbound'),['a'])


if __name__=='__main__':unittest.main()
