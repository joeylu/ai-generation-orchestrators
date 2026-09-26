"""Conservative planning-review severity; legacy semantic/geometry issues stay blocking."""
COSMETIC_CODES = {'MINOR_COLOR_TONE', 'DESCRIPTION_WORDING'}
REGIONS = tuple(f'{vertical}-{horizontal}' for vertical in ('top','middle','bottom')
                for horizontal in ('left','center','right'))


def split(review, plan=None):
    blockers, warnings = [], []
    issues=list(review['issues'])
    if 'coverageAudit' in review:
        regions=review['coverageAudit']
        if len(regions)!=len(REGIONS) or {row['region'] for row in regions}!=set(REGIONS):
            raise ValueError('COVERAGE_REGIONS_REQUIRED')
        for row in regions:
            for missing in row['missingFromPlan']:
                issues.append(dict(code='UNASSIGNED_VISIBLE_ARTWORK',category='semantic',
                    ids=[missing['suggestedOwnerId']],
                    description=row['region']+': '+missing['artwork'],
                    suggestedChange=missing['suggestedChange']))
    if 'smallMaterialAudit' in review:
        rows=review['smallMaterialAudit']
        ids=[row['materialId'] for row in rows]
        if len(ids)!=len(set(ids)):
            raise ValueError('DUPLICATE_SMALL_MATERIAL_AUDIT')
        for row in rows:
            owner=row['materialId']
            descriptions=[] if plan is None else [item['label'] for item in plan['materials']
                if item['id']==owner]+[item['label'] for item in plan['objects']
                if item['materialId']==owner]
            for part in row['parts']:
                quote=part['planEvidenceQuote']
                if not quote or (plan is not None and not any(quote in label for label in descriptions)):
                    issues.append(dict(code='UNDESCRIBED_SMALL_MATERIAL_PART',category='semantic',
                        ids=[owner],description=owner+': '+part['visiblePart']+'; '+part['observedAppearance'],
                        suggestedChange=part['suggestedChange']))
    for issue in issues:
        if issue['category'] == 'cosmetic':
            if issue['code'] not in COSMETIC_CODES:
                raise ValueError('UNKNOWN_COSMETIC_REVIEW_CODE')
            warnings.append(issue)
        else:
            blockers.append(issue)
    return blockers, warnings


def signatures(issues):
    return {(i['code'], tuple(sorted(i['ids'])),
             i['description'] if i['code'] in ('UNASSIGNED_VISIBLE_ARTWORK',
                                               'UNDESCRIBED_SMALL_MATERIAL_PART') else None)
            for i in issues}
