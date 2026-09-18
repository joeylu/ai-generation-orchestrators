import tempfile
import unittest
from pathlib import Path

from PIL import Image, ImageDraw

from ai_ui_decomposition.board_extraction_revision import revise
from ai_ui_decomposition.component_boards import plan_boards
from ai_ui_decomposition.common import sha256, write_json


class SourceAlphaRegionRevisionTests(unittest.TestCase):
    def setUp(self):
        self.policy = {
            'version': '1.0', 'mode': 'relative-cell', 'target_padding': 2,
            'max_canvas_aspect_error': .15,
        }
        description = {
            'kind': 'ai_ui_material_observations_v2',
            'strategy': 'component-family-board-v1',
            'packing_canvas': [256, 256],
            'extraction_policy': self.policy,
            'assets': [
                {'id': f'icon-{index}', 'component_type': 'Image',
                 'component_group': 'icons', 'target_size': [32, 32],
                 'source_reusable': False, 'source_evidence': ''}
                for index in range(3)
            ],
        }
        self.strategy = plan_boards(description)
        self.regions = {
            'icon-0': [0, 90, 60, 70],
            'icon-1': [80, 90, 70, 70],
            'icon-2': [180, 90, 70, 70],
        }

    def write_strategy(self, root):
        path = root / 'strategy.json'
        write_json(path, self.strategy)
        return path

    def make_transparent_raw(self):
        raw = Image.new('RGBA', (256, 256), (17, 29, 41, 0))
        draw = ImageDraw.Draw(raw)
        for x, color in ((10, (248, 8, 248, 255)),
                         (100, (248, 8, 248, 255)),
                         (200, (248, 8, 248, 255))):
            draw.ellipse((x, 105, x + 30, 135), fill=color)
            raw.putpixel((x + 15, 105), (248, 8, 248, 128))
        return raw

    def run_revision(self, root, raw, *, source_regions=None, source_alpha=None,
                     reason='Explicit alpha source-region revision'):
        raw_path = root / 'raw.png'
        raw.save(raw_path)
        return revise(raw_path, self.write_strategy(root), 'icons',
                      sha256(raw_path), self.policy, reason, root / 'output',
                      source_regions=source_regions, source_alpha=source_alpha)

    def test_preserve_accepts_rgba_magenta_and_soft_alpha(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            report = self.run_revision(root, self.make_transparent_raw(),
                                       source_regions=self.regions,
                                       source_alpha='preserve')
            self.assertEqual(report['version'], '1.1')
            self.assertEqual(report['sourceAlpha'], 'preserve')
            self.assertEqual(report['sourceRegions'], self.regions)
            self.assertEqual(report['sourceStrategy'], self.strategy)
            for asset_id in self.regions:
                with Image.open(root / 'output' / f'{asset_id}.png') as image:
                    rgba = image.convert('RGBA')
                    self.assertEqual(rgba.getchannel('A').getextrema(), (0, 255))
                    pixels = (rgba.getpixel((x, y))
                              for y in range(rgba.height)
                              for x in range(rgba.width))
                    pixels = list(pixels)
                    self.assertTrue(any(pixel[:3] == (248, 8, 248) and
                                        pixel[3] > 0 for pixel in pixels))
                    self.assertTrue(any(0 < pixel[3] < 255 for pixel in pixels))

    def test_faint_distant_pixel_is_reported_without_silent_thresholding(self):
        raw = self.make_transparent_raw()
        raw.putpixel((25, 92), (248, 8, 248, 1))
        with tempfile.TemporaryDirectory() as temp:
            report = self.run_revision(Path(temp), raw,
                                       source_regions=self.regions, source_alpha='preserve')
            row = next(r for r in report['parts'] if r['asset_id'] == 'icon-0')
            self.assertEqual(row['matte_bbox_in_window'][1], 2)
            diagnostic = row['alphaSupportDiagnostic']
            self.assertTrue(diagnostic['fitUsesAllNonzeroAlpha'])
            self.assertLess(diagnostic['coreToSupportHeight'], .8)

    def assert_preserve_rejected(self, raw, expected, *, regions=None):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            with self.assertRaisesRegex(ValueError, expected):
                self.run_revision(root, raw,
                                  source_regions=regions or self.regions,
                                  source_alpha='preserve')

    def test_preserve_rejects_nontransparent_source(self):
        raw = Image.new('RGB', (256, 256), (248, 8, 248))
        draw = ImageDraw.Draw(raw)
        for x in (10, 100, 200):
            draw.ellipse((x, 105, x + 30, 135), fill=(248, 8, 248))
        self.assert_preserve_rejected(raw, 'BOARD_SOURCE_ALPHA_REQUIRED')

    def test_preserve_rejects_region_alpha_edge_and_dropped_foreground(self):
        edge = self.make_transparent_raw()
        edge.putpixel((0, 90), (248, 8, 248, 1))
        self.assert_preserve_rejected(edge, 'BOARD_SOURCE_REGIONS_ALPHA_EDGE')

        dropped = self.make_transparent_raw()
        dropped.putpixel((70, 20), (248, 8, 248, 255))
        self.assert_preserve_rejected(dropped,
                                      'BOARD_SOURCE_REGIONS_FOREGROUND_DROPPED')

    def test_preserve_requires_regions_and_legacy_default_is_unchanged(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            with self.assertRaisesRegex(ValueError,
                                        'BOARD_SOURCE_ALPHA_REGIONS_REQUIRED'):
                self.run_revision(root, self.make_transparent_raw(),
                                  source_alpha='preserve')

        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            raw = Image.new('RGB', (256, 256), (248, 8, 248))
            draw = ImageDraw.Draw(raw)
            for x, color in ((10, (20, 120, 220)),
                             (100, (40, 180, 90)),
                             (200, (220, 90, 30))):
                draw.ellipse((x, 105, x + 30, 135), fill=color)
            report = self.run_revision(root, raw, source_regions=self.regions)
            self.assertEqual(report['version'], '1.0')
            self.assertNotIn('sourceAlpha', report)


if __name__ == '__main__':
    unittest.main()
