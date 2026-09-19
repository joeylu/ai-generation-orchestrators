"""One offline planning review for reference-aligned PNG delivery.

Geometry checks declarations, never recognizes pixels or approves generated art.
Kept separate from legacy plan validation and intermediate board placements.
"""
from .common import digest
from .reference_coverage import check


def _covered(rect, boxes):
    """Exact rectangle union coverage; a bounding envelope can hide a seam gap."""
    x, y, w, h = rect
    right, bottom = x + w, y + h
    clipped = [(max(x, a), max(y, b), min(right, c), min(bottom, d))
               for a, b, c, d in boxes if a < right and c > x and b < bottom and d > y]
    xs = sorted({x, right, *(v for a, _, c, _ in clipped for v in (a, c))})
    for left, edge in zip(xs, xs[1:]):
        cursor = y
        for top, end in sorted((b, d) for a, b, c, d in clipped if a <= left and c >= edge):
            if top > cursor:
                return False
            cursor = max(cursor, end)
        if cursor < bottom:
            return False
    return True


def review(plan, coverage):
    structural = check(plan, coverage)
    issues = list(structural['issues'])
    assets = {a['id']: a for a in plan['assets']}
    elements = {e['id']: e for e in coverage['elements']}
    evidence = []
    for element in coverage['elements']:
        if element['disposition'] != 'material':
            continue
        owners = element['ownerAssets']
        sources = [assets[k]['source_region'] for k in owners]
        placed = []
        for node in plan['nodes']:
            if node['asset'] in owners:
                x, y = node['xy']
                w, h = assets[node['asset']]['output_size']
                placed.append([x, y, x + w, y + h])
        canonical = elements[element['reuse']['element']] if 'reuse' in element else element
        source_ok = _covered(canonical['region'], sources)
        placed_ok = _covered(element['region'], placed)
        mapping_ok = True
        if 'reuse' in element:
            asset=assets[owners[0]]
            left,top,right,bottom=asset['source_region']
            dx=element['region'][0]-canonical['region'][0]
            dy=element['region'][1]-canonical['region'][1]
            mapping_ok=(asset['output_size']==[right-left,bottom-top] and
                        any(n['asset']==owners[0] and n['xy']==[left+dx,top+dy] for n in plan['nodes']))
            if not mapping_ok:issues.append('PLANNING_REUSE_TRANSFORM:'+element['id'])
        for passed, code in ((source_ok, 'PLANNING_SOURCE_GAP'), (placed_ok, 'PLANNING_PLACEMENT_GAP')):
            if not passed:
                issues.append(code + ':' + element['id'])
        evidence.append(dict(element=element['id'],region=element['region'],owners=owners,
                             sourceElement=canonical['id'],sourceRegion=canonical['region'],
                             reuse=element.get('reuse'),
                             reuseTransformValid=mapping_ok,
                             sourceBounds=sources,placedBounds=placed,
                             sourceCovered=source_ok,placementCovered=placed_ok))
    result = dict(kind='ui_assets_planning_review_v1',status='blocked' if issues else 'passed',
                  planDigest=digest(plan),coverageDigest=digest(coverage),issues=issues,
                  structuralReview=structural,geometry=evidence,generationCalls=0,
                  ungroupedGeneratedAssets=sum(a['route'].startswith('generated_') for a in plan['assets']),
                  finalLayers=len(plan['nodes']),automaticSemanticInference=False,
                  humanVisualAcceptance=False,
                  scope='Reference-aligned target plan only. Inspect image inventory, prompts and grouping together; '
                        'geometry cannot detect undeclared art, semantic omissions or generated fidelity. '
                        'Relocated/rescaled layouts require a separate reviewed coordinate mapping.')
    result['digest'] = digest(result)
    return result
