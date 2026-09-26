"""Explicit alpha-only layer correction. Never redraw, resize, or promote a gate."""
import hashlib
import io
import math
from pathlib import Path
import time
import numpy as np
from PIL import Image
from .evaluate import digest, save


def adjust(source, expected_sha256, multiplier, output, reason):
    if type(multiplier) not in (int, float) or not math.isfinite(multiplier) or not 0 < multiplier <= 1:
        raise ValueError('OPACITY_MULTIPLIER_MUST_BE_IN_0_1')
    if not isinstance(reason, str) or not reason.strip():
        raise ValueError('EXPLICIT_CORRECTION_REASON_REQUIRED')
    started=time.monotonic()
    source=Path(source).resolve();output=Path(output).resolve()
    if output.exists():raise FileExistsError(output)
    if source.stat().st_size > 64*1024*1024:raise ValueError('SOURCE_SIZE')
    raw=source.read_bytes()
    if hashlib.sha256(raw).hexdigest()!=expected_sha256:raise ValueError('SOURCE_CHANGED')
    with Image.open(io.BytesIO(raw)) as im:
        if im.format!='PNG' or 'A' not in im.getbands() or im.getexif().get(274,1)!=1:
            raise ValueError('ORIENTED_ALPHA_PNG_REQUIRED')
        if im.width*im.height>67108864:raise ValueError('SOURCE_SIZE')
        pixels=np.array(im.convert('RGBA'))
    old=pixels[:,:,3].copy()
    if not old.any():raise ValueError('EMPTY_SOURCE')
    # Round half up. RGB stays straight-alpha, not multiplied by opacity.
    new=np.floor(old.astype(np.float64)*multiplier+0.5).astype(np.uint8)
    if not new.any():raise ValueError('EMPTY_CORRECTION')
    pixels[:,:,3]=new
    pixels[new==0]=0
    corrected=Image.fromarray(pixels)
    if digest(source)!=expected_sha256:raise ValueError('SOURCE_CHANGED')
    output.mkdir(parents=True,exist_ok=False)
    (output/'raw.png').write_bytes(raw)
    corrected.save(output/'corrected.png')
    result=dict(kind='ui_layer_opacity_correction_v1',status='corrected_pending_visual_review',
        operation='multiply-existing-alpha',multiplier=multiplier,reason=reason,
        sourceSha256=expected_sha256,outputSha256=digest(output/'corrected.png'),
        size=list(corrected.size),rounding='floor(alpha * multiplier + 0.5)',
        zeroAlphaRgb='zero',rgbOtherwiseUnchanged=True,geometryUnchanged=True,
        changedAlphaPixels=int(np.count_nonzero(old!=new)),
        effect='All owned pixels including borders, glow and decoration fade together.',
        wallSeconds=time.monotonic()-started,modelCalls=0,generationCalls=0,
        originalDagPromoted=False,humanVisualAcceptance=False,originalTransparencyRecovered=False)
    save(output/'result.json',result)
    return result
