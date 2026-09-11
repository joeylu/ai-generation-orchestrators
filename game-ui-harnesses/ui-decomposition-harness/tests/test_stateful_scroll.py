import copy
import unittest
from PIL import Image,ImageDraw
from ai_ui_decomposition.common import ContractError
from ai_ui_decomposition.stateful_scroll import scroll_geometry
from ai_ui_decomposition.stateful import baked_icon,node_contexts


def scroll_fixture(content=600):
    return {'layout':{'width':509,'height':596},'props':{
        'contentWidth':509,'contentHeight':content,'scrollX':0,'appearance':{
            'sourceCanvas':{'width':509,'height':596},
            'viewport':{'layout':{'x':0,'y':0,'width':509,'height':596}},
            'scrollbarTrack':{'layout':{'x':484,'y':37,'width':14,'height':524}},
            'scrollbarThumbCanvas':{'width':14,'height':90},
            'scrollbarThumbPositions':{'min':{'x':484,'y':37},'max':{'x':484,'y':40.49333333333333}}
        }}}


class ScrollStateTests(unittest.TestCase):
    def test_nested_scroll_coordinates_and_clip(self):
        n=scroll_fixture();n.update(id='scroll',type='ScrollView');n['layout'].update(x=20,y=30);n['props']['scrollY']=4
        n['children']=[{'id':'child','type':'Text','layout':{'x':7,'y':9,'width':50,'height':20},'props':{}}]
        child=list(node_contexts(n))[1]
        self.assertEqual(child[1],(27,35));self.assertEqual(child[2],[20,30,509,596])

    def test_quest_semantic_thumb_and_three_positions(self):
        n=scroll_fixture();before=copy.deepcopy(n)
        for fraction in (0,.5,1):
            g=scroll_geometry(n,fraction)
            self.assertAlmostEqual(g['thumb'][3],524*596/600)
            self.assertAlmostEqual(g['travelY'],524*(1-596/600))
            self.assertAlmostEqual(g['scrollY'],4*fraction)
            self.assertAlmostEqual(g['thumb'][1],37+g['travelY']*fraction)
            self.assertEqual(g['sourceThumbCanvas']['height'],90)
        self.assertEqual(n,before)

    def test_no_overflow_full_track_and_zero_scroll(self):
        for height in (400,596):
            for fraction in (0,.5,1):
                g=scroll_geometry(scroll_fixture(height),fraction)
                self.assertEqual(g['thumb'][3],524)
                self.assertEqual(g['scrollY'],0)
                self.assertEqual(g['travelY'],0)

    def test_missing_semantics_and_horizontal_rejected(self):
        for bad in (None,0,-1,float('nan'),True):
            with self.assertRaisesRegex(ContractError,'STATE_SCROLL_SEMANTICS_MISSING'):
                scroll_geometry(scroll_fixture(bad),0)
        n=scroll_fixture();n['props']['contentWidth']=700
        with self.assertRaisesRegex(ContractError,'STATE_CAPABILITY_MISSING:HORIZONTAL_SCROLL'):scroll_geometry(n,0)

    def test_authored_larger_thumb_matches_current_runtime(self):
        n=scroll_fixture(2000)
        n['props']['appearance']['scrollbarThumbCanvas']['height']=200
        n['props']['appearance']['scrollbarThumbPositions']['max']['y']=361
        g=scroll_geometry(n,1)
        self.assertEqual(g['thumb'],[484,361,14,200])
        self.assertEqual(g['scrollY'],1404)

    def test_unrelated_border_is_not_a_baked_icon(self):
        bg=Image.new('RGBA',(90,45),(43,66,38,255))
        ImageDraw.Draw(bg).rectangle((0,0,89,3),fill=(220,190,90,255))
        icon=Image.new('RGBA',(32,32))
        ImageDraw.Draw(icon).ellipse((8,8,23,23),fill=(38,51,30,255))
        self.assertFalse(baked_icon(bg,icon))
        bg.alpha_composite(icon,(40,10))
        # Deliberately high-contrast positive fixture, independent of the border.
        bright=Image.new('RGBA',(32,32));ImageDraw.Draw(bright).ellipse((8,8,23,23),fill=(240,240,220,255))
        bg.alpha_composite(bright,(40,10));self.assertTrue(baked_icon(bg,bright))


if __name__=='__main__':unittest.main()
