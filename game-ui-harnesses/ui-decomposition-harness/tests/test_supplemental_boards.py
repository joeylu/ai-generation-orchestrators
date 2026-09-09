from __future__ import annotations

import json
from pathlib import Path
import sys
import tempfile
import unittest
import zipfile

from PIL import Image, ImageDraw

PACKAGE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PACKAGE / "src"))

from ai_ui_decomposition.common import ContractError
from ai_ui_decomposition.supplemental_boards import (
    INTERACTIVE_SLOTS,
    STRUCTURAL_SLOTS,
    split_supplemental_boards,
)


class SupplementalBoardTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)

    def tearDown(self):
        self.temporary.cleanup()

    def board(self, name: str, columns: int, rows: int, count: int, *, dirty_reserved=False) -> Path:
        path = self.root / name
        image = Image.new("RGBA", (columns * 100, rows * 100), (0, 0, 0, 0))
        draw = ImageDraw.Draw(image)
        for index in range(count):
            row, column = divmod(index, columns)
            alpha = 254 if index == 0 else 255
            draw.rounded_rectangle((column * 100 + 20, row * 100 + 25,
                                    column * 100 + 80, row * 100 + 75),
                                   radius=6, fill=(20, 150, 220, alpha))
        if dirty_reserved:
            draw.rectangle((columns * 100 - 20, rows * 100 - 20,
                            columns * 100 - 10, rows * 100 - 10), fill=(255, 0, 0, 255))
        image.save(path)
        return path

    def test_splits_all_roles_and_reproduces_zip(self):
        interactive = self.board("interactive.png", 4, 6, len(INTERACTIVE_SLOTS))
        structural = self.board("structural.png", 4, 3, len(STRUCTURAL_SLOTS))
        first, second = self.root / "first", self.root / "second"
        result = split_supplemental_boards(interactive, structural, first, "ui-roles")
        repeated = split_supplemental_boards(interactive, structural, second, "ui-roles")
        self.assertEqual(result["asset_count"], 35)
        self.assertEqual(result["zip_sha256"], repeated["zip_sha256"])
        manifest = json.loads((first / "manifest.json").read_text(encoding="utf-8"))
        self.assertEqual(len(manifest["assets"]), 35)
        self.assertEqual(manifest["assets"][0]["role"], "track")
        self.assertEqual(manifest["assets"][-1]["role"], "active-tab")
        self.assertGreater(manifest["assets"][0]["near_opaque_pixels_promoted"], 0)
        rows = {row["id"]: row for row in manifest["assets"]}
        self.assertEqual((rows["list_row"]["width"], rows["list_row"]["height"]),
                         (rows["list_selected_row"]["width"], rows["list_selected_row"]["height"]))
        self.assertEqual((rows["tabs_tab"]["width"], rows["tabs_tab"]["height"]),
                         (rows["tabs_active_tab"]["width"], rows["tabs_active_tab"]["height"]))
        with zipfile.ZipFile(first / "ui-roles.supplemental.draft.zip") as archive:
            self.assertIsNone(archive.testzip())
            self.assertEqual(len(archive.namelist()), 36)

    def test_rejects_missing_required_slot(self):
        interactive = self.board("interactive.png", 4, 6, len(INTERACTIVE_SLOTS) - 1)
        structural = self.board("structural.png", 4, 3, len(STRUCTURAL_SLOTS))
        with self.assertRaisesRegex(ContractError, "SUPPLEMENTAL_BOARD_SLOT_EMPTY"):
            split_supplemental_boards(interactive, structural, self.root / "output", "ui-roles")

    def test_rejects_nonempty_reserved_structural_slot(self):
        interactive = self.board("interactive.png", 4, 6, len(INTERACTIVE_SLOTS))
        structural = self.board("structural.png", 4, 3, len(STRUCTURAL_SLOTS), dirty_reserved=True)
        with self.assertRaisesRegex(ContractError, "SUPPLEMENTAL_BOARD_RESERVED_SLOT_NOT_EMPTY"):
            split_supplemental_boards(interactive, structural, self.root / "output", "ui-roles")

    def test_keeps_one_connected_asset_that_crosses_an_equal_grid_line(self):
        interactive = self.board("interactive.png", 4, 6, len(INTERACTIVE_SLOTS))
        with Image.open(interactive) as source:
            image = source.convert("RGBA")
        draw = ImageDraw.Draw(image)
        draw.rectangle((120, 245, 135, 265), fill=(20, 150, 220, 255))
        image.save(interactive)
        structural = self.board("structural.png", 4, 3, len(STRUCTURAL_SLOTS))
        result = split_supplemental_boards(
            interactive, structural, self.root / "output", "ui-roles")
        self.assertEqual(result["asset_count"], 35)

    def test_rejects_state_templates_with_different_normalized_geometry(self):
        interactive = self.board("interactive.png", 4, 6, len(INTERACTIVE_SLOTS))
        structural = self.board("structural.png", 4, 3, len(STRUCTURAL_SLOTS))
        with Image.open(structural) as source:
            image = source.convert("RGBA")
        draw = ImageDraw.Draw(image)
        draw.rectangle((2 * 100, 2 * 100, 2 * 100 + 99, 2 * 100 + 99), fill=(0, 0, 0, 0))
        draw.rectangle((2 * 100 + 10, 2 * 100 + 40, 2 * 100 + 90, 2 * 100 + 60),
                       fill=(20, 150, 220, 255))
        image.save(structural)
        with self.assertRaisesRegex(ContractError, "SUPPLEMENTAL_BOARD_TAB_TEMPLATE_GEOMETRY_MISMATCH"):
            split_supplemental_boards(interactive, structural, self.root / "output", "ui-roles")


if __name__ == "__main__":
    unittest.main()
