"""Local regression: discarded distant Alpha noise must not shrink an asset."""
import unittest
from PIL import Image
from ai_ui_decomposition.media import contain
from ai_ui_decomposition.common import ContractError


class ContainAlphaNoiseTests(unittest.TestCase):
    def test_distant_subthreshold_noise_has_no_effect_on_fitting(self):
        source = Image.new('RGBA', (400, 200))
        source.paste((190, 60, 30, 255), (50, 80, 350, 120))
        source.putpixel((49, 99), (190, 60, 30, 64))
        expected = contain(source, [150, 20])
        noisy = source.copy()
        noisy.putpixel((0, 0), (255, 255, 255, 1))
        noisy.putpixel((399, 199), (255, 255, 255, 7))
        self.assertEqual(contain(noisy, [150, 20]).tobytes(), expected.tobytes())
        self.assertGreater(expected.getchannel('A').getbbox()[2], 140)

    def test_supported_soft_alpha_is_preserved(self):
        source = Image.new('RGBA', (12, 6), (100, 80, 60, 64))
        self.assertEqual(contain(source, [12, 6]).getchannel('A').getextrema(), (64, 64))

    def test_only_discarded_noise_is_empty(self):
        with self.assertRaisesRegex(ContractError, 'EMPTY_MATERIAL'):
            contain(Image.new('RGBA', (20, 10), (255, 255, 255, 7)), [20, 10])
