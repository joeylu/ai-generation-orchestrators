import hashlib
import tempfile
import unittest
from pathlib import Path

from PIL import Image, ImageDraw

from ai_ui_decomposition.common import ContractError
from ai_ui_decomposition.visible_material_geometry import check_visible_material_geometry


def _image(path: Path, size=(100, 40), box=(20, 8, 79, 31)) -> str:
    image = Image.new("RGBA", size, (0, 0, 0, 0))
    ImageDraw.Draw(image).rectangle(box, fill=(255, 255, 255, 255))
    image.save(path)
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _plan(source_sha: str) -> dict:
    return {
        "kind": "ui_visible_material_geometry_v1", "version": "1.0",
        "materialId": "dialog-frame", "sourceSha256": source_sha,
        "alphaThreshold": 1,
        "minimumOccupancy": {"width": 0.5},
        "expectedAlphaBounds": None,
        "imageWorldRect": None,
        "reservedRects": [], "textWorldRects": [],
    }


class VisibleMaterialGeometryTests(unittest.TestCase):
    def test_source_bound_minimum_visible_width_passes(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "material.png"
            source_sha = _image(path)
            report = check_visible_material_geometry(path, _plan(source_sha))
        self.assertEqual(report["status"], "passed")
        self.assertEqual(report["alphaBounds"], [20, 8, 60, 24])
        self.assertFalse(report["human_visual_acceptance"])

    def test_too_narrow_visible_alpha_fails_with_bounded_code(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "material.png"
            source_sha = _image(path, box=(45, 4, 54, 35))
            report = check_visible_material_geometry(path, _plan(source_sha))
        self.assertEqual(report["status"], "failed")
        self.assertIn("VISIBLE_GEOMETRY_OCCUPANCY_TOO_SMALL",
                      [row["code"] for row in report["issues"]])

    def test_expected_alpha_bounds_use_per_axis_pixel_tolerance(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "material.png"
            source_sha = _image(path)
            plan = _plan(source_sha)
            plan["minimumOccupancy"] = None
            plan["expectedAlphaBounds"] = {"rect": [19, 9, 60, 24],
                                           "tolerance": [1, 1, 0, 0]}
            report = check_visible_material_geometry(path, plan)
        self.assertEqual(report["status"], "passed")
        self.assertEqual(report["checks"][0]["code"], "VISIBLE_GEOMETRY_ALPHA_EMPTY")
        self.assertTrue(report["checks"][1]["passed"])

    def test_expected_alpha_bounds_outside_tolerance_fails(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "material.png"
            source_sha = _image(path)
            plan = _plan(source_sha)
            plan["minimumOccupancy"] = None
            plan["expectedAlphaBounds"] = {"rect": [20, 8, 70, 24],
                                           "tolerance": [0, 0, 2, 0]}
            report = check_visible_material_geometry(path, plan)
        self.assertIn("VISIBLE_GEOMETRY_ALPHA_BOUNDS_OUT_OF_TOLERANCE",
                      [row["code"] for row in report["issues"]])

    def test_source_digest_mismatch_is_a_contract_error(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "material.png"
            _image(path)
            with self.assertRaisesRegex(ContractError, "VISIBLE_GEOMETRY_SOURCE_CHANGED"):
                check_visible_material_geometry(path, _plan("0" * 64))

    def test_reserved_source_rect_is_scaled_to_world_and_checks_text_overlap(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "mark.png"
            source_sha = _image(path, size=(20, 20), box=(0, 0, 19, 19))
            plan = _plan(source_sha)
            plan.update(
                minimumOccupancy={"width": 0.9},
                imageWorldRect={"x": 100, "y": 50, "width": 40, "height": 40},
                reservedRects=[{"id": "selected-mark", "rect": [0, 0, 10, 20]}],
                textWorldRects=[{"id": "item-label", "rect": {
                    "x": 115, "y": 58, "width": 30, "height": 16}}],
            )
            report = check_visible_material_geometry(path, plan)
        overlap = next(row for row in report["issues"]
                       if row["code"] == "VISIBLE_GEOMETRY_TEXT_OVERLAPS_RESERVED_RECT")
        self.assertEqual(overlap["reservedBounds"],
                         {"x": 100.0, "y": 50.0, "width": 20.0, "height": 40.0})
        self.assertEqual(overlap["textId"], "item-label")

    def test_reserved_and_text_rectangles_that_only_touch_do_not_overlap(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "mark.png"
            source_sha = _image(path, size=(20, 20), box=(0, 0, 19, 19))
            plan = _plan(source_sha)
            plan.update(
                imageWorldRect={"x": 0, "y": 0, "width": 20, "height": 20},
                reservedRects=[{"id": "selected-mark", "rect": [0, 0, 10, 20]}],
                textWorldRects=[{"id": "item-label", "rect": {
                    "x": 10, "y": 0, "width": 10, "height": 20}}],
            )
            report = check_visible_material_geometry(path, plan)
        self.assertEqual(report["status"], "passed")

    def test_reserved_rect_must_fit_source_canvas(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "mark.png"
            source_sha = _image(path, size=(20, 20), box=(0, 0, 19, 19))
            plan = _plan(source_sha)
            plan.update(
                imageWorldRect={"x": 0, "y": 0, "width": 20, "height": 20},
                reservedRects=[{"id": "selected-mark", "rect": [19, 0, 2, 10]}],
                textWorldRects=[{"id": "item-label", "rect": {
                    "x": 30, "y": 30, "width": 10, "height": 10}}],
            )
            with self.assertRaisesRegex(ContractError,
                                        "VISIBLE_GEOMETRY_RESERVED_RECT_OUT_OF_BOUNDS"):
                check_visible_material_geometry(path, plan)


if __name__ == "__main__":
    unittest.main()
