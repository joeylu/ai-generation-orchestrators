from __future__ import annotations

import contextlib
import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

import numpy as np
from PIL import Image, ImageDraw

from ai_image_background_removal.canonical import fingerprint, load_json, stamp_document, write_json_atomic
from ai_image_background_removal.cli import main
from ai_image_background_removal.media.segmentation import infer_foreground_mask
from ai_image_background_removal.preparation import inspect_preparation, load_preparation, prepare_reference
from reference_doubles import foreground_double


EVIDENCE = {"backend": "onnx_birefnet", "model_sha256": "a" * 64, "execution": "local_cpu", "runtime_version": "fixture"}


def source_fixture(root: Path, *, alpha: bool = False, multicolour: bool = False) -> Path:
    image = Image.new("RGBA", (96, 64), (0, 0, 0, 0) if alpha else "white")
    draw = ImageDraw.Draw(image)
    if multicolour:
        colours = ("#FF0000", "#00FF00", "#0000FF", "#FFFF00", "#FF00FF", "#00FFFF")
        for index, colour in enumerate(colours):
            draw.rectangle((index * 16, 0, index * 16 + 15, 63), fill=colour)
    draw.rectangle((32, 12, 63, 51), fill="#888888", outline="black")
    draw.rectangle((40, 20, 51, 35), fill="white")
    # Actual antialiased RGB, not an opaque white canvas pixel with a soft mask.
    if not alpha:
        image.putpixel((31, 32), (195, 195, 195, 255))
    path = root / "source.png"
    image.save(path)
    return path


def mask_fixture() -> Image.Image:
    image = Image.new("L", (96, 64))
    ImageDraw.Draw(image).rectangle((32, 12, 63, 51), fill=255)
    image.putpixel((31, 32), 128)
    return image


class ReferencePreparationTests(unittest.TestCase):
    def setUp(self) -> None:
        context = foreground_double()
        context.__enter__()
        self.addCleanup(context.__exit__, None, None, None)

    def prepare(self, root: Path) -> dict:
        with patch("ai_image_background_removal.preparation.infer_foreground_mask", return_value=(mask_fixture(), EVIDENCE)) as infer:
            report = prepare_reference(root=root, reference="source.png", out_dir="work/prepared")
        infer.assert_called_once()
        return report

    def test_white_and_multicolour_sources_are_prepared_without_erasing_white_armour(self) -> None:
        for multicolour in (False, True):
            with self.subTest(multicolour=multicolour), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                source = source_fixture(root, multicolour=multicolour)
                original = source.read_bytes()
                report = self.prepare(root)
                with Image.open(root / report["foreground"]["path"]) as image:
                    pixels = list(image.get_flattened_data())
                    self.assertIn((255, 255, 255, 255), pixels)
                    self.assertTrue(any(0 < pixel[3] < 255 for pixel in pixels))
                    self.assertTrue(all(pixel[:3] == (0, 0, 0) for pixel in pixels if pixel[3] == 0))
                self.assertEqual(source.read_bytes(), original)
                self.assertEqual(load_preparation(root, "work/prepared/preparation.json"), report)
                self.assertFalse((root / ".ai-frame-animation/attempts").exists())

    def test_existing_alpha_needs_no_model_and_preserves_proportions(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source_fixture(root, alpha=True)
            with patch("ai_image_background_removal.preparation.infer_foreground_mask", side_effect=AssertionError("no model")):
                report = prepare_reference(root=root, reference="source.png", out_dir="prepared")
            self.assertEqual(report["method"], "existing_alpha")
            self.assertEqual(report["quality"]["contain_scale"], 1)
            self.assertEqual(report["matting"]["method"], "existing_alpha")

    def test_decontaminated_cutout_is_used_by_cli_and_bound_into_preparation(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source_fixture(root)
            with patch("ai_image_background_removal.preparation.infer_foreground_mask", return_value=(mask_fixture(), EVIDENCE)), contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(main(["prepare", "--root", str(root), "--reference", "source.png", "--out-dir", "prepared"]), 0)
            report = load_preparation(root, "prepared/preparation.json")
            self.assertEqual(report["schema_version"], "ai_frame_animation_reference_preparation_v4")
            self.assertEqual(report["matting"]["method"], "foreground_ml_v1")
            with Image.open(root / report["cutout"]["path"]) as image:
                np.testing.assert_array_equal(np.asarray(image)[...,3], np.asarray(mask_fixture()))
            self.assertEqual(load_preparation(root, "prepared/preparation.json"), report)

    def test_legacy_v1_v2_v3_remain_readable_without_running_old_algorithm(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source_fixture(root)
            self.prepare(root)
            path = root / "work/prepared/preparation.json"
            original = load_json(path)
            for version in (1,2,3):
                legacy = {k:v for k,v in original.items() if k not in {"cutout","matting"}}
                legacy["schema_version"] = f"ai_frame_animation_reference_preparation_v{version}"
                legacy["segmentation"] = {**EVIDENCE, "backend":"onnx_u2net"}
                if version > 1:
                    legacy["matting"] = {"method":"uniform_background_v1", "background_rgb":[255,255,255],
                                         "restored_pixels":0, "cleared_pixels":0, "decontaminated_pixels":0}
                if version == 3:
                    legacy["matting"].update(method="uniform_background_seeded_v1", background_points=[[32,42]], confirmed_background_pixels=1)
                    legacy["quality"] = {**original["quality"], "warnings":["background_hint_requires_review"]}
                write_json_atomic(path, stamp_document(legacy, "preparation_sha256"))
                with patch("ai_image_background_removal.preparation.infer_foreground_mask",side_effect=AssertionError("no old inference")):
                    self.assertEqual(load_preparation(root,path)["schema_version"],legacy["schema_version"])
            for field,value in (("background_points",[]),("background_points",[[-1,42]]),
                                ("background_points",[[32,42],[32,42]]),("background_points",[[32,True]]),
                                ("confirmed_background_pixels",0),("confirmed_background_pixels",True)):
                changed = {**legacy, "matting":{**legacy["matting"],field:value}}
                write_json_atomic(path,stamp_document(changed,"preparation_sha256"))
                with self.subTest(field=field), self.assertRaisesRegex(ValueError,"reference_preparation_matting_invalid"):
                    load_preparation(root,path)

    def test_v4_rejects_invalid_evidence_and_changed_cutout(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source_fixture(root)
            original = self.prepare(root)
            path = root / "work/prepared/preparation.json"
            for key,value in (("method","unknown"),("alpha_policy","binary"),("runtime_version",""),
                              ("decontaminated_pixels",True),("decontaminated_pixels",-1),
                              ("decontaminated_pixels",1000000000)):
                report = {**original,"matting":{**original["matting"],key:value}}
                write_json_atomic(path,stamp_document(report,"preparation_sha256"))
                with self.subTest(key=key), self.assertRaisesRegex(ValueError,"reference_preparation_matting_invalid"):
                    load_preparation(root,path)
            changed = {**original,"segmentation":{**EVIDENCE,"backend":"onnx_u2net"}}
            write_json_atomic(path,stamp_document(changed,"preparation_sha256"))
            with self.assertRaisesRegex(ValueError,"segmentation_invalid"):
                load_preparation(root,path)
            write_json_atomic(path,original)
            (root / original["cutout"]["path"]).write_bytes(b"changed")
            with self.assertRaisesRegex(ValueError,"artifact_changed"):
                load_preparation(root,path)

    def test_old_point_cli_is_rejected_before_inference_or_writes(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source_fixture(root)
            with patch("ai_image_background_removal.preparation.infer_foreground_mask") as infer, contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit) as error:
                main(["prepare","--root",str(root),"--reference","source.png","--out-dir","prepared","--background-point","32","42"])
            self.assertEqual(error.exception.code,2)
            infer.assert_not_called()
            self.assertFalse((root/"prepared").exists())

    def test_missing_segmenter_is_setup_issue_not_transparent_source_requirement(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source_fixture(root)
            before = {p.name: p.read_bytes() for p in root.iterdir()}
            report = inspect_preparation(root, "source.png")
            self.assertEqual(report["diagnostic_code"], "reference_segmentation_setup_required")
            with self.assertRaisesRegex(ValueError, "reference_segmentation_setup_required"):
                prepare_reference(root=root, reference="source.png", out_dir="prepared")
            self.assertEqual({p.name: p.read_bytes() for p in root.iterdir()}, before)

    def test_bad_masks_stop_before_publication_without_changing_source(self) -> None:
        masks = ((Image.new("L", (96, 64)), "foreground_empty"),
                 (Image.new("L", (96, 64), 255), "background_unresolved"),
                 (Image.new("RGB", (96, 64)), "mask_invalid"),
                 (Image.new("L", (32, 32)), "mask_invalid"))
        for mask, code in masks:
            with self.subTest(code=code), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                source = source_fixture(root)
                before = source.read_bytes()
                with patch("ai_image_background_removal.preparation.infer_foreground_mask", return_value=(mask, {})):
                    with self.assertRaisesRegex(ValueError, code):
                        prepare_reference(root=root, reference="source.png", out_dir="prepared")
                self.assertFalse((root / "prepared").exists())
                self.assertEqual(source.read_bytes(), before)

    def test_unreadable_empty_too_small_sources_get_specific_diagnostics(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            for image, code in ((Image.new("RGBA", (32, 32)), "reference_has_no_visible_subject"),
                                (Image.new("RGB", (4, 4)), "reference_resolution_too_small")):
                image.save(root / "source.png")
                self.assertEqual(inspect_preparation(root, "source.png")["diagnostic_code"], code)
            (root / "source.png").write_bytes(b"not an image")
            self.assertEqual(inspect_preparation(root, "source.png")["status"], "action_required")

    def test_prepared_report_binds_original_and_foreground(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source_fixture(root, multicolour=True)
            report = self.prepare(root)
            self.assertEqual(report["source"], {"path": "source.png", **fingerprint(root / "source.png", media_type="image")})
            self.assertEqual(report["foreground"], {"path": "work/prepared/foreground.png", **fingerprint(root / "work/prepared/foreground.png", media_type="image")})
            self.assertEqual(load_preparation(root, "work/prepared/preparation.json"), report)
            (root / "source.png").write_bytes(b"changed")
            with self.assertRaisesRegex(ValueError, "reference_preparation_artifact_changed"):
                load_preparation(root, "work/prepared/preparation.json")

    def test_preparation_cannot_be_rebound_to_another_original_or_changed_foreground(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source_fixture(root)
            self.prepare(root)
            (root / "work/prepared/foreground.png").write_bytes(b"changed")
            with self.assertRaisesRegex(ValueError, "reference_preparation_artifact_changed"):
                load_preparation(root, "work/prepared/preparation.json")

    def test_no_overwrite_or_path_escape(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source_fixture(root, alpha=True)
            prepare_reference(root=root, reference="source.png", out_dir="prepared")
            before = (root / "prepared/foreground.png").read_bytes()
            with self.assertRaisesRegex(ValueError, "reference_preparation_output_exists"):
                prepare_reference(root=root, reference="source.png", out_dir="prepared")
            with self.assertRaisesRegex(ValueError, "path_escapes_root"):
                prepare_reference(root=root, reference="source.png", out_dir="../outside")
            self.assertEqual((root / "prepared/foreground.png").read_bytes(), before)

    def test_doctor_is_read_only_and_ready_means_setup_not_visual_quality(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source_fixture(root)
            before = {p.name: p.read_bytes() for p in root.iterdir()}
            with patch("ai_image_background_removal.preparation.inspect_segmenter", return_value={"backend": "fixture"}), patch("ai_image_background_removal.preparation.infer_foreground_mask", side_effect=AssertionError("no inference")), contextlib.redirect_stdout(io.StringIO()) as output:
                result = main(["doctor", "--root", str(root), "--reference", "source.png", "--require-ready"])
            self.assertEqual(result, 0)
            self.assertEqual(json.loads(output.getvalue())["reference_preparation"]["prepared_quality"], "not_checked")
            self.assertEqual({p.name: p.read_bytes() for p in root.iterdir()}, before)

    def test_runtime_profile_mismatch_blocks_doctor_and_prepare_before_inference(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source_fixture(root)
            before = {p.name: p.read_bytes() for p in root.iterdir()}
            mismatch = ValueError("reference_segmentation_runtime_profile_mismatch")
            with patch("ai_image_background_removal.preparation.inspect_segmenter", side_effect=mismatch), contextlib.redirect_stdout(io.StringIO()) as output:
                result = main(["doctor", "--root", str(root), "--reference", "source.png", "--require-ready"])
            doctor = json.loads(output.getvalue())
            self.assertEqual(result, 1)
            self.assertEqual(doctor["reference_preparation"]["diagnostic_code"], "reference_segmentation_runtime_profile_mismatch")
            self.assertTrue(any("isolated virtual environment" in action for action in doctor["actions"]))
            with patch("ai_image_background_removal.preparation.inspect_matting_runtime", side_effect=mismatch), patch("ai_image_background_removal.preparation.infer_foreground_mask") as infer:
                with self.assertRaisesRegex(ValueError, "runtime_profile_mismatch"):
                    prepare_reference(root=root, reference="source.png", out_dir="prepared")
            infer.assert_not_called()
            self.assertFalse((root / "prepared").exists())
            self.assertEqual({p.name: p.read_bytes() for p in root.iterdir()}, before)

    def test_jpeg_source_and_exif_orientation_are_supported(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            png = source_fixture(root)
            with Image.open(png) as image:
                exif = Image.Exif()
                exif[274] = 6
                image.convert("RGB").save(root / "source.jpg", exif=exif)
            def segment(image, _config):
                self.assertEqual(image.size, (64, 96))
                return mask_fixture().transpose(Image.Transpose.ROTATE_270), EVIDENCE
            with patch("ai_image_background_removal.preparation.infer_foreground_mask", side_effect=segment):
                result = prepare_reference(root=root, reference="source.jpg", out_dir="prepared")
            self.assertEqual(result["source"]["path"], "source.jpg")
            with Image.open(root / result["foreground"]["path"]) as image:
                self.assertEqual(image.size, (64, 96))

    def test_changed_report_and_unsafe_artifact_path_are_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source_fixture(root)
            self.prepare(root)
            path = root / "work/prepared/preparation.json"
            original = load_json(path)
            report = load_json(path)
            report["quality"]["warnings"] = ["not_a_public_warning"]
            write_json_atomic(path, stamp_document(report, "preparation_sha256"))
            with self.assertRaisesRegex(ValueError, "reference_preparation_quality_invalid"):
                load_preparation(root, path)
            original["source"]["path"] = "../outside.png"
            write_json_atomic(path, stamp_document(original, "preparation_sha256"))
            with self.assertRaisesRegex(ValueError, "reference_preparation_path_unsafe"):
                load_preparation(root, path)

    def test_writing_failure_cleans_only_its_new_staging_directory(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source_fixture(root, alpha=True)
            before = (root / "source.png").read_bytes()
            with patch("ai_image_background_removal.preparation.write_json_atomic", side_effect=OSError("fixture")):
                with self.assertRaises(OSError):
                    prepare_reference(root=root, reference="source.png", out_dir="prepared")
            self.assertEqual((root / "source.png").read_bytes(), before)
            self.assertEqual(list(root.glob(".*.preparing")), [])
            self.assertFalse((root / "prepared").exists())



if __name__ == "__main__":
    unittest.main()
