"""Opt-in strict stateful acceptance. Old archives are inputs, never rewritten."""
from __future__ import annotations
import argparse
import base64
import hashlib
import io
import json
import math
from pathlib import Path
import subprocess
import shutil
import zipfile

import numpy as np
from PIL import Image
from scipy.signal import correlate2d
from scipy.ndimage import binary_dilation

from .common import ContractError, read_json, require, safe_relative, sha256, write_json
from .stateful_scroll import scroll_geometry
from .stateful_slider import slider_geometry, progress_geometry
from .stateful_dialog import dialog_state, DIALOG_STATES, DIALOG_ROLES
from .stateful_static_children import button_image_children, select_image_overlays
from .stateful_list_children import list_children
from .stateful_list_text import list_text_targets

from .switch_state_images import validate_state_images
from .stateful_input import input_states, input_value

KINDS = {'Input', 'Tabs', 'Button', 'CheckBox', 'RadioGroup', 'Select', 'Switch', 'List', 'ScrollView', 'Slider', 'ProgressBar', 'Dialog'}
ROLES = {'Input': {'background'}, 'Dialog': DIALOG_ROLES, 'Tabs': {'tab', 'active-tab', 'icon', 'active-icon'}, 'Button': {'background'},
         'CheckBox': {'box', 'mark'}, 'RadioGroup': {'option', 'indicator'},
         'Select': {'background', 'indicator', 'popup'}, 'Switch': {'track', 'thumb'},
         'List': {'background', 'row', 'selected-row'},
         'ScrollView': {'viewport','scrollbar-track','scrollbar-thumb'},
         'Slider': {'track','fill','thumb'}, 'ProgressBar': {'track','fill'}}


def image_bytes(payload):
    im = Image.open(io.BytesIO(payload))
    require(im.width*im.height<=16_777_216,'STATE_IMAGE_LIMIT')
    im.load()
    require(im.mode == 'RGBA', 'STATE_ALPHA_INVALID')
    return im


def require_part_alpha(extrema, component_type, role, layer):
    # Overlays and rectangular progress fills can reach every canvas edge while
    # retaining real partial Alpha. Icons and other isolated parts still need
    # completely transparent pixels; opaque checkerboards remain invalid.
    partial_edges = (component_type, role) in {('Dialog', 'overlay'), ('ProgressBar', 'fill')}
    require((extrema[0] < 255 if partial_edges else extrema[0] == 0)
            and extrema[1] > 0, 'STATE_ALPHA_INVALID:' + layer)


def baked_icon(background, icon):
    """Known-template test at every integer position; not a semantic vision claim."""
    bg = np.asarray(background).astype(float)
    fg = np.asarray(icon).astype(float)
    mask = (fg[:, :, 3] >= 250).astype(float)
    # Compare the silhouette's immediate halo. The entire rectangular padding
    # can contain an unrelated panel border and manufacture false contrast.
    ring = ((fg[:, :, 3] == 0) & binary_dilation(fg[:, :, 3] > 0,iterations=2)).astype(float)
    if min(mask.sum(), ring.sum()) < 3:
        return False
    if background.width < icon.width or background.height < icon.height:
        return False
    # SSE of opaque template cores, plus contrast against its transparent ring.
    error = sum(correlate2d(bg[:, :, c] ** 2, mask, mode='valid')
                - 2 * correlate2d(bg[:, :, c], fg[:, :, c] * mask, mode='valid')
                + (fg[:, :, c] ** 2 * mask).sum() for c in range(3)) / (3 * mask.sum())
    ring_mean = sum(correlate2d(bg[:, :, c], ring, mode='valid') / ring.sum() for c in range(3)) / 3
    core_mean = sum(correlate2d(bg[:, :, c], mask, mode='valid') / mask.sum() for c in range(3)) / 3
    for y,x in np.argwhere((error < 12 ** 2) & (np.abs(ring_mean - core_mean) > 12)):
        patch=bg[y:y+icon.height,x:x+icon.width]
        core=mask.astype(bool)
        matches=(np.max(np.abs(patch[:,:,:3]-fg[:,:,:3]),axis=2)<=12)&(patch[:,:,3]>=250)
        if float(matches[core].mean())>=.95:
            return True
    return False


def relation_check(a, b, mode, evidence):
    require(a.size == b.size and a.getchannel('A').tobytes() == b.getchannel('A').tobytes(),
            'STATE_GEOMETRY_MISMATCH')
    require(mode in {'distinct', 'shared'} and isinstance(evidence, str) and evidence.strip(),
            'STATE_REFERENCE_EVIDENCE_MISSING')
    equal = a.tobytes() == b.tobytes()
    require(not (mode == 'distinct' and equal), 'STATE_DISTINCT_DUPLICATE')
    require(not (mode == 'shared' and not equal), 'STATE_SHARED_MISMATCH')


def intersect_rect(a,b):
    if a is None:return b
    x=max(a[0],b[0]);y=max(a[1],b[1])
    return [x,y,max(0,min(a[0]+a[2],b[0]+b[2])-x),max(0,min(a[1]+a[3],b[1]+b[3])-y)]


def node_contexts(root, offset=(0, 0), clip=None):
    pos = (offset[0] + root['layout']['x'], offset[1] + root['layout']['y'])
    yield root, pos, clip
    child_pos=pos
    if root['type']=='ScrollView' and 'appearance' in root['props']:
        p=root['props'];r=p['appearance']['viewport']['layout']
        clip=intersect_rect(clip,[pos[0]+r['x'],pos[1]+r['y'],r['width'],r['height']])
        child_pos=(pos[0]+r['x']-p['scrollX'],pos[1]+r['y']-p['scrollY'])
    for child in root.get('children', []):
        yield from node_contexts(child, child_pos,clip)


def nodes(root,offset=(0,0)):
    for node,pos,_clip in node_contexts(root,offset):yield node,pos


def state_names(node):
    p, t = node['props'], node['type']
    if t == 'Input': return input_states(node)
    if t == 'Dialog': return DIALOG_STATES
    if t == 'Slider': return ['min','middle','max']
    if t == 'ProgressBar': return ['initial','empty','middle','full']
    if t == 'Tabs': return [x['id'] for x in p['tabs']]
    if t in {'RadioGroup', 'Select'}: return [x['id'] for x in p['options']]
    if t == 'List': return [x['id'] for x in p['items']]
    if t in {'CheckBox', 'Switch'}: return ['off', 'on']
    if t == 'Button': return ['default', 'hover', 'pressed']
    if t == 'ScrollView': return ['top','middle','bottom']
    raise ContractError('STATE_CAPABILITY_MISSING')


def compile_matrix(bundle, binding, evidence, assets):
    require(evidence.get('kind') == 'ui_state_evidence_v1' and
            set(evidence)-{'visualObservations','layoutRequirements'}=={'kind','handoffSha256','reference','components'}, 'STATE_MATRIX_INVALID')
    policies = evidence.get('components', {})
    require(isinstance(policies,dict),'STATE_MATRIX_INVALID')
    by_binding = {b['componentId']: b for b in binding['bindings']}
    resources = {r['path']: r for r in bundle['resources']}
    contexts = {n['id']:(n,pos,clip) for n,pos,clip in node_contexts(bundle['document']['root'])}
    output = []
    for n, (x, y), inherited_clip in node_contexts(bundle['document']['root']):
        t, p, ident = n['type'], n['props'], n['id']
        if t not in KINDS:
            # Scope is explicit; these controls require a future public adapter.
            require(t not in {'Input', 'Dialog', 'Slider'}, 'STATE_CAPABILITY_MISSING:' + t)
            continue
        require(ident in policies, 'STATE_MISSING:' + ident)
        policy = policies[ident]
        require(isinstance(policy, dict) and set(policy) == {'states', 'relations'}, 'STATE_MATRIX_INVALID')
        names = state_names(n)
        require(not (set(policy['states'])-set(names)), 'STATE_CAPABILITY_MISSING:' + ident)
        require(set(policy['states']) == set(names), 'STATE_MISSING:' + ident)
        require(ident in by_binding and 'appearance' in p, 'STATE_CAPABILITY_MISSING:' + ident)
        b, a = by_binding[ident], p['appearance']
        require(all(q['role'] in ROLES[t] for q in b['parts']), 'STATE_ROLE_UNSUPPORTED')
        w, h = n['layout']['width'], n['layout']['height']
        # Refuse unimplemented coordinate transforms instead of guessing.
        require(a['sourceCanvas'] == {'width': w, 'height': h}, 'STATE_GEOMETRY_MISMATCH')
        if t == 'Tabs':
            from .tabs_layout import validate_tabs_layout
            authored_policy = validate_tabs_layout(b.get('states', {}).get('tabs', {}), names, w, h)
            require(authored_policy == validate_tabs_layout(a, names, w, h), 'STATE_TAB_LAYOUT_MISMATCH')
        switch_images=validate_state_images(b,{key:image_bytes(data).size for key,data in assets.items()}) if t=='Switch' else None
        select_items = None
        if t == 'Select':
            from .select_option_icons import validate_option_icons, contain_rect
            from .select_menu_highlights import require_runtime_menu_highlights
            state = b.get('states', {}).get('select', {})
            require_runtime_menu_highlights(state, a, len(names), binding['registration']['transform']['scale'])
            select_items = validate_option_icons(state, names, assets)
            require(bool(select_items) == ('optionIcons' in a), 'STATE_SELECT_ICONS_MISMATCH')
            if select_items:
                runtime_items = validate_option_icons(a, names, resources,
                    [a['popupCanvas']['width'], a['popupCanvas']['height']], reference='image')
                runtime_by_id = {q['optionId']: q for q in runtime_items}
                registration_scale = binding['registration']['transform']['scale']
                for item in select_items:
                    actual = runtime_by_id[item['optionId']]
                    require((item['icon'] is None) == (actual['icon'] is None), 'STATE_SELECT_ICONS_MISMATCH')
                    for authored, compiled in [(item['labelLayout'], actual['labelLayout'])] + (
                            [(item['icon']['layout'], actual['icon']['layout'])] if item['icon'] else []):
                        require(all(abs(authored[k] / registration_scale - compiled[k]) < 1e-6 for k in authored),
                                'STATE_SELECT_ICONS_MISMATCH')
        if t=='Switch':
            require(bool(switch_images)==('stateImages' in a),'STATE_SWITCH_IMAGES_MISMATCH')
            if switch_images:
                runtime_images=a['stateImages']
                require(isinstance(runtime_images,dict) and set(runtime_images)=={'version','off','on'} and runtime_images['version']=='1.0','STATE_SWITCH_IMAGES_MISMATCH')
                for side in ('off','on'):
                    require(isinstance(runtime_images[side],dict) and set(runtime_images[side])=={'trackImage','thumbImage'},'STATE_SWITCH_IMAGES_MISMATCH')
        records = []
        def part(slot, role, image, rect, visible=True, runtime_sized=False, explicit_layer=None, **selectors):
            matches = [q for q in b['parts'] if q['role'] == role and all(q.get(k) == v for k, v in selectors.items())]
            require(len(matches) == 1 or (role == 'option-icon' and explicit_layer is not None and select_items), 'STATE_MISSING:' + slot)
            layer = explicit_layer if explicit_layer is not None else matches[0]['layerId']
            resource = resources[image]
            require(layer in assets and hashlib.sha256(assets[layer]).hexdigest() == resource['sha256'], 'STATE_RESOURCE_MISMATCH')
            im = image_bytes(assets[layer]); extrema = im.getchannel('A').getextrema()
            require_part_alpha(extrema, t, role, layer)
            if role in {'icon','active-icon'}:
                alpha=im.getchannel('A');box=alpha.getbbox()
                # A transparent outer border alone cannot disguise an opaque plate.
                require(float(np.mean(np.asarray(alpha.crop(box))>0))<.98,'STATE_ALPHA_INVALID:ICON_OPAQUE_PLATE:'+layer)
            require(runtime_sized or [im.width, im.height] == rect[2:], 'STATE_GEOMETRY_MISMATCH:' + slot)
            return dict(slot=slot, role=role, layer=layer, image=image, sha256=resource['sha256'],
                        pixelSha256=hashlib.sha256(im.tobytes()).hexdigest(),
                        alphaSha256=hashlib.sha256(im.getchannel('A').tobytes()).hexdigest(),
                        canvas=[im.width,im.height], coordinateSpace='target-canvas', rect=rect, visible=visible)
        def positioned(slot, role, data, visible=True, **kw):
            r = data['layout']; return part(slot, role, data['image'], [x+r['x'], y+r['y'], r['width'], r['height']], visible, **kw)
        for name in names:
            proof = policy['states'][name]
            require(isinstance(proof, dict) and set(proof) == {'basis', 'region', 'note'} and
                    proof['basis'] in {'observed', 'user-confirmed', 'contract-derived'} and isinstance(proof['note'], str) and proof['note'].strip(),
                    'STATE_REFERENCE_EVIDENCE_MISSING')
            region = proof['region']
            require(isinstance(region, list) and len(region) == 4 and all(type(v) in (int, float) and math.isfinite(v) and v >= 0 for v in region) and min(region[2:]) > 0,
                    'STATE_REFERENCE_EVIDENCE_MISSING')
            parts, excludes, texts = [], [], []
            scroll=None
            slider=None
            dialog=None
            static_children=[]
            structured_children=[]
            value = name
            action = 'click'
            point = [x+w/2, y+h/2]
            def exclude(r, ox=x, oy=y): excludes.append([ox+r['x'], oy+r['y'], r['width'], r['height']])
            if t == 'Dialog':
                data=dialog_state(n,name,bundle['document']['canvas'],positioned,part)
                parts,value,action,dialog=data['parts'],data['value'],data['action'],data['dialog']
                exclude(a['titleLayout'])
                for child in n.get('children',[]): exclude(child['layout'])
            elif t == 'Tabs':
                require(len(a.get('icons', [])) == len(names), 'STATE_MISSING:TAB_ICONS')
                cell = w/len(names)
                for index, tab in enumerate(names):
                    item=next((q for q in a.get('items',[]) if q['tabId']==tab),None)
                    require('items' not in a or item is not None, 'STATE_MISSING:TAB_ITEM')
                    layout=item['layout'] if item else {'x':index*cell,'y':0,'width':cell,'height':a['headerHeight']}
                    tx,ty=x+layout['x'],y+layout['y']
                    hit=item['hitArea'] if item else a['hitArea']
                    if tab==name:point=[tx+hit['x']+hit['width']/2,ty+hit['y']+hit['height']/2]
                    active = tab == name
                    role = 'active-tab' if active else 'tab'
                    template=item if item else a
                    parts.append(part('background/'+tab, role, template['activeTabImage' if active else 'tabImage'],
                                      [tx,ty,layout['width'],layout['height']], **({'tabId':tab} if item else {})))
                    icon = next((q for q in a['icons'] if q['tabId'] == tab), None)
                    require(icon is not None, 'STATE_MISSING:TAB_ICONS')
                    data = icon['activeIcon' if active else 'icon']; r = data['layout']
                    parts.append(part('icon/'+tab, 'active-icon' if active else 'icon', data['image'],
                                      [tx+r['x'], ty+r['y'], r['width'], r['height']], tabId=tab))
                    parts[-1]['localLayout']={'coordinateSpace':'target-item-local',**r}
                    exclude(item['labelLayout'] if item else a['labelLayout'], tx, ty)
                    texts.append(dict(rect=excludes[-1],color=a.get('activeTextColor',p['style']['textColor']) if active else p['style']['textColor'],text=p['tabs'][index]['label']))
            elif t == 'Input':
                parts.append(part('background','background',a['backgroundImage'],[x,y,w,h]))
                value=input_value(n,name);action='input'
                exclude(a['textLayout']);exclude(a['placeholderLayout'])
                # Native focus outline is a runtime overlay, not background pixels.
                # Retain focused screenshots; compare the unobscured surface core.
                excludes.extend([[x,y,w,4],[x,y+h-4,w,4],[x,y,4,h],[x+w-4,y,4,h]])
                display=value if value else p['placeholder']
                layout=a['textLayout' if value else 'placeholderLayout']
                if p['enabled'] and display:
                    texts.append(dict(rect=[x+layout['x'],y+layout['y'],layout['width'],layout['height']],color=p['style']['textColor'] if value else '#75869A',text=display))
            elif t == 'Button':
                parts.append(part('background', 'background', a['backgroundImage'], [x,y,w,h]))
                static_children=button_image_children(n,resources,(x,y),inherited_clip)
                if 'labelLines' in a:
                    from .button_label_lines import validate_label_lines
                    for line in validate_label_lines(a['labelLines'],p['label'],[w,h]):
                        exclude(line['layout']);texts.append(dict(rect=excludes[-1],color=p['style']['textColor'],text=line['text']))
                elif p.get('label','').strip():
                    exclude(a['labelLayout'])
                action = name; value = None
            elif t == 'CheckBox':
                value = name == 'on'
                parts = [positioned('box','box',a['box']), positioned('mark','mark',a['mark'],value)]
                exclude(a['labelLayout'])
            elif t == 'Switch':
                value = name == 'on'; pos = a['thumbPositions'][name]
                pair=a['stateImages'][name] if switch_images else a
                refs=switch_images[name] if switch_images else {}
                thumb=image_bytes(base64.b64decode(resources[pair['thumbImage']]['base64']))
                parts=[part('track','track',pair['trackImage'],[x,y,w,h],explicit_layer=refs.get('trackLayerId')),
                       part('thumb','thumb',pair['thumbImage'],[x+pos['x'],y+pos['y'],thumb.width,thumb.height],explicit_layer=refs.get('thumbLayerId'))]
                label_layout=a.get('stateLabelLayouts',{}).get(name) if p.get('stateLabels') else a.get('labelLayout')
                if label_layout:
                    exclude(label_layout)
                if label_layout and p.get('stateLabels',{}).get(name,p.get('label','')):
                    texts.append(dict(rect=excludes[-1],color=p['style']['textColor'],text=p.get('stateLabels',{}).get(name,p.get('label',''))))
            elif t == 'RadioGroup':
                for q in a['items']:
                    oid = q['optionId']; parts += [positioned('option/'+oid,'option',q['option'],optionId=oid),positioned('indicator/'+oid,'indicator',q['indicator'],oid==name,optionId=oid)]
                    exclude(q['labelLayout'])
                    if oid == name:
                        r=q['hitArea'];point=[x+r['x']+r['width']/2,y+r['y']+r['height']/2]
            elif t == 'Select':
                static_children=select_image_overlays(bundle['document']['root'],n,resources,(x,y),inherited_clip)
                parts = [part('background','background',a['fieldImage'],[x,y,w,h])]
                r=a['arrowLayout'];parts.append(part('indicator','indicator',a['arrowImage'],[x+r['x'],y+r['y'],r['width'],r['height']]))
                parts.append(part('popup','popup',a['popupImage'],[x,y+h+a['popupGap'],a['popupCanvas']['width'],a['popupCanvas']['height']]))
                parts[-1]['contentOcclusion']=True
                exclude(a['labelLayout']);r=a.get('popupContentLayout',{'x':0,'y':0,**a['popupCanvas']});exclude(r,x,y+h+a['popupGap'])
                texts.append(dict(rect=excludes[-2],color=a.get('fieldTextColor',p['style']['textColor']),text=next(o['label'] for o in p['options'] if o['id']==name)))
                for index,option in enumerate(p['options']):
                    origin = [x+r['x'], y+h+a['popupGap']+r['y']+index*r['height']/len(names)]
                    label_rect = [*origin, r['width'], r['height']/len(names)]
                    if select_items:
                        authored = next(q for q in select_items if q['optionId'] == option['id'])
                        entry = runtime_by_id[option['id']]
                        label = entry['labelLayout']
                        label_rect = [origin[0]+label['x'],origin[1]+label['y'],label['width'],label['height']]
                        if entry['icon'] is not None:
                            icon = entry['icon']; layer = authored['icon']['layerId']
                            image = image_bytes(assets[layer])
                            icon_part = part('option-icon/'+option['id'], 'option-icon', icon['image'],
                                contain_rect(icon['layout'], image.size, origin), runtime_sized=True, explicit_layer=layer)
                            icon_part['ignoreContentExclusions'] = True
                            icon_part['clip'] = [x+r['x'],y+h+a['popupGap']+r['y'],r['width'],r['height']]
                            parts.append(icon_part)
                    texts.append(dict(rect=label_rect,color=p['style']['textColor'],text=option['label']))
                action='select';point=[x+r['x']+r['width']/2,y+h+a['popupGap']+r['y']+(names.index(name)+.5)*r['height']/len(names)]
            elif t == 'ScrollView':
                require(b.get('states',{}).get('scrollView',{}).get('scrollbarThumbSlices')==a.get('scrollbarThumbSlices'),'STATE_SCROLLBAR_THUMB_SLICES_MISMATCH')
                scroll=scroll_geometry(n,{'top':0,'middle':.5,'bottom':1}[name])
                scroll['children']=[]
                r=scroll['thumb']
                chrome_visible = not (p.get('scrollbarVisibility') == 'auto' and p['contentHeight'] <= h)
                scroll['chromeVisible'] = chrome_visible
                parts=[positioned('viewport','viewport',a['viewport'],p.get('drawBackground',True)),
                       positioned('track','scrollbar-track',a['scrollbarTrack'],chrome_visible),
                       part('thumb','scrollbar-thumb',a['scrollbarThumbImage'],[x+r[0],y+r[1],r[2],r[3]],chrome_visible,runtime_sized=True)]
                if 'scrollbarThumbSlices' in a:
                    from .scrollbar_thumb_slices import validate_thumb_slices
                    parts[-1]['scrollbarThumbSlices']=validate_thumb_slices(a['scrollbarThumbSlices'],parts[-1]['canvas'][1],'scrollbarInsets' in a)
                value={'x':0,'y':scroll['scrollY']};action='scroll';point=[x+r[0]+r[2]/2,y+r[1]+r[3]/2]
                # Child content covers the viewport, not the foreground scrollbar.
                for child in n.get('children',[]):
                    r=child['layout'];vp=scroll['viewport'];excludes.append(intersect_rect([x+vp['x'],y+vp['y'],vp['width'],vp['height']],
                        [x+vp['x']+r['x'],y+vp['y']+r['y']-scroll['scrollY'],r['width'],r['height']]))
                    scroll['children'].append({'id':child['id'],'x':x+vp['x']+r['x'],'y':y+vp['y']+r['y']-scroll['scrollY']})
                    if child['type']=='List':
                        structured_children.extend(list_children(child,resources,(x+vp['x']+r['x'],y+vp['y']+r['y']-scroll['scrollY']),
                            intersect_rect(inherited_clip,[x+vp['x'],y+vp['y'],vp['width'],vp['height']])))
                parts[0]['contentOcclusion']=bool(scroll['children'])
                for foreground in parts[1:]:
                    foreground['ignoreContentExclusions']=True
            elif t in {'Slider','ProgressBar'}:
                slider=slider_geometry(n,name) if t=='Slider' else progress_geometry(n,name)
                parts=[positioned('track','track',a['track']),positioned('fill','fill',a['fill'],slider['ratio']>0)]
                r=slider['fillClip'];parts[1]['clip']=[x+r[0],y+r[1],r[2],r[3]]
                if t=='Slider':
                    r=slider['thumb'];parts.append(part('thumb','thumb',a['thumbImage'],[x+r[0],y+r[1],r[2],r[3]]))
                    point=[x+r[0]+r[2]/2,y+r[1]+r[3]/2]
                value=slider['value'];action='slider' if t=='Slider' else 'progress'
            elif t == 'List':
                parts=[part('background','background',a['backgroundImage'],[x,y,w,h],p.get('drawBackground',True))]
                for index, item in enumerate(names):
                    rect=[x,y+index*p['itemHeight'],w,p['itemHeight']-p.get('rowGap',0)]
                    # Consumer drawList retains the normal row below the selected
                    # overlay, including where that overlay is transparent.
                    parts.append(part('row/'+item,'row',a['rowImage'],rect))
                    if item==name:
                        parts.append(part('row/'+item,'selected-row',a['selectedRowImage'],rect))
                    exclude(a['labelLayout'],x,y+index*p['itemHeight'])
                point=[x+w/2,y+(names.index(name)+.5)*p['itemHeight']]
                require(point[1] < y+h, 'STATE_NOT_VISIBLE')
                hit=a['hitArea']
                row_clip=intersect_rect(intersect_rect(inherited_clip,[x,y,w,h]),
                    [x+hit['x'],y+names.index(name)*p['itemHeight']+hit['y'],hit['width'],hit['height']])
                require(min(row_clip[2:])>0,'STATE_LIST_ITEM_OUTSIDE_VIEWPORT')
                point=[row_clip[0]+row_clip[2]/2,row_clip[1]+row_clip[3]/2]
                structured_children=list_children(n,resources,(x,y),inherited_clip)
                for child in n.get('children',[]):
                    r=child['layout'];excludes.append([x+r['x'],y+r['y'],r['width'],r['height']])
            records.append(dict(name=name,value=value,action=action,point=point,parts=parts,staticChildren=static_children,listChildren=structured_children,exclude=excludes,textRegions=texts,referenceEvidence=proof,scroll=scroll,slider=slider,dialog=dialog,
                                clip=intersect_rect(inherited_clip,[x,y,w,h]) if t=='List' else inherited_clip if t!='Select' else None))
            if t=='List':records[-1]['boundTexts']=list_text_targets(bundle['document'],n,contexts,value)
        # Every repeated slot needs an explicit relation, even if state visuals are shared.
        slots = {p['slot'] for s in records for p in s['parts']}
        require(set(policy['relations']) == slots, 'STATE_RELATION_MISSING:' + ident)
        for slot in sorted(slots):
            rel=policy['relations'][slot]
            require(isinstance(rel,dict) and set(rel)=={'mode','note'}, 'STATE_REFERENCE_EVIDENCE_MISSING')
            variants=[p for s in records for p in s['parts'] if p['slot']==slot]
            unique={q['sha256']:q for q in variants}
            # Distinct means at least two actual visual resources, not every pair of snapshots.
            require(rel['mode'] in {'shared','distinct'} and isinstance(rel['note'],str) and rel['note'].strip(), 'STATE_REFERENCE_EVIDENCE_MISSING')
            require(rel['mode']!='distinct' or len(unique)>1,'STATE_DISTINCT_DUPLICATE:'+slot)
            require(rel['mode']!='shared' or len({q['pixelSha256'] for q in variants})==1,'STATE_SHARED_MISMATCH:'+slot)
            original=variants[0];im=image_bytes(assets[original['layer']])
            for q in variants[1:]:
                other=image_bytes(assets[q['layer']])
                require(im.size==other.size,'STATE_GEOMETRY_MISMATCH:'+slot)
                if t=='Tabs' and slot.startswith('icon/'):
                    require(original['rect']==q['rect'] and im.getchannel('A').tobytes()==other.getchannel('A').tobytes(),'STATE_GEOMETRY_MISMATCH:'+slot)
            if rel['mode']=='distinct':
                require(len({q['pixelSha256'] for q in variants})>1,'STATE_DISTINCT_DUPLICATE:'+slot)
        if t=='Tabs':
            icons={q['layer'] for s in records for q in s['parts'] if q['slot'].startswith('icon/')}
            backgrounds={q['layer'] for s in records for q in s['parts'] if q['slot'].startswith('background/')}
            for bg in backgrounds:
                for icon in icons:
                    require(not baked_icon(image_bytes(assets[bg]),image_bytes(assets[icon])), 'STATE_BACKGROUND_BAKED_CONFLICT')
        output.append(dict(componentId=ident,componentType=t,states=records,relations=policy['relations'],**({'selectMenuHighlights':a['menuHighlights']} if t=='Select' and 'menuHighlights' in a else {}),**({'stateAppearanceCoverage':'explicit_state_images' if switch_images else 'legacy_single_pair_not_full_state_appearance'} if t=='Switch' else {})))
        if t=='List' and any(s.get('boundTexts') for s in records):
            output[-1]['boundTextProbes']=[{'name':label,'value':v,'boundTexts':list_text_targets(bundle['document'],n,contexts,v)}
                for label,v in [('initial',p['selectedId']),('empty',None),('restore',p['selectedId']),('same-value',p['selectedId'])]]
    require(set(policies)=={r['componentId'] for r in output},'STATE_CAPABILITY_MISSING')
    return {'kind':'ui_state_matrix_v1','components':output,'human_visual_acceptance':False}


def archive_inputs(path):
    # Official CLI performs full semantic validation first. Extraction here is bounded and in-memory.
    with zipfile.ZipFile(path) as z:
        require(sum(i.file_size for i in z.infolist()) <= 256*1024*1024,'STATE_ARCHIVE_LIMIT')
        binding=json.loads(z.read('appearance-binding.json'))
        manifest=json.loads(z.read('handoff.json'))
        require(manifest.get('human_visual_acceptance') is False and manifest.get('delivery_policy')=='unreviewed_draft','STATE_DRAFT_REQUIRED')
        nested=z.read(manifest['decomposition']['path'])
    with zipfile.ZipFile(io.BytesIO(nested)) as z:
        require(len(z.infolist())<=4096 and sum(i.file_size for i in z.infolist())<=256*1024*1024,'STATE_ARCHIVE_LIMIT')
        scene=json.loads(z.read('scene.json'))
        assets={layer['id']:z.read(layer['png']) for group in scene['tree'] for layer in group['children']}
    return binding,assets


def accept(handoff, evidence_path, component_root, output, browser=True, *, components=None, timeout_seconds=600, require_visual_layout=False):
    from .acceptance_execution import AcceptanceExecution
    execution=AcceptanceExecution(timeout_seconds)
    require(components is None or (isinstance(components,list) and components and
            all(isinstance(c,str) and c for c in components) and len(set(components))==len(components)),
            'STATE_COMPONENT_SCOPE_INVALID')
    require(not output.exists(),'OUTPUT_EXISTS');output.mkdir(parents=True)
    report={'kind':'ui_state_acceptance_v1','human_visual_acceptance':False,'status':'failed'}
    report['scope']={'mode':'targeted' if components is not None else 'full','requestedComponentIds':components}
    try:
        execution.start('evidence')
        evidence=read_json(evidence_path)
        require(evidence.get('handoffSha256')==sha256(handoff),'STATE_RESOURCE_MISMATCH')
        reference=evidence['reference'];source=safe_relative(evidence_path.parent,reference['path'])
        require(set(reference)=={'path','sha256'},'STATE_REFERENCE_EVIDENCE_MISSING')
        require(sha256(source)==reference['sha256'],'STATE_REFERENCE_EVIDENCE_MISSING')
        observations = None
        layout_requirements = None
        if require_visual_layout:
            require('visualObservations' in evidence and 'layoutRequirements' in evidence,
                    'REFERENCE_LAYOUT_EVIDENCE_REQUIRED')
        if 'layoutRequirements' in evidence:
            entry=evidence['layoutRequirements']
            require(set(entry)=={'path','sha256'},'LAYOUT_REQUIREMENTS_REFERENCE')
            path=safe_relative(evidence_path.parent,entry['path'])
            require(sha256(path)==entry['sha256'],'LAYOUT_REQUIREMENTS_DIGEST')
            layout_requirements=read_json(path)
            with path.open('rb') as reader,(output/'layout-requirements.json').open('xb') as writer:shutil.copyfileobj(reader,writer)
            evidence={**evidence,'layoutRequirements':{'path':'layout-requirements.json','sha256':entry['sha256']}}
        if 'visualObservations' in evidence:
            entry=evidence['visualObservations']
            require(set(entry)=={'path','sha256'},'VISUAL_OBSERVATIONS_REFERENCE')
            observation_path=safe_relative(evidence_path.parent,entry['path'])
            require(sha256(observation_path)==entry['sha256'],'VISUAL_OBSERVATIONS_DIGEST')
            observations=read_json(observation_path)
            with observation_path.open('rb') as reader,(output/'visual-observations.json').open('xb') as writer:shutil.copyfileobj(reader,writer)
            evidence={**evidence,'visualObservations':{'path':'visual-observations.json','sha256':entry['sha256']}}
        # Fresh CLI output is the authoritative consumed document, never a copied preview bundle.
        execution.start('official-import')
        cli=component_root/'scripts/cli.mjs'
        result=subprocess.run(['node',str(cli),'component-handoff',str(handoff),'--output',str(output/'consumed.json')],capture_output=True,text=True,timeout=execution.remaining())
        require(result.returncode==0,'STATE_COMPONENT_IMPORT_FAILED')
        execution.start('deterministic-matrix')
        require((output/'consumed.json').stat().st_size<=64*1024*1024,'STATE_ARCHIVE_LIMIT')
        bundle=json.loads((output/'consumed.json').read_text(encoding='utf-8'))
        binding,assets=archive_inputs(handoff)
        if layout_requirements is not None:
            from .layout_gate import check_layout_requirements
            checks=check_layout_requirements(bundle,layout_requirements,observations)
            write_json(output/'layout-check.json',checks)
            require(checks['status']=='passed','REFERENCE_LAYOUT_REJECTED')
            report['layoutCheckSha256']=sha256(output/'layout-check.json')
        report['layoutCoverage']='required_checked' if layout_requirements is not None else 'not_verified_legacy_runtime_only'
        matrix=compile_matrix(bundle,binding,evidence,assets)
        matrix['requireVisualLayout']=layout_requirements is not None
        with Image.open(source) as ref:
            require(all(s['referenceEvidence']['region'][0]+s['referenceEvidence']['region'][2]<=ref.width and
                        s['referenceEvidence']['region'][1]+s['referenceEvidence']['region'][3]<=ref.height
                        for c in matrix['components'] for s in c['states']), 'STATE_REFERENCE_EVIDENCE_MISSING')
        available=[c['componentId'] for c in matrix['components']]
        if components is not None:
            require(set(components)<=set(available),'STATE_COMPONENT_SCOPE_UNKNOWN')
            matrix['components']=[c for c in matrix['components'] if c['componentId'] in components]
        scope={**report['scope'],'availableComponentIds':available,
               'testedComponentIds':[c['componentId'] for c in matrix['components']]}
        report['scope']=scope
        matrix['acceptanceScope']=scope
        public_reference={'path':'reference/'+reference['path'],'sha256':reference['sha256']}
        ref_target=safe_relative(output,public_reference['path']);ref_target.parent.mkdir(parents=True,exist_ok=True)
        with source.open('rb') as reader,ref_target.open('xb') as writer:shutil.copyfileobj(reader,writer)
        require(sha256(ref_target)==reference['sha256'],'STATE_REFERENCE_EVIDENCE_MISSING')
        write_json(output/'state-evidence.json',{**evidence,'reference':public_reference})
        matrix.update(handoffSha256=sha256(handoff),bundleSha256=sha256(output/'consumed.json'),reference=public_reference,
                      inputEvidenceSha256=sha256(evidence_path),evidenceSha256=sha256(output/'state-evidence.json'))
        write_json(output/'state-matrix.json',matrix)
        report.update(status='deterministic_passed',handoffSha256=sha256(handoff),matrixSha256=sha256(output/'state-matrix.json'))
        execution.remaining()
        if browser:
            if observations is not None:
                execution.start('default-layout-preflight')
                result=subprocess.run(['node',str(Path(__file__).with_name('stateful_browser.mjs')),str(component_root),str(output),'--default-only'],capture_output=True,text=True,timeout=execution.remaining())
                require(result.returncode==0,'STATE_DEFAULT_PREVIEW_FAILED')
                from .visual_observations import check_visual_observations
                checks=check_visual_observations(bundle,observations,read_json(output/'preflight-default-inspection.json',max_bytes=64*1024*1024))
                write_json(output/'preflight-visual-observation-check.json',checks)
                require(checks['status']=='passed','VISUAL_OBSERVATION_PREFLIGHT_REJECTED')
            execution.start('browser')
            result=subprocess.run(['node',str(Path(__file__).with_name('stateful_browser.mjs')),str(component_root),str(output)],capture_output=True,text=True,timeout=execution.remaining())
            require(result.returncode==0,'STATE_BROWSER_FAILED')
            report.update(status='targeted_passed' if components is not None else 'technical_passed',browserSha256=sha256(output/'browser.json'))
            execution.start('visual-observations')
            if observations is not None:
                from .visual_observations import check_visual_observations
                checks=check_visual_observations(bundle,observations,read_json(output/'default-inspection.json',max_bytes=64*1024*1024))
                write_json(output/'visual-observation-check.json',checks)
                require(checks['status']=='passed','VISUAL_OBSERVATION_REJECTED')
                report['visualObservationSha256']=sha256(output/'visual-observation-check.json')
                report['visualObservationCoverage']='checked'
            else:
                execution.finish('not_run')
                report['visualObservationCoverage']='not_verified_legacy_runtime_only'
            execution.remaining()
            if components is None:
                execution.start('delivery-copy')
                target=output/'ui.component-handoff.draft.zip';pending=output/'.handoff.pending'
                with handoff.open('rb') as reader, pending.open('xb') as writer:
                    shutil.copyfileobj(reader,writer)
                require(sha256(pending)==matrix['handoffSha256'],'STATE_RESOURCE_MISMATCH')
                execution.remaining()
                pending.replace(target)
        return report
    except subprocess.TimeoutExpired as exc:
        report.update(status='failed',error='STATE_ACCEPTANCE_TIMEOUT')
        raise ContractError(report['error']) from exc
    except (ContractError,ValueError,KeyError,TypeError,IndexError,OSError,zipfile.BadZipFile) as exc:
        report['status']='failed'
        report['error']=str(exc) if isinstance(exc,ContractError) else 'STATE_INPUT_INVALID'
        raise ContractError(report['error']) from exc
    finally:
        (output/'.handoff.pending').unlink(missing_ok=True)
        report['execution']=execution.report(failed=report['status']=='failed')
        write_json(output/'acceptance.json',report)


def main(argv=None):
    p=argparse.ArgumentParser(description=__doc__)
    for key in ['handoff','evidence','component-root','output']:p.add_argument('--'+key,required=True,type=Path)
    p.add_argument('--qa-only',action='store_true',help='Never establishes browser acceptance')
    p.add_argument('--component',action='append',help='Targeted diagnostic component ID; repeatable. Never publishes a ZIP.')
    p.add_argument('--timeout-seconds',type=int,default=600,help='Acceptance deadline (default 600s); no automatic retry.')
    p.add_argument('--require-visual-layout',action='store_true',help='Require complete layout requirements and visual observations; reject before browser when unsafe.')
    a=p.parse_args(argv)
    try:
        print(json.dumps(accept(a.handoff.resolve(),a.evidence.resolve(),a.component_root.resolve(),a.output.resolve(),not a.qa_only,components=a.component,timeout_seconds=a.timeout_seconds,require_visual_layout=a.require_visual_layout),indent=2));return 0
    except ContractError as exc:
        print(json.dumps({'status':'failed','code':str(exc),'human_visual_acceptance':False}));return 2


if __name__=='__main__':raise SystemExit(main())
