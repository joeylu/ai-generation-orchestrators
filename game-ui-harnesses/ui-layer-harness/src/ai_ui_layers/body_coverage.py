"""Observed external effects, separate from the whole-body scale anchor.

Pixel checks constrain an independent semantic observation; they do not certify
that a translucent region is a shadow. Every source alpha pixel is retained.
"""
from collections import deque

import numpy as np

POLICY = 'observed-external-soft-effects-v1'
CONTRACT_KIND = 'ui_whole_body_registration_soft_effects_v2'
OBSERVATION_KIND = 'ui_body_observation_soft_effects_v2'
FIELD = 'outsideBodySupport'
SIDES = ('left', 'top', 'right', 'bottom')
STATES = ('none', 'external-soft-effect', 'owned-artwork', 'uncertain')
SOLID_ALPHA = 240


def validate_policy(policy):
    if policy not in (None, POLICY):
        raise ValueError('BODY_COVERAGE_POLICY_REQUIRED')
    return policy


def declarations(value):
    if not isinstance(value, list) or len(value) != 4:
        raise ValueError('COMPLETE_OUTSIDE_BODY_OBSERVATIONS_REQUIRED')
    result = {}
    for row in value:
        if (not isinstance(row, dict) or set(row) != {'side', 'classification', 'evidence'}
                or row['side'] not in SIDES or row['side'] in result
                or row['classification'] not in STATES
                or not isinstance(row['evidence'], str) or not row['evidence'].strip()
                or len(row['evidence']) > 4096):
            raise ValueError('COMPLETE_OUTSIDE_BODY_OBSERVATIONS_REQUIRED')
        result[row['side']] = row
    return result


def _connected_to_envelope(alpha, outside, envelope):
    """Every dense outside component must touch dense pixels in the envelope."""
    height, width = alpha.shape
    l, t, r, b = envelope
    reached = np.zeros_like(outside)
    queue = deque()

    def seed(x, y, inside_x, inside_y):
        if (0 <= x < width and 0 <= y < height and outside[y, x]
                and alpha[inside_y, inside_x] >= 128 and not reached[y, x]):
            reached[y, x] = True
            queue.append((x, y))

    for x in range(l, r):
        seed(x, t-1, x, t)
        seed(x, b, x, b-1)
    for y in range(t, b):
        seed(l-1, y, l, y)
        seed(r, y, r-1, y)
    while queue:
        x, y = queue.popleft()
        for nx, ny in ((x-1, y), (x+1, y), (x, y-1), (x, y+1)):
            if (0 <= nx < width and 0 <= ny < height
                    and outside[ny, nx] and not reached[ny, nx]):
                reached[ny, nx] = True
                queue.append((nx, ny))
    return int(np.count_nonzero(outside & ~reached))


def check(raw, body, margin, observations):
    reviewed = declarations(observations)
    if any(row['classification'] in ('owned-artwork', 'uncertain') for row in reviewed.values()):
        raise ValueError('OUTSIDE_BODY_OBSERVATION_UNRESOLVED')
    alpha = np.asarray(raw.getchannel('A'))
    height, width = alpha.shape
    l, t, r, b = body
    envelope = [max(0, l-margin), max(0, t-margin), min(width, r+margin), min(height, b+margin)]
    el, et, er, eb = envelope
    solid = alpha >= SOLID_ALPHA
    if not np.any(solid[t:b, l:r]):
        raise ValueError('BODY_SOLID_CORE_NOT_OBSERVABLE')
    solid_outside = solid.copy()
    solid_outside[et:eb, el:er] = False
    if np.any(solid_outside):
        raise ValueError('SOURCE_BODY_OMITS_SOLID_ARTWORK')
    outside = alpha >= 128
    outside[et:eb, el:er] = False
    side_counts = dict(left=int(np.count_nonzero(outside[et:eb, :el])),
        top=int(np.count_nonzero(outside[:et, :])),
        right=int(np.count_nonzero(outside[et:eb, er:])),
        bottom=int(np.count_nonzero(outside[eb:, :])))
    for side, count in side_counts.items():
        if count and reviewed[side]['classification'] != 'external-soft-effect':
            raise ValueError('UNREVIEWED_DENSE_EXTERNAL_EFFECT:'+side)
    detached = _connected_to_envelope(alpha, outside, envelope)
    if detached:
        raise ValueError('DETACHED_DENSE_EXTERNAL_EFFECT')
    dense_box = raw.getchannel('A').point(lambda a: 255 if a >= 128 else 0).getbbox()
    solid_box = raw.getchannel('A').point(lambda a: 255 if a >= SOLID_ALPHA else 0).getbbox()
    return dict(policy=POLICY, sourceDenseAlphaBox=list(dense_box), sourceSolidAlphaBox=list(solid_box),
        outsideBodyPixels=[max(0, l-dense_box[0]), max(0, t-dense_box[1]),
                           max(0, dense_box[2]-r), max(0, dense_box[3]-b)],
        maximumNativeBoundaryMarginPixels=margin, solidAlphaMinimum=SOLID_ALPHA,
        reviewedExternalAlphaMaximum=SOLID_ALPHA-1, externalDensePixelsBySide=side_counts,
        externalDensePixels=int(np.count_nonzero(outside)), detachedDensePixels=detached,
        outsideBodySupport=[reviewed[side] for side in SIDES],
        semanticClassificationProven=False, alphaPixelsRemoved=0)
