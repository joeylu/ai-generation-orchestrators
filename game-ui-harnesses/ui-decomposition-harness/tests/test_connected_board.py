import unittest
import numpy as np
from ai_ui_decomposition.relative_board import gap_windows, validate_policy


class ConnectedBoardTests(unittest.TestCase):
    def policy(self):
        return dict(version='1.5',mode='foreground-gap-row',canvas_policy='content-bounds',
                    target_padding=2,max_internal_gap_ratio=0,max_part_aspect_error=.5,
                    separation_basis='connected-silhouette')

    def slots(self):
        return [dict(asset_id=str(i),crop=[i*100,0,80,80],target_size=[84,84]) for i in range(2)]

    def image(self):
        f=np.zeros((100,190),bool);f[10:90,10:90]=True;f[10:90,94:174]=True
        return f

    def test_four_pixel_gap_preserves_two_connected_objects(self):
        self.assertEqual(len(gap_windows(self.image(),self.slots(),self.policy())),2)

    def test_fragmented_object_is_not_silently_accepted(self):
        f=self.image();f[40:50,10:90]=False
        with self.assertRaisesRegex(ValueError,'BOARD_CONNECTED_FRAGMENTED'):
            gap_windows(f,self.slots(),self.policy())

    def test_touching_objects_fail(self):
        f=self.image();f[40:50,90:94]=True
        with self.assertRaisesRegex(ValueError,'BOARD_GAP_COUNT_OR_JOINED'):
            gap_windows(f,self.slots(),self.policy())

    def test_merge_radius_rejected(self):
        p=self.policy();p['max_internal_gap_ratio']=.08
        with self.assertRaisesRegex(ValueError,'BOARD_CONNECTED_NO_MERGE'):validate_policy(p)

    def test_legacy_policy_is_unchanged(self):
        p=self.policy();p.update(version='1.2',separation_basis='mixed-height',max_internal_gap_ratio=.08)
        with self.assertRaisesRegex(ValueError,'BOARD_GAP_COUNT_OR_JOINED'):
            gap_windows(self.image(),self.slots(),p)
