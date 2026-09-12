"""Offline, byte-preserving reference evidence for component handoff v2."""
from __future__ import annotations

import hashlib
import io
import json
import math
import shutil
from pathlib import Path
import zipfile

from PIL import Image
from .common import require, read_json, safe_relative, sha256, write_json

FIELDS = {'Tabs': ['activeId'], 'CheckBox': ['checked'], 'Switch': ['checked'],
          'RadioGroup': ['selectedId'], 'Select': ['selectedId', 'popupOpen'],
          'List': ['selectedId'], 'ScrollView': ['scrollX', 'scrollY'],
          'Input': ['value'], 'Slider': ['value'], 'ProgressBar': ['value'], 'Dialog': ['open']}


def preserve_original(reference: Path, normalized: Path):
    """Keep original bytes beside an existing oriented PNG, with explicit EXIF transform."""
    original = normalized.parent / ('original' + reference.suffix)
    provenance = normalized.parent / 'reference-provenance.json'
    require(not original.exists() and not provenance.exists(), 'REFERENCE_SNAPSHOT_EXISTS')
    with reference.open('rb') as reader, original.open('xb') as writer:
        shutil.copyfileobj(reader, writer)
    require(sha256(reference) == sha256(original), 'REFERENCE_ORIGINAL_CHANGED')
    with Image.open(original) as raw:
        raw_size = list(raw.size); orientation = raw.getexif().get(274, 1)
    with Image.open(normalized) as image:
        canvas = list(image.size)
    rotation, flip_x, flip_y = {1: (0, False, False), 2: (0, True, False), 3: (180, False, False),
                              4: (0, False, True), 5: (90, False, True), 6: (90, False, False),
                              7: (90, True, False), 8: (270, False, False)}.get(orientation, (0, False, False))
    write_json(provenance, {'kind': 'ui-reference-preparation-v1',
        'original': {'path': original.name, 'sha256': sha256(original), 'size': raw_size},
        'normalized': {'path': normalized.name, 'sha256': sha256(normalized), 'size': canvas},
        'mapping': {'coordinateSpace': 'raw-image-pixel-edges-to-runtime-canvas', 'sourceSize': raw_size,
                    'targetSize': canvas, 'crop': [0, 0, *raw_size], 'rotationDegrees': rotation,
                    'flipX': flip_x, 'flipY': flip_y, 'scale': [1, 1], 'offset': [0, 0]}})


def exact(value, keys, code):
    require(isinstance(value, dict) and set(value) == set(keys), code)


def number(value):
    return type(value) in (int, float) and math.isfinite(value)


def nodes(document):
    result = {}
    def visit(node):
        require(isinstance(node, dict) and node.get('id') not in result, 'REFERENCE_COMPONENT_INVALID')
        result[node['id']] = node
        for child in node.get('children', []):
            visit(child)
    visit(document['root'])
    return result


def validate_mapping(mapping, image_size, canvas):
    exact(mapping, ['coordinateSpace', 'sourceSize', 'targetSize', 'crop', 'rotationDegrees',
                    'flipX', 'flipY', 'scale', 'offset'], 'REFERENCE_MAPPING_INCOMPLETE')
    require(mapping['coordinateSpace'] == 'raw-image-pixel-edges-to-runtime-canvas', 'REFERENCE_MAPPING_SPACE')
    require(mapping['sourceSize'] == list(image_size) and mapping['targetSize'] == [canvas['width'], canvas['height']], 'REFERENCE_SIZE_MISMATCH')
    for key, count in [('crop', 4), ('scale', 2), ('offset', 2)]:
        require(isinstance(mapping[key], list) and len(mapping[key]) == count and all(number(x) for x in mapping[key]), 'REFERENCE_MAPPING_INVALID')
    x, y, w, h = mapping['crop']
    require(x >= 0 and y >= 0 and w > 0 and h > 0 and x+w <= image_size[0] and y+h <= image_size[1], 'REFERENCE_CROP_INVALID')
    require(type(mapping['rotationDegrees']) is int and mapping['rotationDegrees'] in (0, 90, 180, 270)
            and type(mapping['flipX']) is bool and type(mapping['flipY']) is bool, 'REFERENCE_ROTATION_INVALID')
    if mapping['rotationDegrees'] in (90, 270):
        w, h = h, w
    sx, sy = mapping['scale']; ox, oy = mapping['offset']
    require(sx > 0 and sy > 0 and ox >= 0 and oy >= 0 and ox+w*sx <= canvas['width']+1e-6 and oy+h*sy <= canvas['height']+1e-6, 'REFERENCE_MAPPING_BOUNDS')


def validate_states(state, scope, document):
    exact(state, ['kind', 'schemaVersion', 'components'], 'REFERENCE_STATE_SCHEMA')
    require(state['kind'] == 'ui-reference-state' and state['schemaVersion'] == '1.0' and isinstance(state['components'], list), 'REFERENCE_STATE_SCHEMA')
    by_id = nodes(document); seen = set(); unknown = []
    for row in state['components']:
        exact(row, ['componentId', 'componentType', 'fields'], 'REFERENCE_STATE_SCHEMA')
        cid = row['componentId']; node = by_id.get(cid)
        require(node is not None and cid not in seen and row['componentType'] == node['type'] and node['type'] in FIELDS, 'REFERENCE_STATE_COMPONENT')
        seen.add(cid); props = node['props']; kind = node['type']
        exact(row['fields'], FIELDS[kind], 'REFERENCE_STATE_FIELDS')
        for field, evidence in row['fields'].items():
            require(isinstance(evidence, dict), 'REFERENCE_STATE_EVIDENCE')
            if evidence.get('status') == 'unknown':
                exact(evidence, ['status', 'reason'], 'REFERENCE_STATE_UNKNOWN')
                require(isinstance(evidence['reason'], str) and evidence['reason'].strip(), 'REFERENCE_STATE_UNKNOWN')
                unknown.append(f'{cid}.{field}'); continue
            exact(evidence, ['status', 'value', 'evidence'], 'REFERENCE_STATE_EVIDENCE')
            require(evidence['status'] == 'observed' and isinstance(evidence['evidence'], str) and evidence['evidence'].strip(), 'REFERENCE_STATE_EVIDENCE')
            value = evidence['value']
            if field in ('checked', 'popupOpen', 'open'):
                require(type(value) is bool, 'REFERENCE_STATE_VALUE')
            elif field in ('activeId', 'selectedId'):
                options = props['tabs' if kind == 'Tabs' else 'items' if kind == 'List' else 'options']
                require((value is None and kind != 'Tabs') or (isinstance(value, str) and value in [x['id'] for x in options]), 'REFERENCE_STATE_OPTION')
            elif kind == 'Input':
                require(isinstance(value, str) and len(value.encode('utf-16-le'))//2 <= props['maxLength'], 'REFERENCE_STATE_VALUE')
            else:
                low = props['min'] if kind == 'Slider' else 0
                high = props['max'] if kind in ('Slider', 'ProgressBar') else max(0, props['contentWidth' if field == 'scrollX' else 'contentHeight']-node['layout']['width' if field == 'scrollX' else 'height'])
                require(number(value) and low <= value <= high, 'REFERENCE_STATE_VALUE')
                if kind == 'Slider':
                    steps = (value-low)/props['step']
                    require(abs(steps-round(steps)) < 1e-6, 'REFERENCE_STATE_VALUE')
    require(seen == {cid for cid, node in by_id.items() if node['type'] in FIELDS}, 'REFERENCE_STATE_COVERAGE')
    exact(scope, ['kind', 'schemaVersion', 'referenceState', 'components', 'derivedTestStates', 'human_visual_acceptance'], 'ACCEPTANCE_SCOPE_SCHEMA')
    require(scope['kind'] == 'ui-acceptance-scope' and scope['schemaVersion'] == '1.0' and scope['referenceState'] == 'reference/reference-state.json' and scope['human_visual_acceptance'] is False, 'ACCEPTANCE_SCOPE_SCHEMA')
    require(isinstance(scope['components'], list) and isinstance(scope['derivedTestStates'], list), 'ACCEPTANCE_SCOPE_SCHEMA')
    covered = set()
    for row in scope['components']:
        exact(row, ['componentId', 'mode', 'reason'], 'ACCEPTANCE_SCOPE_COMPONENT')
        require(row['componentId'] in by_id and row['componentId'] not in covered and row['mode'] in ('compare', 'exclude') and isinstance(row['reason'], str) and row['reason'].strip(), 'ACCEPTANCE_SCOPE_COMPONENT')
        covered.add(row['componentId'])
    require(covered == set(by_id), 'ACCEPTANCE_SCOPE_COVERAGE')
    # Derived tests are explicitly descriptions, never replayable observed values.
    for row in scope['derivedTestStates']:
        exact(row, ['componentId', 'basis', 'description'], 'ACCEPTANCE_DERIVED_STATE')
        require(row['componentId'] in by_id and row['basis'] == 'contract-derived' and isinstance(row['description'], str) and row['description'].strip(), 'ACCEPTANCE_DERIVED_STATE')
    return unknown


def reference_members(original: Path, state_path: Path, scope_path: Path, mapping_path: Path, bundle: dict, derived_path: Path | None = None):
    require(original.is_file() and not original.is_symlink(), 'REFERENCE_ORIGINAL_REQUIRED')
    ext = original.suffix
    require(ext.lower() in ('.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp'), 'REFERENCE_FORMAT_UNSUPPORTED')
    payload = original.read_bytes()
    with Image.open(io.BytesIO(payload)) as image:
        size = image.size
        require(size[0]*size[1] <= 67_108_864, 'REFERENCE_IMAGE_LIMIT')
        image.verify()
    state = read_json(state_path); scope = read_json(scope_path); mapping = read_json(mapping_path)
    validate_mapping(mapping, size, bundle['document']['canvas'])
    unknown = validate_states(state, scope, bundle['document'])
    members = {f'reference/original{ext}': payload, 'reference/reference-state.json': state_path.read_bytes(), 'acceptance-scope.json': scope_path.read_bytes()}
    def entry(path):
        return {'path': path, 'sha256': hashlib.sha256(members[path]).hexdigest()}
    derivatives = []
    if derived_path is not None:
        config = read_json(derived_path)
        exact(config, ['images'], 'REFERENCE_DERIVED_CONFIG')
        require(isinstance(config['images'], list), 'REFERENCE_DERIVED_CONFIG')
        for index, row in enumerate(config['images']):
            exact(row, ['file', 'mapping'], 'REFERENCE_DERIVED_CONFIG')
            path = safe_relative(derived_path.parent, row['file'])
            require(path.is_file() and path.suffix.lower() in ('.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp'), 'REFERENCE_DERIVED_IMAGE')
            data = path.read_bytes()
            with Image.open(io.BytesIO(data)) as image:
                width, height = image.size; image.verify()
            validate_mapping(row['mapping'], size, {'width': width, 'height': height})
            name = f'reference/derived-{index+1}{path.suffix}'
            members[name] = data
            derivatives.append({**entry(name), 'width': width, 'height': height, 'source': f'reference/original{ext}', 'mapping': row['mapping']})
    reference = {'original': {**entry(f'reference/original{ext}'), 'width': size[0], 'height': size[1]},
                 'mapping': mapping, 'state': entry('reference/reference-state.json'), 'scope': entry('acceptance-scope.json'), 'derivatives': derivatives}
    return members, reference, unknown


def upgrade_reference_handoff(source: Path, original: Path, state: Path, scope: Path, mapping: Path, output: Path, derived: Path | None = None):
    """Repackage an existing verified v1 archive without modifying any inner bytes."""
    require(not output.exists(), 'REFERENCE_OUTPUT_EXISTS')
    with zipfile.ZipFile(source) as archive:
        require(archive.testzip() is None and len(set(archive.namelist())) == len(archive.namelist()), 'COMPONENT_HANDOFF_READBACK')
        members = {name: archive.read(name) for name in archive.namelist()}
    manifest = json.loads(members['handoff.json'])
    require(manifest.get('kind') == 'ai_ui_component_handoff_v1' and manifest.get('human_visual_acceptance') is False, 'REFERENCE_DRAFT_V1_REQUIRED')
    expected = {'handoff.json'}
    for field in ('decomposition', 'component_bundle', 'appearance_binding'):
        row = manifest[field]; safe_relative(source.parent, row['path']); expected.add(row['path'])
        require(row['path'] in members and hashlib.sha256(members[row['path']]).hexdigest() == row['sha256'], 'COMPONENT_HANDOFF_DIGEST')
    require(set(members) == expected, 'COMPONENT_HANDOFF_INVENTORY')
    bundle = json.loads(members[manifest['component_bundle']['path']])
    extra, reference, unknown = reference_members(original, state, scope, mapping, bundle, derived)
    manifest.update(kind='ai_ui_component_handoff_v2', schemaVersion='2.0', reference=reference)
    members.update(extra); members['handoff.json'] = (json.dumps(manifest, ensure_ascii=False, indent=2)+'\n').encode('utf8')
    output.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(output, 'x', compression=zipfile.ZIP_STORED) as archive:
        for name in sorted(members):
            info = zipfile.ZipInfo(name); info.external_attr = 0o100644 << 16
            archive.writestr(info, members[name])
    with zipfile.ZipFile(output) as archive:
        require(archive.testzip() is None and all(archive.read(name) == payload for name, payload in members.items()), 'COMPONENT_HANDOFF_READBACK')
    return {'kind': 'ui-reference-handoff-export-v2', 'file': output.name, 'sha256': sha256(output), 'reference_sha256': sha256(original),
            'referenceEvidence': 'complete', 'unknownFields': unknown, 'visualComparisonReady': not unknown, 'human_visual_acceptance': False}
