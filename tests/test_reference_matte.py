from __future__ import annotations

import json
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

import numpy as np
from PIL import Image, ImageDraw

from ai_frame_animation.media.reference_matte import inspect_matting_runtime, refine_reference_matte
from tests.reference_doubles import foreground_double


CASE = json.loads((Path(__file__).parent / "fixtures/golden/reference-matte-cases.json").read_text(encoding="utf-8"))


def matte_fixture(background=None):
    """Retain historical failure geometry; known alpha is the model double.

    These tests protect the adapter/compositor, not actual model accuracy.
    Old weak-prediction fields remain in the JSON for negative controls.
    """
    background = np.array(background or CASE["background"], dtype=np.float64)
    truth = Image.new("RGBA", tuple(CASE["size"]))
    draw = ImageDraw.Draw(truth)
    draw.rectangle(CASE["body"], fill=(*CASE["body_rgb"], 255))
    draw.rectangle(CASE["white_detail"], fill=(255, 255, 255, 255))
    draw.rectangle(CASE["weak_armour"], fill=(*CASE["armour_rgb"], 255))
    draw.rectangle(CASE["weak_knee"], fill=(*CASE["armour_rgb"], 255))
    draw.rectangle(CASE["enclosed_hole"], fill=(0, 0, 0, 0))
    for offset, alpha in enumerate(CASE["edge_alpha"]):
        draw.line((19 + offset, 16, 19 + offset, 28), fill=(*CASE["body_rgb"], alpha))
    data = np.asarray(truth).astype(np.float64)
    alpha = data[..., 3:4] / 255
    source = Image.fromarray(np.rint(data[..., :3] * alpha + background * (1 - alpha)).astype(np.uint8)).convert("RGBA")
    ImageDraw.Draw(source).rectangle(CASE["unrelated_object"], fill=(80, 40, 10, 255))
    return source, truth.getchannel("A"), truth


class ReferenceMatteTests(unittest.TestCase):
    def test_white_material_grey_armour_holes_and_all_canvas_colours(self):
        for background in ([255,255,255], [240,210,180], [40,200,100], [138,64,208]):
            with self.subTest(background=background):
                source, mask, truth = matte_fixture(background)
                before = source.tobytes(), mask.tobytes()
                estimator = Mock(return_value=np.asarray(truth)[..., :3] / 255.0)
                with foreground_double(estimator):
                    result, evidence, warnings = refine_reference_matte(source, mask)
                estimator.assert_called_once()
                np.testing.assert_array_equal(estimator.call_args.args[0], np.asarray(source)[..., :3] / 255.0)
                np.testing.assert_array_equal(estimator.call_args.args[1], np.asarray(mask) / 255.0)
                self.assertEqual(result.tobytes(), truth.tobytes())
                self.assertEqual(result.getpixel((35,25)), (255,255,255,255))
                self.assertEqual(result.getpixel((32,42)), (0,0,0,0))
                self.assertEqual(result.getpixel((8,31)), (0,0,0,0))
                self.assertEqual(evidence["alpha_policy"], "preserve_mask")
                self.assertGreater(evidence["decontaminated_pixels"], 0)
                self.assertEqual(warnings, [])
                self.assertEqual((source.tobytes(), mask.tobytes()), before)

    def test_near_opaque_cloth_and_soft_edges_are_not_eroded_or_promoted(self):
        source, mask, _ = matte_fixture()
        for value in (1,6,64,100,128,247,252,254,255):
            with self.subTest(alpha=value):
                ImageDraw.Draw(mask).rectangle(CASE["white_detail"], fill=value)
                with foreground_double():
                    result, _, _ = refine_reference_matte(source, mask)
                self.assertEqual(result.getpixel((35,25)), (255,255,255,value))
                np.testing.assert_array_equal(np.asarray(result)[...,3], np.asarray(mask))

    def test_bad_semantics_are_not_hidden_by_white_deletion_or_old_recovery(self):
        source, mask, _ = matte_fixture()
        ImageDraw.Draw(mask).rectangle(CASE["weak_armour"], fill=CASE["armour_prediction"])
        ImageDraw.Draw(mask).rectangle(CASE["enclosed_hole"], fill=255)
        with foreground_double():
            result, evidence, _ = refine_reference_matte(source, mask)
        self.assertEqual(result.getpixel((32,42)), (255,255,255,255))
        self.assertEqual(result.getpixel((57,38))[3], CASE["armour_prediction"])
        self.assertNotIn("restored_pixels", evidence)
        self.assertNotIn("background_points", evidence)

    def test_source_alpha_is_not_increased_and_hidden_rgb_is_zero(self):
        source, mask, _ = matte_fixture()
        source.putalpha(128)
        with foreground_double():
            result, _, _ = refine_reference_matte(source, mask)
        data = np.asarray(result)
        expected = ((np.asarray(mask).astype(np.uint16) * 128 + 127) // 255).astype(np.uint8)
        np.testing.assert_array_equal(data[...,3], expected)
        self.assertTrue(np.all(data[data[...,3] == 0,:3] == 0))

    def test_invalid_or_unresolved_masks_never_invoke_estimator(self):
        source, _, _ = matte_fixture()
        for mask, code in ((Image.new("L",source.size),"foreground_empty"),
                           (Image.new("L",source.size,255),"background_unresolved"),
                           (Image.new("RGB",source.size),"mask_invalid"),
                           (Image.new("L",(3,3)),"mask_invalid")):
            with self.subTest(code=code), foreground_double() as loader:
                with self.assertRaisesRegex(ValueError, code):
                    refine_reference_matte(source,mask)
                loader.assert_not_called()

    def test_invalid_estimator_result_and_solver_error_never_fallback(self):
        source, mask, _ = matte_fixture()
        for invalid in (np.zeros((3,3)), np.full((*mask.size[::-1],3),np.nan), np.zeros((*mask.size[::-1],3),dtype=np.uint8)):
            with foreground_double(Mock(return_value=invalid)), self.assertRaisesRegex(ValueError,"decontamination_invalid"):
                refine_reference_matte(source,mask)
        estimator = Mock(side_effect=RuntimeError("private path must not be surfaced"))
        with foreground_double(estimator), self.assertRaisesRegex(ValueError,"^reference_decontamination_failed$"):
            refine_reference_matte(source,mask)
        estimator.assert_called_once()

    def test_readiness_is_static_and_missing_runtime_is_setup_issue(self):
        with patch("ai_frame_animation.media.reference_matte.importlib.util.find_spec",return_value=None), self.assertRaisesRegex(ValueError,"runtime_missing"):
            inspect_matting_runtime()
        with patch("ai_frame_animation.media.reference_matte.importlib.util.find_spec",return_value=object()), patch("ai_frame_animation.media.reference_matte.load_foreground_estimator") as loader:
            inspect_matting_runtime()
            loader.assert_not_called()


if __name__ == "__main__":
    unittest.main()
