import _bootstrap
import tempfile
import unittest
from pathlib import Path

from PIL import Image

from ai_ui_layers.extract_sheets import detail_comparison
from ai_ui_layers.review_image import fit_resampling
from ai_ui_layers.single_material_review import comparison


class ReviewImageTests(unittest.TestCase):
    def test_enlargement_keeps_source_pixels_and_reduction_antialiases(self):
        self.assertEqual(fit_resampling((2, 2), (8, 8)), Image.Resampling.NEAREST)
        self.assertEqual(fit_resampling((8, 8), (2, 2)), Image.Resampling.LANCZOS)

    def test_sheet_closeup_does_not_blur_a_tiny_reference(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            reference = root/'materials'/'icon'/'reference-crop.png'
            reference.parent.mkdir(parents=True)
            original = Image.new('RGBA', (2, 2), (0, 0, 0, 255))
            original.putpixel((0, 0), (255, 0, 0, 255))
            original.save(reference)
            generated = root/'sheet.png'
            Image.new('RGBA', (8, 8), (0, 255, 0, 255)).save(generated)
            detail_comparison(root, generated, {'materialIds': ['icon']},
                              [[0, 0, 8, 8]], root)
            with Image.open(root/'detail-compare.png') as board:
                center_x, center_y = 360, 120
                self.assertEqual(board.getpixel((center_x-1, center_y-1)), (255, 0, 0))
                self.assertEqual(board.getpixel((center_x, center_y-1)), (0, 0, 0))
                self.assertEqual(board.getpixel((center_x-1, center_y)), (0, 0, 0))

    def test_single_material_closeup_does_not_blur_a_tiny_reference(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            reference = root/'reference.png'
            original = Image.new('RGBA', (2, 2), (0, 0, 0, 255))
            original.putpixel((0, 0), (255, 0, 0, 255))
            original.save(reference)
            generated = root/'generated.png'
            received = Image.new('RGBA', (8, 8))
            for y in range(1, 7):
                for x in range(1, 7):
                    received.putpixel((x, y), (0, 255, 0, 255))
            received.save(generated)
            output = root/'comparison.png'
            comparison(reference, generated, output)
            with Image.open(output) as board:
                center_x, center_y = 360, 150
                self.assertEqual(board.getpixel((center_x-1, center_y-1)), (255, 0, 0))
                self.assertEqual(board.getpixel((center_x, center_y-1)), (0, 0, 0))
                self.assertEqual(board.getpixel((center_x-1, center_y)), (0, 0, 0))


if __name__ == '__main__':
    unittest.main()
