from __future__ import annotations

import contextlib
import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from PIL import Image, ImageDraw

from ai_frame_animation.canonical import write_json_atomic
from ai_frame_animation.cli import main
from ai_frame_animation.planning import compile_plan
from ai_frame_animation.processing import _rgba_frame, _resize_rgba, process_from_decoded
from ai_frame_animation.providers.base import GenerationNotSubmitted
from ai_frame_animation.providers.minimax_h3 import MiniMaxH3Provider
from ai_frame_animation.validation import _validate_rgba, validate_delivery
from tests.test_process_delivery import make_plan


FIXTURE = Path(__file__).parent / "fixtures/golden/input-delivery-cases.json"


def reference(*, opaque: bool = False) -> Image.Image:
    image = Image.new("RGBA", (32, 32), "white" if opaque else (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    draw.rectangle((10, 8, 21, 25), fill=(220, 220, 220, 255), outline="black")
    draw.rectangle((13, 11, 17, 15), fill="white")
    if not opaque:
        image.putpixel((9, 12), (220, 220, 220, 128))
    return image


def provider_fixture(root: Path) -> MiniMaxH3Provider:
    write_json_atomic(root / "workflow.json", {
        "1": {"inputs": {"image": ""}, "class_type": "LoadImage"},
        "2": {"inputs": {"text": ""}, "class_type": "Text"},
    })
    write_json_atomic(root / "config.json", {
        "base_url": "http://127.0.0.1:8188",
        "workflow_path": "workflow.json",
        "bindings": {"reference_image": {"node": "1", "input": "image"},
                     "positive_prompt": {"node": "2", "input": "text"}},
    })
    return MiniMaxH3Provider(config_path=root / "config.json", root=root)


class InputDeliveryRegressionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.cases = json.loads(FIXTURE.read_text(encoding="utf-8"))["cases"]







    def test_reference_preparation_preserves_white_and_continuous_alpha(self) -> None:
        from ai_frame_animation.media.reference import prepare_generation_reference

        source = reference()
        original = source.tobytes()
        output = prepare_generation_reference(source, "#00FF00")
        self.assertEqual(output.mode, "RGB")
        self.assertEqual(output.getpixel((0, 0)), (0, 255, 0))
        self.assertEqual(output.getpixel((14, 12)), (255, 255, 255))
        expected = Image.alpha_composite(Image.new("RGBA", source.size, (0, 255, 0, 255)), source).convert("RGB")
        self.assertEqual(output.tobytes(), expected.tobytes())
        self.assertEqual(source.tobytes(), original)

    def test_opaque_white_reference_is_not_automatically_erased(self) -> None:
        from ai_frame_animation.media.reference import prepare_generation_reference

        source = reference(opaque=True)
        original = source.tobytes()
        with self.assertRaisesRegex(ValueError, "reference_preparation_required"):
            prepare_generation_reference(source, "#00FF00")
        self.assertEqual(source.tobytes(), original)

    def test_tiny_alpha_hole_does_not_disguise_an_opaque_canvas(self) -> None:
        from ai_frame_animation.media.reference import prepare_generation_reference

        source = reference(opaque=True)
        source.putpixel((16, 16), (0, 0, 0, 0))
        with self.assertRaisesRegex(ValueError, "reference_preparation_required"):
            prepare_generation_reference(source, "#00FF00")

    def test_reference_rejects_empty_and_accepts_matching_key_only(self) -> None:
        from ai_frame_animation.media.reference import prepare_generation_reference

        for empty in (Image.new("RGBA", (8, 8)), Image.new("RGB", (8, 8), (0, 255, 0))):
            with self.subTest(mode=empty.mode), self.assertRaisesRegex(ValueError, "reference_has_no_visible_subject"):
                prepare_generation_reference(empty, "#00FF00")
        keyed = Image.alpha_composite(Image.new("RGBA", (32, 32), (0, 255, 0, 255)), reference()).convert("RGB")
        self.assertEqual(prepare_generation_reference(keyed, "#00FF00").tobytes(), keyed.tobytes())
        with self.assertRaisesRegex(ValueError, "reference_preparation_required"):
            prepare_generation_reference(keyed, "#0000FF")

    def test_provider_rejects_white_reference_before_any_network(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            reference(opaque=True).save(root / "reference.png")
            provider = provider_fixture(root)
            plan = {"character": {"reference": "reference.png"}, "delivery": {"key_color": "#00FF00"},
                    "generation": {"prompt": "run in place"}}
            with patch.object(provider, "_upload_reference") as upload, patch.object(provider, "_post_json") as submit:
                with self.assertRaisesRegex(GenerationNotSubmitted, "reference_preparation_required"):
                    provider.submit_once(plan, "fixture-token")
            upload.assert_not_called()
            submit.assert_not_called()

    def test_provider_uploads_prepared_png_without_touching_original(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            reference().save(root / "reference.png")
            original = (root / "reference.png").read_bytes()
            provider = provider_fixture(root)
            requests = []

            def capture(request):
                requests.append(request)
                return {"name": "prepared.png"}

            plan = {"character": {"reference": "reference.png"}, "delivery": {"key_color": "#00FF00"},
                    "generation": {"prompt": "run in place"}}
            with patch.object(provider, "_open_json", side_effect=capture), patch.object(provider, "_post_json", return_value={"prompt_id": "one"}) as submit:
                self.assertEqual(provider.submit_once(plan, "fixture-token"), "one")
            payload = requests[0].data.split(b"\r\n\r\n", 1)[1].split(b"\r\n--", 1)[0]
            with Image.open(io.BytesIO(payload)) as uploaded:
                self.assertEqual(uploaded.format, "PNG")
                self.assertEqual(uploaded.getpixel((0, 0)), (0, 255, 0))
                self.assertEqual(uploaded.getpixel((14, 12)), (255, 255, 255))
            self.assertEqual((root / "reference.png").read_bytes(), original)
            self.assertEqual(submit.call_count, 1)

    def test_provider_rejects_direct_crop_and_mismatched_padding_before_upload(self) -> None:
        from ai_frame_animation.canonical import load_json

        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            reference().save(root / "reference.png")
            provider = provider_fixture(root)
            workflow = load_json(root / "workflow.json")
            plan = {"character": {"reference": "reference.png"}, "delivery": {"key_color": "#00FF00"},
                    "generation": {"prompt": "run"}}
            for fit, colour, expected in (("crop", "0,255,0", "reference_resize_requires_aspect_preserving_pad"),
                                           ("pad", "0,0,0", "reference_padding_key_mismatch")):
                with self.subTest(fit=fit, colour=colour):
                    workflow["3"] = {"class_type": "ImageResizeKJv2", "inputs": {
                        "image": ["1", 0], "keep_proportion": fit, "pad_color": colour}}
                    write_json_atomic(root / "workflow.json", workflow)
                    self.assertEqual(provider.preflight(plan)["diagnostic_code"], expected)
                    with patch.object(provider, "_upload_reference") as upload, patch.object(provider, "_post_json") as submit:
                        with self.assertRaisesRegex(GenerationNotSubmitted, expected):
                            provider.submit_once(plan, "fixture-token")
                    upload.assert_not_called()
                    submit.assert_not_called()

    def test_doctor_plan_rejects_reference_without_media_or_network(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            reference(opaque=True).save(root / "reference.png")
            provider_fixture(root)
            job = {"schema_version": "1.0", "job_id": "fixture", "character": {"reference": "reference.png"},
                   "motion": {"request": "run", "continuity": "loop"},
                   "delivery": {"frame_counts": [16], "size": 128, "quality": "strict", "gif": False},
                   "provider": {"plugin": "minimax_h3"}}
            write_json_atomic(root / "plan.json", compile_plan(job, root))
            before = {p.name: p.read_bytes() for p in root.iterdir()}
            output = io.StringIO()
            with patch("ai_frame_animation.providers.minimax_h3.urlopen", side_effect=AssertionError("no network")), patch("ai_frame_animation.cli.resolve_media_tool", return_value="fixture-tool"), contextlib.redirect_stdout(output):
                code = main(["doctor", "--root", str(root), "--provider", "minimax_h3", "--provider-config", str(root / "config.json"), "--plan", "plan.json", "--require-ready"])
            self.assertEqual(code, 1)
            report = json.loads(output.getvalue())
            self.assertEqual(report["input_preflight"]["diagnostic_code"], "reference_preparation_required")
            self.assertEqual(report["capabilities"]["generation"], "action_required")
            self.assertEqual({p.name: p.read_bytes() for p in root.iterdir()}, before)

    def test_doctor_requires_plan_then_accepts_verified_alpha_without_writes(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            reference().save(root / "reference.png")
            provider_fixture(root)
            job = {"schema_version": "1.0", "job_id": "fixture", "character": {"reference": "reference.png"},
                   "motion": {"request": "run", "continuity": "loop"},
                   "delivery": {"frame_counts": [16], "size": 128, "quality": "strict", "gif": False},
                   "provider": {"plugin": "minimax_h3"}}
            write_json_atomic(root / "plan.json", compile_plan(job, root))
            before = {p.name: p.read_bytes() for p in root.iterdir()}
            command = ["doctor", "--root", str(root), "--provider", "minimax_h3", "--provider-config", str(root / "config.json"), "--require-ready"]
            with patch("ai_frame_animation.providers.minimax_h3.urlopen", side_effect=AssertionError("no network")), patch("ai_frame_animation.cli.resolve_media_tool", return_value="fixture-tool"):
                output = io.StringIO()
                with contextlib.redirect_stdout(output):
                    self.assertEqual(main(command), 1)
                self.assertEqual(json.loads(output.getvalue())["input_preflight"]["diagnostic_code"], "plan_required_for_input_preflight")
                output = io.StringIO()
                with contextlib.redirect_stdout(output):
                    self.assertEqual(main([*command, "--plan", "plan.json"]), 0)
                self.assertEqual(json.loads(output.getvalue())["input_preflight"]["status"], "ready")
            self.assertEqual({p.name: p.read_bytes() for p in root.iterdir()}, before)




if __name__ == "__main__":
    unittest.main()
