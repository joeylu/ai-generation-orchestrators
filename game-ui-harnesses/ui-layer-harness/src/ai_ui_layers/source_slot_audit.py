"""Read-only evidence for repeated flat slots and small-material crop boundaries.

This does not infer alpha, extract assets, repair a plan, or authorize generation.
"""
import argparse
from collections import Counter
import hashlib
from pathlib import Path

from PIL import Image

from .evaluate import digest, read, save


def _box(value, width, height):
    if (not isinstance(value, list) or len(value) != 4 or
            any(type(number) is not int for number in value)):
        raise ValueError('INVALID_SLOT_BOX')
    left, top, right, bottom = value
    if not (0 <= left < right <= width and 0 <= top < bottom <= height):
        raise ValueError('INVALID_SLOT_BOX')
    return tuple(value)


def _ring(width, height, border):
    return [(x, y) for y in range(height) for x in range(width)
            if x < border or y < border or x >= width-border or y >= height-border]


def _one_material(image, row, template, ring, border):
    width, height = template.size
    left, top, right, bottom = _box(row['sourceRegion'], *image.size)
    if right-left > width or bottom-top > height:
        return None
    # A planned crop is only a search anchor. The true artwork may protrude.
    center_x = (left+right)/2
    center_y = (top+bottom)/2
    radius_x = max(1, width*2//5)
    radius_y = max(1, height*2//5)
    start_x = max(0, int(center_x-width/2-radius_x))
    end_x = min(image.width-width, int(center_x-width/2+radius_x)+1)
    start_y = max(0, int(center_y-height/2-radius_y))
    end_y = min(image.height-height, int(center_y-height/2+radius_y)+1)
    expected = [template.getpixel(point) for point in ring]
    best = len(ring)+1
    matches = []
    for y in range(start_y, end_y+1):
        for x in range(start_x, end_x+1):
            candidate = image.crop((x, y, x+width, y+height))
            pixels = candidate.load()
            mismatch = sum(pixels[dx, dy] != color for (dx, dy), color in zip(ring, expected))
            best = min(best, mismatch)
            if mismatch == 0:
                matches.append((x, y, candidate))
    result = {'materialId': row['id'], 'plannedBox': [left, top, right, bottom],
              'bestFrameMismatchPixels': best, 'exactTemplateLocations': len(matches),
              'candidateForReviewedSourceRoute': False, 'sourceExtractionReady': False}
    if len(matches) != 1:
        result['status'] = 'template_mismatch' if not matches else 'ambiguous_template_location'
        return result
    x, y, candidate = matches[0]
    pixels = candidate.load()
    interior = [(dx, dy) for dy in range(border, height-border)
                for dx in range(border, width-border)]
    colors = Counter(pixels[point] for point in interior).most_common(2)
    fill, fill_count = colors[0]
    result.update(slotBox=[x, y, x+width, y+height], inferredFillRgb=list(fill),
                  fillFraction=round(fill_count/len(interior), 6))
    corners = ((border, border), (width-border-1, border),
               (border, height-border-1), (width-border-1, height-border-1))
    if (fill_count*5 < len(interior) or
            (len(colors) > 1 and colors[1][1] == fill_count) or
            any(pixels[point] != fill for point in corners)):
        result['status'] = 'uncertain_interior_fill'
        return result
    support = [(x+dx, y+dy, dx, dy) for dx, dy in interior if pixels[dx, dy] != fill]
    if not support:
        result['status'] = 'no_differing_pixels'
        return result
    omitted = sum(not (left <= px < right and top <= py < bottom)
                  for px, py, _, _ in support)
    edge = sum(dx in (border, width-border-1) or dy in (border, height-border-1)
               for _, _, dx, dy in support)
    result.update(differentPixelCount=len(support),
                  outsidePlannedBoxPixels=omitted, innerEdgeDifferentPixels=edge,
                  differentPixelBounds=[min(point[0] for point in support),
                                        min(point[1] for point in support),
                                        max(point[0] for point in support)+1,
                                        max(point[1] for point in support)+1])
    if edge:
        result['status'] = 'ownership_boundary_uncertain'
    elif omitted:
        result['status'] = 'planned_crop_omits_different_pixels'
    else:
        result['status'] = 'candidate_requires_visual_review'
        result['candidateForReviewedSourceRoute'] = True
    return result


def audit(reference, placements, specification):
    reference, placements, specification = map(Path, (reference, placements, specification))
    source_digests = tuple(digest(path) for path in (reference, placements, specification))
    with Image.open(reference) as source:
        if source.format != 'PNG' or source.getexif().get(274, 1) != 1:
            raise ValueError('IDENTITY_PNG_REQUIRED')
        if source.mode == 'RGBA' and source.getchannel('A').getextrema() != (255, 255):
            raise ValueError('OPAQUE_REFERENCE_REQUIRED')
        if source.mode not in ('RGB', 'RGBA'):
            raise ValueError('OPAQUE_REFERENCE_REQUIRED')
        image = source.convert('RGB')
    plan = read(placements)
    spec = read(specification)
    if spec.get('kind') != 'ui_source_slot_audit_input_v1':
        raise ValueError('SLOT_AUDIT_SPEC_KIND')
    boxes = [_box(box, *image.size) for box in spec['emptySlotBoxes']]
    if len(boxes) < 2 or len(set(boxes)) != len(boxes):
        raise ValueError('TWO_DISTINCT_EMPTY_SLOTS_REQUIRED')
    for index, (left, top, right, bottom) in enumerate(boxes):
        if any(max(left, other[0]) < min(right, other[2]) and
               max(top, other[1]) < min(bottom, other[3]) for other in boxes[:index]):
            raise ValueError('EMPTY_SLOTS_OVERLAP')
    sizes = {(r-l, b-t) for l, t, r, b in boxes}
    if len(sizes) != 1:
        raise ValueError('EMPTY_SLOT_SIZE_MISMATCH')
    width, height = sizes.pop()
    if not (8 <= width <= 128 and 8 <= height <= 128) or len(boxes) > 16:
        raise ValueError('SLOT_AUDIT_SIZE_LIMIT')
    border = spec['borderPixels']
    if type(border) is not int or not (1 <= border <= min(width, height)//4):
        raise ValueError('INVALID_SLOT_BORDER')
    first = image.crop(boxes[0])
    if any(image.crop(box).tobytes() != first.tobytes() for box in boxes[1:]):
        raise ValueError('EMPTY_SLOT_TEMPLATES_DIFFER')
    interior = first.crop((border, border, width-border, height-border))
    interior_bytes = interior.tobytes()
    if len(set(interior_bytes[i:i+3] for i in range(0, len(interior_bytes), 3))) != 1:
        raise ValueError('EMPTY_SLOT_INTERIOR_NOT_FLAT')
    if plan.get('basis') != 'declared material regions, no alpha measurement':
        raise ValueError('PLACEMENTS_CONTRACT_UNEXPECTED')
    rows = plan['materials']
    if len({row['id'] for row in rows}) != len(rows):
        raise ValueError('DUPLICATE_MATERIAL_ID')
    ring = _ring(width, height, border)
    results = [_one_material(image, row, first, ring, border) for row in rows]
    results = [row for row in results if row is not None]
    if source_digests != tuple(digest(path) for path in (reference, placements, specification)):
        raise ValueError('SLOT_AUDIT_INPUT_CHANGED')
    return {'kind': 'ui_source_slot_audit_v1', 'referenceSha256': source_digests[0],
            'placementsSha256': source_digests[1], 'specificationSha256': source_digests[2],
            'templateRgbSha256': hashlib.sha256(first.tobytes()).hexdigest(),
            'emptySlotBoxes': [list(box) for box in boxes], 'borderPixels': border,
            'differentPixelsAreNotAlpha': True, 'planChanged': False,
            'generationCalls': 0, 'materials': results}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--reference', type=Path, required=True)
    parser.add_argument('--placements', type=Path, required=True)
    parser.add_argument('--specification', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    result = audit(args.reference, args.placements, args.specification)
    save(args.output, result)
    print(args.output)


if __name__ == '__main__':
    main()
