"""Internal video-input contract, after ordinary artwork has been prepared."""

from __future__ import annotations

import numpy as np
from PIL import Image

from .matte import parse_hex_color


def inspect_generation_reference(image: Image.Image, key_color: str) -> dict:
    """Inspect pixels without creating media, contacting a provider, or guessing.

    A clear alpha border is evidence of a foreground supplied by the caller.
    Merely finding one transparent pixel is not evidence of a removed canvas.
    An already-keyed opaque image is accepted only when its entire border agrees
    with the plan's chosen key. Other images route to preparation, not rejection
    of the user's source format/background.
    """

    pixels = np.asarray(image.convert("RGBA"))
    alpha = pixels[:, :, 3]
    border = np.concatenate((pixels[0], pixels[-1], pixels[:, 0], pixels[:, -1]))
    key = np.asarray(parse_hex_color(key_color), dtype=np.int16)
    if not np.any(alpha > 8):
        raise ValueError("reference_has_no_visible_subject")
    if np.all(border[:, 3] == 0):
        return {"status": "ready", "diagnostic_code": "ready", "preparation": "alpha_composite_selected_key"}
    delta = np.abs(border[:, :3].astype(np.int16) - key)
    if np.all(alpha == 255) and np.all(delta <= 8):
        foreground = np.max(np.abs(pixels[:, :, :3].astype(np.int16) - key), axis=2) > 8
        if not np.any(foreground):
            raise ValueError("reference_has_no_visible_subject")
        return {"status": "ready", "diagnostic_code": "ready", "preparation": "already_selected_key"}
    return {"status": "preparation_required", "diagnostic_code": "reference_preparation_required",
            "preparation": "local_foreground_segmentation"}


def prepare_generation_reference(image: Image.Image, key_color: str) -> Image.Image:
    """Flatten verified alpha onto the chosen key, preserving size and colours.

    This is a run-stage operation, not part of doctor or plan. It does not modify
    the caller's image or erase white pixels, including white armour/highlights.
    """

    if inspect_generation_reference(image, key_color)["status"] != "ready":
        raise ValueError("reference_preparation_required")
    background = Image.new("RGBA", image.size, (*parse_hex_color(key_color), 255))
    return Image.alpha_composite(background, image.convert("RGBA")).convert("RGB")
