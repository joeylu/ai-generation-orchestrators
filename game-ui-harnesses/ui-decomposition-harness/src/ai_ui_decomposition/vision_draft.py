"""Bounded four-type visual draft compiler. Does not infer materials or approve visuals."""
import argparse
import hashlib
import json
import math
from pathlib import Path
import re
import time


def require(ok, code):
    if not ok:
        raise ValueError(code)


def number(v):
    return type(v) in (int, float) and math.isfinite(v)


def compile_draft(d):
    require(isinstance(d, dict) and set(d) == {'version', 'canvas', 'nodes', 'unknowns'}, 'SCHEMA')
    require(d['version'] == 'vision-draft-1', 'VERSION')
    c = d['canvas']
    require(isinstance(c, list) and len(c) == 2 and all(type(v) is int and 0 < v <= 8192 for v in c), 'CANVAS')
    require(isinstance(d['unknowns'], list) and all(isinstance(s, str) for s in d['unknowns']), 'UNKNOWNS')
    require(isinstance(d['nodes'], list) and 0 < len(d['nodes']) <= 128, 'NODES')
    index = {}
    roles = {'Panel': {'panel'}, 'Image': {'icon'}, 'Text': {'label', 'value', 'title', 'subtitle'}, 'Button': {'action'}}
    for n in d['nodes']:
        require(isinstance(n, dict) and set(n) == {'id', 'type', 'parentId', 'rect', 'text', 'fontSize', 'color', 'role'}, 'NODE_SCHEMA')
        key = n['id']
        require(isinstance(key, str) and re.fullmatch(r'[A-Za-z][A-Za-z0-9_-]{0,63}', key), 'ID')
        require(key not in index and key not in {'page', 'background'}, 'DUPLICATE_OR_RESERVED_ID')
        require(n['type'] in roles and n['role'] in roles[n['type']], 'TYPE_ROLE')
        require(n['parentId'] is None or isinstance(n['parentId'], str), 'PARENT_TYPE')
        r = n['rect']
        require(isinstance(r, list) and len(r) == 4 and all(number(v) for v in r), 'RECT')
        x, y, w, h = r
        require(x >= 0 and y >= 0 and w > 0 and h > 0 and x+w <= c[0] and y+h <= c[1], 'CANVAS_BOUNDS')
        require(n['color'] is None or isinstance(n['color'], str) and re.fullmatch(r'#[0-9A-Fa-f]{6}', n['color']), 'COLOR')
        if n['type'] in ('Text', 'Button'):
            require(isinstance(n['text'], str) and n['text'].strip() == n['text'] and bool(n['text']), 'TEXT')
            require(number(n['fontSize']) and 1 <= n['fontSize'] <= 256, 'FONT')
            require(n['fontSize'] * 1.25 <= h, 'LINE_HEIGHT')
        else:
            require(n['text'] is None and n['fontSize'] is None, 'NON_TEXT_FIELDS')
        index[key] = n
    for n in index.values():
        parent = n['parentId']
        visited = {n['id']}
        while parent is not None:
            require(parent in index and index[parent]['type'] == 'Panel', 'PARENT_REFERENCE')
            require(parent not in visited, 'PARENT_CYCLE')
            visited.add(parent)
            parent = index[parent]['parentId']
        if n['parentId']:
            x,y,w,h = n['rect']; px,py,pw,ph = index[n['parentId']]['rect']
            require(px <= x and py <= y and x+w <= px+pw and y+h <= py+ph, 'PARENT_BOUNDS')

    def style(n=None):
        return dict(backgroundColor='#061016', borderColor='#061016', borderWidth=0,
                    cornerRadius=0, textColor=(n or {}).get('color') or '#E6ECEB',
                    fontFamily='Arial', fontSize=(n or {}).get('fontSize') or 30,
                    fontWeight='normal', opacity=1)

    requirements = dict(kind='ui_layout_requirements_v1', panels=[], selects=[], buttons=[], textBackgrounds=[])
    observations = dict(kind='ui_visual_observations_v1', texts=[], dialogs=[])
    mapping = []
    def build(n):
        x,y,w,h = n['rect']
        px,py = index[n['parentId']]['rect'][:2] if n['parentId'] else (0,0)
        props = {'style': style(n)}
        kind = n['type']; key = n['id']
        if kind == 'Text':
            props.update(text=n['text'], drawBackground=False, wrap='none', overflow='error', lineHeight=n['fontSize']*1.25)
            requirements['textBackgrounds'].append(dict(componentId=key, drawBackground=False, reason='Parent owns the visual background'))
        elif kind == 'Button':
            props.update(label=n['text'], enabled=True)
            requirements['buttons'].append(dict(componentId=key, textProfile='single-style', reason='One observed label; feedback is runtime-derived'))
        elif kind == 'Panel':
            props['title'] = ''
            requirements['panels'].append(dict(componentId=key, appearance='required', reason='Observed decorated panel; raster binding still required'))
        else:
            props.update(source=f'layers/{key}.png', fit='contain', drawBackground=False)
        if kind in ('Text', 'Button'):
            observations['texts'].append(dict(componentId=key, text=n['text'], minFontSize=n['fontSize'], region=dict(x=x,y=y,width=w,height=h)))
        else:
            mapping.append(dict(componentId=key, role=n['role'], referenceRect=n['rect'], status='material_not_generated'))
        node = dict(id=key, type=kind, layout=dict(x=x-px,y=y-py,width=w,height=h), props=props)
        if kind in ('Panel', 'Button'):
            node['children'] = [build(child) for child in index.values() if child['parentId'] == key]
        return node
    root = dict(id='page', type='Container', layout=dict(x=0,y=0,width=c[0],height=c[1]), props={'style':style()}, children=[])
    root['children'].append(dict(id='background', type='Image', layout=dict(root['layout']), props=dict(source='layers/background.png',fit='stretch',drawBackground=False,style=style())))
    root['children'].extend(build(n) for n in index.values() if n['parentId'] is None)
    return {'semantic-document.json':dict(schemaVersion='0.2',id='vision-compiled-experiment',canvas=dict(width=c[0],height=c[1]),root=root),
            'layout-requirements.json':requirements, 'visual-observations.json':observations,
            'planning-evidence.json':dict(unknowns=d['unknowns'], materialPlan=mapping,
                geometryBasis='model_visual_estimate', stylesBasis='explicit_experiment_defaults_and_model_estimates',
                human_visual_acceptance=False, materialsGenerated=False, scope='four_type_semantic_compilation_only')}
