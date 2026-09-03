"""Provider seam for an already background-removed RGBA still image."""

from __future__ import annotations

from pathlib import Path
from typing import Mapping, Protocol

from PIL import Image


class ForegroundProvider(Protocol):
    def inspect(self) -> Mapping[str, object]: ...

    def infer_foreground(
        self, source: Path, expected_size: tuple[int, int]
    ) -> tuple[Image.Image, Mapping[str, object]]: ...
