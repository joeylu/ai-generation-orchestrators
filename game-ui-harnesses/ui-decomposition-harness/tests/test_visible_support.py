import unittest
from PIL import Image
from ai_ui_decomposition.common import ContractError
from ai_ui_decomposition.media import visible_support_geometry, require_long_control_geometry


class VisibleSupportTests(unittest.TestCase):
    def test_official_board_extraction_rejects_thin_buttons(self):
        from PIL import ImageDraw
        from ai_ui_decomposition.relative_board import crop_relative
        board = dict(canvas=[640,300], extraction_policy=dict(version='1.0',
                     mode='relative-cell',target_padding=2,max_canvas_aspect_error=.15),
                     slots=[dict(asset_id='button',search_window=[0,0,640,300],target_size=[305,123])])
        raw=Image.new('RGB',(640,300),'#F808F8')
        ImageDraw.Draw(raw).rectangle((20,60,619,239),fill='gold')
        with self.assertRaisesRegex(ContractError,'VISIBLE_SUPPORT_SIZE_MISMATCH'):
            crop_relative(raw,board,'keyed_component')

    def material(self, box):
        im = Image.new('RGBA', (305, 123))
        im.paste((40, 80, 120, 255), box)
        return im

    def test_correct_canvas_cannot_hide_thin_button(self):
        im = self.material((2, 16, 303, 106))
        evidence = visible_support_geometry(im, [305, 123], [2]*4)
        self.assertEqual(evidence['visibleSize'], [301, 90])
        self.assertEqual(evidence['expectedVisibleSize'], [301, 119])
        self.assertEqual(evidence['actualInsets'], [2, 16, 2, 17])
        with self.assertRaisesRegex(ContractError, 'VISIBLE_SUPPORT_SIZE_MISMATCH'):
            require_long_control_geometry(im, [305, 123], {'insets': [2]*4})

    def test_declared_margins_and_small_rounding_are_valid(self):
        for box in [(2, 2, 303, 121), (3, 3, 302, 120)]:
            require_long_control_geometry(self.material(box), [305, 123], {'insets': [2]*4})
        require_long_control_geometry(self.material((2,16,303,106)), [305,123],
                                      {'insets': [2,16,2,17]})

    def test_no_inferred_support_for_legacy_canvas_only_asset(self):
        require_long_control_geometry(self.material((2,16,303,106)), [305,123])

    def test_tiny_or_empty_support_is_not_valid(self):
        with self.assertRaisesRegex(ContractError, 'VISIBLE_SUPPORT_SIZE_MISMATCH'):
            require_long_control_geometry(self.material((100,50,110,60)), [305,123], {'insets':[2]*4})
        with self.assertRaisesRegex(ContractError, 'EMPTY_MATERIAL'):
            visible_support_geometry(Image.new('RGBA',(305,123)), [305,123], [2]*4)
