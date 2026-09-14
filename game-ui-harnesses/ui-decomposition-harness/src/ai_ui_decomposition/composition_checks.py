"""Producer-only, evidence-bound background ownership and row spacing checks."""
import math
from PIL import Image
from .common import require, sha256, safe_relative


def check_composition(document, screenshot, plan, base):
    require(set(plan)=={'version','screenshotSha256','backgrounds','rowSpacing'} and plan['version']=='1.0','COMPOSITION_PLAN')
    require(sha256(screenshot)==plan['screenshotSha256'],'COMPOSITION_SCREENSHOT_CHANGED')
    require(isinstance(plan['backgrounds'],list) and isinstance(plan['rowSpacing'],list),'COMPOSITION_LISTS')
    nodes={};parents={}
    def walk(n,parent=None):
        require(n['id'] not in nodes,'COMPOSITION_DUPLICATE_ID');nodes[n['id']]=n;parents[n['id']]=parent
        for c in n.get('children',[]):walk(c,n['id'])
    walk(document['root'])
    im=Image.open(screenshot).convert('RGBA')
    require(im.size==(document['canvas']['width'],document['canvas']['height']),'COMPOSITION_NATIVE_SCREENSHOT_REQUIRED')
    errors=[];warnings=[];checked=[];seen=set()
    for e in plan['backgrounds']:
        require(set(e)=={'componentId','ownerId','reason','parentOnly','points','tolerance'},'COMPOSITION_BACKGROUND_FIELDS')
        ident=e['componentId'];owner=e['ownerId']
        require(ident in nodes and owner in nodes and ident not in seen,'COMPOSITION_BACKGROUND_ID');seen.add(ident)
        require(isinstance(e['reason'],str) and e['reason'].strip(),'COMPOSITION_REASON')
        ancestor=ident
        while ancestor is not None and ancestor!=owner:ancestor=parents[ancestor]
        require(ancestor==owner,'COMPOSITION_OWNER_NOT_ANCESTOR')
        if owner!=ident and nodes[ident].get('props',{}).get('drawBackground') is not False:
            errors.append({'code':'BACKGROUND_DUPLICATE_OWNER','componentId':ident,'ownerId':owner})
        require(type(e['tolerance']) is int and 0<=e['tolerance']<=255,'COMPOSITION_TOLERANCE')
        require(isinstance(e['points'],list) and e['points'],'COMPOSITION_POINTS_REQUIRED')
        ref=e['parentOnly'];require(set(ref)=={'path','sha256'},'COMPOSITION_REFERENCE')
        path=safe_relative(base,ref['path']);require(sha256(path)==ref['sha256'],'COMPOSITION_PARENT_CHANGED')
        parent=Image.open(path).convert('RGBA');require(parent.size==im.size,'COMPOSITION_PARENT_SIZE')
        bad=[]
        for point in e['points']:
            require(isinstance(point,list) and len(point)==2 and all(type(x) is int for x in point),'COMPOSITION_POINT')
            x,y=point;require(0<=x<im.width and 0<=y<im.height,'COMPOSITION_POINT_BOUNDS')
            if max(abs(a-b) for a,b in zip(im.getpixel((x,y)),parent.getpixel((x,y))))>e['tolerance']:bad.append(point)
        if bad:errors.append({'code':'BACKGROUND_EXPOSED_PIXEL_MISMATCH','componentId':ident,'points':bad})
        checked.append({'componentId':ident,'ownerId':owner,'sampleCount':len(e['points']),'badPoints':len(bad)})
    row_seen=set()
    for e in plan['rowSpacing']:
        require(set(e)=={'componentId','state','reason','paintBounds','preferredGap'},'COMPOSITION_ROW_FIELDS')
        ident=e['componentId'];require(ident in nodes and nodes[ident]['type']=='List','COMPOSITION_LIST_ID')
        require(ident not in row_seen,'COMPOSITION_DUPLICATE_ROWS');row_seen.add(ident)
        require(all(isinstance(e[k],str) and e[k].strip() for k in ('state','reason')),'COMPOSITION_ROW_EVIDENCE')
        bounds=e['paintBounds'];require(isinstance(bounds,list) and len(bounds)>=2,'COMPOSITION_ROWS_REQUIRED')
        for rect in bounds:
            require(isinstance(rect,list) and len(rect)==4 and all(type(v) in (int,float) and math.isfinite(v) for v in rect),'COMPOSITION_RECT')
            x,y,w,h=rect;require(x>=0 and y>=0 and w>0 and h>0 and x+w<=im.width and y+h<=im.height,'COMPOSITION_RECT_BOUNDS')
        gap=e['preferredGap'];require(isinstance(gap,list) and len(gap)==2 and all(type(v) in (int,float) and math.isfinite(v) and v>=0 for v in gap) and gap[0]<=gap[1],'COMPOSITION_GAP_RANGE')
        gaps=[b[1]-a[1]-a[3] for a,b in zip(bounds,bounds[1:])]
        if any(g<0 for g in gaps):errors.append({'code':'ROW_PAINT_OVERLAP','componentId':ident,'gaps':gaps})
        elif any(not gap[0]<=g<=gap[1] for g in gaps):warnings.append({'code':'ROW_DENSITY_ADVISORY','componentId':ident,'gaps':gaps,'preferredGap':gap})
        checked.append({'componentId':ident,'state':e['state'],'visibleGaps':gaps,'measurement':'explicit screenshot-bound paint bounds; no automatic border detection'})
    return {'kind':'ui_composition_checks_v1','status':'failed' if errors else 'passed_with_advisories' if warnings else 'passed',
            'errors':errors,'warnings':warnings,'checks':checked,'uncheckedBackgroundIds':[i for i,n in nodes.items() if n['type'] in ('Tabs','List','ScrollView') and i not in seen],
            'uncheckedListSpacingIds':[i for i,n in nodes.items() if n['type']=='List' and i not in row_seen],
            'human_visual_acceptance':False}
