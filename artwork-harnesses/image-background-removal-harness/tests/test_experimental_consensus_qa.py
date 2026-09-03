from __future__ import annotations

import contextlib
import io
import json
import tempfile
import unittest
from pathlib import Path

from PIL import Image, ImageDraw

from ai_image_background_removal.cli import main
from ai_image_background_removal.experimental_consensus_qa import (
    LIGHT_2K_PROFILE,
    MATTING_PROFILE,
    run_consensus_qa,
)
from ai_image_background_removal.fal_provider import DEFAULT_PROFILE_ID
from ai_image_background_removal.preparation import prepare_reference


class ForegroundProviderDouble:
    def __init__(self, profile: str, foreground: Image.Image) -> None:
        self.profile = profile
        self.foreground = foreground

    def infer_foreground(self, source: Path, expected_size: tuple[int, int]):
        del source
        if self.foreground.size != expected_size:
            raise AssertionError("fixture size mismatch")
        return self.foreground.copy(), {
            "backend": "external_foreground_v1",
            "profile": self.profile,
            "execution": "remote",
        }


def foreground(box: tuple[int, int, int, int]) -> Image.Image:
    image = Image.new("RGBA", (100, 100))
    ImageDraw.Draw(image).rectangle(box, fill=(80, 100, 120, 255))
    return image


class ExperimentalConsensusQaTests(unittest.TestCase):
    def _source(self, root: Path, name: str = "source.png") -> None:
        Image.new("RGB", (100, 100), "white").save(root / name)

    def _prepare(self, root: Path, source: str, out: str, profile: str, box: tuple[int, int, int, int]) -> str:
        prepare_reference(
            root=root,
            reference=source,
            out_dir=out,
            foreground_provider=ForegroundProviderDouble(profile, foreground(box)),
        )
        return f"{out}/handoff.json"

    def _three(self, root: Path, *, light_2k_box=(20, 10, 79, 89), matting_box=(20, 10, 79, 89)):
        self._source(root)
        return (
            self._prepare(root, "source.png", "primary", DEFAULT_PROFILE_ID, (20, 10, 79, 89)),
            self._prepare(root, "source.png", "light-2k", LIGHT_2K_PROFILE, light_2k_box),
            self._prepare(root, "source.png", "matting", MATTING_PROFILE, matting_box),
        )

    def test_matching_masks_accept_only_primary_and_write_stamped_report(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            primary, light_2k, matting = self._three(root)
            report = run_consensus_qa(
                root=root,
                primary_handoff=primary,
                light_2k_handoff=light_2k,
                matting_handoff=matting,
                out="qa/consensus.json",
            )
            self.assertEqual(report["status"], "passed")
            self.assertEqual(report["decision"], "accept_primary")
            self.assertEqual(report["selected_foreground"]["path"], "primary/foreground.png")
            self.assertEqual(report["policy"]["comparison_space"], "source_coordinate_cutout_alpha")
            self.assertEqual(report["candidates"][0]["cutout"]["path"], "primary/cutout.png")
            self.assertEqual(report["provider_compute"], "not_performed")
            self.assertEqual(report["network_probe"], "not_performed")
            saved = json.loads((root / "qa/consensus.json").read_text(encoding="utf-8"))
            self.assertEqual(saved["qa_sha256"], report["qa_sha256"])
            self.assertNotIn("report_path", saved)

    def test_divergent_mask_rejects_without_selecting_fallback(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            primary, light_2k, matting = self._three(root, light_2k_box=(40, 30, 59, 69))
            report = run_consensus_qa(
                root=root,
                primary_handoff=primary,
                light_2k_handoff=light_2k,
                matting_handoff=matting,
                out="qa.json",
            )
            self.assertEqual(report["status"], "rejected")
            self.assertEqual(report["decision"], "reject")
            self.assertIsNone(report["selected_foreground"])
            self.assertIn("primary_light_2k_mask_divergence", report["reasons"])

    def test_cli_rejection_is_a_nonzero_offline_gate(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            primary, light_2k, matting = self._three(root, matting_box=(45, 35, 54, 64))
            output = io.StringIO()
            with contextlib.redirect_stdout(output):
                result = main([
                    "qa", "consensus", "--root", str(root),
                    "--primary", primary, "--light-2k", light_2k,
                    "--matting", matting, "--out", "qa.json",
                ])
            self.assertEqual(result, 1)
            self.assertEqual(json.loads(output.getvalue())["status"], "rejected")

    def test_profiles_source_and_fresh_output_are_bound(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            primary, light_2k, matting = self._three(root)
            wrong_profile = self._prepare(root, "source.png", "wrong", DEFAULT_PROFILE_ID, (20, 10, 79, 89))
            with self.assertRaisesRegex(ValueError, "profile_mismatch"):
                run_consensus_qa(root=root, primary_handoff=primary, light_2k_handoff=wrong_profile,
                                 matting_handoff=matting, out="profile.json")

            self._source(root, "other.png")
            other = self._prepare(root, "other.png", "other", MATTING_PROFILE, (20, 10, 79, 89))
            with self.assertRaisesRegex(ValueError, "source_mismatch"):
                run_consensus_qa(root=root, primary_handoff=primary, light_2k_handoff=light_2k,
                                 matting_handoff=other, out="source.json")

            run_consensus_qa(root=root, primary_handoff=primary, light_2k_handoff=light_2k,
                             matting_handoff=matting, out="fresh.json")
            with self.assertRaisesRegex(ValueError, "output_exists"):
                run_consensus_qa(root=root, primary_handoff=primary, light_2k_handoff=light_2k,
                                 matting_handoff=matting, out="fresh.json")


if __name__ == "__main__":
    unittest.main()
