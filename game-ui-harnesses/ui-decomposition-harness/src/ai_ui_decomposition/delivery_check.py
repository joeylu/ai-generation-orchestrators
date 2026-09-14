"""Offline handoff evidence orchestration. Never promotes a draft to ready."""
from pathlib import Path
import math
from .common import ContractError, digest, read_json, require, safe_relative, sha256, write_json
from .component_handoff import _walk_component_nodes, INTERACTIVE_COMPONENT_TYPES
from .region_qa import compare_regions
from .stateful_scroll import scroll_geometry


def select_default_parts(document: dict, binding: dict) -> dict:
    nodes = {n['id']: n for n in _walk_component_nodes(document['root'])}
    selected, standby, issues = [], [], []
    hidden = set()
    def visit(n, concealed=False):
        concealed = concealed or (n['type'] == 'Dialog' and not n['props']['open'])
        if concealed: hidden.add(n['id'])
        for child in n.get('children', []): visit(child, concealed)
    visit(document['root'])
    supported = {'Image', 'Input', 'Button', 'CheckBox', 'RadioGroup', 'Slider', 'Switch', 'Panel', 'Dialog', 'ProgressBar', 'Tabs', 'List', 'Select', 'ScrollView'}
    for row in binding['bindings']:
        node = nodes[row['componentId']]
        kind, props = node['type'], node['props']
        if kind not in supported:
            issues.append({'component':node['id'], 'code':'DEFAULT_STATE_UNSUPPORTED'})
            continue
        parts = row['parts']
        if kind == 'Select':
            # Menu icons are lifecycle-owned by Select, never closed-field overlays.
            items = row.get('states', {}).get('select', {}).get('optionIcons', {}).get('items', [])
            parts = parts + [{'role':'option-icon','layerId':item['icon']['layerId'],'optionId':item['optionId']}
                             for item in items if item['icon'] is not None]
        if kind == 'Tabs':
            require(props.get('activeId') in {t['id'] for t in props['tabs']}, 'TABS_STATE_REQUIRED')
            parts = [dict(part, tabId=t['id']) for part in parts for t in props['tabs']
                     if part.get('tabId', t['id']) == t['id']]
        elif kind == 'List':
            require(props.get('selectedId') is None or props['selectedId'] in {t['id'] for t in props['items']}, 'LIST_STATE_REQUIRED')
            parts = [dict(part, **({'itemId':t['id']} if 'id' in t else {})) for part in parts for t in (props['items'] if part['role'] in {'row','selected-row'} else [{}])]
        if kind == 'ScrollView' and 'appearance' not in props:
            issues.append({'component':node['id'],'code':'DEFAULT_STATE_UNSUPPORTED','reason':'consumed ScrollView appearance required'})
            continue
        for part in parts:
            item = {'component':node['id'], **part}
            active = node['id'] not in hidden
            if kind == 'Tabs':
                chosen = part['tabId'] == props['activeId']
                active = active and ((part['role'] in {'active-tab','active-icon'}) == chosen)
                state = row['states']['tabs']; index = next(i for i,t in enumerate(props['tabs']) if t['id']==part['tabId'])
                native = next((t for t in state.get('items',[]) if t['tabId']==part['tabId']),None)
                item['itemLayout'] = native['layout'] if native else {'coordinateSpace':'target-component-local','x':index*node['layout']['width']/len(props['tabs']),'y':0,'width':node['layout']['width']/len(props['tabs']),'height':state['headerHeight']}
                if part['role'] in {'icon','active-icon'}:
                    icon = next((t for t in state.get('icons',[]) if t['tabId']==part['tabId']),None)
                    require(icon is not None,'TABS_ICON_GEOMETRY_REQUIRED')
                    local=icon['activeIconLayout' if part['role']=='active-icon' else 'iconLayout']
                    item['position']={axis:item['itemLayout'][axis]+local[axis] for axis in ('x','y')}
                    item['size']={axis:local[axis] for axis in ('width','height')}
            elif kind == 'List':
                if part['role'] in {'row','selected-row'}:
                    chosen = part['itemId'] == props.get('selectedId')
                    # Normal row paint remains beneath the selected overlay.
                    active = active and (part['role']=='row' or chosen)
                    index = next(i for i,t in enumerate(props['items']) if t['id']==part['itemId'])
                    item['position'] = {'x':0,'y':index*props['itemHeight']}
                item['clip'] = {'coordinateSpace':'target-component-local','x':0,'y':0,**{k:node['layout'][k] for k in ('width','height')}}
            elif kind == 'Select':
                active = active and part['role'] not in {'popup','option-icon'}
            elif kind == 'ScrollView':
                maximum=max(0,props['contentHeight']-node['layout']['height'])
                offset=props.get('scrollY',0)
                require(type(offset) in (int,float) and math.isfinite(offset) and 0 <= offset <= maximum,'SCROLL_STATE_REQUIRED')
                geometry=scroll_geometry(node,offset/maximum if maximum else 0)
                if part['role']=='scrollbar-thumb':
                    x,y,w,h=geometry['thumb'];item['position']={'x':x,'y':y};item['size']={'width':w,'height':h}
                item['scroll']={'x':0,'y':geometry['scrollY'],'viewport':geometry['viewport'],'sizingRule':geometry['sizingRule']}
            elif kind == 'CheckBox'  and part['role'] == 'mark':
                require(type(props.get('checked')) is bool, 'CHECKBOX_STATE_REQUIRED')
                active = active and props['checked']
            elif kind == 'RadioGroup' and part['role'] == 'indicator':
                require(props.get('selectedId') in {o['id'] for o in props['options']}, 'RADIO_STATE_REQUIRED')
                active = active and part['optionId'] == props['selectedId']
            elif kind == 'ProgressBar':
                value, maximum = props['value'], props['max']
                require(all(type(v) in (int,float) and math.isfinite(v) for v in (value,maximum)) and maximum > 0 and 0 <= value <= maximum, 'PROGRESS_STATE_REQUIRED')
                if part['role'] == 'fill':
                    clip = row['states']['progressBar']['fillClip']
                    item['clip'] = {**clip, 'width':clip['width']*value/maximum}
            elif kind == 'Slider':
                lo, hi, value = props['min'], props['max'], props['value']
                require(all(type(v) in (int,float) and math.isfinite(v) for v in (lo,hi,value))
                        and lo < hi and lo <= value <= hi, 'SLIDER_STATE_REQUIRED')
                ratio = (value-lo)/(hi-lo)
                state = row['states']['slider']
                if part['role'] == 'fill':
                    item['clip'] = {**state['fillClip'], 'width':state['fillClip']['width']*ratio}
                if part['role'] == 'thumb':
                    positions = state['thumbPositions']
                    item['position'] = {axis:positions['min'][axis]+(positions['max'][axis]-positions['min'][axis])*ratio for axis in ('x','y')}
            elif kind == 'Switch':
                require(type(props.get('checked')) is bool, 'SWITCH_STATE_REQUIRED')
                side='on' if props['checked'] else 'off'
                from .switch_state_images import validate_state_images
                images=validate_state_images(row)
                if images: item['layerId']=images[side][part['role']+'LayerId']
                if part['role']=='thumb': item['position']=row['states']['switch']['thumbPositions'][side]
            (selected if active else standby).append(item)
    return {'selected':selected, 'standby':standby, 'issues':issues,
            'coordinates':'target-component-local', 'text_rendering':'component-runtime-only'}


def check_delivery(config_path: Path, output: Path) -> dict:
    """Collect missing evidence and compare images in a single deterministic step."""
    config = read_json(config_path)
    require(config.get('kind') == 'ai_ui_delivery_check_v1', 'DELIVERY_CHECK_KIND')
    require(not output.exists(), 'DELIVERY_CHECK_EXISTS')
    output.mkdir(parents=True)
    base = config_path.resolve().parent
    inputs, fingerprints, issues = {}, {}, []
    for key in ('handoff', 'bundle', 'binding', 'reference', 'rendered', 'browser_evidence', 'region_policy'):
        entry = config.get(key)
        if not isinstance(entry,dict) or set(entry) != {'path','sha256'}:
            issues.append({'code':'INPUT_EVIDENCE_MISSING','input':key})
            continue
        path = safe_relative(base,entry['path'])
        require(path.is_file() and sha256(path) == entry['sha256'], 'DELIVERY_CHECK_INPUT_CHANGED:'+key)
        inputs[key], fingerprints[key] = path, entry['sha256']
    selection = None
    nodes = []
    if 'bundle' in inputs:
        bundle = read_json(inputs['bundle'],max_bytes=67_108_864)
        nodes = list(_walk_component_nodes(bundle['document']['root']))
        if 'binding' in inputs:
            selection = select_default_parts(bundle['document'],read_json(inputs['binding']))
            issues.extend(selection['issues'])
            write_json(output/'default-state.json',selection)
    state_matrix = config.get('states',{})
    fonts = config.get('fonts',{})
    for node in nodes:
        key, kind = node['id'], node['type']
        if kind not in INTERACTIVE_COMPONENT_TYPES:
            continue
        required = ['default','hover','pressed','focused','disabled']
        if kind in {'CheckBox','Switch','RadioGroup','Tabs','Select'}:
            required.append('selected')
        if kind in {'Input','Select'}:
            required.append('error')
        declared = state_matrix.get(key,{})
        for state in required:
            row = declared.get(state,{})
            status = row.get('status') if isinstance(row,dict) else None
            if status not in {'supplied','runtime_feedback','not_applicable'} or not row.get('evidence'):
                issues.append({'code':'STATE_EVIDENCE_MISSING','component':key,'state':state})
        props = node['props']
        if kind in {'Input','Select','RadioGroup','Button','CheckBox','Switch'}:
            font = fonts.get(key,{})
            if not all(font.get(field) is not None for field in
                       ('family','size','weight','line_height','letter_spacing','baseline','license_or_substitution')):
                issues.append({'code':'FONT_METRICS_MISSING','component':key})
    browser = read_json(inputs['browser_evidence']) if 'browser_evidence' in inputs else {}
    for field, source in [('bundle_sha256','bundle'),('screenshot_sha256','rendered'),('handoff_sha256','handoff')]:
        if source in fingerprints and browser.get(field) != fingerprints[source]:
            issues.append({'code':'BROWSER_BINDING_MISSING_OR_CHANGED','field':field})
    state = browser.get('state')
    if not isinstance(state,dict) or not {'focus','hover','pressed','values','caret_phase'} <= set(state):
        issues.append({'code':'BROWSER_STATE_INCOMPLETE'})
    if not browser.get('renderer'):
        issues.append({'code':'RENDERER_EVIDENCE_MISSING'})
    qa = None
    if {'region_policy','reference','rendered'} <= inputs.keys():
        policy = read_json(inputs['region_policy'])
        covered = {r['id'] for r in policy.get('regions',[])}
        for node in nodes:
            if node['type'] in INTERACTIVE_COMPONENT_TYPES and node['id'] not in covered:
                issues.append({'code':'REGION_COVERAGE_MISSING','component':node['id']})
        if state != policy.get('rendered_state'):
            issues.append({'code':'BROWSER_POLICY_STATE_MISMATCH'})
        else:
            try:
                qa = compare_regions(inputs['reference'], inputs['rendered'],inputs['region_policy'],output/'region-qa.json')
            except ContractError as exc:
                issues.append({'code':str(exc)})
                if (output/'region-qa.json').exists():
                    qa = read_json(output/'region-qa.json')
    report = {'kind':'ai_ui_delivery_check_result_v1', 'config_digest':digest(config),
        'inputs':fingerprints, 'issues':issues,'region_qa_digest':qa.get('digest') if qa else None,
        'default_state_digest':digest(selection) if selection else None,
        'status':'failed_visual_qa' if issues else 'machine_checks_passed_human_review_required',
        'human_visual_acceptance':False, 'evidence_trust':'caller_supplied_hash_bound',
        'delivery_policy':'unreviewed_draft'}
    report['digest'] = digest(report)
    write_json(output/'delivery-check.json',report)
    return report
