from __future__ import annotations

import copy
import tempfile
import unittest
from fractions import Fraction
from pathlib import Path
from unittest.mock import patch

from PIL import Image, ImageDraw

from ai_frame_animation.canonical import fingerprint, load_json, stamp_document, write_json_atomic
from ai_frame_animation.media.fit import fit_subject_sequence
from ai_frame_animation.processing import _resize_rgba, _write_deterministic_zip, process_video
from ai_frame_animation.validation import _validate_rgba, validate_delivery
from test_process_delivery import make_plan


CASE = load_json(Path(__file__).parent / "fixtures/golden/subject-fit-cases.json")


def subject(index: int) -> Image.Image:
    image = Image.new("RGBA", tuple(CASE["source_size"]))
    draw = ImageDraw.Draw(image)
    draw.rectangle(CASE["body_rect"], fill=(*CASE["body_rgb"], 255))
    draw.rectangle(CASE["white_rect"], fill="white")
    draw.rectangle(CASE["hole_rect"], fill=(0, 0, 0, 0))
    if index == CASE["wide_pose_source_index"]:
        draw.rectangle(CASE["wide_cape_rect"], fill=(160, 40, 40, 255))
    # Independently labelled soft detail outside the main body must be kept.
    image.putpixel((390, 120), (120, 120, 120, 128))
    return image


def bbox(image: Image.Image):
    return image.getchannel("A").point(lambda a: 255 if a >= 128 else 0).getbbox()


class SubjectFitTests(unittest.TestCase):
    def setUp(self) -> None:
        for target in ("subprocess.run", "socket.create_connection", "socket.socket.connect",
                       "ai_frame_animation.cli.load_provider"):
            guard = patch(target, side_effect=AssertionError("offline_fixture_only"))
            mock = guard.start()
            self.addCleanup(mock.assert_not_called)
            self.addCleanup(guard.stop)

    def test_landscape_reproduces_114px_failure_and_fills_subject_instead(self) -> None:
        source = subject(0)
        original = source.tobytes()
        old = bbox(_resize_rgba(source, CASE["delivery_size"]))
        self.assertTrue(CASE["expected_old_height_range"][0] <= old[3] - old[1]
                        <= CASE["expected_old_height_range"][1])
        fitted, fit, _ = fit_subject_sequence([source], size=CASE["delivery_size"])
        actual = bbox(fitted[0])
        self.assertTrue(CASE["expected_new_height_range"][0] <= actual[3] - actual[1]
                        <= CASE["expected_new_height_range"][1])
        self.assertEqual(source.tobytes(), original)
        self.assertEqual(fit["margin_px"], 21)
        self.assertTrue(all(r == g == b == 0 for r, g, b, a in fitted[0].get_flattened_data() if a == 0))

    def test_landscape_portrait_and_square_keep_aspect_and_scale(self) -> None:
        outputs = []
        for dimensions in ((608, 352), (352, 608), (352, 352)):
            image = Image.new("RGBA", dimensions)
            x, y = dimensions[0] // 2, dimensions[1] // 2
            ImageDraw.Draw(image).ellipse((x - 40, y - 40, x + 39, y + 39), fill="white")
            fitted, _, _ = fit_subject_sequence([image], size=128)
            bounds = bbox(fitted[0])
            self.assertLessEqual(abs((bounds[2] - bounds[0]) - (bounds[3] - bounds[1])), 1)
            outputs.append(fitted[0].tobytes())
        self.assertEqual(len(set(outputs)), 1)

    def test_shared_union_retains_extended_pose_without_per_frame_pumping(self) -> None:
        fitted, fit, _ = fit_subject_sequence([subject(0), subject(1), subject(2)], size=256)
        heights = [bbox(frame)[3] - bbox(frame)[1] for frame in fitted]
        self.assertLessEqual(max(heights) - min(heights), 1)
        self.assertEqual(fitted[0].tobytes(), fitted[2].tobytes())
        margin = fit["margin_px"]
        for frame in fitted:
            bounds = frame.getchannel("A").getbbox()
            self.assertTrue(margin <= bounds[0] < bounds[2] <= 256 - margin)
            self.assertTrue(margin <= bounds[1] < bounds[3] <= 256 - margin)
        self.assertLess(fit["aligned_union_bbox"][0], 222)

    def test_alignment_does_not_clip_before_crop_and_soft_alpha_is_not_squared(self) -> None:
        images = []
        for x, y in ((0, 0), (24, 28), (48, 56)):
            image = Image.new("RGBA", (80, 100))
            draw = ImageDraw.Draw(image)
            draw.rectangle((x, y, x + 31, y + 43), fill=(100, 100, 100, 255))
            draw.rectangle((x + 8, y + 8, x + 23, y + 23), fill=(120, 120, 120, 128))
            images.append(image)
        fitted, _, _ = fit_subject_sequence(images, size=128)
        self.assertEqual(len({frame.tobytes() for frame in fitted}), 1)
        self.assertTrue(any(a == 128 and max(abs(v - 120) for v in (r, g, b)) <= 1
                            for r, g, b, a in fitted[0].get_flattened_data()))
        self.assertTrue(all(frame.getpixel((0, 0)) == (0, 0, 0, 0) for frame in fitted))

    def test_empty_mismatched_or_invalid_fit_rejected(self) -> None:
        for images in ([], [Image.new("RGBA", (32, 32))],
                       [Image.new("RGBA", (32, 32)), Image.new("RGBA", (33, 32))]):
            with self.subTest(count=len(images)), self.assertRaises(ValueError):
                fit_subject_sequence(images, size=128)
        for margin in (-1, 0, float("nan"), 0.39):
            with self.subTest(margin=margin), self.assertRaises(ValueError):
                fit_subject_sequence([subject(0)], size=32, margin_fraction=margin)

    def fixture(self, root: Path):
        raw = root / "raw.mp4"
        raw.write_bytes(b"fixture-not-real-media")
        paths = []
        for index in range(CASE["source_frames"]):
            image = subject(index)
            if index == CASE["source_frames"] - 1:
                # Out-of-interval terminal extreme must not shrink a loop.
                ImageDraw.Draw(image).rectangle((0, 150, 607, 170), fill="white")
            path = root / f"source_{index:03d}.png"
            image.save(path)
            paths.append(path)
        probe = {"streams": [{"codec_type": "video", "width": image.width, "height": image.height, "avg_frame_rate": "24/1",
                              "duration_ts": str(len(paths)), "time_base": "1/24"}],
                 "frames": [{"best_effort_timestamp_time": str(Fraction(i, 24))} for i in range(len(paths))]}
        return raw, paths, probe

    def deliver(self, root, raw, paths, probe, out, *, counts=None, quality="strict", continuity="loop"):
        plan = copy.deepcopy(make_plan(frame_counts=counts, include_gif=False, quality=quality))
        plan["delivery"]["size"] = 256
        plan["motion"]["continuity"] = continuity
        plan = stamp_document(plan, "plan_sha256")
        with patch("ai_frame_animation.processing.probe_video", return_value=probe) as probe_call, \
                patch("ai_frame_animation.processing.decode_video_once", return_value=paths) as decode_call:
            family = process_video(root=root, plan=plan, raw_video=raw, out_dir=root / out, key_color="#00FF00")
        probe_call.assert_called_once()
        decode_call.assert_called_once()
        self.assertEqual(validate_delivery(root / out, policy=quality, workspace_root=root)["status"], "passed")
        return family

    def test_variants_and_standalone_request_share_fit_and_identical_common_frames(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            raw, paths, probe = self.fixture(root)
            family_delivery = self.deliver(root, raw, paths, probe, "family")
            single_delivery = self.deliver(root, raw, paths, probe, "single", counts=[16])
            self.assertEqual(family_delivery["semantic_interval"], single_delivery["semantic_interval"])
            native_count = family_delivery["semantic_interval"]["native_frame_count"]
            fits, common = [], {}
            for output, counts in (("family", (16, 32, 64)), ("single", (16,))):
                for count in counts:
                    profile = {16: "4x4", 32: "8x4", 64: "8x8"}[count]
                    directory = root / output / f"atlas-{profile}"
                    manifest = load_json(directory / "manifest.json")
                    fit = manifest["processing"]["subject_fit"]
                    fits.append(fit)
                    self.assertEqual(fit["source_frame_count"], native_count)
                    for index, artifact in zip(manifest["timeline"]["source_frame_index_map"], manifest["artifacts"]["frames"]):
                        data = (directory / artifact["path"]).read_bytes()
                        self.assertEqual(data, common.setdefault(index, data))
            self.assertTrue(all(fit == fits[0] for fit in fits))
            self.assertEqual(raw.read_bytes(), b"fixture-not-real-media")

    def test_one_shot_terminal_is_included_in_common_fit(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            raw, paths, probe = self.fixture(root)
            self.deliver(root, raw, paths, probe, "one-shot", counts=[16], continuity="one_shot")
            fit = load_json(root / "one-shot/atlas-4x4/manifest.json")["processing"]["subject_fit"]
            self.assertEqual(fit["source_frame_count"], 65)
            self.assertGreaterEqual(fit["aligned_union_bbox"][2] - fit["aligned_union_bbox"][0], 608)

    def test_invalid_selected_interval_is_not_hidden_by_atlas_sampling_or_best_effort(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            raw, paths, probe = self.fixture(root)
            for path in paths[:-1]:
                Image.new("RGBA", (608, 352)).save(path)
            for policy in ("strict", "best_effort"):
                with self.subTest(policy=policy), self.assertRaisesRegex(ValueError, "frame_has_no_visible_subject"):
                    self.deliver(root, raw, paths, probe, policy, counts=[16], quality=policy)
                self.assertFalse((root / policy).exists())

    def test_validator_rejects_inconsistent_or_missing_fit_even_with_valid_checksums(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            raw, paths, probe = self.fixture(root)
            self.deliver(root, raw, paths, probe, "delivery", counts=[16, 32])
            delivery = root / "delivery"
            variant_path = delivery / "atlas-8x4/manifest.json"
            original = load_json(variant_path)
            for missing in (False, True):
                altered = copy.deepcopy(original)
                if missing:
                    del altered["processing"]["subject_fit"]
                else:
                    altered["processing"]["subject_fit"]["margin_px"] += 1
                write_json_atomic(variant_path, stamp_document(altered, "manifest_sha256"))
                family = load_json(delivery / "delivery-manifest.json")
                family["variants"][1]["manifest"].update(fingerprint(variant_path, media_type="application/json"))
                write_json_atomic(delivery / "delivery-manifest.json", stamp_document(family, "manifest_sha256"))
                _write_deterministic_zip(delivery, delivery / "delivery.zip")
                with self.subTest(missing=missing), self.assertRaisesRegex(ValueError, "family_subject_fit_mismatch"):
                    validate_delivery(delivery, policy="strict", workspace_root=root)

    def test_validator_checks_pixels_against_fit_margin(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "unsafe.png"
            image = Image.new("RGBA", (128, 128))
            ImageDraw.Draw(image).rectangle((1, 20, 30, 100), fill="white")
            image.save(path)
            with self.assertRaisesRegex(ValueError, "subject_fit_margin_not_preserved"):
                _validate_rgba(path, 128, margin=11)


if __name__ == "__main__":
    unittest.main()
