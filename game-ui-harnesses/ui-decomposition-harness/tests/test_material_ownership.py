import unittest
from ai_ui_decomposition.material_ownership import compile_ownership
from ai_ui_decomposition.batch import _prompt


class MaterialOwnershipTests(unittest.TestCase):
    def test_child_surface_excludes_parent_ornaments(self):
        req={'appearance':{'bindings':[{'parts':[{'layerId':k,'role':'background'}]} for k in ('panel','list')]}}
        mats={'panel':dict(componentId='panel',rect=[0,0,400,600]),
              'list':dict(componentId='list',rect=[20,100,360,400])}
        rows={r['layerId']:r for r in compile_ownership(req,mats)['layers']}
        self.assertEqual(rows['list']['surroundingLayerIds'],['panel'])
        self.assertIn('Never copy their outer frame',rows['list']['instruction'])
        self.assertIn('list',rows['panel']['excludedLayerIds'])

    def test_surface_excludes_separate_icon_but_icon_keeps_detail(self):
        request={'appearance':{'bindings':[
            {'parts':[{'layerId':'field','role':'background'}]},
            {'parts':[{'layerId':'search-icon','role':'image'}]}]}}
        materials={'field':dict(componentId='input',rect=[0,0,400,50]),
                   'search-icon':dict(componentId='search-icon',rect=[10,10,30,30])}
        report=compile_ownership(request,materials);rows={r['layerId']:r for r in report['layers']}
        self.assertEqual(rows['field']['excludedLayerIds'],['search-icon'])
        self.assertIn('Do not bake',rows['field']['instruction'])
        self.assertIn('own internal detail',rows['search-icon']['instruction'])
        self.assertFalse(report['human_visual_acceptance'])

    def test_shared_owner_mark_excluded_and_state_surfaces_not_contents(self):
        req={'appearance':{'bindings':[{'parts':[{'layerId':k,'role':r} for k,r in
             [('box','row'),('mark','mark'),('selected','selected-row')]]}]}}
        mats={k:dict(componentId='control',rect=[0,0,30,30]) for k in ['box','mark','selected']}
        rows={r['layerId']:r for r in compile_ownership(req,mats)['layers']}
        self.assertEqual(rows['box']['excludedLayerIds'],['mark'])
        self.assertIn('only when',rows['selected']['instruction'])

    def test_list_surface_excludes_its_independent_row(self):
        req={'appearance':{'bindings':[{'parts':[{'layerId':'list','role':'background'},
            {'layerId':'row','role':'row'}]}]}}
        mats={'list':dict(componentId='list',rect=[0,0,300,500]),
              'row':dict(componentId='list',rect=[0,0,300,80])}
        rows={r['layerId']:r for r in compile_ownership(req,mats)['layers']}
        self.assertEqual(rows['list']['excludedLayerIds'],['row'])

    def test_frozen_prompt_scopes_symbol_rule_legacy_unchanged(self):
        asset=dict(output_size=[100,100],route='generated_isolation',output_mode='keyed_component',
                   prompt='component-family-board-v1:abc native-material-ownership-v1:123')
        actual=_prompt(asset)
        self.assertIn('surface exclusions take precedence',actual)
        self.assertNotIn('preserve intentional pictograms.',actual)
        asset['prompt']='component-family-board-v1:abc'
        self.assertIn('preserve intentional pictograms.',_prompt(asset))
