"""Opt-in byte-copy reuse. Declarations require independent visual confirmation.

This module never changes geometry, creates receipts, or claims equivalence.
Call validate before selecting requests; review_schema/validate_review operate on
the supplied groups (the caller may supply a document scoped to one review).
"""
from copy import deepcopy
import hashlib
import json
from pathlib import Path
import re

from PIL import Image
from jsonschema import Draft202012Validator

KIND = 'ui_material_reuse_v1'


def fingerprint(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':'),
        ensure_ascii=False, allow_nan=False).encode('utf-8')).hexdigest()


def _shape(doc):
    if (not isinstance(doc, dict) or set(doc) != {'kind', 'referenceSha256', 'sourcePlanSha256', 'groups'}
            or doc['kind'] != KIND):
        raise ValueError('REUSE_DOCUMENT_FIELDS')
    for key in ('referenceSha256', 'sourcePlanSha256'):
        if not isinstance(doc[key], str) or not re.fullmatch('[0-9a-f]{64}', doc[key]):
            raise ValueError('REUSE_SOURCE_SHA256')
    if not isinstance(doc['groups'], list) or not doc['groups']:
        raise ValueError('REUSE_GROUPS_REQUIRED')
    prototypes = set(); instances = set()
    for group in doc['groups']:
        if not isinstance(group, dict) or set(group) != {'prototypeMaterialId', 'instanceMaterialIds', 'evidence'}:
            raise ValueError('REUSE_GROUP_FIELDS')
        prototype = group['prototypeMaterialId']; ids = group['instanceMaterialIds']
        if not isinstance(group['evidence'], str) or not group['evidence'].strip():
            raise ValueError('REUSE_EVIDENCE_REQUIRED')
        if not isinstance(ids, list) or not ids:
            raise ValueError('REUSE_INSTANCES_REQUIRED')
        for mid in [prototype, *ids]:
            if not isinstance(mid, str) or not re.fullmatch('[A-Za-z0-9][A-Za-z0-9_.-]*', mid):
                raise ValueError('REUSE_UNSAFE_MATERIAL_ID')
        if prototype in prototypes or len(ids) != len(set(ids)) or instances.intersection(ids):
            raise ValueError('REUSE_DUPLICATE_BINDING')
        prototypes.add(prototype); instances.update(ids)
    if prototypes.intersection(instances):
        raise ValueError('REUSE_CHAIN_OR_CYCLE')


def validate(doc, visual, reference_sha, source_plan_sha):
    if doc is None:
        return None
    _shape(doc)
    if doc['referenceSha256'] != reference_sha or doc['sourcePlanSha256'] != source_plan_sha:
        raise ValueError('REUSE_SOURCE_BINDING')
    materials = {m['id']: m for m in visual['materials']}
    if len(materials) != len(visual['materials']):
        raise ValueError('REUSE_DUPLICATE_MATERIAL')
    for group in doc['groups']:
        expected = None
        for mid in [group['prototypeMaterialId'], *group['instanceMaterialIds']]:
            if mid not in materials:
                raise ValueError('REUSE_UNKNOWN_MATERIAL')
            material = materials[mid]
            objects = [o for o in visual['objects'] if o['materialId'] == mid]
            if (material['role'] != 'foreground' or material.get('adaptationPolicy', 'preserve') != 'preserve'
                    or len(objects) != 1 or objects[0]['kind'] not in ('card', 'badge')
                    or 'bboxNorm' not in objects[0] or objects[0]['bboxNorm'] is not None):
                raise ValueError('REUSE_UNSUPPORTED_MATERIAL')
            signature = (objects[0]['kind'], material.get('preserveText', []))
            if expected is not None and signature != expected:
                raise ValueError('REUSE_CONTENT_CONTRACT_MISMATCH')
            expected = signature
    return doc


def selected_plan(visual, plan, doc):
    """Return a copy with generation assets filtered; retain every other field."""
    if doc is None:
        return deepcopy(plan)
    _shape(doc)
    known = {m['id'] for m in visual['materials']}
    if (len(known) != len(visual['materials']) or len(plan['assets']) != len(known)
            or {a['id'] for a in plan['assets']} != known):
        raise ValueError('REUSE_PLAN_COVERAGE')
    ids = {mid for g in doc['groups'] for mid in [g['prototypeMaterialId'], *g['instanceMaterialIds']]}
    if not ids <= known:
        raise ValueError('REUSE_UNKNOWN_MATERIAL')
    omitted = {mid for g in doc['groups'] for mid in g['instanceMaterialIds']}
    result = deepcopy(plan)
    result['assets'] = [a for a in result['assets'] if a['id'] not in omitted]
    return result


def expanded_ids(doc, mids):
    if doc is None:
        return list(mids)
    _shape(doc)
    bindings = {g['prototypeMaterialId']: g['instanceMaterialIds'] for g in doc['groups']}
    instances = {mid for ids in bindings.values() for mid in ids}
    if len(mids) != len(set(mids)) or instances.intersection(mids):
        raise ValueError('REUSE_GENERATION_IDS')
    return [mid for key in mids for mid in [key, *bindings.get(key, [])]]


def review_schema(base, doc):
    result = deepcopy(base)
    if doc is None:
        return result
    _shape(doc)
    if 'reuseAudit' in result.get('properties', {}) or 'reuseAudit' in result.get('required', []):
        raise ValueError('REUSE_AUDIT_ALREADY_BOUND')
    rows = []
    for group in doc['groups']:
        rows.append(dict(type='object', additionalProperties=False,
            required=['prototypeMaterialId', 'instanceMaterialIds', 'equivalent', 'evidence'],
            properties=dict(prototypeMaterialId={'const': group['prototypeMaterialId']},
                instanceMaterialIds={'const': group['instanceMaterialIds']},
                equivalent={'type': 'boolean'}, evidence={'type': 'string', 'minLength': 1, 'pattern': r'\S'})))
    result.setdefault('required', []).append('reuseAudit')
    result.setdefault('properties', {})['reuseAudit'] = dict(type='array', prefixItems=rows,
        items=False, minItems=len(rows), maxItems=len(rows))
    return result


def validate_review(answer, doc):
    if doc is None:
        return None
    _shape(doc)
    schema = review_schema(dict(type='object', properties={}, required=[]), doc)
    Draft202012Validator(schema).validate(answer)
    if any(row['equivalent'] is not True for row in answer['reuseAudit']):
        raise ValueError('REUSE_EQUIVALENCE_NOT_CONFIRMED')
    return answer['reuseAudit']


def derive(doc, sources, output, provenance):
    """Materialize instances, returning materials/records; no media or receipts.

    provenance maps prototype IDs to caller-owned lineage facts. The caller must
    bind/verify these facts; this helper neither asserts nor repairs their truth.
    """
    if doc is None:
        return dict(materials=dict(sources), records=[])
    _shape(doc)
    output = Path(output).resolve()
    if output.exists():
        raise ValueError('REUSE_FRESH_OUTPUT_REQUIRED')
    mapping_sha = fingerprint(doc); prepared = []
    for group in doc['groups']:
        prototype = group['prototypeMaterialId']
        if prototype not in sources or prototype not in provenance:
            raise ValueError('REUSE_PROTOTYPE_SOURCE_REQUIRED')
        path = Path(sources[prototype])
        data = path.read_bytes(); source_sha = hashlib.sha256(data).hexdigest()
        with Image.open(path) as image:
            image.load()
            if image.format != 'PNG' or image.getexif().get(274, 1) != 1:
                raise ValueError('REUSE_ORIENTED_PNG_REQUIRED')
            if 'A' not in image.getbands() or image.getchannel('A').getextrema()[0] != 0 or image.getchannel('A').getextrema()[1] == 0:
                raise ValueError('REUSE_NATIVE_ALPHA_REQUIRED')
        for mid in group['instanceMaterialIds']:
            if mid in sources:
                raise ValueError('REUSE_INSTANCE_SOURCE_CONFLICT')
        if path.read_bytes() != data:
            raise ValueError('REUSE_SOURCE_CHANGED')
        prepared.append((group, data, source_sha))
    output.mkdir(parents=True, exist_ok=False)
    materials = dict(sources); records = []
    for group, data, source_sha in prepared:
        prototype = group['prototypeMaterialId']
        for mid in group['instanceMaterialIds']:
            target = output / (mid + '.png'); target.write_bytes(data)
            instance_sha = hashlib.sha256(target.read_bytes()).hexdigest()
            if instance_sha != source_sha:
                raise ValueError('REUSE_COPY_CHANGED')
            materials[mid] = str(target)
            records.append(dict(materialId=mid, prototypeMaterialId=prototype,
                prototypeSourceSha256=source_sha, reuseMappingSha256=mapping_sha,
                outputSha256=instance_sha, derivation='identity-byte-copy-v1',
                lineage=deepcopy(provenance[prototype])))
    return dict(materials=materials, records=records)
