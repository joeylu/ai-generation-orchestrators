"""Version-bound plan provenance for new visual reviews."""
import copy
import hashlib
import json


CATALOG_KIND='ui_plan_evidence_catalog_v1'
PROTOCOL_V1='catalog-id-v1'
PROTOCOL_V2='coverage-owner-v2'


def _sha(value):
    data=json.dumps(value,ensure_ascii=False,sort_keys=True,separators=(',',':'),
                    allow_nan=False).encode('utf-8')
    return hashlib.sha256(data).hexdigest()


def build_catalog(plan):
    """List exact owner labels from the entire current candidate plan."""
    entries=[]
    for material in plan['materials']:
        entries.append(dict(id='m:'+material['id'],materialId=material['id'],
                            objectId=None,label=material['label']))
    for obj in plan['objects']:
        entries.append(dict(id='o:'+obj['id'],materialId=obj['materialId'],
                            objectId=obj['id'],label=obj['label']))
    entries.sort(key=lambda row:row['id'])
    if len({row['id'] for row in entries})!=len(entries):
        raise ValueError('PLAN_EVIDENCE_DUPLICATE_ID')
    body=dict(kind=CATALOG_KIND,planSha256=_sha(plan),entries=entries)
    return dict(body,digest=_sha(body))


def bind_schema(schema,catalog,protocol=PROTOCOL_V1):
    """Replace copied quotations with a nullable, catalog-bound owner ID."""
    if protocol not in (PROTOCOL_V1,PROTOCOL_V2):
        raise ValueError('PLAN_EVIDENCE_PROTOCOL_UNKNOWN')
    result=copy.deepcopy(schema)
    ids=[row['id'] for row in catalog['entries']]
    if len(ids)!=len(set(ids)):
        raise ValueError('PLAN_EVIDENCE_DUPLICATE_ID')
    if catalog.get('kind')!=CATALOG_KIND:
        raise ValueError('PLAN_EVIDENCE_CATALOG_KIND')
    if catalog.get('digest')!=_sha({key:catalog[key] for key in ('kind','planSha256','entries')}):
        raise ValueError('PLAN_EVIDENCE_CATALOG_CHANGED')

    def visit(node):
        if isinstance(node,list):
            for child in node:visit(child)
        elif isinstance(node,dict):
            properties=node.get('properties')
            if isinstance(properties,dict) and 'planEvidenceQuote' in properties:
                replacement={'type':['string','null'],'enum':[None,*ids]}
                node['properties']={
                    ('planEvidenceId' if name=='planEvidenceQuote' else name):
                    (replacement if name=='planEvidenceQuote' else value)
                    for name,value in properties.items()}
                required=node.get('required',[])
                if 'planEvidenceQuote' not in required:
                    raise ValueError('PLAN_EVIDENCE_SCHEMA_QUOTE_NOT_REQUIRED')
                node['required']=['planEvidenceId' if name=='planEvidenceQuote' else name
                                  for name in required]
            for child in node.values():visit(child)

    visit(result)
    if 'planEvidenceCatalogDigest' in result.get('properties',{}):
        raise ValueError('PLAN_EVIDENCE_SCHEMA_ALREADY_BOUND')
    result['properties']['planEvidenceCatalogDigest']={
        'type':'string','enum':[catalog['digest']]}
    result['required'].append('planEvidenceCatalogDigest')
    if protocol==PROTOCOL_V2:
        if 'planEvidenceProtocol' in result['properties']:
            raise ValueError('PLAN_EVIDENCE_SCHEMA_ALREADY_BOUND')
        result['properties']['planEvidenceProtocol']={
            'type':'string','enum':[PROTOCOL_V2]}
        result['required'].append('planEvidenceProtocol')
    return result


def build_review_schema(catalog,small_focus,policy,protocol=PROTOCOL_V2):
    """The one schema builder for new M2 and rereview transport and verification."""
    if protocol not in (PROTOCOL_V1,PROTOCOL_V2):
        raise ValueError('PLAN_EVIDENCE_PROTOCOL_UNKNOWN')
    from .boundary_evidence import schema as boundary_schema
    from .codex_call import transport_schema
    from .coverage_review import REGIONS, coverage_schema
    from .planning_review_policy import DESCRIPTION_STATUSES

    issue_schema={'type':'object','additionalProperties':False,
        'required':['code','category','ids','description','suggestedChange'],
        'properties':{'code':{'type':'string'},'category':{'type':'string','enum':['semantic','geometry','cosmetic']},
                      'ids':{'type':'array','items':{'type':'string'}},'description':{'type':'string'},
                      'suggestedChange':{'type':'string'}}}
    coverage=coverage_schema()
    if protocol==PROTOCOL_V2:
        entry=coverage['properties']['observedArtwork']['items']
        entry['properties'].pop('planEvidenceQuote')
        entry['required'].remove('planEvidenceQuote')
    required=['issues','coverageAudit']
    properties={'issues':{'type':'array','items':issue_schema},
                'coverageAudit':{'type':'array','minItems':len(REGIONS),
                                 'maxItems':len(REGIONS),'items':coverage}}
    definitions={}
    if small_focus:
        part_schema={'type':'object','additionalProperties':False,
            'required':['visiblePart','observedAppearance','planEvidenceQuote','descriptionStatus','suggestedChange'],
            'properties':{'visiblePart':{'type':'string','minLength':1},
                          'observedAppearance':{'type':'string','minLength':1},
                          'planEvidenceQuote':{'type':'string'},
                          'descriptionStatus':{'type':'string','enum':list(DESCRIPTION_STATUSES)},
                          'suggestedChange':{'type':'string','minLength':1}}}
        if policy is not None:
            if policy['appearanceEvidence']=='bound-reference':
                part_schema['properties']['descriptionStatus']['enum'].append('reference-bound')
            part_schema['properties']['deferredAppearance']={'type':['string','null']}
            part_schema['required'].append('deferredAppearance')
        material_schema={'type':'object','additionalProperties':False,
            'required':['parts','boundary'],
            'properties':{'boundary':boundary_schema(),
                          'parts':{'type':'array','minItems':1,'items':part_schema}}}
        required.append('smallMaterialAudit')
        definitions['smallMaterialAuditEntry']=material_schema
        properties['smallMaterialAudit']={'type':'object','additionalProperties':False,
            'required':[row['materialId'] for row in small_focus['items']],
            'properties':{row['materialId']:{'$ref':'#/$defs/smallMaterialAuditEntry'}
                          for row in small_focus['items']}}
        if small_focus['boundaryOnlyItems']:
            required.append('smallBoundaryAudit')
            definitions['smallBoundaryAuditEntry']={'type':'object','additionalProperties':False,
                'required':['boundary'],
                'properties':{'boundary':material_schema['properties']['boundary']}}
            properties['smallBoundaryAudit']={'type':'object','additionalProperties':False,
                'required':[row['materialId'] for row in small_focus['boundaryOnlyItems']],
                'properties':{row['materialId']:{'$ref':'#/$defs/smallBoundaryAuditEntry'}
                              for row in small_focus['boundaryOnlyItems']}}
    result={'type':'object','additionalProperties':False,'required':required,
            'properties':properties}
    if definitions:result['$defs']=definitions
    result=bind_schema(result,catalog,protocol)
    return transport_schema(result) if policy is not None else result


def expected_small_material_ids(plan,width,height):
    """Mirror the bounded focus selection without creating media or a review."""
    from .evaluate import pixel_box

    selected=[]
    for material in plan['materials']:
        if material['role']!='foreground':continue
        box=pixel_box(material['bboxNorm'],width,height)
        size=(box[2]-box[0],box[3]-box[1]);area=size[0]*size[1]
        if 0<area<=width*height*.025 and min(size)>=8 and max(size)/min(size)<=4:
            selected.append((material['id'],area))
    selected.sort(key=lambda row:row[1])
    return [material_id for material_id,_ in selected]


def _contains_key(value,key):
    if isinstance(value,dict):
        return key in value or any(_contains_key(child,key) for child in value.values())
    if isinstance(value,list):
        return any(_contains_key(child,key) for child in value)
    return False


def _take_id(entry,owners):
    if not isinstance(entry,dict) or 'planEvidenceId' not in entry:
        raise ValueError('PLAN_EVIDENCE_ID_REQUIRED')
    evidence_id=entry.pop('planEvidenceId')
    if evidence_id is not None and (not isinstance(evidence_id,str) or evidence_id not in owners):
        raise ValueError('PLAN_EVIDENCE_ID_UNKNOWN')
    return evidence_id


def resolve_review(review,plan):
    """Resolve current-plan labels in memory; leave stored model output untouched."""
    if not isinstance(review,dict):raise ValueError('PLAN_EVIDENCE_REVIEW_FORMAT')
    marked='planEvidenceCatalogDigest' in review
    if not marked:
        if _contains_key(review,'planEvidenceId') or 'planEvidenceProtocol' in review:
            raise ValueError('PLAN_EVIDENCE_MARKER_REQUIRED')
        return copy.deepcopy(review)
    protocol=review.get('planEvidenceProtocol',PROTOCOL_V1)
    if protocol not in (PROTOCOL_V1,PROTOCOL_V2) or (
            protocol==PROTOCOL_V1 and 'planEvidenceProtocol' in review):
        raise ValueError('PLAN_EVIDENCE_PROTOCOL_UNKNOWN')
    if _contains_key(review,'planEvidenceQuote'):
        raise ValueError('PLAN_EVIDENCE_MIXED_FORMAT')
    if plan is None:raise ValueError('PLAN_EVIDENCE_PLAN_REQUIRED')
    catalog=build_catalog(plan)
    if review['planEvidenceCatalogDigest']!=catalog['digest']:
        raise ValueError('PLAN_EVIDENCE_DIGEST_MISMATCH')
    if protocol==PROTOCOL_V2 and 'coverageAudit' not in review:
        raise ValueError('PLAN_EVIDENCE_COVERAGE_REQUIRED')
    owners={row['id']:row for row in catalog['entries']}
    materials={row['id'] for row in plan['materials']}
    result=copy.deepcopy(review)
    result.pop('planEvidenceCatalogDigest')
    result.pop('planEvidenceProtocol',None)
    for region in result.get('coverageAudit',[]):
        if not isinstance(region,dict) or not isinstance(region.get('observedArtwork'),list):
            raise ValueError('PLAN_EVIDENCE_COVERAGE_FORMAT')
        for entry in region['observedArtwork']:
            if not isinstance(entry,dict):
                raise ValueError('PLAN_EVIDENCE_COVERAGE_FORMAT')
            if protocol==PROTOCOL_V1:
                evidence_id=_take_id(entry,owners)
            elif 'planEvidenceId' in entry:
                raise ValueError('PLAN_EVIDENCE_MIXED_FORMAT')
            if entry.get('disposition')=='covered':
                material_id=entry.get('materialId');object_id=entry.get('objectId')
                expected=('o:'+object_id if isinstance(object_id,str) else
                          'm:'+material_id if isinstance(material_id,str) else None)
                if expected is None or (protocol==PROTOCOL_V1 and evidence_id!=expected):
                    raise ValueError('PLAN_EVIDENCE_OWNER_MISMATCH')
                owner=owners.get(expected)
                if owner is None:
                    raise ValueError('PLAN_EVIDENCE_OWNER_MISMATCH')
                if owner['materialId']!=material_id or owner['objectId']!=object_id:
                    raise ValueError('PLAN_EVIDENCE_OWNER_MISMATCH')
                entry['planEvidenceQuote']=owner['label']
            else:
                if protocol==PROTOCOL_V1 and evidence_id is not None:
                    raise ValueError('PLAN_EVIDENCE_NONCOVERED_ID')
                entry['planEvidenceQuote']=None
    audit=result.get('smallMaterialAudit',{})
    if isinstance(audit,dict):
        rows=((material_id,row) for material_id,row in audit.items())
    elif isinstance(audit,list):
        rows=((row.get('materialId'),row) for row in audit)
    else:
        raise ValueError('PLAN_EVIDENCE_SMALL_AUDIT_FORMAT')
    for material_id,row in rows:
        if not isinstance(row,dict) or not isinstance(row.get('parts'),list):
            raise ValueError('PLAN_EVIDENCE_SMALL_AUDIT_FORMAT')
        if material_id not in materials:
            raise ValueError('PLAN_EVIDENCE_OWNER_MISMATCH')
        for part in row['parts']:
            evidence_id=_take_id(part,owners)
            if evidence_id is not None and owners[evidence_id]['materialId']!=material_id:
                raise ValueError('PLAN_EVIDENCE_OWNER_MISMATCH')
            part['planEvidenceQuote']='' if evidence_id is None else owners[evidence_id]['label']
    if _contains_key(result,'planEvidenceId'):
        raise ValueError('PLAN_EVIDENCE_ID_UNEXPECTED')
    return result
