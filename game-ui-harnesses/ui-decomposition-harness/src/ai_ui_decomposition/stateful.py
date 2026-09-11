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

KINDS = {'Tabs', 'Button', 'CheckBox', 'RadioGroup', 'Select', 'Switch', 'List', 'ScrollView'}
ROLES = {'Tabs': {'tab', 'active-tab', 'icon', 'active-icon'}, 'Button': {'background'},
         'CheckBox': {'box', 'mark'}, 'RadioGroup': {'option', 'indicator'},
         'Select': {'background', 'indicator', 'popup'}, 'Switch': {'track', 'thumb'},
         'List': {'background', 'row', 'selected-row'},
         'ScrollView': {'viewport','scrollbar-track','scrollbar-thumb'}}


def image_bytes(payload):
    im = Image.open(io.BytesIO(payload))
    require(im.width*im.height<=16_777_216,'STATE_IMAGE_LIMIT')
    im.load()
    require(im.mode == 'RGBA', 'STATE_ALPHA_INVALID')
    return im


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
    if t == 'Tabs': return [x['id'] for x in p['tabs']]
    if t in {'RadioGroup', 'Select'}: return [x['id'] for x in p['options']]
    if t == 'List': return [x['id'] for x in p['items']]
    if t in {'CheckBox', 'Switch'}: return ['off', 'on']
    if t == 'Button': return ['default', 'hover', 'pressed']
    if t == 'ScrollView': return ['top','middle','bottom']
    raise ContractError('STATE_CAPABILITY_MISSING')


def compile_matrix(bundle, binding, evidence, assets):
    require(evidence.get('kind') == 'ui_state_evidence_v1' and
            set(evidence)=={'kind','handoffSha256','reference','components'}, 'STATE_MATRIX_INVALID')
    policies = evidence.get('components', {})
    require(isinstance(policies,dict),'STATE_MATRIX_INVALID')
    by_binding = {b['componentId']: b for b in binding['bindings']}
    resources = {r['path']: r for r in bundle['resources']}
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
        records = []
        def part(slot, role, image, rect, visible=True, runtime_sized=False, **selectors):
            matches = [q for q in b['parts'] if q['role'] == role and all(q.get(k) == v for k, v in selectors.items())]
            require(len(matches) == 1, 'STATE_MISSING:' + slot)
            layer = matches[0]['layerId']
            resource = resources[image]
            require(layer in assets and hashlib.sha256(assets[layer]).hexdigest() == resource['sha256'], 'STATE_RESOURCE_MISMATCH')
            im = image_bytes(assets[layer]); extrema = im.getchannel('A').getextrema()
            require(extrema[0] == 0 and extrema[1] > 0, 'STATE_ALPHA_INVALID:' + layer)
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
            value = name
            action = 'click'
            point = [x+w/2, y+h/2]
            def exclude(r, ox=x, oy=y): excludes.append([ox+r['x'], oy+r['y'], r['width'], r['height']])
            if t == 'Tabs':
                require(len(a.get('icons', [])) == len(names), 'STATE_MISSING:TAB_ICONS')
                cell = w/len(names); point = [x+names.index(name)*cell+cell/2, y+a['headerHeight']/2]
                for index, tab in enumerate(names):
                    active = tab == name
                    role = 'active-tab' if active else 'tab'
                    parts.append(part('background/'+tab, role, a['activeTabImage' if active else 'tabImage'], [x+index*cell, y, cell, a['headerHeight']]))
                    icon = next((q for q in a['icons'] if q['tabId'] == tab), None)
                    require(icon is not None, 'STATE_MISSING:TAB_ICONS')
                    data = icon['activeIcon' if active else 'icon']; r = data['layout']
                    parts.append(part('icon/'+tab, 'active-icon' if active else 'icon', data['image'],
                                      [x+index*cell+r['x'], y+r['y'], r['width'], r['height']], tabId=tab))
                    parts[-1]['localLayout']={'coordinateSpace':'target-item-local',**r}
                    exclude(a['labelLayout'], x+index*cell, y)
                    texts.append(dict(rect=excludes[-1],color=a.get('activeTextColor',p['style']['textColor']) if active else p['style']['textColor'],text=p['tabs'][index]['label']))
            elif t == 'Button':
                parts.append(part('background', 'background', a['backgroundImage'], [x,y,w,h]))
                exclude(a['labelLayout']); action = name; value = None
            elif t == 'CheckBox':
                value = name == 'on'
                parts = [positioned('box','box',a['box']), positioned('mark','mark',a['mark'],value)]
                exclude(a['labelLayout'])
            elif t == 'Switch':
                value = name == 'on'; pos = a['thumbPositions'][name]
                thumb=image_bytes(base64.b64decode(resources[a['thumbImage']]['base64']))
                parts = [part('track','track',a['trackImage'],[x,y,w,h]),
                         part('thumb','thumb',a['thumbImage'],[x+pos['x'],y+pos['y'],thumb.width,thumb.height])]
                if 'labelLayout' in a: exclude(a['labelLayout'])
            elif t == 'RadioGroup':
                for q in a['items']:
                    oid = q['optionId']; parts += [positioned('option/'+oid,'option',q['option'],optionId=oid),positioned('indicator/'+oid,'indicator',q['indicator'],oid==name,optionId=oid)]
                    exclude(q['labelLayout'])
                    if oid == name:
                        r=q['hitArea'];point=[x+r['x']+r['width']/2,y+r['y']+r['height']/2]
            elif t == 'Select':
                parts = [part('background','background',a['fieldImage'],[x,y,w,h])]
                r=a['arrowLayout'];parts.append(part('indicator','indicator',a['arrowImage'],[x+r['x'],y+r['y'],r['width'],r['height']]))
                parts.append(part('popup','popup',a['popupImage'],[x,y+h+a['popupGap'],a['popupCanvas']['width'],a['popupCanvas']['height']]))
                exclude(a['labelLayout']);r=a.get('popupContentLayout',{'x':0,'y':0,**a['popupCanvas']});exclude(r,x,y+h+a['popupGap'])
                texts.append(dict(rect=excludes[-2],color=a.get('fieldTextColor',p['style']['textColor']),text=next(o['label'] for o in p['options'] if o['id']==name)))
                for index,option in enumerate(p['options']):
                    texts.append(dict(rect=[x+r['x'],y+h+a['popupGap']+r['y']+index*r['height']/len(names),r['width'],r['height']/len(names)],color=p['style']['textColor'],text=option['label']))
                action='select';point=[x+r['x']+r['width']/2,y+h+a['popupGap']+r['y']+(names.index(name)+.5)*r['height']/len(names)]
            elif t == 'ScrollView':
                scroll=scroll_geometry(n,{'top':0,'middle':.5,'bottom':1}[name])
                scroll['children']=[]
                r=scroll['thumb']
                parts=[positioned('viewport','viewport',a['viewport']),
                       positioned('track','scrollbar-track',a['scrollbarTrack']),
                       part('thumb','scrollbar-thumb',a['scrollbarThumbImage'],[x+r[0],y+r[1],r[2],r[3]],runtime_sized=True)]
                value={'x':0,'y':scroll['scrollY']};action='scroll';point=[x+r[0]+r[2]/2,y+r[1]+r[3]/2]
                # Child content covers the viewport, not the foreground scrollbar.
                for child in n.get('children',[]):
                    r=child['layout'];vp=scroll['viewport'];excludes.append(intersect_rect([x+vp['x'],y+vp['y'],vp['width'],vp['height']],
                        [x+vp['x']+r['x'],y+vp['y']+r['y']-scroll['scrollY'],r['width'],r['height']]))
                    scroll['children'].append({'id':child['id'],'x':x+vp['x']+r['x'],'y':y+vp['y']+r['y']-scroll['scrollY']})
            elif t == 'List':
                parts=[part('background','background',a['backgroundImage'],[x,y,w,h])]
                for index, item in enumerate(names):
                    selected=item==name;role='selected-row' if selected else 'row'
                    parts.append(part('row/'+item,role,a['selectedRowImage' if selected else 'rowImage'],[x,y+index*p['itemHeight'],w,p['itemHeight']]))
                    exclude(a['labelLayout'],x,y+index*p['itemHeight'])
                point=[x+w/2,y+(names.index(name)+.5)*p['itemHeight']]
                require(point[1] < y+h, 'STATE_NOT_VISIBLE')
                for child in n.get('children',[]):
                    r=child['layout'];excludes.append([x+r['x'],y+r['y'],r['width'],r['height']])
            records.append(dict(name=name,value=value,action=action,point=point,parts=parts,exclude=excludes,textRegions=texts,referenceEvidence=proof,scroll=scroll,
                                clip=intersect_rect(inherited_clip,[x,y,w,h]) if t=='List' else inherited_clip if t!='Select' else None))
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
        output.append(dict(componentId=ident,componentType=t,states=records,relations=policy['relations']))
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


def accept(handoff, evidence_path, component_root, output, browser=True):
    require(not output.exists(),'OUTPUT_EXISTS');output.mkdir(parents=True)
    report={'kind':'ui_state_acceptance_v1','human_visual_acceptance':False,'status':'failed'}
    try:
        evidence=read_json(evidence_path)
        require(evidence.get('handoffSha256')==sha256(handoff),'STATE_RESOURCE_MISMATCH')
        reference=evidence['reference'];source=safe_relative(evidence_path.parent,reference['path'])
        require(set(reference)=={'path','sha256'},'STATE_REFERENCE_EVIDENCE_MISSING')
        require(sha256(source)==reference['sha256'],'STATE_REFERENCE_EVIDENCE_MISSING')
        # Fresh CLI output is the authoritative consumed document, never a copied preview bundle.
        cli=component_root/'scripts/cli.mjs'
        result=subprocess.run(['node',str(cli),'component-handoff',str(handoff),'--output',str(output/'consumed.json')],capture_output=True,text=True)
        require(result.returncode==0,'STATE_COMPONENT_IMPORT_FAILED')
        require((output/'consumed.json').stat().st_size<=64*1024*1024,'STATE_ARCHIVE_LIMIT')
        bundle=json.loads((output/'consumed.json').read_text(encoding='utf-8'))
        binding,assets=archive_inputs(handoff)
        matrix=compile_matrix(bundle,binding,evidence,assets)
        with Image.open(source) as ref:
            require(all(s['referenceEvidence']['region'][0]+s['referenceEvidence']['region'][2]<=ref.width and
                        s['referenceEvidence']['region'][1]+s['referenceEvidence']['region'][3]<=ref.height
                        for c in matrix['components'] for s in c['states']), 'STATE_REFERENCE_EVIDENCE_MISSING')
        public_reference={'path':'reference/'+reference['path'],'sha256':reference['sha256']}
        ref_target=safe_relative(output,public_reference['path']);ref_target.parent.mkdir(parents=True,exist_ok=True)
        with source.open('rb') as reader,ref_target.open('xb') as writer:shutil.copyfileobj(reader,writer)
        require(sha256(ref_target)==reference['sha256'],'STATE_REFERENCE_EVIDENCE_MISSING')
        write_json(output/'state-evidence.json',{**evidence,'reference':public_reference})
        matrix.update(handoffSha256=sha256(handoff),bundleSha256=sha256(output/'consumed.json'),reference=public_reference,
                      inputEvidenceSha256=sha256(evidence_path),evidenceSha256=sha256(output/'state-evidence.json'))
        write_json(output/'state-matrix.json',matrix)
        report.update(status='deterministic_passed',handoffSha256=sha256(handoff),matrixSha256=sha256(output/'state-matrix.json'))
        if browser:
            result=subprocess.run(['node',str(Path(__file__).with_name('stateful_browser.mjs')),str(component_root),str(output)],capture_output=True,text=True)
            require(result.returncode==0,'STATE_BROWSER_FAILED')
            report.update(status='technical_passed',browserSha256=sha256(output/'browser.json'))
            target=output/'ui.component-handoff.draft.zip';pending=output/'.handoff.pending'
            with handoff.open('rb') as reader, pending.open('xb') as writer:
                shutil.copyfileobj(reader,writer)
            require(sha256(pending)==matrix['handoffSha256'],'STATE_RESOURCE_MISMATCH')
            pending.replace(target)
        return report
    except (ContractError,ValueError,KeyError,TypeError,IndexError,OSError,zipfile.BadZipFile) as exc:
        report['status']='failed'
        report['error']=str(exc) if isinstance(exc,ContractError) else 'STATE_INPUT_INVALID'
        raise ContractError(report['error']) from exc
    finally:
        (output/'.handoff.pending').unlink(missing_ok=True)
        write_json(output/'acceptance.json',report)


def main(argv=None):
    p=argparse.ArgumentParser(description=__doc__)
    for key in ['handoff','evidence','component-root','output']:p.add_argument('--'+key,required=True,type=Path)
    p.add_argument('--qa-only',action='store_true',help='Never establishes browser acceptance')
    a=p.parse_args(argv)
    try:
        print(json.dumps(accept(a.handoff.resolve(),a.evidence.resolve(),a.component_root.resolve(),a.output.resolve(),not a.qa_only),indent=2));return 0
    except ContractError as exc:
        print(json.dumps({'status':'failed','code':str(exc),'human_visual_acceptance':False}));return 2


if __name__=='__main__':raise SystemExit(main())
