from __future__ import annotations

from importlib.metadata import entry_points
from pathlib import Path
from typing import Any

from .base import Provider


def load_provider(name: str, *, config_path: Path, root: Path) -> Provider:
    if name == "minimax_h3":
        from .minimax_h3 import MiniMaxH3Provider

        return MiniMaxH3Provider(config_path=config_path, root=root)
    matches = entry_points(group="ai_frame_animation.providers")
    for entry in matches:
        if entry.name == name:
            factory: Any = entry.load()
            return factory(config_path=config_path, root=root)
    raise ValueError(f"provider_plugin_not_found:{name}")
