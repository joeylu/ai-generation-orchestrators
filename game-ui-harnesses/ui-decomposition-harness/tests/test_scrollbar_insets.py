import copy
import unittest
import json
import tempfile
from pathlib import Path
from PIL import Image
from ai_ui_decomposition.common import sha256
from ai_ui_decomposition.component_handoff import _validate_bound_layers
from ai_ui_decomposition.visual_observations import check_visual_observations
from ai_ui_decomposition.common import ContractError
from ai_ui_decomposition.scrollbar_insets import validate_insets
from ai_ui_decomposition.component_handoff import _validate_state_text_colors
from ai_ui_decomposition.stateful_scroll import scroll_geometry
from test_stateful_scroll import scroll_fixture


class InsetsTests(unittest.TestCase):
    def test_invalid_extensions_fail(self):
        for value in [None, {}, {'version':'2.0','top':1,'bottom':1},
                      {'version':'1.0','top':1}, {'version':'1.0','top':-1,'bottom':1},
                      {'version':'1.0','top':True,'bottom':1},
                      {'version':'1.0','top':float('nan'),'bottom':1},
                      {'version':'1.0','top':1,'bottom':1,'y':0}]:
            with self.subTest(value=value), self.assertRaises(ContractError):
                _validate_state_text_colors({'bindings':[{'componentType':'ScrollView','states':{'scrollView':{'scrollbarInsets':value}}}]})
        with self.assertRaisesRegex(ContractError,'USABLE_TRACK'):
            validate_insets({'version':'1.0','top':250,'bottom':250},524,90)

    def test_insets_override_vertical_positions_preserve_decorations(self):
        n=scroll_fixture(616);a=n['props']['appearance']
        a['scrollbarInsets']={'version':'1.0','top':36,'bottom':40}
        before=copy.deepcopy(n)
        for fraction in (0,.5,1):
            g=scroll_geometry(n,fraction)
            self.assertAlmostEqual(g['thumb'][3],448*596/616)
            self.assertAlmostEqual(g['thumb'][1],73+(448-448*596/616)*fraction)
            self.assertEqual(g['scrollY'],20*fraction)
            self.assertLessEqual(g['thumb'][1]+g['thumb'][3],521.000001)
        self.assertEqual(before,n)

    def test_no_overflow_fills_only_usable_track(self):
        n=scroll_fixture(596);n['props']['appearance']['scrollbarInsets']={'version':'1.0','top':36,'bottom':40}
        for fraction in (0,.5,1):
            g=scroll_geometry(n,fraction)
            self.assertEqual(g['thumb'],[484,73,14,448])
            self.assertEqual((g['scrollY'],g['travelY']),(0,0))

    def test_legacy_geometry_unchanged(self):
        self.assertEqual(scroll_geometry(scroll_fixture(596),0)['thumb'],[484,37,14,524])

    def test_registered_scale_and_invalid_layer_reference(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);layers=[]
            for ident,size in [('track',[10,100]),('thumb',[8,20])]:
                im=Image.new('RGBA',tuple(size),(1,2,3,255));im.putpixel((0,0),(0,0,0,0));im.save(root/(ident+'.png'))
                layers.append(dict(id=ident,size=size,png=ident+'.png',sha256=sha256(root/(ident+'.png'))))
            (root/'scene.json').write_text(json.dumps({'tree':[{'children':layers}]}))
            row={'componentId':'scroll','componentType':'ScrollView','parts':[{'role':'scrollbar-track','layerId':'track'},{'role':'scrollbar-thumb','layerId':'thumb'}], 'states':{'scrollView':{'scrollbarInsets':{'version':'1.0','top':60,'bottom':60}}}}
            binding={'registration':{'transform':{'scale':2}},'bindings':[row]};document={'root':{'id':'scroll','type':'ScrollView'}}
            _validate_bound_layers(root,binding,document) # 200-120 >= registered thumb40
            binding['registration']['transform']['scale']=1
            with self.assertRaisesRegex(ContractError,'USABLE_TRACK'):_validate_bound_layers(root,binding,document)
            binding['registration']['transform']['scale']=2;row['parts'][1]['layerId']='absent'
            with self.assertRaisesRegex(ContractError,'UNKNOWN_LAYER'):_validate_bound_layers(root,binding,document)

    def test_actual_paint_region_mismatch_rejected(self):
        n=scroll_fixture(596);n.update(id='scroll',type='ScrollView');n['props']['scrollbarVisibility']='always';n['props']['appearance']['scrollbarInsets']={'version':'1.0','top':36,'bottom':40}
        b={'document':{'root':n},'resources':[]};o={'kind':'ui_visual_observations_v1','texts':[],'dialogs':[],'scrollViews':[{'componentId':'scroll','viewportHeight':596,'contentHeight':596,'scrollbarInsets':n['props']['appearance']['scrollbarInsets']}]}
        inspection={'nodes':[{'id':'scroll','bounds':{'x':0,'y':0}}],'paintRegions':[{'componentId':'scroll','bounds':{}},{'componentId':'scroll','bounds':dict(x=484,y=73,width=14,height=448)}]}
        self.assertEqual(check_visual_observations(b,o,inspection)['status'],'passed')
        inspection['paintRegions'][1]['bounds']['y']=37
        self.assertEqual(check_visual_observations(b,o,inspection)['status'],'failed')
