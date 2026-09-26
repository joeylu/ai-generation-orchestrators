import _bootstrap
import tempfile
import unittest
from pathlib import Path

from PIL import Image, ImageDraw

from ai_ui_layers.adapt_frame import adapt
from ai_ui_layers.adapt_strip import validate_policy
from ai_ui_layers.evaluate import digest


def frame(path, clipped=False):
    image = Image.new('RGBA', (320, 100))
    draw = ImageDraw.Draw(image)
    draw.rectangle((0 if clipped else 10, 10, 309, 89), fill=(190, 150, 90, 255))
    draw.rectangle((12, 12, 307, 87), outline=(40, 25, 10, 255), width=2)
    draw.rectangle((14, 14, 34, 34), fill=(210, 60, 20, 255))
    draw.rectangle((285, 65, 305, 85), fill=(20, 80, 210, 255))
    image.save(path)


class AdaptFrameTests(unittest.TestCase):
    def test_explicit_policy_keeps_end_art_and_binds_derived_bytes(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp);source = root / 'source.png';frame(source)
            before = digest(source)
            result = adapt(source, before, 330, 80, root / 'out')
            self.assertEqual(digest(source), before)
            self.assertEqual(digest(root / 'out/raw.png'), before)
            self.assertEqual(result['targetArtworkSize'], [330, 80])
            self.assertGreater(result['centerScaleX'], 1)
            self.assertFalse(result['humanVisualAcceptance'])
            with Image.open(root / 'out/adapted.png') as output:
                padding = result['outputPadding']
                self.assertEqual(output.size, (330 + 2 * padding, 80 + 2 * padding))
                self.assertEqual(output.getpixel((0, 0)), (0, 0, 0, 0))
                self.assertEqual(output.getpixel((padding + 20, padding + 20))[:3], (210, 60, 20))
                self.assertEqual(output.getpixel((padding + 330 - 25, padding + 80 - 25))[:3], (20, 80, 210))
            self.assertEqual(result['outputSha256'], digest(root / 'out/adapted.png'))
            with self.assertRaises(FileExistsError):
                adapt(source, before, 330, 80, root / 'out')

    def test_source_and_geometry_fail_closed(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp);source = root / 'source.png';frame(source)
            before = digest(source)
            with self.assertRaisesRegex(ValueError, 'SOURCE_CHANGED'):
                adapt(source, 'wrong', 330, 80, root / 'bad')
            with self.assertRaisesRegex(ValueError, 'CENTER_SCALE_EXCESSIVE'):
                adapt(source, before, 500, 80, root / 'bad')
            with self.assertRaisesRegex(ValueError, 'TARGET_SIZE'):
                adapt(source, before, 120, 80, root / 'bad')
            with self.assertRaisesRegex(ValueError, 'POLICY'):
                adapt(source, before, 330, 80, root / 'bad', 'simple-strip')
            self.assertFalse((root / 'bad').exists())
            frame(source, clipped=True)
            with self.assertRaisesRegex(ValueError, 'SOURCE_CONTOUR_TOUCHES'):
                adapt(source, digest(source), 330, 80, root / 'bad')

    def test_faint_alpha_is_preserved_but_does_not_set_frame_geometry(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp);source = root / 'source.png';frame(source)
            with Image.open(source) as image:
                pixels = image.copy()
            pixels.putpixel((10, 5), (80, 50, 20, 2))
            pixels.putpixel((309, 94), (80, 50, 20, 2))
            pixels.save(source)
            result = adapt(source, digest(source), 330, 80, root / 'out')
            self.assertEqual(result['sourceBox'], [10, 5, 310, 95])
            self.assertEqual(result['visibleSourceBox'], [10, 10, 310, 90])
            self.assertLess(result['centerScaleX'], 1.2)
            with Image.open(root / 'out/prepared.png') as prepared:
                self.assertEqual(prepared.getpixel((10, 5))[3], 2)

    def test_only_reviewed_plain_center_card_or_panel_is_eligible(self):
        material = dict(id='row', role='foreground', preserveText=[],bboxNorm=[.1,.1,.9,.3],
                        adaptationPolicy='horizontal-frame-slice')
        visual = dict(objects=[dict(materialId='row', kind='card')])
        validate_policy(visual, material, [330, 80])
        visual['objects'][0]['kind'] = 'panel'
        validate_policy(visual, material, [330, 80])
        visual['objects'][0]['kind'] = 'icon'
        with self.assertRaisesRegex(ValueError, 'INELIGIBLE_HORIZONTAL_FRAME'):
            validate_policy(visual, material, [330, 80])
        visual['objects'][0]['kind'] = 'card'
        with self.assertRaisesRegex(ValueError, 'INELIGIBLE_HORIZONTAL_FRAME'):
            validate_policy(visual, material, [120, 80])
        visual['objects'].append(dict(materialId='row', kind='decoration',bboxNorm=[.1,.1,.15,.2]))
        validate_policy(visual, material, [330, 80])
        visual['objects'][-1]['bboxNorm']=[.4,.1,.5,.2]
        with self.assertRaisesRegex(ValueError, 'INELIGIBLE_HORIZONTAL_FRAME'):
            validate_policy(visual, material, [330, 80])
