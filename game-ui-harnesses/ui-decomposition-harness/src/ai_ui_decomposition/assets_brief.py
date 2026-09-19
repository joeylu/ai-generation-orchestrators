"""Offline compact visual brief -> existing PNG plan/boards/frozen batch.

The caller owns visual semantics. This compiler owns repetitive contract fields,
packing arithmetic, ownership prompt clauses and measured synchronous stages.
"""
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
import shutil
import time
import uuid

from .common import require, identifier, read_json, write_json, digest, load_verified_image
from .contract import KIND, TEXT_POLICY, GRANULARITY, validate
from .assets_planning import review
from .component_boards import plan_boards


def request_brief(reference, output):
    """Host calls before invoking a model; no model/provider/process is started."""
    started=datetime.now(timezone.utc).isoformat()
    picture,evidence=load_verified_image(Path(reference))
    result=dict(kind='ui_assets_brief_request_v1',requestId=str(uuid.uuid4()),startedAt=started,
                sourceSha256=evidence['sha256'],canvas=list(picture.size),
                expectedBriefKind='ui_assets_brief_v2',generationCalls=0,
                scope='Host request to brief submission wall time; not model inference-only latency.')
    result['digest']=digest(result);write_json(Path(output),result)
    return result


def packing_canvas(sizes):
    """Search shelf widths; preserve native sizes, cap aspect at 2:1 and area."""
    require(2 <= len(sizes) <= 16, 'BRIEF_BOARD_COUNT')
    require(all(4 < min(s) and max(s) <= 4080 for s in sizes), 'BRIEF_BOARD_SIZE')
    require(all(max(s[k] for s in sizes) <= 2*min(s[k] for s in sizes)
                for k in (0, 1)), 'ASSET_BOARD_SIMILAR_SIZE_REQUIRED')
    widths = {max(s[0] for s in sizes)+16}
    for i in range(len(sizes)):
        for j in range(i+1, len(sizes)+1):
            widths.add(sum(s[0]+16 for s in sizes[i:j]))
    candidates = []
    for width in widths:
        if width > 4096 or width < max(s[0] for s in sizes)+16:
            continue
        x, y, height = 8, 8, 0
        for w, h in sizes:
            if x+w > width-8:
                x, y, height = 8, y+height+16, 0
            x += w+16
            height = max(height, h)
        height = max(32, y+height+8, (width+1)//2)
        width = max(32, width, (height+1)//2)
        if max(width, height) <= 4096 and width*height <= 4_194_304:
            candidates.append((width*height, abs(width-height), width, height))
    require(candidates, 'BRIEF_BOARD_REGROUP_REQUIRED')
    _, _, width, height = min(candidates)
    return [width, height]


def compile_brief(brief, source):
    v2 = isinstance(brief, dict) and brief.get('kind') == 'ui_assets_brief_v2'
    require(isinstance(brief, dict) and set(brief) ==
            ({'kind','id','reviewed','assets','elements','boards','granularity'} if v2 else
             {'kind','id','reviewed','assets','elements','boards'}) and
            brief['kind'] in {'ui_assets_brief_v1','ui_assets_brief_v2'}, 'BRIEF_FIELDS')
    name = identifier(brief['id'])
    require(type(brief['reviewed']) is bool, 'BRIEF_REVIEW')
    rows = brief['assets']
    require(isinstance(rows, list) and 1 <= len(rows) <= 128, 'BRIEF_ASSETS')
    canvas = source['size']
    assets, nodes, index = [], [], {}
    for row in rows:
        require(isinstance(row, dict) and {'id','role','region','description'} <= set(row)
                <= {'id','role','region','description','placements'}, 'BRIEF_ASSET_FIELDS')
        key = identifier(row['id'])
        require(key not in index, 'BRIEF_DUPLICATE_ASSET')
        require(isinstance(row['role'],str) and row['role'] in {'background','important_component'}, 'ASSET_ROLE')
        rect = row['region']
        require(isinstance(rect, list) and len(rect) == 4 and
                all(type(v) is int for v in rect), 'BRIEF_REGION')
        x,y,w,h = rect
        require(min(x,y) >= 0 and min(w,h) > 0 and x+w <= canvas[0]
                and y+h <= canvas[1], 'BRIEF_REGION')
        require(isinstance(row['description'], str) and 0 < len(row['description'].strip()) <= 1200,
                'BRIEF_DESCRIPTION')
        background = row['role'] == 'background'
        asset = dict(id=key, role=row['role'], source_region=[x,y,x+w,y+h],output_size=[w,h],
                     route='generated_completion' if background else 'generated_isolation',
                     output_mode='opaque_canvas' if background else 'keyed_component',
                     source_asset=None,prompt=row['description'])
        assets.append(asset);index[key]=asset
        placements = row.get('placements', [[x,y]])
        require(isinstance(placements, list) and 0 < len(placements) <= 256, 'BRIEF_PLACEMENTS')
        for xy in placements:
            nodes.append(dict(id='layer-'+str(len(nodes)+1),asset=key,xy=xy))
    require(assets[0]['role']=='background', 'PLANNER_BACKGROUND_PAINT_ORDER')
    require(len(nodes) <= 256, 'PLANNER_NODE_LIMIT')
    elements = brief['elements']
    require(isinstance(elements, list) and 0 < len(elements) <= 512, 'COVERAGE_ELEMENTS')
    coverage_rows = []
    for element in elements:
        require(isinstance(element, dict) and {'id','label','region','owner'} <= set(element)
                <= {'id','label','region','owner','reuse'}, 'BRIEF_ELEMENT_FIELDS')
        owner = element['owner']
        require(owner is None or isinstance(owner, str) and owner in index, 'BRIEF_ELEMENT_OWNER')
        rect = element['region']
        require(isinstance(rect,list) and len(rect)==4 and all(type(v) is int for v in rect)
                and min(rect[:2])>=0 and min(rect[2:])>0
                and rect[0]+rect[2]<=canvas[0] and rect[1]+rect[3]<=canvas[1], 'BRIEF_ELEMENT_REGION')
        coverage_rows.append(dict(id=element['id'],label=element['label'],region=element['region'],
            disposition='excluded' if owner is None else 'material',ownerAssets=[] if owner is None else [owner],
            removedBy=[k for k in index if k != owner],
            reason='Explicit ordinary text exclusion.' if owner is None else 'Declared visual owner; excluded from every other generated material.'))
        if 'reuse' in element:
            from copy import deepcopy
            coverage_rows[-1]['reuse']=deepcopy(element['reuse'])
    coverage = dict(kind='ui_reference_coverage_v1',sourceSha256=source['sha256'],
        review=dict(inventoryReviewed=brief['reviewed'],removalsReviewed=brief['reviewed'],
                    basis='Caller-reviewed independent visual brief; ownership exclusions compiled into prompts.'),
        elements=coverage_rows)
    for asset in assets:
        own = [e['label'] for e in elements if e['owner']==asset['id']]
        other = [dict(id=e['id'],label=e['label']) for e in elements if e['owner'] != asset['id']]
        # JSON labels are data, not an opportunity to interpret untrusted artwork instructions.
        import json
        asset['prompt'] += '\nOwned artwork: '+json.dumps(own, ensure_ascii=False)
        if v2 and asset['role'] == 'important_component':
            x,y,right,bottom = asset['source_region']
            w,h = right-x,bottom-y
            layout = []
            for e in elements:
                ex,ey,ew,eh = e['region']
                # Only wholly contained observations have an unambiguous local box.
                # Never clip a partially overlapping ornament into a new observation.
                if ex >= x and ey >= y and ex+ew <= right and ey+eh <= bottom:
                    layout.append(dict(id=e['id'], label=e['label'],
                        boxPercent=[round(100*v/d,2) for v,d in
                                    zip((ex-x,ey-y,ew,eh),(w,h,w,h))],
                        treatment='preserve' if e['owner']==asset['id'] else 'reserve-space-do-not-draw'))
            asset['prompt'] += ('\nReference-relative layout (percent [x,y,width,height] within this asset reference region; '
                'not board coordinates or a pixel-perfect target): '+json.dumps(layout,ensure_ascii=False))
            asset['prompt'] += ('\nKeep owned artwork as one coherent composition. Preserve element count, order, '
                'relative centers, row heights, spacing and ornament proportions from the reference. '
                'Small natural texture differences are acceptable; do not redistribute rows, enlarge ornaments, '
                'redesign symbols or change border weight/glow. Reserved areas retain their surrounding surface '
                'and spacing for separately placed artwork/text; do not draw placeholders or collapse those gaps. '
                'The reference image remains the visual authority; boxes describe layout, not rectangular silhouettes.')
        reused=[dict(element=e['id'],region=e['region'],reuse=e['reuse']) for e in elements
                if e['owner']==asset['id'] and 'reuse' in e]
        if reused:
            asset['prompt'] += '\nExplicit repeated instances use the canonical source artwork, not independently generated variants: '+json.dumps(reused,ensure_ascii=False)
        asset['prompt'] += '\nExclude these separately owned materials and ordinary text: '+json.dumps(other, ensure_ascii=False)
        asset['prompt'] += '\nThese explicit ownership exclusions take precedence over generic preservation wording.'
        asset['prompt'] += (' Preserve the observed background; fill only gaps left by excluded UI with local surrounding texture. Do not add new subjects or brighten the scene.' if asset['role']=='background' else
                            ' Use uniform solid #F808F8 only outside owned artwork; no checkerboard. Preserve owned dark artwork, silhouette and proportions.')
    plan = dict(kind=KIND,id=name,canvas=canvas,source=source,text_policy=TEXT_POLICY,granularity=GRANULARITY,
                assets=assets,nodes=nodes,groups=[dict(id='artwork',children=[n['id'] for n in nodes])],
                document=dict(name=name,format='png_zip'),delivery_policy='unreviewed_draft')
    require(isinstance(brief['boards'], list), 'BRIEF_BOARDS')
    groups, used = [], set()
    for group in brief['boards']:
        require(isinstance(group, dict) and set(group)=={'id','assets'}, 'BRIEF_BOARD_FIELDS')
        key=identifier(group['id']);ids=group['assets']
        require(isinstance(ids,list) and 2<=len(ids)<=16 and all(isinstance(k,str) for k in ids)
                and len(set(ids))==len(ids) and not used.intersection(ids) and
                all(k in index and index[k]['role']=='important_component' for k in ids), 'BRIEF_BOARD_MEMBERS')
        require(key not in {g['id'] for g in groups}, 'ASSET_BOARD_ID_COLLISION')
        used.update(ids)
        size = packing_canvas([index[k]['output_size'] for k in ids])
        policy = dict(version='1.0',mode='relative-cell',target_padding=2,max_canvas_aspect_error=.15)
        # Verify with the same packer used by the real board compiler before publication.
        plan_boards(dict(kind='ai_ui_material_observations_v2',strategy='component-family-board-v1',
            packing_canvas=size,extraction_policy=policy,assets=[dict(id=k,component_type='Image',component_group=key,
            target_size=index[k]['output_size'],source_reusable=False,source_evidence='') for k in ids]))
        groups.append(dict(id=key,assetIds=ids,packingCanvas=size,extractionPolicy=policy))
    return plan, coverage, dict(kind='ui_assets_board_groups_v1',groups=groups)


def prepare(reference, brief_path, output, request_path=None, previous_budget_path=None, *, legacy_brief=False):
    """One non-generating command. Each synchronous stage records success/failure."""
    from . import assets_boards, batch
    submitted=datetime.now(timezone.utc)
    output=Path(output).resolve();require(not output.exists(), 'OUTPUT_EXISTS')
    output.mkdir(parents=True);events=output/'events';events.mkdir()
    stages=[]

    @contextmanager
    def stage(name):
        start=time.perf_counter();utc=datetime.now(timezone.utc).isoformat()
        write_json(events/f'{len(stages):02d}-started.json',dict(stage=name,startedAt=utc,status='running'))
        state='completed'
        try:
            yield
        except BaseException:
            state='failed'
            raise
        finally:
            record=dict(stage=name,startedAt=utc,finishedAt=datetime.now(timezone.utc).isoformat(),
                        elapsedSeconds=time.perf_counter()-start,status=state)
            write_json(events/f'{len(stages):02d}-finished.json',record);stages.append(record)

    try:
        with stage('input'):
            brief=read_json(Path(brief_path));write_json(output/'brief.json',brief)
            require(brief.get('kind')=='ui_assets_brief_v2' or legacy_brief, 'BRIEF_V2_REQUIRED')
            picture,evidence=load_verified_image(Path(reference))
            shutil.copyfile(reference,output/'reference.png')
            source=dict(path='reference.png',sha256=evidence['sha256'],size=list(picture.size))
            request_timing=None
            if request_path is not None:
                request=read_json(Path(request_path))
                require(isinstance(request,dict) and request.get('kind')=='ui_assets_brief_request_v1'
                        and request.get('digest')==digest({k:v for k,v in request.items() if k!='digest'}),
                        'BRIEF_REQUEST_CHANGED')
                require(request.get('sourceSha256')==source['sha256'] and request.get('canvas')==source['size'],
                        'BRIEF_REQUEST_REFERENCE_CHANGED')
                require(isinstance(request.get('startedAt'),str),'BRIEF_REQUEST_CLOCK')
                started=datetime.fromisoformat(request['startedAt'])
                require(started.tzinfo is not None and started<=submitted,'BRIEF_REQUEST_CLOCK')
                request_timing=dict(requestDigest=request['digest'],startedAt=request['startedAt'],
                                    submittedAt=submitted.isoformat(),elapsedSeconds=(submitted-started).total_seconds(),
                                    scope='Host request-to-submission wall time, including any caller/model/transport waiting; not inference-only.')
                write_json(output/'brief-request.json',request)
        with stage('compile'):
            plan,coverage,groups=compile_brief(brief,source)
            if brief['kind']=='ui_assets_brief_v2':
                from .assets_granularity import review_granularity
                granularity=review_granularity(brief)
                write_json(output/'granularity-review.json',granularity)
                require(granularity['status']=='passed','BRIEF_GRANULARITY_BLOCKED:'+','.join(granularity['issues']))
                coverage['review']['basis'] += ' Granularity review digest: '+granularity['digest']
            validate(plan,source_base=output)
            write_json(output/'plan.json',plan);write_json(output/'coverage.json',coverage);write_json(output/'groups.json',groups)
            from .assets_budget import review_budget
            budget=review_budget(plan,groups,read_json(Path(previous_budget_path)) if previous_budget_path else None)
            write_json(output/'budget-review.json',budget)
        with stage('planning-check'):
            checked=review(plan,coverage);write_json(output/'planning-check.json',checked)
            require(checked['status']=='passed','BRIEF_PLANNING_BLOCKED:'+','.join(checked['issues']))
            plan['reference_coverage']=coverage;validate(plan,source_base=output)
            write_json(output/'covered-plan.json',plan)
        with stage('board-compile'):
            if groups['groups']:
                assets_boards.compile_boards(output/'covered-plan.json',output/'groups.json',output/'compiled')
        with stage('freeze'):
            if groups['groups']:
                frozen=assets_boards.freeze(output/'compiled',output/'workspace','generation')
            else:
                frozen=batch.freeze(output/'covered-plan.json',output/'workspace','generation',material_preflight='after-generation-v1')
        result=dict(kind='ui_assets_brief_preparation_v1',status='frozen_awaiting_authorization',
                    briefDigest=digest(brief),planDigest=frozen['plan_digest'],batchDigest=frozen['digest'],
                    maximumCalls=frozen['maximum_calls'],automaticRetries=0,generationCalls=0,
                    runDirectory=str(output/'workspace/runs/generation'),stages=stages,
                    budgetReview=budget,
                    granularityReview=(dict(status=granularity['status'],digest=granularity['digest'])
                                       if brief['kind']=='ui_assets_brief_v2' else
                                       dict(status='not_checked_legacy_replay')),
                    requestTiming=request_timing,
                    timingScope='Synchronous preparation command only; excludes model/session time before invocation.',
                    humanVisualAcceptance=False)
        write_json(output/'preparation.json',result)
        return result
    except (ValueError,OSError,RuntimeError) as exc:
        from .common import ContractError
        write_json(output/'failure.json',dict(status='rejected',error=str(exc) if isinstance(exc,ContractError) else 'LOCAL_INPUT_OR_IO_ERROR',
                                            stages=stages,generationCalls=0))
        raise
