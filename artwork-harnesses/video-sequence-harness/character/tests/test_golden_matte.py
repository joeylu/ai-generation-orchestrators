from __future__ import annotations

import json
import unittest
from pathlib import Path

from PIL import Image, ImageDraw

from ai_frame_animation.media.matte import (
    aggressive_color_key_cleanup,
    analyze_sequence_background,
    calibrate_key_color,
    color_key_to_rgba,
    parse_hex_color,
    remove_tiny_detached_alpha_components,
)
from ai_frame_animation.media.spill import cleanup_key_spill


FIXTURE = Path(__file__).parent / "fixtures" / "golden" / "matte-cases.json"
SEQUENCE_FIXTURE = Path(__file__).parent / "fixtures" / "golden" / "sequence-matte-cases.json"


def image_from_case(case: dict) -> Image.Image:
    image = Image.new("RGB", (case["width"], case["height"]))
    image.putdata([tuple(int(value[index : index + 2], 16) for index in (0, 2, 4)) for row in case["rows"] for value in row])
    return image


def process_case(case: dict) -> Image.Image:
    source = image_from_case(case)
    observed, _calibration = calibrate_key_color([source], case["declared_key"], allow_topology_drift=True)
    rgba, evidence = color_key_to_rgba(source, key_color=observed, tolerance=24, softness=18)
    cleaned, spill = cleanup_key_spill(rgba, key_color=observed)
    assert evidence["background_policy"] == "edge_connected_key_v3"
    assert spill["transparent_nonzero_rgb_pixels"] == 0
    return cleaned


def key_family_sequence(case: dict, *, foreign_border: bool = False) -> list[Image.Image]:
    frames = []
    size = int(case["size"])
    low, high = case["background_red_range"]
    for frame_index in range(int(case["frame_count"])):
        image = Image.new("RGB", (size, size))
        pixels = image.load()
        phase = frame_index / max(1, int(case["frame_count"]) - 1)
        for y in range(size):
            for x in range(size):
                red = round(low + (high - low) * ((x / max(1, size - 1) + phase) % 1.0))
                pixels[x, y] = (red, frame_index % 5, (x + y) % 7)
        draw = ImageDraw.Draw(image)
        if foreign_border:
            draw.rectangle(case["foreign_border_rect"], fill=tuple(case["foreign_border_rgb"]))
        else:
            draw.rectangle(case["subject_rect"], fill=tuple(case["subject_rgb"]))
            draw.rectangle(case["edge_effect_rect"], fill=tuple(case["edge_effect_rgb"]))
        frames.append(image)
    return frames


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

    def test_real_failure_reproductions(self) -> None:
        fixture = json.loads(SEQUENCE_FIXTURE.read_text(encoding="utf-8"))
        for case in fixture["cases"]:
            with self.subTest(case=case["id"]):
                source = Image.new("RGBA", (case["size"], case["size"]), (*case["primary_key"], 255))
                draw = ImageDraw.Draw(source)
                draw.rectangle(case["body_rect"], fill=(*case["body_rgb"], 255))
                if "hole_rect" in case:
                    draw.rectangle(case["hole_rect"], fill=(*case["hole_rgb"], 255))
                    if "hole_accent_rect" in case:
                        draw.rectangle(case["hole_accent_rect"], fill=(*case["hole_accent_rgb"], 255))
                    draw.rectangle(case["same_family_detail_rect"], fill=(*case["same_family_detail_rgb"], 255))
                conservative, _detail = color_key_to_rgba(
                    source,
                    key_color=tuple(case["primary_key"]),
                    tolerance=24,
                    softness=18,
                )
                if "secondary_key" in case or case.get("aggressive"):
                    output, report = aggressive_color_key_cleanup(
                        conservative,
                        source_image=source,
                        key_color=tuple(case["primary_key"]),
                        key_palette=[
                            tuple(case["primary_key"]),
                            *([tuple(case["secondary_key"])] if "secondary_key" in case else []),
                        ],
                    )
                    self.assertGreater(report["enclosed_palette_pixels_removed"], 0)
                else:
                    output = conservative
                self.assertEqual(output.getpixel(tuple(case["expect_transparent"])), (0, 0, 0, 0))
                preserved = output.getpixel(tuple(case["expect_opaque_preserved"]))
                expected_rgb = tuple(case.get("same_family_detail_rgb", case["body_rgb"]))
                self.assertEqual(preserved, (*expected_rgb, 255))

    def test_low_chroma_detached_noise_fixture(self) -> None:
        fixture = json.loads(SEQUENCE_FIXTURE.read_text(encoding="utf-8"))["detached_noise"]
        image = Image.new("RGBA", (fixture["size"], fixture["size"]), (0, 0, 0, 0))
        draw = ImageDraw.Draw(image)
        draw.rectangle(fixture["subject_rect"], fill=(20, 80, 190, 255))
        draw.rectangle(fixture["tiny_noise_rect"], fill=(245, 245, 245, 255))
        draw.rectangle(fixture["detached_prop_rect"], fill=(40, 220, 240, 255))
        output, report = remove_tiny_detached_alpha_components(image)
        self.assertEqual(output.getpixel(tuple(fixture["expect_noise_transparent"])), (0, 0, 0, 0))
        self.assertEqual(output.getpixel(tuple(fixture["expect_prop_preserved"]))[3], 255)
        self.assertEqual(output.getpixel(tuple(fixture["expect_subject_preserved"]))[3], 255)
        self.assertEqual(report["removed_components"], 1)

    def test_partner_hue_key_spill_is_neutralized(self) -> None:
        case = json.loads(SEQUENCE_FIXTURE.read_text(encoding="utf-8"))["partner_hue_spill"]
        source = Image.new("RGBA", (case["size"], case["size"]), (*case["primary_key"], 255))
        draw = ImageDraw.Draw(source)
        draw.rectangle(case["body_rect"], fill=(*case["body_rgb"], 255))
        draw.rectangle(case["spill_rect"], fill=(*case["spill_rgb"], 255))
        conservative, _detail = color_key_to_rgba(
            source,
            key_color=tuple(case["primary_key"]),
            tolerance=24,
            softness=18,
        )
        output, report = aggressive_color_key_cleanup(
            conservative,
            source_image=source,
            key_color=tuple(case["primary_key"]),
            key_palette=[tuple(case["primary_key"])],
            key_family_safe=True,
        )
        spill = output.getpixel(tuple(case["expect_spill_neutralized"]))
        self.assertLessEqual(spill[1], spill[0])
        self.assertEqual(output.getpixel(tuple(case["expect_body_preserved"])), (*case["body_rgb"], 255))
        self.assertGreater(report["partner_hue_spill_pixels_neutralized"], 0)
        self.assertGreater(report["global_safe_spill_pixels_neutralized"], 0)

    def test_declared_key_family_accepts_luminance_drift_and_preserves_edge_effect(self) -> None:
        case = json.loads(SEQUENCE_FIXTURE.read_text(encoding="utf-8"))["key_family_luminance_drift"]
        frames = key_family_sequence(case)
        without_contract = analyze_sequence_background(frames)
        self.assertEqual(without_contract["route"], "background_unkeyable")

        declared_key = tuple(case["declared_key"])
        analysis = analyze_sequence_background(frames, declared_key=declared_key)
        self.assertEqual(analysis["route"], "per_frame_key_family_drift")
        self.assertGreaterEqual(
            analysis["minimum_border_key_family_ratio"],
            case["minimum_key_family_ratio"],
        )

        observed, _calibration = calibrate_key_color(
            [frames[8]],
            "#FF0000",
            allow_topology_drift=True,
        )
        output, _evidence = color_key_to_rgba(frames[8], key_color=observed, tolerance=24, softness=18)
        self.assertEqual(output.getpixel(tuple(case["expect_background_transparent"]))[3], 0)
        self.assertEqual(output.getpixel(tuple(case["expect_subject_preserved"]))[3], 255)
        self.assertEqual(output.getpixel(tuple(case["expect_edge_effect_preserved"]))[3], 255)

    def test_declared_key_family_rejects_a_genuinely_mixed_border(self) -> None:
        case = json.loads(SEQUENCE_FIXTURE.read_text(encoding="utf-8"))["key_family_unsafe_complex"]
        frames = key_family_sequence(case, foreign_border=True)
        analysis = analyze_sequence_background(frames, declared_key=tuple(case["declared_key"]))
        self.assertEqual(analysis["route"], "background_unkeyable")
        self.assertLessEqual(
            analysis["minimum_border_key_family_ratio"],
            case["maximum_key_family_ratio"],
        )


if __name__ == "__main__":
    unittest.main()
