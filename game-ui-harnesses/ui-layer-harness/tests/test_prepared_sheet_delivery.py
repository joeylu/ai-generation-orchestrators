"""Regression for native alpha=1 sheet noise; synthetic PNGs, zero compute."""
import _bootstrap
import unittest
from unittest.mock import patch
import zipfile

import numpy as np
from PIL import Image

from ai_ui_layers import host_delivery as host, host_sheet_fallback as fallback
from ai_ui_layers import composite_review as review
from ai_ui_layers.evaluate import read, digest
from ai_ui_layers.host_material_review import files
from ai_ui_layers.sheet_pixels import prepared_image, guarded_cell
from ai_ui_layers.viewport_geometry_revision import validate_viewport_archive
import test_host_sheet_fallback as fixtures


class PreparedSheetDeliveryTests(unittest.TestCase):
    setUp = fixtures.HostSheetFallbackTests.setUp
    prepare = fixtures.HostSheetFallbackTests.prepare
    acquire = fixtures.HostSheetFallbackTests.acquire

    def test_one_composite_receives_every_material_after_faint_noise_preparation(self):
        self.prepare(materialReviewPolicy=review.POLICY, maximumMaterialReviews=1)
        self.assertEqual(read(self.run/'config.json')['sheetCompositePolicy'], fallback.PREPARED_COMPOSITE_POLICY)
        receive = host.receive
        def noisy_receive(root, submission, raw, **kwargs):
            with Image.open(raw) as opened:
                if opened.mode == 'RGBA' and max(opened.size) > 160:
                    a = np.array(opened)
                    # Model PNGs can carry faint noise across seams, at their
                    # outer rim and in unused capacity cells. Only blank pixels
                    # are changed here; solid fixture artwork stays unchanged.
                    blank = a[:, :, 3] == 0
                    noise = np.zeros(blank.shape, dtype=bool)
                    noise[:, ::80] = True
                    noise[::80, :] = True
                    a[blank & noise] = [91, 82, 73, 1]
                    a[blank & ~noise] = [91, 82, 73, 0]
                    Image.fromarray(a).save(raw)
            return receive(root, submission, raw, **kwargs)
        with patch.object(host, 'receive', noisy_receive):
            self.acquire(False)
        self.assertEqual(host.status(self.run)['stage'], review.STAGE)
        self.assertEqual(host.status(self.run)['perRequestMaterialReviewCalls'], 0)
        output = self.run/'diagnostic-output'
        result = read(output/'result.json')
        self.assertEqual(result['excludedUncertainMaterialIds'], [])
        self.assertEqual(result['layerCount'], len(self.plan['materials']))
        before = files(self.run/'images')
        for split in result['sheetPartitions']:
            key = split['requestId']
            self.assertTrue(split['candidateExtractionPassed'])
            self.assertEqual(split['strictExtractionIssue'], None)
            self.assertTrue(split['rawCellPartitionPixelExact'])
            self.assertGreater(split['preparation']['faintAlphaPixels'], 0)
            raw = self.run/'images/attempts'/key/'raw.png'
            self.assertEqual(split['sourceSha256'], digest(raw))
            with Image.open(raw) as original:
                a = np.array(original.convert('RGBA'))
                with Image.open(output/'source-evidence/prepared-sheets'/(key+'.png')) as prepared:
                    b = np.array(prepared)
                self.assertTrue(np.array_equal(a[a[:, :, 3]>1], b[a[:, :, 3]>1]))
                self.assertFalse(b[a[:, :, 3]<=1].any())
                rebuilt = Image.new('RGBA', original.size)
                for i, box in enumerate(split['partitionBoxes']):
                    with Image.open(output/'source-evidence/cells'/(key+'-cell-'+str(i)+'.png')) as cell:
                        rebuilt.paste(cell, box[:2])
                        with Image.open(output/'source-evidence/render-cells'/(key+'-cell-'+str(i)+'.png')) as rendered:
                            crop = np.array(rendered.crop((2, 2, rendered.width-2, rendered.height-2)))
                            original_cell = np.array(cell)
                            self.assertEqual(crop.shape, original_cell.shape)
                            self.assertTrue(np.array_equal(crop[original_cell[:, :, 3]>0], original_cell[original_cell[:, :, 3]>0]))
                self.assertEqual(rebuilt.tobytes(), original.convert('RGBA').tobytes())
            with zipfile.ZipFile(output/'diagnostic-sources.zip') as archive:
                self.assertEqual(archive.read('raw/'+key+'.png'), raw.read_bytes())
                self.assertIn('prepared-sheets/'+key+'.png', archive.namelist())
        self.assertEqual(before, files(self.run/'images'))
        self.assertFalse(result['humanVisualAcceptance'])
        self.assertFalse(result['materialReviewPassed'])
        validate_viewport_archive(output/'delivery/viewport-ui-layers.zip')

    def test_shared_floor_cannot_remove_real_alpha_or_bypass_uncertain_seams(self):
        from ai_ui_layers.diagnostic_sheet_partition import partition
        a = np.zeros((128, 128, 4), dtype=np.uint8)
        a[10:30, 10:30] = [20, 40, 60, 255]
        a[10:30, 90:110] = [20, 40, 60, 255]
        a[90:110, 10:30] = [20, 40, 60, 255]
        a[90, 90] = [12, 34, 56, 2]  # Genuine nonempty unused cell.
        original = Image.fromarray(a)
        prepared, _ = prepared_image(original)
        _, proof = partition(prepared, dict(grid=[2, 2], materialIds=['a', 'b', 'c']))
        self.assertFalse(proof['candidateExtractionPassed'])
        self.assertEqual(proof['strictExtractionIssue'], 'SHEET_UNUSED_CELL_NOT_EMPTY')
        self.assertEqual(prepared.getpixel((90, 90)), (12, 34, 56, 2))
        self.assertEqual(original.tobytes(), a.tobytes())

    def test_glow_alpha_one_is_retained_in_the_guarded_render_source(self):
        a = np.zeros((40, 40, 4), dtype=np.uint8)
        a[:] = [200, 100, 50, 0]
        for i, alpha in enumerate((1, 2, 6, 8, 127, 254, 255)):
            a[0, i] = [123, 87, 231, alpha]
        guarded = np.array(guarded_cell(Image.fromarray(a)))
        self.assertTrue(np.array_equal(guarded[2:42, 2:42][a[:, :, 3]>0], a[a[:, :, 3]>0]))
        self.assertFalse(guarded[:2].any())
        self.assertFalse(guarded[-2:].any())
        self.assertFalse(guarded[:, :2].any())
        self.assertFalse(guarded[:, -2:].any())
        self.assertFalse(guarded[2:42, 2:42][a[:, :, 3]==0].any())

    def test_new_default_keeps_historical_policy_explicit(self):
        for policy in (fallback.COMPOSITE_POLICY, fallback.PREPARED_COMPOSITE_POLICY):
            config = dict(visualReviewMode='warning', sheetCompositePolicy=policy)
            fallback.configure(config)
            self.assertEqual(config['sheetCompositePolicy'], policy)
        from ai_ui_layers.received_diagnostic_delivery import excluded_sheet_materials
        self.assertEqual(excluded_sheet_materials(dict(sheetCompositePolicy=fallback.PREPARED_COMPOSITE_POLICY), ['bad']), {'bad'})


if __name__ == '__main__':
    unittest.main()
