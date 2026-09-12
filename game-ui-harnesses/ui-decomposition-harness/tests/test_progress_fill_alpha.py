import unittest
from PIL import Image
from ai_ui_decomposition.stateful import require_part_alpha
from ai_ui_decomposition.common import ContractError


class ProgressFillAlphaTests(unittest.TestCase):
    def test_full_rectangle_with_partial_edges_is_valid_fill(self):
        image=Image.new('RGBA',(30,10),(30,220,120,255))
        image.putpixel((0,0),(30,220,120,211))
        before=image.tobytes()
        require_part_alpha(image.getchannel('A').getextrema(),'ProgressBar','fill','fill')
        self.assertEqual(image.tobytes(),before)

    def test_same_partial_edges_do_not_relax_icons_or_other_parts(self):
        for component,role in [('Tabs','icon'),('Tabs','active-icon'),('ProgressBar','track'),('Button','background')]:
            with self.subTest(component=component,role=role):
                with self.assertRaisesRegex(ContractError,'STATE_ALPHA_INVALID'):
                    require_part_alpha((211,255),component,role,'part')

    def test_opaque_or_empty_fill_is_still_rejected(self):
        for extrema in [(255,255),(0,0)]:
            with self.assertRaisesRegex(ContractError,'STATE_ALPHA_INVALID'):
                require_part_alpha(extrema,'ProgressBar','fill','fill')
