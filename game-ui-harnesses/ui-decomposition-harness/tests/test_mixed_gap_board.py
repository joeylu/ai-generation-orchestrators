import unittest
from PIL import Image,ImageDraw
from ai_ui_decomposition.relative_board import gap_windows,validate_policy
from ai_ui_decomposition.common import ContractError
import numpy as np

class MixedGapTests(unittest.TestCase):
    def policy(self):
        return dict(version='1.2',mode='foreground-gap-row',target_padding=2,
                    canvas_policy='content-bounds',max_internal_gap_ratio=.05,
                    max_part_aspect_error=.35,separation_basis='mixed-height')

    def scene(self,gap=32):
        im=Image.new('1',(450,270));d=ImageDraw.Draw(im)
        d.rectangle((10,10,247,247),fill=1)
        d.rectangle((248+gap,76,353+gap,181),fill=1)
        slots=[dict(asset_id='item',crop=[0,0,100,100],target_size=[104,104]),
               dict(asset_id='coin',crop=[150,0,30,30],target_size=[34,34])]
        return np.asarray(im),slots

    def test_mixed_sizes_and_legacy_failure(self):
        f,s=self.scene();p=self.policy();validate_policy(p)
        self.assertEqual(len(gap_windows(f,s,p)),2)
        p.pop('separation_basis');p['version']='1.1'
        with self.assertRaisesRegex(ContractError,'AMBIGUOUS'):gap_windows(f,s,p)

    def test_ambiguous_or_joined_still_fail(self):
        for gap in (0,12,18):
            with self.subTest(gap=gap),self.assertRaises(ContractError):
                f,s=self.scene(gap);gap_windows(f,s,self.policy())

    def test_version_requires_explicit_basis(self):
        for basis in (None,'anything'):
            p=self.policy()
            if basis is None:p.pop('separation_basis')
            else:p['separation_basis']=basis
            with self.assertRaisesRegex(ContractError,'POLICY'):validate_policy(p)
