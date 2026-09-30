"""Nine-region artwork inventory with exact plan ownership evidence."""

from jsonschema import Draft202012Validator


REGIONS = tuple(f'{vertical}-{horizontal}' for vertical in ('top', 'middle', 'bottom')
                for horizontal in ('left', 'center', 'right'))
DISPOSITIONS = ('covered', 'missing', 'uncertain', 'business-text', 'optional-shadow')


def coverage_schema():
    """One region in the new transport-compatible itemized review format."""
    nullable_id = {'type': ['string', 'null'], 'minLength': 1}
    entry = {'type': 'object', 'additionalProperties': False,
             'required': ['artwork', 'disposition', 'materialId', 'objectId',
                          'planEvidenceQuote', 'evidence', 'suggestedChange'],
             'properties': {
                 'artwork': {'type': 'string', 'minLength': 1},
                 'disposition': {'type': 'string', 'enum': list(DISPOSITIONS)},
                 'materialId': nullable_id,
                 'objectId': nullable_id,
                 'planEvidenceQuote': {'type': ['string', 'null']},
                 'evidence': {'type': 'string', 'minLength': 1},
                 'suggestedChange': {'type': ['string', 'null']}}}
    return {'type': 'object', 'additionalProperties': False,
            'required': ['region', 'observedArtwork', 'emptyRegionEvidence'],
            'properties': {
                'region': {'type': 'string', 'enum': list(REGIONS)},
                'observedArtwork': {'type': 'array', 'items': entry},
                'emptyRegionEvidence': {'type': ['string', 'null']}}}


def _owned_quote(entry, material, obj):
    quote = entry['planEvidenceQuote']
    if quote is None:
        return False
    if not isinstance(quote, str) or not quote.strip():
        raise ValueError('COVERAGE_QUOTE_EMPTY')
    owner = obj if obj is not None else material
    if owner is None or quote not in owner['label']:
        raise ValueError('COVERAGE_QUOTE_NOT_OWNED')
    return True


def _new_findings(regions, plan, policy):
    if plan is None:
        raise ValueError('COVERAGE_PLAN_REQUIRED')
    from .visual_policy import validate
    if policy is not None:
        validate(policy)
    materials = {m['id']: m for m in plan['materials']}
    objects = {o['id']: o for o in plan['objects']}
    schema = Draft202012Validator(coverage_schema())
    findings = []
    observed = 0
    for row in regions:
        schema.validate(row)
        entries = row['observedArtwork']
        empty = row['emptyRegionEvidence']
        if entries and empty is not None:
            raise ValueError('COVERAGE_NONEMPTY_REGION_HAS_EMPTY_EVIDENCE')
        if not entries and (not isinstance(empty, str) or not empty.strip()):
            raise ValueError('COVERAGE_EMPTY_REGION_EVIDENCE_REQUIRED')
        observed += len(entries)
        for entry in entries:
            if not entry['artwork'].strip() or not entry['evidence'].strip():
                raise ValueError('COVERAGE_ARTWORK_EVIDENCE_REQUIRED')
            state = entry['disposition']
            mid, oid = entry['materialId'], entry['objectId']
            material, obj = materials.get(mid), objects.get(oid)
            if mid is not None and material is None:
                raise ValueError('COVERAGE_MATERIAL_ID_UNKNOWN')
            if oid is not None and obj is None:
                raise ValueError('COVERAGE_OBJECT_ID_UNKNOWN')
            if mid is not None and obj is not None and obj['materialId'] != mid:
                raise ValueError('COVERAGE_OBJECT_OWNER_MISMATCH')
            if state == 'covered':
                if material is None or entry['suggestedChange'] is not None:
                    raise ValueError('COVERAGE_CLAIM_UNBOUND')
                if not _owned_quote(entry, material, obj):
                    raise ValueError('COVERAGE_CLAIM_WITHOUT_QUOTE')
            elif state in ('missing', 'uncertain'):
                suggestion = entry['suggestedChange']
                if not isinstance(suggestion, str) or not suggestion.strip():
                    raise ValueError('COVERAGE_CHANGE_REQUIRED')
                if entry['planEvidenceQuote'] is not None:
                    raise ValueError('COVERAGE_NONCOVERED_QUOTE')
                ids = ([mid] if material is not None else
                       [oid] if obj is not None else [])
                findings.append(dict(code='UNASSIGNED_VISIBLE_ARTWORK', category='semantic',
                    ids=ids, description=row['region']+': '+entry['artwork'],
                    sourceEvidence=entry['evidence'], suggestedChange=suggestion))
            else:
                if entry['planEvidenceQuote'] is not None or entry['suggestedChange'] is not None:
                    raise ValueError('COVERAGE_EXCLUSION_CANNOT_CLAIM_PLAN_EVIDENCE')
                if state == 'business-text':
                    if plan.get('textPolicy') != 'remove-business-text':
                        raise ValueError('COVERAGE_BUSINESS_TEXT_POLICY_REQUIRED')
                    if material is None:
                        raise ValueError('COVERAGE_BUSINESS_TEXT_OWNER_REQUIRED')
                    if obj is not None and obj['kind'] != 'text':
                        raise ValueError('COVERAGE_BUSINESS_TEXT_OWNED_GRAPHIC')
                    # Free source prose cannot prove which lettering an exclusion
                    # refers to; leave mixed retained/business text unverified.
                    if material.get('preserveText'):
                        raise ValueError('COVERAGE_PRESERVED_TEXT_CONFLICT')
                else:
                    if (policy is None or policy['shadow'] != 'optional' or material is None or
                            obj is not None and obj['kind'] != 'shadow'):
                        raise ValueError('COVERAGE_OPTIONAL_SHADOW_UNSUPPORTED')
    if not observed:
        raise ValueError('ALL_EMPTY_COVERAGE_AUDIT')
    return findings


def coverage_findings(review, plan=None, policy=None):
    """Return semantic findings; accept entire historical string-format reviews."""
    if 'coverageAudit' not in review:
        return []
    regions = review['coverageAudit']
    if (not isinstance(regions, list) or len(regions) != len(REGIONS) or
            {row.get('region') for row in regions if isinstance(row, dict)} != set(REGIONS)):
        raise ValueError('COVERAGE_REGIONS_REQUIRED')
    old = [isinstance(row.get('observedArtwork'), str) for row in regions]
    if any(old) and not all(old):
        raise ValueError('MIXED_COVERAGE_FORMAT')
    if all(old):
        if any('emptyRegionEvidence' in row for row in regions):
            raise ValueError('MIXED_COVERAGE_FORMAT')
        findings = []
        for row in regions:
            for missing in row['missingFromPlan']:
                findings.append(dict(code='UNASSIGNED_VISIBLE_ARTWORK', category='semantic',
                    ids=[missing['suggestedOwnerId']],
                    description=row['region']+': '+missing['artwork'],
                    suggestedChange=missing['suggestedChange']))
        return findings
    return _new_findings(regions, plan, policy)
