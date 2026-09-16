"""Frozen component-board geometry gate, shared by file and provider transports."""
from .common import read_json,safe_relative,require,load_verified_image
from .component_boards import verify_strategy,validate_canvas_size


def board_for(compiled,asset):
    catalog=read_json(compiled/'material-catalog.json')
    matches=[(group,ref) for group,ref in catalog['strategies'].items() if 'board-'+group==asset]
    if not matches:return None
    group,ref=matches[0];strategy=read_json(safe_relative(compiled,ref['path']));verify_strategy(strategy)
    require(strategy['digest']==ref['digest'],'BOARD_STRATEGY_CHANGED')
    plan=read_json(compiled/'plan.json');item=next(a for a in plan['assets'] if a['id']==asset)
    require(f"component-family-board-v1:{strategy['digest']}:{group}" in item['prompt'],'BOARD_PLAN_BINDING')
    return next(b for b in strategy['boards'] if b['id']==group)


def check_material(compiled,asset,source):
    board=board_for(compiled,asset)
    if board is None:return
    picture,_=load_verified_image(source)
    validate_canvas_size(picture.size,board)
    if board.get('extraction_policy',{}).get('version') in {'1.1','1.2'}:
        # Content-based canvas policy must check actual content at ingestion,
        # before accepting this result or dispatching the next media request.
        from .component_boards import crop_board
        crop_board(picture,board,'keyed_component')
