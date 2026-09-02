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


def nine_slice(image: Image.Image, size: list[int], insets: list[int]) -> Image.Image:
    """Expand fitted foreground; insets are left/top/right/bottom support pixels."""
    require(isinstance(insets, list) and len(insets) == 4
            and all(type(value) is int and value > 0 for value in insets),
            "RESIZE_INSETS")
    require(isinstance(size, list) and len(size) == 2
            and all(type(value) is int and value > 0 for value in size)
            and size[0] * size[1] <= 67_108_864, "ASSET_SIZE")
    support = normalize(image)
    box = support.getchannel("A").getbbox()
    require(box is not None, "EMPTY_MATERIAL")
    support = support.crop(box)
    width, height = support.size
    target_width, target_height = size
    left, top, right, bottom = insets
    require(width > left + right and height > top + bottom,
            "RESIZE_SUPPORT_TOO_SMALL")
    require(target_width > left + right and target_height > top + bottom,
            "RESIZE_TARGET_TOO_SMALL")
    xs, ys = [0, left, width - right, width], [0, top, height - bottom, height]
    xt = [0, left, target_width - right, target_width]
    yt = [0, top, target_height - bottom, target_height]
    result = Image.new("RGBA", tuple(size), (0, 0, 0, 0))
    for row in range(3):
        for column in range(3):
            tile = support.crop((xs[column], ys[row], xs[column + 1], ys[row + 1]))
            target = (xt[column + 1] - xt[column], yt[row + 1] - yt[row])
            if tile.size != target:
                tile = tile.resize(target, Image.Resampling.LANCZOS)
            # Copy RGBA directly: using the tile as a mask would square its alpha.
            result.paste(tile, (xt[column], yt[row]))
    return normalize(result)


def resize_material(material: Image.Image, asset: dict) -> Image.Image:
    if "resize" not in asset:
        return material
    return nine_slice(material, asset["output_size"], asset["resize"]["insets"])


def matte_key(image: Image.Image, size: list[int]) -> Image.Image:
    source = np.asarray(image.convert("RGBA"))
    rgb = source[:, :, :3].astype(np.float32)
    source_alpha = source[:, :, 3]
    distance = np.sqrt(np.sum((rgb - KEY_RGB) ** 2, axis=2))
    alpha = np.minimum(np.where(distance < 145, 0, 255).astype(np.uint8), source_alpha)
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
