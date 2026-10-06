import _bootstrap
import tempfile
import unittest
from pathlib import Path

from PIL import Image

from ai_ui_layers.extract_sheets import detail_comparison
from ai_ui_layers.review_image import fit_resampling, alpha_visibility_rgb
from ai_ui_layers.automatic_registration import observation_image
from ai_ui_layers.evaluate import digest
from ai_ui_layers.single_material_review import comparison


class ReviewImageTests(unittest.TestCase):
    def test_faint_bright_fringe_is_composited_at_its_real_alpha(self):
        image = Image.new('RGBA', (48, 24), (255, 255, 255, 0))
        image.putpixel((0, 0), (255, 255, 255, 1))
        image.putpixel((24, 0), (255, 255, 255, 1))
        image.putpixel((12, 12), (40, 70, 100, 255))
        image.putpixel((30, 12), (0, 0, 0, 128))
        original = image.tobytes()
        visible = alpha_visibility_rgb(image)
        self.assertEqual(visible.mode, 'RGB')
        self.assertEqual(visible.getpixel((0, 0)), (235, 235, 235))
        self.assertEqual(visible.getpixel((24, 0)), (190, 190, 190))
        self.assertEqual(visible.getpixel((1, 0)), (235, 235, 235))
        self.assertEqual(visible.getpixel((12, 12)), (40, 70, 100))
        self.assertEqual(visible.getpixel((30, 12)), (95, 95, 95))
        self.assertEqual(image.tobytes(), original)

    def test_visibility_attachment_preserves_source_and_coordinate_mapping(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            source = root/'source.png'
            Image.new('RGBA', (2000, 1000), (255, 255, 255, 1)).save(source)
            original_sha = digest(source)
            observed = root/'visible.png'
            mapping = observation_image(source, observed, alpha_visibility=True)
            self.assertEqual(mapping['originalSize'], [2000, 1000])
            self.assertEqual(mapping['observationSize'], [1536, 768])
            self.assertEqual(mapping['originalSha256'], original_sha)
            self.assertEqual(mapping['observationSha256'], digest(observed))
            self.assertFalse(mapping['alphaDisplay']['rawAlphaModified'])
            with Image.open(observed) as image:
                self.assertEqual(image.mode, 'RGB')
                self.assertEqual(image.getpixel((0, 0)), (235, 235, 235))
            self.assertEqual(digest(source), original_sha)
            unchanged_mode = root/'default.png'
            default_mapping = observation_image(source, unchanged_mode)
            self.assertNotIn('alphaDisplay', default_mapping)
            with Image.open(unchanged_mode) as image:
                self.assertEqual(image.mode, 'RGBA')
                self.assertEqual(image.getchannel('A').getextrema(), (1, 1))

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
