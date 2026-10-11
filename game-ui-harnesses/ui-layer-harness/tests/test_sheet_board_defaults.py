"""Every new sheet uses one pixel-preserving input board; historical jobs replay."""
import _bootstrap
from copy import deepcopy
import unittest

from PIL import Image

from ai_ui_layers import experimental_executor as exchange, generation_groups as groups
from ai_ui_layers import sheet_layout_reference as board
from ai_ui_layers.evaluate import read
from ai_ui_layers.freeze_visual import body_digest
import test_context_references as context_fixture
import test_fidelity_fixes as fidelity_fixture
import test_host_delivery as host_fixture
import test_host_sheet_fallback as fallback_fixture


class SheetBoardPolicyTests(unittest.TestCase):
    setUp=context_fixture.ContextReferencesTests.setUp
    bind=context_fixture.ContextReferencesTests.bind
    frozen=context_fixture.ContextReferencesTests.frozen

    def prepare(self):
        folder,manifest=self.frozen(version='v12')
        job=self.root/'job';config=exchange.prepare(folder,manifest['digest'],job)
        row=next(r for r in read(folder/'requests.json')['requests'] if r.get('kind')=='sheet')
        return job,config,row

    def rewrite(self,job,config):
        config['digest']=body_digest({k:v for k,v in config.items() if k!='digest'})
        context_fixture.save(job/'job.json',config)

    def test_missing_board_fails_before_authorization_instead_of_using_separate_crops(self):
        job,config,row=self.prepare()
        for mutation in (lambda body:body.pop('contextBoardReferences'),
                         lambda body:body['contextBoardReferences'].pop(row['asset'])):
            changed=deepcopy(config);mutation(changed);self.rewrite(job,changed)
            with self.assertRaisesRegex(ValueError,'CONTEXT_BOARD_SCOPE_CHANGED'):
                exchange.authorize(job,changed['digest'],'offline fixture')
            self.assertFalse((job/'authorization.json').exists())

    def test_changed_input_policy_and_wrong_board_scope_fail_closed(self):
        job,config,row=self.prepare()
        for policy in (None,'individual-crops'):
            changed=deepcopy(config);changed['sheetReferencePolicy']=policy;self.rewrite(job,changed)
            with self.assertRaisesRegex(ValueError,'SHEET_REFERENCE_POLICY_CHANGED'):exchange.load_job(job)
        changed=deepcopy(config)
        changed['contextBoardReferences']['asset-scene']=changed['contextBoardReferences'][row['asset']]
        self.rewrite(job,changed)
        with self.assertRaisesRegex(ValueError,'CONTEXT_BOARD_SCOPE_CHANGED'):exchange.load_job(job)

    def test_historical_job_without_policy_keeps_its_multiple_reference_attachments(self):
        job,config,row=self.prepare()
        # Synthetic pre-policy job metadata, not a mutation of a real attempt.
        config.pop('sheetReferencePolicy');config.pop('contextBoardReferences');self.rewrite(job,config)
        loaded,index=exchange.load_job(job)
        args=exchange.frozen_request_arguments(job,loaded,index[row['asset']])
        self.assertEqual(args['referenced_image_paths'],
            [str((job/'snapshot'/r['reference']).resolve()) for r in row['references']])
        self.assertEqual(args['prompt'],(job/'snapshot'/row['prompt']).read_text('utf-8').rstrip('\n'))

    def test_standalone_background_and_material_are_not_combined_into_sheet_board(self):
        job,config,_=self.prepare();_,index=exchange.load_job(job)
        for row in index.values():
            if row.get('kind')=='sheet':continue
            self.assertNotIn(row['asset'],config['contextBoardReferences'])
            args=exchange.frozen_request_arguments(job,config,row)
            self.assertEqual(args['referenced_image_paths'],
                [str((job/'snapshot'/r['reference']).resolve()) for r in row['references']])


class AllSheetCountTests(unittest.TestCase):
    setUp=host_fixture.HostDeliveryTests.setUp
    prepare=fallback_fixture.HostSheetFallbackTests.prepare

    def check_count(self,count):
        source=next(m for m in self.plan['materials'] if m['id']=='asset-coin-a')
        width=source['bboxNorm'][2]-source['bboxNorm'][0]
        height=source['bboxNorm'][3]-source['bboxNorm'][1]
        for i in range(count-2):
            key='extra-'+str(i);left=.05+i*.13
            self.plan['materials'].append(dict(source,id=key,bboxNorm=[left,.05,left+width,.05+height]))
            self.plan['objects'].append(dict(id='object-'+key,label='Synthetic fixture icon',
                kind='icon',materialId=key,bboxNorm=None))
        host_fixture.review_fixtures.save(self.candidate,self.plan)
        self.prepare(generationGroupingPolicy=groups.COMPACT_CONTROL_V5,maximumBodyCalls=1)
        job=self.run/'images';config,index=exchange.load_job(job)
        sheets=[r for r in index.values() if r.get('kind')=='sheet']
        self.assertEqual(len(sheets),1);row=sheets[0]
        self.assertEqual(len(row['materialIds']),count)
        self.assertEqual(config['sheetReferencePolicy'],exchange.SHEET_REFERENCE_POLICY)
        self.assertEqual(config['maximumCalls'],len(index))
        self.assertEqual(set(config['contextBoardReferences']),{row['asset']})
        args=exchange.frozen_request_arguments(job,config,row)
        self.assertEqual(len(args['referenced_image_paths']),1)
        metadata=read(job/'context-boards'/row['asset']/board.METADATA)
        self.assertEqual(metadata['materialIds'],row['materialIds'])
        self.assertEqual(len(metadata['cells']),count)
        with Image.open(args['referenced_image_paths'][0]) as actual:
            actual=actual.convert('RGBA')
            for cell,ref in zip(metadata['cells'],row['references']):
                with Image.open(job/'snapshot'/ref['reference']) as crop:
                    scale=metadata['integerScale']
                    expected=crop.convert('RGBA').resize((crop.width*scale,crop.height*scale),Image.Resampling.NEAREST)
                    self.assertEqual(actual.crop(cell['boardCropBox']).tobytes(),expected.tobytes())
        self.assertFalse((job/'authorization.json').exists())

    def test_two_materials(self):self.check_count(2)
    def test_three_materials(self):self.check_count(3)
    def test_four_materials(self):self.check_count(4)
    def test_five_materials(self):self.check_count(5)
    def test_six_materials(self):self.check_count(6)


class BoardCapacityTests(unittest.TestCase):
    controls=fidelity_fixture.BalancedSheetTests.controls

    def test_v5_budgets_small_sheet_context_rims_without_changing_historical_v4(self):
        visual,plan=self.controls([(600,600)]*4)
        before=groups.build_groups(visual,plan,groups.COMPACT_CONTROL_V4)
        self.assertEqual(before['plannedCalls'],1)
        self.assertFalse(groups._control_fits(plan['assets'],groups.COMPACT_CONTROL_V5))
        after=groups.build_groups(visual,plan,groups.COMPACT_CONTROL_V5)
        self.assertEqual(after['materialCount'],4)
        self.assertTrue(all(g['mode']=='single' for g in after['groups']))

    def test_v5_keeps_balanced_small_icons_together_with_one_unused_slot(self):
        visual,plan=self.controls([(80,80)]*5)
        value=groups.build_groups(visual,plan,groups.COMPACT_CONTROL_V5)
        self.assertEqual(value['plannedCalls'],1)
        self.assertEqual(value['groups'][0]['grid'],[3,2])
        self.assertTrue(groups._control_fits(plan['assets'],groups.COMPACT_CONTROL_V5))


if __name__=='__main__':unittest.main()
