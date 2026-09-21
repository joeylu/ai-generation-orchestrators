import _bootstrap  # Enable source-layout imports for unittest discovery.
import unittest
from PIL import Image, ImageDraw
from ai_ui_layers.key_evidence import key_background_evidence

class KeyEvidenceTests(unittest.TestCase):
    def test_bounded_key_drift_is_allowed_without_changing_matte_key(self):
        im=Image.new('RGBA',(40,40),(220,35,220,255))
        ImageDraw.Draw(im).rectangle((10,10,30,30),fill='navy')
        evidence=key_background_evidence(im)
        self.assertTrue(evidence['passed'])
        self.assertEqual(evidence['route'],'bounded-drift')
        self.assertTrue(evidence['matteKeyUnchanged'])

    def test_scene_background_is_not_a_key_and_native_alpha_remains_valid(self):
        self.assertFalse(key_background_evidence(Image.new('RGBA',(40,40),'white'))['passed'])
        self.assertTrue(key_background_evidence(Image.new('RGBA',(40,40),(0,0,0,0)))['passed'])
