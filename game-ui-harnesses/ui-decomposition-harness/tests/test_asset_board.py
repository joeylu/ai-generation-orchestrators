from __future__ import annotations

from pathlib import Path
import json
import sys
import tempfile
import unittest
import zipfile

from PIL import Image, ImageDraw

PACKAGE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PACKAGE / "src"))

from ai_ui_decomposition.asset_board import SLOT_IDS, split_asset_board
from ai_ui_decomposition.common import ContractError


class AssetBoardTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)

    def tearDown(self):
        self.temporary.cleanup()

    def board(self, *, missing_last=False):
        path = self.root / "board.png"
        image = Image.new("RGBA", (400, 400), (0, 0, 0, 0))
        draw = ImageDraw.Draw(image)
        for index, _name in enumerate(SLOT_IDS):
            if missing_last and index == 15:
                continue
            row, column = divmod(index, 4)
            x0, y0 = column * 100 + 20, row * 100 + 20
            alpha = 254 if index == 15 else 255
            if index == 6:
                for offset in (0, 24, 48):
                    draw.ellipse((x0 + offset, y0 + 18, x0 + offset + 16, y0 + 34),
                                 fill=(20, 150, 220, alpha))
            else:
                draw.rounded_rectangle((x0, y0, x0 + 60, y0 + 40), radius=5,
                                       fill=(20, 150, 220, alpha))
        image.save(path)
        return path

    def test_splits_all_canonical_slots_and_roundtrips_zip(self):
        source = self.board()
        first = self.root / "first"
        second = self.root / "second"
        result = split_asset_board(source, first, "ui-components")
        repeated = split_asset_board(source, second, "ui-components")
        self.assertEqual(result["status"], "archive_roundtrip_passed")
        self.assertEqual(result["asset_count"], 16)
        self.assertEqual(result["zip_sha256"], repeated["zip_sha256"])
        manifest = json.loads((first / "manifest.json").read_text(encoding="utf-8"))
        self.assertEqual([row["id"] for row in manifest["assets"]], list(SLOT_IDS))
        self.assertEqual(manifest["assets"][6]["connected_regions"], 3)
        self.assertGreater(manifest["assets"][15]["near_opaque_pixels_promoted"], 0)
        with Image.open(first / "assets/16_tabs.png") as tabs:
            self.assertEqual(tabs.mode, "RGBA")
            self.assertEqual(tabs.getchannel("A").getextrema(), (0, 255))
        self.assertFalse(manifest["human_visual_acceptance"])
        with zipfile.ZipFile(first / "ui-components.draft.zip") as archive:
            self.assertIsNone(archive.testzip())
            self.assertEqual(len(archive.namelist()), 17)

    def test_rejects_incomplete_board_without_creating_output(self):
        output = self.root / "output"
        with self.assertRaisesRegex(ContractError, "ASSET_BOARD_SLOT_EMPTY"):
            split_asset_board(self.board(missing_last=True), output, "ui-components")
        self.assertFalse(output.exists())

    def test_rejects_rgb_checkerboard_as_transparency(self):
        source = self.root / "checkerboard.png"
        Image.new("RGB", (400, 400), (192, 192, 192)).save(source)
        output = self.root / "output"
        with self.assertRaisesRegex(ContractError, "ASSET_BOARD_TRANSPARENCY_REQUIRED"):
            split_asset_board(source, output, "ui-components")
        self.assertFalse(output.exists())


if __name__ == "__main__":
    unittest.main()
