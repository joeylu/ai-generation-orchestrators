"""Regression fixtures for supplied-alpha routing and owned staging recovery."""
from __future__ import annotations

import contextlib
import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import call, patch

import numpy as np
from PIL import Image, ImageDraw

from ai_image_background_removal.cli import main
from ai_image_background_removal.preparation import (
    _has_foreground_alpha, _has_source_foreground_alpha, inspect_preparation,
    load_preparation, prepare_reference,
)
from ai_image_background_removal.provider_plan import build_plan
from reference_doubles import foreground_double
from test_reference_preparation import EVIDENCE, mask_fixture, source_fixture

CASE = json.loads((Path(__file__).parent / "fixtures/golden/reference-alpha-boundary-cases.json").read_text(encoding="utf-8"))


def edge_fixture() -> Image.Image:
    image = Image.new("RGBA", tuple(CASE["size"]), tuple(CASE["transparent_hidden_rgb"]))
    draw = ImageDraw.Draw(image)
    draw.rectangle(tuple(CASE["edge_subject"]), fill=tuple(CASE["foreground_rgba"]))
    draw.rectangle((40, 30, 60, 50), fill=tuple(CASE["soft_rgba"]))
    draw.rectangle((70, 30, 80, 50), fill=tuple(CASE["transparent_hidden_rgb"]))
    return image


def windows_error(code=32):
    error = PermissionError(13, "fixture-only sharing violation")
    error.winerror = code
    return error


class AlphaBoundaryTests(unittest.TestCase):
    def test_four_edge_rotations_preserve_rgba_without_model_or_estimator(self):
        for turn in range(4):
            image = edge_fixture().rotate(90 * turn, expand=True)
            with self.subTest(turn=turn), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                source = root / "透明 输入.png"
                image.save(source)
                before = source.read_bytes()
                with patch("ai_image_background_removal.preparation.infer_foreground_mask", side_effect=AssertionError("no inference")), patch("ai_image_background_removal.preparation.inspect_matting_runtime", side_effect=AssertionError("no matting")):
                    ready = inspect_preparation(root, source)
                    self.assertEqual(ready["method"], "existing_alpha")
                    self.assertEqual(ready["prepared_quality"], "not_checked")
                    report = prepare_reference(root=root, reference=source, out_dir="prepared")
                self.assertEqual(report["matting"]["alpha_policy"], "preserve_source")
                self.assertIn("source_subject_touches_edge", report["quality"]["warnings"])
                expected = np.array(image)
                expected[expected[..., 3] == 0, :3] = 0
                with Image.open(root / "prepared/cutout.png") as cutout:
                    np.testing.assert_array_equal(np.asarray(cutout), expected)
                self.assertEqual(load_preparation(root, "prepared/preparation.json"), report)
                self.assertEqual(source.read_bytes(), before)

    def test_subject_can_touch_all_four_edges(self):
        image = Image.new("RGBA", (160, 96))
        draw = ImageDraw.Draw(image)
        draw.rectangle((65, 0, 95, 95), fill="white")
        draw.rectangle((0, 35, 159, 65), fill="white")
        self.assertTrue(_has_source_foreground_alpha(image))
        self.assertFalse(_has_foreground_alpha(image))  # fitted-output gate stays strict

    def test_small_holes_and_no_exterior_clear_region_do_not_bypass_segmentation(self):
        images = []
        opaque = Image.new("RGBA", (160, 96), "white")
        images.append(opaque)
        for point in ((0, 0), (80, 48)):
            image = opaque.copy()
            image.putpixel(point, (0, 0, 0, 0))
            images.append(image)
        interior = opaque.copy()
        ImageDraw.Draw(interior).rectangle((30, 20, 90, 70), fill=(0, 0, 0, 0))
        interior.putpixel((0, 0), (0, 0, 0, 0))
        images.extend([interior, Image.new("RGBA", (160, 96), (255,255,255,128)), Image.new("RGBA", (160,96))])
        for index, image in enumerate(images):
            with self.subTest(index=index):
                self.assertFalse(_has_source_foreground_alpha(image))

    def test_alpha_routing_does_not_modify_source_or_promote_soft_pixels(self):
        image = edge_fixture()
        before = image.tobytes()
        self.assertTrue(_has_source_foreground_alpha(image))
        self.assertEqual(image.tobytes(), before)
        self.assertEqual(image.getpixel((45,40))[3], 128)

    def test_clear_margin_control_and_small_exterior_background(self):
        source = edge_fixture()
        bordered = Image.new("RGBA", (162, 98))
        bordered.paste(source, (1,1))
        self.assertTrue(_has_source_foreground_alpha(bordered))
        image = Image.new("RGBA", (160, 96), "white")
        ImageDraw.Draw(image).rectangle((0,0,2,2), fill=(0,0,0,0))
        self.assertFalse(_has_source_foreground_alpha(image))


class PublicationBoundaryTests(unittest.TestCase):
    def prepare(self, root):
        return prepare_reference(root=root, reference="source.png", out_dir="prepared")

    def test_windows_retry_is_bounded_and_does_not_repeat_inference(self):
        native_rename = Path.rename
        for code in (5, 32, 33):
            with self.subTest(winerror=code), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                source_fixture(root)
                attempts = []
                def flaky(source, destination):
                    attempts.append(source)
                    if len(attempts) < 4:
                        raise windows_error(code)
                    return native_rename(source, destination)
                with foreground_double(), patch("ai_image_background_removal.preparation.infer_foreground_mask", return_value=(mask_fixture(), EVIDENCE)) as infer, patch.object(Path, "rename", flaky), patch("ai_image_background_removal.preparation.time.sleep") as sleep:
                    report = self.prepare(root)
                self.assertEqual(len(set(attempts)), 1)
                self.assertEqual(len(attempts), 4)
                self.assertEqual(sleep.call_args_list, [call(.05),call(.15),call(.30)])
                infer.assert_called_once()
                self.assertEqual(load_preparation(root, "prepared/preparation.json"), report)

    def test_permanent_sharing_failure_returns_specific_code_without_partial_output(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source_fixture(root, alpha=True)
            original = (root / "source.png").read_bytes()
            with patch.object(Path, "rename", side_effect=windows_error()) as rename, patch("ai_image_background_removal.preparation.time.sleep") as sleep:
                with self.assertRaisesRegex(ValueError, "^reference_preparation_publish_busy$"):
                    self.prepare(root)
            self.assertEqual(rename.call_count, 4)
            self.assertEqual(sleep.call_count, 3)
            self.assertFalse((root / "prepared").exists())
            self.assertEqual(list(root.glob(".*.preparing")), [])
            self.assertEqual((root / "source.png").read_bytes(), original)

    def test_non_windows_permission_and_other_io_errors_are_not_retried(self):
        for error in (PermissionError(13, "fixture"), OSError(28, "fixture disk full")):
            with self.subTest(error=type(error).__name__), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                source_fixture(root, alpha=True)
                with patch.object(Path, "rename", side_effect=error) as rename, patch("ai_image_background_removal.preparation.time.sleep") as sleep:
                    with self.assertRaisesRegex(ValueError, "^reference_preparation_publish_failed$"):
                        self.prepare(root)
                rename.assert_called_once()
                sleep.assert_not_called()

    def test_destination_created_during_delay_is_never_overwritten(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source_fixture(root, alpha=True)
            def concurrent_publish(_delay):
                (root / "prepared").mkdir()
                (root / "prepared/other-owner.txt").write_text("keep", encoding="utf-8")
            with patch.object(Path, "rename", side_effect=windows_error()) as rename, patch("ai_image_background_removal.preparation.time.sleep", side_effect=concurrent_publish):
                with self.assertRaisesRegex(ValueError, "^reference_preparation_output_exists$"):
                    self.prepare(root)
            rename.assert_called_once()
            self.assertEqual((root / "prepared/other-owner.txt").read_text(), "keep")
            self.assertEqual(list(root.glob(".*.preparing")), [])

    def test_staging_mutation_during_delay_blocks_publication(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source_fixture(root, alpha=True)
            def mutate(_delay):
                staged = next(root.glob(".*.preparing"))
                (staged / "cutout.png").write_bytes(b"changed fixture")
            with patch.object(Path, "rename", side_effect=windows_error()) as rename, patch("ai_image_background_removal.preparation.time.sleep", side_effect=mutate):
                with self.assertRaisesRegex(ValueError, "^reference_preparation_staging_changed$"):
                    self.prepare(root)
            rename.assert_called_once()
            self.assertFalse((root / "prepared").exists())

    def test_replaced_staging_is_not_deleted(self):
        native_rename = Path.rename
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source_fixture(root, alpha=True)
            def replace(_delay):
                staged = next(root.glob(".*.preparing"))
                native_rename(staged, root / "retained-original-stage")
                staged.mkdir()
                (staged / "other-owner.txt").write_text("keep", encoding="utf-8")
            with patch.object(Path, "rename", side_effect=windows_error()), patch("ai_image_background_removal.preparation.time.sleep", side_effect=replace):
                with self.assertRaisesRegex(ValueError, "reference_preparation_staging_changed:staging_cleanup_failed"):
                    self.prepare(root)
            self.assertEqual(next(root.glob(".*.preparing/other-owner.txt")).read_text(), "keep")
            self.assertTrue((root / "retained-original-stage/cutout.png").exists())

    def test_cleanup_failure_keeps_primary_code_and_does_not_claim_success(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source_fixture(root, alpha=True)
            output = io.StringIO()
            error = io.StringIO()
            plan = build_plan(root=root, reference="source.png", out_dir="prepared")
            with patch.object(Path, "rename", side_effect=windows_error()), patch("ai_image_background_removal.preparation.time.sleep"), patch("ai_image_background_removal.preparation.shutil.rmtree", side_effect=PermissionError("fixture")), contextlib.redirect_stdout(output), contextlib.redirect_stderr(error):
                code = main(["prepare", "--root", str(root), "--reference", "source.png", "--out-dir", "prepared", "--confirm-plan-sha256", plan["plan_sha256"]])
            self.assertEqual(code, 2)
            self.assertEqual(output.getvalue(), "")
            self.assertEqual(json.loads(error.getvalue())["code"], "reference_preparation_publish_busy:staging_cleanup_failed")
            self.assertNotIn(str(root), error.getvalue())
            self.assertFalse((root / "prepared").exists())
            self.assertEqual(len(list(root.glob(".*.preparing"))), 1)
