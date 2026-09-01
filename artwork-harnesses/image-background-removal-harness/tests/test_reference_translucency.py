"""Synthetic alpha contracts, not evidence of real model/matting accuracy."""
from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

import numpy as np
from PIL import Image

from ai_image_background_removal.media.reference_matte import refine_reference_matte
from ai_image_background_removal.preparation import load_preparation, prepare_reference
from reference_doubles import foreground_double


CASE = json.loads((Path(__file__).parent / "fixtures/golden/reference-translucency-cases.json").read_text(encoding="utf-8"))


def rectangle(array, bounds, value):
    x0, y0, x1, y1 = bounds
    array[y0:y1, x0:x1] = value


def translucency_fixture():
    width, height = CASE["size"]
    truth = np.zeros((height, width, 4), dtype=np.uint8)
    for item in CASE["cloth_rectangles_xyxy_half_open"]:
        rectangle(truth, item["rect"], (*CASE["cloth_rgb"], item["alpha"]))
    rectangle(truth, CASE["opaque_body_rect"], (*CASE["opaque_body_rgb"], 255))
    rectangle(truth, CASE["white_cloth_rect"], (*CASE["white_cloth_rgb"], 255))
    rectangle(truth, CASE["enclosed_hole_rect"], (0,0,0,0))
    rectangle(truth, CASE["hair_rect"], (*CASE["hair_rgb"], CASE["hair_alpha"]))
    background = np.zeros((height, width, 3), dtype=np.float64)
    background[:] = CASE["background_a"]
    background[:, (np.arange(width) // 16) % 2 == 1] = CASE["background_b"]
    alpha = truth[..., 3:4] / 255.0
    composite = np.rint(truth[..., :3]*alpha + background*(1-alpha)).astype(np.uint8)
    return Image.fromarray(truth), Image.fromarray(composite).convert("RGBA"), Image.fromarray(truth[...,3])


class ReferenceTranslucencyTests(unittest.TestCase):
    def test_existing_rgba_preserves_gauze_and_hair_without_any_estimator(self):
        truth, _, _ = translucency_fixture()
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "reference.png"
            truth.save(source)
            original = source.read_bytes()
            with patch("ai_image_background_removal.preparation.infer_foreground_mask", side_effect=AssertionError("segmentation forbidden")) as segmenter, patch(
                "ai_image_background_removal.preparation.refine_reference_matte", side_effect=AssertionError("matting forbidden")
            ) as matte, patch("ai_image_background_removal.preparation.inspect_matting_runtime", side_effect=AssertionError("optional runtime forbidden")):
                report = prepare_reference(root=root, reference="reference.png", out_dir="prepared")
            segmenter.assert_not_called()
            matte.assert_not_called()
            self.assertEqual(report["method"], "existing_alpha")
            self.assertEqual(report["matting"]["alpha_policy"], "preserve_source")
            self.assertEqual(source.read_bytes(), original)
            with Image.open(root / "prepared/cutout.png") as cutout:
                np.testing.assert_array_equal(np.asarray(cutout), np.asarray(truth))
            self.assertTrue(load_preparation(root, "prepared/preparation.json")["quality"]["visual_review_required"])

    def test_known_soft_alpha_and_correct_foreground_recompose_on_new_background(self):
        truth, source, mask = translucency_fixture()
        estimator = Mock(return_value=np.asarray(truth)[...,:3] / 255.0)
        with foreground_double(estimator):
            result, evidence, _ = refine_reference_matte(source, mask)
        np.testing.assert_array_equal(np.asarray(result)[...,3], np.asarray(truth)[...,3])
        self.assertEqual(evidence["alpha_policy"], "preserve_mask")
        for rgb in ((138,64,208), (0,0,0), (255,255,255)):
            actual = np.asarray(Image.alpha_composite(Image.new("RGBA",truth.size,(*rgb,255)),result)).astype(int)
            expected = np.asarray(Image.alpha_composite(Image.new("RGBA",truth.size,(*rgb,255)),truth)).astype(int)
            self.assertLessEqual(int(np.abs(actual-expected).max()),1)
        self.assertEqual(result.getpixel((64,28)),(0,0,0,0))
        self.assertEqual(result.getpixel((30,12))[3],CASE["hair_alpha"])
        self.assertEqual(result.getpixel((26,50))[3],64)
        self.assertEqual(result.getpixel((43,50))[3],128)
        self.assertEqual(result.getpixel((81,50))[3],192)
        self.assertEqual(result.getpixel((100,50))[3],247)

    def test_white_material_prediction_is_not_eroded_or_promoted(self):
        truth, source, mask = translucency_fixture()
        for value in CASE["white_cloth_prediction_values"]:
            with self.subTest(alpha=value):
                revised = np.array(mask)
                rectangle(revised, CASE["white_cloth_rect"], value)
                with foreground_double(Mock(return_value=np.asarray(truth)[...,:3]/255.0)):
                    result, _, _ = refine_reference_matte(source, Image.fromarray(revised))
                self.assertEqual(result.getpixel((64,48)),(255,255,255,value))

    def test_omitted_material_remains_a_visual_review_problem_not_fake_recovery(self):
        truth, source, mask = translucency_fixture()
        erased = np.array(mask)
        for item in CASE["cloth_rectangles_xyxy_half_open"]:
            rectangle(erased,item["rect"],0)
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source.save(root / "reference.png")
            model_evidence = {"backend":"onnx_birefnet","model_sha256":"a"*64,"execution":"local_cpu","runtime_version":"fixture"}
            with patch("ai_image_background_removal.preparation.infer_foreground_mask",return_value=(Image.fromarray(erased),model_evidence)), foreground_double(Mock(return_value=np.asarray(truth)[...,:3]/255.0)):
                report = prepare_reference(root=root,reference="reference.png",out_dir="prepared")
            self.assertTrue(report["quality"]["visual_review_required"])
            with Image.open(root / "prepared/cutout.png") as cutout:
                self.assertEqual(cutout.getpixel((43,50)),(0,0,0,0))
            # Contract test documents the limitation; it does not accept missing cloth.
            self.assertGreater(truth.getpixel((43,50))[3],0)


if __name__ == "__main__":
    unittest.main()
