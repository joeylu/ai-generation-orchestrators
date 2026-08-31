from __future__ import annotations

import json
import shutil
import subprocess
import tempfile
import uuid
import zipfile
from fractions import Fraction
from pathlib import Path
from typing import Any, Mapping, Sequence

from PIL import Image

from . import __version__
from .canonical import fingerprint, relative_posix, rooted_path, safe_error_code, stamp_document, write_json_atomic
from .handoff import DecodedHandoff
from .media.fit import fit_subject_sequence
from .media.gif import export_preview_gif
from .media.matte import calibrate_key_color, color_key_to_rgba, parse_hex_color
from .media.quality import check_subject_canvas
from .media.spill import cleanup_key_spill, zero_transparent_rgb
from .media.spritesheet import pack_video_spritesheet
from .media.timeline import build_source_timeline, build_variant_timeline, choose_uniform_indices


def probe_video(raw_video: Path, ffprobe: str = "ffprobe") -> dict[str, Any]:
    command = [
        ffprobe,
        "-v",
        "error",
        "-select_streams",
        "v:0",
        "-show_streams",
        "-show_format",
        "-show_frames",
        "-of",
        "json",
        str(raw_video),
    ]
    result = subprocess.run(command, check=False, capture_output=True, text=True)
    if result.returncode != 0:
        raise ValueError("ffprobe_failed")
    payload = json.loads(result.stdout)
    if not isinstance(payload, dict):
        raise ValueError("ffprobe_payload_invalid")
    return payload


def decode_video_once(raw_video: Path, destination: Path, ffmpeg: str = "ffmpeg") -> list[Path]:
    destination.mkdir(parents=True, exist_ok=False)
    command = [
        ffmpeg,
        "-v",
        "error",
        "-i",
        str(raw_video),
        "-vsync",
        "0",
        str(destination / "source_%06d.png"),
    ]
    result = subprocess.run(command, check=False, capture_output=True, text=True)
    if result.returncode != 0:
        raise ValueError("ffmpeg_decode_failed")
    paths = sorted(destination.glob("source_*.png"))
    if not paths:
        raise ValueError("ffmpeg_decode_produced_no_frames")
    return paths


def _artifact(root: Path, path: Path, media_type: str) -> dict[str, Any]:
    return {"path": relative_posix(root, path), **fingerprint(path, media_type=media_type)}


def _open_sources(paths: Sequence[Path]) -> list[Image.Image]:
    images: list[Image.Image] = []
    for path in paths:
        if path.is_symlink() or not path.is_file():
            raise ValueError("decoded_frame_invalid")
        with Image.open(path) as source:
            images.append(source.convert("RGBA"))
    if len({image.size for image in images}) != 1:
        raise ValueError("decoded_frame_dimensions_differ")
    return images


def _rgba_frame(source: Image.Image, declared_key: tuple[int, int, int]) -> tuple[Image.Image, dict[str, Any]]:
    alpha_min, alpha_max = source.getchannel("A").getextrema()
    if alpha_min < 255:
        rgba = source.copy()
        matte_evidence: dict[str, Any] = {"background_policy": "native_alpha", "alpha_range": [alpha_min, alpha_max]}
        observed_key = declared_key
    else:
        observed_key, calibration = calibrate_key_color([source], "#" + "".join(f"{channel:02X}" for channel in declared_key), allow_topology_drift=True)
        rgba, matte_detail = color_key_to_rgba(
            source,
            key_color=observed_key,
            tolerance=24.0,
            softness=18.0,
            color_space="rgb",
        )
        matte_evidence = {"calibration": calibration, **matte_detail}
    cleaned, spill = cleanup_key_spill(rgba, key_color=observed_key)
    # Check before square padding/alignment can disguise a retained canvas.
    check_subject_canvas(cleaned)
    return cleaned, {"matte": matte_evidence, "spill": spill}


def _resize_rgba(image: Image.Image, size: int) -> Image.Image:
    """Low-level canvas fit; delivery uses the shared subject envelope instead."""
    if image.size == (size, size):
        result = image.copy()
    else:
        scale = size / max(image.size)
        width = max(1, min(size, round(image.width * scale)))
        height = max(1, min(size, round(image.height * scale)))
        resized = image.resize((width, height), Image.Resampling.LANCZOS)
        result = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        # Paste without a mask: multiplying alpha again would erode soft edges.
        result.paste(resized, ((size - width) // 2, (size - height) // 2))
    zero_transparent_rgb(result)
    return result


def _write_variant(
    *,
    variant_root: Path,
    source_images: Sequence[Image.Image],
    source_evidence: Sequence[Mapping[str, Any]],
    source_alignment: Mapping[str, Any],
    subject_fit: Mapping[str, Any],
    selected_indices: Sequence[int],
    frame_count: int,
    size: int,
    timeline: Mapping[str, Any],
    raw_sha256: str,
    include_gif: bool,
    allow_gif_failure: bool,
    strict: bool = True,
) -> dict[str, Any]:
    variant_root.mkdir(parents=True, exist_ok=False)
    frames_root = variant_root / "frames"
    frames_root.mkdir()
    aligned = [source_images[index] for index in selected_indices]
    evidence = [{"output_index": output_index, "source_index": index, **source_evidence[index]}
                for output_index, index in enumerate(selected_indices, start=1)]
    alignment = {**source_alignment, "records": [
        {**source_alignment["records"][index], "index": output_index}
        for output_index, index in enumerate(selected_indices, start=1)
    ]}
    if strict and any(record["clip_warning"] for record in alignment["records"]):
        raise ValueError("strict_subject_clipping")
    warnings = list(alignment.get("warning_codes", []))
    frame_paths: list[Path] = []
    for index, image in enumerate(aligned, start=1):
        path = frames_root / f"frame_{index:03d}.png"
        image.save(path, format="PNG")
        frame_paths.append(path)

    sheet, atlas = pack_video_spritesheet(aligned, frame_count=frame_count)
    spritesheet_path = variant_root / "spritesheet.png"
    atlas_path = variant_root / "atlas.json"
    sheet.save(spritesheet_path, format="PNG")
    atlas["image"] = spritesheet_path.name
    write_json_atomic(atlas_path, atlas)

    artifacts: dict[str, Any] = {
        "frames": [_artifact(variant_root, path, "image/png") for path in frame_paths],
        "spritesheet": _artifact(variant_root, spritesheet_path, "image/png"),
        "atlas": _artifact(variant_root, atlas_path, "application/json"),
    }
    if include_gif:
        gif_path = variant_root / "preview.gif"
        fps_record = timeline["playback_fps"]
        try:
            export_preview_gif(images=aligned, out_gif=gif_path,
                               fps=Fraction(fps_record["numerator"], fps_record["denominator"]))
            artifacts["gif"] = _artifact(variant_root, gif_path, "image/gif")
        except Exception:
            gif_path.unlink(missing_ok=True)
            if not allow_gif_failure:
                raise
            warnings.append("gif_export_failed")

    alpha_ranges = [image.getchannel("A").getextrema() for image in aligned]
    manifest = stamp_document({
        "schema_version": "ai_frame_animation_variant_manifest_v1",
        "tool_version": __version__,
        "frame_count": frame_count,
        "size": size,
        "raw_sha256": raw_sha256,
        "timeline": dict(timeline),
        "alpha": {
            "frame_ranges": [list(item) for item in alpha_ranges],
            "meaningful_transparency": all(item[0] < 255 for item in alpha_ranges),
        },
        "processing": {
            "background_policy": "per_frame_calibrated_global_key_or_native_alpha",
            "subject_fit": dict(subject_fit),
            "alignment": alignment,
            "frames": evidence,
        },
        "warnings": warnings,
        "artifacts": artifacts,
    }, "manifest_sha256")
    manifest_path = variant_root / "manifest.json"
    write_json_atomic(manifest_path, manifest)
    return {
        "frame_count": frame_count,
        "status": "completed",
        "warnings": warnings,
        "manifest": _artifact(variant_root.parent, manifest_path, "application/json"),
    }


def _write_deterministic_zip(root: Path, destination: Path) -> None:
    members = sorted(path for path in root.rglob("*") if path.is_file() and path != destination)
    with zipfile.ZipFile(destination, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for path in members:
            info = zipfile.ZipInfo(relative_posix(root, path), date_time=(1980, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            archive.writestr(info, path.read_bytes())


def _process_from_decoded_into(
    *,
    root: Path,
    plan: Mapping[str, Any],
    raw_video: Path,
    decoded_paths: Sequence[Path],
    probe_payload: Mapping[str, Any],
    out_dir: Path,
    key_color: str,
    decoded_handoff_sha256: str | None,
) -> dict[str, Any]:
    out_dir.mkdir(parents=True, exist_ok=False)
    raw = fingerprint(raw_video, media_type="video")
    source_images = _open_sources(decoded_paths)
    delivery = plan["delivery"]
    continuity = str(plan["motion"]["continuity"])
    source_timeline = build_source_timeline(probe_payload, decoded_frame_count=len(source_images), continuity=continuity)
    quality = str(delivery["quality"])
    # A family has one geometry, independent of requested variant counts. Do
    # not let sparse sampling miss an extended pose or rescale common frames.
    # Loop's excluded terminal pose does not belong to its fitting interval.
    eligible_count = len(source_images) - (1 if continuity == "loop" else 0)
    declared_key = parse_hex_color(key_color)
    prepared = [_rgba_frame(image, declared_key) for image in source_images[:eligible_count]]
    fitted_sources, subject_fit, source_alignment = fit_subject_sequence(
        [item[0] for item in prepared], size=int(delivery["size"]),
    )
    source_evidence = [item[1] for item in prepared]
    variants: list[dict[str, Any]] = []
    failures: list[dict[str, Any]] = []
    for frame_count in delivery["frame_counts"]:
        final_variant_root = out_dir / f"frames-{frame_count}"
        staged_variant_root = out_dir / f".frames-{frame_count}.processing"
        try:
            indices = choose_uniform_indices(len(source_images), int(frame_count), continuity=continuity)
            timeline = build_variant_timeline(source_timeline, indices, int(frame_count))
            entry = _write_variant(
                variant_root=staged_variant_root,
                source_images=fitted_sources,
                source_evidence=source_evidence,
                source_alignment=source_alignment,
                subject_fit=subject_fit,
                selected_indices=indices,
                frame_count=int(frame_count),
                size=int(delivery["size"]),
                timeline=timeline,
                raw_sha256=str(raw["sha256"]),
                include_gif=bool(delivery["gif"]),
                allow_gif_failure=quality == "best_effort",
                strict=quality == "strict",
            )
            staged_variant_root.replace(final_variant_root)
            entry["manifest"]["path"] = f"{final_variant_root.name}/manifest.json"
            variants.append(entry)
        except Exception as exc:
            if staged_variant_root.exists():
                shutil.rmtree(staged_variant_root)
            failures.append({"frame_count": int(frame_count), "status": "failed", "code": safe_error_code(exc)})
            if quality == "strict":
                raise
    decode_evidence: dict[str, Any] = {
        "probe_operation_count": 1,
        "operation_count": 1,
        "decoded_frame_count": len(source_images),
        "input_mode": "verified_decoded_handoff" if decoded_handoff_sha256 else "internal_decode",
    }
    if decoded_handoff_sha256:
        decode_evidence["handoff_sha256"] = decoded_handoff_sha256
    family = stamp_document({
        "schema_version": "ai_frame_animation_delivery_manifest_v1",
        "tool_version": __version__,
        "plan_sha256": plan["plan_sha256"],
        "quality_policy": quality,
        "raw_source": {"path": relative_posix(root, raw_video), **raw},
        "source_timeline": source_timeline,
        "decode": decode_evidence,
        "requested_frame_counts": list(delivery["frame_counts"]),
        "gif_requested": bool(delivery["gif"]),
        "variants": variants,
        "failures": failures,
    }, "manifest_sha256")
    manifest_path = out_dir / "delivery-manifest.json"
    write_json_atomic(manifest_path, family)
    _write_deterministic_zip(out_dir, out_dir / "delivery.zip")
    return family


def process_from_decoded(
    *,
    root: Path,
    plan: Mapping[str, Any],
    raw_video: Path,
    decoded_paths: Sequence[Path],
    probe_payload: Mapping[str, Any],
    out_dir: Path,
    key_color: str,
    decoded_handoff_sha256: str | None = None,
) -> dict[str, Any]:
    """Build a complete delivery in a sibling staging directory, then publish it."""

    if out_dir.exists():
        if out_dir.is_symlink() or not out_dir.is_dir() or any(out_dir.iterdir()):
            raise ValueError("output_directory_not_empty")
        out_dir.rmdir()
    staged = out_dir.with_name(f".{out_dir.name}.{uuid.uuid4().hex}.processing")
    try:
        family = _process_from_decoded_into(
            root=root,
            plan=plan,
            raw_video=raw_video,
            decoded_paths=decoded_paths,
            probe_payload=probe_payload,
            out_dir=staged,
            key_color=key_color,
            decoded_handoff_sha256=decoded_handoff_sha256,
        )
        # Do not publish a directory/ZIP until the selected policy has passed.
        from .validation import validate_delivery

        validate_delivery(staged, policy=str(plan["delivery"]["quality"]), workspace_root=root)
        staged.replace(out_dir)
        return family
    except Exception:
        if staged.exists():
            shutil.rmtree(staged)
        raise


def process_decoded_handoff(
    *,
    root: Path,
    plan: Mapping[str, Any],
    handoff: DecodedHandoff,
    out_dir: Path,
    key_color: str,
) -> dict[str, Any]:
    """Process a verified external probe/decode exactly once for the whole requested family."""

    return process_from_decoded(
        root=root,
        plan=plan,
        raw_video=handoff.raw_video,
        decoded_paths=handoff.decoded_paths,
        probe_payload=handoff.probe_payload,
        out_dir=out_dir,
        key_color=key_color,
        decoded_handoff_sha256=handoff.sha256,
    )


def process_video(
    *,
    root: Path,
    plan: Mapping[str, Any],
    raw_video: Path,
    out_dir: Path,
    key_color: str,
    ffprobe: str = "ffprobe",
    ffmpeg: str = "ffmpeg",
    decoded_dir: Path | None = None,
    probe_payload: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    raw_video = rooted_path(root, raw_video, must_exist=True)
    out_dir = rooted_path(root, out_dir, must_exist=False)
    if decoded_dir is not None:
        decoded = rooted_path(root, decoded_dir, must_exist=True)
        paths = sorted(decoded.glob("*.png"))
        if not paths or probe_payload is None:
            raise ValueError("offline_decoded_fixture_requires_pngs_and_probe")
        return process_from_decoded(
            root=root,
            plan=plan,
            raw_video=raw_video,
            decoded_paths=paths,
            probe_payload=probe_payload,
            out_dir=out_dir,
            key_color=key_color,
        )
    payload = probe_video(raw_video, ffprobe=ffprobe)
    with tempfile.TemporaryDirectory(prefix="ai-frame-animation-decode-") as temporary:
        paths = decode_video_once(raw_video, Path(temporary) / "decoded", ffmpeg=ffmpeg)
        return process_from_decoded(
            root=root,
            plan=plan,
            raw_video=raw_video,
            decoded_paths=paths,
            probe_payload=payload,
            out_dir=out_dir,
            key_color=key_color,
        )
