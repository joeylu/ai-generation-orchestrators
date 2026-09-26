"""Deterministic horizontal frame adaptation for explicitly reviewed card art."""
import hashlib
import io
from pathlib import Path

import numpy as np
from PIL import Image

from .evaluate import digest, save


POLICY = 'horizontal-frame-slice'


def _resample(image, size):
    result = image.convert('RGBa').resize(size, Image.Resampling.LANCZOS).convert('RGBA')
    pixels = np.asarray(result).copy()
    pixels[pixels[:, :, 3] == 0] = 0
    return Image.fromarray(pixels)


def adapt(source, expected_sha256, width, height, output, policy=POLICY):
    """Preserve uniformly scaled end bands; resize only the plain center band."""
    if policy != POLICY:
        raise ValueError('EXPLICIT_HORIZONTAL_FRAME_POLICY_REQUIRED')
    if any(type(v) is not int or not 1 <= v <= 4096 for v in (width, height)) or width / height < 3:
        raise ValueError('HORIZONTAL_FRAME_TARGET_SIZE')
    source, output = Path(source), Path(output)
    raw = source.read_bytes()
    if hashlib.sha256(raw).hexdigest() != expected_sha256:
        raise ValueError('SOURCE_CHANGED')
    with Image.open(io.BytesIO(raw)) as im:
        if im.format != 'PNG' or 'A' not in im.getbands() or im.getexif().get(274, 1) != 1:
            raise ValueError('ORIENTED_ALPHA_PNG_REQUIRED')
        if im.width * im.height > 67108864:
            raise ValueError('SOURCE_SIZE')
        pixels = np.asarray(im.convert('RGBA')).copy()
    alpha = pixels[:, :, 3]
    if alpha.min() != 0 or alpha.max() <= 1:
        raise ValueError('EMPTY_OR_OPAQUE_SOURCE')
    faint = int(np.count_nonzero(alpha == 1))
    pixels[alpha <= 1] = 0
    prepared = Image.fromarray(pixels)
    box = prepared.getchannel('A').getbbox()
    if box[0] == 0 or box[1] == 0 or box[2] == prepared.width or box[3] == prepared.height:
        raise ValueError('SOURCE_CONTOUR_TOUCHES_CANVAS')
    visible = prepared.getchannel('A').point(lambda value: 255 if value >= 8 else 0).getbbox()
    if visible is None:
        raise ValueError('EMPTY_VISIBLE_FRAME')
    cropped = prepared.crop(box)
    scale = height / (visible[3] - visible[1])
    uniform_size = (max(1, round(cropped.width * scale)),
                    max(1, round(cropped.height * scale)))
    uniform = _resample(cropped, uniform_size)
    visible_uniform = uniform.getchannel('A').point(lambda value: 255 if value >= 8 else 0).getbbox()
    if visible_uniform is None:
        raise ValueError('EMPTY_VISIBLE_FRAME')
    visible_width = visible_uniform[2] - visible_uniform[0]
    corner = max(8, round(height / 3))
    if min(visible_width, width) <= 2 * corner + 8:
        raise ValueError('FRAME_CENTER_TOO_SMALL')
    delta = width - visible_width
    left_cut = visible_uniform[0] + corner
    right_cut = visible_uniform[2] - corner
    middle_width = right_cut - left_cut + delta
    center_scale = middle_width / (right_cut - left_cut)
    if not 0.8 <= center_scale <= 1.25:
        raise ValueError('FRAME_CENTER_SCALE_EXCESSIVE')
    left = uniform.crop((0, 0, left_cut, uniform.height))
    middle = uniform.crop((left_cut, 0, right_cut, uniform.height))
    right = uniform.crop((right_cut, 0, uniform.width, uniform.height))
    middle = _resample(middle, (middle_width, uniform.height))
    joined = Image.new('RGBA', (uniform.width + delta, uniform.height))
    joined.paste(left, (0, 0))
    joined.paste(middle, (left_cut, 0))
    joined.paste(right, (left_cut + middle_width, 0))
    values = np.asarray(joined)[:, :, :3].astype(np.int16)
    gradients = np.abs(np.diff(values, axis=1)).mean(axis=(0, 2))
    seam_jumps = [float(gradients[left_cut - 1]), float(gradients[left_cut + middle_width - 1])]
    background_jump = float(np.percentile(gradients, 95))
    if max(seam_jumps) > max(12.0, 2 * background_jump):
        raise ValueError('FRAME_SLICE_SEAM')
    padding = max(8, round(height / 5))
    canvas = Image.new('RGBA', (joined.width + 2 * padding, joined.height + 2 * padding))
    canvas.paste(joined, (padding, padding))
    if hashlib.sha256(source.read_bytes()).hexdigest() != expected_sha256:
        raise ValueError('SOURCE_CHANGED')
    output.mkdir(parents=True, exist_ok=False)
    (output / 'raw.png').write_bytes(raw)
    prepared.save(output / 'prepared.png')
    cropped.save(output / 'source-crop.png')
    canvas.save(output / 'adapted.png')
    result = dict(kind='ui_horizontal_frame_slice_adaptation_v1', policy=policy,
                  status='adapted_pending_visual_review', sourceSha256=expected_sha256,
                  preparedSha256=digest(output / 'prepared.png'),
                  outputSha256=digest(output / 'adapted.png'), sourceBox=list(box),
                  visibleSourceBox=list(visible), targetArtworkSize=[width, height],
                  uniformSize=list(uniform.size), uniformVisibleBox=list(visible_uniform),
                  protectedEndWidth=corner, centerScaleX=center_scale, outputPadding=padding,
                  seamMeanRgbJump=seam_jumps, backgroundP95RgbJump=background_jump,
                  alphaFloor=1, clearedFaintAlphaPixels=faint,
                  resampling='premultiplied-lanczos', generationRatioAccurate=False,
                  humanVisualAcceptance=False, automaticRetries=0)
    save(output / 'result.json', result)
    return result
