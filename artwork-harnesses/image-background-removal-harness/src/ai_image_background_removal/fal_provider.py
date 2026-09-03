"""fal.ai BiRefNet V2 transparent-foreground adapter.

The public preparation artifacts deliberately contain no request id, upload URL,
credential, or provider response. Those values are transport state, not portable
background-removal evidence.
"""

from __future__ import annotations

import base64
import binascii
import importlib.metadata
import importlib.util
import io
import mimetypes
import os
from pathlib import Path
from typing import Any, Mapping

import numpy as np
from PIL import Image, ImageOps


ENDPOINT_ID = "fal-ai/birefnet/v2"
INPUT_TRANSPORT = "inline_data_uri_v1"
DEFAULT_PROFILE_ID = "general_light_1024_refined_foreground_v1"
PROFILE_ID = DEFAULT_PROFILE_ID
PROFILES = {
    DEFAULT_PROFILE_ID: {
        "model": "General Use (Light)",
        "operating_resolution": "1024x1024",
    },
    "general_light_2k_2048_refined_foreground_v1": {
        "model": "General Use (Light 2K)",
        "operating_resolution": "2048x2048",
    },
    "general_heavy_2048_refined_foreground_v1": {
        "model": "General Use (Heavy)",
        "operating_resolution": "2048x2048",
    },
    "matting_2048_refined_foreground_v1": {
        "model": "Matting",
        "operating_resolution": "2048x2048",
    },
    "matting_2048_source_rgb_mask_v1": {
        "model": "Matting",
        "operating_resolution": "2048x2048",
        "output_mask": True,
    },
    "dynamic_2304_refined_foreground_v1": {
        "model": "General Use (Dynamic)",
        "operating_resolution": "2304x2304",
    },
}
_COMMON_ARGUMENTS = {
    "mask_only": False, "output_mask": False, "refine_foreground": True,
    "sync_mode": True, "output_format": "png",
}


def runtime_report() -> dict[str, object]:
    """Inspect local client setup only; never probe fal or expose the key."""

    installed = importlib.util.find_spec("fal_client") is not None
    credential = bool(os.environ.get("FAL_KEY"))
    version: str | None = None
    if installed:
        try:
            version = importlib.metadata.version("fal-client")
        except importlib.metadata.PackageNotFoundError:
            version = "unknown"
    return {
        "status": "ready" if installed and credential else "action_required",
        "client": "fal-client",
        "client_version": version,
        "credential": "configured" if credential else "missing",
        "network_probe": "not_performed",
        "provider_compute": "not_performed",
    }


def _client() -> Any:
    if not os.environ.get("FAL_KEY"):
        raise ValueError("reference_provider_credential_missing")
    try:
        import fal_client
    except ImportError as exc:
        raise ValueError("reference_provider_runtime_missing") from exc
    return fal_client


def _inline_png(value: object) -> bytes:
    if not isinstance(value, str) or not value.startswith("data:image/png;base64,"):
        raise ValueError("reference_provider_output_not_inline_png")
    try:
        data = base64.b64decode(value.partition(",")[2], validate=True)
    except (ValueError, binascii.Error) as exc:
        raise ValueError("reference_provider_output_invalid") from exc
    if not data or len(data) > 128 * 1024 * 1024:
        raise ValueError("reference_provider_output_invalid")
    return data


def _source_data_uri(source: Path) -> str:
    """Encode the immutable local source without using fal's storage upload."""

    mime_type, _encoding = mimetypes.guess_type(source.name)
    if mime_type not in {"image/jpeg", "image/png", "image/webp"}:
        raise ValueError("reference_provider_input_media_type_invalid")
    try:
        data = source.read_bytes()
    except OSError as exc:
        raise ValueError("reference_provider_input_read_failed") from exc
    if not data or len(data) > 32 * 1024 * 1024:
        raise ValueError("reference_provider_input_size_invalid")
    return f"data:{mime_type};base64," + base64.b64encode(data).decode("ascii")


def _safe_provider_error_code(exc: Exception) -> str:
    """Classify transport failures without retaining private response details."""

    status_code = getattr(exc, "status_code", None)
    if status_code in {401, 403}:
        return "reference_provider_authentication_failed"
    if status_code == 402:
        return "reference_provider_credit_required"
    if status_code == 413:
        return "reference_provider_input_too_large"
    if status_code == 422:
        return "reference_provider_input_rejected"
    if status_code == 429:
        return "reference_provider_rate_limited"
    if isinstance(status_code, int) and 500 <= status_code <= 599:
        return "reference_provider_unavailable"
    exception_types = {
        (type(value).__module__, type(value).__name__)
        for value in (exc, exc.__cause__, exc.__context__)
        if isinstance(value, BaseException)
    }
    if isinstance(exc, TimeoutError) or any(name.endswith("TimeoutError") for _module, name in exception_types):
        return "reference_provider_timeout"
    if any(
        module.startswith(("httpx", "httpcore")) and name == "ConnectError"
        for module, name in exception_types
    ):
        return "reference_provider_connection_failed"
    if any(
        module.startswith(("httpx", "httpcore")) and name.endswith("ProtocolError")
        for module, name in exception_types
    ):
        return "reference_provider_protocol_failed"
    if any(
        module.startswith(("httpx", "httpcore"))
        and name in {"NetworkError", "ReadError", "WriteError", "CloseError"}
        for module, name in exception_types
    ):
        return "reference_provider_transport_failed"
    return "reference_provider_attempt_indeterminate"


def _decode_foreground(data: bytes, expected_size: tuple[int, int]) -> Image.Image:
    try:
        with Image.open(io.BytesIO(data)) as image:
            if image.format != "PNG" or getattr(image, "n_frames", 1) != 1 or image.size != expected_size:
                raise ValueError("reference_provider_foreground_invalid")
            pixels = np.asarray(image.convert("RGBA")).copy()
    except (OSError, ValueError) as exc:
        if str(exc) == "reference_provider_foreground_invalid":
            raise
        raise ValueError("reference_provider_foreground_invalid") from exc
    if pixels.ndim != 3 or pixels.shape[2] != 4:
        raise ValueError("reference_provider_foreground_invalid")
    alpha = pixels[..., 3]
    if not np.any(alpha > 8) or np.mean(alpha <= 8) < 0.01:
        raise ValueError("reference_provider_foreground_invalid")
    pixels[alpha == 0, :3] = 0
    return Image.fromarray(pixels)


def _decode_mask(data: bytes, expected_size: tuple[int, int]) -> Image.Image:
    try:
        with Image.open(io.BytesIO(data)) as image:
            if image.format != "PNG" or getattr(image, "n_frames", 1) != 1 or image.size != expected_size:
                raise ValueError("reference_provider_mask_invalid")
            rgb = np.asarray(image.convert("RGB"))
    except (OSError, ValueError) as exc:
        if str(exc) == "reference_provider_mask_invalid":
            raise
        raise ValueError("reference_provider_mask_invalid") from exc
    if (rgb.ndim != 3 or rgb.shape[2] != 3
            or not np.array_equal(rgb[..., 0], rgb[..., 1])
            or not np.array_equal(rgb[..., 1], rgb[..., 2])):
        raise ValueError("reference_provider_mask_invalid")
    alpha = rgb[..., 0]
    if not np.any(alpha > 8) or np.mean(alpha <= 8) < 0.01:
        raise ValueError("reference_provider_mask_invalid")
    return Image.fromarray(alpha)


def _source_rgb_with_mask(source: Path, mask: Image.Image) -> Image.Image:
    with Image.open(source) as opened:
        rgba = np.asarray(ImageOps.exif_transpose(opened).convert("RGBA")).copy()
    prior = np.asarray(mask)
    rgba[..., 3] = ((rgba[..., 3].astype(np.uint16) * prior + 127) // 255).astype(np.uint8)
    rgba[rgba[..., 3] == 0, :3] = 0
    return Image.fromarray(rgba)


class FalBiRefNetV2ForegroundProvider:
    """Submit one fal BiRefNet V2 request and materialize its RGBA foreground."""

    def __init__(self, client: Any | None = None, *, profile: str = DEFAULT_PROFILE_ID) -> None:
        if profile not in PROFILES:
            raise ValueError("reference_provider_profile_invalid")
        self._injected_client = client
        self.profile = profile

    def inspect(self) -> Mapping[str, object]:
        return runtime_report()

    def infer_foreground(self, source: Path, expected_size: tuple[int, int]) -> tuple[Image.Image, Mapping[str, object]]:
        client = self._injected_client if self._injected_client is not None else _client()
        source_uri = _source_data_uri(source)
        try:
            result = client.subscribe(
                ENDPOINT_ID,
                arguments={**_COMMON_ARGUMENTS, **PROFILES[self.profile], "image_url": source_uri},
                with_logs=False,
            )
        except Exception as exc:
            raise ValueError(_safe_provider_error_code(exc)) from exc
        if not isinstance(result, Mapping):
            raise ValueError("reference_provider_output_invalid")
        if self.profile == "matting_2048_source_rgb_mask_v1":
            mask_image = result.get("mask_image")
            if not isinstance(mask_image, Mapping):
                raise ValueError("reference_provider_output_invalid")
            mask = _decode_mask(_inline_png(mask_image.get("url")), expected_size)
            foreground = _source_rgb_with_mask(source, mask)
        else:
            image = result.get("image")
            if not isinstance(image, Mapping):
                raise ValueError("reference_provider_output_invalid")
            foreground = _decode_foreground(_inline_png(image.get("url")), expected_size)
        return foreground, {
            "backend": "external_foreground_v1",
            "profile": self.profile,
            "execution": "remote",
        }
