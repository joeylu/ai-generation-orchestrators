"""Separate, zero-compute reprocessing recipe for bounded horizontal key gutters.

Never modifies a frozen strategy or its failed extraction. No semantic matching.
"""
from copy import deepcopy
from pathlib import Path
import argparse,json
import numpy as np
from .common import ContractError,digest,read_json,write_json,require,sha256,load_verified_image
from .component_boards import verify_strategy,crop_board
from .cached import verified_result
from .media import KEY_RGB


def adjusted_windows(raw,board,max_shift):
    require(type(max_shift) is int and 1<=max_shift<=32,'GUTTER_SHIFT_POLICY')
    require(board.get('extraction_policy',{}).get('mode')=='relative-cell','GUTTER_RELATIVE_REQUIRED')
    rw,rh=raw.size;cw,ch=board['canvas'];result=deepcopy(board);result['canvas']=[rw,rh]
    distance=np.linalg.norm(np.asarray(raw.convert('RGB')).astype(float)-KEY_RGB,axis=2)
    foreground=(distance>=145)&(np.asarray(raw.convert('RGBA'))[:,:,3]>0)
    rows={};changes=[]
    for slot in result['slots']:
        l,t,r,b=slot['search_window'];slot['search_window']=[round(l*rw/cw),round(t*rh/ch),round(r*rw/cw),round(b*rh/ch)]
        rows.setdefault((slot['search_window'][1],slot['search_window'][3]),[]).append(slot)
    for (top,bottom),slots in rows.items():
        slots.sort(key=lambda s:s['search_window'][0])
        if len(slots)==1:continue
        occupied=foreground[top:bottom].any(axis=0)
        edges=np.diff(np.r_[False,occupied,False].astype(int))
        starts=np.flatnonzero(edges==1);ends=np.flatnonzero(edges==-1)
        require(len(starts)==len(slots),'GUTTER_PART_COUNT')
        boundaries=[0]
        for i in range(len(slots)-1):
            left,right=int(ends[i]),int(starts[i+1]);require(right-left>=6,'GUTTER_CLEARANCE')
            edge=(left+right)//2;old=slots[i]['search_window'][2]
            smaller=min(s['search_window'][2]-s['search_window'][0] for s in slots[i:i+2])
            require(abs(edge-old)<=min(max_shift*rw/cw,smaller/2),'GUTTER_SHIFT_EXCEEDED')
            require(bool((distance[top:bottom,edge-2:edge+2]<45).all()),'GUTTER_NOT_PURE_KEY')
            boundaries.append(edge)
            changes.append({'leftAsset':slots[i]['asset_id'],'rightAsset':slots[i+1]['asset_id'],
                            'oldX':old,'newX':edge,'shift':edge-old,'row':[top,bottom]})
        boundaries.append(rw)
        for i,slot in enumerate(slots):slot['search_window']=[boundaries[i],top,boundaries[i+1],bottom]
    return result,changes


def make_recipe(run,asset,strategy_path,board_id,max_shift):
    strategy=read_json(strategy_path);verify_strategy(strategy)
    boards=[b for b in strategy['boards'] if b['id']==board_id];require(len(boards)==1,'BOARD_NOT_FOUND')
    board=boards[0];frozen,item,receipt,rawpath=verified_result(run,asset)
    require(f"component-family-board-v1:{strategy['digest']}:{board_id}" in item['prompt'],'BOARD_PLAN_BINDING')
    raw,_=load_verified_image(rawpath)
    try:crop_board(raw,board,item['output_mode'])
    except ContractError as exc:
        error=str(exc);require(error.startswith('BOARD_CELL_EDGE_CLIPPED:'),'GUTTER_UNSUPPORTED_FAILURE')
    else:raise ContractError('GUTTER_REPROCESSING_UNNECESSARY')
    adjusted,changes=adjusted_windows(raw,board,max_shift)
    # Complete all original output checks using the separate geometry recipe.
    crop_board(raw,adjusted,item['output_mode'])
    recipe={'kind':'ai_ui_board_gutter_reprocessing_v1','version':'1.0','batch_digest':frozen['digest'],
            'asset':asset,'board':board_id,'strategy_digest':strategy['digest'],
            'request_sha256':frozen['requests'][asset]['request_sha256'],'raw_sha256':receipt['raw_sha256'],
            'original_extraction_error':error,'max_boundary_shift':max_shift,'coordinate_space':'original-canvas',
            'adjusted_board':adjusted,'boundaries':changes,'generation_calls':0,'human_visual_acceptance':False,
            'semantic_identity':'caller_review_required; original row order only','runtime_acceptance':'not_performed'}
    recipe['digest']=digest(recipe);return recipe


def extract(run,strategy_path,recipe_path,output):
    recipe=read_json(recipe_path)
    verified=make_recipe(run,recipe['asset'],strategy_path,recipe['board'],recipe['max_boundary_shift'])
    require(recipe==verified,'GUTTER_RECIPE_CHANGED')
    _,item,_,rawpath=verified_result(run,recipe['asset']);raw,_=load_verified_image(rawpath)
    parts,rows=crop_board(raw,recipe['adjusted_board'],item['output_mode'])
    require(not output.exists(),'OUTPUT_EXISTS');output.mkdir(parents=True)
    for row in rows:
        p=output/(row['asset_id']+'.png');parts[row['asset_id']].save(p);row.update(path=p.name,sha256=sha256(p))
    write_json(output/'reprocessing-recipe.json',recipe)
    report={'kind':'ai_ui_component_board_reprocessed_v1','recipe_digest':recipe['digest'],
            'original_strategy_digest':recipe['strategy_digest'],'original_extraction_error':recipe['original_extraction_error'],
            'raw_sha256':recipe['raw_sha256'],'parts':rows,'generation_calls':0,'human_visual_acceptance':False,
            'semantic_identity':'caller_review_required','runtime_acceptance':'not_performed'}
    report['digest']=digest(report);write_json(output/'extraction.json',report);return report


def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('command',choices=['plan','extract'])
    for field in ['run','strategy','output']:p.add_argument('--'+field,type=Path,required=True)
    p.add_argument('--asset');p.add_argument('--board');p.add_argument('--max-shift',type=int,default=32)
    p.add_argument('--recipe',type=Path);a=p.parse_args()
    if a.command=='plan':
        result=make_recipe(a.run,a.asset,a.strategy,a.board,a.max_shift);write_json(a.output,result)
    else:result=extract(a.run,a.strategy,a.recipe,a.output)
    print(json.dumps(result,ensure_ascii=False,indent=2))


if __name__=='__main__':main()
