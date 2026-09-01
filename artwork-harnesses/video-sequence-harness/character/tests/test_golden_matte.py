from __future__ import annotations

import json
import unittest
from pathlib import Path

from PIL import Image

from ai_frame_animation.media.matte import calibrate_key_color, color_key_to_rgba, parse_hex_color
from ai_frame_animation.media.spill import cleanup_key_spill


FIXTURE = Path(__file__).parent / "fixtures" / "golden" / "matte-cases.json"


def image_from_case(case: dict) -> Image.Image:
    image = Image.new("RGB", (case["width"], case["height"]))
    image.putdata([tuple(int(value[index : index + 2], 16) for index in (0, 2, 4)) for row in case["rows"] for value in row])
    return image


def process_case(case: dict) -> Image.Image:
    source = image_from_case(case)
    observed, _calibration = calibrate_key_color([source], case["declared_key"], allow_topology_drift=True)
    rgba, evidence = color_key_to_rgba(source, key_color=observed, tolerance=24, softness=18)
    cleaned, spill = cleanup_key_spill(rgba, key_color=observed)
    assert evidence["background_policy"] == "global_safe_key"
    assert spill["transparent_nonzero_rgb_pixels"] == 0
    return cleaned


class GoldenMatteTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.fixture = json.loads(FIXTURE.read_text(encoding="utf-8"))

    def test_all_labelled_golden_expectations(self) -> None:
        for case in self.fixture["cases"]:
            with self.subTest(case=case["id"]):
                output = process_case(case)
                pixels = output.load()
                for x, y in case.get("expect_transparent", []):
                    self.assertEqual(pixels[x, y][3], 0)
                    self.assertEqual(pixels[x, y][:3], (0, 0, 0))
                for x, y in case.get("expect_opaque", []):
                    self.assertEqual(pixels[x, y][3], 255)
                for x, y in case.get("expect_soft_alpha", []):
                    self.assertGreater(pixels[x, y][3], 0)
                    self.assertLess(pixels[x, y][3], 255)
                    self.assertLessEqual(pixels[x, y][1], max(pixels[x, y][0], pixels[x, y][2]))

    def test_enclosed_key_is_removed_globally(self) -> None:
        case = next(item for item in self.fixture["cases"] if item["id"] == "enclosed-key-hole")
        output = process_case(case)
        self.assertEqual(output.getpixel((3, 3)), (0, 0, 0, 0))

    def test_dynamic_frames_calibrate_independently(self) -> None:
        cases = [item for item in self.fixture["cases"] if item["id"].startswith("dynamic-background")]
        outputs = [process_case(case) for case in cases]
        self.assertTrue(all(output.getpixel((0, 0))[3] == 0 for output in outputs))
        self.assertTrue(all(output.getpixel((1, 1))[3] == 255 for output in outputs))


if __name__ == "__main__":
    unittest.main()
