"""Opt-in diagnostic cuts retain faint pixels; no actual compute or services."""
import _bootstrap
import unittest
from unittest.mock import patch
import zipfile

import numpy as np
from PIL import Image, ImageDraw

from ai_ui_layers.sheet_pixels import FAINT_GLOW_SEAM, NEAREST_SEAM, axis_cuts
from ai_ui_layers.extract_sheets import partition_cells
from ai_ui_layers.diagnostic_sheet_partition import partition
from ai_ui_layers import host_delivery as host, host_sheet_fallback as fallback
from ai_ui_layers import composite_review as review, received_diagnostic_delivery as diagnostic
from ai_ui_layers.evaluate import read, save, digest
from ai_ui_layers.host_material_review import files
from ai_ui_layers.viewport_geometry_revision import validate_viewport_archive
import test_host_sheet_fallback as fixtures
from test_composite_review import finish_composite


class FaintGlowSeamTests(unittest.TestCase):
    def image(self, alpha=2):
        image = Image.new('RGBA', (128, 256), (71, 83, 97, 0))
        draw = ImageDraw.Draw(image)
        draw.rectangle((20, 20, 108, 140), fill=(20, 60, 100, 255))
        draw.rectangle((20, 166, 108, 236), fill=(20, 60, 100, 255))
        draw.line((64, 141, 64, 165), fill=(19, 39, 59, alpha))
        return image, dict(grid=[1, 2], materialIds=['a', 'b'])

    def assert_exact(self, image, proof):
        rebuilt = Image.new('RGBA', image.size)
        for box in proof['partitionBoxes']:
            rebuilt.paste(image.crop(box), box[:2])
        self.assertEqual(image.tobytes(), rebuilt.tobytes())
        self.assertEqual(proof['sourceRgbaPixelsSha256'], proof['reconstructedRgbaPixelsSha256'])

    def test_shifted_gap_keeps_faint_rgba_and_avoids_equal_grid_core(self):
        image, row = self.image(7)
        before = image.tobytes()
        with self.assertRaisesRegex(ValueError, 'CONTOUR_TOUCHES'):
            partition_cells(image, row, NEAREST_SEAM)
        boxes, proof = partition_cells(image, row, FAINT_GLOW_SEAM)
        self.assertGreater(boxes[0][3], 140)
        self.assertLess(boxes[0][3], 166)
        self.assertTrue(proof['faintGlowBoundarySplit'])
        self.assertEqual(proof['warnings'], ['SHEET_FAINT_GLOW_SPLIT'])
        self.assertFalse(proof['transparentPartitionProven'])
        self.assertFalse(proof['sourceThresholdApplied'])
        self.assertFalse(proof['alphaThresholdChanged'])
        self.assertFalse(proof['sourceBoundaryRelaxed'])
        self.assertEqual(image.tobytes(), before)
        self.assert_exact(image, proof)

    def test_horizontal_and_four_material_vertical_grid(self):
        image, row = self.image()
        rotated = image.transpose(Image.Transpose.TRANSPOSE)
        _, proof = partition_cells(rotated, dict(grid=[2, 1], materialIds=['a', 'b']), FAINT_GLOW_SEAM)
        self.assertEqual(proof['internalSeams'][0]['axis'], 'x')
        self.assert_exact(rotated, proof)
        image = Image.new('RGBA', (128, 512))
        draw = ImageDraw.Draw(image)
        for index in range(4):
            draw.rectangle((20, index*128+20, 108, index*128+108), fill='white')
        # The real-valued bridge is retained in each corresponding crop.
        a = np.array(image)
        for y in range(20, 493):
            if a[y, 64, 3] == 0:
                a[y, 64] = [19, 39, 59, 2]
        image = Image.fromarray(a)
        boxes, proof = partition_cells(image, dict(grid=[1, 4], materialIds=list('abcd')), FAINT_GLOW_SEAM)
        self.assertEqual(len(boxes), 4)
        self.assertEqual(len(proof['internalSeams']), 3)
        self.assert_exact(image, proof)

    def test_alpha_eight_bridge_remains_blocked(self):
        for alpha in (8, 64, 255):
            with self.subTest(alpha=alpha):
                image, row = self.image(alpha)
                with self.assertRaisesRegex(ValueError, 'CONTOUR_TOUCHES'):
                    partition_cells(image, row, FAINT_GLOW_SEAM)

    def test_every_outer_side_remains_blocked_even_when_faint(self):
        for side in ((0, 30), (127, 30), (30, 0), (30, 255)):
            with self.subTest(side=side):
                image, row = self.image()
                image.putpixel(side, (10, 20, 30, 2))
                with self.assertRaisesRegex(ValueError, 'CONTOUR_TOUCHES'):
                    partition_cells(image, row, FAINT_GLOW_SEAM)

    def test_unused_faint_content_and_missing_core_remain_blocked(self):
        image = Image.new('RGBA', (256, 256))
        draw = ImageDraw.Draw(image)
        for x, y in ((0, 0), (128, 0), (0, 128)):
            draw.rectangle((x+20, y+20, x+108, y+108), fill='white')
        image.putpixel((200, 200), (10, 20, 30, 2))
        with self.assertRaisesRegex(ValueError, 'UNUSED'):
            partition_cells(image, dict(grid=[2, 2], materialIds=list('abc')), FAINT_GLOW_SEAM)
        image, row = self.image()
        a = np.array(image)
        a[166:237, :, 3] = 0
        with self.assertRaisesRegex(ValueError, 'MISSING_MATERIAL'):
            partition_cells(Image.fromarray(a), row, FAINT_GLOW_SEAM)

    def test_equally_ranked_faint_candidates_fail_instead_of_guessing(self):
        alpha = np.full((200, 128), 255, dtype=np.uint8)
        alpha[89:91] = 2
        alpha[109:111] = 2
        with self.assertRaisesRegex(ValueError, 'FAINT_GLOW_SEAM_TIE'):
            axis_cuts(alpha, 2, 0, FAINT_GLOW_SEAM)

    def test_transparent_path_retains_existing_cuts_without_warning(self):
        image, row = self.image(0)
        old_boxes, _ = partition_cells(image, row, NEAREST_SEAM)
        boxes, proof = partition_cells(image, row, FAINT_GLOW_SEAM)
        self.assertEqual(boxes, old_boxes)
        self.assertFalse(proof['faintGlowBoundarySplit'])
        self.assertEqual(proof['warnings'], [])
        self.assertTrue(proof['transparentPartitionProven'])

    def test_diagnostic_evidence_warns_without_claiming_visual_completeness(self):
        image, row = self.image()
        _, old = partition(image, row)
        self.assertFalse(old['candidateExtractionPassed'])
        _, proof = partition(image, row, seam_policy=FAINT_GLOW_SEAM)
        self.assertTrue(proof['candidateExtractionPassed'])
        self.assertEqual(proof['strictExtractionIssue'], 'SHEET_FAINT_GLOW_SPLIT')
        self.assertFalse(proof['humanVisualAcceptance'])
        self.assertFalse(proof['sourceBodyCompletenessObserved'])
        self.assert_exact(image, proof)

    def test_unknown_and_unbound_diagnostic_policies_fail(self):
        image, row = self.image()
        with self.assertRaisesRegex(ValueError, 'SEAM_POLICY'):
            partition(image, row, seam_policy='invented')
        for value in ({'sheetSeamPolicy': 'invented'},
                {'sheetSeamPolicy': FAINT_GLOW_SEAM},
                {'sheetSeamPolicy': FAINT_GLOW_SEAM, 'sheetCompositePolicy': fallback.COMPOSITE_POLICY}):
            with self.assertRaisesRegex(ValueError, 'SEAM_POLICY'):
                diagnostic._seam_policy(value)

    def test_policy_cannot_relax_a_standalone_material_review(self):
        with patch.object(host.host_material_review, 'source', side_effect=AssertionError('No source read')):
            with self.assertRaisesRegex(ValueError, 'DIAGNOSTIC_FINAL_COMPOSITE_ONLY'):
                host.host_material_review.prepare('unused-job', 'a', 'unused-output',
                    material_authors=['fixture-author'], review_registry='unused-registry',
                    sheet_seam_policy=FAINT_GLOW_SEAM)


class FaintGlowHostTests(unittest.TestCase):
    setUp = fixtures.HostSheetFallbackTests.setUp
    prepare = fixtures.HostSheetFallbackTests.prepare
    acquire = fixtures.HostSheetFallbackTests.acquire

    def test_official_host_freezes_policy_keeps_pixels_and_uses_one_final_review(self):
        self.prepare(materialReviewPolicy=review.POLICY, maximumMaterialReviews=1,
                     sheetSeamPolicy=FAINT_GLOW_SEAM)
        receive = host.receive
        modified = []
        def glowing_receive(root, submission, raw, **kwargs):
            with Image.open(raw) as opened:
                if opened.mode == 'RGBA' and max(opened.size) > 160:
                    a = np.array(opened)
                    if opened.width > 160:
                        region = a[80:81, 80:241]
                    else:
                        region = a[80:241, 80:81]
                    region[region[:, :, 3] == 0] = [19, 39, 59, 7]
                    Image.fromarray(a).save(raw)
                    modified.append(True)
            return receive(root, submission, raw, **kwargs)
        with (patch.object(host, 'receive', glowing_receive),
              patch.object(host.host_material_review, 'prepare', side_effect=AssertionError('No individual review')),
              patch.object(host.host_body_observation, 'prepare', side_effect=AssertionError('No body call'))):
            self.acquire(False)
        self.assertTrue(modified)
        current = host.status(self.run)
        self.assertEqual(current['stage'], review.STAGE)
        self.assertEqual(current['perRequestMaterialReviewCalls'], 0)
        self.assertEqual(read(self.run/'diagnostic-contract/diagnostic.json')['sheetSeamPolicy'], FAINT_GLOW_SEAM)
        output = self.run/'diagnostic-output'
        result = read(output/'result.json')
        self.assertEqual(result['excludedUncertainMaterialIds'], [])
        self.assertEqual(result['layerCount'], len(self.plan['materials']))
        self.assertEqual(result['generationCalls'], 0)
        self.assertEqual(result['modelCalls'], 0)
        self.assertTrue(any(w['code'] == 'SHEET_FAINT_GLOW_SPLIT' for w in result['qualityWarnings']))
        before = files(self.run/'images')
        for split in result['sheetPartitions']:
            self.assertTrue(split['candidateExtractionPassed'])
            self.assertTrue(split['rawCellPartitionPixelExact'])
            key = split['requestId']
            raw = self.run/'images/attempts'/key/'raw.png'
            with Image.open(raw) as original:
                rebuilt = Image.new('RGBA', original.size)
                for index, box in enumerate(split['partitionBoxes']):
                    path = output/'source-evidence/cells'/(key+'-cell-'+str(index)+'.png')
                    with Image.open(path) as cell:
                        rebuilt.paste(cell, box[:2])
                        render = output/'source-evidence/render-cells'/path.name
                        with Image.open(render) as guarded:
                            pixels = np.array(cell)
                            actual = np.array(guarded.crop((2, 2, guarded.width-2, guarded.height-2)))
                            self.assertTrue(np.array_equal(pixels[pixels[:, :, 3]>0], actual[pixels[:, :, 3]>0]))
                self.assertEqual(rebuilt.tobytes(), original.tobytes())
            with zipfile.ZipFile(output/'diagnostic-sources.zip') as archive:
                self.assertEqual(archive.read('raw/'+key+'.png'), raw.read_bytes())
        validate_viewport_archive(output/'delivery/viewport-ui-layers.zip')
        # The frozen final review binds the exact assembled artifact and warnings.
        review.verify(self.run)
        finish_composite(self)
        current = host.status(self.run)
        self.assertEqual(current['compositeReviewCalls'], 1)
        self.assertEqual(current['completedCompositeReviewCalls'], 1)
        self.assertEqual(current['perRequestMaterialReviewCalls'], 0)
        self.assertFalse(current['humanVisualAcceptance'])
        self.assertEqual(before, files(self.run/'images'))
        self.assertTrue(any(w['code'] == 'SHEET_FAINT_GLOW_SPLIT'
                            for w in read(self.run/'visual-warning-report.json')['material']))
        before = host._files(self.run)
        host.resume(self.run)
        self.assertEqual(before, host._files(self.run))
        with self.assertRaisesRegex(ValueError, 'NO_NEXT'):
            host.next_request(self.run)
        contract = self.run/'diagnostic-contract/diagnostic.json'
        contract.write_bytes(contract.read_bytes()+b'changed fixture')
        with self.assertRaisesRegex(ValueError, 'CHANGED'):
            host.status(self.run)

    def test_policy_is_rejected_without_warning_final_review_before_output(self):
        for index, change in enumerate(({}, {'visualReviewMode':'warning', 'materialReviewPolicy':review.LEGACY},
                {'visualReviewMode':'warning', 'sheetCompositePolicy':fallback.COMPOSITE_POLICY})):
            config = dict(read(self.config_path), sheetSeamPolicy=FAINT_GLOW_SEAM, **change)
            path = self.base/('glow-invalid-'+str(index)+'.json')
            save(path, config)
            output = self.base/('glow-invalid-'+str(index))
            with self.assertRaisesRegex(ValueError, 'FAINT_GLOW_SEAM_REQUIRES'):
                host.prepare(path, output)
            self.assertFalse(output.exists())


if __name__ == '__main__':
    unittest.main()
