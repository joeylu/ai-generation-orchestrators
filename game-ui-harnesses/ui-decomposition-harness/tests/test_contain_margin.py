import unittest
from PIL import Image
from ai_ui_decomposition.media import resize_material
from ai_ui_decomposition.common import ContractError


class ContainMarginTests(unittest.TestCase):
    def test_opaque_square_receives_explicit_margin_without_erasing_foreground(self):
        image=Image.new('RGBA',(22,22),(10,20,30,255))
        result=resize_material(image,dict(output_size=[22,22],resize=dict(mode='contain',insets=[1,1,1,1])))
        self.assertEqual(result.getchannel('A').getbbox(),(1,1,21,21))
        self.assertEqual(result.getpixel((0,0)),(0,0,0,0))
        self.assertEqual(result.getpixel((11,11)),(10,20,30,255))

    def test_asymmetric_margin_preserves_aspect_and_continuous_alpha(self):
        image=Image.new('RGBA',(12,6),(20,30,40,128))
        result=resize_material(image,dict(output_size=[20,14],resize=dict(mode='contain',insets=[2,3,4,1])))
        self.assertEqual(result.getchannel('A').getbbox(),(3,5,15,11))
        self.assertEqual(result.getpixel((8,8))[3],128)

    def test_invalid_insets_fail(self):
        with self.assertRaisesRegex(ContractError,'RESIZE_TARGET_TOO_SMALL'):
            resize_material(Image.new('RGBA',(2,2)),dict(output_size=[2,2],resize=dict(mode='contain',insets=[1,1,1,1])))
