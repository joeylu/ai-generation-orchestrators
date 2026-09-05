import json
import tempfile
import unittest
from fractions import Fraction
from pathlib import Path

from PIL import Image, ImageDraw

from ai_frame_animation.media.gif import binary_transparency_frame
from ai_frame_animation.media.timeline import build_source_timeline, choose_atlas_indices
from ai_frame_animation.processing import _rgba_frame
from ai_frame_animation.validation import _validate_gif

CASES = json.loads((Path(__file__).parent / "fixtures/golden/runtime-feedback-cases.json").read_text())


class RuntimeFeedbackTests(unittest.TestCase):
    def test_native_alpha_preserves_visible_rgb_and_clears_hidden_rgb(self):
        case = CASES["native_alpha"]
        source = Image.new("RGBA", (case["size"], case["size"]), (1, 2, 3, 0))
        ImageDraw.Draw(source).rectangle(case["subject_box"], fill=tuple(case["rgba"]))
        result, evidence = _rgba_frame(source, tuple(case["key"]))
        self.assertEqual(result.getpixel((8, 8)), tuple(case["rgba"]))
        self.assertEqual(result.getpixel((0, 0)), (0, 0, 0, 0))
        self.assertEqual(evidence["spill"]["reason"], "native_alpha")

    def test_invalid_observed_timestamps_never_fall_back(self):
        for values in [CASES["invalid_pts"], ["0", "0", "1"], ["0", "1"]]:
            with self.subTest(values=values), self.assertRaisesRegex(ValueError, "probe_frame_timestamps_invalid"):
                build_source_timeline({"streams": [{"avg_frame_rate": "24/1"}],
                    "frames": [{"pts_time": p} for p in values]}, decoded_frame_count=3, continuity="one_shot")

    def test_observed_duration_and_fps_keep_rational_nonzero_origin(self):
        result = build_source_timeline({"streams": [{"avg_frame_rate": "0/0", "r_frame_rate": "0/0"}],
            "frames": [{"pts_time": "10"}, {"pts_time": "21/2"}, {"pts_time": "23/2", "duration_time": "1/4"}]},
            decoded_frame_count=3, continuity="one_shot")
        self.assertEqual(result["raw_duration_seconds"]["numerator"], 7)
        self.assertEqual(result["raw_duration_seconds"]["denominator"], 4)
        self.assertEqual(result["raw_fps"]["numerator"], 4)
        self.assertEqual(result["raw_fps"]["denominator"], 3)

    def test_vfr_selection_is_unique_and_respects_endpoints(self):
        pts = list(map(Fraction, CASES["vfr"]["timestamps"]))
        for continuity in ("loop", "one_shot"):
            end = len(pts) - (continuity == "loop")
            indices = choose_atlas_indices(0, end, 16, continuity=continuity, timestamps=pts)
            self.assertEqual(indices, sorted(set(indices)))
            self.assertEqual(len(indices), 16)
            self.assertEqual(indices[0], 0)
            self.assertLess(indices[-1], end)
            if continuity == "one_shot": self.assertEqual(indices[-1], end - 1)
            self.assertNotEqual(indices, choose_atlas_indices(0, end, 16, continuity=continuity))

    def test_missing_duration_uses_observed_intervals_and_bad_durations_fail(self):
        probe = {"streams": [{"avg_frame_rate": "24/1"}],
                 "frames": [{"pts_time": "0"}, {"pts_time": "1/10"}, {"pts_time": "3/10"}]}
        timeline = build_source_timeline(probe, decoded_frame_count=3, continuity="one_shot")
        self.assertEqual(timeline["raw_duration_seconds"]["numerator"], 1)
        self.assertEqual(timeline["raw_duration_seconds"]["denominator"], 2)
        for value in ("-1", "invalid", False):
            probe["frames"][0]["duration_time"] = value
            with self.assertRaisesRegex(ValueError, "probe_frame_duration_invalid"):
                build_source_timeline(probe, decoded_frame_count=3, continuity="one_shot")

    def test_gif_rejects_reordering_and_offsetting_frame_delays(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            case = CASES["gif"]
            images, paths = [], []
            for index, color in enumerate(case["colors"]):
                frame = Image.new("RGBA", (case["size"], case["size"]))
                frame.putpixel((3, 3), tuple(color))
                dest = root / f"{index}.png"; frame.save(dest); paths.append(dest)
                images.append(binary_transparency_frame(frame))
            for order, durations, error in [([1, 0], [100, 100], "inventory"), ([0, 1], [90, 110], "visual_timing")]:
                gif = root / "preview.gif"
                images[order[0]].save(gif, save_all=True, append_images=[images[order[1]]], duration=durations,
                    transparency=255, disposal=2, optimize=False)
                with self.assertRaisesRegex(ValueError, error):
                    _validate_gif(gif, 2, Fraction(10), expected_images=paths)

    def test_identical_gif_frames_can_coalesce_without_losing_content(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            frame = Image.new("RGBA", (8, 8)); frame.putpixel((3, 3), (255, 0, 0, 255))
            png = root / "frame.png"; frame.save(png)
            gif = root / "preview.gif"
            binary_transparency_frame(frame).save(gif, duration=200, transparency=255)
            _validate_gif(gif, 2, Fraction(10), expected_images=[png, png])
