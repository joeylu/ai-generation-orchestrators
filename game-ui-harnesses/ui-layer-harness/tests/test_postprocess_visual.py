import _bootstrap  # Enable source-layout imports for unittest discovery.
import unittest
from PIL import Image,ImageDraw
from ai_ui_layers.postprocess_visual import assess, fit_native


class PostprocessTests(unittest.TestCase):
    def test_native_alpha_keeps_magenta_foreground(self):
        image=Image.new('RGBA',(500,300),(0,0,0,0))
        ImageDraw.Draw(image).rectangle((50,130,449,169),fill=(248,8,248,255))
        report=assess(image,[400,40])
        self.assertEqual(report['issues'],[])
        self.assertEqual(report['keyEvidence']['route'],'native-alpha-preserved')

    def test_large_canvas_padding_does_not_change_support_ratio(self):
        image=Image.new('RGB',(500,300),(248,8,248))
        ImageDraw.Draw(image).rectangle((50,130,449,169),fill='navy')
        report=assess(image,[400,40])
        self.assertEqual(report['issues'],[])
        self.assertEqual(report['marginsLTRB'],[50,130,50,130])

    def test_touching_edge_blocks_even_when_visible_ratio_matches(self):
        image=Image.new('RGB',(400,300),(248,8,248))
        ImageDraw.Draw(image).rectangle((0,130,399,169),fill='navy')
        report=assess(image,[400,40])
        self.assertIn('INSUFFICIENT_SOURCE_PADDING',report['issues'])
        self.assertIn('KEY_BACKGROUND_REQUIRED',report['issues'])

    def test_crop_ratio_is_diagnostic_not_silhouette_gate(self):
        image=Image.new('RGB',(500,300),(248,8,248))
        ImageDraw.Draw(image).rectangle((50,100,449,199),fill='navy')
        self.assertEqual(assess(image,[400,40])['issues'],[])
        self.assertIn('CROP_RATIO_IS_NOT_SILHOUETTE_RATIO',assess(image,[400,40])['warnings'])

    def test_native_small_margin_allowed_but_edge_touch_blocked(self):
        im=Image.new('RGBA',(30,30))
        ImageDraw.Draw(im).rectangle((1,1,28,28),fill=(100,100,100,254))
        self.assertEqual(assess(im,[60,40])['issues'],[])
        ImageDraw.Draw(im).point((0,15),fill=(100,100,100,255))
        self.assertIn('POSSIBLY_CLIPPED_SOURCE',assess(im,[60,40])['issues'])

    def test_fit_preserves_alpha_and_centers_without_stretch(self):
        im=Image.new('RGBA',(30,30))
        ImageDraw.Draw(im).rectangle((10,5,19,24),fill=(100,100,100,128))
        out,report=fit_native(im,[40,20])
        self.assertEqual(out.getchannel('A').getbbox(),(15,0,25,20))
        self.assertEqual(out.getpixel((20,10)),(100,100,100,128))
        self.assertEqual(out.getpixel((0,0)),(0,0,0,0))

    def test_nearly_invisible_canvas_noise_does_not_shrink_artwork(self):
        im=Image.new('RGBA',(500,300),(0,0,0,1))
        ImageDraw.Draw(im).rectangle((50,130,449,169),fill=(50,50,50,254))
        out,report=fit_native(im,[400,40])
        self.assertEqual(report['sourceAlphaBox'],[50,130,450,170])
        self.assertEqual(out.getpixel((200,20))[3],254)

    def test_frame_bounds_fills_height_that_contain_leaves_empty(self):
        # Reproduces a generated panel wider than its reference frame; includes transparent padding.
        im=Image.new('RGBA',(160,120))
        ImageDraw.Draw(im).rectangle((10,10,149,109),fill=(60,80,100,128))
        contained,_=fit_native(im,[140,120])
        self.assertEqual(contained.getchannel('A').getbbox(),(0,10,140,110))
        fitted,report=fit_native(im,[140,120],'frame-bounds')
        self.assertEqual(fitted.getchannel('A').getbbox(),(0,0,140,120))
        pixel=fitted.getpixel((70,60))
        self.assertEqual(pixel[3],128)
        self.assertTrue(all(abs(a-b)<=1 for a,b in zip(pixel[:3],(60,80,100))))
        self.assertEqual(report['scaleXY'],[1,1.2])
        self.assertTrue(report['warnings'])

    def test_frame_fit_preserves_internal_hole_and_cannot_target_background(self):
        import tempfile
        from pathlib import Path
        from ai_ui_layers.postprocess_visual import process
        im=Image.new('RGBA',(100,100))
        ImageDraw.Draw(im).rectangle((10,10,89,89),fill=(80,90,100,255))
        ImageDraw.Draw(im).rectangle((30,30,69,69),fill=(0,0,0,0))
        fitted,_=fit_native(im,[80,120],'frame-bounds')
        self.assertEqual(fitted.getpixel((40,60)),(0,0,0,0))
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);im.save(root/'raw.png')
            with self.assertRaisesRegex(ValueError,'FRAME_FIT_ON_BACKGROUND'):
                process(root/'raw.png',[80,120],root/'out',background=True,fit_mode='frame-bounds')

    def test_background_uses_full_canvas_and_rejects_transparency(self):
        import tempfile
        from pathlib import Path
        from ai_ui_layers.postprocess_visual import process
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);raw=root/'raw.png'
            Image.new('RGBA',(40,60),(30,60,90,255)).save(raw)
            report=process(raw,[20,30],root/'opaque',background=True)
            self.assertEqual(report['issues'],[])
            with Image.open(root/'opaque/material.png') as im:self.assertEqual(im.size,(20,30))
            Image.new('RGBA',(40,60),(30,60,90,254)).save(raw)
            self.assertIn('BACKGROUND_NOT_OPAQUE',process(raw,[20,30],root/'translucent',background=True)['issues'])
