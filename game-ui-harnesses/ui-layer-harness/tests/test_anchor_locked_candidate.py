"""Reproduce support-induced displacement without model or media calls."""
import _bootstrap
import unittest
from PIL import Image,ImageDraw
from ai_ui_layers import host_material_review as host


class AnchorLockedTests(unittest.TestCase):
    def quantity(self):
        image=Image.new('RGBA',(200,100));draw=ImageDraw.Draw(image)
        draw.rectangle((40,20,159,39),fill=(60,70,80,230))
        draw.rectangle((40,40,159,90),fill=(60,70,80,1))
        return image

    def test_safe_support_expands_storage_without_moving_or_scaling_anchor(self):
        image=self.quantity();before=image.tobytes();owner=[100,60,220,80]
        canvas,region,r=host.measured_alpha_support(image,owner,(400,200),anchor_locked=True)
        self.assertEqual(r['translationDeviations'],[0,0])
        self.assertEqual(r['actualScale'],r['desiredScale'])
        self.assertEqual(r['scaleReduction'],0)
        self.assertEqual(r['actualMeasuredPlacementBox'],owner)
        self.assertGreater(region[3],owner[3])
        self.assertTrue(r['anchorLocked']);self.assertFalse(r['supportMayAlterPlacement'])
        self.assertFalse(r['observedBody']);self.assertEqual(image.tobytes(),before)
        self.assertEqual(canvas.getchannel('A').getextrema()[0],0)

    def test_bottom_shadow_cannot_push_body_up(self):
        image=self.quantity();before=image.tobytes();owner=[100,150,220,170]
        _,_,legacy=host.measured_alpha_support(image,owner,(400,200))
        self.assertLess(legacy['translationDeviations'][1],0)
        with self.assertRaisesRegex(ValueError,'CANDIDATE_ANCHOR_SUPPORT_OUTSIDE_REFERENCE'):
            host.measured_alpha_support(image,owner,(400,200),anchor_locked=True)
        self.assertEqual(image.tobytes(),before)

    def test_top_faint_pixels_cannot_push_body_down(self):
        image=Image.new('RGBA',(200,100));draw=ImageDraw.Draw(image)
        draw.rectangle((40,70,159,89),fill=(60,70,80,230))
        image.putpixel((40,0),(60,70,80,1));before=image.tobytes()
        _,_,legacy=host.measured_alpha_support(image,[100,0,220,20],(400,200))
        self.assertGreater(legacy['translationDeviations'][1],0)
        with self.assertRaisesRegex(ValueError,'CANDIDATE_ANCHOR_SUPPORT_OUTSIDE_REFERENCE'):
            host.measured_alpha_support(image,[100,0,220,20],(400,200),anchor_locked=True)
        self.assertEqual(image.tobytes(),before)

    def test_support_cannot_shrink_source_to_make_whole_reference_fit(self):
        image=Image.new('RGBA',(200,100));draw=ImageDraw.Draw(image)
        draw.rectangle((1,1,198,98),fill=(30,40,50,1))
        draw.rectangle((80,40,99,59),fill=(60,70,80,230))
        _,_,legacy=host.measured_alpha_support(image,[25,25,75,75],(100,100))
        self.assertGreater(legacy['scaleReduction'],0)
        with self.assertRaisesRegex(ValueError,'CANDIDATE_ANCHOR_SUPPORT_OUTSIDE_REFERENCE'):
            host.measured_alpha_support(image,[25,25,75,75],(100,100),anchor_locked=True)


if __name__=='__main__':unittest.main()
