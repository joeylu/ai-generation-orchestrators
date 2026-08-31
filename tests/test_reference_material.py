from __future__ import annotations

import json
import unittest
from pathlib import Path
from unittest.mock import Mock

import numpy as np
from PIL import Image, ImageDraw

from ai_frame_animation.media.reference_matte import refine_reference_matte
from tests.reference_doubles import foreground_double


CASE = json.loads((Path(__file__).parent / "fixtures/golden/reference-material-cases.json").read_text(encoding="utf-8"))


class ReferenceMaterialTests(unittest.TestCase):
    def test_narrow_white_shoulder_shading_is_never_eroded_through_outline(self):
        source = Image.new("RGBA", (96,96), (*CASE["narrow_cloth_canvas"],255))
        draw = ImageDraw.Draw(source)
        draw.rectangle((30,16,42,78), fill=(*CASE["body_rgb"],255))
        draw.rectangle((33,19,39,75), fill=(*CASE["narrow_cloth_highlight"],255))
        draw.rectangle((33,43,39,49), fill=(*CASE["narrow_cloth_shading"],255))
        for predicted in (247,252,254,255):
            mask = Image.new("L",source.size)
            ImageDraw.Draw(mask).rectangle((30,16,42,78),fill=predicted)
            with self.subTest(predicted=predicted), foreground_double():
                result, _, _ = refine_reference_matte(source,mask)
            for point in ((33,27),(39,27),(36,27),(33,46),(36,46),(36,65)):
                self.assertEqual(result.getpixel(point), (*source.getpixel(point)[:3],predicted))
            self.assertEqual(result.getpixel((28,27)),(0,0,0,0))

    def test_pale_hair_gaps_and_same_colour_costume_follow_semantics_not_rgb(self):
        for colour in CASE["lifted_gap_colours"]:
            source = Image.new("RGBA",(96,96),(*CASE["lifted_gap_canvas"],255))
            draw = ImageDraw.Draw(source)
            draw.rectangle((24,16,72,80),fill=(*CASE["body_rgb"],255))
            draw.rectangle((30,22,34,48),fill=(*colour,255))
            draw.rectangle((60,22,64,48),fill=(*colour,255))
            mask = Image.new("L",source.size)
            ImageDraw.Draw(mask).rectangle((24,16,72,80),fill=255)
            ImageDraw.Draw(mask).rectangle((30,22,34,48),fill=0)
            with self.subTest(colour=colour), foreground_double():
                result, _, _ = refine_reference_matte(source,mask)
            self.assertEqual(result.getpixel((32,34)),(0,0,0,0))
            self.assertEqual(result.getpixel((62,34)),(*colour,255))
            self.assertEqual(result.getpixel((28,34)),(*CASE["body_rgb"],255))

    def test_noisy_rabbit_channel_is_not_refilled_or_flooded_into_cloth(self):
        source = Image.new("RGBA",(128,128),(*CASE["noisy_gap_canvas"],255))
        draw = ImageDraw.Draw(source)
        draw.rectangle((24,16,104,110),fill=(*CASE["body_rgb"],255))
        draw.rectangle((60,16,64,82),fill=(*CASE["noisy_gap_inside"],255))
        draw.rectangle((60,28,64,30),fill=(*CASE["noisy_gap_bridge"],255))
        draw.rectangle((80,44,92,58),fill=(*CASE["noisy_gap_canvas"],255))
        mask = Image.new("L",source.size)
        ImageDraw.Draw(mask).rectangle((24,16,104,110),fill=255)
        ImageDraw.Draw(mask).rectangle((60,16,64,82),fill=0)
        with foreground_double():
            result, _, _ = refine_reference_matte(source,mask)
        for point in ((62,65),(62,29)):
            self.assertEqual(result.getpixel(point),(0,0,0,0))
        self.assertEqual(result.getpixel((86,50)),(*CASE["noisy_gap_canvas"],255))

    def test_off_axis_halo_uses_foreground_estimator_without_alpha_promotion(self):
        for colour in CASE["halo_pixels"]:
            source = Image.new("RGBA",(80,72),(*CASE["halo_canvas"],255))
            mask = Image.new("L",source.size)
            ImageDraw.Draw(source).rectangle((25,12,53,59),fill=(*CASE["body_rgb"],255))
            ImageDraw.Draw(mask).rectangle((25,12,53,59),fill=255)
            ImageDraw.Draw(source).rectangle((22,18,24,40),fill=(*colour,255))
            ImageDraw.Draw(mask).rectangle((22,18,24,40),fill=6)
            estimated = np.asarray(source)[...,:3] / 255.0
            estimated[18:41,22:25] = np.array(CASE["body_rgb"]) / 255.0
            with self.subTest(colour=colour), foreground_double(Mock(return_value=estimated)):
                result, _, _ = refine_reference_matte(source,mask)
            self.assertEqual(result.getpixel((23,26)),(*CASE["body_rgb"],6))
            self.assertEqual(result.getpixel((28,26)),(*CASE["body_rgb"],255))


if __name__ == "__main__":
    unittest.main()
