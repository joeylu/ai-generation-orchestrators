import unittest
from ai_ui_decomposition.component_boards import validate_canvas_size


class BoardIngestionGeometryTests(unittest.TestCase):
    def test_relative_resolution_is_not_exact_pixel_requirement(self):
        board=dict(canvas=[672,672],extraction_policy=dict(version='1.0',mode='relative-cell',target_padding=2,max_canvas_aspect_error=.15))
        validate_canvas_size([1344,1344],board)
        validate_canvas_size([1000,1001],board)
        for size in ([1774,887],[1672,941]):
            with self.assertRaisesRegex(ValueError,'BOARD_RELATIVE_CANVAS_ASPECT'):validate_canvas_size(size,board)
    def test_legacy_pixel_cells_remain_exact(self):
        validate_canvas_size([672,672],dict(canvas=[672,672]))
        with self.assertRaisesRegex(ValueError,'BOARD_CANVAS_MISMATCH'):validate_canvas_size([1344,1344],dict(canvas=[672,672]))
