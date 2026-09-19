from __future__ import annotations

from PIL import Image, ImageFilter
import numpy as np
from scipy import ndimage

from .common import require


KEY_RGB = np.array([248, 8, 248], dtype=np.float32)


def visible_support_geometry(image: Image.Image, size: list[int], insets: list[int]) -> dict:
    """Measure nonzero Alpha support against declared margins; no semantic inference."""
    require(list(image.size) == list(size), 'SUPPORT_CANVAS_SIZE')
    require(len(insets) == 4 and all(type(v) is int and v >= 0 for v in insets),
            'SUPPORT_INSETS')
    left, top, right, bottom = insets
    expected = [size[0]-left-right, size[1]-top-bottom]
    require(min(expected) > 0, 'SUPPORT_INSETS')
    box = image.convert('RGBA').getchannel('A').getbbox()
    require(box is not None, 'EMPTY_MATERIAL')
    actual = [box[2]-box[0], box[3]-box[1]]
    return dict(canvasSize=list(size), alphaBounds=list(box), visibleSize=actual,
                allowedInsets=list(insets), expectedVisibleSize=expected,
                actualInsets=[box[0], box[1], size[0]-box[2], size[1]-box[3]],
                relativeSizeError=[abs(a/e-1) for a,e in zip(actual,expected)])


def require_explicit_key_background(image: Image.Image) -> None:
    """Declared key or already-transparent edges; never infer a returned palette."""
    pixels=np.asarray(image.convert('RGBA'))
    edge=np.concatenate([pixels[0],pixels[-1],pixels[:,0],pixels[:,-1]])
    clear=(np.linalg.norm(edge[:,:3].astype(float)-KEY_RGB,axis=1)<45)|(edge[:,3]==0)
    require(float(np.mean(clear))>=.98,'KEY_BACKGROUND_REQUIRED')


def require_long_control_geometry(image: Image.Image, size: list[int],
                                  foreground_support: dict | None = None, *,
                                  preserve_source_alpha: bool = False) -> None:
    """Reject grossly shortened thin controls even inside a correct-size canvas."""
    support_size = list(size)
    if foreground_support is not None:
        left, top, right, bottom = foreground_support["insets"]
        support_size = [size[0] - left - right, size[1] - top - bottom]
        geometry = visible_support_geometry(image, size, foreground_support['insets'])
        # Explicit support applies to ordinary buttons too, not just 8:1 rails.
        # Two pixels accommodate raster rounding; 15% is a structural tolerance.
        require(preserve_source_alpha or all(abs(a-e) <= max(2, .15*e) for a,e in
                    zip(geometry['visibleSize'], geometry['expectedVisibleSize'])),
                'VISIBLE_SUPPORT_SIZE_MISMATCH')
    if max(support_size) / min(support_size) < 8:
        return
    box = image.getchannel('A').getbbox()
    require(box is not None, 'EMPTY_MATERIAL')
    ratio = (box[2]-box[0]) / (box[3]-box[1])
    expected = support_size[0]/support_size[1]
    # Structural tolerance for thin-control margins, not a visual acceptance score.
    require(abs(ratio/expected-1) <= 0.15, 'LONG_CONTROL_SUPPORT_ASPECT_MISMATCH')


def normalize(image: Image.Image) -> Image.Image:
    values = np.array(image.convert("RGBA"))
    values[values[:, :, 3] == 0, :3] = 0
    return Image.fromarray(values, "RGBA")


def contain(image: Image.Image, size: list[int]) -> Image.Image:
    support = normalize(image)
    # Pixels already discarded by the final Alpha policy must not enlarge the
    # fitting bounds and shrink the visible component before they disappear.
    values = np.array(support)
    values[values[:, :, 3] < 8] = 0
    support = Image.fromarray(values, "RGBA")
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


def nine_slice(image: Image.Image, size: list[int], insets: list[int], *, preserve_alpha_margin: bool = False) -> Image.Image:
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
    if preserve_alpha_margin:
        # Retain a real source pixel surrounding the support, where available.
        # Never erase opaque edge pixels or synthesize a transparent success.
        box = (max(0,box[0]-1),max(0,box[1]-1),min(support.width,box[2]+1),min(support.height,box[3]+1))
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
    if asset['resize']['mode'] == 'contain':
        width, height = asset['output_size']
        left, top, right, bottom = asset['resize']['insets']
        require(min(left, top, right, bottom) > 0 and width > left+right
                and height > top+bottom, 'RESIZE_TARGET_TOO_SMALL')
        fitted = contain(material, [width-left-right, height-top-bottom])
        canvas = Image.new('RGBA', (width, height))
        canvas.paste(fitted, (left, top))
        return normalize(canvas)
    return nine_slice(material, asset["output_size"], asset["resize"]["insets"], preserve_alpha_margin=asset['resize'].get('preserve_alpha_margin',False))


def matte_key(image: Image.Image, size: list[int]) -> Image.Image:
    require_explicit_key_background(image)
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
