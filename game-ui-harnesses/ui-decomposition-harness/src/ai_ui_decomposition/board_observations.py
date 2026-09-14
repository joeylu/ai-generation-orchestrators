"""Receipt-bound offline extraction using explicit agent-observed part identities.

No automatic semantic reassignment and no change to a frozen grid or its result.
"""
from pathlib import Path
import hashlib
import numpy as np
from PIL import Image
from .asset_board import _component_rows
from .cached import verified_result
from .component_boards import verify_strategy,crop_board
from .common import ContractError,read_json,write_json,require,digest,sha256,load_verified_image
from .media import matte_key,nine_slice,normalize,require_long_control_geometry


def _resize_recipe(value, target_size):
    """Validate the explicit observation-only nine-slice recipe."""
    require(isinstance(value, dict) and
            set(value) <= {'mode', 'insets', 'fitSize'} and
            {'mode', 'insets'} <= set(value), 'OBSERVED_BOARD_RESIZE_FIELDS')
    require(value['mode'] == 'nine_slice', 'OBSERVED_BOARD_RESIZE_MODE')
    insets = value['insets']
    require(isinstance(insets, list) and len(insets) == 4 and
            all(type(item) is int and item > 0 for item in insets),
            'OBSERVED_BOARD_RESIZE_INSETS')
    require(target_size[0] > insets[0] + insets[2] and
            target_size[1] > insets[1] + insets[3], 'RESIZE_TARGET_TOO_SMALL')
    fit_size = value.get('fitSize', list(target_size))
    require(isinstance(fit_size, list) and len(fit_size) == 2 and
            all(type(item) is int and item > 0 for item in fit_size) and
            min(fit_size) > 4 and
            all(fit_size[index] <= target_size[index] for index in range(2)),
            'OBSERVED_BOARD_RESIZE_FIT_SIZE')
    return list(insets), list(fit_size)


def _alpha_evidence(image):
    channel = image.getchannel('A')
    bounds = channel.getbbox()
    return {'size': list(image.size),
            'alpha_extrema': list(channel.getextrema()),
            'alpha_bbox': list(bounds) if bounds is not None else None}


def analyze(run,asset,strategy_path,board_id):
    strategy=read_json(strategy_path);verify_strategy(strategy)
    bs=[b for b in strategy['boards'] if b['id']==board_id];require(len(bs)==1,'BOARD_NOT_FOUND');board=bs[0]
    frozen,item,receipt,path=verified_result(run,asset)
    require(item['output_mode']=='keyed_component','OBSERVED_BOARD_KEY_REQUIRED')
    require(f"component-family-board-v1:{strategy['digest']}:{board_id}" in item['prompt'],'BOARD_PLAN_BINDING')
    raw,_=load_verified_image(path)
    try:crop_board(raw,board,item['output_mode'])
    except ContractError as exc:error=str(exc)
    else:error=None
    matte=matte_key(raw,list(raw.size))
    candidates,minimum,ignored=_component_rows(np.asarray(matte)[:,:,3])
    require(ignored==0,'OBSERVED_BOARD_UNASSIGNED_SPECKS')
    report={'kind':'ai_ui_board_candidates_v1','batch_digest':frozen['digest'],'asset':asset,'board':board_id,
            'strategy_digest':strategy['digest'],'request_sha256':frozen['requests'][asset]['request_sha256'],
            'raw_sha256':receipt['raw_sha256'],'source_size':list(raw.size),'original_extraction_error':error,
            'coordinate_space':'deterministic-whole-board-matte','matte_pixel_sha256':hashlib.sha256(matte.tobytes()).hexdigest(),
            'candidates':candidates,'minimum_area':minimum,'ignored_area':ignored,'generation_calls':0,
            'human_visual_acceptance':False}
    report['digest']=digest(report)
    return report,matte,board


def extract(run,strategy_path,observations_path,output):
    obs=read_json(observations_path)
    require(isinstance(obs,dict) and set(obs)=={'kind','version','asset','board','candidate_digest','parts'} and
            obs['kind']=='ai_ui_board_part_observations_v1' and obs['version']=='1.0','OBSERVED_BOARD_SCHEMA')
    analysis,matte,board=analyze(run,obs['asset'],strategy_path,obs['board'])
    require(obs['candidate_digest']==analysis['digest'],'OBSERVED_BOARD_SOURCE_CHANGED')
    slots={s['asset_id']:s for s in board['slots']};assigned=[];rows=[];parts={}
    require(isinstance(obs['parts'],list) and len(obs['parts'])==len(slots),'OBSERVED_BOARD_PART_COVERAGE')
    seen=set();rects=[]
    for p in obs['parts']:
        require(isinstance(p,dict) and set(p) <= {'asset_id','candidate_indices','evidence','resize'} and
                {'asset_id','candidate_indices','evidence'} <= set(p) and
                p['asset_id'] in slots and p['asset_id'] not in seen,'OBSERVED_BOARD_PART_ID')
        seen.add(p['asset_id']);indices=p['candidate_indices'];proof=p['evidence']
        require(isinstance(proof,str) and bool(proof.strip()),'OBSERVED_BOARD_SEMANTIC_EVIDENCE')
        require(isinstance(indices,list) and indices and all(type(i) is int and 0<=i<len(analysis['candidates']) for i in indices),
                'OBSERVED_BOARD_CANDIDATE_REF')
        assigned.extend(indices);boxes=[analysis['candidates'][i]['bbox'] for i in indices]
        box=[max(0,min(b[0] for b in boxes)-4),max(0,min(b[1] for b in boxes)-4),
             min(matte.width,max(b[2] for b in boxes)+4),min(matte.height,max(b[3] for b in boxes)+4)]
        require(all(box[2]<=r[0] or r[2]<=box[0] or box[3]<=r[1] or r[3]<=box[1] for r in rects),'OBSERVED_BOARD_OVERLAP');rects.append(box)
        source=matte.crop(box);bounds=source.getchannel('A').getbbox();require(bounds is not None,'OBSERVED_BOARD_EMPTY')
        source=source.crop(bounds);tw,th=slots[p['asset_id']]['target_size'];padding=2
        require(min(tw,th)>4,'OBSERVED_BOARD_TARGET_SIZE')
        resize=p.get('resize')
        resize_insets=resize_fit_size=None
        before=_alpha_evidence(source)
        if resize is not None:
            resize_insets,resize_fit_size=_resize_recipe(resize,[tw,th])
            scale=min((resize_fit_size[0]-2*padding)/source.width,
                      (resize_fit_size[1]-2*padding)/source.height)
            size=[max(1,round(source.width*scale)),max(1,round(source.height*scale))]
            offset=[(resize_fit_size[0]-size[0])//2,
                    (resize_fit_size[1]-size[1])//2]
            fitted=Image.new('RGBA',tuple(resize_fit_size))
            fitted.paste(source.resize(size,Image.Resampling.LANCZOS),tuple(offset))
            fitted=normalize(fitted)
            require(fitted.getchannel('A').getbbox() is not None,'OBSERVED_BOARD_EMPTY')
            part=nine_slice(fitted,[tw,th],resize_insets,preserve_alpha_margin=True)
        else:
            scale=min((tw-4)/source.width,(th-4)/source.height);size=[max(1,round(source.width*scale)),max(1,round(source.height*scale))]
            offset=[(tw-size[0])//2,(th-size[1])//2];part=Image.new('RGBA',(tw,th))
            part.paste(source.resize(size,Image.Resampling.LANCZOS),tuple(offset));part=normalize(part)
        require(part.getchannel('A').getextrema()==(0,255),'OBSERVED_BOARD_ALPHA')
        if resize is None:
            require_long_control_geometry(part,[tw,th],{'insets':[padding]*4})
        else:
            require_long_control_geometry(part,[tw,th])
        parts[p['asset_id']]=part
        row={'asset_id':p['asset_id'],'candidate_indices':indices,'evidence':proof,'matte_board_crop':box,
             'target_size':[tw,th],'uniform_scale':scale,'resampled_size':size,'target_offset':offset,
             'alpha_bbox':list(part.getchannel('A').getbbox()),
             'original_extraction_error':analysis['original_extraction_error']}
        if resize is not None:
            fitted_evidence=_alpha_evidence(fitted)
            after=_alpha_evidence(part)
            row.update({'resize':{'mode':'nine_slice','insets':list(resize_insets),
                                  'fitSize':list(resize_fit_size)},
                        'resize_before':before,'resize_fitted':fitted_evidence,
                        'resize_after':after,
                        'resize_before_size':before['size'],
                        'resize_before_alpha_extrema':before['alpha_extrema'],
                        'resize_before_alpha_bbox':before['alpha_bbox'],
                        'resize_after_size':after['size'],
                        'resize_after_alpha_extrema':after['alpha_extrema'],
                        'resize_after_alpha_bbox':after['alpha_bbox']})
        rows.append(row)
    require(sorted(assigned)==list(range(len(analysis['candidates']))),'OBSERVED_BOARD_CANDIDATE_COVERAGE')
    require(not output.exists(),'OUTPUT_EXISTS');output.mkdir(parents=True)
    matte.save(output/'matte-board.png');write_json(output/'candidates.json',analysis);write_json(output/'observations.json',obs)
    for row in rows:
        path=output/(row['asset_id']+'.png');parts[row['asset_id']].save(path);row.update(path=path.name,sha256=sha256(path))
    report={'kind':'ai_ui_observed_board_extraction_v1','analysis_digest':analysis['digest'],'observations_sha256':sha256(observations_path),
            'raw_sha256':analysis['raw_sha256'],'original_extraction_error':analysis['original_extraction_error'],
            'parts':rows,'generation_calls':0,'human_visual_acceptance':False,'semantic_evidence':'agent observation; not human acceptance',
            'runtime_acceptance':'not_performed'}
    report['digest']=digest(report);write_json(output/'extraction.json',report);return report
