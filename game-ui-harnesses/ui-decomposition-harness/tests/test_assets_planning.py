from copy import deepcopy
import unittest
from ai_ui_decomposition.assets_planning import review


class PlanningTests(unittest.TestCase):
    def setUp(self):
        self.plan = dict(source=dict(sha256='a'*64),canvas=[200,200],
            assets=[dict(id='panel',source_region=[20,40,180,180],output_size=[160,140],route='generated_isolation')],
            nodes=[dict(id='panel',asset='panel',xy=[20,40])])
        self.coverage = dict(kind='ui_reference_coverage_v1',sourceSha256='a'*64,
            review=dict(inventoryReviewed=True,removalsReviewed=True,basis='Independent synthetic crest review'),
            elements=[dict(id='crest',label='Crest above body',region=[80,10,40,50],
                disposition='material',ownerAssets=['panel'],removedBy=[],reason='Owned by panel')])

    def test_named_owner_still_reports_source_and_placement_gaps_together(self):
        result=review(self.plan,self.coverage)
        self.assertEqual(result['structuralReview']['status'],'passed')
        self.assertEqual(result['issues'],['PLANNING_SOURCE_GAP:crest','PLANNING_PLACEMENT_GAP:crest'])
        self.assertFalse(result['humanVisualAcceptance'])

    def test_fixing_source_alone_does_not_hide_placement_gap(self):
        self.plan['assets'][0]['source_region']=[20,0,180,180]
        self.assertEqual(review(self.plan,self.coverage)['issues'],['PLANNING_PLACEMENT_GAP:crest'])
        self.plan['assets'][0]['output_size']=[160,180]
        self.plan['nodes'][0]['xy']=[20,0]
        self.assertEqual(review(self.plan,self.coverage)['status'],'passed')

    def test_multiple_owners_must_cover_actual_union_not_envelope(self):
        self.plan['assets'][0].update(source_region=[80,10,99,60],output_size=[19,50])
        self.plan['nodes'][0]['xy']=[80,10]
        self.plan['assets'].append(dict(id='right',source_region=[100,10,120,60],output_size=[20,50],route='generated_isolation'))
        self.plan['nodes'].append(dict(id='right',asset='right',xy=[100,10]))
        self.coverage['elements'][0]['ownerAssets'].append('right')
        self.assertEqual(len(review(self.plan,self.coverage)['issues']),2)
        self.plan['assets'][0].update(source_region=[80,10,100,60],output_size=[20,50])
        self.assertEqual(review(self.plan,self.coverage)['status'],'passed')

    def test_undeclared_semantics_not_inferred_and_inputs_unchanged(self):
        self.coverage['elements'][0]['region']=[80,50,40,10]
        before=deepcopy((self.plan,self.coverage))
        report=review(self.plan,self.coverage)
        self.assertEqual(report['status'],'passed')
        self.assertFalse(report['automaticSemanticInference'])
        self.assertEqual(before,(self.plan,self.coverage))

    def test_missing_placement_is_reported(self):
        self.plan['nodes']=[]
        self.assertIn('PLANNING_PLACEMENT_GAP:crest',review(self.plan,self.coverage)['issues'])

    def test_reuse_requires_exact_translation_even_when_large_node_covers_both(self):
        self.coverage['elements'][0]['region']=[80,50,20,20]
        self.coverage['elements'].append(dict(self.coverage['elements'][0],id='repeat',region=[90,60,20,20],
            reuse=dict(element='crest',reason='Explicit reviewed repeated detail')))
        result=review(self.plan,self.coverage)
        self.assertEqual(result['issues'],['PLANNING_REUSE_TRANSFORM:repeat'])
        self.plan['nodes'].append(dict(id='repeat',asset='panel',xy=[30,50]))
        self.assertEqual(review(self.plan,self.coverage)['status'],'passed')
        self.plan['assets'][0]['output_size']=[170,150]
        self.assertIn('PLANNING_REUSE_TRANSFORM:repeat',review(self.plan,self.coverage)['issues'])

    def test_public_cli_reports_relocated_layout_without_modifying_plan(self):
        import contextlib
        import io
        import tempfile
        from pathlib import Path
        from PIL import Image
        from ai_ui_decomposition import planning
        from ai_ui_decomposition.assets_cli import main
        from ai_ui_decomposition.common import read_json, write_json
        from test_assets_cli import FixtureProvider, fixture_coverage
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            Image.new('RGB',(64,48),'blue').save(root/'reference.png')
            planning.materialize(FixtureProvider().plan(),root,[64,48],2,output_format='png_zip')
            plan_path=root/'plan.json';before=plan_path.read_bytes();plan=read_json(plan_path)
            coverage=fixture_coverage(plan['source']['sha256'],['scene','button'],[64,48])
            coverage['elements'][1]['region']=[4,4,20,12]
            write_json(root/'coverage.json',coverage)
            with contextlib.redirect_stdout(io.StringIO()):
                code=main(['planning-check','--plan',str(plan_path),'--coverage',str(root/'coverage.json'),
                           '--output',str(root/'review.json')])
            self.assertEqual(code,2)
            self.assertEqual(read_json(root/'review.json')['issues'],['PLANNING_PLACEMENT_GAP:button'])
            self.assertEqual(plan_path.read_bytes(),before)
            self.assertFalse((root/'workspace').exists())
