"""CPU-estimator doubles: no optional dependency, model, network or inference."""
from contextlib import contextmanager
from pathlib import Path
from unittest.mock import patch

import numpy as np

from ai_frame_animation.canonical import write_json_atomic
from ai_frame_animation.providers.minimax_h3 import MiniMaxH3Provider


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


def provider_fixture(root: Path) -> MiniMaxH3Provider:
    """Local provider configuration double; no request is submitted."""
    write_json_atomic(root / "workflow.json", {
        "1": {"inputs": {"image": ""}, "class_type": "LoadImage"},
        "2": {"inputs": {"text": ""}, "class_type": "Text"},
    })
    write_json_atomic(root / "config.json", {
        "base_url": "http://127.0.0.1:8188",
        "workflow_path": "workflow.json",
        "bindings": {
            "reference_image": {"node": "1", "input": "image"},
            "positive_prompt": {"node": "2", "input": "text"},
        },
    })
    return MiniMaxH3Provider(config_path=root / "config.json", root=root)
