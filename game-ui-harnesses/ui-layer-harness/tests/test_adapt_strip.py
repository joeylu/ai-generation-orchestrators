import _bootstrap
import tempfile
import unittest
from pathlib import Path
from PIL import Image,ImageDraw
from ai_ui_layers.adapt_strip import adapt, validate_policy
from ai_ui_layers.evaluate import digest


class AdaptStripTests(unittest.TestCase):
    def test_clipped_input_stops_before_creating_output(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);source=root/'source.png'
            im=Image.new('RGBA',(30,120));ImageDraw.Draw(im).rectangle((5,0,24,109),fill='white');im.save(source)
            with self.assertRaisesRegex(ValueError,'SOURCE_CONTOUR'):
                adapt(source,digest(source),10,100,root/'out','simple-strip')
            self.assertFalse((root/'out').exists())

    def test_complex_material_policy_is_rejected(self):
        material=dict(id='strip',role='foreground',adaptationPolicy='simple-strip')
        visual=dict(objects=[dict(materialId='strip',kind='icon')])
        with self.assertRaisesRegex(ValueError,'INELIGIBLE'):validate_policy(visual,material,[10,100])
        visual['objects'][0]['kind']='decoration'
        validate_policy(visual,material,[10,100])
        with self.assertRaisesRegex(ValueError,'INELIGIBLE'):validate_policy(visual,material,[40,100])

    def test_explicit_adaptation_preserves_source_and_binds_scale(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);source=root/'source.png'
            im=Image.new('RGBA',(30,120),(255,0,0,0))
            ImageDraw.Draw(im).rectangle((5,10,24,109),fill=(40,90,110,255))
            im.save(source);before=digest(source)
            result=adapt(source,before,10,100,root/'out','simple-strip')
            self.assertEqual(digest(source),before)
            self.assertEqual(digest(root/'out/raw.png'),before)
            self.assertEqual(result['sourceBox'],[5,10,25,110])
            self.assertEqual((result['scaleX'],result['scaleY']),(.5,1))
            with Image.open(root/'out/adapted.png') as out:
                self.assertEqual(out.size,(14,104))
                self.assertEqual(out.getpixel((0,0)),(0,0,0,0))
                self.assertEqual(out.getpixel((7,50)),(40,90,110,255))
            self.assertFalse(result['humanVisualAcceptance'])
            with self.assertRaises(FileExistsError):adapt(source,before,10,100,root/'out','simple-strip')
            with self.assertRaisesRegex(ValueError,'SOURCE_CHANGED'):adapt(source,'wrong',10,100,root/'bad','simple-strip')
            with self.assertRaisesRegex(ValueError,'POLICY'):adapt(source,before,10,100,root/'bad','automatic')
            self.assertFalse((root/'bad').exists())
