import _bootstrap  # Enable source-layout imports for unittest discovery.
import unittest
from PIL import Image,ImageDraw
from ai_ui_layers.fit_vertical_sections import fit_sections

class SectionsTests(unittest.TestCase):
    def test_grows_middle_without_stretching_top_bottom_or_alpha(self):
        im=Image.new('RGBA',(20,100),(10,20,30,128))
        ImageDraw.Draw(im).rectangle((0,80,19,99),fill=(200,0,0,254))
        out=fit_sections(im,[0,20,80,100],[0,20,120,140],target_height=140)
        self.assertEqual(out.size,(20,140))
        self.assertEqual(out.crop((0,0,20,20)).tobytes(),im.crop((0,0,20,20)).tobytes())
        self.assertEqual(out.crop((0,120,20,140)).tobytes(),im.crop((0,80,20,100)).tobytes())
        self.assertEqual(out.getpixel((10,60))[3],128)

    def test_preserves_fixed_bands_and_canvas(self):
        im=Image.new('RGBA',(20,100),(10,20,30,128))
        ImageDraw.Draw(im).rectangle((0,40,19,49),fill=(200,0,0,254))
        out=fit_sections(im,[0,20,40,50,80,100],[0,20,50,60,80,100])
        self.assertEqual(out.crop((0,50,20,60)).tobytes(),im.crop((0,40,20,50)).tobytes())
        self.assertEqual(out.crop((0,0,20,20)).tobytes(),im.crop((0,0,20,20)).tobytes())
        self.assertEqual(out.crop((0,80,20,100)).tobytes(),im.crop((0,80,20,100)).tobytes())
    def test_rejects_inverted_or_cropping_anchors(self):
        im=Image.new('RGBA',(20,100))
        for target in ([0,60,50,100],[0,20,50,99]):
            with self.assertRaises(ValueError):fit_sections(im,[0,20,50,100],target)
