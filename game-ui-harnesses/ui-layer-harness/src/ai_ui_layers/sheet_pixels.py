"""Deterministic sheet preparation; never redraw or remove connected artwork."""
import numpy as np
from PIL import Image
from .evaluate import digest, save

STRICT_SEAM = 'strict-unique-empty-band-v1'
NEAREST_SEAM = 'nearest-unique-transparent-seam-v2'


def validate_seam_policy(policy):
    if policy not in (STRICT_SEAM, NEAREST_SEAM):
        raise ValueError('SHEET_SEAM_POLICY')


def prepared_image(image):
    """Shared preparation for sheet checks and delivery; never alter alpha > 1."""
    if 'A' not in image.getbands():
        raise ValueError('SHEET_NATIVE_ALPHA_REQUIRED')
    pixels = np.array(image.convert('RGBA'))
    alpha = pixels[:, :, 3]
    if alpha.min() != 0 or alpha.max() <= 1:
        raise ValueError('SHEET_NATIVE_ALPHA_REQUIRED')
    clear = alpha <= 1
    changed = int(np.count_nonzero(clear & np.any(pixels != 0, axis=2)))
    faint = int(np.count_nonzero(alpha == 1))
    hidden = int(np.count_nonzero((alpha == 0) & np.any(pixels[:, :, :3] != 0, axis=2)))
    pixels[clear] = 0
    return Image.fromarray(pixels), dict(policy='sheet-alpha-floor-v1', alphaFloor=1,
        changedPixels=changed, faintAlphaPixels=faint, hiddenRgbPixels=hidden)


def prepare(source, target):
    """Only clear alpha 0/1 noise; all channels at alpha > 1 remain exact."""
    before = digest(source)
    with Image.open(source) as im:
        image, evidence = prepared_image(im)
    image.save(target)
    if digest(source) != before:
        raise ValueError('SHEET_INPUT_CHANGED')
    evidence.update(sourceSha256=before, preparedSha256=digest(target))
    save(target.with_suffix('.json'), evidence)
    return evidence


def guarded_cell(image, guard=2):
    """Keep every nonzero source RGBA pixel, including alpha=1 glow tails."""
    if type(guard) is not int or guard < 2:
        raise ValueError('SHEET_CELL_SAMPLING_GUARD_REQUIRED')
    original = np.array(image.convert('RGBA'))
    pixels = original.copy()
    pixels[pixels[:, :, 3] == 0] = 0
    cell = Image.fromarray(pixels)
    padded = Image.new('RGBA', (cell.width+2*guard, cell.height+2*guard))
    padded.paste(cell, (guard, guard))
    replay = np.asarray(padded.crop((guard, guard, guard+cell.width, guard+cell.height)))
    visible = original[:, :, 3] > 0
    if not np.array_equal(replay[visible], original[visible]):
        raise ValueError('SHEET_CELL_NONZERO_PIXELS_CHANGED')
    return padded


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


def partition_observations(image, row, policy=STRICT_SEAM):
    """Explain a failed partition without selecting new cuts or altering its gate."""
    validate_seam_policy(policy)
    if 'A' not in image.getbands():
        raise ValueError('SHEET_NATIVE_ALPHA_REQUIRED')
    alpha = np.asarray(image.getchannel('A'))
    columns, rows = row['grid']
    axes = {}
    for name, count, axis in (('x', columns, 1), ('y', rows, 0)):
        length = alpha.shape[axis]
        occupied = np.any(alpha != 0, axis=1-axis)
        seams = []
        for index in range(1, count):
            center = index*length//count
            radius = max(2, length//count//4)
            lo, hi = max(1, center-radius), min(length-1, center+radius)
            longest = current = 0
            for empty in ~occupied[lo:hi+1]:
                current = current+1 if empty else 0
                longest = max(longest, current)
            seams.append(dict(index=index, nominalCut=center, searchRange=[lo, hi+1],
                fullSpanEmptyLines=int(np.count_nonzero(~occupied[lo:hi+1])),
                longestFullSpanEmptyBand=int(longest)))
        observation = dict(requestedCells=count, seams=seams)
        try:
            observation['cuts'] = axis_cuts(alpha, count, axis, policy)
            observation['failureCode'] = None
        except ValueError as error:
            observation.update(cuts=None, failureCode=str(error))
        axes[name] = observation
    edges = {name:dict(nonzeroAlphaPixels=int(np.count_nonzero(edge)), maximumAlpha=int(edge.max()))
        for name, edge in (('top', alpha[0]), ('bottom', alpha[-1]),
                           ('left', alpha[:, 0]), ('right', alpha[:, -1]))}
    return dict(kind='ui_sheet_partition_observations_v1', imageSize=list(image.size),
        grid=list(row['grid']), seamPolicy=policy, axes=axes, outerBoundary=edges,
        measurementBasis='supplied detection alpha; full-span empty lines, not semantic contours',
        diagnosticOnly=True, pixelsModified=False, transparentPartitionProven=False,
        sourceCompletenessAccepted=False)
