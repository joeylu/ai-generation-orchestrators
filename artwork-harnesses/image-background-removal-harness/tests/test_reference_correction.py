from __future__ import annotations

import contextlib
import copy
import io
import json
import stat
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import numpy as np
from PIL import Image, ImageDraw

from ai_image_background_removal.canonical import fingerprint, load_json, stamp_document, write_json_atomic
from ai_image_background_removal.cli import main
from ai_image_background_removal.correction import _calculate, _parameters, apply_correction, load_correction_preview, preview_correction
from ai_image_background_removal.preparation import load_preparation, prepare_reference
from reference_doubles import foreground_double
from test_reference_preparation import EVIDENCE

CASE = json.loads((Path(__file__).parent / "fixtures/golden/reference-local-correction-cases.json").read_text(encoding="utf-8"))


def fixture(root):
    source = Image.new("RGBA", tuple(CASE["size"]), (*CASE["background"], 255))
    draw = ImageDraw.Draw(source)
    draw.rectangle(CASE["body"], fill=(*CASE["body_rgb"], 255))
    for rect in (CASE["hole"], CASE["same_colour_insert"]):
        draw.rectangle(rect, fill=(*CASE["background"], 255))
    draw.rectangle(CASE["white_cloth"], fill="white")
    source.save(root / "source.png")
    mask = Image.new("L", source.size)
    ImageDraw.Draw(mask).rectangle(CASE["body"], fill=254)
    for index, alpha in enumerate(CASE["soft_alpha_values"]):
        mask.putpixel((64, 95+index), alpha)
    with patch("ai_image_background_removal.preparation.infer_foreground_mask", return_value=(mask, EVIDENCE)), foreground_double():
        return prepare_reference(root=root, reference="source.png", out_dir="base")


def preview(root, **kwargs):
    return preview_correction(root=root, prepared_reference=kwargs.pop("prepared_reference", "base/preparation.json"),
        region=kwargs.pop("region", CASE["region"]), background_point=kwargs.pop("background_point", CASE["background_point"]),
        out_dir=kwargs.pop("out_dir", "preview"), **kwargs)


class ReferenceCorrectionTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.base = fixture(self.root)
        self.guard = patch("ai_image_background_removal.preparation.infer_foreground_mask", side_effect=AssertionError("correction must never infer"))
        self.guard.start()
        self.addCleanup(self.guard.stop)
        self.matte = patch("ai_image_background_removal.preparation.refine_reference_matte", side_effect=AssertionError("correction must never call model matting"))
        self.matte.start()
        self.addCleanup(self.matte.stop)

    def test_preview_preserves_base_outside_region_and_original_soft_alpha(self):
        original = {p.relative_to(self.root): fingerprint(p) for p in self.root.rglob("*") if p.is_file()}
        result = preview(self.root)
        self.assertEqual(result["result"]["key_rgb"], CASE["background"])
        with Image.open(self.root / "base/cutout.png") as image:
            before = np.array(image)
        with Image.open(self.root / "preview/cutout.png") as image:
            after = np.array(image)
        x0, y0, x1, y1 = CASE["region"]
        outside = np.ones(before.shape[:2], dtype=bool)
        outside[y0:y1, x0:x1] = False
        np.testing.assert_array_equal(before[outside], after[outside])
        self.assertEqual(after[74, 100, 3], 0)
        for x, y in CASE["protected_points"]:
            np.testing.assert_array_equal(after[y, x], before[y, x])
        self.assertTrue(np.all(after[..., 3] <= before[..., 3]))
        self.assertFalse(np.any(after[after[..., 3] == 0, :3]))
        self.assertEqual(original, {p: fingerprint(self.root / p) for p in original})
        self.assertFalse((self.root / "preview/preparation.json").exists())
        with self.assertRaises(ValueError):
            load_preparation(self.root, "preview/correction.json")

    def test_confirmed_apply_creates_v5_binds_original_and_is_plan_compatible(self):
        result = preview(self.root)
        applied = apply_correction(root=self.root, preview_path="preview/correction.json",
            confirm_correction_sha256=result["correction_sha256"], out_dir="corrected")
        self.assertEqual(load_preparation(self.root, "corrected/preparation.json"), applied)
        self.assertEqual(applied["source"], self.base["source"])
        self.assertEqual(applied["schema_version"], "ai_frame_animation_reference_preparation_v5")
        self.assertEqual(applied["matting"]["alpha_policy"], "confirmed_region_only")
        self.assertEqual((self.root / "preview/cutout.png").read_bytes(), (self.root / "corrected/cutout.png").read_bytes())
        self.assertEqual(load_preparation(self.root, "base/preparation.json"), self.base)

    def test_missing_or_wrong_confirmation_never_publishes(self):
        preview(self.root)
        for digest in ("", "0"*64, None):
            with self.subTest(digest=digest), self.assertRaisesRegex(ValueError, "confirmation_mismatch"):
                apply_correction(root=self.root, preview_path="preview/correction.json", confirm_correction_sha256=digest, out_dir="blocked")
            self.assertFalse((self.root / "blocked").exists())
        with contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
            main(["correct", "apply", "--root", str(self.root), "--preview", "preview/correction.json", "--out-dir", "blocked"])

    def test_output_overwrite_and_parent_overwrite_are_refused(self):
        result = preview(self.root)
        for directory in ("base", "preview"):
            with self.subTest(directory=directory), self.assertRaisesRegex(ValueError, "output_exists"):
                apply_correction(root=self.root, preview_path="preview/correction.json",
                    confirm_correction_sha256=result["correction_sha256"], out_dir=directory)
        with self.assertRaisesRegex(ValueError, "output_exists"):
            preview(self.root)
        self.assertEqual(load_preparation(self.root, "base/preparation.json"), self.base)

    def test_outside_root_and_dotdot_paths_are_refused(self):
        for value in ("../escape", self.root.parent / "escape", "nested/../escape", "."):
            with self.subTest(value=value), self.assertRaises(ValueError):
                preview(self.root, out_dir=value)

    def test_linked_preview_and_output_parent_are_refused(self):
        target = self.root / "target"
        target.mkdir()
        link = self.root / "linked"
        try:
            link.symlink_to(target, target_is_directory=True)
        except OSError:
            self.skipTest("symlink privilege unavailable")
        with self.assertRaisesRegex(ValueError, "path_unsafe"):
            preview(self.root, out_dir="linked/preview")
        result = preview(self.root)
        (target / "correction.json").symlink_to(self.root / "preview/correction.json")
        with self.assertRaisesRegex(ValueError, "path_unsafe"):
            apply_correction(root=self.root, preview_path="target/correction.json",
                confirm_correction_sha256=result["correction_sha256"], out_dir="blocked")

    def test_parent_changes_during_preview_are_detected_before_publish(self):
        from ai_image_background_removal.correction import _review_images
        def changed(*args):
            images = _review_images(*args)
            (self.root / "source.png").write_bytes(b"changed-by-test-double")
            return images
        with patch("ai_image_background_removal.correction._review_images", side_effect=changed):
            with self.assertRaises(ValueError):
                preview(self.root)
        self.assertFalse((self.root / "preview").exists())

    def test_windows_reparse_output_parent_is_rejected_with_test_double(self):
        target = self.root / "reparse-parent"
        target.mkdir()
        canonical_target = target.resolve()
        original = Path.lstat
        def details(path, *args, **kwargs):
            if path == canonical_target:
                return SimpleNamespace(st_mode=stat.S_IFDIR, st_file_attributes=0x400)
            return original(path, *args, **kwargs)
        with patch.object(Path, "lstat", details), self.assertRaisesRegex(ValueError, "path_unsafe"):
            preview(self.root, out_dir="reparse-parent/output")
        self.assertFalse((target / "output").exists())

    def test_apply_reserves_new_report_in_chain_budget_before_publication(self):
        result = preview(self.root)
        with patch("ai_image_background_removal.correction.load_correction_preview", wraps=load_correction_preview) as loader:
            apply_correction(root=self.root, preview_path="preview/correction.json",
                confirm_correction_sha256=result["correction_sha256"], out_dir="corrected")
        self.assertTrue(loader.call_args_list)
        for call in loader.call_args_list:
            self.assertEqual(call.kwargs["_seen"], (self.root.resolve() / "corrected/preparation.json",))
        with self.assertRaisesRegex(ValueError, "cycle_or_depth_limit"):
            load_preparation(self.root, "base/preparation.json", _seen=tuple(self.root / str(n) for n in range(16)))

    def test_unchanged_preview_can_be_reapplied_to_a_new_directory_only(self):
        result = preview(self.root)
        for out_dir in ("corrected", "corrected-replay"):
            apply_correction(root=self.root, preview_path="preview/correction.json",
                confirm_correction_sha256=result["correction_sha256"], out_dir=out_dir)
        self.assertEqual((self.root / "corrected/cutout.png").read_bytes(), (self.root / "corrected-replay/cutout.png").read_bytes())

    def test_regions_points_and_non_finite_thresholds_are_rejected(self):
        for region in ([0, 0, 256, 256], [-1, 1, 3, 4], [4, 1, 3, 4], [1, 1, 3, True], [1, 2, 3]):
            with self.subTest(region=region), self.assertRaises(ValueError):
                preview(self.root, region=region)
        for point in ([0, 0], [100, True], [100], [100, 256]):
            with self.subTest(point=point), self.assertRaises(ValueError):
                preview(self.root, background_point=point)
        for value in (float("nan"), float("inf"), -1, 65, True):
            with self.subTest(threshold=value), self.assertRaisesRegex(ValueError, "threshold_invalid"):
                preview(self.root, tolerance=value)

    def test_transparent_background_point_is_not_a_residue(self):
        with self.assertRaisesRegex(ValueError, "point_not_opaque_residue"):
            preview(self.root, region=[0, 0, 16, 16], background_point=[4, 4])

    def test_preview_tampering_and_rehashed_outside_mask_are_rejected(self):
        preview(self.root)
        target = self.root / "preview/cutout.png"
        with Image.open(target) as image:
            revised = image.convert("RGBA")
        revised.putpixel((170, 74), (0, 0, 0, 0))
        revised.save(target)
        with self.assertRaisesRegex(ValueError, "artifact_changed"):
            load_correction_preview(self.root, "preview/correction.json")
        report = load_json(self.root / "preview/correction.json")
        report["artifacts"]["cutout.png"].update(fingerprint(target))
        write_json_atomic(self.root / "preview/correction.json", stamp_document(report, "correction_sha256"))
        with self.assertRaisesRegex(ValueError, "pixels_mismatch"):
            load_correction_preview(self.root, "preview/correction.json")

    def test_rehashed_misleading_review_image_is_rejected(self):
        preview(self.root)
        target = self.root / "preview/after-purple-512.png"
        Image.new("RGB", (512, 512), "green").save(target)
        report = load_json(self.root / "preview/correction.json")
        report["artifacts"][target.name].update(fingerprint(target))
        write_json_atomic(self.root / "preview/correction.json", stamp_document(report, "correction_sha256"))
        with self.assertRaisesRegex(ValueError, "pixels_mismatch"):
            load_correction_preview(self.root, "preview/correction.json")

    def test_rehashed_result_and_paths_are_validated(self):
        result = preview(self.root)
        for mutate in (lambda r: r["result"].update(changed_pixels=1),
                       lambda r: r["parent"].update(path="../source.png"),
                       lambda r: r["parameters"].update(algorithm="unknown")):
            changed = copy.deepcopy(result)
            mutate(changed)
            write_json_atomic(self.root / "preview/correction.json", stamp_document(changed, "correction_sha256"))
            with self.assertRaises(ValueError):
                load_correction_preview(self.root, "preview/correction.json")

    def test_parent_or_source_change_invalidates_preview_and_applied_report(self):
        result = preview(self.root)
        apply_correction(root=self.root, preview_path="preview/correction.json",
            confirm_correction_sha256=result["correction_sha256"], out_dir="corrected")
        (self.root / "source.png").write_bytes(b"changed")
        for path in ("base/preparation.json", "corrected/preparation.json"):
            with self.subTest(path=path), self.assertRaises(ValueError):
                load_preparation(self.root, path)
        with self.assertRaises(ValueError):
            load_correction_preview(self.root, "preview/correction.json")

    def test_applied_evidence_cannot_claim_old_preserve_mask_method(self):
        result = preview(self.root)
        applied = apply_correction(root=self.root, preview_path="preview/correction.json",
            confirm_correction_sha256=result["correction_sha256"], out_dir="corrected")
        for field, value in (("method", "local_segmentation"), ("source", {}), ("matting", self.base["matting"]),
                             ("correction", {**applied["correction"], "confirmed_sha256": "0"*64})):
            altered = copy.deepcopy(applied)
            altered[field] = value
            write_json_atomic(self.root / "corrected/preparation.json", stamp_document(altered, "preparation_sha256"))
            with self.subTest(field=field), self.assertRaisesRegex(ValueError, "preparation_invalid"):
                load_preparation(self.root, "corrected/preparation.json")

    def test_multiple_explicit_corrections_keep_provenance_and_previous_versions(self):
        first = preview(self.root)
        apply_correction(root=self.root, preview_path="preview/correction.json",
            confirm_correction_sha256=first["correction_sha256"], out_dir="corrected")
        second = preview(self.root, prepared_reference="corrected/preparation.json", region=[158, 62, 182, 86],
            background_point=[170, 74], out_dir="preview2")
        applied = apply_correction(root=self.root, preview_path="preview2/correction.json",
            confirm_correction_sha256=second["correction_sha256"], out_dir="corrected2")
        self.assertEqual(load_preparation(self.root, "corrected2/preparation.json"), applied)
        self.assertEqual(applied["source"], self.base["source"])
        self.assertEqual(load_preparation(self.root, "base/preparation.json"), self.base)
        with self.assertRaisesRegex(ValueError, "cycle_or_depth"):
            load_preparation(self.root, "corrected2/preparation.json",
                _seen=(self.root.resolve() / "corrected2/preparation.json",))

    def test_source_alpha_and_continuous_corrected_alpha_never_increase(self):
        with Image.open(self.root / "source.png") as image:
            source = image.convert("RGBA")
        with Image.open(self.root / "base/cutout.png") as image:
            before = image.convert("RGBA")
        for index, alpha in enumerate(CASE["soft_alpha_values"]):
            before.putpixel((90, 64+index), (70, 30, 55, alpha))
            source.putpixel((90, 64+index), (70, 30, 55, 255))
        p = _parameters(CASE["region"], CASE["background_point"], 16, 16, source.size)
        images, _ = _calculate(source, before, p)
        old, actual = np.asarray(before), np.asarray(images["cutout.png"])
        self.assertTrue(np.all(actual[..., 3] <= old[..., 3]))
        self.assertTrue(np.any((actual[..., 3] > 0) & (actual[..., 3] < 247)))
        self.assertFalse(np.any(actual[actual[..., 3] == 0, :3]))

    def test_cli_preview_and_apply_return_distinct_states_and_no_compute(self):
        args = ["correct", "preview", "--root", str(self.root), "--prepared-reference", "base/preparation.json",
                "--region", *map(str, CASE["region"]), "--background-point", *map(str, CASE["background_point"]), "--out-dir", "preview"]
        with contextlib.redirect_stdout(io.StringIO()) as stream:
            self.assertEqual(main(args), 0)
        result = json.loads(stream.getvalue())
        self.assertEqual(result["status"], "correction_requires_confirmation")
        self.assertEqual(result["provider_compute"], "not_performed")
        with contextlib.redirect_stdout(io.StringIO()) as stream:
            self.assertEqual(main(["correct", "apply", "--root", str(self.root), "--preview", result["preview"],
                "--confirm-correction-sha256", result["correction_sha256"], "--out-dir", "corrected"]), 0)
        self.assertEqual(json.loads(stream.getvalue())["status"], "prepared_requires_visual_review")

    def test_publish_failure_does_not_change_parent_or_create_success(self):
        with patch("ai_image_background_removal.correction._publish_preparation", side_effect=ValueError("fixture_publish_failed")):
            with self.assertRaisesRegex(ValueError, "fixture_publish_failed"):
                preview(self.root)
        self.assertFalse((self.root / "preview").exists())
        self.assertFalse(list(self.root.glob("*.preparing")))
        self.assertEqual(load_preparation(self.root, "base/preparation.json"), self.base)


if __name__ == "__main__":
    unittest.main()
