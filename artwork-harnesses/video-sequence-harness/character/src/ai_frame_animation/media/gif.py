from __future__ import annotations

from fractions import Fraction
from pathlib import Path
from typing import Sequence

from PIL import Image


class PreviewGifError(ValueError):
    pass


def binary_transparency_frame(source: Image.Image) -> Image.Image:
    rgba = source.convert("RGBA")
    rgb = rgba.convert("RGB")
    paletted = rgb.quantize(colors=255, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.NONE)
    palette = list(paletted.getpalette() or [])
    palette.extend([0] * (768 - len(palette)))
    palette[255 * 3 : 255 * 3 + 3] = [0, 0, 0]
    paletted.putpalette(palette)
    alpha = rgba.getchannel("A")
    transparent = alpha.point(lambda value: 255 if value < 255 else 0)
    paletted.paste(255, mask=transparent)
    paletted.info["transparency"] = 255
    return paletted


def gif_frame_durations(frame_count: int, fps: float | Fraction) -> list[int]:
    try:
        rate = Fraction(str(fps))
    except (ValueError, ZeroDivisionError, TypeError):
        raise PreviewGifError("preview_inputs_invalid") from None
    if isinstance(frame_count, bool) or not isinstance(frame_count, int) or frame_count < 1 or rate <= 0:
        raise PreviewGifError("preview_inputs_invalid")
    # GIF stores centiseconds. Round cumulative boundaries, not each frame's
    # duration, so fractional FPS cannot accumulate a shortened/lengthened loop.
    boundaries = [round(Fraction(index * 100, 1) / rate) for index in range(frame_count + 1)]
    durations = [(end - start) * 10 for start, end in zip(boundaries, boundaries[1:])]
    if any(duration < 10 or duration > 655350 for duration in durations):
        raise PreviewGifError("preview_timing_not_representable")
    return durations


def export_preview_gif(*, images: Sequence[Image.Image], out_gif: Path, fps: float | Fraction) -> None:
    durations = gif_frame_durations(len(images), fps)
    if len({image.size for image in images}) != 1:
        raise PreviewGifError("preview_frame_dimensions_invalid")
    frames = [binary_transparency_frame(image) for image in images]
    out_gif.parent.mkdir(parents=True, exist_ok=True)
    frames[0].save(
        out_gif,
        format="GIF",
        save_all=True,
        append_images=frames[1:],
        duration=durations,
        loop=0,
        disposal=2,
        transparency=255,
        optimize=False,
    )
