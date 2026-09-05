import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from PIL import Image

from ai_frame_animation.handoff import load_decoded_handoff
from ai_frame_animation.media.frames import DiskFrames, check_pixel_budget
from ai_frame_animation.processing import process_decoded_handoff, _rgba_frame
from test_decoded_handoff import build_fixture


class OfflineResumeTests(unittest.TestCase):
    def test_headers_checked_before_any_pixel_decode_and_slices_stay_lazy(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            paths = [root / f"{i}.png" for i in range(3)]
            for path in paths: Image.new("RGBA", (16, 16)).save(path)
            with patch.object(Image.Image, "convert", side_effect=AssertionError("eager decode")):
                frames = DiskFrames(paths)
                self.assertIsInstance(frames[:2], DiskFrames)
                self.assertEqual(len(frames), 3)
            with patch("ai_frame_animation.media.frames.MAX_SOURCE_PIXELS", 700):
                with self.assertRaisesRegex(ValueError, "pixel_budget"):
                    DiskFrames(paths)
        for dimensions in [(8192, 8192, 1), (2048, 2048, 100), (32, 32, 10001)]:
            with self.assertRaisesRegex(ValueError, "pixel_budget"):
                check_pixel_budget(*dimensions)

    def test_interruption_resumes_only_verified_frames_and_delivery_is_identical(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); fixture = build_fixture(root)
            from ai_frame_animation.canonical import stamp_document
            fixture["plan"]["delivery"]["gif"] = True
            fixture["plan"] = stamp_document(fixture["plan"], "plan_sha256")
            handoff = load_decoded_handoff(root, fixture["handoff_path"], raw_video=fixture["raw"])
            cache = root / ".cache"
            def run(name, checkpoint=cache):
                return process_decoded_handoff(root=root, plan=fixture["plan"], handoff=handoff,
                    out_dir=root / name, key_color=fixture["plan"]["delivery"]["key_color"], checkpoint_root=checkpoint)
            counter = 0
            def interrupt(*args, **kwargs):
                nonlocal counter
                counter += 1
                if counter == 4: raise ValueError("fixture_interrupted")
                return _rgba_frame(*args, **kwargs)
            with patch("ai_frame_animation.processing._rgba_frame", side_effect=interrupt):
                with self.assertRaisesRegex(ValueError, "fixture_interrupted"): run("interrupted")
            self.assertFalse((root / "interrupted").exists())
            with patch("ai_frame_animation.processing._rgba_frame", wraps=_rgba_frame) as work:
                family = run("resumed")
                native_count = family["semantic_interval"]["native_frame_count"]
                self.assertEqual(work.call_count, native_count - 3)
            with patch("ai_frame_animation.processing._rgba_frame", side_effect=AssertionError("cache miss")):
                run("cached")
            run("fresh", None)
            self.assertEqual((root / "fresh/delivery.zip").read_bytes(), (root / "resumed/delivery.zip").read_bytes())
            self.assertEqual((root / "cached/delivery.zip").read_bytes(), (root / "resumed/delivery.zip").read_bytes())
            next(cache.glob("*/0.png")).write_bytes(b"corrupt-cache-fixture")
            with patch("ai_frame_animation.processing._rgba_frame", wraps=_rgba_frame) as work:
                run("repaired")
                self.assertEqual(work.call_count, 1)
            self.assertEqual((root / "fresh/delivery.zip").read_bytes(), (root / "repaired/delivery.zip").read_bytes())
            with patch("ai_frame_animation.processing.PILLOW_VERSION", "fixture-new-version"), \
                 patch("ai_frame_animation.processing._rgba_frame", wraps=_rgba_frame) as work:
                run("dependencies-changed")
                self.assertEqual(work.call_count, native_count)
            # A changed plan cannot reuse the old frame evidence.
            fixture["plan"]["motion"]["request"] = "changed fixture intent"
            with patch("ai_frame_animation.processing._rgba_frame", wraps=_rgba_frame) as work:
                run("changed")
                self.assertEqual(work.call_count, native_count)

    def test_cache_cannot_be_inside_delivery(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); fixture = build_fixture(root, frame_counts=[16])
            handoff = load_decoded_handoff(root, fixture["handoff_path"], raw_video=fixture["raw"])
            with self.assertRaisesRegex(ValueError, "checkpoint_overlaps_delivery"):
                process_decoded_handoff(root=root, plan=fixture["plan"], handoff=handoff,
                    out_dir=root / "delivery", key_color="#00FF00", checkpoint_root=root / "delivery/cache")

    def test_internal_decode_budget_fails_before_ffmpeg(self):
        from ai_frame_animation.processing import process_video
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); raw = root / "raw.mp4"; raw.write_bytes(b"fixture")
            probe = {"streams": [{"width": 8192, "height": 8192}], "frames": [{"pts_time": "0"}]}
            with patch("ai_frame_animation.processing.probe_video", return_value=probe), \
                 patch("ai_frame_animation.processing.decode_video_once", side_effect=AssertionError("decode forbidden")):
                with self.assertRaisesRegex(ValueError, "pixel_budget"):
                    process_video(root=root, plan={"motion": {"continuity": "one_shot"}}, raw_video=raw,
                        out_dir=root / "delivery", key_color="#00FF00")
