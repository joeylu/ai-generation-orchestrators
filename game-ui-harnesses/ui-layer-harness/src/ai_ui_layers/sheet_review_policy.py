"""Deterministic severity for new sheet observations; never reinterpret archived reviews."""
from jsonschema import Draft202012Validator

STATES = ['not-applicable', 'empty', 'partial', 'near-full', 'full', 'unknown']
CATEGORIES = ['progress', 'style', 'geometry', 'layout', 'identity', 'ownership',
              'missing-artwork', 'extra-artwork', 'clipping', 'text-policy', 'uncertain']
SCHEMA = dict(type='object', additionalProperties=False, required=['materialIds', 'findings'], properties={
    'materialIds': dict(type='array', items=dict(type='string')),
    'findings': dict(type='array', items=dict(type='object', additionalProperties=False,
        required=['materialId', 'category', 'referenceState', 'generatedState', 'magnitude',
                  'ownership', 'evidence', 'suggestion'], properties={
            'materialId': dict(type='string'), 'category': dict(type='string', enum=CATEGORIES),
            'referenceState': dict(type='string', enum=STATES),
            'generatedState': dict(type='string', enum=STATES),
            'magnitude': dict(type='string', enum=['minor', 'major', 'uncertain']),
            'ownership': dict(type='string', enum=['clear', 'ambiguous']),
            'evidence': dict(type='string', minLength=1),
            'suggestion': dict(type='string', minLength=1)}))})

PROMPT = (
    'Return materialIds and structured findings, not a model-selected severity. '
    'Report observations for every discrepancy; the program owns severity. '
    'Use progress for fill-length/state differences, never geometry/layout merely because '
    'a fill ends earlier. Classify visible fill states as empty, partial, near-full or full; '
    'use unknown when unclear. Estimates are not exact measurements. Full versus near-full '
    'is advisory for this static-composite review, without an exact-percentage requirement. '
    'All other categories use not-applicable for both states. Magnitude is minor, major or '
    'uncertain. Use style for brightness/glow/line-weight differences with artwork intact. '
    'Use geometry for actual contour distortion and layout for internal graphic displacement. '
    'Before asserting either, establish owned outlines in both images and describe the '
    'boundary evidence. BboxNorm only locates artwork; it is not a measured contour. '
    'If a neighbouring line might belong to another surface, set ownership=ambiguous; '
    'do not treat the crop ratio as proof of generation distortion. Preserve attached '
    'decoration. Give concrete evidence and an optional correction suggestion. '
    'Missing artwork, foreign/duplicate artwork, clipping, identity and text-policy '
    'errors must be reported under their own categories. Use uncertain if unclassifiable. '
    'Do not fix, redraw, or require a full fill for uniformity. Findings may be empty. '
)


def classify(answer, material_ids):
    Draft202012Validator(SCHEMA).validate(answer)
    if answer['materialIds'] != material_ids:
        raise ValueError('SHEET_IDENTITY_MISMATCH')
    warnings, blockers, decisions = [], [], []
    for finding in answer['findings']:
        if finding['materialId'] not in material_ids:
            raise ValueError('SHEET_FINDING_MATERIAL_MISMATCH')
        category = finding['category']
        states = {finding['referenceState'], finding['generatedState']}
        if (category == 'progress' and 'not-applicable' in states or
                category != 'progress' and states != {'not-applicable'}):
            raise ValueError('SHEET_FINDING_STATE_CATEGORY_MISMATCH')
        advisory = False
        attribution = 'visual-discrepancy'
        if finding['ownership'] == 'ambiguous':
            attribution = 'planning-or-localization-unresolved'
        elif category == 'progress' and 'unknown' not in states:
            advisory = (states <= {'full', 'near-full'} or
                        len(states) == 1 and finding['magnitude'] == 'minor')
        elif category == 'style':
            advisory = finding['magnitude'] == 'minor'
        decision = dict(finding, severity='warning' if advisory else 'blocking', attribution=attribution)
        decisions.append(decision)
        if advisory:
            warnings.append(dict(category='minor-progress-deviation' if category == 'progress' else
                'minor-style-deviation', materialId=finding['materialId'],
                evidence=finding['evidence'], suggestion=finding['suggestion']))
        else:
            blockers.append(decision)
    return dict(warnings=warnings, blockers=blockers, decisions=decisions)
