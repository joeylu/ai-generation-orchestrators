"""Explicit producer-only relative cell windows. No semantic reassignment."""
import numpy as np
from PIL import Image
from .common import require
from .media import KEY_RGB,matte_key,normalize,require_long_control_geometry
from .resources import require_keyed_input_limit


def validate_policy(policy):
    require(isinstance(policy,dict) and set(policy)=={'version','mode','target_padding','max_canvas_aspect_error'} and
            policy['version']=='1.0' and policy['mode']=='relative-cell','BOARD_RELATIVE_POLICY')
    require(type(policy['target_padding']) is int and 1<=policy['target_padding']<=16 and
            type(policy['max_canvas_aspect_error']) in (int,float) and 0<=policy['max_canvas_aspect_error']<=.25,'BOARD_RELATIVE_POLICY')


def add_windows(board,policy):
    validate_policy(policy);board['extraction_policy']=dict(policy)
    width,height=board['canvas'];rows={}
    for slot in board['slots']:
        require(min(slot['target_size'])>2*policy['target_padding'],'BOARD_RELATIVE_PADDING')
        rows.setdefault(slot['crop'][1],[]).append(slot)
    tops=sorted(rows)
    y_edges=[0]+[(y+max(s['crop'][3] for s in rows[y])+tops[i+1])//2 for i,y in enumerate(tops[:-1])]+[height]
    for i,y in enumerate(tops):
        cells=sorted(rows[y],key=lambda s:s['crop'][0])
        x_edges=[0]+[(s['crop'][0]+s['crop'][2]+cells[j+1]['crop'][0])//2 for j,s in enumerate(cells[:-1])]+[width]
        for j,s in enumerate(cells):s['search_window']=[x_edges[j],y_edges[i],x_edges[j+1],y_edges[i+1]]


def crop_relative(raw,board,mode):
    policy=board['extraction_policy'];validate_policy(policy)
    require(mode=='keyed_component','BOARD_RELATIVE_KEY_REQUIRED')
    rw,rh=raw.size;cw,ch=board['canvas']
    require_keyed_input_limit([rw,rh])
    require(abs((rw/rh)/(cw/ch)-1)<=policy['max_canvas_aspect_error'],'BOARD_RELATIVE_CANVAS_ASPECT')
    rgb=np.asarray(raw.convert('RGB')).astype(float)
    distance=np.linalg.norm(rgb-KEY_RGB,axis=2)
    # Border colors must provide actual evidence for the declared key.
    perimeter=np.concatenate([distance[0,:],distance[-1,:],distance[:,0],distance[:,-1]])
    require(float(np.mean(perimeter<45))>=.98,'BOARD_KEY_BACKGROUND_REQUIRED')
    foreground=(distance>=145)&(np.asarray(raw.convert('RGBA'))[:,:,3]>0)
    parts={};records=[];padding=policy['target_padding']
    for slot in board['slots']:
        l,t,r,b=slot['search_window'];box=[round(l*rw/cw),round(t*rh/ch),round(r*rw/cw),round(b*rh/ch)]
        l,t,r,b=box;region=foreground[t:b,l:r]
        require(region.size and region.any(),'BOARD_EMPTY_PART:'+slot['asset_id'])
        require(not (region[0,:].any() or region[-1,:].any() or region[:,0].any() or region[:,-1].any()),'BOARD_CELL_EDGE_CLIPPED:'+slot['asset_id'])
        cut=matte_key(raw.crop(box),[r-l,b-t]);bbox=cut.getchannel('A').getbbox()
        require(bbox is not None,'BOARD_EMPTY_PART:'+slot['asset_id'])
        source=cut.crop(bbox);tw,th=slot['target_size']
        scale=min((tw-2*padding)/source.width,(th-2*padding)/source.height)
        fitted=[max(1,round(source.width*scale)),max(1,round(source.height*scale))]
        source=source.resize(fitted,Image.Resampling.LANCZOS);offset=[(tw-fitted[0])//2,(th-fitted[1])//2]
        part=Image.new('RGBA',(tw,th));part.paste(source,tuple(offset));part=normalize(part)
        require(part.getchannel('A').getextrema()==(0,255),'BOARD_PART_ALPHA')
        require_long_control_geometry(part,[tw,th],{'insets':[padding]*4})
        parts[slot['asset_id']]=part
        records.append({'asset_id':slot['asset_id'],'source_window':box,'matte_bbox_in_window':list(bbox),
                        'target_size':[tw,th],'uniform_scale':scale,'resampled_size':fitted,'target_offset':offset,
                        'target_padding':padding,'alpha_bbox':list(part.getchannel('A').getbbox()),
                        'transform':'explicit global key removal; relative cell; uniform per-part fit',
                        'semantic_identity':'requires_review','state_registration':'requires_runtime_acceptance'})
    return parts,records
