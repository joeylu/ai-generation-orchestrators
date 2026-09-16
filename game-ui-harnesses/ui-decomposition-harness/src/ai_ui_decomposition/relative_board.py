"""Explicit producer-only relative cell windows. No semantic reassignment."""
import numpy as np
import math
from PIL import Image
from .common import require
from .media import KEY_RGB,matte_key,normalize,require_long_control_geometry
from .resources import require_keyed_input_limit


def validate_policy(policy):
    if isinstance(policy,dict) and policy.get('version') in {'1.1','1.2'}:
        fields={'version','mode','target_padding','canvas_policy','max_internal_gap_ratio','max_part_aspect_error'}
        if policy['version']=='1.2':
            fields.add('separation_basis')
            require(policy.get('separation_basis')=='mixed-height','BOARD_RELATIVE_POLICY')
        require(set(policy)==fields and
                policy['mode']=='foreground-gap-row' and policy['canvas_policy']=='content-bounds','BOARD_RELATIVE_POLICY')
        require(type(policy['target_padding']) is int and 1<=policy['target_padding']<=16,'BOARD_RELATIVE_POLICY')
        for key,limit in [('max_internal_gap_ratio',.08),('max_part_aspect_error',.5)]:
            require(type(policy[key]) in (int,float) and math.isfinite(policy[key]) and 0<=policy[key]<=limit,'BOARD_RELATIVE_POLICY')
        return
    require(isinstance(policy,dict) and set(policy)=={'version','mode','target_padding','max_canvas_aspect_error'} and
            policy['version']=='1.0' and policy['mode'] in {'relative-cell','foreground-gap-row'},'BOARD_RELATIVE_POLICY')
    require(type(policy['target_padding']) is int and 1<=policy['target_padding']<=16 and
            type(policy['max_canvas_aspect_error']) in (int,float) and 0<=policy['max_canvas_aspect_error']<=.25,'BOARD_RELATIVE_POLICY')


def add_windows(board,policy):
    validate_policy(policy);board['extraction_policy']=dict(policy)
    width,height=board['canvas'];rows={}
    for slot in board['slots']:
        require(min(slot['target_size'])>2*policy['target_padding'],'BOARD_RELATIVE_PADDING')
        rows.setdefault(slot['crop'][1],[]).append(slot)
    tops=sorted(rows)
    if policy['mode']=='foreground-gap-row':
        require(len(tops)==1,'BOARD_GAP_SINGLE_ROW_REQUIRED')
    y_edges=[0]+[(y+max(s['crop'][3] for s in rows[y])+tops[i+1])//2 for i,y in enumerate(tops[:-1])]+[height]
    for i,y in enumerate(tops):
        cells=sorted(rows[y],key=lambda s:s['crop'][0])
        x_edges=[0]+[(s['crop'][0]+s['crop'][2]+cells[j+1]['crop'][0])//2 for j,s in enumerate(cells[:-1])]+[width]
        for j,s in enumerate(cells):s['search_window']=[x_edges[j],y_edges[i],x_edges[j+1],y_edges[i+1]]


def gap_windows(foreground,slots,policy=None,frame_ids=()):
    """Conservative horizontal projection: no noise deletion or identity inference."""
    require(not (foreground[0].any() or foreground[-1].any() or foreground[:,0].any() or foreground[:,-1].any()),'BOARD_GAP_CANVAS_CLIPPED')
    occupied=foreground.any(axis=0)
    transitions=np.diff(np.r_[False,occupied,False].astype(int))
    starts=np.flatnonzero(transitions==1);ends=np.flatnonzero(transitions==-1)
    if policy is not None and policy['version'] in {'1.1','1.2'}:
        # Group projection intervals, never paint, erase or bridge source pixels.
        # Thresholds depend on observed silhouette height, not canvas whitespace.
        groups=[]
        for start,end in zip(starts,ends):
            ys=np.flatnonzero(foreground[:,start:end].any(axis=1))
            top,bottom=int(ys[0]),int(ys[-1])+1
            if groups:
                prev=groups[-1];gap=int(start)-prev[1]
                threshold=math.floor(max(bottom-top,prev[3]-prev[2])*policy['max_internal_gap_ratio'])
                overlap=min(bottom,prev[3])-max(top,prev[2])
                if gap<=threshold and overlap>0:
                    prev[1]=int(end);prev[2]=min(prev[2],top);prev[3]=max(prev[3],bottom)
                    continue
            groups.append([int(start),int(end),top,bottom])
        starts=np.array([g[0] for g in groups],dtype=int);ends=np.array([g[1] for g in groups],dtype=int)
    require(len(starts)==len(slots),'BOARD_GAP_COUNT_OR_JOINED')
    require(len({s['crop'][1] for s in slots})==1,'BOARD_GAP_SINGLE_ROW_REQUIRED')
    ordered=sorted(slots,key=lambda s:s['crop'][0])
    require(len({s['crop'][0] for s in ordered})==len(slots),'BOARD_GAP_ORDER_AMBIGUOUS')
    bounds=[]
    for start,end in zip(starts,ends):
        ys=np.flatnonzero(foreground[:,start:end].any(axis=1))
        tolerance=0 if policy is None or policy['version']=='1.0' else math.floor((ys[-1]-ys[0]+1)*policy['max_internal_gap_ratio'])
        require(np.all(np.diff(ys)<=tolerance+1),'BOARD_GAP_MULTIPLE_ROWS')
        bounds.append((int(ys[0]),int(ys[-1])+1))
    if policy is not None and policy['version'] in {'1.1','1.2'}:
        for index,(slot,(top,bottom)) in enumerate(zip(ordered,bounds)):
            if slot['asset_id'] in frame_ids:
                continue
            w,h=slot['target_size'];p=policy['target_padding']
            expected=(w-2*p)/(h-2*p);actual=(ends[index]-starts[index])/(bottom-top)
            require(abs(actual/expected-1)<=policy['max_part_aspect_error'],'BOARD_GAP_PART_ASPECT:'+slot['asset_id'])
        for i in range(len(starts)-1):
            threshold=math.ceil(max(bounds[i][1]-bounds[i][0],bounds[i+1][1]-bounds[i+1][0])*policy['max_internal_gap_ratio']*4)
            if policy['version']=='1.2':
                heights=[bounds[i][1]-bounds[i][0],bounds[i+1][1]-bounds[i+1][0]]
                # Still exceed the larger silhouette's internal grouping radius;
                # scale the stronger separation margin to the smaller neighbor.
                threshold=max(math.floor(max(heights)*policy['max_internal_gap_ratio'])+2,
                              math.ceil(min(heights)*policy['max_internal_gap_ratio']*4))
            require(starts[i+1]-ends[i]>=max(2,threshold),'BOARD_GAP_AMBIGUOUS_SEPARATION')
    require(max(t for t,b in bounds)<min(b for t,b in bounds),'BOARD_GAP_ROW_ALIGNMENT')
    # At least two empty columns keep both neighboring crop edges clear.
    require(all(int(starts[i+1]-ends[i])>=2 for i in range(len(starts)-1)),'BOARD_GAP_TOO_NARROW')
    edges=[0]+[int((ends[i]+starts[i+1])//2) for i in range(len(starts)-1)]+[foreground.shape[1]]
    return {s['asset_id']:[edges[i],0,edges[i+1],foreground.shape[0]] for i,s in enumerate(ordered)}


def crop_relative(raw,board,mode,measured_frames=None):
    policy=board['extraction_policy'];validate_policy(policy)
    require(mode=='keyed_component','BOARD_RELATIVE_KEY_REQUIRED')
    rw,rh=raw.size;cw,ch=board['canvas']
    from .component_boards import validate_canvas_size
    validate_canvas_size(raw.size,board)
    rgb=np.asarray(raw.convert('RGB')).astype(float)
    distance=np.linalg.norm(rgb-KEY_RGB,axis=2)
    # Border colors must provide actual evidence for the declared key.
    perimeter=np.concatenate([distance[0,:],distance[-1,:],distance[:,0],distance[:,-1]])
    require(float(np.mean(perimeter<45))>=.98,'BOARD_KEY_BACKGROUND_REQUIRED')
    foreground=(distance>=145)&(np.asarray(raw.convert('RGBA'))[:,:,3]>0)
    frames=measured_frames or {}
    if frames:
        from .frame_fit import validate_frames
        validate_frames(frames,board)
    windows=gap_windows(foreground,board['slots'],policy,frames) if policy['mode']=='foreground-gap-row' else None
    parts={};records=[];padding=policy['target_padding']
    for slot in board['slots']:
        l,t,r,b=slot['search_window'];box=[round(l*rw/cw),round(t*rh/ch),round(r*rw/cw),round(b*rh/ch)]
        if windows is not None:box=windows[slot['asset_id']]
        l,t,r,b=box;region=foreground[t:b,l:r]
        require(region.size and region.any(),'BOARD_EMPTY_PART:'+slot['asset_id'])
        require(not (region[0,:].any() or region[-1,:].any() or region[:,0].any() or region[:,-1].any()),'BOARD_CELL_EDGE_CLIPPED:'+slot['asset_id'])
        cut=matte_key(raw.crop(box),[r-l,b-t]);bbox=cut.getchannel('A').getbbox()
        require(bbox is not None,'BOARD_EMPTY_PART:'+slot['asset_id'])
        source=cut.crop(bbox);tw,th=slot['target_size']
        if slot['asset_id'] in frames:
            from .frame_fit import fit_frame
            part,record=fit_frame(source,[tw,th],padding,frames[slot['asset_id']])
            record.update(asset_id=slot['asset_id'],source_window=box,matte_bbox_in_window=list(bbox),target_size=[tw,th],
                          semantic_identity='requires_review',state_registration='requires_runtime_acceptance')
            parts[slot['asset_id']]=part;records.append(record)
            continue
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
                        'transform':'explicit global key removal; '+policy['mode']+'; uniform per-part fit',
                        'semantic_identity':'requires_review','state_registration':'requires_runtime_acceptance'})
        if policy['version'] in {'1.1','1.2'}:
            records[-1]['grouping_policy']=dict(policy)
    return parts,records
