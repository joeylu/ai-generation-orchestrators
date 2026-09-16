"""Fixed-cell extraction, alpha-preserving sizing and strict local evidence.

No segmentation, keying, defringe, frame interpolation or pose normalization.
"""
from __future__ import annotations

import hashlib
from fractions import Fraction
from pathlib import Path

from PIL import Image, ImageDraw

from .storage import contained, read, require, save, seal, sha, unseal


def fraction(value: Fraction) -> list[int]:
    return [value.numerator, value.denominator]


def board(path: Path, size: int | tuple[int, int] | None, *, transparent: bool) -> Image.Image:
    require(path.stat().st_size <= 32 * 1024 * 1024, "board_too_large")
    with Image.open(path) as im:
        require(im.format == "PNG" and getattr(im, "n_frames", 1) == 1, "board_single_png_required")
        expected = (size, size) if isinstance(size, int) else size
        if expected is None:
            require(im.width == im.height, "board_aspect_ratio_mismatch")
        else:
            require(im.size == expected, "board_dimensions_mismatch")
        require(im.getexif().get(274, 1) == 1, "board_orientation_unsupported")
        if transparent:
            require("A" in im.getbands() or "transparency" in im.info, "matte_alpha_missing")
        result = im.convert("RGBA")
    if transparent:
        alpha = result.getchannel("A")
        require(alpha.getextrema()[0] == 0 and alpha.getextrema()[1] > 0, "matte_not_transparent")
    return result


def clean_zero_rgb(im: Image.Image) -> Image.Image:
    result = im.copy()
    zero = im.getchannel("A").point(lambda a: 255 if a == 0 else 0)
    result.paste((0, 0, 0, 0), mask=zero)
    return result


def alpha_metrics(im: Image.Image) -> dict:
    alpha = im.getchannel("A")
    bbox = alpha.getbbox()
    require(bbox is not None, "frame_empty")
    histogram = alpha.histogram()
    require(histogram[0] > 0, "frame_opaque")
    require(bbox[0] > 0 and bbox[1] > 0 and bbox[2] < im.width and bbox[3] < im.height,
            "frame_touches_cell_boundary")
    return {"bbox": list(bbox), "transparent_pixels": histogram[0],
            "soft_alpha_pixels": sum(histogram[1:255]),
            "coverage": round(1 - histogram[0] / (im.width * im.height), 6)}


def ground_anchor(im: Image.Image, threshold: int) -> list[float | int]:
    """Detect a stable contact anchor from the lowest opaque-enough subject pixels."""
    require(1 <= threshold <= 254, "alignment_threshold_invalid")
    mask = im.getchannel("A").point(lambda value: 255 if value >= threshold else 0)
    bbox = mask.getbbox()
    require(bbox is not None, "frame_empty")
    bottom = bbox[3] - 1
    # A thin bottom band is less sensitive to one antialiased pixel than one scanline,
    # while remaining independent of hair, scarves and upper-body motion.
    band_height = max(2, min(8, round((bbox[3] - bbox[1]) * 0.025)))
    pixels = mask.load()
    xs = [x for y in range(max(bbox[1], bottom - band_height + 1), bottom + 1)
          for x in range(bbox[0], bbox[2]) if pixels[x, y]]
    require(bool(xs), "alignment_anchor_missing")
    return [round((min(xs) + max(xs)) / 2, 3), bottom]


def place_frame(im: Image.Image, padding: int, dx: int = 0, dy: int = 0) -> Image.Image:
    require(isinstance(padding, int) and 0 <= padding <= 256, "alignment_padding_invalid")
    bbox = im.getchannel("A").getbbox()
    require(bbox is not None, "frame_empty")
    offset_x, offset_y = padding + dx, padding + dy
    output_size = (im.width + padding * 2, im.height + padding * 2)
    require(bbox[0] + offset_x >= 0 and bbox[1] + offset_y >= 0
            and bbox[2] + offset_x <= output_size[0] and bbox[3] + offset_y <= output_size[1],
            "alignment_would_clip")
    result = Image.new("RGBA", output_size)
    result.alpha_composite(im, (offset_x, offset_y))
    return clean_zero_rgb(result)


def align_frames(frames: list[Image.Image], policy: dict) -> tuple[list[Image.Image], dict]:
    require(len(frames) == 16, "alignment_frame_count_invalid")
    mode = policy.get("mode", "none")
    require(mode in {"none", "bottom_y", "bottom_center"}, "alignment_mode_invalid")
    reference_frame = policy.get("reference_frame", 1)
    threshold = policy.get("alpha_threshold", 16)
    padding = policy.get("padding", 0)
    require(isinstance(reference_frame, int) and 1 <= reference_frame <= 16,
            "alignment_reference_invalid")
    require(isinstance(padding, int) and 0 <= padding <= 256, "alignment_padding_invalid")
    require(mode != "none" or padding == 0, "alignment_padding_requires_alignment")
    anchors = [ground_anchor(frame, threshold) for frame in frames]
    target = anchors[reference_frame - 1]
    aligned = []
    transforms = []
    for index, (frame, anchor) in enumerate(zip(frames, anchors), 1):
        dx = int(round(target[0] - anchor[0])) if mode == "bottom_center" else 0
        dy = 0 if mode == "none" else int(target[1] - anchor[1])
        result = frame if mode == "none" else place_frame(frame, padding, dx, dy)
        output_anchor = ground_anchor(result, threshold)
        if mode == "bottom_center":
            require(abs(output_anchor[0] - (target[0] + padding)) <= 1
                    and output_anchor[1] == target[1] + padding,
                    "alignment_anchor_mismatch")
        elif mode == "bottom_y":
            require(dx == 0 and output_anchor[1] == target[1] + padding,
                    "alignment_anchor_mismatch")
        aligned.append(result)
        transforms.append({"frame": index, "source_anchor": anchor,
                           "translation": [dx, dy], "canvas_offset": [padding + dx, padding + dy],
                           "output_anchor": output_anchor})
    return aligned, {"mode": mode, "reference_frame": reference_frame,
                     "alpha_threshold": threshold, "padding": padding,
                     "target_anchor": ([target[0] + padding, target[1] + padding]
                                       if mode == "bottom_center" else
                                       [None, target[1] + padding] if mode == "bottom_y" else None),
                     "transforms": transforms}


def file_record(path: Path, base: Path) -> dict:
    return {"path": path.relative_to(base).as_posix(), "sha256": sha(path), "bytes": path.stat().st_size}


def gif_ticks(duration_ms: int, weights: list[int] | None = None) -> list[int]:
    total = duration_ms // 10
    weights = weights or [1] * 16
    require(len(weights) == 16 and all(isinstance(value, int) and 1 <= value <= 16
                                      for value in weights), "gif_timing_weights_invalid")
    if len(set(weights)) == 1:
        boundaries = [round(Fraction(i * total, 16)) for i in range(17)]
        ticks = [(boundaries[i + 1] - boundaries[i]) * 10 for i in range(16)]
    else:
        remaining = total - 16
        require(remaining >= 0, "gif_timing_invalid")
        weight_total = sum(weights)
        cumulative = [0]
        for value in weights:
            cumulative.append(cumulative[-1] + value)
        boundaries = [round(Fraction(value * remaining, weight_total)) for value in cumulative]
        ticks = [(1 + boundaries[i + 1] - boundaries[i]) * 10 for i in range(16)]
    require(min(ticks) >= 10 and sum(ticks) == duration_ms, "gif_timing_invalid")
    return ticks


def gif_frame(im: Image.Image) -> Image.Image:
    quantized = im.convert("RGB").quantize(colors=255, dither=Image.Dither.NONE)
    result = Image.new("P", im.size)
    palette = quantized.getpalette()[:765]
    result.putpalette([0, 0, 0] + palette + [0] * (765 - len(palette)))
    result.putdata([p + 1 if a == 255 else 0
                    for p, a in zip(quantized.tobytes(), im.getchannel("A").tobytes())])
    result.info["transparency"] = 0
    return result


def make_gif(frames: list[Image.Image], out: Path, plan: dict) -> None:
    palette_frames = [gif_frame(im) for im in frames]
    kwargs = {"loop": 0} if plan["loop"] else {}
    palette_frames[0].save(out, save_all=True, append_images=palette_frames[1:],
                           duration=gif_ticks(plan["duration_ms"], plan.get("timing_weights")), transparency=0,
                           disposal=2, optimize=False, **kwargs)
    # A decoded timeline is compared to the requested schedule, allowing GIF
    # encoders to merge identical holds without inventing PNG frames.
    verify_gif(out, frames, plan)


def verify_gif(path: Path, frames: list[Image.Image], plan: dict) -> None:
    ticks = gif_ticks(plan["duration_ms"], plan.get("timing_weights"))
    expected = []
    for im, duration in zip(frames, ticks):
        rgb = hashlib.sha256(gif_frame(im).convert("RGBA").tobytes()).digest()
        expected.extend([rgb] * (duration // 10))
    actual = []
    with Image.open(path) as gif:
        require(gif.format == "GIF" and gif.size == frames[0].size, "gif_structure_invalid")
        require(gif.info.get("loop") == (0 if plan["loop"] else None), "gif_loop_mismatch")
        require(1 <= gif.n_frames <= 16, "gif_frame_count_invalid")
        for i in range(gif.n_frames):
            gif.seek(i)
            duration = gif.info.get("duration", 0)
            require(isinstance(duration, int) and duration >= 10 and duration % 10 == 0,
                    "gif_timing_invalid")
            require(len(actual) + duration // 10 <= len(expected), "gif_duration_mismatch")
            actual.extend([hashlib.sha256(gif.convert("RGBA").tobytes()).digest()] * (duration // 10))
    require(actual == expected, "gif_decoded_timeline_mismatch")


def build_review_bundle(output: Path, frames: list[Image.Image], candidate: dict) -> dict:
    review = output / "review"
    review.mkdir()
    size = frames[0].width
    backgrounds = {
        "light.png": (245, 245, 245, 255),
        "dark.png": (24, 24, 28, 255),
    }
    files = []
    for name, color in backgrounds.items():
        sheet = Image.new("RGBA", (size * 4, size * 4), color)
        for i, frame in enumerate(frames):
            sheet.alpha_composite(frame, ((i % 4) * size, (i // 4) * size))
        path = review / name
        sheet.convert("RGB").save(path)
        files.append(file_record(path, output))
    checker = Image.new("RGBA", (size * 4, size * 4), "white")
    draw = ImageDraw.Draw(checker)
    unit = max(4, size // 8)
    for y in range(0, checker.height, unit):
        for x in range(0, checker.width, unit):
            if (x // unit + y // unit) % 2:
                draw.rectangle((x, y, x + unit - 1, y + unit - 1), fill=(190, 190, 190, 255))
    for i, frame in enumerate(frames):
        checker.alpha_composite(frame, ((i % 4) * size, (i // 4) * size))
    checker_path = review / "checker.png"
    checker.convert("RGB").save(checker_path)
    files.append(file_record(checker_path, output))
    metrics = []
    previous = None
    for record in candidate["frames"]:
        bbox = record["metrics"]["bbox"]
        center = [round((bbox[0] + bbox[2]) / 2, 3), bbox[3]]
        metrics.append({"index": record["index"], "bbox": bbox, "coverage": record["metrics"]["coverage"],
                        "soft_alpha_pixels": record["metrics"]["soft_alpha_pixels"],
                        "bottom_center": center,
                        "alignment": record.get("alignment"),
                        "delta_from_previous": None if previous is None else
                        [round(center[0] - previous[0], 3), center[1] - previous[1]]})
        previous = center
    report = seal({"schema": "character_review_bundle_v1", "candidate_digest": candidate["digest"],
                   "files": files, "frame_diagnostics": metrics})
    save(review / "review-bundle.json", report)
    return report


def validate_review_bundle(output: Path, candidate: dict) -> dict:
    review = contained(output, "review")
    report = read(contained(review, "review-bundle.json"))
    unseal(report)
    require(report["schema"] == "character_review_bundle_v1"
            and report["candidate_digest"] == candidate["digest"], "review_bundle_invalid")
    require({r["path"] for r in report["files"]} ==
            {"review/light.png", "review/dark.png", "review/checker.png"}, "review_bundle_invalid")
    for record in report["files"]:
        path = contained(output, record["path"])
        require(path.is_file() and path.stat().st_size == record["bytes"]
                and sha(path) == record["sha256"], "review_bundle_changed")
    require(len(report["frame_diagnostics"]) == 16, "review_bundle_invalid")
    return report


def make_opaque_preview(frames: list[Image.Image], out: Path, plan: dict, size: int = 512) -> None:
    rendered = []
    for frame in frames:
        background = Image.new("RGBA", frame.size, (225, 225, 225, 255))
        background.alpha_composite(frame)
        rendered.append(background.convert("RGB").resize((size, size), Image.Resampling.NEAREST)
                        .quantize(colors=256, dither=Image.Dither.NONE))
    kwargs = {"loop": 0} if plan["loop"] else {}
    rendered[0].save(out, save_all=True, append_images=rendered[1:],
                     duration=gif_ticks(plan["duration_ms"], plan.get("timing_weights")),
                     disposal=2, optimize=False, **kwargs)
    with Image.open(out) as image:
        require(image.format == "GIF" and image.size == (size, size), "alignment_preview_invalid")
        total = 0
        for index in range(image.n_frames):
            image.seek(index)
            total += image.info.get("duration", 0)
        require(total == plan["duration_ms"], "alignment_preview_timing_invalid")


def build_alignment_preview(source_path: Path, output: Path, plan: dict, source_sha: str) -> dict:
    policy = plan.get("alignment", {"mode": "none"})
    require(policy.get("mode") in {"bottom_y", "bottom_center"},
            "alignment_preview_not_requested")
    native = board(source_path, None, transparent=True)
    native_size = list(native.size)
    normalized = native if native.size == (plan["board_size"], plan["board_size"]) else clean_zero_rgb(
        native.resize((plan["board_size"], plan["board_size"]), Image.Resampling.LANCZOS))
    cell = plan["board_size"] // 4
    source_frames = []
    for index in range(16):
        x, y = (index % 4) * cell, (index // 4) * cell
        crop = normalized.crop((x, y, x + cell, y + cell))
        ground_anchor(crop, policy["alpha_threshold"])
        frame = clean_zero_rgb(
            crop.resize((plan["frame_size"], plan["frame_size"]), Image.Resampling.LANCZOS))
        ground_anchor(frame, policy["alpha_threshold"])
        source_frames.append(frame)
    aligned, alignment = align_frames(source_frames, policy)
    unaligned = [place_frame(frame, policy["padding"]) for frame in source_frames]
    output.mkdir()
    make_opaque_preview(unaligned, output / "before-gray-512.gif", plan)
    make_opaque_preview(aligned, output / "after-gray-512.gif", plan)
    output_frame_size = aligned[0].width
    atlas = Image.new("RGBA", (output_frame_size * 4, output_frame_size * 4))
    for index, frame in enumerate(aligned):
        atlas.alpha_composite(frame, ((index % 4) * output_frame_size,
                                      (index // 4) * output_frame_size))
    atlas.save(output / "aligned-atlas.png")
    files = [file_record(output / name, output) for name in
             ("before-gray-512.gif", "after-gray-512.gif", "aligned-atlas.png")]
    report = seal({"schema": "character_alignment_preview_v1", "plan_digest": plan["digest"],
                   "source_sha256": source_sha, "source_board_dimensions": native_size,
                   "normalization": "none" if native_size == [plan["board_size"], plan["board_size"]]
                   else "whole_board_lanczos_to_canonical_square",
                   "alignment": alignment, "files": files,
                   "status": "unverified_preview_not_delivery"})
    save(output / "alignment-preview.json", report)
    return report


def validate_alignment_preview(output: Path, report: dict, plan: dict, source_sha: str) -> dict:
    unseal(report)
    require(report["schema"] == "character_alignment_preview_v1"
            and report["plan_digest"] == plan["digest"]
            and report["source_sha256"] == source_sha
            and report["status"] == "unverified_preview_not_delivery",
            "alignment_preview_invalid")
    require(report["alignment"]["mode"] in {"bottom_y", "bottom_center"}
            and len(report["alignment"]["transforms"]) == 16,
            "alignment_preview_invalid")
    require({item["path"] for item in report["files"]}
            == {"before-gray-512.gif", "after-gray-512.gif", "aligned-atlas.png"},
            "alignment_preview_invalid")
    for item in report["files"]:
        path = contained(output, item["path"])
        require(path.is_file() and path.stat().st_size == item["bytes"]
                and sha(path) == item["sha256"], "alignment_preview_changed")
    return report


def build_candidate(matte: Path, output: Path, plan: dict, raw_sha: str) -> dict:
    native = board(matte, None, transparent=True)
    native_size = list(native.size)
    source = native if native.size == (plan["board_size"], plan["board_size"]) else clean_zero_rgb(
        native.resize((plan["board_size"], plan["board_size"]), Image.Resampling.LANCZOS))
    cell = plan["board_size"] // 4
    base_size = plan["frame_size"]
    output.mkdir()
    frames_dir = output / "frames"
    frames_dir.mkdir()
    source_frames = []
    warnings = set()
    policy = plan.get("alignment", {"mode": "none", "reference_frame": 1, "alpha_threshold": 16})
    if base_size > cell:
        warnings.add("delivery_upscaled_without_new_detail")
    for i in range(16):
        x, y = (i % 4) * cell, (i // 4) * cell
        crop = source.crop((x, y, x + cell, y + cell))
        if policy["mode"] == "none":
            alpha_metrics(crop)  # Unchanged frames must already have safe cell padding.
        else:
            ground_anchor(crop, policy["alpha_threshold"])
        im = clean_zero_rgb(crop.resize((base_size, base_size), Image.Resampling.LANCZOS))
        if policy["mode"] == "none":
            alpha_metrics(im)
        else:
            ground_anchor(im, policy["alpha_threshold"])
        source_frames.append(im)
    frames, alignment = align_frames(source_frames, policy)
    timing_weights = plan.get("timing_weights", [1] * 16)
    timing_total = sum(timing_weights)
    timing_starts = [sum(timing_weights[:index]) for index in range(16)]
    unaligned_frames = ([place_frame(frame, policy["padding"]) for frame in source_frames]
                        if alignment["mode"] != "none" else source_frames)
    size = frames[0].width
    records = []
    source_records = []
    if alignment["mode"] != "none":
        source_dir = output / "source-frames"
        source_dir.mkdir()
        for i, im in enumerate(source_frames):
            path = source_dir / f"{i:02d}.png"
            im.save(path)
            source_records.append({**file_record(path, output), "index": i})
    for i, im in enumerate(frames):
        x, y = (i % 4) * cell, (i // 4) * cell
        metrics = alpha_metrics(im)
        path = frames_dir / f"{i:02d}.png"
        im.save(path)
        records.append({**file_record(path, output), "index": i, "source_cell": [i % 4, i // 4],
                        "source_rect": [x, y, cell, cell], "metrics": metrics,
                        "alignment": alignment["transforms"][i],
                        "time_seconds": fraction(Fraction(timing_starts[i] * plan["duration_ms"],
                                                          timing_total * 1000)),
                        "duration_seconds": fraction(Fraction(timing_weights[i] * plan["duration_ms"],
                                                              timing_total * 1000)),
                        "action_phase": fraction(Fraction(i, 16 if plan["loop"] else 15))})
    hashes = [hashlib.sha256(im.tobytes()).hexdigest() for im in frames]
    require(len(set(hashes)) > 1, "sequence_static")
    require(not plan["loop"] or hashes[0] != hashes[-1], "loop_terminal_pose_duplicated")
    if len(set(hashes)) < 16:
        warnings.add("repeated_poses_require_semantic_review")
    atlas = Image.new("RGBA", (size * 4, size * 4))
    for i, im in enumerate(frames):
        atlas.paste(im, ((i % 4) * size, (i // 4) * size))
    atlas_path = output / "atlas.png"
    atlas.save(atlas_path)
    artifacts = [file_record(atlas_path, output)]
    if plan["gif"]:
        make_gif(frames, output / "preview.gif", plan)
        artifacts.append(file_record(output / "preview.gif", output))
        if alignment["mode"] != "none":
            make_gif(unaligned_frames, output / "unaligned-preview.gif", plan)
            artifacts.append(file_record(output / "unaligned-preview.gif", output))
    candidate = seal({"schema": "character_image_candidate_v2", "plan_digest": plan["digest"],
                 "raw_sha256": raw_sha, "matte_sha256": sha(matte), "layout": [4, 4],
                 "source_board_dimensions": native_size,
                 "canonical_board_dimensions": [plan["board_size"], plan["board_size"]],
                 "normalization": "none" if native_size == [plan["board_size"], plan["board_size"]]
                 else "whole_board_lanczos_to_canonical_square",
                 "frame_count": 16, "base_frame_size": base_size, "frame_size": size, "loop": plan["loop"],
                 "duration_ms": plan["duration_ms"], "fps": fraction(Fraction(16000, plan["duration_ms"])),
                 "timing_weights": plan.get("timing_weights", [1] * 16),
                 "anchor": [0.5, 1.0], "alignment": alignment,
                 "source_frames": source_records, "frames": records, "artifacts": artifacts,
                 "warnings": sorted(warnings),
                 "build_state": "awaiting_semantic_review"})
    build_review_bundle(output, frames, candidate)
    return candidate


def validate_candidate(directory: Path, candidate: dict, plan: dict) -> None:
    unseal(candidate)
    require(candidate["schema"] == "character_image_candidate_v2"
            and candidate["build_state"] == "awaiting_semantic_review", "candidate_schema_invalid")
    require(candidate["plan_digest"] == plan["digest"], "candidate_plan_mismatch")
    require(candidate["layout"] == [4, 4] and candidate["frame_count"] == 16
            and len(candidate["frames"]) == 16, "candidate_layout_invalid")
    policy = plan.get("alignment", {"mode": "none", "reference_frame": 1,
                                    "alpha_threshold": 16, "padding": 0})
    expected_frame_size = plan["frame_size"] + (2 * policy.get("padding", 0)
                                                 if policy["mode"] != "none" else 0)
    require(candidate["duration_ms"] == plan["duration_ms"] and candidate["loop"] == plan["loop"]
            and candidate.get("base_frame_size") == plan["frame_size"]
            and candidate["frame_size"] == expected_frame_size, "candidate_policy_mismatch")
    source_dimensions = candidate.get("source_board_dimensions")
    require(isinstance(source_dimensions, list) and len(source_dimensions) == 2
            and source_dimensions[0] == source_dimensions[1] and source_dimensions[0] > 0,
            "candidate_source_geometry_invalid")
    require(candidate.get("canonical_board_dimensions") == [plan["board_size"], plan["board_size"]]
            and candidate.get("normalization") in {"none", "whole_board_lanczos_to_canonical_square"},
            "candidate_normalization_invalid")
    require((candidate["normalization"] == "none") ==
            (source_dimensions == candidate["canonical_board_dimensions"]), "candidate_normalization_invalid")
    require(candidate["fps"] == fraction(Fraction(16000, plan["duration_ms"])), "candidate_timing_invalid")
    require(candidate.get("alignment", {}).get("mode") == policy["mode"],
            "candidate_alignment_policy_mismatch")
    require(candidate.get("timing_weights") == plan.get("timing_weights", [1] * 16),
            "candidate_timing_policy_mismatch")
    source_records = candidate.get("source_frames", [])
    expected_paths = {f"frames/{i:02d}.png" for i in range(16)} | {"atlas.png"}
    if policy["mode"] != "none":
        require(len(source_records) == 16, "candidate_source_frames_missing")
        expected_paths |= {f"source-frames/{i:02d}.png" for i in range(16)}
    else:
        require(source_records == [], "candidate_source_frames_unexpected")
    if plan["gif"]:
        expected_paths.add("preview.gif")
        if policy["mode"] != "none":
            expected_paths.add("unaligned-preview.gif")
    records = source_records + candidate["frames"] + candidate["artifacts"]
    require(len(records) == len(expected_paths) and {r["path"] for r in records} == expected_paths,
            "candidate_artifact_set_invalid")
    for record in records:
        path = contained(directory, record["path"])
        require(path.is_file() and path.stat().st_size == record["bytes"]
                and sha(path) == record["sha256"], "artifact_checksum_mismatch")
    frames = []
    cell = plan["board_size"] // 4
    timing_weights = plan.get("timing_weights", [1] * 16)
    timing_total = sum(timing_weights)
    timing_starts = [sum(timing_weights[:index]) for index in range(16)]
    for i, record in enumerate(candidate["frames"]):
        require(record["index"] == i and record["path"] == f"frames/{i:02d}.png"
                and record["source_cell"] == [i % 4, i // 4]
                and record["source_rect"] == [(i % 4) * cell, (i // 4) * cell, cell, cell],
                "frame_source_mapping_invalid")
        require(record["time_seconds"] == fraction(Fraction(timing_starts[i] * plan["duration_ms"],
                                                            timing_total * 1000))
                and record["duration_seconds"] == fraction(Fraction(timing_weights[i] * plan["duration_ms"],
                                                                    timing_total * 1000))
                and record["action_phase"] == fraction(Fraction(i, 16 if plan["loop"] else 15)),
                "frame_timeline_invalid")
        require(record.get("alignment") == candidate["alignment"]["transforms"][i],
                "frame_alignment_record_invalid")
        im = board(contained(directory, record["path"]), candidate["frame_size"], transparent=True)
        require(im.tobytes() == clean_zero_rgb(im).tobytes(), "hidden_rgb_nonzero")
        require(alpha_metrics(im) == record["metrics"], "frame_metrics_stale")
        frames.append(im)
    original_frames = frames
    if policy["mode"] != "none":
        original_frames = []
        for i, record in enumerate(source_records):
            require(record["index"] == i and record["path"] == f"source-frames/{i:02d}.png",
                    "candidate_source_frame_invalid")
            im = board(contained(directory, record["path"]), plan["frame_size"], transparent=True)
            require(im.tobytes() == clean_zero_rgb(im).tobytes(), "hidden_rgb_nonzero")
            original_frames.append(im)
        expected_aligned, expected_alignment = align_frames(original_frames, policy)
        require(expected_alignment == candidate["alignment"], "candidate_alignment_stale")
        require(all(expected.tobytes() == actual.tobytes()
                    for expected, actual in zip(expected_aligned, frames)), "candidate_alignment_pixels_invalid")
    require(len({im.tobytes() for im in frames}) > 1, "sequence_static")
    require(not plan["loop"] or frames[0].tobytes() != frames[-1].tobytes(), "loop_terminal_pose_duplicated")
    with Image.open(directory / "atlas.png") as atlas:
        size = candidate["frame_size"]
        require(atlas.format == "PNG" and atlas.size == (size * 4, size * 4), "atlas_geometry_invalid")
        for i, im in enumerate(frames):
            x, y = (i % 4) * size, (i // 4) * size
            require(atlas.crop((x, y, x + size, y + size)).convert("RGBA").tobytes() == im.tobytes(),
                    "atlas_frame_mismatch")
    if plan["gif"]:
        verify_gif(directory / "preview.gif", frames, plan)
        if policy["mode"] != "none":
            unaligned_frames = [place_frame(frame, policy["padding"]) for frame in original_frames]
            verify_gif(directory / "unaligned-preview.gif", unaligned_frames, plan)
