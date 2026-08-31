"""CPU-estimator doubles: no optional dependency, model, network or inference."""
from contextlib import contextmanager
from unittest.mock import patch

import numpy as np


def identity_foreground(rgb, alpha):
    assert rgb.dtype == np.float64 and alpha.dtype == np.float64
    return rgb.copy()


@contextmanager
def foreground_double(estimator=identity_foreground):
    with patch("ai_frame_animation.preparation.inspect_matting_runtime"), patch(
        "ai_frame_animation.media.reference_matte.load_foreground_estimator",
        return_value=(estimator, "fixture-foreground-ml"),
    ) as loader:
        yield loader
