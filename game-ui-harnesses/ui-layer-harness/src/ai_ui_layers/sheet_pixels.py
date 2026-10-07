"""Deterministic sheet preparation; never redraw or remove connected artwork."""
import numpy as np
from PIL import Image
from .evaluate import digest, save

STRICT_SEAM = 'strict-unique-empty-band-v1'
NEAREST_SEAM = 'nearest-unique-transparent-seam-v2'


def validate_seam_policy(policy):
    if policy not in (STRICT_SEAM, NEAREST_SEAM):
        raise ValueError('SHEET_SEAM_POLICY')


def prepare(source, target):
    """Only clear alpha 0/1 noise; all channels at alpha > 1 remain exact."""
    before = digest(source)
    with Image.open(source) as im:
        if 'A' not in im.getbands():
            raise ValueError('SHEET_NATIVE_ALPHA_REQUIRED')
        pixels = np.array(im.convert('RGBA'))
    alpha = pixels[:, :, 3]
    if alpha.min() != 0 or alpha.max() <= 1:
        raise ValueError('SHEET_NATIVE_ALPHA_REQUIRED')
    clear = alpha <= 1
    changed = int(np.count_nonzero(clear & np.any(pixels != 0, axis=2)))
    faint = int(np.count_nonzero(alpha == 1))
    hidden = int(np.count_nonzero((alpha == 0) & np.any(pixels[:, :, :3] != 0, axis=2)))
    pixels[clear] = 0
    Image.fromarray(pixels).save(target)
    if digest(source) != before:
        raise ValueError('SHEET_INPUT_CHANGED')
    evidence = dict(policy='sheet-alpha-floor-v1', alphaFloor=1,
                    changedPixels=changed, faintAlphaPixels=faint, hiddenRgbPixels=hidden, sourceSha256=before,
                    preparedSha256=digest(target))
    save(target.with_suffix('.json'), evidence)
    return evidence


def axis_cuts(alpha, count, axis, policy=STRICT_SEAM):
    """Select full-span empty cuts; v2 requires a unique nearest safe cut."""
    validate_seam_policy(policy)
    length = alpha.shape[axis]
    occupied = np.any(alpha != 0, axis=1-axis)
    nominal = [i * length // count for i in range(count+1)]
    cuts = [0]
    for i in range(1, count):
        # Search only the middle half of adjacent nominal cells. A boundary
        # may move, but cells may not reorder or consume a neighboring center.
        center = nominal[i]
        radius = max(2, length // count // 4)
        lo, hi = max(1, center-radius), min(length-1, center+radius)
        bands=[]; start=None
        for pos in range(lo, hi+1):
            if not occupied[pos]:
                if start is None: start=pos
            elif start is not None:
                if pos-start >= 2: bands.append((start,pos))
                start=None
        if start is not None and hi+1-start >= 2: bands.append((start,hi+1))
        if not bands or policy == STRICT_SEAM and len(bands) != 1:
            raise ValueError('SHEET_CONTOUR_TOUCHES_CELL_BOUNDARY' if not bands else 'SHEET_AMBIGUOUS_EMPTY_BANDS')
        # Both pixels adjoining the half-open cut must be empty.
        possible=[min(max(center,left+1),right-1) for left,right in bands]
        distance=min(abs(cut-center) for cut in possible)
        nearest=[cut for cut in possible if abs(cut-center)==distance]
        if len(nearest)!=1:raise ValueError('SHEET_NEAREST_TRANSPARENT_SEAM_TIE')
        cut=nearest[0]
        if occupied[cut-1] or occupied[cut]:raise ValueError('SHEET_NONZERO_ALPHA_SEAM')
        cuts.append(cut)
    cuts.append(length)
    return cuts
