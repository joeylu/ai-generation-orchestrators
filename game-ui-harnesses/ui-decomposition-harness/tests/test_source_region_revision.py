import copy
import tempfile
import unittest
from pathlib import Path

from PIL import Image, ImageDraw

from ai_ui_decomposition.board_extraction_revision import revise
from ai_ui_decomposition.component_boards import plan_boards
from ai_ui_decomposition.common import digest, sha256, write_json


class SourceRegionRevisionTests(unittest.TestCase):
    def setUp(self):
        self.policy = {
            'version': '1.0', 'mode': 'relative-cell', 'target_padding': 2,
            'max_canvas_aspect_error': .15,
        }
        self.description = {
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
        self.strategy = plan_boards(self.description)
        self.regions = {
            'icon-0': [0, 90, 60, 70],
            'icon-1': [80, 90, 70, 70],
            'icon-2': [180, 90, 70, 70],
        }

    def make_raw(self):
        raw = Image.new('RGB', (256, 256), (248, 8, 248))
        draw = ImageDraw.Draw(raw)
        for x, color in ((10, (20, 120, 220)), (100, (40, 180, 90)),
                         (200, (220, 90, 30))):
            draw.ellipse((x, 105, x + 30, 135), fill=color)
        return raw

    def test_regions_are_bound_and_reproduced(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            raw_path = root / 'raw.png'
            strategy_path = root / 'strategy.json'
            self.make_raw().save(raw_path)
            write_json(strategy_path, self.strategy)
            first = revise(raw_path, strategy_path, 'icons', sha256(raw_path),
                           self.policy, 'Explicit source regions', root / 'one',
                           source_regions=self.regions)
            second = revise(raw_path, strategy_path, 'icons', sha256(raw_path),
                            self.policy, 'Explicit source regions', root / 'two',
                            source_regions=self.regions)
            self.assertEqual(first['sourceRegions'], self.regions)
            self.assertEqual(first['sourceStrategy'], self.strategy)
            self.assertEqual(first['digest'], second['digest'])
            self.assertEqual(digest({k: v for k, v in first.items() if k != 'digest'}),
                             first['digest'])
            sizes = []
            for index in range(3):
                with Image.open(root / 'one' / f'icon-{index}.png') as image:
                    sizes.append(image.size)
            self.assertEqual(sizes, [(32, 32)] * 3)

    def assert_bad(self, regions, expected):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            raw_path = root / 'raw.png'
            strategy_path = root / 'strategy.json'
            self.make_raw().save(raw_path)
            write_json(strategy_path, self.strategy)
            with self.assertRaisesRegex(ValueError, expected):
                revise(raw_path, strategy_path, 'icons', sha256(raw_path),
                       self.policy, 'Invalid source regions', root / 'bad',
                       source_regions=regions)

    def test_overlap_missing_and_out_of_bounds_fail(self):
        overlap = copy.deepcopy(self.regions)
        overlap['icon-1'][0] = 50
        self.assert_bad(overlap, 'BOARD_SOURCE_REGIONS_OVERLAP')
        missing = copy.deepcopy(self.regions)
        del missing['icon-2']
        self.assert_bad(missing, 'BOARD_SOURCE_REGIONS_COVERAGE')
        bounds = copy.deepcopy(self.regions)
        bounds['icon-2'] = [230, 90, 40, 70]
        self.assert_bad(bounds, 'BOARD_SOURCE_REGIONS_BOUNDS')

    def test_key_edge_and_unassigned_foreground_fail(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            strategy_path = root / 'strategy.json'
            raw_path = root / 'raw.png'
            write_json(strategy_path, self.strategy)
            raw = self.make_raw()
            raw.putpixel((0, 90), (20, 120, 220))
            raw.save(raw_path)
            with self.assertRaisesRegex(ValueError, 'BOARD_SOURCE_REGIONS_KEY_EDGE'):
                revise(raw_path, strategy_path, 'icons', sha256(raw_path),
                       self.policy, 'Invalid key edge', root / 'edge',
                       source_regions=self.regions)
            raw = self.make_raw()
            raw.putpixel((70, 20), (20, 120, 220))
            raw.save(raw_path)
            with self.assertRaisesRegex(ValueError, 'BOARD_SOURCE_REGIONS_FOREGROUND_DROPPED'):
                revise(raw_path, strategy_path, 'icons', sha256(raw_path),
                       self.policy, 'Dropped foreground', root / 'dropped',
                       source_regions=self.regions)


if __name__ == '__main__':
    unittest.main()
