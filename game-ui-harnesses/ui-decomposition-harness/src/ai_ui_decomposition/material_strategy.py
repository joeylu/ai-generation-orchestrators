"""Choose bounded material request groups from explicit observed geometry."""
from pathlib import Path
from .common import digest, identifier, read_json, require, write_json


def plan_material_strategy(description: dict) -> dict:
    require(set(description) == {'kind','assets'} and description['kind'] == 'ai_ui_material_observations_v1',
            'MATERIAL_OBSERVATIONS_KIND')
    assets = description['assets']
    require(isinstance(assets,list) and 0 < len(assets) <= 128, 'MATERIAL_OBSERVATIONS_ASSETS')
    seen, decisions, boards = set(), [], []
    for asset in assets:
        require(isinstance(asset,dict) and set(asset) == {'id','category','target_size','source_reusable'},
                'MATERIAL_OBSERVATION_FIELDS')
        key = identifier(asset['id'])
        require(key not in seen, 'MATERIAL_OBSERVATION_DUPLICATE')
        seen.add(key)
        size = asset['target_size']
        require(isinstance(size,list) and len(size)==2 and all(type(v) is int and v>0 for v in size),
                'MATERIAL_TARGET_SIZE')
        require(size[0]*size[1] <= 16_777_216,'MATERIAL_TARGET_SIZE')
        category = asset['category']
        require(category in {'icon','panel','track','fill','thumb','control'},'MATERIAL_CATEGORY')
        require(type(asset['source_reusable']) is bool,'SOURCE_REUSABLE_EVIDENCE')
        ratio = max(size)/min(size)
        row = {'id':key,'target_size':size,'preserve_aspect_ratio':True}
        if asset['source_reusable']:
            row.update(route='source_crop',reason='caller_declared_clean_visible_source')
        elif category == 'icon' and ratio <= 2:
            # A board may only combine comparably sized, similarly shaped icons.
            group = next((b for b in boards if len(b['assets']) < 16 and all(
                max(size[axis],s[axis])/min(size[axis],s[axis]) <= 2
                for s in b['sizes'] for axis in (0,1))),None)
            if group is None:
                group = {'id':f'icon-board-{len(boards)+1}','assets':[],'sizes':[]}
                boards.append(group)
            group['assets'].append(key); group['sizes'].append(size)
            row.update(route='icon_board',group=group['id'],reason='similar_icon_geometry')
        else:
            row.update(route='individual',reason='independent_control_geometry',
                       request_support_ratio=f'{size[0]}:{size[1]}')
        decisions.append(row)
    result={'kind':'ai_ui_material_strategy_v1','observations_digest':digest(description),
            'decisions':decisions,'icon_boards':boards,
            'generation_request_count':sum(r['route']=='individual' for r in decisions)+len(boards),
            'generation_calls':0,'automatic_retries':0,'automatic_visual_acceptance':False,
            'constraints':['Never fit a long track or panel into an icon board.',
                'Source reuse is a caller observation, not automatic alpha recovery.',
                'Nine-slice requires separately reviewed empty-surface insets; never inferred.',
                'This is a request strategy, not a generation authorization or execution plan.']}
    result['digest']=digest(result)
    return result


def write_strategy(source: Path, output: Path) -> dict:
    result=plan_material_strategy(read_json(source))
    write_json(output,result)
    return result
