"""Explicit offline re-materialization of a received batch; never generation.

Failed quality remains failed. Only named, hash-bound reviewed transformations
may replace the original extraction decision in a fresh lineage-bearing output.
"""
import argparse
from pathlib import Path
from PIL import Image
from .common import read_json, write_json, require, sha256, digest, safe_relative
from .cached import _verified_result
from .shared_materials import generated_rows
from .media import normalize, matte_key, opaque_exact, contain, resize_material, require_long_control_geometry


def preserve_canvas_alpha(image, size):
    require(image.mode == 'RGBA', 'RECOVERY_NATIVE_ALPHA_REQUIRED')
    low, high = image.getchannel('A').getextrema()
    require(low == 0 and high > 0,
            'RECOVERY_NATIVE_ALPHA_REQUIRED')
    # Retain the entire returned canvas, including any existing edge defects.
    # No support crop, key-color inference, thresholding or edge reconstruction.
    source = normalize(image)
    source.thumbnail(tuple(size), Image.Resampling.LANCZOS)
    result = Image.new('RGBA', tuple(size))
    result.paste(source, ((size[0]-source.width)//2, (size[1]-source.height)//2))
    return normalize(result)


def prepare_materials(compiled, run, specification, output, *, catalog=None):
    compiled, run, output = Path(compiled), Path(run), Path(output)
    require(not output.exists(), 'OUTPUT_EXISTS')
    require(isinstance(specification, dict) and set(specification) ==
            {'version', 'batchDigest', 'revisions'} and specification['version'] == '1.0',
            'RECOVERY_SPECIFICATION')
    revisions = specification['revisions']
    require(isinstance(revisions, dict) and revisions, 'RECOVERY_REVISIONS_REQUIRED')
    catalog = read_json(compiled/'material-catalog.json') if catalog is None else catalog
    plan = read_json(compiled/'plan.json')
    from .batch import load
    _,source_plan=load(run)
    rows = generated_rows(catalog['parts'])
    keys = {r['generationAsset'] for r in rows}
    require(set(revisions) <= keys, 'RECOVERY_UNKNOWN_ASSET')
    verified = {}; replacements = {}
    for key in sorted(keys):
        revision = revisions.get(key)
        errors = set()
        if revision is not None:
            require(isinstance(revision, dict) and {'kind','rawSha256','reason'} <= set(revision), 'RECOVERY_REVISION_FIELDS')
            require(isinstance(revision['reason'], str) and revision['reason'].strip(), 'RECOVERY_REASON_REQUIRED')
            if revision['kind'] == 'board-regions':
                require(set(revision) <= {'kind','rawSha256','reason','sourceRegions','sourceAlpha','measuredFrames'} and 'sourceRegions' in revision, 'RECOVERY_REVISION_FIELDS')
                errors = {'BOARD_GAP_AMBIGUOUS_SEPARATION', 'BOARD_GAP_COUNT_OR_JOINED', 'BOARD_GAP_MULTIPLE_ROWS'}
                errors.update('BOARD_GAP_PART_ASPECT:'+r['layerId'] for r in rows if r['generationAsset']==key)
                # Explicit regions revalidate full coverage and clear borders instead
                # of relying on a generated canvas ratio or the old search windows.
                errors.add('BOARD_RELATIVE_CANVAS_ASPECT')
                errors.update('BOARD_CELL_EDGE_CLIPPED:'+r['layerId'] for r in rows if r['generationAsset']==key)
                if revision.get('sourceAlpha') == 'preserve':
                    errors |= {'BOARD_KEY_BACKGROUND_REQUIRED', 'KEY_BACKGROUND_REQUIRED'}
            elif revision['kind'] == 'native-alpha-canvas':
                require(set(revision) == {'kind','rawSha256','reason','sourceAlphaExtrema'}, 'RECOVERY_REVISION_FIELDS')
                errors = {'KEY_BACKGROUND_REQUIRED'}
            elif revision['kind'] == 'processed-frame-refit':
                require(set(revision)=={'kind','rawSha256','reason','recipe'} and
                        revision['recipe'].get('operation')=='visible-frame-nine-slice', 'RECOVERY_REVISION_FIELDS')
                errors = {'LONG_CONTROL_SUPPORT_ASPECT_MISMATCH'}
            elif revision['kind'] == 'processed-ornament-refit':
                require(set(revision)=={'kind','rawSha256','reason','recipe'} and
                        isinstance(revision['recipe'],dict) and
                        revision['recipe'].get('operation')=='visible-horizontal-band-fit','RECOVERY_REVISION_FIELDS')
                errors = {'LONG_CONTROL_SUPPORT_ASPECT_MISMATCH'}
            elif revision['kind'] == 'verified-replacement-source':
                require(set(revision)=={'kind','rawSha256','reason','sourceRunDirectory','sourceAsset','sourceBatchDigest','sourceRawSha256'},'RECOVERY_REVISION_FIELDS')
                require(all(r['board'] is None for r in rows if r['generationAsset']==key),'RECOVERY_REPLACEMENT_SINGLE_REQUIRED')
                errors = {'LONG_CONTROL_SUPPORT_ASPECT_MISMATCH'}
            else:
                raise ValueError('RECOVERY_REVISION_KIND')
        frozen, item, receipt, raw = _verified_result(run, key, revision_errors=errors)
        require(receipt.get('kind') == 'ai_ui_decomposition_request_received_v1',
                'RECOVERY_ORIGINAL_RECEIVED_REQUIRED')
        require(frozen['digest'] == specification['batchDigest'], 'RECOVERY_BATCH_CHANGED')
        # The frozen input is normalized PNG; compare original source bindings,
        # while batch.load independently verifies the normalized input bytes.
        require(plan['source']['sha256'] == source_plan['source']['sha256'], 'RECOVERY_REFERENCE_CHANGED')
        target = next(a for a in plan['assets'] if a['id']==key)
        for field in ('prompt','output_size','output_mode','source_region','route','role'):
            require(item[field] == target[field], 'RECOVERY_PLAN_CHANGED')
        if revision:
            require(revision['rawSha256']==sha256(raw), 'RECOVERY_RAW_CHANGED')
        if revision and revision['kind']=='verified-replacement-source':
            from .cached import verified_result
            replacement_run=Path(revision['sourceRunDirectory']).resolve()
            rf,ri,rr,rraw=verified_result(replacement_run,revision['sourceAsset'])
            _,rp=load(replacement_run)
            require(rr['kind']=='ai_ui_decomposition_request_received_v1','RECOVERY_REPLACEMENT_RECEIVED_REQUIRED')
            require(rf['digest']==revision['sourceBatchDigest'] and sha256(rraw)==revision['sourceRawSha256'],'RECOVERY_REPLACEMENT_SOURCE_CHANGED')
            require(rp['source']['sha256']==plan['source']['sha256'],'RECOVERY_REPLACEMENT_REFERENCE_CHANGED')
            require(all(ri[field]==item[field] for field in ('output_size','output_mode','source_region','route','role')) and
                    ri.get('resize')==item.get('resize') and ri.get('foreground_support')==item.get('foreground_support'), 'RECOVERY_REPLACEMENT_GEOMETRY_CHANGED')
            replacements[key]=(rraw,dict(sourceBatchDigest=rf['digest'],sourcePlanDigest=digest(rp),
                sourceAsset=ri['id'],rawSha256=sha256(rraw),receiptSha256=sha256(rraw.parent/'received.json'),
                basis='separately received replacement; original prompt and failed quality retained'))
        verified[key]=(item,receipt,raw)
    output.mkdir(parents=True)
    paths, lineage = {}, []
    for key,(item,receipt,raw) in verified.items():
        targets = [r for r in rows if r['generationAsset']==key]
        board_id = targets[0]['board']
        revision = revisions.get(key)
        evidence = dict(asset=key,rawSha256=sha256(raw),receiptSha256=sha256(raw.parent/'received.json'),
                        generationCalls=0,originalQualityUnchanged=True)
        if (raw.parent/'quality.json').exists():
            evidence['originalQualitySha256']=sha256(raw.parent/'quality.json')
            evidence['originalQualityStatus']=read_json(raw.parent/'quality.json')['status']
        if board_id:
            from .component_boards import verify_strategy,crop_board
            strategy_path = safe_relative(compiled,catalog['strategies'][board_id]['path'])
            strategy = read_json(strategy_path);verify_strategy(strategy)
            require(f"component-family-board-v1:{strategy['digest']}:{board_id}" in item['prompt'], 'BOARD_PLAN_BINDING')
            board = next(b for b in strategy['boards'] if b['id']==board_id)
            if revision:
                require(revision['kind']=='board-regions', 'RECOVERY_BOARD_REVISION_REQUIRED')
                from .board_extraction_revision import revise
                report=revise(raw,strategy_path,board_id,revision['rawSha256'],board['extraction_policy'],
                              revision['reason'],output/('board-'+board_id),revision.get('measuredFrames'),
                              source_regions=revision['sourceRegions'],source_alpha=revision.get('sourceAlpha'))
                paths.update({r['asset_id']:output/('board-'+board_id)/r['path'] for r in report['parts']})
                evidence['revisionReceiptDigest']=report['digest']
            else:
                with Image.open(raw) as picture:parts,_=crop_board(picture,board,item['output_mode'])
                directory=output/('board-'+board_id);directory.mkdir()
                for layer,part in parts.items():
                    paths[layer]=directory/(layer+'.png');part.save(paths[layer])
        else:
            require(len(targets)==1 and targets[0]['rect'][2:]==item['output_size'], 'RECOVERY_TARGET_GEOMETRY')
            if key in replacements:
                raw,replacement_evidence=replacements[key]
                evidence['replacementSource']=replacement_evidence
            with Image.open(raw) as picture:
                if revision and revision['kind']=='native-alpha-canvas':
                    require(picture.mode == 'RGBA' and list(picture.getchannel('A').getextrema()) == revision['sourceAlphaExtrema'], 'RECOVERY_ALPHA_CHANGED')
                    material=preserve_canvas_alpha(picture,item['output_size'])
                    evidence['sourceAlphaExtrema']=list(picture.getchannel('A').getextrema())
                    evidence['sourceAlphaBBox']=list(picture.getchannel('A').getbbox())
                    evidence['edgeDefectsPreserved']=True
                elif item['output_mode']=='keyed_component':material=matte_key(picture,item['output_size'])
                elif item['output_mode']=='opaque_canvas':material=opaque_exact(picture,item['output_size'])
                else:material=contain(picture,item['output_size'])
            if revision and revision['kind'] in {'processed-frame-refit','processed-ornament-refit'}:
                from .material_refit import apply_refit
                prior=output/(key+'-before-refit.png');material.save(prior)
                material, refit_evidence=apply_refit(prior,revision['recipe'],{})
                evidence['processedRefit']=refit_evidence
            if item['route']=='generated_isolation' and 'resize' not in item:
                require_long_control_geometry(material,item['output_size'],item.get('foreground_support'))
            material=normalize(resize_material(material,item))
            path=output/(key+'.png');material.save(path);paths[targets[0]['layerId']]=path
        if revision:evidence['reviewedRevision']=revision
        lineage.append(evidence)
    record=dict(kind='ui_reviewed_material_recovery_v1',specification=specification,sources=lineage,
                generationCalls=0,human_visual_acceptance=False,
                materials={key:dict(path=p.relative_to(output).as_posix(),sha256=sha256(p)) for key,p in paths.items()})
    record['digest']=digest(record);write_json(output/'recovery-lineage.json',record)
    return paths, record


def prepare(compiled, run, specification, output, component_root):
    compiled,output=Path(compiled),Path(output)
    paths,_=prepare_materials(compiled,run,specification,output)
    plan=read_json(compiled/'plan.json')
    from .delivery_adapter import _materialized_handoff
    return _materialized_handoff(compiled,paths,output,component_root,plan)


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    for name in ('compiled','run','specification','output','component-root'):
        parser.add_argument('--'+name,type=Path,required=True)
    args=parser.parse_args()
    print(prepare(args.compiled,args.run,read_json(args.specification),args.output,args.component_root))


if __name__=='__main__':main()
