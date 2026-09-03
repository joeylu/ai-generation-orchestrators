from __future__ import annotations

import base64
import contextlib
import io
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

import numpy as np
import httpx
from PIL import Image, ImageDraw

from ai_image_background_removal.fal_provider import ENDPOINT_ID, INPUT_TRANSPORT, FalBiRefNetV2ForegroundProvider, _safe_provider_error_code
from ai_image_background_removal.cli import main
from ai_image_background_removal.handoff import load_preparation_handoff
from ai_image_background_removal.preparation import load_preparation, prepare_reference
from ai_image_background_removal.provider_plan import authorize_once, build_plan, mark_attempt
from reference_doubles import foreground_double


def data_uri(image: Image.Image) -> str:
    stream = io.BytesIO()
    image.save(stream, format="PNG")
    return "data:image/png;base64," + base64.b64encode(stream.getvalue()).decode("ascii")


class FakeFalClient:
    def __init__(self, foreground: Image.Image, *, failure: Exception | None = None) -> None:
        self.foreground = foreground
        self.failure = failure
        self.calls: list[tuple[str, dict, bool]] = []

    def subscribe(self, endpoint: str, *, arguments: dict, with_logs: bool):
        self.calls.append((endpoint, arguments, with_logs))
        if self.failure is not None:
            raise self.failure
        return {"image": {"url": data_uri(self.foreground)}}


def source(root: Path) -> Path:
    path = root / "source.png"
    Image.new("RGB", (96, 64), "white").save(path)
    return path


def foreground() -> Image.Image:
    value = Image.new("RGBA", (96, 64))
    ImageDraw.Draw(value).rectangle((24, 8, 71, 55), fill=(80, 100, 120, 255))
    value.putpixel((23, 32), (40, 50, 60, 128))
    return value


class FalProviderTests(unittest.TestCase):
    def test_provider_requests_one_inline_refined_foreground(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            path = source(root)
            client = FakeFalClient(foreground())
            result, evidence = FalBiRefNetV2ForegroundProvider(client).infer_foreground(path, (96, 64))
            np.testing.assert_array_equal(np.asarray(result), np.asarray(foreground()))
            self.assertEqual(evidence, {"backend": "external_foreground_v1", "profile": "general_light_1024_refined_foreground_v1", "execution": "remote"})
            self.assertEqual(len(client.calls), 1)
            endpoint, arguments, logs = client.calls[0]
            self.assertEqual(endpoint, ENDPOINT_ID)
            self.assertFalse(logs)
            encoded_source = arguments.pop("image_url")
            self.assertTrue(encoded_source.startswith("data:image/png;base64,"))
            self.assertEqual(base64.b64decode(encoded_source.partition(",")[2]), path.read_bytes())
            self.assertEqual(arguments, {
                "model": "General Use (Light)", "operating_resolution": "1024x1024",
                "mask_only": False, "output_mask": False, "refine_foreground": True, "sync_mode": True,
                "output_format": "png",
            })

    def test_matting_2048_profile_is_explicit_and_plan_bound(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            path = source(root)
            client = FakeFalClient(foreground())
            provider = FalBiRefNetV2ForegroundProvider(
                client, profile="matting_2048_refined_foreground_v1"
            )
            _result, evidence = provider.infer_foreground(path, (96, 64))
            arguments = client.calls[0][1]
            self.assertEqual(arguments["model"], "Matting")
            self.assertEqual(arguments["operating_resolution"], "2048x2048")
            self.assertEqual(evidence["profile"], "matting_2048_refined_foreground_v1")
            default = build_plan(root=root, reference="source.png", out_dir="default")
            matting = build_plan(
                root=root, reference="source.png", out_dir="default",
                profile="matting_2048_refined_foreground_v1",
            )
            self.assertNotEqual(default["plan_sha256"], matting["plan_sha256"])
            self.assertEqual(matting["provider_profile"], "matting_2048_refined_foreground_v1")
            self.assertEqual(matting["provider_input_transport"], INPUT_TRANSPORT)

    def test_source_rgb_profile_uses_returned_mask_without_local_matting(self) -> None:
        class MaskClient(FakeFalClient):
            def subscribe(self, endpoint: str, *, arguments: dict, with_logs: bool):
                result = super().subscribe(endpoint, arguments=arguments, with_logs=with_logs)
                value = Image.new("L", (96, 64))
                ImageDraw.Draw(value).rectangle((24, 8, 71, 55), fill=128)
                result["mask_image"] = {"url": data_uri(value)}
                return result

        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            path = source(root)
            client = MaskClient(foreground())
            provider = FalBiRefNetV2ForegroundProvider(
                client, profile="matting_2048_source_rgb_mask_v1"
            )
            result, evidence = provider.infer_foreground(path, (96, 64))
            pixels = np.asarray(result)
            self.assertEqual(tuple(pixels[16, 32]), (255, 255, 255, 128))
            self.assertEqual(tuple(pixels[0, 0]), (0, 0, 0, 0))
            self.assertTrue(client.calls[0][1]["output_mask"])
            self.assertEqual(evidence["profile"], "matting_2048_source_rgb_mask_v1")

    def test_dynamic_2304_profile_is_explicit_and_plan_bound(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            path = source(root)
            client = FakeFalClient(foreground())
            provider = FalBiRefNetV2ForegroundProvider(
                client, profile="dynamic_2304_refined_foreground_v1"
            )
            _result, evidence = provider.infer_foreground(path, (96, 64))
            arguments = client.calls[0][1]
            self.assertEqual(arguments["model"], "General Use (Dynamic)")
            self.assertEqual(arguments["operating_resolution"], "2304x2304")
            plan = build_plan(
                root=root, reference="source.png", out_dir="dynamic",
                profile="dynamic_2304_refined_foreground_v1",
            )
            self.assertEqual(plan["provider_profile"], evidence["profile"])

    def test_official_2k_profiles_are_explicit_and_plan_bound(self) -> None:
        expected = {
            "general_light_2k_2048_refined_foreground_v1": "General Use (Light 2K)",
            "general_heavy_2048_refined_foreground_v1": "General Use (Heavy)",
        }
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            path = source(root)
            for profile, model in expected.items():
                with self.subTest(profile=profile):
                    client = FakeFalClient(foreground())
                    provider = FalBiRefNetV2ForegroundProvider(client, profile=profile)
                    _result, evidence = provider.infer_foreground(path, (96, 64))
                    arguments = client.calls[0][1]
                    self.assertEqual(arguments["model"], model)
                    self.assertEqual(arguments["operating_resolution"], "2048x2048")
                    plan = build_plan(root=root, reference="source.png", out_dir=profile, profile=profile)
                    self.assertEqual(plan["provider_profile"], evidence["profile"])

    def test_provider_rejects_remote_or_non_mask_output(self) -> None:
        class Remote(FakeFalClient):
            def subscribe(self, *args, **kwargs):
                return {"image": {"url": "https://fixture.invalid/mask.png"}}
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            path = source(root)
            with self.assertRaisesRegex(ValueError, "output_not_inline_png"):
                FalBiRefNetV2ForegroundProvider(Remote(foreground())).infer_foreground(path, (96, 64))
            coloured = Image.new("RGB", (96, 64), (1, 2, 3))
            with self.assertRaisesRegex(ValueError, "provider_foreground_invalid"):
                FalBiRefNetV2ForegroundProvider(FakeFalClient(coloured)).infer_foreground(path, (96, 64))

    def test_provider_failure_is_indeterminate_and_not_retried(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            path = source(root)
            client = FakeFalClient(foreground(), failure=RuntimeError("private transport detail"))
            with self.assertRaisesRegex(ValueError, "^reference_provider_attempt_indeterminate$"):
                FalBiRefNetV2ForegroundProvider(client).infer_foreground(path, (96, 64))
            self.assertEqual(len(client.calls), 1)

    def test_provider_failures_are_safely_classified_without_response_details(self) -> None:
        class HttpFailure(RuntimeError):
            def __init__(self, status_code: int) -> None:
                super().__init__("private response URL and body")
                self.status_code = status_code

        expected = {
            401: "reference_provider_authentication_failed",
            403: "reference_provider_authentication_failed",
            402: "reference_provider_credit_required",
            413: "reference_provider_input_too_large",
            422: "reference_provider_input_rejected",
            429: "reference_provider_rate_limited",
            503: "reference_provider_unavailable",
        }
        for status_code, code in expected.items():
            with self.subTest(status_code=status_code):
                self.assertEqual(_safe_provider_error_code(HttpFailure(status_code)), code)
        self.assertEqual(_safe_provider_error_code(TimeoutError("private request id")), "reference_provider_timeout")
        self.assertEqual(
            _safe_provider_error_code(httpx.ConnectError("private host")),
            "reference_provider_connection_failed",
        )
        self.assertEqual(
            _safe_provider_error_code(httpx.RemoteProtocolError("private response")),
            "reference_provider_protocol_failed",
        )
        self.assertEqual(
            _safe_provider_error_code(httpx.ReadError("private response")),
            "reference_provider_transport_failed",
        )
        self.assertEqual(_safe_provider_error_code(RuntimeError("private detail")), "reference_provider_attempt_indeterminate")

    def test_plan_authorization_is_digest_bound_and_single_use(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source(root)
            plan = build_plan(root=root, reference="source.png", out_dir="prepared")
            with self.assertRaisesRegex(ValueError, "confirmation_mismatch"):
                authorize_once(root=root, plan=plan, confirmation="0" * 64)
            state = authorize_once(root=root, plan=plan, confirmation=plan["plan_sha256"])
            mark_attempt(state, status="succeeded")
            with self.assertRaisesRegex(ValueError, "authorization_already_used"):
                authorize_once(root=root, plan=plan, confirmation=plan["plan_sha256"])

    def test_failed_static_preflight_does_not_consume_authorization(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source(root)
            plan = build_plan(root=root, reference="source.png", out_dir="prepared")
            provider = Mock()
            provider.inspect.return_value = {"status": "action_required"}
            with patch("ai_image_background_removal.cli.FalBiRefNetV2ForegroundProvider", return_value=provider), \
                    contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
                result = main([
                    "prepare", "--root", str(root), "--reference", "source.png",
                    "--out-dir", "prepared", "--confirm-plan-sha256", plan["plan_sha256"],
                ])
            self.assertEqual(result, 2)
            provider.infer_foreground.assert_not_called()
            self.assertFalse((root / ".ai-image-background-removal").exists())

    def test_provider_mask_uses_existing_postprocessing_and_handoff(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source(root)
            with foreground_double():
                report = prepare_reference(
                    root=root, reference="source.png", out_dir="prepared",
                    foreground_provider=FalBiRefNetV2ForegroundProvider(FakeFalClient(foreground())),
                )
            self.assertEqual(report["schema_version"], "ai_frame_animation_reference_preparation_v8")
            self.assertEqual(report["method"], "external_segmentation")
            self.assertEqual(report["matting"]["method"], "provider_foreground_v1")
            self.assertEqual(load_preparation(root, "prepared/preparation.json"), report)
            handoff = load_preparation_handoff(root, "prepared/handoff.json")
            self.assertEqual(handoff["foreground"], report["foreground"])


if __name__ == "__main__":
    unittest.main()
