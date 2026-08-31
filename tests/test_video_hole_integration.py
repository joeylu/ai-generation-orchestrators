from __future__ import annotations

import contextlib
import io
import json
import tempfile
import unittest
import zipfile
from fractions import Fraction
from pathlib import Path
from unittest.mock import patch

import numpy as np
from PIL import Image, ImageDraw, ImageSequence

from ai_frame_animation.canonical import fingerprint, load_json, write_json_atomic
from ai_frame_animation.cli import main
from ai_frame_animation.media.matte import parse_hex_color
from ai_frame_animation.media.gif import PreviewGifError, export_preview_gif
from ai_frame_animation.media.reference import prepare_generation_reference
from ai_frame_animation.preparation import load_preparation
from ai_frame_animation.processing import _rgba_frame
from ai_frame_animation.validation import _validate_gif
from tests.reference_doubles import foreground_double


CASE = load_json(Path(__file__).parent / "fixtures/golden/moving-hole-cases.json")
EVIDENCE = {"backend": "onnx_birefnet", "model_sha256": "a" * 64,
            "execution": "local_cpu", "runtime_version": "fixture"}


def moving_subject(index: int) -> tuple[Image.Image, dict]:
    """Independent labelled geometry, never inferred from a processed output."""
    phase = index if index < CASE["source_frames"] - 1 else 0
    length = CASE["phase_length"]
    anchor = CASE["hole_anchors"][(phase // length) % len(CASE["hole_anchors"])]
    # Move on every source frame; the terminal source pose repeats frame zero.
    x, y = anchor[0] + phase % length, anchor[1]
    half_x, half_y = CASE["hole_half_size"]
    hole = (x - half_x, y - half_y, x + half_x - 1, y + half_y - 1)
    edge = (hole[0] - 1, y)
    image = Image.new("RGBA", (CASE["size"], CASE["size"]))
    draw = ImageDraw.Draw(image)
    draw.rectangle(CASE["body_rect"], fill=(*CASE["body_rgb"], 255))
    draw.rectangle(CASE["white_detail_rect"], fill="white")
    draw.rectangle(hole, fill=(0, 0, 0, 0))
    image.putpixel(edge, (*CASE["body_rgb"], CASE["inner_edge_alpha"]))
    return image, {"hole": (x, y), "hole_rect": hole, "edge": edge,
                   "white": tuple(CASE["white_detail_point"])}


def composite(subject: Image.Image, colour: str) -> Image.Image:
    return Image.alpha_composite(Image.new("RGBA", subject.size, colour), subject).convert("RGB")


def fraction(record: dict) -> Fraction:
    return Fraction(record["numerator"], record["denominator"])


class VideoHoleIntegrationTests(unittest.TestCase):
    def setUp(self) -> None:
        # Fail closed even if a future refactor accidentally crosses the boundary.
        for target in ("ai_frame_animation.cli.load_provider", "subprocess.run",
                       "socket.create_connection", "socket.socket.connect"):
            guard = patch(target, side_effect=AssertionError("offline_fixture_only"))
            self.addCleanup(guard.stop)
            mock = guard.start()
            self.addCleanup(mock.assert_not_called)

    def cli(self, *args: str) -> dict:
        output, error = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(output), contextlib.redirect_stderr(error):
            result = main(list(args))
        self.assertEqual(result, 0, error.getvalue())
        return json.loads(output.getvalue())

    def prepare_and_plan(self, root: Path, continuity: str, quality: str) -> dict:
        subject, labels = moving_subject(0)
        source = root / "reference.png"
        composite(subject, "white").save(source)
        original = source.read_bytes()
        # Model double selects the gap; downstream processing must not refill it.
        # Wrong confident masks are negative controls in reference-matte tests.
        mask = subject.getchannel("A")
        self.assertEqual(mask.getpixel(labels["hole"]), 0)
        with patch("ai_frame_animation.preparation.infer_foreground_mask",
                   return_value=(mask, EVIDENCE)) as infer, foreground_double(lambda rgb, alpha: np.asarray(subject)[...,:3] / 255.0):
            self.cli("prepare", "--root", str(root), "--reference", "reference.png",
                     "--out-dir", "prepared")
        infer.assert_called_once()
        report = load_preparation(root, "prepared/preparation.json")
        self.assertEqual(report["quality"]["contain_scale"], 1)
        self.assertEqual(report["matting"]["alpha_policy"], "preserve_mask")
        self.assertEqual(source.read_bytes(), original)
        job = {"schema_version": "1.0", "job_id": "moving-hole-fixture",
               "character": {"reference": "reference.png"},
               "motion": {"request": "move the enclosed arm/body gap", "continuity": continuity},
               "delivery": {"frame_counts": [16, 32, 64], "size": CASE["size"],
                            "quality": quality, "gif": True, "key_color": CASE["declared_key"]},
               "provider": {"plugin": "fixture"}}
        write_json_atomic(root / "job.json", job)
        self.cli("plan", "--root", str(root), "--job", "job.json", "--out", "plan.json",
                 "--prepared-reference", "prepared/preparation.json")
        plan = load_json(root / "plan.json")
        self.assertEqual(plan["character"]["reference_preparation"]["sha256"], report["preparation_sha256"])
        with Image.open(root / report["foreground"]["path"]) as foreground:
            bbox = foreground.getchannel("A").getbbox()
            dx = bbox[0] - report["quality"]["source_bbox"][0]
            dy = bbox[1] - report["quality"]["source_bbox"][1]
            hole = (labels["hole"][0] + dx, labels["hole"][1] + dy)
            white = (labels["white"][0] + dx, labels["white"][1] + dy)
            self.assertEqual(foreground.getpixel(hole), (0, 0, 0, 0))
            self.assertEqual(foreground.getpixel(white), (255, 255, 255, 255))
            # Exercise the real run-stage compositor, not the provider or run.
            video_input = prepare_generation_reference(foreground, plan["delivery"]["key_color"])
            self.assertEqual(video_input.getpixel(hole), parse_hex_color(CASE["declared_key"]))
            self.assertEqual(video_input.getpixel(white), (255, 255, 255))
        self.assertFalse((root / ".ai-frame-animation/attempts").exists())
        return plan

    def decoded_fixture(self, root: Path) -> tuple[list[Path], dict, list[dict]]:
        decoded = root / "fixture-decoded"
        decoded.mkdir()
        paths, labels = [], []
        for index in range(CASE["source_frames"]):
            subject, annotation = moving_subject(index)
            colour = CASE["observed_backgrounds"][index % len(CASE["observed_backgrounds"])]
            path = decoded / f"source_{index:03d}.png"
            composite(subject, colour).save(path)
            paths.append(path)
            labels.append({**annotation, "observed_key_rgb": list(parse_hex_color(colour))})
        fps = Fraction(CASE["raw_fps"])
        probe = {"streams": [{"codec_type": "video", "avg_frame_rate": str(fps),
                              "duration_ts": str(len(paths)), "time_base": str(1 / fps)}],
                 "frames": [{"best_effort_timestamp_time": str(index / fps)} for index in range(len(paths))]}
        return paths, probe, labels

    def process(self, root: Path, paths: list[Path], probe: dict, output: str) -> dict:
        with patch("ai_frame_animation.processing.probe_video", return_value=probe) as probe_call, \
                patch("ai_frame_animation.processing.decode_video_once", return_value=paths) as decode_call, \
                patch("ai_frame_animation.cli.resolve_media_tool", return_value="fixture-tool"):
            report = self.cli("process", "--root", str(root), "--plan", "plan.json",
                              "--raw-video", "source.mp4", "--out-dir", output)
        probe_call.assert_called_once()
        decode_call.assert_called_once()
        self.assertEqual(probe_call.call_args.args[0], root.resolve() / "source.mp4")
        self.assertEqual(decode_call.call_args.args[0], root / "source.mp4")
        self.assertEqual(report["status"], "passed")
        return load_json(root / output / "delivery-manifest.json")

    def check_variant(self, delivery: Path, entry: dict, labels: list[dict], continuity: str) -> None:
        manifest = load_json(delivery / entry["manifest"]["path"])
        directory = (delivery / entry["manifest"]["path"]).parent
        count = entry["frame_count"]
        timeline = manifest["timeline"]
        indices = timeline["source_frame_index_map"]
        expected = ([i * 64 // count for i in range(count)] if continuity == "loop"
                    else [round(Fraction(i * 64, count - 1)) for i in range(count)])
        self.assertEqual(indices, expected)
        duration = Fraction(64 if continuity == "loop" else 65, 1) / Fraction(CASE["raw_fps"])
        self.assertEqual(fraction(timeline["playback_fps"]), count / duration)
        self.assertEqual([fraction(item) for item in timeline["source_timestamps_seconds"]],
                         [index / Fraction(CASE["raw_fps"]) for index in indices])
        self.assertEqual(fraction(timeline["semantic_duration_seconds"]), duration)
        alignment = manifest["processing"]["alignment"]
        fit = manifest["processing"]["subject_fit"]
        self.assertEqual(alignment["coordinate_space"], "source_pixels_before_shared_fit")
        crop, resized, offset = fit["source_crop_box"], fit["resize_size"], fit["offset_px"]
        with Image.open(directory / manifest["artifacts"]["spritesheet"]["path"]) as sheet, \
                Image.open(directory / manifest["artifacts"]["gif"]["path"]) as gif:
            preview = [frame.convert("RGBA") for frame in ImageSequence.Iterator(gif)]
            # All selected consecutive poses differ in this fixture.
            self.assertEqual(len(preview), count)
            atlas = load_json(directory / manifest["artifacts"]["atlas"]["path"])
            for output_index, source_index in enumerate(indices):
                with self.subTest(frame_count=count, source_index=source_index):
                    annotation = labels[source_index]
                    dx, dy = alignment["records"][output_index]["translate_px"]

                    def aligned(point):
                        # Transform the independent source-pixel annotations,
                        # including pixel centres, into the new shared canvas.
                        return tuple(round((point[axis] + (dx, dy)[axis] - crop[axis] + 0.5)
                                           * resized[axis] / (crop[axis + 2] - crop[axis])
                                           - 0.5 + offset[axis]) for axis in (0, 1))

                    evidence = manifest["processing"]["frames"][output_index]
                    self.assertEqual(evidence["source_index"], source_index)
                    self.assertEqual(evidence["matte"]["calibration"]["observed_key_rgb"], annotation["observed_key_rgb"])
                    with Image.open(directory / manifest["artifacts"]["frames"][output_index]["path"]) as png:
                        self.assertEqual(png.getpixel(aligned(annotation["hole"])), (0, 0, 0, 0))
                        self.assertEqual(png.getpixel(aligned(annotation["white"])), (255, 255, 255, 255))
                        edge = png.getpixel(aligned(annotation["edge"]))
                        self.assertGreater(edge[3], 0)
                        self.assertLess(edge[3], 255)
                        self.assertLessEqual(edge[1], max(edge[0], edge[2]))
                        # A cleared reference coordinate must not become a fixed video cutout.
                        fixed = labels[0]["hole"]
                        left, top, right, bottom = annotation["hole_rect"]
                        if fixed[0] < left - 1 or fixed[0] > right or not top <= fixed[1] <= bottom:
                            self.assertEqual(png.getpixel(aligned(fixed)), (*CASE["body_rgb"], 255))
                        pixels = np.asarray(png)
                        self.assertTrue(np.all(pixels[pixels[:, :, 3] == 0, :3] == 0))
                        rect = atlas["frames"][output_index]["rect"]
                        cell = sheet.crop((rect["x"], rect["y"], rect["x"] + rect["w"], rect["y"] + rect["h"]))
                        self.assertEqual(cell.tobytes(), png.tobytes())
                        # Check every pixel, including the soft inner edge: GIF is binary.
                        gif_alpha = np.asarray(preview[output_index])[:, :, 3]
                        self.assertTrue(np.array_equal(gif_alpha, np.where(pixels[:, :, 3] == 255, 255, 0)))

    def exercise(self, *, continuity: str, quality: str, rerun: bool = False) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            plan = self.prepare_and_plan(root, continuity, quality)
            raw = root / "source.mp4"
            raw.write_bytes(b"synthetic-fixture-not-a-real-video")
            original = raw.read_bytes()
            paths, probe, labels = self.decoded_fixture(root)
            family = self.process(root, paths, probe, "delivery")
            self.assertEqual(family["plan_sha256"], plan["plan_sha256"])
            self.assertEqual(family["raw_source"]["sha256"], fingerprint(raw, media_type="video")["sha256"])
            self.assertEqual(family["decode"]["probe_operation_count"], 1)
            self.assertEqual(family["decode"]["operation_count"], 1)
            self.assertEqual(family["decode"]["decoded_frame_count"], len(paths))
            self.assertEqual(fraction(family["source_timeline"]["raw_fps"]), Fraction(CASE["raw_fps"]))
            self.assertEqual(family["source_timeline"]["timestamps_source"], "ffprobe_frame_timestamps")
            self.assertEqual([item["frame_count"] for item in family["variants"]], [16, 32, 64])
            for entry in family["variants"]:
                self.check_variant(root / "delivery", entry, labels, continuity)
                variant = load_json(root / "delivery" / entry["manifest"]["path"])
                self.assertEqual(variant["raw_sha256"], family["raw_source"]["sha256"])
            validation = self.cli("validate", "--root", str(root), "--delivery", "delivery", "--policy", quality)
            self.assertEqual(validation["status"], "passed")
            with zipfile.ZipFile(root / "delivery/delivery.zip") as archive:
                files = {p.relative_to(root / "delivery").as_posix() for p in (root / "delivery").rglob("*")
                         if p.is_file() and p.name != "delivery.zip"}
                self.assertEqual(set(archive.namelist()), files)
                for name in files:
                    self.assertEqual(archive.read(name), (root / "delivery" / name).read_bytes())
            if rerun:
                self.assertEqual(self.process(root, paths, probe, "reprocessed"), family)
                self.assertEqual((root / "delivery/delivery.zip").read_bytes(),
                                 (root / "reprocessed/delivery.zip").read_bytes())
            self.assertEqual(raw.read_bytes(), original)
            self.assertFalse((root / ".ai-frame-animation/attempts").exists())

    def test_strict_loop_moving_holes_and_deterministic_reprocessing(self) -> None:
        self.exercise(continuity="loop", quality="strict", rerun=True)

    def test_best_effort_one_shot_preserves_same_alpha_contract(self) -> None:
        self.exercise(continuity="one_shot", quality="best_effort")

    def test_non_key_white_video_island_is_not_semantically_erased(self) -> None:
        subject, labels = moving_subject(0)
        source = composite(subject, CASE["declared_key"]).convert("RGBA")
        ImageDraw.Draw(source).rectangle(labels["hole_rect"], fill="white")
        output, _ = _rgba_frame(source, parse_hex_color(CASE["declared_key"]))
        self.assertEqual(output.getpixel(labels["hole"]), (255, 255, 255, 255))
        self.assertEqual(output.getpixel(labels["white"]), (255, 255, 255, 255))
        self.assertEqual(output.getpixel((0, 0)), (0, 0, 0, 0))


class GifTimelineRegressionTests(unittest.TestCase):
    def test_rational_boundaries_do_not_accumulate_rounding_error(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "preview.gif"
            rate = Fraction(CASE["raw_fps"])
            frames = [moving_subject(index)[0] for index in range(64)]
            export_preview_gif(images=frames, out_gif=path, fps=rate)
            elapsed = 0
            with Image.open(path) as gif:
                self.assertEqual(gif.n_frames, len(frames))
                for index, frame in enumerate(ImageSequence.Iterator(gif), start=1):
                    elapsed += frame.info["duration"]
                    # An independent rational oracle checks every boundary.
                    self.assertLessEqual(abs(elapsed - index * 1000 / rate), 5)
            _validate_gif(path, len(frames), rate)

    def test_coalesced_identical_frames_keep_total_duration(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "preview.gif"
            rate = Fraction(CASE["raw_fps"])
            for group_size in (8, 64):
                with self.subTest(group_size=group_size):
                    frames = [moving_subject(index // group_size)[0] for index in range(64)]
                    export_preview_gif(images=frames, out_gif=path, fps=rate)
                    with Image.open(path) as gif:
                        self.assertEqual(gif.n_frames, 64 // group_size)
                        elapsed = sum(frame.info["duration"] for frame in ImageSequence.Iterator(gif))
                    self.assertLessEqual(abs(elapsed - 64000 / rate), 5)
                    _validate_gif(path, len(frames), rate)

    def test_validator_rejects_accumulated_truncation_and_unrepresentable_export(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "preview.gif"
            frames = [moving_subject(index)[0] for index in range(64)]
            # Emulate the old 29.97-FPS export's 30-ms encoded frame duration.
            export_preview_gif(images=frames, out_gif=path, fps=Fraction(100, 3))
            with self.assertRaisesRegex(ValueError, "gif_duration_invalid"):
                _validate_gif(path, len(frames), Fraction(CASE["raw_fps"]))
            impossible = Path(temporary) / "impossible.gif"
            with self.assertRaisesRegex(PreviewGifError, "preview_timing_not_representable"):
                export_preview_gif(images=frames, out_gif=impossible, fps=120)
            self.assertFalse(impossible.exists())


if __name__ == "__main__":
    unittest.main()
