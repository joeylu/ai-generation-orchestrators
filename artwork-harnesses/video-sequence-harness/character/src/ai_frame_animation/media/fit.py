"""Fit one complete action envelope, never its background canvas or each pose."""

from __future__ import annotations

import math
import statistics
from typing import Sequence

from PIL import Image

from .align import frame_anchor
from .spill import zero_transparent_rgb


def fit_subject_sequence(
    images: Sequence[Image.Image], *, size: int, margin_fraction: float = 0.08,
) -> tuple[list[Image.Image], dict, dict]:
    """Align at source resolution, then crop/resize every frame identically.

    Call with ALL source frames in the semantic interval, before selecting any
    atlas-profile variant. Integer translations remove drift without changing pose
    scale. Bounds include every nonzero-alpha pixel (also disconnected/soft
    details); the alpha>8 threshold is used only for finding the contact anchor.
    Cropping can extend beyond the source canvas and is transparently padded.
    """
    if not images or len({image.size for image in images}) != 1:
        raise ValueError("subject_fit_source_dimensions_invalid")
    if isinstance(size, bool) or not isinstance(size, int) or size < 32:
        raise ValueError("subject_fit_size_invalid")
    if not math.isfinite(margin_fraction) or not 0 < margin_fraction < 0.4:
        raise ValueError("subject_fit_margin_invalid")
    source = [image.convert("RGBA") for image in images]
    anchors = [frame_anchor(image, anchor_kind="contact_baseline") for image in source]
    target = tuple(statistics.median(anchor[axis] for anchor in anchors) for axis in (0, 1))
    shifts = [(round(target[0] - x), round(target[1] - y)) for x, y in anchors]
    shifted_bounds = []
    for image, (dx, dy) in zip(source, shifts):
        bbox = image.getchannel("A").getbbox()
        assert bbox is not None  # frame_anchor already rejects empty subjects.
        shifted_bounds.append((bbox[0] + dx, bbox[1] + dy, bbox[2] + dx, bbox[3] + dy))
    union = (min(box[0] for box in shifted_bounds), min(box[1] for box in shifted_bounds),
             max(box[2] for box in shifted_bounds), max(box[3] for box in shifted_bounds))
    margin = math.ceil(size * margin_fraction)
    available = size - 2 * margin
    # Leave transparent samples around the union for the Lanczos filter. Four
    # output pixels cover its support even when the source is heavily reduced.
    filter_guard = 4
    if available <= 2 * filter_guard:
        raise ValueError("subject_fit_margin_invalid")
    initial_scale = (available - 2 * filter_guard) / max(union[2] - union[0], union[3] - union[1])
    padding = max(1, math.ceil(filter_guard / initial_scale))
    crop = (union[0] - padding, union[1] - padding, union[2] + padding, union[3] + padding)
    width, height = crop[2] - crop[0], crop[3] - crop[1]
    scale = available / max(width, height)
    resized_size = (max(1, round(width * scale)), max(1, round(height * scale)))
    offset = ((size - resized_size[0]) // 2, (size - resized_size[1]) // 2)
    fitted, records = [], []
    for index, (image, anchor, (dx, dy)) in enumerate(zip(source, anchors, shifts), start=1):
        # Translate the crop window, not the image on its original canvas:
        # otherwise alignment could discard an extended hand/cape before fit.
        window = (crop[0] - dx, crop[1] - dy, crop[2] - dx, crop[3] - dy)
        resized = image.crop(window).resize(resized_size, Image.Resampling.LANCZOS)
        canvas = Image.new("RGBA", (size, size))
        canvas.paste(resized, offset)  # no alpha mask: retain continuous alpha.
        zero_transparent_rgb(canvas)
        bbox = canvas.getchannel("A").getbbox()
        if bbox is None:
            raise ValueError("subject_fit_empty_output")
        if bbox[0] < margin or bbox[1] < margin or bbox[2] > size - margin or bbox[3] > size - margin:
            raise ValueError("subject_fit_margin_not_preserved")
        fitted.append(canvas)
        records.append({"index": index, "source_anchor": [round(v, 3) for v in anchor],
                        "target_anchor": [round(v, 3) for v in target],
                        "translate_px": [dx, dy], "clip_warning": False})
    fit = {"schema_version": "video_subject_fit_v1", "source_canvas_size": list(source[0].size),
           "source_frame_count": len(source), "size": size, "margin_px": margin,
           "aligned_union_bbox": list(union), "source_crop_box": list(crop),
           "resize_size": list(resized_size), "scale": scale, "offset_px": list(offset),
           "bounds_alpha_threshold": 0, "filter_guard_px": filter_guard}
    alignment = {"schema_version": "video_rgba_alignment_report_v2",
                 "coordinate_space": "source_pixels_before_shared_fit",
                 "anchor_kind": "contact_baseline", "target_anchor": [round(v, 3) for v in target],
                 "records": records, "warning_codes": []}
    return fitted, fit, alignment
