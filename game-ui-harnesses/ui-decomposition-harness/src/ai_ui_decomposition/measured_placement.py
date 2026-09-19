"""Placement arithmetic for caller-reviewed rectangles; no visual inference."""
import math
from .common import require


def prepare_alignment(run, specification, output):
    """Create a fresh all-import plan from authenticated materials; never generate."""
    from pathlib import Path
    from copy import deepcopy
    import shutil
    from PIL import Image
    from . import batch
    from .process import read_materials
    from .common import digest, write_json, sha256, safe_relative
    from .contract import validate
    run=Path(run).resolve();output=Path(output).resolve()
    frozen,original=batch.load(run);materials=read_materials(run);s=specification
    require(isinstance(s,dict) and set(s)=={'kind','planDigest','materialsDigest','basis','alignments'}
            and s['kind']=='ui_assets_measured_alignment_v1','ALIGNMENT_FIELDS')
    require(s['planDigest']==digest(original)==materials['plan_digest'] and
            s['materialsDigest']==materials['digest'] and materials['batch_digest']==frozen['digest'],'ALIGNMENT_BINDING')
    require(isinstance(s['basis'],str) and s['basis'].strip(),'ALIGNMENT_BASIS')
    require(isinstance(s['alignments'],list) and 0<len(s['alignments'])<=128,'ALIGNMENT_ITEMS')
    require(original['document']['format']=='png_zip','PNG_ZIP_PLAN_REQUIRED')
    plan=deepcopy(original);nodes={n['id']:n for n in plan['nodes']};assets={a['id']:a for a in plan['assets']}
    mats={m['asset']:m for m in materials['assets']};changes=[];seen=set()
    for item in s['alignments']:
        require(isinstance(item,dict) and set(item)=={'node','surfaceNode','row','visibleLeft'},'ALIGNMENT_ITEM_FIELDS')
        key=item['node'];surface=item['surfaceNode']
        require(isinstance(key,str) and key in nodes and key not in seen and
                isinstance(surface,str) and surface in nodes and surface!=key,'ALIGNMENT_NODE')
        seen.add(key);node=nodes[key];owner=nodes[surface]
        require(assets[node['asset']]['role']=='important_component','ALIGNMENT_FOREGROUND_REQUIRED')
        with Image.open(safe_relative(run,mats[node['asset']]['path'])) as im:
            bounds=im.getchannel('A').getbbox()
        xy=center_visible_in_row(item['row'],bounds,item['visibleLeft'])
        x,y,w,h=item['row'];sx,sy=owner['xy'];sw,sh=assets[owner['asset']]['output_size']
        require(sx<=x and sy<=y and x+w<=sx+sw and y+h<=sy+sh,'ALIGNMENT_SURFACE_BOUNDS')
        changes.append(dict(node=key,before=node['xy'],after=xy,alphaBounds=list(bounds),row=item['row'],surfaceNode=surface))
        node['xy']=xy
    require(not seen.intersection(i['surfaceNode'] for i in s['alignments']),'ALIGNMENT_MOVING_SURFACE')
    for asset in plan['assets']:
        m=mats[asset['id']]
        for field in ('historical_request','cached_result','resize','foreground_support'):asset.pop(field,None)
        asset.update(route='imported_material',prompt='',source_asset=None,
                     output_mode='opaque_canvas' if asset['role']=='background' else 'rgba',
                     material_source=dict(path='imports/'+asset['id']+'.png',sha256=m['sha256']))
    # Retain reference inventory as source observations, not a claim of unchanged placement.
    plan['delivery_policy']='unreviewed_draft'
    plan['source']['path']='reference.png'
    validate(plan,verify_source=False)
    require(not output.exists(),'OUTPUT_EXISTS');output.mkdir(parents=True);(output/'imports').mkdir()
    shutil.copyfile(run/'input/reference.png',output/'reference.png')
    # This new local plan uses the authenticated normalized snapshot.
    # Original artwork remains in the source job, never replaced by this derivative.
    plan['source']['sha256']=sha256(output/'reference.png')
    if 'reference_coverage' in plan:plan['reference_coverage']['sourceSha256']=plan['source']['sha256']
    for asset in plan['assets']:
        shutil.copyfile(safe_relative(run,mats[asset['id']]['path']),output/asset['material_source']['path'])
    validate(plan,source_base=output)
    write_json(output/'plan.json',plan)
    result=dict(kind='ui_assets_measured_alignment_result_v1',sourcePlanDigest=digest(original),
                sourceMaterialsDigest=materials['digest'],specificationDigest=digest(s),planDigest=digest(plan),
                changes=changes,generationCalls=0,humanVisualAcceptance=False,
                scope='Adapt to caller-reviewed generated surface; not original reference registration.')
    result['digest']=digest(result);write_json(output/'alignment.json',result)
    return result


def center_visible_in_row(row, alpha_bounds, visible_left):
    """Canvas row [x,y,w,h], local Alpha bounds [left,top,right,bottom]."""
    require(isinstance(row,(list,tuple)) and len(row)==4 and
            isinstance(alpha_bounds,(list,tuple)) and len(alpha_bounds)==4,
            'PLACEMENT_RECT')
    require(all(type(v) in (int,float) and math.isfinite(v)
                for v in [*row,*alpha_bounds,visible_left]), 'PLACEMENT_NUMBER')
    x,y,w,h=row;l,t,r,b=alpha_bounds
    require(min(x,y,l,t)>=0 and w>0 and h>0 and r>l and b>t, 'PLACEMENT_BOUNDS')
    require(x<=visible_left and visible_left+r-l<=x+w and b-t<=h, 'PLACEMENT_FIT')
    return [round(visible_left-l),round(y+h/2-(t+b)/2)]
