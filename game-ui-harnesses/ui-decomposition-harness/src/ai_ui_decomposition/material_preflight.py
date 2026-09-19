"""Frozen component-board geometry gate, shared by file and provider transports."""
from .common import read_json,safe_relative,require,load_verified_image
from .component_boards import verify_strategy,validate_canvas_size


def check_batch(compiled, run, output, *, verify_all_board_parts=False):
    """Inspect every received image; integrity errors still stop immediately."""
    import time
    import re
    from . import batch
    from .common import sha256, digest, write_json, ContractError
    from .media import require_explicit_key_background
    frozen, plan = batch.load(run)
    if compiled is None:
        require(not any('component-family-board-v1:' in a.get('prompt','') for a in plan['assets']),
                'BOARD_COMPILED_STRATEGY_REQUIRED')
    require(frozen.get('material_preflight') == 'after-generation-v1', 'MATERIAL_PREFLIGHT_MODE')
    require(all(batch.state(run, frozen['requests'][k]) == 'received'
                for k in frozen['dispatch_order']), 'MATERIAL_PREFLIGHT_BATCH_INCOMPLETE')
    started = time.perf_counter()
    rows = []
    for key in frozen['dispatch_order']:
        began = time.perf_counter()
        entry = frozen['requests'][key]
        directory = run/'requests'/entry['id']
        receipt = read_json(directory/'received.json')
        raw = directory/'raw.png'
        picture, evidence = load_verified_image(raw)
        require(receipt.get('batch_digest') == frozen['digest'] and
                receipt.get('asset') == key and receipt.get('request_id') == entry['id'] and
                receipt.get('raw_sha256') == sha256(raw), 'MATERIAL_PREFLIGHT_SOURCE_CHANGED')
        require(all(receipt.get(k) == evidence[k] for k in ('size','mode','bytes','alpha_extrema')),
                'MATERIAL_PREFLIGHT_SOURCE_CHANGED')
        # Resolve and verify the immutable strategy outside the quality exception handler.
        if compiled is not None:
            board_for(compiled, key)
        item = next(a for a in plan['assets'] if a['id'] == key)
        failures = []
        checks = [lambda: batch._require_output_evidence(item, evidence),
                  lambda: check_material(compiled, key, raw) if compiled is not None else check_single_material(item,raw)]
        if item['output_mode'] == 'keyed_component':
            checks.insert(1, lambda: require_explicit_key_background(picture))
        if verify_all_board_parts and compiled is not None:
            from .component_boards import crop_board
            board=board_for(compiled,key)
            if board is not None:
                checks.append(lambda: crop_board(picture,board,item['output_mode']))
        for check in checks:
            try:
                check()
            except ContractError as exc:
                value = str(exc)
                failures.append(value if re.fullmatch(r'[A-Z][A-Z0-9_]*(?::[a-zA-Z0-9_-]+)?', value)
                                else 'MATERIAL_QUALITY_REJECTED')
        row = dict(asset=key, status='failed' if failures else 'passed',
                   errors=list(dict.fromkeys(failures)), rawSha256=sha256(raw),
                   receiptSha256=sha256(directory/'received.json'),
                   elapsedSeconds=time.perf_counter()-began)
        quality = dict(kind='ui_material_quality_v1', batchDigest=frozen['digest'], **row)
        quality['digest'] = digest(quality)
        write_json(directory/'quality.json', quality)
        rows.append(row)
    failed = sum(r['status'] == 'failed' for r in rows)
    report = dict(kind='ui_batch_material_preflight_v1', batchDigest=frozen['digest'],
                  status='failed' if failed else 'passed', checked=len(rows), failed=failed,
                  materials=rows, elapsedSeconds=time.perf_counter()-started,
                  human_visual_acceptance=False, generationCalls=0)
    report['digest'] = digest(report)
    write_json(output, report)
    return report


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
    if board is None:
        # Match the downstream processor's long-control support gate while all
        # returned materials are being checked, rather than failing one later.
        plan=read_json(compiled/'plan.json')
        item=next(a for a in plan['assets'] if a['id']==asset)
        check_single_material(item,source)
        return
    picture,_=load_verified_image(source)
    validate_canvas_size(picture.size,board)
    if board.get('extraction_policy',{}).get('version') in {'1.1','1.2','1.3','1.4','1.5'}:
        # Content-based canvas policy must check actual content at ingestion,
        # before accepting this result or dispatching the next media request.
        from .component_boards import crop_board
        crop_board(picture,board,'keyed_component')


def check_single_material(item,source):
    if item['route']=='generated_isolation' and 'resize' not in item and max(item['output_size'])/min(item['output_size'])>=8:
        from .media import matte_key,contain,require_long_control_geometry
        picture,_=load_verified_image(source)
        material=matte_key(picture,item['output_size']) if item['output_mode']=='keyed_component' else contain(picture,item['output_size'])
        require_long_control_geometry(material,item['output_size'],item.get('foreground_support'))
