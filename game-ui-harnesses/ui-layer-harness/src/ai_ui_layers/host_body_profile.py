"""Versioned actual-alpha display and measurement rules for host body exchange."""
from PIL import Image
from . import body_coverage

LEGACY = 'host-body-observation-v1'
POLICY = 'host-body-observation-alpha-v2'
SOFT_EFFECTS = 'host-body-observation-soft-effects-v3'
PREVIEWS = ('generated-light.png', 'generated-dark.png', 'generated-alpha.png')
BACKGROUNDS = ((240, 240, 240), (32, 32, 32))
GUIDANCE = '''
Use generated.png (actual-alpha checker composite), generated-light.png and
generated-dark.png for visible appearance. All generated previews use the same
pixel coordinates and actual continuous alpha. generated-alpha.png shows opacity
only, never the semantic body boundary. source-original.png preserves native
bytes; RGB under alpha zero is invisible, not a leftover backing.
issues contains blockers to reliable complete-body correspondence: ambiguity,
occlusion, clipping, missing/repeated content, wrong ownership or major/uncertain
deformation. These still require uncertain/not-whole and null boxes.
geometryDifferences records measurable size, position and aspect differences.
A measurable difference alone does not make a boundary uncertain. Observe the
actual edges; never change coordinates to pass a fit. The deterministic program
owns the frozen uniform fit and residual ceiling. materialIssues records minor
appearance differences allowed by the bound visual policy; major or uncertain
content/appearance faults belong in issues. Do not judge overall visual success.
'''
SOFT_EFFECT_GUIDANCE = '''
Also observe outsideBodySupport separately for left, top, right and bottom of
the measured source body. Provide all four unique sides with concrete evidence.
Classify none, external-soft-effect, owned-artwork or uncertain. Only external
soft shadows or glow may be external-soft-effect. Translucent owned surfaces,
outlines, detached objects, duplicate graphics and missing body parts are owned
artwork or uncertain, never a shadow exception. Any unresolved classification
requires issues and uncertain/not-whole. Do not move the measured body edge to
include a shadow merely to satisfy an opacity threshold. The program separately
requires alpha>=240 artwork inside the measured body plus its frozen native
measurement margin. Dense exterior effects (alpha128..239) beyond that margin
require explicit semantic evidence and a dense connection to the margin.
These checks are not proof that a region is a shadow. Every nonzero source alpha
pixel remains in storage; no alpha cleanup or body-mask crop is permitted.
'''


def alpha_profile(policy):
    return policy in (POLICY, SOFT_EFFECTS)


def validate_binding(policy, fit_policy, coverage_policy):
    validate(policy)
    body_coverage.validate_policy(coverage_policy)
    if fit_policy is not None and not alpha_profile(policy):
        raise ValueError('BODY_FIT_REQUIRES_ALPHA_OBSERVATION_PROFILE')
    if policy == SOFT_EFFECTS:
        if fit_policy is None or coverage_policy != body_coverage.POLICY:
            raise ValueError('SOFT_EFFECTS_REQUIRE_EXPLICIT_FIT_AND_COVERAGE_POLICY')
    elif coverage_policy is not None:
        raise ValueError('EXTERNAL_EFFECTS_REQUIRE_V3_OBSERVATION')


def validate(policy):
    if policy not in (LEGACY, POLICY, SOFT_EFFECTS):
        raise ValueError('HOST_BODY_OBSERVATION_POLICY_REQUIRED')
    return policy


def schema(policy):
    from .body_observation import schema as legacy_schema
    validate(policy)
    result = legacy_schema()
    if alpha_profile(policy):
        for key in ('geometryDifferences', 'materialIssues'):
            result['properties'][key] = dict(type='array', maxItems=32,
                items=dict(type='string', minLength=1, maxLength=4096))
            result['required'].append(key)
    if policy == SOFT_EFFECTS:
        result['properties'][body_coverage.FIELD] = dict(type='array', minItems=4, maxItems=4,
            items=dict(type='object', additionalProperties=False, required=['side','classification','evidence'],
                properties=dict(side=dict(type='string', enum=list(body_coverage.SIDES)),
                    classification=dict(type='string', enum=list(body_coverage.STATES)),
                    evidence=dict(type='string', minLength=1, maxLength=4096))))
        result['required'].append(body_coverage.FIELD)
    return result


def pixels(source, size):
    with Image.open(source) as image:
        raw = image.convert('RGBA')
        raw.thumbnail((1536, 1536), Image.Resampling.LANCZOS)
    if list(raw.size) != list(size):
        raise ValueError('BODY_DISPLAY_MAPPING_CHANGED')
    composites = []
    for color in BACKGROUNDS:
        base = Image.new('RGBA', raw.size, (*color, 255))
        composites.append(Image.alpha_composite(base, raw).convert('RGB'))
    return (*composites, raw.getchannel('A').convert('RGB'))


def prepare(folder, mapping):
    for name, image in zip(PREVIEWS, pixels(folder/'source-original.png', mapping['source']['observationSize'])):
        image.save(folder/name)


def verify(folder, mapping):
    from .review_image import alpha_visibility_rgb
    from .evaluate import digest
    source = folder/'source-original.png'
    expected = pixels(source, mapping['source']['observationSize'])
    with Image.open(source) as image:
        if mapping['source']['originalSize'] != list(image.size):
            raise ValueError('BODY_DISPLAY_MAPPING_CHANGED')
        raw = image.convert('RGBA'); raw.thumbnail((1536, 1536), Image.Resampling.LANCZOS)
    if (mapping['source']['originalSha256'] != digest(source)
            or mapping['source']['observationSha256'] != digest(folder/'generated.png')
            or mapping['source']['mapping'] != 'floor-rational-half-open-edges'):
        raise ValueError('BODY_DISPLAY_MAPPING_CHANGED')
    for name, wanted in zip(('generated.png', *PREVIEWS), (alpha_visibility_rgb(raw), *expected)):
        with Image.open(folder/name) as image:
            if (image.format != 'PNG' or image.mode != 'RGB' or image.size != wanted.size
                    or image.tobytes() != wanted.tobytes()):
                raise ValueError('BODY_ACTUAL_ALPHA_DISPLAY_CHANGED')
