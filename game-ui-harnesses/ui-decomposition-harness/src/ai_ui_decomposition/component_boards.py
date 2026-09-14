"""Opt-in component-family packing and strict, receipt-bound offline extraction."""
from pathlib import Path
import argparse
import json
import numpy as np
from PIL import Image
from .common import digest, identifier, read_json, require, write_json, load_verified_image, sha256
from .media import KEY_RGB, matte_key, normalize, require_long_control_geometry

TYPES = {'Container','Image','Text','Button','Input','CheckBox','RadioGroup','Select',
         'Switch','Slider','ProgressBar','List','ScrollView','Tabs','Panel','Dialog'}


def plan_boards(description: dict) -> dict:
    require(set(description)=={'kind','strategy','assets'} and
            description['kind']=='ai_ui_material_observations_v2' and
            description['strategy']=='component-family-board-v1','BOARD_OBSERVATIONS_KIND')
    assets=description['assets']
    require(isinstance(assets,list) and 0<len(assets)<=128,'BOARD_ASSETS')
    groups={};seen=set();reuse=[]
    for a in assets:
        require(isinstance(a,dict) and set(a)=={'id','component_type','component_group',
                'target_size','source_reusable','source_evidence'},'BOARD_ASSET_FIELDS')
        key=identifier(a['id']);group=identifier(a['component_group'])
        require(key not in seen,'BOARD_DUPLICATE_ASSET');seen.add(key)
        require(a['component_type'] in TYPES,'BOARD_COMPONENT_TYPE')
        size=a['target_size']
        require(isinstance(size,list) and len(size)==2 and
                all(type(v) is int and 3<=v<=4096 for v in size),'BOARD_TARGET_SIZE')
        require(type(a['source_reusable']) is bool and isinstance(a['source_evidence'],str),
                'BOARD_SOURCE_EVIDENCE')
        g=groups.setdefault(group,{'id':group,'component_type':a['component_type'],'slots':[]})
        require(g['component_type']==a['component_type'],'BOARD_MIXED_COMPONENT_GROUP')
        if a['source_reusable']:
            require(a['source_evidence'].strip(),'BOARD_REUSE_EVIDENCE_REQUIRED')
            reuse.append(dict(a));continue
        g['slots'].append({'asset_id':key,'target_size':list(size)})
    boards=[]
    for g in groups.values():
        if not g['slots']:continue
        # Fixed pixel cells keep the target scale; no square-cell distortion.
        # A long stack must be explicitly regrouped before authorization.
        width=max(s['target_size'][0] for s in g['slots'])+16;y=8
        for s in g['slots']:
            w,h=s['target_size'];s['crop']=[8,y,w,h];y+=h+16
        require(width<=4096 and y-8<=4096,'BOARD_CANVAS_LIMIT_REGROUP_REQUIRED')
        g['canvas']=[width,y-8];boards.append(g)
    result={'kind':'ai_ui_component_board_strategy_v1','observations':description,
            'observations_digest':digest(description),'boards':boards,'source_reuse':reuse,
            'generation_request_count':len(boards),'generation_calls':0,'automatic_retries':0,
            'human_visual_acceptance':False}
    result['digest']=digest(result)
    return result


def verify_strategy(strategy: dict) -> None:
    require(strategy==plan_boards(strategy.get('observations',{})),'BOARD_STRATEGY_CHANGED')


def crop_board(raw: Image.Image, board: dict, mode: str) -> tuple[dict, list]:
    require(list(raw.size)==board['canvas'],'BOARD_CANVAS_MISMATCH')
    require(mode in {'transparent_component','keyed_component'},'BOARD_OUTPUT_MODE')
    values=np.asarray(raw.convert('RGBA'))
    if mode=='transparent_component':
        require(raw.mode=='RGBA','BOARD_NATIVE_ALPHA_REQUIRED')
        foreground=values[:,:,3]>0
    else:
        # Only the already supported explicit key, never an inferred palette.
        foreground=(np.linalg.norm(values[:,:,:3].astype(float)-KEY_RGB,axis=2)>=145)&(values[:,:,3]>0)
    assigned=np.zeros(foreground.shape,dtype=bool);parts={};rows=[]
    for slot in board['slots']:
        x,y,w,h=slot['crop'];region=foreground[y:y+h,x:x+w]
        require(not assigned[y:y+h,x:x+w].any(),'BOARD_CELL_OVERLAP')
        assigned[y:y+h,x:x+w]=True
        require(region.any(),'BOARD_EMPTY_PART:'+slot['asset_id'])
        require(not (region[0,:].any() or region[-1,:].any() or region[:,0].any() or region[:,-1].any()),
                'BOARD_CELL_EDGE_CLIPPED:'+slot['asset_id'])
        part=raw.crop((x,y,x+w,y+h))
        part=matte_key(part,[w,h]) if mode=='keyed_component' else normalize(part)
        require(part.getchannel('A').getextrema()==(0,255),'BOARD_PART_ALPHA')
        require_long_control_geometry(part,[w,h])
        parts[slot['asset_id']]=part
        rows.append({'asset_id':slot['asset_id'],'crop':[x,y,w,h],'target_size':[w,h],
                     'alpha_bbox':list(part.getchannel('A').getbbox()),
                     'transform':'global explicit key removal and uniform contain' if mode=='keyed_component' else 'pixel crop; no scaling',
                     'semantic_identity':'requires_review','state_registration':'requires_runtime_acceptance'})
    require(not foreground[~assigned].any(),'BOARD_UNASSIGNED_FOREGROUND')
    return parts,rows


def extract(run: Path, asset: str, strategy_path: Path, board_id: str, output: Path) -> dict:
    from .cached import verified_result
    strategy=read_json(strategy_path);verify_strategy(strategy)
    boards=[b for b in strategy['boards'] if b['id']==board_id]
    require(len(boards)==1,'BOARD_NOT_FOUND');board=boards[0]
    frozen,item,receipt,raw_path=verified_result(run,asset)
    # Literal provenance marker belongs in the digest-bound generation prompt.
    marker=f"component-family-board-v1:{strategy['digest']}:{board_id}"
    require(marker in item['prompt'],'BOARD_PLAN_BINDING')
    raw,evidence=load_verified_image(raw_path,board['canvas'])
    require(evidence['sha256']==receipt['raw_sha256'],'BOARD_RAW_CHANGED')
    if item['output_mode']=='transparent_component':
        require(evidence['mode']=='RGBA','BOARD_NATIVE_ALPHA_REQUIRED')
    parts,rows=crop_board(raw,board,item['output_mode'])
    require(not output.exists(),'OUTPUT_EXISTS');output.mkdir(parents=True)
    for row in rows:
        file=output/(row['asset_id']+'.png');parts[row['asset_id']].save(file)
        row.update(path=file.name,sha256=sha256(file))
    report={'kind':'ai_ui_component_board_extraction_v1','strategy_digest':strategy['digest'],
            'board':board_id,'batch_digest':frozen['digest'],'request_sha256':frozen['requests'][asset]['request_sha256'],
            'raw_sha256':receipt['raw_sha256'],'source_size':list(raw.size),'parts':rows,
            'generation_calls':0,'human_visual_acceptance':False,'runtime_acceptance':'not_performed'}
    report['digest']=digest(report);write_json(output/'extraction.json',report)
    return report


def main():
    parser=argparse.ArgumentParser(description=__doc__);commands=parser.add_subparsers(dest='command',required=True)
    plan=commands.add_parser('plan');plan.add_argument('--input',type=Path,required=True);plan.add_argument('--output',type=Path,required=True)
    crop=commands.add_parser('extract')
    for name in ('run','strategy','output'):crop.add_argument('--'+name,type=Path,required=True)
    for name in ('asset','board'):crop.add_argument('--'+name,required=True)
    args=parser.parse_args()
    if args.command=='plan':
        result=plan_boards(read_json(args.input));write_json(args.output,result)
    else:result=extract(args.run,args.asset,args.strategy,args.board,args.output)
    print(json.dumps(result,ensure_ascii=False,indent=2))


if __name__=='__main__':main()
