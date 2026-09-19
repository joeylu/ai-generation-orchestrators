"""Pure-asset board compilation and materialization; no semantic UI consumer."""
from copy import deepcopy
from pathlib import Path
import shutil
from .common import digest, identifier, read_json, write_json, require, sha256, safe_relative
from .contract import validate
from .component_boards import plan_boards, extract, verify_strategy
from . import batch


def compile_boards(plan_path, groups_path, output):
    plan_path=Path(plan_path).resolve();output=Path(output).resolve()
    original=read_json(plan_path);validate(original,source_base=plan_path.parent)
    require(original['document']['format']=='png_zip','PNG_ZIP_PLAN_REQUIRED')
    require(all(a['route'].startswith('generated_') and 'cached_result' not in a for a in original['assets']), 'ASSET_BOARDS_GENERATED_PLAN_REQUIRED')
    spec=read_json(groups_path)
    require(set(spec)=={'kind','groups'} and spec['kind']=='ui_assets_board_groups_v1' and isinstance(spec['groups'],list) and spec['groups'],'ASSET_BOARD_GROUPS_SCHEMA')
    require(not output.exists(),'OUTPUT_EXISTS')
    index={a['id']:a for a in original['assets']};used=set();strategies={};groups_seen=set()
    for group in spec['groups']:
        require(set(group)=={'id','assetIds','packingCanvas','extractionPolicy'},'ASSET_BOARD_GROUP_FIELDS')
        key=identifier(group['id']);identifier('board-'+key);ids=group['assetIds']
        require(key not in groups_seen and 'board-'+key not in index,'ASSET_BOARD_ID_COLLISION');groups_seen.add(key)
        require(isinstance(ids,list) and 2<=len(ids)<=16 and len(set(ids))==len(ids) and not used.intersection(ids),'ASSET_BOARD_MEMBER_DUPLICATE')
        require(all(i in index and index[i]['role']=='important_component' and index[i]['output_mode']=='keyed_component' and 'resize' not in index[i] for i in ids),'ASSET_BOARD_MEMBER_UNSUPPORTED')
        sizes=[index[i]['output_size'] for i in ids]
        require(all(max(s[axis] for s in sizes)<=2*min(s[axis] for s in sizes) for axis in [0,1]),'ASSET_BOARD_SIMILAR_SIZE_REQUIRED')
        observations=dict(kind='ai_ui_material_observations_v2',strategy='component-family-board-v1',
            packing_canvas=group['packingCanvas'],extraction_policy=group['extractionPolicy'],
            assets=[dict(id=i,component_type='Image',component_group=key,target_size=index[i]['output_size'],source_reusable=False,source_evidence='') for i in ids])
        strategies[key]=plan_boards(observations);used.update(ids)
    output.mkdir(parents=True)
    shutil.copyfile(safe_relative(plan_path.parent,original['source']['path']),output/'reference.png')
    target=deepcopy(original);target['source']['path']='reference.png'
    target_digest=digest(target)
    generation=deepcopy(target)
    generation['assets']=[deepcopy(a) for a in target['assets'] if a['id'] not in used]
    strategy_refs={};parts=[]
    for a in generation['assets']:
        a['prompt']+=' asset-delivery-plan-v1:'+target_digest
        parts.append(dict(assetId=a['id'],generationAsset=a['id'],board=None))
    for key,strategy in strategies.items():
        path='strategy-'+key+'.json';write_json(output/path,strategy)
        strategy_refs[key]=dict(path=path,digest=strategy['digest'])
        board=strategy['boards'][0]
        prompt=f"component-family-board-v1:{strategy['digest']}:{key} component-family-relative-cell-v1. asset-delivery-plan-v1:{target_digest}. Generate one {board['canvas'][0]}x{board['canvas'][1]} board. "
        if board['extraction_policy'].get('canvas_policy')=='content-bounds':
            prompt+='component-family-content-gap-v1.1. Planned canvas/windows are guidance; use one horizontal row in declared order with wide empty key-color gutters. '
        for slot in board['slots']:
            a=index[slot['asset_id']]
            prompt+=f"Part {a['id']} in search window {slot['search_window']} (left top right bottom), suggested drawing rectangle {slot['crop']} (left top width height), target aspect ratio {slot['target_size'][0]}:{slot['target_size'][1]}, reference rectangle {a['source_region']} (left top right bottom): {a['prompt']} "
            parts.append(dict(assetId=a['id'],generationAsset='board-'+key,board=key))
        prompt+='Individual part exclusions apply only inside that part, not to artwork owned by another board slot. '
        prompt+='Each window owns one complete named part. Search windows are isolation boundaries, not shapes to fill. Center each part inside its suggested drawing rectangle, preserve its target aspect ratio and leave unused space empty; never stretch a part to fill a window. These board placement instructions override any standalone canvas placement in individual part descriptions. Keep wide empty gutters; uniform #F808F8 background, no labels or checkerboard. Preserve each part silhouette and proportions.'
        generation['assets'].append(dict(id='board-'+key,role='important_component',route='generated_isolation',source_region=[0,0,*target['canvas']],output_size=target['canvas'],output_mode='keyed_component',prompt=prompt,source_asset=None))
    generation['nodes']=[dict(id=a['id'],asset=a['id'],xy=[0,0]) for a in generation['assets']]
    generation['groups']=[dict(id='generation-only',children=[n['id'] for n in generation['nodes']])]
    if 'reference_coverage' in target:
        from .reference_coverage import remap
        generation['reference_coverage']=remap(target['reference_coverage'],{r['assetId']:r['generationAsset'] for r in parts})
    validate(generation,source_base=output)
    write_json(output/'target-plan.json',target);write_json(output/'plan.json',generation)
    catalog=dict(kind='ui_assets_board_catalog_v1',targetPlanDigest=target_digest,generationPlanDigest=digest(generation),strategies=strategy_refs,parts=parts)
    catalog['digest']=digest(catalog);write_json(output/'material-catalog.json',catalog)
    return dict(status='compiled_no_generation',generatedRequests=len(generation['assets']),finalLayers=len(target['nodes']),planDigest=digest(generation),targetPlanDigest=target_digest)


def verify(compiled,run=None):
    compiled=Path(compiled).resolve();catalog=read_json(compiled/'material-catalog.json')
    require(catalog.get('kind')=='ui_assets_board_catalog_v1' and catalog.get('digest')==digest({k:v for k,v in catalog.items() if k!='digest'}),'ASSET_BOARD_CATALOG_CHANGED')
    target=read_json(compiled/'target-plan.json');generation=read_json(compiled/'plan.json')
    validate(target,source_base=compiled);validate(generation,source_base=compiled)
    require(digest(target)==catalog['targetPlanDigest'] and digest(generation)==catalog['generationPlanDigest'],'ASSET_BOARD_PLAN_CHANGED')
    require(all('asset-delivery-plan-v1:'+digest(target) in a['prompt'] for a in generation['assets']),'ASSET_BOARD_TARGET_BINDING')
    parts={};generation_ids={a['id'] for a in generation['assets']}
    for key,ref in catalog['strategies'].items():
        strategy=read_json(safe_relative(compiled,ref['path']));verify_strategy(strategy)
        require(strategy['digest']==ref['digest'],'BOARD_STRATEGY_CHANGED')
        board=next(b for b in strategy['boards'] if b['id']==key)
        asset=next(a for a in generation['assets'] if a['id']=='board-'+key)
        require(f"component-family-board-v1:{strategy['digest']}:{key}" in asset['prompt'],'BOARD_PLAN_BINDING')
        for slot in board['slots']:
            require(slot['asset_id'] not in parts,'ASSET_BOARD_MEMBER_DUPLICATE')
            parts[slot['asset_id']]=(asset['id'],key,slot['target_size'])
    target_ids={a['id'] for a in target['assets']}
    require(len(catalog['parts'])==len(target_ids) and {r['assetId'] for r in catalog['parts']}==target_ids,'ASSET_BOARD_PART_COVERAGE')
    for row in catalog['parts']:
        a=next(a for a in target['assets'] if a['id']==row['assetId'])
        if row['board'] is None:
            require(row['assetId']==row['generationAsset'] and row['assetId'] in generation_ids and row['assetId'] not in parts,'ASSET_BOARD_SINGLE_BINDING')
        else:require(parts.get(row['assetId'])==(row['generationAsset'],row['board'],a['output_size']),'ASSET_BOARD_PART_BINDING')
    if run is not None:
        frozen,actual=batch.load(Path(run).resolve())
        require(digest(actual)==digest(generation),'ASSET_BOARD_BATCH_CHANGED')
    return compiled,catalog,target,generation


def freeze(compiled,workspace,run_id):
    compiled,_,_,_=verify(compiled)
    return batch.freeze(compiled/'plan.json',Path(workspace),run_id,material_preflight='after-generation-v1')


def preflight(compiled,run,output):
    from .material_preflight import check_batch
    compiled,_,_,_=verify(compiled,run)
    return check_batch(compiled,Path(run).resolve(),Path(output),verify_all_board_parts=True)


def materialize(compiled,run,output):
    from .process import process,read_materials
    from .cached import verified_result
    compiled,catalog,target,_=verify(compiled,run);run=Path(run).resolve();output=Path(output).resolve()
    require(not output.exists(),'OUTPUT_EXISTS')
    # All quality and source receipts must pass before any extraction output.
    for key in {r['generationAsset'] for r in catalog['parts']}:verified_result(run,key)
    output.mkdir(parents=True);paths={};lineage=[]
    for key,ref in catalog['strategies'].items():
        result=extract(run,'board-'+key,safe_relative(compiled,ref['path']),key,output/('extracted-'+key))
        lineage.append(dict(board=key,extractionDigest=result['digest'],rawSha256=result['raw_sha256']))
        paths.update({r['asset_id']:output/('extracted-'+key)/r['path'] for r in result['parts']})
    if not (run/'materials').exists():process(run)
    materials=read_materials(run)
    frozen,generation=batch.load(run)
    require(materials['batch_digest']==frozen['digest'] and materials['plan_digest']==digest(generation),'ASSET_BOARD_MATERIALS_CHANGED')
    for row in catalog['parts']:
        if row['board'] is None:
            material=next(m for m in materials['assets'] if m['asset']==row['generationAsset'])
            paths[row['assetId']]=safe_relative(run,material['path'])
    return _publish(compiled,run,output,catalog,target,paths,lineage)


def recover(compiled,run,specification,output,*,materials_only=False):
    """Reproduce reviewed transforms without changing original quality receipts."""
    from .reviewed_recovery import prepare_materials
    compiled,catalog,target,_=verify(compiled,run)
    run,output=Path(run).resolve(),Path(output).resolve()
    require(not output.exists(),'OUTPUT_EXISTS')
    index={a['id']:a for a in target['assets']}
    recovery_catalog=deepcopy(catalog)
    recovery_catalog['parts']=[dict(row,layerId=row['assetId'],rect=[0,0,*index[row['assetId']]['output_size']]) for row in catalog['parts']]
    if materials_only:
        selected=specification.get('revisions',{})
        require(isinstance(selected,dict) and selected and set(selected)<={r['generationAsset'] for r in catalog['parts']},'RECOVERY_UNKNOWN_ASSET')
        recovery_catalog['parts']=[r for r in recovery_catalog['parts'] if r['generationAsset'] in selected]
    paths,record=prepare_materials(compiled,run,specification,output,catalog=recovery_catalog)
    if materials_only:
        return dict(status='partial_materials_recovered',generationCalls=0,human_visual_acceptance=False,
            recoveredAssets=sorted(paths),remainingAssets=sorted(set(index)-set(paths)),
            lineageDigest=record['digest'],completePackage=False)
    return _publish(compiled,run,output,catalog,target,paths,[],recovery=record)


def _publish(compiled,run,output,catalog,target,paths,lineage,*,recovery=None):
    from .process import process
    project=output/'project';project.mkdir();shutil.copyfile(compiled/'reference.png',project/'reference.png')
    derived=deepcopy(target)
    for a in derived['assets']:
        source=paths[a['id']];dest=project/'inputs'/(a['id']+'.png');dest.parent.mkdir(exist_ok=True)
        shutil.copyfile(source,dest)
        for field in ['resize','foreground_support']:a.pop(field,None)
        a.update(route='imported_material',output_mode='opaque_canvas' if a['role']=='background' else 'rgba',prompt='',source_asset=None,
            material_source=dict(path=dest.relative_to(project).as_posix(),sha256=sha256(dest)))
    write_json(project/'plan.json',derived)
    frozen=batch.freeze(project/'plan.json',output/'workspace','materialized')
    destination=output/'workspace/runs/materialized';process(destination)
    report=dict(kind='ui_assets_board_materialization_v1',sourceBatchDigest=batch.load(run)[0]['digest'],catalogDigest=catalog['digest'],
        targetPlanDigest=digest(target),materializedBatchDigest=frozen['digest'],extractions=lineage,
        sourceMaterials=[dict(assetId=k,sha256=sha256(v)) for k,v in paths.items()],generationCalls=0,human_visual_acceptance=False)
    if recovery is not None:
        report['reviewedRecovery']=dict(path='recovery-lineage.json',digest=recovery['digest'],originalQualityUnchanged=True)
    report['digest']=digest(report);write_json(output/'lineage.json',report)
    return dict(status='materials_ready_for_review',runDirectory=str(destination),lineageDigest=report['digest'],generationCalls=0)
