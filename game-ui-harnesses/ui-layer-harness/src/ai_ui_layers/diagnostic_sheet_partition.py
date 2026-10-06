"""Read-only diagnostic partitions; never certify extraction or visual quality."""
import hashlib

import numpy as np
from PIL import Image


POLICY = 'pixel-exact-frozen-grid-diagnostic-v1'


def partition(image, row):
    """Return used boxes and evidence for *all* capacity cells, including orphans.

    Callers must retain independent unmodified crops for every partitionBoxes
    entry. This evidence permits diagnostic preservation only; it cannot promote
    the original failed extraction, assert complete bodies, or accept alpha.
    """
    if image.mode != 'RGBA':
        raise ValueError('DIAGNOSTIC_NATIVE_RGBA_REQUIRED')
    grid = row.get('grid')
    mids = row.get('materialIds')
    if (type(grid) not in (list, tuple) or len(grid) != 2
            or any(type(v) is not int or v < 1 for v in grid)
            or type(mids) is not list or not mids
            or any(type(mid) is not str or not mid for mid in mids)
            or len(set(mids)) != len(mids) or grid[0] * grid[1] < len(mids)):
        raise ValueError('DIAGNOSTIC_SHEET_GRID')
    columns, rows = grid
    if (image.width * image.height > 16_777_216
            or image.width // columns < 32 or image.height // rows < 32):
        raise ValueError('DIAGNOSTIC_SHEET_SIZE_UNSAFE')
    before = image.tobytes()
    from .host_material_review import candidate_sheet_cells
    candidate_issue = None
    try:
        used, candidate = candidate_sheet_cells(image, row)
    except ValueError as exc:
        candidate_issue = str(exc)
        candidate = None
        xs = [i * image.width // columns for i in range(columns + 1)]
        ys = [i * image.height // rows for i in range(rows + 1)]
        all_boxes = [[xs[x], ys[y], xs[x + 1], ys[y + 1]]
                     for y in range(rows) for x in range(columns)]
        used = all_boxes[:len(mids)]
    else:
        # The strict successful path omits unused capacity boxes. Recover them
        # from the verified grid coordinates without changing any source pixels.
        if candidate.get('partitionBoxes') is not None:
            all_boxes = candidate['partitionBoxes']
        else:
            # Successful strict cells share their full row bounds; trailing
            # unused rows still need the original axis cuts.
            from .sheet_pixels import axis_cuts
            alpha = np.asarray(image.getchannel('A'))
            xs = axis_cuts(alpha, columns, 1)
            ys = axis_cuts(alpha, rows, 0)
            all_boxes = [[xs[x], ys[y], xs[x + 1], ys[y + 1]]
                         for y in range(rows) for x in range(columns)]
    alpha = np.asarray(image.getchannel('A'))
    rebuilt = Image.new('RGBA', image.size)
    records = []
    for index, box in enumerate(all_boxes):
        l, t, r, b = box
        if min(r-l, b-t) < 32:
            raise ValueError('DIAGNOSTIC_SHEET_SIZE_UNSAFE')
        crop = image.crop(tuple(box))
        a = alpha[t:b, l:r]
        count = int(np.count_nonzero(a))
        if index < len(mids) and count == 0:
            raise ValueError('SHEET_MISSING_MATERIAL')
        rebuilt.paste(crop, (l, t))
        edge = np.concatenate((a[0], a[-1], a[:, 0], a[:, -1]))
        records.append(dict(cellIndex=index, materialId=mids[index] if index < len(mids) else None,
            box=list(box), used=index < len(mids), nonzeroAlphaCount=count,
            boundaryMaximumAlpha=int(edge.max()),
            boundaryEdges=[dict(edge=name, nonzeroAlphaCount=int(np.count_nonzero(values)),
                                maximumAlpha=int(values.max()))
                           for name, values in (('top', a[0]), ('bottom', a[-1]),
                                                ('left', a[:, 0]), ('right', a[:, -1]))],
            rgbaPixelsSha256=hashlib.sha256(crop.tobytes()).hexdigest(),
            sourcePixelsUnchanged=True, independentCutoutRequired=True))
    after = rebuilt.tobytes()
    if before != image.tobytes() or before != after:
        raise ValueError('DIAGNOSTIC_SOURCE_PIXEL_PARTITION_MISMATCH')
    seams = []
    for axis, cuts in (('x', sorted({b[0] for b in all_boxes})[1:]),
                       ('y', sorted({b[1] for b in all_boxes})[1:])):
        for cut in cuts:
            values = alpha[:, cut-1:cut+1] if axis == 'x' else alpha[cut-1:cut+1, :]
            seams.append(dict(axis=axis, cut=cut, nonzeroAlphaCount=int(np.count_nonzero(values)),
                              maximumAlpha=int(values.max()), bothAdjacentLinesTransparent=not bool(values.any())))
    unused = records[len(mids):]
    return [list(box) for box in used], dict(
        policy=POLICY, status='pending-human-review', diagnosticOnly=True,
        partitionBasis='frozen-grid-equal-division' if candidate_issue else 'existing-candidate-partition',
        candidateExtractionPassed=candidate_issue is None, candidateExtractionIssue=candidate_issue,
        strictExtractionIssue=(candidate.get('strictExtractionIssue') if candidate is not None
                               else candidate_issue.split(':', 1)[0]),
        candidateSplitEvidence=candidate, partitionBoxes=[list(b) for b in all_boxes],
        unusedCellBoxes=[r['box'] for r in unused], cells=records, internalSeams=seams,
        orphanSidecarsRequired=any(r['nonzeroAlphaCount'] for r in unused),
        allCapacityCutoutsRequired=True, allSourcePixelsRetained=True,
        reconstructionPixelExact=True, sourcePixelPartitionExact=True,
        sourceRgbaPixelsSha256=hashlib.sha256(before).hexdigest(),
        reconstructedRgbaPixelsSha256=hashlib.sha256(after).hexdigest(),
        sourcePixelsUnchanged=True, sourceThresholdApplied=False,
        sourceBodyCompletenessObserved=False, alphaQualityAccepted=False,
        humanVisualAcceptance=False, originalDagPromoted=False)
