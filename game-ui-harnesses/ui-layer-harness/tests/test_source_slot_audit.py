import _bootstrap  # Enable source-layout imports for unittest discovery.
import json
from pathlib import Path
import tempfile
import unittest

from PIL import Image, ImageDraw

from ai_ui_layers.evaluate import digest
from ai_ui_layers.source_slot_audit import audit


class SourceSlotAuditTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.reference = self.root/'reference.png'
        self.placements = self.root/'placements.json'
        self.specification = self.root/'specification.json'
        self.image = Image.new('RGB', (110, 45), (70, 70, 70))
        draw = ImageDraw.Draw(self.image)
        for left in (2, 22, 42, 62, 82):
            draw.rectangle((left, 2, left+10, 12), fill=(25, 25, 25), outline=(5, 5, 5))
        draw.rectangle((45, 5, 49, 9), fill=(230, 40, 20))
        draw.rectangle((65, 5, 69, 9), fill=(230, 40, 20))
        self.rows = [dict(id='clipped', sourceRegion=[46, 5, 49, 10]),
                     dict(id='complete', sourceRegion=[65, 5, 70, 10])]
        self.spec = dict(kind='ui_source_slot_audit_input_v1',
                         emptySlotBoxes=[[2, 2, 13, 13], [22, 2, 33, 13]],
                         borderPixels=1)

    def run_audit(self):
        self.image.save(self.reference)
        self.placements.write_text(json.dumps(dict(
            basis='declared material regions, no alpha measurement', materials=self.rows)),
            encoding='utf-8')
        self.specification.write_text(json.dumps(self.spec), encoding='utf-8')
        before = tuple(digest(path) for path in
                       (self.reference, self.placements, self.specification))
        report = audit(self.reference, self.placements, self.specification)
        self.assertEqual(before, tuple(digest(path) for path in
                                       (self.reference, self.placements, self.specification)))
        return report

    def test_detects_omitted_pixels_without_extracting_or_repairing(self):
        report = self.run_audit()
        rows = {row['materialId']: row for row in report['materials']}
        self.assertEqual(rows['clipped']['status'], 'planned_crop_omits_different_pixels')
        self.assertEqual(rows['clipped']['outsidePlannedBoxPixels'], 10)
        self.assertEqual(rows['complete']['status'], 'candidate_requires_visual_review')
        self.assertTrue(rows['complete']['candidateForReviewedSourceRoute'])
        self.assertFalse(rows['complete']['sourceExtractionReady'])
        self.assertTrue(report['differentPixelsAreNotAlpha'])
        self.assertFalse(report['planChanged'])
        self.assertEqual(report['generationCalls'], 0)

    def test_frame_occlusion_or_contour_touch_does_not_create_candidate(self):
        self.image.putpixel((42, 5), (230, 40, 20))
        self.image.putpixel((65, 3), (230, 40, 20))
        report = self.run_audit()
        rows = {row['materialId']: row for row in report['materials']}
        self.assertEqual(rows['clipped']['status'], 'template_mismatch')
        self.assertEqual(rows['complete']['status'], 'ownership_boundary_uncertain')
        self.assertFalse(any(row['candidateForReviewedSourceRoute'] for row in rows.values()))

    def test_empty_template_disagreement_is_rejected(self):
        self.image.putpixel((25, 5), (40, 40, 40))
        with self.assertRaisesRegex(ValueError, 'EMPTY_SLOT_TEMPLATES_DIFFER'):
            self.run_audit()

    def test_nonflat_empty_interior_is_rejected_even_when_repeated(self):
        for x in (5, 25):
            self.image.putpixel((x, 5), (40, 40, 40))
        with self.assertRaisesRegex(ValueError, 'EMPTY_SLOT_INTERIOR_NOT_FLAT'):
            self.run_audit()

    def test_overlapping_empty_boxes_are_rejected(self):
        self.spec['emptySlotBoxes'][1] = [3, 2, 14, 13]
        with self.assertRaisesRegex(ValueError, 'EMPTY_SLOTS_OVERLAP'):
            self.run_audit()


if __name__ == '__main__':
    unittest.main()
