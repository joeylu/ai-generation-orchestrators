import _bootstrap  # Enable source-layout imports for unittest discovery.
import unittest
from PIL import Image, ImageDraw
import test_compile_visual
from ai_ui_layers.evaluate import save
from ai_ui_layers.freeze_visual import freeze
from ai_ui_layers.preview_partial import preview


class FramePreviewTests(unittest.TestCase):
    def setUp(self):
        test_compile_visual.VisualCompileTests.setUp(self)
        self.snapshot=self.root/'snapshot'
        self.frozen=freeze(self.run,self.snapshot,5)
        im=Image.new('RGBA',(140,100))
        ImageDraw.Draw(im).rectangle((10,10,129,89),fill=(70,90,100,200))
        self.raw=self.root/'raw.png';im.save(self.raw)

    def test_compiled_carrier_mode_reaches_real_preview(self):
        config=self.root/'config.json'
        save(config,{'snapshot':str(self.snapshot),'snapshotDigest':self.frozen['digest'],
                     'materials':{'asset-panel':str(self.raw)}})
        report=preview(config,self.root/'preview')
        self.assertEqual(report['records'][0]['report']['fitting']['mode'],'frame-bounds')
        with Image.open(self.root/'preview/asset-panel/material.png') as im:
            self.assertEqual(im.getchannel('A').getbbox(),(0,0,800,850))

    def test_frame_override_cannot_stretch_arbitrary_icon(self):
        config=self.root/'config.json'
        save(config,{'snapshot':str(self.snapshot),'snapshotDigest':self.frozen['digest'],
                     'materials':{'asset-coin-a':str(self.raw)},'frameBoundsMaterials':['asset-coin-a']})
        with self.assertRaisesRegex(ValueError,'FRAME_OVERRIDE_REQUIRES_CARRIER_PANEL'):
            preview(config,self.root/'preview')
        self.assertFalse((self.root/'preview').exists())

    def test_explicit_single_button_frame_fit_is_reviewable(self):
        config=self.root/'config.json'
        save(config,{'snapshot':str(self.snapshot),'snapshotDigest':self.frozen['digest'],
                     'materials':{'asset-buy-button':str(self.raw)},
                     'frameBoundsMaterials':['asset-buy-button']})
        report=preview(config,self.root/'preview')
        self.assertEqual(report['records'][0]['report']['fitting']['mode'],'frame-bounds')
        self.assertIn('NONUNIFORM_FRAME_RESAMPLING_REVIEW_DECORATIONS',
                      report['records'][0]['report'].get('warnings',[]))
