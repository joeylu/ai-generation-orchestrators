"""Deterministic resource admission policy for image preparation.

The policy intentionally describes no host telemetry or queue implementation.
Those belong to the caller's scheduler, while this package must remain a
provider-neutral single-image CLI.
"""

from __future__ import annotations


# 8 MP keeps the full-resolution RGB/matte arrays bounded on ordinary CPU hosts.
MAX_DECODED_PIXELS = 8_388_608
# The accepted BiRefNet General graph is about 973 MB, so it remains admissible.
MAX_MODEL_BYTES = 1_073_741_824
OPAQUE_PREPARATION_CONCURRENCY = 1
ONNX_INTRA_OP_THREADS = 4


def require_decoded_pixel_budget(size: tuple[int, int]) -> None:
    width, height = size
    if width * height > MAX_DECODED_PIXELS:
        raise ValueError("reference_resolution_too_large")


def require_model_byte_budget(size: int) -> None:
    if size > MAX_MODEL_BYTES:
        raise ValueError("reference_segmentation_model_too_large")


def resource_policy() -> dict[str, int | str]:
    """Public, host-neutral scheduling facts for an upstream orchestrator."""

    return {
        "schema_version": "ai_image_background_removal_resource_policy_v2",
        "max_decoded_pixels": MAX_DECODED_PIXELS,
        "remote_preparation_concurrency": OPAQUE_PREPARATION_CONCURRENCY,
        "remote_scheduling": "external_serial_required",
    }
