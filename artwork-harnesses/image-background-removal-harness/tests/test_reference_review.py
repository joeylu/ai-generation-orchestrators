from __future__ import annotations

import contextlib
import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from PIL import Image

from ai_image_background_removal.cli import main
from ai_image_background_removal.media.reference_review import REVIEW_BACKGROUNDS, save_reference_review
from ai_image_background_removal.preparation import load_preparation
from ai_image_background_removal.provider_plan import build_plan


class ReferenceReviewTests(unittest.TestCase):
    def test_exact_composites_include_purple_and_preserve_input_and_alpha(self):
        source = Image.new("RGBA", (65, 35))
        source.putpixel((10, 10), (255, 255, 255, 255))
        source.putpixel((11, 10), (40, 80, 120, 128))
        before = source.tobytes()
        with tempfile.TemporaryDirectory() as temporary:
            folder = Path(temporary) / "review"
            save_reference_review(source, folder)
            self.assertEqual({p.name for p in folder.iterdir()}, {f"{name}.png" for name in (*REVIEW_BACKGROUNDS, "checker", "alpha")})
            for name, colour in REVIEW_BACKGROUNDS.items():
                with Image.open(folder / f"{name}.png") as result:
                    self.assertEqual(result.mode, "RGB")
                    self.assertEqual(result.size, source.size)
                    self.assertEqual(result.getpixel((0, 0)), colour)
                    self.assertEqual(result.getpixel((10, 10)), (255, 255, 255))
                    expected = tuple(round((fg * 128 + bg * 127) / 255) for fg, bg in zip((40, 80, 120), colour))
                    self.assertEqual(result.getpixel((11, 10)), expected)
            with Image.open(folder / "alpha.png") as alpha:
                self.assertEqual(alpha.tobytes(), source.getchannel("A").tobytes())
            with Image.open(folder / "checker.png") as checker:
                self.assertEqual(checker.getpixel((0, 0)), (72, 72, 72))
                self.assertEqual(checker.getpixel((32, 0)), (192, 192, 192))
            with self.assertRaises(FileExistsError):
                save_reference_review(source, folder)
        self.assertEqual(source.tobytes(), before)

    def test_prepare_cli_writes_reviews_without_model_for_existing_alpha(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = Image.new("RGBA", (64, 64))
            source.paste((255, 255, 255, 255), (24, 16, 40, 48))
            source.save(root / "source.png")
            original = (root / "source.png").read_bytes()
            plan = build_plan(root=root, reference="source.png", out_dir="prepared")
            with patch("ai_image_background_removal.preparation.infer_foreground_mask", side_effect=AssertionError("no model")), contextlib.redirect_stdout(io.StringIO()) as output:
                code = main(["prepare", "--root", str(root), "--reference", "source.png", "--out-dir", "prepared", "--confirm-plan-sha256", plan["plan_sha256"]])
            self.assertEqual(code, 0)
            status = json.loads(output.getvalue())
            self.assertEqual(status["review_dir"], "prepared/review")
            self.assertEqual(status["status"], "prepared_requires_visual_review")
            report = load_preparation(root, "prepared/preparation.json")
            self.assertEqual(report["foreground"]["path"], "prepared/foreground.png")
            self.assertTrue(report["quality"]["visual_review_required"])
            self.assertEqual((root / "source.png").read_bytes(), original)
            self.assertTrue((root / "prepared/review/purple.png").is_file())
            self.assertFalse((root / ".ai-frame-animation/attempts").exists())


if __name__ == "__main__":
    unittest.main()
