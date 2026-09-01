import unittest,json
from pathlib import Path
import numpy as np
from scipy import ndimage  # Preload before sys.modules runtime doubles restore their snapshot.
from ai_frame_animation.media.reference_fusion import fuse_masks

CASE=json.loads((Path(__file__).parent/'fixtures/golden/reference-fusion-cases.json').read_text(encoding='utf-8'))

def fixture():
    a=np.zeros(tuple(CASE['size']),np.uint8);x0,y0,x1,y1=CASE['body'];a[y0:y1,x0:x1]=255
    b=a.copy();x0,y0,x1,y1=CASE['hole_or_badge'];b[y0:y1,x0:x1]=CASE['auxiliary_alpha']
    return a,b,np.full_like(a,255)

class FusionTests(unittest.TestCase):
    def test_enclosed_hole_changes_only_inside(self):
        a,b,s=fixture();out,e=fuse_masks(a,b,s);region=np.zeros(a.shape,bool);region[50:62,50:62]=True
        self.assertEqual(e['changed_pixels'],144);np.testing.assert_array_equal(out[~region],a[~region]);self.assertTrue(np.all(out<=a))
    def test_noop_when_models_agree(self):
        a,b,s=fixture();out,e=fuse_masks(a,a,s);np.testing.assert_array_equal(out,a);self.assertEqual(e['changed_pixels'],0)
    def test_open_background_does_not_touch_subject(self):
        a,b,s=fixture();b[:62,50:62]=0;out,e=fuse_masks(a,b,s);np.testing.assert_array_equal(out,a)
    def test_external_hair_and_feather_not_deleted(self):
        a,b,s=fixture();a[12,50:70]=128;out,_=fuse_masks(a,b,s);np.testing.assert_array_equal(out[12],a[12])
    def test_existing_continuous_alpha_disables_fusion(self):
        a,b,s=fixture();s[30,30]=170;out,e=fuse_masks(a,b,s);np.testing.assert_array_equal(out,a);self.assertTrue(e['source_alpha_bypass'])
    def test_masks_not_modified(self):
        arrays=fixture();original=[a.copy() for a in arrays];fuse_masks(*arrays)
        for a,b in zip(arrays,original):np.testing.assert_array_equal(a,b)
    def test_small_holes_ignored(self):
        a,b,s=fixture();b=a.copy();b[50:52,50:52]=0;out,_=fuse_masks(a,b,s);np.testing.assert_array_equal(out,a)
    def test_bad_shapes_and_dtype(self):
        a,b,s=fixture()
        with self.assertRaises(ValueError):fuse_masks(a.astype(float),b,s)
        with self.assertRaises(ValueError):fuse_masks(a,b[:2],s)
    def test_same_colour_front_and_white_cloth_not_colour_thresholded(self):
        a,b,s=fixture();out,_=fuse_masks(a,b,s)
        self.assertEqual(out[25,25],255);self.assertEqual(out[100,100],255)
    @unittest.expectedFailure
    def test_known_opaque_badge_aux_false_negative_must_be_preserved(self):
        # Intentionally unresolved semantic counterexample. Never count as a pass.
        a,b,s=fixture();out,_=fuse_masks(a,b,s);np.testing.assert_array_equal(out,a)
