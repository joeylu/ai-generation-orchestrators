"""Local fixtures for explicit support geometry; no provider access."""
from pathlib import Path
import sys
import unittest

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from ai_ui_decomposition.common import ContractError
from ai_ui_decomposition.contract import validate
from ai_ui_decomposition.media import require_long_control_geometry


class ForegroundSupportTests(unittest.TestCase):
    def support(self):
        return {"insets": [0, 2, 0, 2], "basis": "reference-derived",
                "note": "Reference fill height is 14 pixels within an 18 pixel canvas."}

    def plan(self):
        return {"kind": "ai_ui_decomposition_plan_v1", "id": "support-fixture",
                "canvas": [300, 100], "source": {"path": "reference.png", "sha256": "0" * 64,
                "size": [300, 100]}, "text_policy": "remove_ordinary_text_preserve_graphic_symbols",
                "granularity": "important_components_only", "assets": [
                    {"id": "scene", "role": "background", "route": "source_crop",
                     "source_region": [0, 0, 300, 100], "output_size": [300, 100],
                     "output_mode": "opaque_canvas", "prompt": None, "source_asset": None},
                    {"id": "fill", "role": "important_component", "route": "generated_isolation",
                     "source_region": [0, 0, 278, 18], "output_size": [278, 18],
                     "output_mode": "keyed_component", "prompt": "Isolate fill", "source_asset": None,
                     "foreground_support": self.support()}],
                "nodes": [{"id": "background", "asset": "scene", "xy": [0, 0]},
                          {"id": "bar", "asset": "fill", "xy": [0, 0]}],
                "groups": [{"id": "all", "children": ["background", "bar"]}],
                "document": {"name": "fixture", "format": "png_zip"}}

    def picture(self, height):
        image = Image.new("RGBA", (278, 18))
        image.paste((240, 90, 80, 255), (0, 1, 278, height + 1))
        return image

    def test_observed_margins_pass_without_changing_pixels(self):
        picture = self.picture(15)
        before = picture.tobytes()
        require_long_control_geometry(picture, [278, 18], self.support())
        self.assertEqual(before, picture.tobytes())

    def test_old_default_still_rejects_same_support(self):
        with self.assertRaisesRegex(ContractError, "LONG_CONTROL_SUPPORT_ASPECT_MISMATCH"):
            require_long_control_geometry(self.picture(15), [278, 18])

    def test_actual_overthin_fill_still_fails(self):
        with self.assertRaisesRegex(ContractError, "VISIBLE_SUPPORT_SIZE_MISMATCH"):
            require_long_control_geometry(self.picture(10), [278, 18], self.support())

    def test_valid_support_contract(self):
        validate(self.plan(), verify_source=False)

    def test_invalid_support_contract(self):
        cases = [({}, "FIELDS"), ({"insets": [0, 2.0, 0, 2]}, "INSETS"),
                 ({"insets": [0, True, 0, 2]}, "INSETS"),
                 ({"insets": [0, -1, 0, 2]}, "INSETS"),
                 ({"insets": [0, 9, 0, 9]}, "INSETS"),
                 ({"basis": "guessed"}, "EVIDENCE"), ({"basis": []}, "EVIDENCE"),
                 ({"note": " "}, "EVIDENCE")]
        for changes, code in cases:
            with self.subTest(changes=changes):
                plan = self.plan()
                support = {} if not changes else {**self.support(), **changes}
                plan["assets"][1]["foreground_support"] = support
                with self.assertRaisesRegex(ContractError, "FOREGROUND_SUPPORT_" + code):
                    validate(plan, verify_source=False)


if __name__ == "__main__":
    unittest.main()
