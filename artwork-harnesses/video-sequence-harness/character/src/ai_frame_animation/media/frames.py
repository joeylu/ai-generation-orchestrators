"""Bounded, re-iterable decoded frames; no full-clip RGBA retention."""
from collections.abc import Sequence
from pathlib import Path

from PIL import Image

MAX_FRAME_PIXELS = 16_777_216
MAX_SOURCE_PIXELS = 268_435_456
MAX_SOURCE_FRAMES = 10000


def check_pixel_budget(width: int, height: int, count: int) -> None:
    if any(isinstance(v, bool) or not isinstance(v, int) or v < 1 for v in (width, height, count)):
        raise ValueError("decoded_dimensions_invalid")
    if count > MAX_SOURCE_FRAMES or width * height > MAX_FRAME_PIXELS or width * height * count > MAX_SOURCE_PIXELS:
        raise ValueError("decoded_pixel_budget_exceeded")


class DiskFrames(Sequence):
    def __init__(self, paths: Sequence[Path]):
        self.paths = tuple(paths)
        if not self.paths or len(self.paths) > MAX_SOURCE_FRAMES:
            raise ValueError("decoded_frame_count_invalid")
        sizes = set()
        for path in self.paths:
            if path.is_symlink() or not path.is_file():
                raise ValueError("decoded_frame_invalid")
            with Image.open(path) as image:
                check_pixel_budget(image.width, image.height, len(self.paths))
                sizes.add(image.size)
        if len(sizes) != 1:
            raise ValueError("decoded_frame_dimensions_differ")

    def __len__(self):
        return len(self.paths)

    def __getitem__(self, index):
        if isinstance(index, slice):
            return DiskFrames(self.paths[index])
        with Image.open(self.paths[index]) as image:
            return image.convert("RGBA")
