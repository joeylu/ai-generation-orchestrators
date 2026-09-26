"""Geometry-only suspicion for repeated, aligned card frames."""
from statistics import median


def _aligned_groups(plan):
    cards = []
    for material in plan['materials']:
        if material['role'] != 'foreground' or material.get('bboxNorm') is None:
            continue
        owned = [o for o in plan['objects'] if o['materialId'] == material['id']]
        if sum(o['kind'] == 'card' for o in owned) != 1:
            continue
        cards.append((material['id'], material['bboxNorm']))
    groups = []
    seen = set()
    for _, anchor in cards:
        width = anchor[2] - anchor[0]
        tolerance = max(.006, width * .03)
        group = [(mid, box) for mid, box in cards
                 if abs(box[0] - anchor[0]) <= tolerance
                 and abs(box[2] - anchor[2]) <= tolerance]
        group.sort(key=lambda row: row[1][1])
        key = tuple(mid for mid, _ in group)
        if key in seen or len(group) < 3:
            continue
        seen.add(key)
        if any(a[1][3] > b[1][1] for a, b in zip(group, group[1:])):
            continue
        groups.append(group)
    return groups


def repeated_card_alignment_group(plan):
    """Return three comparable card rows for bounded source review."""
    groups = _aligned_groups(plan)
    if not groups:
        return None
    return max(groups, key=lambda group: (len(group), group[0][1][2] - group[0][1][0]))[:3]


def repeated_card_height_outlier(plan):
    """Return one strong outlier plus two peers; this is not a visual verdict."""
    candidates = []
    for group in _aligned_groups(plan):
        heights = [box[3] - box[1] for _, box in group]
        typical = median(heights)
        if typical <= 0:
            continue
        tallest = max(group, key=lambda row: row[1][3] - row[1][1])
        height = tallest[1][3] - tallest[1][1]
        excess = height - typical
        if excess >= .015 and height / typical >= 1.15:
            candidates.append((excess, group, tallest[0], typical))
    if not candidates:
        return None
    _, group, outlier_id, typical = max(candidates, key=lambda row: row[0])
    peers = sorted((row for row in group if row[0] != outlier_id),
                   key=lambda row: abs((row[1][3] - row[1][1]) - typical))[:2]
    return (sorted([next(row for row in group if row[0] == outlier_id), *peers],
                   key=lambda row: row[1][1]), outlier_id, typical)
