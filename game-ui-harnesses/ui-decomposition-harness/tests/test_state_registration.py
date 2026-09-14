import unittest
import numpy as np
from PIL import Image
from ai_ui_decomposition.common import ContractError
from ai_ui_decomposition.state_registration import common_alpha_pair


class StateRegistrationTests(unittest.TestCase):
    def pair(self):
        a=Image.new('RGBA',(24,24));b=a.copy();a.paste((20,40,60,255),(2,2,22,22));b.paste((200,220,240,255),(2,2,22,22));return a,b

    def test_only_removes_tiny_edge_differences_and_keeps_distinct_rgb(self):
        a,b=self.pair();b.putpixel((2,2),(200,220,240,80));(x,y),r=common_alpha_pair(a,b)
        self.assertEqual(x.getchannel('A').tobytes(),y.getchannel('A').tobytes());self.assertNotEqual(x.tobytes(),y.tobytes())
        for old,new in [(a,x),(b,y)]:
            o=np.asarray(old);n=np.asarray(new);self.assertTrue((n[:,:,3]<=o[:,:,3]).all())
            mask=n[:,:,3]>0;self.assertTrue((n[:,:,:3][mask]==o[:,:,:3][mask]).all())
        self.assertFalse(r['human_visual_acceptance'])

    def test_missing_different_shape_or_same_state_cannot_be_recovered(self):
        a,b=self.pair();b.paste((0,0,0,0),(2,2,12,22))
        with self.assertRaisesRegex(ContractError,'SHAPE_MISMATCH'):common_alpha_pair(a,b)
        with self.assertRaisesRegex(ContractError,'DISTINCT_REQUIRED'):common_alpha_pair(a,a)
        with self.assertRaisesRegex(ContractError,'CANVAS'):common_alpha_pair(a,Image.new('RGBA',(25,24)))
