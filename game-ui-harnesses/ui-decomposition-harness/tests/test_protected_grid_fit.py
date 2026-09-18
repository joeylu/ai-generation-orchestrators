import copy
import hashlib
import unittest

import numpy as np
from PIL import Image, ImageDraw

from ai_ui_decomposition.common import ContractError
from ai_ui_decomposition.frame_fit import fit_frame, validate_frames
from ai_ui_decomposition.media import normalize


class ProtectedGridFitTests(unittest.TestCase):
    def setUp(self):
        self.source = self._source()
        self.spec = self._spec(self.source)

    @staticmethod
    def _source():
        image = Image.new("RGBA", (24, 16), (0, 0, 0, 0))
        draw = ImageDraw.Draw(image)
        # Distinct cell fills make accidental cross-band sampling visible.
        colors = [
            (230, 40, 40, 255), (220, 120, 30, 255), (210, 200, 30, 255),
            (40, 170, 70, 255), (35, 80, 220, 255),
        ]
        source_x = [0, 2, 8, 10, 18, 24]
        source_y = [0, 2, 6, 10, 14, 16]
        for row in range(5):
            for column in range(5):
                color = colors[(column + row) % len(colors)]
                draw.rectangle((source_x[column], source_y[row],
                                source_x[column + 1] - 1,
                                source_y[row + 1] - 1), fill=color)
        # Include transparent pixels with nonzero source RGB before normalize;
        # this exercises the required zero-RGB invariant in the result.
        image.putpixel((23, 15), (250, 1, 2, 0))
        return normalize(image)

    @staticmethod
    def _spec(source):
        return {
            "version": "1.2",
            "role": "row-frame",
            "supportSha256": hashlib.sha256(source.tobytes()).hexdigest(),
            "supportSize": list(source.size),
            "resize": {
                "mode": "protected_grid",
                "scale": [1, 2],
                "sourceX": [0, 2, 8, 10, 18, 24],
                "sourceY": [0, 2, 6, 10, 14, 16],
                "targetX": [0, 1, 7, 8, 12, 15],
                "targetY": [0, 1, 3, 5, 9, 10],
                "markCell": [2, 2],
                "dividerColumn": 3,
            },
            "evidence": "Measured corners, mark cell and divider on this support.",
        }

    @staticmethod
    def _board():
        return {
            "extraction_policy": {"version": "1.1"},
            "slots": [{"asset_id": "row", "target_size": [19, 14]}],
        }

    def test_uniform_scaled_corners_mark_and_alpha_padding(self):
        output, record = fit_frame(self.source, [19, 14], 2, self.spec)
        scaled = self.source.resize((12, 8), Image.Resampling.LANCZOS)
        target_x = self.spec["resize"]["targetX"]
        target_y = self.spec["resize"]["targetY"]
        source_x = [0, 1, 4, 5, 9, 12]
        source_y = [0, 1, 3, 5, 7, 8]
        protected = {(0, 0), (4, 0), (0, 4), (4, 4), (2, 2)}
        for column, row in protected:
            expected = scaled.crop((source_x[column], source_y[row],
                                    source_x[column + 1], source_y[row + 1]))
            actual = output.crop((2 + target_x[column], 2 + target_y[row],
                                  2 + target_x[column + 1],
                                  2 + target_y[row + 1]))
            self.assertEqual(actual.size, expected.size)
            self.assertEqual(actual.tobytes(), expected.tobytes())
        self.assertEqual(output.getpixel((0, 0)), (0, 0, 0, 0))
        pixels = np.asarray(output)
        self.assertTrue((pixels[pixels[:, :, 3] == 0, :3] == 0).all())
        self.assertEqual(record["uniform_scale"], [1, 2])
        self.assertEqual(record["grid_evidence"]["scaledSize"], [12, 8])
        self.assertFalse(record["human_visual_acceptance"])

    def test_divider_column_keeps_scaled_width_for_every_row(self):
        output, _ = fit_frame(self.source, [19, 14], 2, self.spec)
        scaled = self.source.resize((12, 8), Image.Resampling.LANCZOS)
        # Divider is column 3: scaled x=5..9, target x=8..12.
        for row in range(5):
            expected = scaled.crop((5, [0, 1, 3, 5, 7, 8][row],
                                    9, [0, 1, 3, 5, 7, 8][row + 1]))
            actual = output.crop((10, 2 + [0, 1, 3, 5, 9, 10][row],
                                  14, 2 + [0, 1, 3, 5, 9, 10][row + 1]))
            self.assertEqual(actual.width, expected.width)
            self.assertEqual(actual.size[0], 4)

    def test_static_validation_schema_and_geometry_rejects(self):
        validate_frames({"row": self.spec}, self._board())
        cases = []
        cases.append(("unknown resize field", lambda s: s["resize"].update(extra=1)))
        cases.append(("bad role", lambda s: s.update(role="empty-frame")))
        cases.append(("bool scale", lambda s: s["resize"].update(scale=[True, 2])))
        cases.append(("scale up", lambda s: s["resize"].update(scale=[3, 2])))
        cases.append(("source bounds", lambda s: s["resize"].update(sourceX=[0, 2, 8, 10, 18, 23])))
        cases.append(("target order", lambda s: s["resize"].update(targetX=[0, 1, 7, 6, 12, 15])))
        cases.append(("mark edge", lambda s: s["resize"].update(markCell=[0, 2])))
        cases.append(("same divider", lambda s: s["resize"].update(dividerColumn=2)))
        for name, mutate in cases:
            with self.subTest(name=name):
                bad = copy.deepcopy(self.spec)
                mutate(bad)
                with self.assertRaises(ContractError):
                    validate_frames({"row": bad}, self._board())

    def test_fit_rejects_collapsed_source_grid_support_and_target(self):
        bad = copy.deepcopy(self.spec)
        bad["resize"]["sourceX"] = [0, 1, 2, 3, 4, 24]
        bad["resize"]["scale"] = [1, 10]
        with self.assertRaisesRegex(ContractError, "COLLAPSE"):
            fit_frame(self.source, [19, 14], 2, bad)

        bad = copy.deepcopy(self.spec)
        bad["supportSha256"] = "0" * 64
        with self.assertRaisesRegex(ContractError, "SUPPORT_CHANGED"):
            fit_frame(self.source, [19, 14], 2, bad)

        bad = copy.deepcopy(self.spec)
        bad["resize"]["targetX"][-1] = 19
        with self.assertRaisesRegex(ContractError, "TARGET_TOO_SMALL|GRID_BOUNDS"):
            fit_frame(self.source, [19, 14], 2, bad)

        with self.assertRaisesRegex(ContractError, "TARGET_TOO_SMALL"):
            fit_frame(self.source, [8, 8], 2, self.spec)

    def test_protected_cell_and_divider_distortion_reject(self):
        bad = copy.deepcopy(self.spec)
        bad["resize"]["targetX"][3] += 1
        with self.assertRaisesRegex(ContractError, "PROTECTED_CELL|DIVIDER"):
            fit_frame(self.source, [19, 14], 2, bad)

        bad = copy.deepcopy(self.spec)
        bad["resize"]["targetY"][3] += 1
        with self.assertRaisesRegex(ContractError, "PROTECTED_CELL"):
            fit_frame(self.source, [19, 14], 2, bad)


if __name__ == "__main__":
    unittest.main()
