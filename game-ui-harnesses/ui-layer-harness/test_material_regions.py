import copy
from pathlib import Path
import tempfile
import unittest

from jsonschema import Draft202012Validator
from PIL import Image
from evaluate import read, render, check_relations, draw_order


BASE = Path(__file__).resolve().parents[2] / 'game-ui-harnesses/ui-decomposition-harness/planning-harness'


class MaterialRegionTests(unittest.TestCase):
    def setUp(self):
        self.plan = read(BASE / 'examples/visual-plan.json')
        self.validator = Draft202012Validator(read(BASE / 'schemas/visual-plan.schema.json'))

    def test_schema_requires_material_region_allows_null_auxiliary(self):
        self.validator.validate(self.plan)
        self.assertEqual(check_relations(self.plan), [])
        del self.plan['materials'][1]['bboxNorm']
        self.assertTrue(list(self.validator.iter_errors(self.plan)))

    def test_declared_crop_preserves_protrusion_without_object_boxes(self):
        for auxiliary in (True, False):
            plan = copy.deepcopy(self.plan)
            if not auxiliary:
                for row in plan['objects']:
                    row['bboxNorm'] = None
            with tempfile.TemporaryDirectory() as td:
                folder = Path(td)
                Image.new('RGB', (1000, 1000)).save(folder / 'reference.png')
                render(folder / 'reference.png', plan, folder)
                geometry = read(folder / 'geometry.json')
                panel = next(m for m in geometry['materials'] if m['id'] == 'asset-panel')
                self.assertEqual(panel['rectLTRB'], [100, 50, 900, 900])
                self.assertEqual(panel['centerXY'], [500, 475])
                self.assertTrue((folder / 'materials-overlay.png').exists())
                self.assertEqual(check_relations(plan), [])

    def test_auxiliary_outside_does_not_expand_material(self):
        self.plan['objects'][2]['bboxNorm'][1] = .01
        before = copy.deepcopy(self.plan)
        self.assertIn('OBJECT_OUTSIDE_MATERIAL', [i['code'] for i in check_relations(self.plan)])
        self.assertEqual(before, self.plan)

    def test_material_overlap_blocks_even_without_auxiliary_boxes(self):
        self.plan['materials'][4]['bboxNorm'] = [.7, .28, .75, .45]
        issue = next(i for i in check_relations(self.plan) if i['code'] == 'SAME_LAYER_OVERLAP_REVIEW')
        self.assertEqual(issue['materialPairs'], [['asset-coin-a', 'asset-coin-b']])
        self.assertNotIn('objectPairs', issue)
        with self.assertRaises(ValueError):
            draw_order(self.plan, 'source')

    def test_background_requires_full_material_region(self):
        self.plan['materials'][0]['bboxNorm'] = [0, 0, .9, 1]
        self.assertIn('BACKGROUND_REGION', [i['code'] for i in check_relations(self.plan)])


if __name__ == '__main__':
    unittest.main()
