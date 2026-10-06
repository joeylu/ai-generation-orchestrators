"""Cross-version structural regressions use small deterministic PNG fixtures."""
import _bootstrap
from pathlib import Path
import tempfile
import unittest
from PIL import Image

from ai_ui_layers.evaluate import digest, save
from ai_ui_layers.layer_package import write_package
from ai_ui_layers.viewport_geometry_revision import _wrapper, POLICY
from ai_ui_layers.package_baseline_audit import compare


class BaselineAuditTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.reference = self.root / 'reference.png'
        Image.new('RGB', (32, 24), (35, 45, 55)).save(self.reference)
        viewer = self.root / 'viewer'
        viewer.mkdir()
        (viewer/'viewer.html').write_text('<!doctype html><title>Offline fixture</title>', encoding='utf-8')
        (viewer/'viewer.js').write_text('// Offline fixture', encoding='utf-8')

    def package(self, name, ids, shift=(0, 0), move=0, reference=None):
        folder = self.root / name
        folder.mkdir()
        reference = reference or self.reference
        size = (32 + shift[0], 24 + shift[1])
        with Image.open(reference) as image:
            world = Image.new('RGBA', size)
            world.paste(image.convert('RGBA'), shift)
            world.save(folder / 'world.png')
        layers = []
        sources = {}
        for index, mid in enumerate(ids):
            path = folder / (mid + '.png')
            Image.new('RGBA', (3, 3), (90, 100, 110, 255)).save(path)
            sources[mid] = dict(path=str(path), sha256=digest(path))
            layers.append(dict(id=mid, name=mid, role='foreground',
                path=f'layers/layer-{index+1:03}.png', x=shift[0]+2+move,
                y=shift[1]+2, width=3, height=3, visible=True))
        composition = dict(kind='ui_layer_composition_v1', canvas=dict(width=size[0], height=size[1]),
            coordinates='top-left-pixels', order='array-back-to-front',
            textPolicy='remove-business-text', backgroundMode='scene-only',
            reference='reference.png', preview='preview.png', layers=layers)
        delivery = folder / 'delivery'
        write_package(folder/'world.png', composition, sources, delivery, self.root/'viewer', [])
        (delivery/'original-reference.png').write_bytes(reference.read_bytes())
        save(delivery/'viewport.json', dict(kind='ui_original_viewport_v1', policy=POLICY,
            worldBoundsInOriginalCoordinates=[-shift[0],-shift[1],32,24],
            worldShift=list(shift), originalSize=[32,24], worldSize=list(size),
            worldViewportBox=[shift[0],shift[1],shift[0]+32,shift[1]+24],
            originalReferenceSha256=digest(reference), worldReferenceSha256=digest(folder/'world.png')))
        with Image.open(delivery/'package/preview.png') as image:
            image.crop((shift[0],shift[1],shift[0]+32,shift[1]+24)).save(delivery/'viewport-preview.png')
        _wrapper(delivery)
        return delivery/'viewport-ui-layers.zip'

    def audit(self, old, new):
        return compare(old, digest(old), new, digest(new), self.root/'audit')

    def test_wordmarks_cannot_disappear_unreported_under_same_text_policy(self):
        old = self.package('old', ['plate','title_main_wordmark','title_tagline_wordmark'])
        new = self.package('new', ['plate'])
        result = self.audit(old, new)
        self.assertEqual(result['missingBaselineLayerIds'], ['title_main_wordmark','title_tagline_wordmark'])
        self.assertFalse(result['textPolicyChanged'])
        self.assertFalse(result['candidatePromotionAuthorized'])

    def test_independent_durability_parts_remerged_are_reported(self):
        old = self.package('old', ['plate','detail_durability_icon','detail_durability_meter'])
        new = self.package('new', ['plate','detail_durability'])
        result = self.audit(old, new)
        self.assertEqual(len(result['missingBaselineLayerIds']), 2)
        self.assertEqual(result['addedCandidateLayerIds'], ['detail_durability'])

    def test_world_shift_is_normalized_and_actual_geometry_change_is_reported(self):
        old = self.package('old', ['plate'], (3, 4))
        new = self.package('new', ['plate'], (7, 9))
        result = self.audit(old, new)
        self.assertEqual(result['geometryDifferences'], [])
        self.assertFalse(result['candidateHumanAcceptance'])
        self.assertEqual(result['modelCalls'], 0)
        moved = self.package('moved', ['plate'], (7, 9), move=2)
        result = compare(old, digest(old), moved, digest(moved), self.root/'moved-audit')
        self.assertEqual(result['geometryDifferences'][0]['delta'], [2,0,0,0])

    def test_digest_mismatch_rejected_before_output_without_mutating_inputs(self):
        old = self.package('old', ['plate'])
        new = self.package('new', ['plate'])
        before = old.read_bytes(), new.read_bytes()
        with self.assertRaisesRegex(ValueError, 'IDENTITY_CHANGED'):
            compare(old, '0'*64, new, digest(new), self.root/'bad-audit')
        self.assertFalse((self.root/'bad-audit').exists())
        self.assertEqual(before, (old.read_bytes(), new.read_bytes()))

    def test_different_reference_rejected_before_output(self):
        other = self.root/'other-reference.png'
        Image.new('RGB', (32,24), (65,75,85)).save(other)
        old = self.package('old', ['plate'])
        new = self.package('new', ['plate'], reference=other)
        with self.assertRaisesRegex(ValueError, 'REFERENCE_IDENTITY_MISMATCH'):
            self.audit(old, new)
        self.assertFalse((self.root/'audit').exists())


if __name__ == '__main__':
    unittest.main()
