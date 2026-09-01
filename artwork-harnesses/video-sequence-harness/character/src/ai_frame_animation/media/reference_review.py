"""Full-resolution diagnostic composites; never generation references."""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw


REVIEW_BACKGROUNDS = {
    "black": (0, 0, 0),
    "white": (255, 255, 255),
    "green": (0, 255, 0),
    "purple": (138, 64, 208),
}


def save_reference_review(image: Image.Image, directory: Path) -> None:
    """Write only to a new directory owned by the prepare staging operation.

    All panels have the exact foreground size and coordinates. No thresholding,
    enlargement, sharpening, recolouring or other foreground repair takes place.
    These views expose defects; they do not declare a visual quality pass.
    """
    directory.mkdir(exist_ok=False)
    foreground = image.convert("RGBA")
    for name, colour in REVIEW_BACKGROUNDS.items():
        background = Image.new("RGBA", foreground.size, (*colour, 255))
        Image.alpha_composite(background, foreground).convert("RGB").save(directory / f"{name}.png")
    checker = Image.new("RGBA", foreground.size, (72, 72, 72, 255))
    draw = ImageDraw.Draw(checker)
    for y in range(0, foreground.height, 32):
        for x in range(0, foreground.width, 32):
            if (x // 32 + y // 32) % 2:
                draw.rectangle((x, y, x + 31, y + 31), fill=(192, 192, 192, 255))
    Image.alpha_composite(checker, foreground).convert("RGB").save(directory / "checker.png")
    foreground.getchannel("A").save(directory / "alpha.png")
