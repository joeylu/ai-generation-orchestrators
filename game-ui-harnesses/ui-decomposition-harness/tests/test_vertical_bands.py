import unittest

from PIL import Image

from ai_ui_decomposition.common import ContractError
from ai_ui_decomposition.vertical_bands import vertical_bands


def _fixture() -> Image.Image:
    image = Image.new("RGBA", (4, 6))
    for y in range(image.height):
        for x in range(image.width):
            image.putpixel((x, y), (20 + y, 40 + x, 80 + y, 32 + y * 32))
    return image


def _bands() -> list[dict]:
    return [
        {"source": [0, 2], "target": [0, 2], "mode": "copy"},
        {"source": [2, 4], "target": [2, 6], "mode": "stretch"},
        {"source": [4, 6], "target": [6, 8], "mode": "copy"},
    ]


class VerticalBandsTests(unittest.TestCase):
    def test_excessive_output_fails_before_allocation(self):
        with self.assertRaisesRegex(ContractError, "VERTICAL_BANDS_PIXEL_LIMIT"):
            vertical_bands(_fixture(), 20_000_000, [
                {"source": [0, 6], "target": [0, 20_000_000], "mode": "stretch"},
            ])

    def test_protected_pattern_bands_are_byte_identical(self):
        source = _fixture()
        before = source.tobytes()
        result = vertical_bands(source, 8, _bands())

        self.assertEqual(result.mode, "RGBA")
        self.assertEqual(result.size, (4, 8))
        self.assertEqual(result.crop((0, 0, 4, 2)).tobytes(),
                         source.crop((0, 0, 4, 2)).tobytes())
        self.assertEqual(result.crop((0, 6, 4, 8)).tobytes(),
                         source.crop((0, 4, 4, 6)).tobytes())
        self.assertEqual(source.tobytes(), before)

    def test_stretch_preserves_continuous_alpha(self):
        source = _fixture()
        result = vertical_bands(source, 8, _bands())
        alpha = result.getchannel("A")

        self.assertGreater(alpha.getextrema()[1], 0)
        self.assertLess(alpha.getextrema()[0], 255)
        self.assertTrue(any(0 < value < 255 for value in alpha.tobytes()))

    def test_transparent_rgb_is_normalized(self):
        source = Image.new("RGBA", (2, 4), (11, 22, 33, 0))
        source.putpixel((0, 1), (200, 100, 50, 128))
        result = vertical_bands(source, 4, [
            {"source": [0, 2], "target": [0, 2], "mode": "copy"},
            {"source": [2, 4], "target": [2, 4], "mode": "copy"},
        ])

        self.assertEqual(result.getpixel((1, 1)), (0, 0, 0, 0))
        self.assertEqual(result.getpixel((0, 1)), (200, 100, 50, 128))

    def test_source_discontinuity_fails(self):
        bands = _bands()
        bands[1]["source"] = [3, 4]
        with self.assertRaisesRegex(ContractError, "VERTICAL_BANDS_SOURCE_COVERAGE"):
            vertical_bands(_fixture(), 8, bands)

    def test_source_overlap_fails(self):
        bands = _bands()
        bands[1]["source"] = [1, 4]
        with self.assertRaisesRegex(ContractError, "VERTICAL_BANDS_SOURCE_COVERAGE"):
            vertical_bands(_fixture(), 8, bands)

    def test_target_gap_fails(self):
        bands = _bands()
        bands[1]["target"] = [3, 6]
        with self.assertRaisesRegex(ContractError, "VERTICAL_BANDS_TARGET_COVERAGE"):
            vertical_bands(_fixture(), 8, bands)

    def test_target_overlap_fails(self):
        bands = _bands()
        bands[1]["target"] = [1, 6]
        with self.assertRaisesRegex(ContractError, "VERTICAL_BANDS_TARGET_COVERAGE"):
            vertical_bands(_fixture(), 8, bands)

    def test_unknown_mode_fails(self):
        bands = _bands()
        bands[1]["mode"] = "auto"
        with self.assertRaisesRegex(ContractError, "VERTICAL_BANDS_MODE_INVALID"):
            vertical_bands(_fixture(), 8, bands)

    def test_copy_height_mismatch_fails(self):
        bands = _bands()
        bands[2]["target"] = [6, 7]
        with self.assertRaisesRegex(ContractError, "VERTICAL_BANDS_COPY_HEIGHT_MISMATCH"):
            vertical_bands(_fixture(), 7, bands)

    def test_exact_cover_rejects_trailing_source_or_target_gap(self):
        for field, end, code in (
            ("source", 5, "VERTICAL_BANDS_SOURCE_COVERAGE"),
            ("target", 7, "VERTICAL_BANDS_TARGET_COVERAGE"),
        ):
            bands = _bands()
            bands[-1][field][1] = end
            bands[-1]["mode"] = "stretch"
            with self.subTest(field=field):
                with self.assertRaisesRegex(ContractError, code):
                    vertical_bands(_fixture(), 8, bands)


if __name__ == "__main__":
    unittest.main()
