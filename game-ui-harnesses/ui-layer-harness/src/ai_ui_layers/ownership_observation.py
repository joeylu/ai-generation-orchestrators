"""Deterministic ownership catalogs and validation of explicit visual declarations.

Coordinates locate source artwork. This module never infers masks, holes, or
pixel ownership and never performs visual verification itself.
"""
import copy
import json

from jsonschema import Draft202012Validator

from .context_references import action_entry, geometry


KIND = 'ui_output_ownership_inventory_v1'


def _unique(rows, key, code):
    values = [key(row) for row in rows]
    if len(values) != len(set(values)):
        raise ValueError(code)
    return set(values)


def inventory(visual, plan, material_ids):
    """Use the generation compiler's exact ownership and context selection."""
    # Legacy full-reference plans allowed omitted text exceptions. This field
    # is unrelated to object ownership; normalize the established empty default
    # on a copy so the catalog does not mutate or require a new source plan.
    visual=copy.deepcopy(visual)
    for material in visual['materials']:
        material.setdefault('preserveText',[])
    material_ids = list(material_ids)
    if not material_ids or len(material_ids) != len(set(material_ids)):
        raise ValueError('OWNERSHIP_MATERIAL_IDS_INVALID')
    _unique(visual['materials'], lambda row: row['id'], 'OWNERSHIP_DUPLICATE_MATERIAL')
    _unique(visual['objects'], lambda row: row['id'], 'OWNERSHIP_DUPLICATE_OBJECT')
    _unique(plan['assets'], lambda row: row['id'], 'OWNERSHIP_DUPLICATE_ASSET')
    materials = {row['id']: row for row in visual['materials']}
    assets = {row['id']: row for row in plan['assets']}
    if any(row['materialId'] not in materials for row in visual['objects']):
        raise ValueError('OWNERSHIP_OBJECT_OWNER_UNKNOWN')
    if any(mid not in materials or mid not in assets for mid in material_ids):
        raise ValueError('OWNERSHIP_MATERIAL_UNKNOWN')
    entries = []
    for index, mid in enumerate(material_ids):
        asset = assets[mid]
        entry = action_entry(visual, materials[mid], asset,
                             geometry(asset, plan['canvas']), plan['canvas'], index)
        owned = [dict(objectId=row['id'], **{key: value for key, value in row.items() if key != 'id'})
                 for row in entry['keepOnly']]
        foreign = []
        for owner in entry['exclude']:
            if not owner['members']:
                raise ValueError('OWNERSHIP_FOREIGN_OBJECTS_REQUIRED')
            for member in owner['members']:
                foreign.append(dict(materialId=owner['materialId'], objectId=member['id'],
                    relation=owner['relation'], appearance=member['appearance'],
                    referenceBox=member.get('referenceBox', owner['referenceBox'])))
        if not owned:
            raise ValueError('OWNERSHIP_OWNED_OBJECTS_REQUIRED')
        entries.append(dict(materialId=mid,
            targetKind='clean-plate' if entry['surface'] == 'continuous-panel' else 'owned-artwork',
            owned=owned, foreign=foreign))
    return dict(kind=KIND, materialIds=material_ids, entries=entries)


def _observation_schema(document):
    def declaration(states, foreign=False):
        properties = dict(objectId=dict(type='string', minLength=1),
                          state=dict(type='string', enum=states),
                          evidence=dict(type='string', minLength=1, pattern=r'\S'))
        if foreign:
            properties['materialId'] = dict(type='string', minLength=1)
        return dict(type='object', additionalProperties=False,
                    required=list(properties), properties=properties)
    return dict(type='array', minItems=len(document['entries']), maxItems=len(document['entries']),
        items=dict(type='object', additionalProperties=False,
            required=['materialId', 'owned', 'foreign'], properties=dict(
                materialId=dict(type='string', enum=document['materialIds']),
                owned=dict(type='array', items=declaration(['complete', 'missing', 'uncertain'])),
                foreign=dict(type='array', items=declaration(['absent', 'present', 'uncertain'], True)))))


def extend_schema(base_schema, inventory_doc):
    """Copy a review schema; old frozen schemas remain unchanged."""
    result = copy.deepcopy(base_schema)
    result.setdefault('properties', {})['ownershipObservations'] = _observation_schema(inventory_doc)
    required = result.setdefault('required', [])
    if 'ownershipObservations' not in required:
        required.append('ownershipObservations')
    return result


def assess(inventory_doc, observations):
    """Validate exact coverage, then classify declarations; no visual truth claim."""
    errors = list(Draft202012Validator(_observation_schema(inventory_doc)).iter_errors(observations))
    if errors:
        raise ValueError('OWNERSHIP_OBSERVATIONS_INVALID')
    actual = _unique(observations, lambda row: row['materialId'], 'OWNERSHIP_DUPLICATE_OBSERVATION')
    if actual != set(inventory_doc['materialIds']):
        raise ValueError('OWNERSHIP_MATERIAL_COVERAGE')
    expected = {entry['materialId']: entry for entry in inventory_doc['entries']}
    blockers = []
    for observation in observations:
        mid = observation['materialId']
        entry = expected[mid]
        owned = _unique(observation['owned'], lambda row: row['objectId'], 'OWNERSHIP_DUPLICATE_OWNED')
        foreign = _unique(observation['foreign'], lambda row: (row['materialId'], row['objectId']),
                          'OWNERSHIP_DUPLICATE_FOREIGN')
        if owned != {row['objectId'] for row in entry['owned']}:
            raise ValueError('OWNERSHIP_OWNED_COVERAGE')
        if foreign != {(row['materialId'], row['objectId']) for row in entry['foreign']}:
            raise ValueError('OWNERSHIP_FOREIGN_COVERAGE')
        for scope, good in (('owned', 'complete'), ('foreign', 'absent')):
            for declaration in observation[scope]:
                if declaration['state'] != good:
                    blockers.append(dict(code='OWNERSHIP_OBSERVATION_BLOCKED', materialId=mid,
                        objectId=declaration['objectId'], scope=scope, state=declaration['state'],
                        evidence=declaration['evidence'],
                        **({'ownerMaterialId': declaration['materialId']} if scope == 'foreign' else {})))
    return dict(blockers=blockers, declarationsOnly=True)


def review_prompt(inventory_doc):
    return ('Return required ownershipObservations for every catalog entry and every owned and foreign object ID. '
            'Report owned as complete/missing/uncertain and foreign as absent/present/uncertain, each with concrete '
            'nonempty visual evidence. An empty findings list cannot replace these observations. '
            'A clean-plate owns only its listed substrate and decorations. Foreign cards, surfaces, frames, '
            'buttons, icons, shadows and significant glow belong to their named owner and must be absent. '
            'Restore only the clean-plate\'s own existing surface beneath removed foreign units. Preserve genuine '
            'owned holes and translucency; never infer a hole or erase mask from reference boxes. Coordinates '
            'are locators, not pixel ownership. Independently named identical-looking instances require separate '
            'observations. Use uncertain whenever identity or ownership cannot be established. These are visual '
            'observations under the frozen text and visual policies: removing ordinary business glyphs does not '
            'make an owned surface missing; explicitly licensed graphic lettering must still survive. '
            'Surface restoration must not introduce a duplicate neighboring object or move its owner. '
            'These declarations are not deterministic proof of pixel correctness. Catalog: '
            + json.dumps(inventory_doc, ensure_ascii=False, separators=(',', ':')))
