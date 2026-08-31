"""Conservative alpha-canvas checks shared by processing and validation."""

from __future__ import annotations

import numpy as np
from PIL import Image


def check_subject_canvas(image: Image.Image) -> None:
    alpha = np.asarray(image.getchannel("A"))
    if not np.any(alpha > 8):
        raise ValueError("frame_has_no_visible_subject")
    if np.all(alpha == 255):
        raise ValueError("frame_is_opaque")
    # A broad band connecting opposite canvas edges is not evidence of an
    # isolated full-body sprite. It reproduces the white-panel/green-pad failure
    # without deleting neutral foreground colours or changing global keying.
    # Low-alpha Lanczos ringing at the opposite edge of a tiny upscaled fixture
    # is not an opaque canvas. Require near-opaque support on both edges.
    occupied = alpha >= 240
    paired_columns = float(np.mean(occupied[0] & occupied[-1]))
    paired_rows = float(np.mean(occupied[:, 0] & occupied[:, -1]))
    if max(paired_columns, paired_rows) >= 0.25:
        raise ValueError("frame_background_not_removed")
