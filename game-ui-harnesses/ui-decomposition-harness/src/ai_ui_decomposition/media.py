from __future__ import annotations

from PIL import Image, ImageFilter
import numpy as np
from scipy import ndimage

from .common import require


KEY_RGB = np.array([248, 8, 248], dtype=np.float32)


def normalize(image: Image.Image) -> Image.Image:
    values = np.array(image.convert("RGBA"))
    values[values[:, :, 3] == 0, :3] = 0
    return Image.fromarray(values, "RGBA")


def contain(image: Image.Image, size: list[int]) -> Image.Image:
    support = normalize(image)
    box = support.getchannel("A").getbbox()
    require(box is not None, "EMPTY_MATERIAL")
    support = support.crop(box)
    support.thumbnail(tuple(size), Image.Resampling.LANCZOS)
    canvas = Image.new("RGBA", tuple(size), (0, 0, 0, 0))
    canvas.alpha_composite(support, ((size[0] - support.width) // 2,
                                     (size[1] - support.height) // 2))
    values = np.array(canvas)
    alpha = values[:, :, 3]
    values[alpha < 8, 3] = 0
    values[alpha > 247, 3] = 255
    values[values[:, :, 3] == 0, :3] = 0
    return Image.fromarray(values, "RGBA")


def matte_key(image: Image.Image, size: list[int]) -> Image.Image:
    rgb = np.asarray(image.convert("RGB"), dtype=np.float32)
    distance = np.sqrt(np.sum((rgb - KEY_RGB) ** 2, axis=2))
    alpha = np.where(distance < 145, 0, 255).astype(np.uint8)
    # Remove key-colored pixels globally, including enclosed holes. Softening only
    # shapes alpha; it does not restore pixels or infer a semantic mask.
    alpha_image = Image.fromarray(alpha, "L").filter(ImageFilter.GaussianBlur(0.65))
    alpha = np.asarray(alpha_image).copy()
    alpha = np.where(alpha < 8, 0, np.where(alpha > 247, 255, alpha)).astype(np.uint8)
    cleaned = rgb.astype(np.uint8)
    opaque = alpha >= 247
    require(np.any(opaque), "EMPTY_MATERIAL")
    indices = ndimage.distance_transform_edt(~opaque, return_distances=False,
                                             return_indices=True)
    fringe = (alpha > 0) & ~opaque
    nearest = cleaned[indices[0], indices[1]]
    cleaned[fringe] = nearest[fringe]
    rgba = np.dstack([cleaned, alpha])
    rgba[alpha == 0, :3] = 0
    return contain(Image.fromarray(rgba, "RGBA"), size)


def opaque_exact(image: Image.Image, size: list[int]) -> Image.Image:
    result = image.convert("RGB").resize(tuple(size), Image.Resampling.LANCZOS)
    return result.convert("RGBA")
