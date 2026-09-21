"""Experimental, digest-bound record edits. Never changes the source plan."""
import copy
from jsonschema import Draft202012Validator
from .evaluate import read, digest, check_relations


def patch_schema(plan_schema, source_sha):
    props = {'sourcePlanSha256': {'type': 'string', 'const': source_sha}}
    for field in ('materials', 'objects'):
        if field not in plan_schema['properties']:continue
        props[field] = {'type': 'object', 'additionalProperties': False,
                        'required': ['upsert', 'remove'], 'properties': {
                            'upsert': {'type': 'array', 'maxItems': 256,
                                       'items': copy.deepcopy(plan_schema['properties'][field]['items'])},
                            'remove': {'type': 'array', 'maxItems': 256, 'items': {'type': 'string'}}}}
    props['unknowns'] = {'anyOf': [copy.deepcopy(plan_schema['properties']['unknowns']), {'type': 'null'}]}
    props['unresolvedIssues'] = {'type': 'array', 'items': {'type': 'string'}}
    required = list(props)
    for field in ('backgroundMode','textPolicy'):
        if field in plan_schema['properties']:
            props[field] = {'anyOf':[copy.deepcopy(plan_schema['properties'][field]),{'type':'null'}]}
    return {'type': 'object', 'additionalProperties': False,
            'required': required, 'properties': props}


def merge_patch(source, patch, schema, expected_sha):
    if digest(source) != expected_sha:
        raise ValueError('SOURCE_CHANGED')
    Draft202012Validator(patch_schema(schema, expected_sha)).validate(patch)
    plan = read(source)
    changed = {}
    for field in ('materials', 'objects'):
        if field not in patch:continue
        changes = patch[field]
        plan.setdefault(field,[])
        upserts = changes['upsert']; removes = changes['remove']
        ids = [row['id'] for row in upserts]
        existing = {row['id']: row for row in plan[field]}
        if len(ids) != len(set(ids)) or len(removes) != len(set(removes)):
            raise ValueError('DUPLICATE_PATCH_ID')
        if set(ids) & set(removes) or set(removes) - existing.keys():
            raise ValueError('INVALID_PATCH_DELETE')
        replacements = {row['id']: row for row in upserts}
        plan[field] = [replacements.get(row['id'], row) for row in plan[field] if row['id'] not in removes]
        plan[field].extend(row for row in upserts if row['id'] not in existing)
        changed[field] = {'upsert': ids, 'remove': removes}
    if patch['unknowns'] is not None:
        plan['unknowns'] = patch['unknowns']
    for field in ('backgroundMode','textPolicy'):
        if patch.get(field) is not None:plan[field]=patch[field]
    Draft202012Validator(schema).validate(plan)
    return plan, {'changed': changed, 'programIssues': check_relations(plan),
                  'unresolvedIssues': patch['unresolvedIssues'],
                  'visualReviewStatus': 'pending', 'productionReady': False}
