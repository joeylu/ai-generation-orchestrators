"""Explicit source-bound glyphlike textures; no OCR, masking or gate exemptions."""
import copy
import hashlib
import json
import math
from pathlib import Path
import re

from jsonschema import Draft202012Validator
from PIL import Image
from .evaluate import pixel_box

INPUT_NAME = 'visual-textures.json'
BINDINGS_NAME = 'visual-texture-bindings.json'
POLICY = 'source-bound-visual-textures-v1'
KIND = 'ui_visual_texture_regions_v1'
BINDINGS_KIND = 'ui_visual_texture_bindings_v1'
STAGES = ('m1', 'm2', 'repair', 'rereview', 'repair2', 'rereview2')
ID_PATTERN = r'[A-Za-z][A-Za-z0-9_-]{0,63}'


def _sha(data):
    return hashlib.sha256(data).hexdigest()


def _read(path):
    def unique(pairs):
        out = {}
        for key, value in pairs:
            if key in out:
                raise ValueError('VISUAL_TEXTURE_DUPLICATE_JSON_KEY')
            out[key] = value
        return out
    def nonfinite(value):
        raise ValueError('VISUAL_TEXTURE_NONFINITE_JSON')
    def finite_float(value):
        number = float(value)
        if not math.isfinite(number):
            nonfinite(value)
        return number
    try:
        return json.loads(Path(path).read_bytes().decode('utf-8-sig'),
                          object_pairs_hook=unique, parse_constant=nonfinite, parse_float=finite_float)
    except (UnicodeError, json.JSONDecodeError) as exc:
        raise ValueError('VISUAL_TEXTURE_INVALID_JSON') from exc


def _text(value, limit):
    return type(value) is str and bool(value.strip()) and len(value) <= limit


def _ints(value, length):
    return type(value) is list and len(value) == length and all(type(v) is int for v in value)


def validate(doc):
    if (type(doc) is not dict or set(doc) != {'kind', 'referenceSha256', 'canvas', 'regions'} or
            doc['kind'] != KIND or type(doc['referenceSha256']) is not str or
            re.fullmatch(r'[0-9a-f]{64}', doc['referenceSha256']) is None or
            not _ints(doc['canvas'], 2) or min(doc['canvas']) <= 0 or
            type(doc['regions']) is not list or not 1 <= len(doc['regions']) <= 32):
        raise ValueError('VISUAL_TEXTURE_INVALID_DOCUMENT')
    width, height = doc['canvas']; area = width * height
    seen, boxes, total = set(), [], 0
    for row in doc['regions']:
        if (type(row) is not dict or set(row) != {'id', 'sourceBox', 'appearance', 'protectedArtwork'} or
                type(row['id']) is not str or re.fullmatch(ID_PATTERN, row['id']) is None or
                not _ints(row['sourceBox'], 4) or not _text(row['appearance'], 1000) or
                not _text(row['protectedArtwork'], 1000)):
            raise ValueError('VISUAL_TEXTURE_INVALID_REGION')
        if row['id'] in seen:
            raise ValueError('VISUAL_TEXTURE_DUPLICATE_ID')
        seen.add(row['id']); left, top, right, bottom = row['sourceBox']
        if not (0 <= left < right <= width and 0 <= top < bottom <= height):
            raise ValueError('VISUAL_TEXTURE_REGION_BOUNDS')
        size = (right-left) * (bottom-top)
        if size * 100 > area or size == area:
            raise ValueError('VISUAL_TEXTURE_REGION_TOO_LARGE')
        if any(left < b[2] and right > b[0] and top < b[3] and bottom > b[1] for b in boxes):
            raise ValueError('VISUAL_TEXTURE_REGIONS_OVERLAP')
        boxes.append(row['sourceBox']); total += size
    if total * 100 > area * 5:
        raise ValueError('VISUAL_TEXTURE_TOTAL_TOO_LARGE')
    return doc


def _reference(doc, reference):
    path = Path(reference)
    if _sha(path.read_bytes()) != doc['referenceSha256']:
        raise ValueError('VISUAL_TEXTURE_REFERENCE_CHANGED')
    with Image.open(path) as image:
        if image.format != 'PNG' or list(image.size) != doc['canvas'] or image.getexif().get(274, 1) != 1:
            raise ValueError('VISUAL_TEXTURE_REFERENCE_COORDINATES')
        image.load()


def load_input(path, reference):
    if path is None:
        return None
    path = Path(path); data = path.read_bytes()
    if not data or len(data) > 262144:
        raise ValueError('VISUAL_TEXTURE_INPUT_SIZE')
    doc = validate(_read(path)); _reference(doc, reference)
    return data


def read_input(inputs, config):
    inputs = Path(inputs); file = inputs/INPUT_NAME
    pin = config.get('inputs', {}).get(INPUT_NAME)
    policy = config.get('visualTexturePolicy')
    if not file.exists() and pin is None and policy is None:
        return None
    if not file.is_file() or type(pin) is not str or policy != POLICY:
        raise ValueError('VISUAL_TEXTURE_INPUT_UNBOUND')
    if _sha(file.read_bytes()) != pin:
        raise ValueError('VISUAL_TEXTURE_INPUT_CHANGED')
    doc = validate(_read(file)); _reference(doc, inputs/'reference.png')
    return doc


def planning_input(run):
    run = Path(run); config_path = run/'.dag/config.json'
    requests = [run/'request.json', *(run/stage/'request.json' for stage in STAGES)]
    if not config_path.is_file():
        if ((run/'.dag/inputs'/INPUT_NAME).exists() or
                any(path.is_file() and 'visualTexturesSha256' in _read(path) for path in requests)):
            raise ValueError('VISUAL_TEXTURE_INPUT_UNBOUND')
        return None
    if _sha(config_path.read_bytes()) != _read(run/'.dag/config-digest.json')['sha256']:
        raise ValueError('CONFIG_CHANGED')
    config = _read(config_path); doc = read_input(run/'.dag/inputs', config)
    expected = config['inputs'].get(INPUT_NAME)
    for path in requests:
        if path.is_file():
            request = _read(path)
            if ((expected is None and 'visualTexturesSha256' in request) or
                    (expected is not None and request.get('visualTexturesSha256') != expected)):
                raise ValueError('VISUAL_TEXTURE_REQUEST_MISMATCH:' + path.parent.name)
    return doc


def review_schema(doc, plan):
    validate(doc)
    materials = [row['id'] for row in plan['materials']]
    objects = [row['id'] for row in plan['objects']]
    if len(materials) != len(set(materials)) or len(objects) != len(set(objects)):
        raise ValueError('VISUAL_TEXTURE_PLAN_DUPLICATE_ID')
    item = {'type': 'object', 'additionalProperties': False,
            'required': ['status', 'materialId', 'objectId', 'sourceEvidence', 'preservationEvidence'],
            'properties': {'status': {'type': 'string', 'enum': ['confirmed', 'uncertain']},
                'materialId': {'type': ['string', 'null'], 'enum': [*materials, None]},
                'objectId': {'type': ['string', 'null'], 'enum': [*objects, None]},
                'sourceEvidence': {'type': 'string', 'minLength': 1},
                'preservationEvidence': {'type': 'string', 'minLength': 1}}}
    return {'type': 'object', 'additionalProperties': False,
            'required': [row['id'] for row in doc['regions']],
            'properties': {row['id']: copy.deepcopy(item) for row in doc['regions']}}


def bind_review_schema(schema, doc, plan):
    result = copy.deepcopy(schema)
    if doc is None:
        if 'visualTextureAudit' in result.get('properties', {}) or 'visualTextureAudit' in result.get('required', []):
            raise ValueError('VISUAL_TEXTURE_UNEXPECTED_SCHEMA')
        return result
    if 'visualTextureAudit' in result.get('properties', {}):
        raise ValueError('VISUAL_TEXTURE_SCHEMA_ALREADY_BOUND')
    result.setdefault('properties', {})['visualTextureAudit'] = review_schema(doc, plan)
    result.setdefault('required', []).append('visualTextureAudit')
    return result


def assess(doc, plan, review):
    if doc is None:
        if 'visualTextureAudit' in review:
            raise ValueError('VISUAL_TEXTURE_UNEXPECTED_AUDIT')
        return [], None
    validate(doc)
    audit = review.get('visualTextureAudit')
    if type(audit) is not dict:
        raise ValueError('VISUAL_TEXTURE_AUDIT_REQUIRED')
    known_regions = {row['id'] for row in doc['regions']}
    if set(audit) != known_regions:
        raise ValueError('VISUAL_TEXTURE_AUDIT_IDS_REQUIRED')
    # Validate structure independently of foreign owner values, which are blockers.
    schema = review_schema(doc, plan)
    loose = copy.deepcopy(schema)
    for row in loose['properties'].values():
        for name in ('materialId', 'objectId'):
            row['properties'][name] = {'type': ['string', 'null'], 'minLength': 1}
    Draft202012Validator(loose).validate(audit)
    materials = {r['id']: r for r in plan['materials']}
    objects = {r['id']: r for r in plan['objects']}
    blockers, regions = [], []
    for region in doc['regions']:
        row = audit[region['id']]; mid, oid = row['materialId'], row['objectId']
        reason = None
        if not row['sourceEvidence'].strip() or not row['preservationEvidence'].strip():
            raise ValueError('VISUAL_TEXTURE_EVIDENCE_EMPTY')
        if row['status'] != 'confirmed':
            reason = 'uncertain source or preservation evidence'
        elif mid is None or mid not in materials or oid is None or oid not in objects:
            reason = 'missing or foreign owner'
        elif objects[oid]['materialId'] != mid:
            reason = 'object does not belong to material'
        else:
            source = region['sourceBox']
            for owner in (materials[mid], objects[oid]):
                if owner.get('bboxNorm') is None:
                    reason = 'owner has no observable bounds'
                    break
                box = pixel_box(owner['bboxNorm'], *doc['canvas'])
                if not (box[0] <= source[0] < source[2] <= box[2] and box[1] <= source[1] < source[3] <= box[3]):
                    reason = 'source region is not fully contained by material and object'
                    break
        if reason:
            blockers.append(dict(code='VISUAL_TEXTURE_REVIEW_UNRESOLVED', category='semantic',
                ids=[mid] if mid in materials else [], description=region['id'] + ': ' + reason,
                suggestedChange='Resolve source-bound appearance and unique ownership against the original reference.'))
        else:
            regions.append(dict(copy.deepcopy(region), materialId=mid, objectId=oid,
                sourceEvidence=row['sourceEvidence'], preservationEvidence=row['preservationEvidence']))
    bindings = dict(kind=BINDINGS_KIND, referenceSha256=doc['referenceSha256'],
                    canvas=copy.deepcopy(doc['canvas']), regions=regions)
    return blockers, bindings


def validate_bindings(doc, plan, bindings):
    if doc is None:
        if bindings is not None:
            raise ValueError('VISUAL_TEXTURE_UNEXPECTED_BINDINGS')
        return None
    if (type(bindings) is not dict or set(bindings) != {'kind', 'referenceSha256', 'canvas', 'regions'} or
            bindings['kind'] != BINDINGS_KIND or bindings['referenceSha256'] != doc['referenceSha256'] or
            bindings['canvas'] != doc['canvas'] or type(bindings['regions']) is not list):
        raise ValueError('VISUAL_TEXTURE_BINDINGS_CHANGED')
    audit = {}
    for row in bindings['regions']:
        if (type(row) is not dict or set(row) != {'id', 'sourceBox', 'appearance', 'protectedArtwork',
                'materialId', 'objectId', 'sourceEvidence', 'preservationEvidence'} or row['id'] in audit):
            raise ValueError('VISUAL_TEXTURE_BINDINGS_FORMAT')
        audit[row['id']] = {name: row[name] for name in
                           ('materialId', 'objectId', 'sourceEvidence', 'preservationEvidence')}
        audit[row['id']]['status'] = 'confirmed'
    blockers, expected = assess(doc, plan, {'visualTextureAudit': audit})
    if blockers or expected != bindings:
        raise ValueError('VISUAL_TEXTURE_BINDINGS_CHANGED')
    return bindings


def guidance(doc):
    if doc is None:
        return ''
    validate(doc)
    return ('\n显式视觉纹理合同：仅下列指认区域的可见笔画形状按原图保留，不做OCR、不猜词或猜品牌。'
            '已知可读装饰字仍须preserveText许可，普通业务字仍按精确片段删除；未指认文字不能借此保留。'
            '每区核对唯一归属、笔画数量与布局、墨色及周围标签底、条纹、锈迹和实体轮廓；区域不是mask。'
            '真实结构、归属、边界或保护图形不确定仍阻断，不删除unknowns、不把uncertain转confirmed。'
            '\nM1将所指纹理写入真实所属素材与对象描述，并给对象可核对的完整边界；不增加schema外字段。'
            'M2及复审在visualTextureAudit按精确区域ID逐项返回原图与保留证据。指认输入如下：' +
            json.dumps(doc, ensure_ascii=False, separators=(',', ':')) + '\n')


def generation_guidance(doc, bindings, material_ids, visual, context=None, group=None):
    if doc is None:
        validate_bindings(doc, visual, bindings)
        return ''
    validate_bindings(doc, visual, bindings)
    rows = context.get('references', []) if isinstance(context, dict) and 'references' in context else context
    if rows is None:
        mapping = {}
    elif isinstance(rows, list):
        mapping = {row['materialId']: row for row in rows}
    elif isinstance(rows, dict):
        mapping = rows
    else:
        raise ValueError('VISUAL_TEXTURE_CONTEXT_FORMAT')
    order = group.get('materialIds', material_ids) if group is not None else material_ids
    width, height = doc['canvas']; own = []
    for region in bindings['regions']:
        mid = region['materialId']
        if mid not in material_ids:
            continue
        box = region['sourceBox']
        item = dict(region, cellIndex=list(order).index(mid),
                    sourceBoxNorm=[v/s for v, s in zip(box, [width, height, width, height])])
        if mid in mapping:
            row = mapping[mid]; crop = row['cropRegion']; size = row['referenceSize']
            if not _ints(crop, 4) or not _ints(size, 2) or size != [crop[2]-crop[0], crop[3]-crop[1]]:
                raise ValueError('VISUAL_TEXTURE_CONTEXT_GEOMETRY')
            local = [box[0]-crop[0], box[1]-crop[1], box[2]-crop[0], box[3]-crop[1]]
            if not (0 <= local[0] < local[2] <= size[0] and 0 <= local[1] < local[3] <= size[1]):
                raise ValueError('VISUAL_TEXTURE_CONTEXT_BOUNDS')
            item.update(contextBox=local, contextBoxNorm=[v/s for v, s in zip(local, [*size, *size])])
            if 'referenceIndex' in row:
                item['referenceIndex'] = row['referenceIndex']
        own.append(item)
    return ('\nSource-bound visual textures (not OCR): preserve only these owned glyphlike texture shapes, '
            'their count, layout and ink appearance; invent no words, brands or replacement symbols. '
            'Regions are locators, never erase masks. Preserve surrounding substrate, stripes, rust and contour. '
            'Remove unlisted ordinary business lettering under the normal text policy; keep exact preserveText '
            'licenses. Never draw foreign regions into this material/cell.\n' +
            json.dumps(own, ensure_ascii=False, separators=(',', ':')) + '\n')


def snapshot_input(folder, manifest):
    folder = Path(folder); file = folder/INPUT_NAME
    pin = manifest.get('files', {}).get(INPUT_NAME)
    metadata = manifest.get('visualTexturesSha256')
    policy = manifest.get('visualTexturePolicy')
    if not file.exists() and pin is None and metadata is None and policy is None:
        return None
    if not file.is_file() or type(pin) is not str or metadata != pin or policy != POLICY:
        raise ValueError('VISUAL_TEXTURE_SNAPSHOT_UNBOUND')
    if _sha(file.read_bytes()) != pin:
        raise ValueError('VISUAL_TEXTURE_SNAPSHOT_CHANGED')
    doc = validate(_read(file)); _reference(doc, folder/'reference.png')
    return doc


def snapshot_bindings(folder, manifest, visual):
    folder = Path(folder); doc = snapshot_input(folder, manifest)
    file = folder/BINDINGS_NAME; pin = manifest.get('files', {}).get(BINDINGS_NAME)
    metadata = manifest.get('visualTextureBindingsSha256')
    if doc is None:
        if file.exists() or pin is not None or metadata is not None:
            raise ValueError('VISUAL_TEXTURE_UNEXPECTED_BINDINGS')
        return None
    if not file.is_file() or type(pin) is not str or metadata != pin:
        raise ValueError('VISUAL_TEXTURE_BINDINGS_UNBOUND')
    if _sha(file.read_bytes()) != pin:
        raise ValueError('VISUAL_TEXTURE_BINDINGS_CHANGED')
    return validate_bindings(doc, visual, _read(file))
