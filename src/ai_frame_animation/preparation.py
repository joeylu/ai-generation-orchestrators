"""Reference preparation before key selection, planning and video authorization."""

from __future__ import annotations

import math
import shutil
import stat
import time
import uuid
from collections import deque
from pathlib import Path, PurePosixPath, PureWindowsPath
from typing import Any, Mapping

import numpy as np
from PIL import Image, ImageOps

from . import __version__
from .canonical import SHA256_RE, fingerprint, load_json, relative_posix, rooted_path, safe_error_code, stamp_document, verify_document, write_json_atomic
from .media.reference_matte import inspect_matting_runtime, refine_reference_matte
from .media.reference_review import save_reference_review
from .media.segmentation import infer_foreground_mask, inspect_segmenter
from .media.spill import zero_transparent_rgb


def _file(root: Path, value: str | Path) -> Path:
    candidate = Path(value) if Path(value).is_absolute() else root / value
    resolved = rooted_path(root, value, must_exist=True)
    current = candidate
    while current != root:
        details = current.lstat()
        if stat.S_ISLNK(details.st_mode) or getattr(details, "st_file_attributes", 0) & getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0):
            raise ValueError("reference_preparation_path_unsafe")
        if current.parent == current:
            raise ValueError("reference_preparation_path_unsafe")
        current = current.parent
    if not resolved.is_file():
        raise ValueError("reference_preparation_file_invalid")
    return resolved


def _source_image(path: Path) -> Image.Image:
    with Image.open(path) as image:
        if getattr(image, "n_frames", 1) != 1:
            raise ValueError("reference_requires_one_still_image")
        if min(image.size) < 16:
            raise ValueError("reference_resolution_too_small")
        return ImageOps.exif_transpose(image).convert("RGBA")


def _has_foreground_alpha(image: Image.Image) -> bool:
    alpha = np.asarray(image.getchannel("A"))
    border = np.concatenate((alpha[0], alpha[-1], alpha[:, 0], alpha[:, -1]))
    return bool(np.any(alpha > 8) and np.mean(border <= 8) >= 0.95 and np.mean(alpha <= 8) >= 0.01)


def _has_source_foreground_alpha(image: Image.Image) -> bool:
    """Accept meaningful exterior transparency even when a subject touches edges.

    This only selects whether supplied alpha is preserved; it never edits a
    mask or decides which RGB pixels are background. Keep the stricter fitted
    output check separate. A single transparent pixel, enclosed hole, or merely
    translucent opaque canvas is not evidence of a supplied cutout.
    """
    if _has_foreground_alpha(image):
        return True
    alpha = np.asarray(image.getchannel("A"))
    clear = alpha <= 8
    required = math.ceil(alpha.size * 0.01)
    if not np.any(alpha > 8) or np.count_nonzero(clear) < required:
        return False
    reached = np.zeros(clear.shape, dtype=bool)
    reached[0], reached[-1] = clear[0], clear[-1]
    reached[:, 0], reached[:, -1] = clear[:, 0], clear[:, -1]
    count = int(np.count_nonzero(reached))
    if count >= required:
        return True
    pending = deque(zip(*np.nonzero(reached)))
    height, width = clear.shape
    while pending:
        y, x = pending.popleft()
        for ny, nx in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):
            if 0 <= ny < height and 0 <= nx < width and clear[ny, nx] and not reached[ny, nx]:
                reached[ny, nx] = True
                count += 1
                if count >= required:
                    return True
                pending.append((ny, nx))
    return False


def inspect_preparation(root: Path, reference: str | Path, config_path: Path | None = None) -> dict:
    """Static routing only: opaque input is accepted, inference is not preflight."""
    accepted = False
    try:
        image = _source_image(_file(root.resolve(strict=True), reference))
        if not np.any(np.asarray(image.getchannel("A")) > 8):
            raise ValueError("reference_has_no_visible_subject")
        accepted = True
        method = "existing_alpha" if _has_source_foreground_alpha(image) else "local_segmentation"
        evidence = {} if method == "existing_alpha" else dict(inspect_segmenter(config_path))
        if evidence.get("backend") == "onnx_birefnet_isnet_enclosed":
            method = "local_segmentation_fusion"
        return {"status": "ready", "diagnostic_code": "ready", "method": method,
                "source_accepted": True, "prepared_quality": "not_checked", **evidence}
    except (OSError, ValueError) as exc:
        return {"status": "action_required", "diagnostic_code": safe_error_code(exc), "source_accepted": accepted}


def _fit_foreground(image: Image.Image) -> tuple[Image.Image, dict]:
    alpha = np.asarray(image.getchannel("A"))
    visible = alpha > 8
    if not np.any(visible):
        raise ValueError("reference_segmentation_foreground_empty")
    if np.mean(alpha <= 8) < 0.01:
        raise ValueError("reference_segmentation_background_unresolved")
    if np.mean(visible) < 0.001:
        raise ValueError("reference_segmentation_foreground_too_small")
    border = np.concatenate((alpha[0], alpha[-1], alpha[:, 0], alpha[:, -1]))
    warnings = ["source_subject_touches_edge"] if np.any(border > 8) else []
    if min(image.size) < 128:
        warnings.append("source_resolution_low")
    if np.mean((alpha > 8) & (alpha < 247)) > 0.3:
        warnings.append("foreground_matte_uncertain")
    # Retain all nonzero alpha (not just the alignment threshold), including
    # fine soft edges; crop empty canvas, never synthesize missing character.
    bbox = image.getchannel("A").getbbox()
    assert bbox is not None
    cropped = image.crop(bbox)
    available = (max(1, round(image.width * 0.84)), max(1, round(image.height * 0.84)))
    scale = min(1.0, available[0] / cropped.width, available[1] / cropped.height)
    fitted = cropped.resize((max(1, round(cropped.width * scale)), max(1, round(cropped.height * scale))), Image.Resampling.LANCZOS)
    canvas = Image.new("RGBA", image.size)
    canvas.paste(fitted, ((image.width - fitted.width) // 2, (image.height - fitted.height) // 2))
    zero_transparent_rgb(canvas)
    return canvas, {"warnings": warnings, "source_bbox": list(bbox), "contain_scale": scale,
                    "visible_fraction": float(np.mean(visible)), "visual_review_required": True}


def _staging_identity(path: Path) -> tuple[int, int]:
    details = path.lstat()
    if not stat.S_ISDIR(details.st_mode) or getattr(details, "st_file_attributes", 0) & getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0):
        raise ValueError("reference_preparation_staging_changed")
    return details.st_dev, details.st_ino


def _publish_preparation(root: Path, staged: Path, out: Path, identity: tuple[int, int]) -> None:
    """Retry only a bounded Windows rename of this unchanged owned directory.

    No inference, artifact rewrite, replacement, permission changes or provider
    retry happens here. Ordinary POSIX permission errors are not transient.
    """
    def artifacts() -> dict:
        values = {}
        for path in sorted(staged.rglob("*")):
            details = path.lstat()
            if stat.S_ISLNK(details.st_mode) or getattr(details, "st_file_attributes", 0) & getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0):
                raise ValueError("reference_preparation_staging_changed")
            if path.is_file():
                values[path.relative_to(staged).as_posix()] = fingerprint(_file(root, path))
        return values

    expected = artifacts()
    delays = (0.05, 0.15, 0.30)
    for attempt in range(len(delays) + 1):
        # Recheck before every attempt: another writer may have published while
        # we waited. lstat also detects dangling links instead of following them.
        try:
            out.lstat()
        except FileNotFoundError:
            pass
        else:
            raise ValueError("reference_preparation_output_exists")
        if (staged.parent != out.parent or rooted_path(root, staged, must_exist=True) != staged
                or rooted_path(root, out) != out or _staging_identity(staged) != identity):
            raise ValueError("reference_preparation_staging_changed")
        if artifacts() != expected:
            raise ValueError("reference_preparation_staging_changed")
        try:
            staged.rename(out)
            return
        except OSError as exc:
            if getattr(exc, "winerror", None) not in {5, 32, 33}:
                raise ValueError("reference_preparation_publish_failed") from exc
            if attempt == len(delays):
                raise ValueError("reference_preparation_publish_busy") from exc
            time.sleep(delays[attempt])


def prepare_reference(*, root: Path, reference: str | Path, out_dir: str | Path, config_path: Path | None = None) -> dict[str, Any]:
    root = root.resolve(strict=True)
    source = _file(root, reference)
    out = rooted_path(root, out_dir)
    if out.exists():
        raise ValueError("reference_preparation_output_exists")
    original = fingerprint(source, media_type="image")
    image = _source_image(source)
    if not np.any(np.asarray(image.getchannel("A")) > 8):
        raise ValueError("reference_has_no_visible_subject")
    matting = {"method": "existing_alpha", "runtime_version": None,
               "alpha_policy": "preserve_source", "decontaminated_pixels": 0}
    matte_warnings = []
    fusion_masks = fusion_evidence = None
    if _has_source_foreground_alpha(image):
        method, evidence = "existing_alpha", {}
    else:
        method = "local_segmentation"
        # Missing dependencies are setup issues, checked before CPU inference.
        inspect_matting_runtime()
        from .media.dual_segmentation import is_dual_config, infer_dual_masks
        if is_dual_config(config_path):
            method = "local_segmentation_fusion"
            mask, evidence, fusion_masks, fusion_evidence = infer_dual_masks(image, config_path)
        else:
            mask, evidence = infer_foreground_mask(image, config_path)
        if mask.mode != "L" or mask.size != image.size:
            raise ValueError("reference_segmentation_mask_invalid")
        image, matting, matte_warnings = refine_reference_matte(image, mask)
        if fusion_masks is not None:
            matting["alpha_policy"] = "preserve_source_times_fused_mask"
    zero_transparent_rgb(image)
    foreground, quality = _fit_foreground(image)
    quality["warnings"] = sorted(set(quality["warnings"] + matte_warnings))
    if fingerprint(source, media_type="image") != original:
        raise ValueError("reference_changed_during_preparation")
    out.parent.mkdir(parents=True, exist_ok=True)
    staged = out.with_name(f".{out.name}.{uuid.uuid4().hex}.preparing")
    staged.mkdir()
    staging_identity = _staging_identity(staged)
    try:
        image.save(staged / "cutout.png")
        foreground.save(staged / "foreground.png")
        save_reference_review(foreground, staged / "review")
        extra = {}
        if fusion_masks is not None:
            artifacts = {}
            for name, mask in fusion_masks.items():
                filename = f"{name}-mask.png"
                mask.save(staged / filename)
                artifacts[name] = {"path": relative_posix(root, out / filename), **fingerprint(staged / filename, media_type="image")}
            extra = {"masks": artifacts, "fusion": fusion_evidence}
        report = stamp_document({
            "schema_version": "ai_frame_animation_reference_preparation_v6" if fusion_masks is not None else "ai_frame_animation_reference_preparation_v4",
            "source": {"path": relative_posix(root, source), **original},
            "cutout": {"path": relative_posix(root, out / "cutout.png"), **fingerprint(staged / "cutout.png", media_type="image")},
            "foreground": {"path": relative_posix(root, out / "foreground.png"), **fingerprint(staged / "foreground.png", media_type="image")},
            "method": method, "tool_version": __version__, "segmentation": evidence,
            "quality": quality, "matting": matting, **extra,
        }, "preparation_sha256")
        write_json_atomic(staged / "preparation.json", report)
        _publish_preparation(root, staged, out, staging_identity)
        return report
    except Exception as error:
        # Delete only this call's still-owned staging tree. Never clean a path
        # replaced by a concurrent writer or hide the original error with a raw
        # cleanup exception containing local paths.
        try:
            if rooted_path(root, staged, must_exist=True) != staged or _staging_identity(staged) != staging_identity:
                raise ValueError("reference_preparation_staging_changed")
            shutil.rmtree(staged)
        except (OSError, ValueError):
            raise ValueError(f"{safe_error_code(error)}:staging_cleanup_failed") from error
        raise


def load_preparation(root: Path, path: str | Path, *, _seen: tuple[Path, ...] = ()) -> dict[str, Any]:
    root = root.resolve(strict=True)
    path = _file(root, path)
    if path in _seen or len(_seen) >= 16:
        raise ValueError("reference_preparation_cycle_or_depth_limit")
    report = load_json(path)
    verify_document(report, "preparation_sha256")
    version = report.get("schema_version")
    if version == "ai_frame_animation_reference_preparation_v6":
        from .fusion_preparation import load_fused_preparation
        return load_fused_preparation(root, report)
    if version == "ai_frame_animation_reference_preparation_v5":
        from .correction import load_corrected_preparation
        return load_corrected_preparation(root, path, report, (*_seen, path))
    fields = {"schema_version", "source", "foreground", "method", "tool_version", "segmentation", "quality", "preparation_sha256"}
    current = version == "ai_frame_animation_reference_preparation_v4"
    if current:
        fields.add("cutout")
    if version in ("ai_frame_animation_reference_preparation_v2", "ai_frame_animation_reference_preparation_v3") or current:
        fields.add("matting")
    if set(report) != fields or version not in ("ai_frame_animation_reference_preparation_v1", "ai_frame_animation_reference_preparation_v2", "ai_frame_animation_reference_preparation_v3", "ai_frame_animation_reference_preparation_v4"):
        raise ValueError("reference_preparation_contract_invalid")
    for name in (("source", "cutout", "foreground") if current else ("source", "foreground")):
        artifact = report[name]
        if not isinstance(artifact, Mapping) or set(artifact) != {"path", "bytes", "sha256", "media_type"}:
            raise ValueError("reference_preparation_artifact_invalid")
        value = artifact["path"]
        if not isinstance(value, str) or not value or "\\" in value or PureWindowsPath(value).drive or PurePosixPath(value).is_absolute() or ".." in PurePosixPath(value).parts:
            raise ValueError("reference_preparation_path_unsafe")
        actual = fingerprint(_file(root, value), media_type="image")
        if actual != {key: artifact[key] for key in actual}:
            raise ValueError("reference_preparation_artifact_changed")
    if report["method"] not in {"existing_alpha", "local_segmentation"}:
        raise ValueError("reference_preparation_method_invalid")
    evidence = report["segmentation"]
    if report["method"] == "existing_alpha":
        if evidence != {}:
            raise ValueError("reference_preparation_segmentation_invalid")
    elif (
        not isinstance(evidence, Mapping)
        or set(evidence) != {"backend", "model_sha256", "execution", "runtime_version"}
        or evidence["backend"] != ("onnx_birefnet" if current else "onnx_u2net") or evidence["execution"] != "local_cpu"
        or not isinstance(evidence["model_sha256"], str) or not SHA256_RE.fullmatch(evidence["model_sha256"])
        or not isinstance(evidence["runtime_version"], str) or not evidence["runtime_version"]
    ):
        raise ValueError("reference_preparation_segmentation_invalid")
    quality = report["quality"]
    if not isinstance(quality, Mapping) or set(quality) != {"warnings", "source_bbox", "contain_scale", "visible_fraction", "visual_review_required"} or quality.get("visual_review_required") is not True or not isinstance(quality.get("warnings"), list):
        raise ValueError("reference_preparation_quality_invalid")
    if any(code not in {"source_subject_touches_edge", "source_resolution_low", "foreground_matte_uncertain", "foreground_recovery_requires_review", "background_hint_requires_review"} for code in quality["warnings"]):
        raise ValueError("reference_preparation_quality_invalid")
    for key in ("contain_scale", "visible_fraction"):
        value = quality[key]
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or not 0 < value <= 1:
            raise ValueError("reference_preparation_quality_invalid")
    bbox = quality["source_bbox"]
    if not isinstance(bbox, list) or len(bbox) != 4 or any(type(value) is not int or value < 0 for value in bbox) or bbox[0] >= bbox[2] or bbox[1] >= bbox[3]:
        raise ValueError("reference_preparation_quality_invalid")
    image = _source_image(_file(root, report["foreground"]["path"]))
    if not _has_foreground_alpha(image):
        raise ValueError("reference_preparation_foreground_invalid")
    if current:
        _validate_current_matting(report["matting"], report["method"], image.size)
    elif version != "ai_frame_animation_reference_preparation_v1":
        _validate_matting(report["matting"], report["method"], image.size, with_hints=version == "ai_frame_animation_reference_preparation_v3")
    if version == "ai_frame_animation_reference_preparation_v3" and "background_hint_requires_review" not in quality["warnings"]:
        raise ValueError("reference_preparation_quality_invalid")
    return report


def _validate_current_matting(matting: Any, preparation_method: str, size: tuple[int, int]) -> None:
    if not isinstance(matting, Mapping) or set(matting) != {"method", "runtime_version", "alpha_policy", "decontaminated_pixels"}:
        raise ValueError("reference_preparation_matting_invalid")
    existing = preparation_method == "existing_alpha"
    if (matting["method"] != ("existing_alpha" if existing else "foreground_ml_v1")
            or matting["alpha_policy"] != ("preserve_source" if existing else "preserve_mask")
            or type(matting["decontaminated_pixels"]) is not int
            or not 0 <= matting["decontaminated_pixels"] <= size[0] * size[1]):
        raise ValueError("reference_preparation_matting_invalid")
    if existing:
        if matting["runtime_version"] is not None or matting["decontaminated_pixels"] != 0:
            raise ValueError("reference_preparation_matting_invalid")
    elif not isinstance(matting["runtime_version"], str) or not matting["runtime_version"]:
        raise ValueError("reference_preparation_matting_invalid")


def _legacy_background_points(points, size: tuple[int, int]) -> list[list[int]]:
    """Validate v3 evidence only. No current writer or point-guided processor."""
    if not isinstance(points, list) or len(points) > 64:
        raise ValueError("reference_background_point_invalid")
    for point in points:
        if (not isinstance(point, list) or len(point) != 2
                or any(type(value) is not int for value in point)
                or not 0 <= point[0] < size[0] or not 0 <= point[1] < size[1]):
            raise ValueError("reference_background_point_invalid")
    return [list(point) for point in sorted({tuple(point) for point in points})]


def _validate_matting(matting: Any, preparation_method: str, size: tuple[int, int], *, with_hints: bool) -> None:
    pixels = size[0] * size[1]
    counts = {"restored_pixels", "cleared_pixels", "decontaminated_pixels"}
    if with_hints:
        counts.add("confirmed_background_pixels")
    fields = counts | {"method", "background_rgb"}
    if with_hints:
        fields.add("background_points")
    if not isinstance(matting, Mapping) or set(matting) != fields:
        raise ValueError("reference_preparation_matting_invalid")
    method = matting["method"]
    methods = {"uniform_background_seeded_v1"} if with_hints else {"existing_alpha", "semantic_mask_v1", "uniform_background_v1"}
    if not isinstance(method, str) or method not in methods:
        raise ValueError("reference_preparation_matting_invalid")
    if (method == "existing_alpha") != (preparation_method == "existing_alpha"):
        raise ValueError("reference_preparation_matting_invalid")
    if any(type(matting[key]) is not int or not 0 <= matting[key] <= pixels for key in counts):
        raise ValueError("reference_preparation_matting_invalid")
    colour = matting["background_rgb"]
    if method in {"uniform_background_v1", "uniform_background_seeded_v1"}:
        if not isinstance(colour, list) or len(colour) != 3 or any(type(c) is not int or not 0 <= c <= 255 for c in colour):
            raise ValueError("reference_preparation_matting_invalid")
    elif colour is not None or any(matting[key] != 0 for key in counts):
        raise ValueError("reference_preparation_matting_invalid")
    if with_hints:
        try:
            points = _legacy_background_points(matting["background_points"], size)
        except ValueError as exc:
            raise ValueError("reference_preparation_matting_invalid") from exc
        if not points or points != matting["background_points"] or matting["confirmed_background_pixels"] < len(points):
            raise ValueError("reference_preparation_matting_invalid")
