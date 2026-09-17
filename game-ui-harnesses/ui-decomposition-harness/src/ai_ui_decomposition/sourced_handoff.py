"""Join explicitly bound completed runs through the existing official handoff builder."""
from pathlib import Path
from .common import require,read_json,write_json,sha256,safe_relative
from .cached import verified_result
from .process import read_materials
from .component_boards import extract
from .delivery_adapter import _materialized_handoff
from .shared_materials import generated_rows


def verify_subset(source_board,target_board):
    require(source_board is not None,'SOURCED_REVISION_BOARD_REQUIRED')
    old_slots={s['asset_id']:s for s in source_board['slots']}
    require(all(s['asset_id'] in old_slots and s['target_size']==old_slots[s['asset_id']]['target_size'] for s in target_board['slots']),'SOURCED_SUBSET_GEOMETRY_CHANGED')


def prepare_from_sources(compiled,sources,output,component_root):
    compiled=Path(compiled);output=Path(output)
    catalog=read_json(compiled/'material-catalog.json');plan=read_json(compiled/'plan.json')
    generated=generated_rows(catalog['parts'])
    expected={r['generationAsset'] for r in generated}
    require(isinstance(sources,dict) and set(sources)==expected,'SOURCED_MATERIAL_COVERAGE')
    derived_rows=[row for row in catalog['parts'] if isinstance(row.get('derivedGlyph'),dict)]
    if derived_rows:
        canonical_layers={row['derivedGlyph']['canonicalLayerId'] for row in derived_rows}
        canonical_assets={row['generationAsset'] for row in catalog['parts']
                          if row['layerId'] in canonical_layers}
        for key in canonical_assets:
            require(isinstance(sources[key],dict) and
                    sources[key].get('expectedRawSha256') is not None,
                    'SOURCED_DERIVED_CANONICAL_RAW_REQUIRED')
    verified={}
    for key,source in sources.items():
        required={'runDirectory','assetId','batchDigest','expectedRawSha256','basis'}
        require(required<=set(source)<=required|{'extractionRevision'},'SOURCED_FIELDS')
        require(isinstance(source['basis'],str) and bool(source['basis'].strip()),'SOURCED_BASIS')
        run=Path(source['runDirectory']).resolve()
        frozen,item,receipt,raw=verified_result(run,source['assetId'])
        recorded=raw.parent/'processing-revision.json'
        if recorded.exists():
            from .common import digest
            r=read_json(recorded)
            require(r.get('digest')==digest({k:v for k,v in r.items() if k!='digest'}) and
                    r.get('batchDigest')==frozen['digest'] and r.get('rawSha256')==sha256(raw) and
                    source.get('extractionRevision')==r.get('specification'),'SOURCED_EXPLICIT_REVISION_REQUIRED')
        require(frozen['digest']==source['batchDigest'],'SOURCED_BATCH_CHANGED')
        require(source['expectedRawSha256'] is None or source['expectedRawSha256']==sha256(raw),'SOURCED_RAW_CHANGED')
        if 'extractionRevision' in source:
            revision=source['extractionRevision']
            require(isinstance(revision,dict) and {'version','originalStrategyDigest','policy','reason'}<=set(revision)<= {'version','originalStrategyDigest','policy','reason','measuredFrames','sourceRegions','sourceStrategy'} and revision['version']=='1.0','SOURCED_REVISION_VERSION')
            require(source['expectedRawSha256'] is not None,'SOURCED_REVISION_RAW_REQUIRED')
            rows=[r for r in generated if r['generationAsset']==key]
            board=rows[0]['board'];require(bool(board),'SOURCED_REVISION_BOARD_REQUIRED')
            from .component_boards import verify_strategy
            strategy=read_json(safe_relative(compiled,catalog['strategies'][board]['path']));verify_strategy(strategy)
            if 'sourceStrategy' in revision:
                source_strategy=revision['sourceStrategy'];verify_strategy(source_strategy)
                source_board=next((b for b in source_strategy['boards'] if b['id']==board),None)
                target_board=next(b for b in strategy['boards'] if b['id']==board)
                verify_subset(source_board,target_board)
                strategy=source_strategy
            require(strategy['digest']==revision['originalStrategyDigest'],'SOURCED_REVISION_STRATEGY_CHANGED')
            require(f"component-family-board-v1:{strategy['digest']}:{board}" in item['prompt'],'BOARD_PLAN_BINDING')
        verified[key]=(run,item,receipt)
    require(not output.exists(),'OUTPUT_EXISTS');output.mkdir(parents=True)
    paths={};lineage=[]
    for key,(run,item,receipt) in verified.items():
        rows=[r for r in generated if r['generationAsset']==key]
        board=rows[0]['board']
        if board:
            strategy=safe_relative(compiled,catalog['strategies'][board]['path'])
            revision=sources[key].get('extractionRevision')
            if revision:
                from .board_extraction_revision import revise
                _,_,_,raw=verified_result(run,sources[key]['assetId'])
                if 'sourceStrategy' in revision:
                    strategy=output/('source-strategy-'+board+'.json');write_json(strategy,revision['sourceStrategy'])
                result=revise(raw,strategy,board,sources[key]['expectedRawSha256'],revision['policy'],revision['reason'],output/('extracted-'+board),revision.get('measuredFrames'),**({'source_regions':revision['sourceRegions']} if 'sourceRegions' in revision else {}))
            else:result=extract(run,sources[key]['assetId'],strategy,board,output/('extracted-'+board))
            found={r['asset_id']:output/('extracted-'+board)/r['path'] for r in result['parts']}
            wanted={r['layerId'] for r in rows}
            require(wanted<=set(found) if revision and 'sourceStrategy' in revision else set(found)==wanted,'SOURCED_PART_COVERAGE')
            paths.update({k:found[k] for k in wanted})
        else:
            materials=read_materials(run)
            require(materials['batch_digest']==sources[key]['batchDigest'],'SOURCED_MATERIAL_BATCH_CHANGED')
            material=next((r for r in materials['assets'] if r['asset']==sources[key]['assetId']),None)
            require(material is not None,'SOURCED_MATERIAL_MISSING')
            require(len(rows)==1 and item['output_size']==rows[0]['rect'][2:],'SOURCED_GEOMETRY_CHANGED')
            paths[rows[0]['layerId']]=safe_relative(run,material['path'])
        lineage.append(dict(target=key,sourceBatchDigest=sources[key]['batchDigest'],sourceAsset=sources[key]['assetId'],
            rawSha256=receipt['raw_sha256'],basis=sources[key]['basis']))
        if sources[key].get('extractionRevision'):
            lineage[-1]['extractionRevision']=dict(specification=sources[key]['extractionRevision'],receiptDigest=result['digest'],receiptPath='extracted-'+board+'/extraction-revision.json')
    write_json(output/'material-lineage.json',dict(kind='ui_material_lineage_v1',sources=lineage,human_visual_acceptance=False))
    return _materialized_handoff(compiled,paths,output,component_root,plan)
