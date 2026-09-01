"""Explicit, digest-confirmed local colour-key correction; never automatic prepare.

Coordinates use the EXIF-oriented original/cutout, not the fitted foreground.
The ordinary semantic mask remains unchanged unless this separate tool is used.
"""
from __future__ import annotations

import math
import os
import shutil
import stat
import uuid
from pathlib import Path, PurePosixPath, PureWindowsPath
from typing import Any, Mapping

import numpy as np
from PIL import Image, ImageOps

from . import __version__
from .canonical import fingerprint, load_json, relative_posix, rooted_path, safe_error_code, stamp_document, verify_document, write_json_atomic
from .media.matte import color_key_to_rgba
from .preparation import _file, _fit_foreground, _publish_preparation, _source_image, _staging_identity, load_preparation

PREVIEW_VERSION = "ai_frame_animation_reference_correction_preview_v1"
PREPARATION_VERSION = "ai_frame_animation_reference_preparation_v5"
ALGORITHM = "scoped_color_key_v1"
ARTIFACTS = ("cutout.png", "foreground.png", "changes.png", "before-purple-512.png",
             "after-purple-512.png", "detail-source-512.png", "detail-before-512.png",
             "detail-after-512.png", "detail-before-black-512.png", "detail-after-black-512.png")


def _binding(root: Path, path: Path) -> dict:
    return {"path": relative_posix(root, path), **fingerprint(_file(root, path))}


def _bound_file(root: Path, value: Any) -> Path:
    if not isinstance(value, Mapping) or set(value) != {"path", "bytes", "sha256"}:
        raise ValueError("reference_correction_binding_invalid")
    text = value["path"]
    if (not isinstance(text, str) or not text or "\\" in text or PureWindowsPath(text).drive
            or PurePosixPath(text).is_absolute() or ".." in PurePosixPath(text).parts):
        raise ValueError("reference_correction_path_unsafe")
    path = _file(root, text)
    if type(value["bytes"]) is not int or _binding(root, path) != value:
        raise ValueError("reference_correction_artifact_changed")
    return path


def _output(root: Path, value: str | Path) -> Path:
    lexical = Path(value) if Path(value).is_absolute() else root / value
    out = rooted_path(root, lexical)
    if out == root or ".." in lexical.parts:
        raise ValueError("reference_correction_path_unsafe")
    current = Path(os.path.abspath(lexical))
    while True:
        try:
            details = current.lstat()
        except FileNotFoundError:
            pass
        else:
            if stat.S_ISLNK(details.st_mode) or getattr(details, "st_file_attributes", 0) & getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0):
                raise ValueError("reference_correction_path_unsafe")
            if current == lexical:
                raise ValueError("reference_correction_output_exists")
            try:
                if current.samefile(root):
                    break
            except OSError as exc:
                raise ValueError("reference_correction_path_unsafe") from exc
        if current.parent == current:
            raise ValueError("reference_correction_path_unsafe")
        current = current.parent
    return out


def _publish(root: Path, out: Path, writer, recheck) -> dict:
    _output(root, out)
    out.parent.mkdir(parents=True, exist_ok=True)
    staged = out.with_name(f".{out.name}.{uuid.uuid4().hex}.preparing")
    staged.mkdir()
    identity = _staging_identity(staged)
    try:
        report = writer(staged)
        recheck()
        _publish_preparation(root, staged, out, identity)
        return report
    except Exception as error:
        try:
            if rooted_path(root, staged, must_exist=True) != staged or _staging_identity(staged) != identity:
                raise ValueError("reference_correction_staging_changed")
            shutil.rmtree(staged)
        except (OSError, ValueError):
            raise ValueError(f"{safe_error_code(error)}:staging_cleanup_failed") from error
        raise


def _parameters(region, point, tolerance, softness, size) -> dict:
    if (not isinstance(region, (list, tuple)) or len(region) != 4
            or any(type(n) is not int for n in region)
            or not 0 <= region[0] < region[2] <= size[0]
            or not 0 <= region[1] < region[3] <= size[1]):
        raise ValueError("reference_correction_region_invalid")
    if (region[2]-region[0]) * (region[3]-region[1]) > size[0]*size[1]*0.05:
        raise ValueError("reference_correction_region_too_large")
    if (not isinstance(point, (list, tuple)) or len(point) != 2
            or any(type(n) is not int for n in point)
            or not region[0] <= point[0] < region[2] or not region[1] <= point[1] < region[3]):
        raise ValueError("reference_correction_point_invalid")
    for value in (tolerance, softness):
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or not 0 <= value <= 64:
            raise ValueError("reference_correction_threshold_invalid")
    return dict(algorithm=ALGORITHM, region=list(region), background_point=list(point),
                tolerance=float(tolerance), softness=float(softness))


def _calculate(source: Image.Image, before: Image.Image, parameters: Mapping) -> tuple[dict[str, Image.Image], dict]:
    if set(parameters) != {"algorithm", "region", "background_point", "tolerance", "softness"} or parameters["algorithm"] != ALGORITHM:
        raise ValueError("reference_correction_parameters_invalid")
    p = _parameters(parameters["region"], parameters["background_point"], parameters["tolerance"], parameters["softness"], source.size)
    if before.size != source.size:
        raise ValueError("reference_correction_size_mismatch")
    old, original = np.asarray(before), np.asarray(source)
    if np.any(old[old[..., 3] == 0, :3]):
        raise ValueError("reference_correction_parent_hidden_rgb")
    px, py = p["background_point"]
    if original[py, px, 3] != 255 or old[py, px, 3] <= 8:
        raise ValueError("reference_correction_point_not_opaque_residue")
    x0, y0, x1, y1 = p["region"]
    key = tuple(int(n) for n in original[py, px, :3])
    local = original[y0:y1, x0:x1].copy()
    local[..., 3] = np.minimum(local[..., 3], old[y0:y1, x0:x1, 3])
    keyed, _ = color_key_to_rgba(Image.fromarray(local), key_color=key,
        tolerance=p["tolerance"], softness=p["softness"], color_space="rgb")
    replacement = np.asarray(keyed)
    changed_local = replacement[..., 3] < old[y0:y1, x0:x1, 3]
    if not np.any(changed_local):
        raise ValueError("reference_correction_no_change")
    result = old.copy()
    result[y0:y1, x0:x1][changed_local] = replacement[changed_local]
    changed = np.any(result != old, axis=2)
    # The candidate never rewrites RGB or alpha outside the explicit rectangle.
    changed_map = Image.fromarray(changed.astype(np.uint8) * 255)
    cutout = Image.fromarray(result)
    foreground, quality = _fit_foreground(cutout)
    quality["warnings"] = sorted(set(quality["warnings"] + ["local_correction_requires_review"]))
    visible = result[..., 3] > 0
    return {"cutout.png": cutout, "foreground.png": foreground, "changes.png": changed_map}, dict(
        key_rgb=list(key), changed_pixels=int(changed.sum()),
        removed_pixels=int(np.count_nonzero(changed & ~visible)),
        softened_pixels=int(np.count_nonzero(changed & visible)), quality=quality,
        coordinates="original_exif_oriented_cutout", outside_region="byte_identical")


def _review_images(source, before, images, parameters) -> dict[str, Image.Image]:
    def panel(image, rgb=(138, 64, 208), *, enlarge=False):
        tile = (ImageOps.contain(image, (512, 512), Image.Resampling.NEAREST) if enlarge
                else ImageOps.contain(image, (512, 512), Image.Resampling.LANCZOS))
        canvas = Image.new("RGBA", (512, 512), (*rgb, 255))
        canvas.alpha_composite(tile, ((512-tile.width)//2, (512-tile.height)//2))
        return canvas.convert("RGB")
    previous, _ = _fit_foreground(before)
    views = {"before-purple-512.png": panel(previous), "after-purple-512.png": panel(images["foreground.png"])}
    x0, y0, x1, y1 = parameters["region"]
    side = max(64, 2*max(x1-x0, y1-y0))
    cx, cy = (x0+x1)//2, (y0+y1)//2
    bounds = (cx-side//2, cy-side//2, cx-side//2+side, cy-side//2+side)
    for tag, image in (("source", source), ("before", before), ("after", images["cutout.png"])):
        views[f"detail-{tag}-512.png"] = panel(image.crop(bounds), enlarge=True)
        if tag != "source":
            views[f"detail-{tag}-black-512.png"] = panel(image.crop(bounds), (0, 0, 0), enlarge=True)
    return views


def _parent(root, path, seen=()):
    report = load_preparation(root, path, _seen=seen)
    if report["schema_version"] not in {"ai_frame_animation_reference_preparation_v4", "ai_frame_animation_reference_preparation_v6", "ai_frame_animation_reference_preparation_v7", PREPARATION_VERSION}:
        raise ValueError("reference_correction_requires_current_cutout")
    return report


def preview_correction(*, root: Path, prepared_reference, region, background_point, out_dir,
                       tolerance=16.0, softness=16.0) -> dict:
    root = root.resolve(strict=True)
    out = _output(root, out_dir)
    parent_path = _file(root, prepared_reference)
    parent_binding = _binding(root, parent_path)
    parent = _parent(root, parent_path)
    source = _source_image(_file(root, parent["source"]["path"]))
    before = _source_image(_file(root, parent["cutout"]["path"]))
    parameters = _parameters(region, background_point, tolerance, softness, source.size)
    images, result = _calculate(source, before, parameters)
    images.update(_review_images(source, before, images, parameters))

    def recheck():
        if _binding(root, parent_path) != parent_binding or _parent(root, parent_path) != parent:
            raise ValueError("reference_correction_parent_changed")

    def writer(staged):
        artifacts = {}
        for name in ARTIFACTS:
            images[name].save(staged / name)
            artifacts[name] = {"path": relative_posix(root, out / name), **fingerprint(staged / name)}
        report = stamp_document(dict(schema_version=PREVIEW_VERSION, tool_version=__version__,
            parent=parent_binding, parent_preparation_sha256=parent["preparation_sha256"],
            parameters=parameters, result=result, artifacts=artifacts), "correction_sha256")
        write_json_atomic(staged / "correction.json", report)
        return report

    return _publish(root, out, writer, recheck)


def load_correction_preview(root: Path, path, *, _seen=()) -> tuple[dict, dict]:
    root = root.resolve(strict=True)
    path = _file(root, path)
    preview = load_json(path)
    verify_document(preview, "correction_sha256")
    if (set(preview) != {"schema_version", "tool_version", "parent", "parent_preparation_sha256", "parameters", "result", "artifacts", "correction_sha256"}
            or preview["schema_version"] != PREVIEW_VERSION or not isinstance(preview["tool_version"], str) or not preview["tool_version"]
            or not isinstance(preview["artifacts"], dict) or set(preview["artifacts"]) != set(ARTIFACTS)
            or not isinstance(preview["parameters"], dict)):
        raise ValueError("reference_correction_contract_invalid")
    parent_path = _bound_file(root, preview["parent"])
    parent = _parent(root, parent_path, _seen)
    if preview["parent_preparation_sha256"] != parent["preparation_sha256"]:
        raise ValueError("reference_correction_parent_changed")
    paths = {}
    for name, artifact in preview["artifacts"].items():
        paths[name] = _bound_file(root, artifact)
        if paths[name] != path.parent / name:
            raise ValueError("reference_correction_path_unsafe")
    source = _source_image(_file(root, parent["source"]["path"]))
    before = _source_image(_file(root, parent["cutout"]["path"]))
    images, result = _calculate(source, before, preview["parameters"])
    images.update(_review_images(source, before, images, preview["parameters"]))
    if result != preview["result"]:
        raise ValueError("reference_correction_result_mismatch")
    for name, expected in images.items():
        with Image.open(paths[name]) as image:
            if getattr(image, "n_frames", 1) != 1 or image.size != expected.size or image.convert(expected.mode).tobytes() != expected.tobytes():
                raise ValueError("reference_correction_pixels_mismatch")
    return preview, parent


def _corrected_document(parent, preview, preview_binding, cutout_binding, foreground_binding):
    return stamp_document(dict(schema_version=PREPARATION_VERSION, source=parent["source"],
        cutout=cutout_binding, foreground=foreground_binding, tool_version=__version__,
        method="local_correction", segmentation=parent["segmentation"],
        matting={"method": ALGORITHM, "alpha_policy": "confirmed_region_only"}, quality=preview["result"]["quality"],
        correction={"preview": preview_binding, "confirmed_sha256": preview["correction_sha256"]}), "preparation_sha256")


def apply_correction(*, root: Path, preview_path, confirm_correction_sha256: str, out_dir) -> dict:
    root = root.resolve(strict=True)
    out = _output(root, out_dir)
    path = _file(root, preview_path)
    binding = _binding(root, path)
    preview = load_json(path)
    digest = verify_document(preview, "correction_sha256")
    if confirm_correction_sha256 != digest:
        raise ValueError("reference_correction_confirmation_mismatch")
    # Reserve the new preparation in the provenance depth budget before writing.
    # Otherwise a deepest valid parent could publish an unreadable child.
    future_seen = (out / "preparation.json",)
    preview, parent = load_correction_preview(root, path, _seen=future_seen)

    def recheck():
        if _binding(root, path) != binding or load_correction_preview(root, path, _seen=future_seen)[0] != preview:
            raise ValueError("reference_correction_preview_changed")

    def writer(staged):
        artifacts = {}
        for role in ("cutout", "foreground"):
            source = _bound_file(root, preview["artifacts"][role + ".png"])
            shutil.copyfile(source, staged / (role + ".png"))
            artifacts[role] = {"path": relative_posix(root, out / (role + ".png")),
                               **fingerprint(staged / (role + ".png"), media_type="image")}
            if {k: artifacts[role][k] for k in ("bytes", "sha256")} != {k: preview["artifacts"][role + ".png"][k] for k in ("bytes", "sha256")}:
                raise ValueError("reference_correction_artifact_changed")
        report = _corrected_document(parent, preview, binding, artifacts["cutout"], artifacts["foreground"])
        write_json_atomic(staged / "preparation.json", report)
        from .handoff import write_preparation_handoff
        write_preparation_handoff(root=root, staged=staged, out=out, report=report)
        return report

    return _publish(root, out, writer, recheck)


def load_corrected_preparation(root: Path, path: Path, report: dict, seen) -> dict:
    if (not isinstance(report.get("correction"), dict)
            or set(report["correction"]) != {"preview", "confirmed_sha256"}):
        raise ValueError("reference_correction_preparation_invalid")
    binding = report["correction"]["preview"]
    preview_path = _bound_file(root, binding)
    preview, parent = load_correction_preview(root, preview_path, _seen=seen)
    artifacts = {}
    for role in ("cutout", "foreground"):
        local = _file(root, path.parent / (role + ".png"))
        actual = fingerprint(local, media_type="image")
        if {k: actual[k] for k in ("bytes", "sha256")} != {k: preview["artifacts"][role + ".png"][k] for k in ("bytes", "sha256")}:
            raise ValueError("reference_correction_artifact_changed")
        artifacts[role] = {"path": relative_posix(root, local), **actual}
    expected = _corrected_document(parent, preview, binding, artifacts["cutout"], artifacts["foreground"])
    # A loader must not rewrite old evidence merely because the installed version changed.
    expected["tool_version"] = report.get("tool_version")
    expected = stamp_document(expected, "preparation_sha256")
    if not isinstance(report.get("tool_version"), str) or not report["tool_version"] or report != expected:
        raise ValueError("reference_correction_preparation_invalid")
    return report
