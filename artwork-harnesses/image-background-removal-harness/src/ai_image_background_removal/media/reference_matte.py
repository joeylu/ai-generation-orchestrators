"""Reference foreground-colour estimation; never reclassify or erode the mask.

The optional CPU PyMatting estimator matches the decontamination candidate.
No old U2-Net colour recovery, point-guided flood fill, alpha matting, download,
or fallback. Video colour-key processing is a separate module.
"""
from __future__ import annotations

import importlib.metadata
import importlib.util

import numpy as np
from PIL import Image


def inspect_matting_runtime() -> None:
    # Readiness is static; importing PyMatting can initialize JIT compilation.
    if importlib.util.find_spec("pymatting") is None:
        raise ValueError("reference_matting_runtime_missing")


def load_foreground_estimator():
    try:
        from pymatting.foreground.estimate_foreground_ml import estimate_foreground_ml
        version = importlib.metadata.version("pymatting")
    except ImportError as exc:
        raise ValueError("reference_matting_runtime_missing") from exc
    return estimate_foreground_ml, version


def refine_reference_matte(image: Image.Image, mask: Image.Image) -> tuple[Image.Image, dict, list[str]]:
    if mask.mode != "L" or mask.size != image.size:
        raise ValueError("reference_segmentation_mask_invalid")
    source = np.array(image.convert("RGBA"))
    prior = np.asarray(mask)
    # Preserve supplied source transparency even outside the existing-alpha route.
    alpha = ((source[..., 3].astype(np.uint16) * prior + 127) // 255).astype(np.uint8)
    if not np.any(alpha > 8):
        raise ValueError("reference_segmentation_foreground_empty")
    if np.mean(alpha <= 8) < 0.01:
        raise ValueError("reference_segmentation_background_unresolved")
    estimator, version = load_foreground_estimator()
    try:
        foreground = np.asarray(estimator(source[..., :3] / 255.0, alpha / 255.0))
    except Exception as exc:
        raise ValueError("reference_decontamination_failed") from exc
    if foreground.shape != source[..., :3].shape or not np.issubdtype(foreground.dtype, np.floating) or not np.isfinite(foreground).all():
        raise ValueError("reference_decontamination_invalid")
    # Match candidate RGB quantization. Do not erode white cloth, re-estimate
    # alpha, or promote segmentation confidence=254 to opaque=255.
    rgb = np.clip(foreground * 255, 0, 255).astype(np.uint8)
    changed = int(np.count_nonzero((alpha > 0) & np.any(rgb != source[..., :3], axis=2)))
    source[..., :3], source[..., 3] = rgb, alpha
    source[alpha == 0, :3] = 0
    return Image.fromarray(source), {
        "method": "foreground_ml_v1", "runtime_version": version,
        "alpha_policy": "preserve_mask", "decontaminated_pixels": changed,
    }, []
