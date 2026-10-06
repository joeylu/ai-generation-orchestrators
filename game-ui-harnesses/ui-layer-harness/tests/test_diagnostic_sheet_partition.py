"""Synthetic RGBA fixtures only; no files, jobs, model or provider calls."""
import _bootstrap
import unittest

from PIL import Image, ImageDraw

from ai_ui_layers.diagnostic_sheet_partition import partition


class DiagnosticSheetPartitionTests(unittest.TestCase):
    def image(self):
        image = Image.new('RGBA', (128, 64), (19, 23, 29, 0))
        draw = ImageDraw.Draw(image)
        draw.rectangle((10, 10, 30, 30), fill=(50, 80, 120, 255))
        draw.rectangle((90, 10, 110, 30), fill=(70, 90, 130, 255))
        return image

    def verify_exact(self, image, evidence):
        replay = Image.new('RGBA', image.size)
        for box in evidence['partitionBoxes']:
            replay.paste(image.crop(box), box[:2])
        self.assertEqual(image.tobytes(), replay.tobytes())
        self.assertEqual(evidence['sourceRgbaPixelsSha256'], evidence['reconstructedRgbaPixelsSha256'])
        self.assertFalse(evidence['alphaQualityAccepted'])
        self.assertFalse(evidence['sourceBodyCompletenessObserved'])

    def test_strong_boundary_retained(self):
        image = self.image()
        image.putpixel((0, 15), (2, 3, 4, 255))
        before = image.tobytes()
        boxes, proof = partition(image, dict(grid=[2, 1], materialIds=['a', 'b']))
        self.assertFalse(proof['candidateExtractionPassed'])
        self.assertIn('OUTER_ALPHA_NOT_FAINT', proof['candidateExtractionIssue'])
        self.assertEqual(255, proof['cells'][0]['boundaryMaximumAlpha'])
        self.assertEqual(before, image.tobytes())
        self.verify_exact(image, proof)

    def test_nontransparent_internal_seam_retained(self):
        image = self.image()
        image.putpixel((0, 15), (5, 6, 7, 1))
        ImageDraw.Draw(image).rectangle((40, 20, 90, 23), fill=(1, 2, 3, 1))
        boxes, proof = partition(image, dict(grid=[2, 1], materialIds=['a', 'b']))
        self.assertIn('NO_TRANSPARENT_SEAM', proof['candidateExtractionIssue'])
        self.assertGreater(proof['internalSeams'][0]['nonzeroAlphaCount'], 0)
        self.assertFalse(proof['internalSeams'][0]['bothAdjacentLinesTransparent'])
        self.verify_exact(image, proof)

    def test_unused_content_requires_sidecar(self):
        image = Image.new('RGBA', (128, 128))
        for xy in ((10, 10), (90, 10), (10, 90), (90, 90)):
            image.putpixel(xy, (77, 88, 99, 255))
        boxes, proof = partition(image, dict(grid=[2, 2], materialIds=['a', 'b', 'c']))
        self.assertEqual(3, len(boxes))
        self.assertTrue(proof['orphanSidecarsRequired'])
        self.assertEqual([[64, 64, 128, 128]], proof['unusedCellBoxes'])
        self.assertEqual(1, proof['cells'][3]['nonzeroAlphaCount'])
        self.verify_exact(image, proof)

    def test_empty_used_material_still_fails(self):
        image = Image.new('RGBA', (128, 64))
        image.putpixel((10, 10), (2, 3, 4, 255))
        with self.assertRaisesRegex(ValueError, 'SHEET_MISSING_MATERIAL'):
            partition(image, dict(grid=[2, 1], materialIds=['a', 'b']))

    def test_candidate_success_still_requires_review(self):
        image = self.image()
        boxes, proof = partition(image, dict(grid=[2, 1], materialIds=['a', 'b']))
        self.assertTrue(proof['candidateExtractionPassed'])
        self.assertEqual('pending-human-review', proof['status'])
        self.assertFalse(proof['humanVisualAcceptance'])
        self.verify_exact(image, proof)

    def test_invalid_grid_and_unsafe_size_fail(self):
        for grid in ([True, 1], [0, 1], [8, 1]):
            with self.assertRaises(ValueError):
                partition(self.image(), dict(grid=grid, materialIds=['a', 'b']))


if __name__ == '__main__':
    unittest.main()
