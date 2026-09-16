"""Producer layout requirements, checked independently of texture reproduction.

This version supports opaque Select content surfaces. Glass/translucent designs
are explicitly blocked until a compositing/readability adapter exists. No repair
or palette inference is performed here.
"""
import base64
import hashlib
import io
import math

import numpy as np
from PIL import Image

from .common import require
from .visual_policy import walk, contains
from .document_extensions import item_offsets


def world_bounds(document):
    """Untransformed authored world bounds, including ancestor scroll offsets."""
    result = {}
    def visit(node, x=0, y=0):
        rect = node['layout']
        require(all(type(rect[k]) in (int, float) and math.isfinite(rect[k])
                    for k in ('x', 'y', 'width', 'height')), 'LAYOUT_RECT_INVALID')
        x += rect['x']; y += rect['y']
        require(node['id'] not in result, 'LAYOUT_DUPLICATE_ID')
        result[node['id']] = dict(x=x, y=y, width=rect['width'], height=rect['height'])
        props = node.get('props', {})
        dx = props.get('scrollX', 0) if node['type'] == 'ScrollView' else 0
        dy = props.get('scrollY', 0) if node['type'] == 'ScrollView' else 0
        offsets=item_offsets(node)
        for child in node.get('children', []): visit(child, x-dx, y-dy+offsets.get(child['id'],0))
    visit(document['root'])
    return result


def text_owners(document):
    result = set()
    for node in walk(document['root']):
        p = node.get('props', {}); kind = node['type']
        if (kind == 'Text' and p.get('text')) or (kind in ('Button', 'CheckBox', 'Switch') and p.get('label')):
            result.add(node['id'])
        elif kind == 'Input' and (p.get('value') or p.get('placeholder')):
            result.add(node['id'])
        elif kind in ('Select', 'RadioGroup', 'List', 'Tabs') and not (kind=='List' and p.get('itemContents')):
            result.add(node['id'])
        elif kind in ('Panel', 'Dialog') and p.get('title'):
            result.add(node['id'])
    return result


def select_surface(node, resources):
    """Inspect the authenticated, registered popup safe surface in source pixels."""
    p = node['props']; a = p.get('appearance', {})
    safe = a.get('popupContentLayout'); canvas = a.get('popupCanvas')
    require(isinstance(safe, dict) and isinstance(canvas, dict), 'SELECT_CONTENT_LAYOUT_REQUIRED')
    require(contains(dict(x=0,y=0,**canvas), safe), 'SELECT_CONTENT_OUT_OF_CANVAS')
    resource = resources.get(a.get('popupImage'))
    require(resource is not None, 'SELECT_POPUP_RESOURCE_MISSING')
    payload = base64.b64decode(resource['base64'], validate=True)
    require(hashlib.sha256(payload).hexdigest() == resource['sha256'], 'SELECT_POPUP_RESOURCE_CHANGED')
    with Image.open(io.BytesIO(payload)) as image:
        alpha = np.asarray(image.convert('RGBA'))[:, :, 3]
    h, w = alpha.shape
    box = [math.floor(safe['x']*w/canvas['width']), math.floor(safe['y']*h/canvas['height']),
           math.ceil((safe['x']+safe['width'])*w/canvas['width']),
           math.ceil((safe['y']+safe['height'])*h/canvas['height'])]
    region = alpha[box[1]:box[3],box[0]:box[2]]
    require(region.size > 0, 'SELECT_CONTENT_EMPTY')
    # Deliberately a whole-region check: edge-only/bbox checks miss internal holes.
    return dict(sourceRect=box, sourceSize=[w,h], unsafePixels=int((region < 250).sum()),
                checkedPixels=int(region.size), minAlpha=int(region.min()))


def check_layout_requirements(bundle, requirements, observations):
    require(isinstance(requirements, dict) and set(requirements) ==
            {'kind','panels','selects','buttons','textBackgrounds'} and
            requirements['kind'] == 'ui_layout_requirements_v1', 'LAYOUT_REQUIREMENTS_SCHEMA')
    require(isinstance(observations,dict) and observations.get('kind') == 'ui_visual_observations_v1',
            'VISUAL_OBSERVATIONS_REQUIRED')
    nodes = {n['id']:n for n in walk(bundle['document']['root'])}
    resources = {r['path']:r for r in bundle.get('resources',[])}
    checks = []; issues = []
    def check(ok, code, ident, **detail):
        row = dict(componentId=ident,code=code,passed=bool(ok),**detail)
        checks.append(row)
        if not ok: issues.append(row)
    def section(name, kind):
        rows = requirements[name]
        require(isinstance(rows,list) and all(isinstance(r,dict) for r in rows),'LAYOUT_REQUIREMENTS_SECTION')
        ids = [r.get('componentId') for r in rows]
        require(all(isinstance(i,str) for i in ids) and len(ids)==len(set(ids)), 'LAYOUT_REQUIREMENTS_DUPLICATE')
        check(set(ids)=={n['id'] for n in nodes.values() if n['type']==kind},
              'LAYOUT_REQUIREMENTS_COVERAGE',name)
        return [r for r in rows if r['componentId'] in nodes and nodes[r['componentId']]['type']==kind]
    observed_ids={r.get('componentId') for r in observations.get('texts',[])}
    for ident in sorted(text_owners(bundle['document'])):
        check(ident in observed_ids,'VISUAL_TEXT_COVERAGE_MISSING',ident)
    for spec in section('panels','Panel'):
        require(set(spec)=={'componentId','appearance','reason'} and spec['appearance'] in ('required','plain')
                and isinstance(spec['reason'],str) and spec['reason'].strip(),'PANEL_LAYOUT_REQUIREMENT')
        ident=spec['componentId']; present=bool(nodes[ident]['props'].get('appearance'))
        check(present if spec['appearance']=='required' else not present,'PANEL_APPEARANCE_OWNERSHIP',ident)
    for spec in section('selects','Select'):
        require(set(spec)=={'componentId','surface','reason'} and spec['surface'] in ('opaque','translucent')
                and isinstance(spec['reason'],str) and spec['reason'].strip(),'SELECT_SURFACE_REQUIREMENT')
        ident=spec['componentId']; node=nodes[ident]
        check(spec['surface']=='opaque','SELECT_TRANSLUCENT_ADAPTER_UNSUPPORTED',ident)
        detail=select_surface(node,resources)
        if spec['surface']=='opaque': check(detail['unsafePixels']==0,'SELECT_CONTENT_OUTSIDE_SURFACE',ident,**detail)
        a=node['props']['appearance']; count=len(node['props']['options'])
        scale=node['layout']['width']/a['popupCanvas']['width']
        row_height=a['popupContentLayout']['height']*scale/count
        check(row_height>=node['props']['style']['fontSize']*1.25,'SELECT_ROW_TEXT_HEIGHT',ident,
              rowHeight=row_height,fontSize=node['props']['style']['fontSize'])
    for spec in section('buttons','Button'):
        require(set(spec)=={'componentId','textProfile','reason'} and spec['textProfile'] in ('single-style','per-line')
                and isinstance(spec['reason'],str) and spec['reason'].strip(),'BUTTON_TEXT_REQUIREMENT')
        node=nodes[spec['componentId']];lines=node['props'].get('appearance',{}).get('labelLines')
        check(spec['textProfile']=='single-style' or lines is not None,'BUTTON_PER_LINE_LAYOUT_UNSUPPORTED',spec['componentId'])
        if lines is not None:
            from .button_label_lines import validate_label_lines
            validate_label_lines(lines,node['props']['label'],[node['layout']['width'],node['layout']['height']])
            expected={line['text'] for line in lines['lines']};actual={r.get('text') for r in observations.get('texts',[]) if r.get('componentId')==node['id']}
            check(expected<=actual,'BUTTON_LINE_OBSERVATION_COVERAGE',node['id'])
    for spec in section('textBackgrounds','Text'):
        require(set(spec)=={'componentId','drawBackground','reason'} and type(spec['drawBackground']) is bool
                and isinstance(spec['reason'],str) and spec['reason'].strip(),'TEXT_BACKGROUND_REQUIREMENT')
        ident=spec['componentId']
        check(nodes[ident]['props'].get('drawBackground',True)==spec['drawBackground'],
              'TEXT_BACKGROUND_OWNERSHIP',ident)
    return dict(kind='ui_layout_gate_v1',status='failed' if issues else 'passed',issues=issues,checks=checks,
                human_visual_acceptance=False,coverage='declared_requirements_and_complete_owner_inventory')
