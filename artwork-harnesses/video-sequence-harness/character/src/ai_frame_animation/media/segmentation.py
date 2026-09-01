"""Optional local foreground-mask inference; no download or GPU selection."""

from __future__ import annotations

import hashlib
import importlib.util
from pathlib import Path
from typing import Any, Mapping

import numpy as np
from PIL import Image

from ..canonical import SHA256_RE, load_json, sha256_file
from .reference_matte import inspect_matting_runtime


BACKEND = "onnx_birefnet"


def segmentation_config(path: Path | None) -> tuple[Path, str]:
    if path is None:
        raise ValueError("reference_segmentation_setup_required")
    value = load_json(path)
    if isinstance(value, Mapping) and value.get("backend") == "onnx_u2net":
        raise ValueError("reference_segmentation_backend_retired")
    if not isinstance(value, Mapping) or set(value) != {"backend", "model_path", "model_sha256"} or value.get("backend") != BACKEND:
        raise ValueError("reference_segmentation_config_invalid")
    digest = value.get("model_sha256")
    if not isinstance(digest, str) or not SHA256_RE.fullmatch(digest):
        raise ValueError("reference_segmentation_digest_invalid")
    model_value = value.get("model_path")
    if not isinstance(model_value, str) or not model_value:
        raise ValueError("reference_segmentation_model_missing")
    model = Path(model_value)
    model = model if model.is_absolute() else path.resolve(strict=True).parent / model
    if not model.is_file() or model.is_symlink():
        raise ValueError("reference_segmentation_model_missing")
    if sha256_file(model) != digest:
        raise ValueError("reference_segmentation_model_digest_mismatch")
    return model, digest


def inspect_segmenter(path: Path | None) -> Mapping[str, Any]:
    from .dual_segmentation import is_dual_config, inspect_dual_segmenter
    if is_dual_config(path):
        return inspect_dual_segmenter(path)
    _model, digest = segmentation_config(path)
    # Do not import a runtime, construct a session, download or execute a model.
    if importlib.util.find_spec("onnxruntime") is None:
        raise ValueError("reference_segmentation_runtime_missing")
    inspect_matting_runtime()
    return {"backend": BACKEND, "model_sha256": digest, "execution": "local_cpu"}


def infer_foreground_mask(image: Image.Image, config_path: Path | None) -> tuple[Image.Image, dict]:
    model, digest = segmentation_config(config_path)
    return infer_birefnet_mask(image, model, digest)


def infer_birefnet_mask(image: Image.Image, model: Path, digest: str) -> tuple[Image.Image, dict]:
    """Execute one already configured profile from exactly verified bytes."""
    try:
        import onnxruntime as ort
    except ImportError as exc:
        raise ValueError("reference_segmentation_runtime_missing") from exc
    # Load exactly the verified bytes, not a path whose contents might change
    # between verification and session creation. Only self-contained ONNX files.
    model_bytes = model.read_bytes()
    if hashlib.sha256(model_bytes).hexdigest() != digest:
        raise ValueError("reference_segmentation_model_digest_mismatch")
    try:
        options = ort.SessionOptions()
        ort.disable_telemetry_events()
        options.intra_op_num_threads = 4
        options.inter_op_num_threads = 1
        session = ort.InferenceSession(model_bytes, sess_options=options, providers=["CPUExecutionProvider"])
        session.disable_fallback()
        if session.get_providers() != ["CPUExecutionProvider"]:
            raise ValueError("reference_segmentation_cpu_required")
        inputs = session.get_inputs()
        if len(inputs) != 1 or inputs[0].type != "tensor(float)" or inputs[0].shape != [1, 3, 1024, 1024]:
            raise ValueError("reference_segmentation_model_contract_invalid")
        # BiRefNet General profile, matched to rembg 2.0.81 acceptance: RGB
        # Lanczos 1024, image-max normalization in float64, then float32 NCHW.
        pixels = np.asarray(image.convert("RGB").resize((1024, 1024), Image.Resampling.LANCZOS))
        pixels = pixels / max(float(pixels.max()), 1e-6)
        pixels = (pixels - np.array([0.485, 0.456, 0.406])) / np.array([0.229, 0.224, 0.225])
        tensor = pixels.transpose(2, 0, 1)[None].astype(np.float32)
        outputs = session.run(None, {inputs[0].name: tensor})
    except ValueError as exc:
        if str(exc) in {"reference_segmentation_cpu_required", "reference_segmentation_model_contract_invalid"}:
            raise
        raise ValueError("reference_segmentation_inference_failed") from exc
    except Exception as exc:
        raise ValueError("reference_segmentation_inference_failed") from exc
    if not outputs:
        raise ValueError("reference_segmentation_mask_invalid")
    prediction = np.asarray(outputs[0])
    if prediction.shape != (1, 1, 1024, 1024) or prediction.dtype != np.float32 or not np.isfinite(prediction).all():
        raise ValueError("reference_segmentation_mask_invalid")
    with np.errstate(over="ignore"):
        values = 1 / (1 + np.exp(-prediction[0, 0]))
    low, high = float(values.min()), float(values.max())
    if high - low < 1e-6:
        raise ValueError("reference_segmentation_mask_ambiguous")
    coverage = np.clip((values - low) / (high - low), 0, 1)
    # Upstream floors here; rounding would change the accepted edge mask.
    mask = Image.fromarray((coverage * 255).astype(np.uint8)).resize(image.size, Image.Resampling.LANCZOS)
    return mask, {"backend": BACKEND, "model_sha256": digest, "execution": "local_cpu", "runtime_version": str(ort.__version__)}
