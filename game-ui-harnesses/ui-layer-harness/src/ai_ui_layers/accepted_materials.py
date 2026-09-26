"""Package an explicitly accepted preview by replaying its received material variants.

This separate entry point does not upgrade a failed DAG or replace its receipts.
"""
import argparse
import json
from pathlib import Path
import tempfile
from PIL import Image
from .evaluate import read, save, digest
from .freeze_visual import inspect
from .experimental_executor import load_job, status, verified
from .extract_sheets import cells
from .sheet_pixels import prepare
from .adapt_strip import adapt as adapt_strip
from .adapt_frame import adapt as adapt_frame
from .postprocess_visual import process
from .layer_package import write_package, check_composition


def received(job, key, reference_sha):
    config,requests=load_job(job)
    if status(job)['requests'].get(key)!='raw_received':raise ValueError('RECEIVED_REQUEST_REQUIRED')
    folder=job/'attempts'/key
    receipt=verified(folder/'received.json');submission=verified(folder/'submission.json')
    raw=folder/'raw.png'
    if receipt['submissionDigest']!=submission['digest'] or digest(raw)!=receipt['rawSha256']:
        raise ValueError('RECEIPT_MISMATCH')
    if digest(job/'snapshot/reference.png')!=reference_sha:raise ValueError('REFERENCE_MISMATCH')
    return raw,requests[key],dict(jobDigest=config['digest'],snapshotDigest=config['snapshotDigest'],
        submissionDigest=submission['digest'],receiptDigest=receipt['digest'],rawSha256=digest(raw))


def replay(entry, row, placement, role, reference_sha, output):
    job=Path(entry['job']);raw,request,lineage=received(job,entry['requestId'],reference_sha)
    source=raw;output.mkdir()
    if request.get('kind')=='sheet':
        prepared=output/'prepared.png';prepare(raw,prepared)
        mid=entry['sourceMaterialId']
        if mid not in request['materialIds']:raise ValueError('SHEET_MATERIAL_UNKNOWN')
        with Image.open(prepared) as image:
            boxes=cells(image,request,actual_gaps=True);box=boxes[request['materialIds'].index(mid)]
            source=output/'cell.png';image.crop(tuple(box)).save(source)
        lineage.update(sourceMaterialId=mid,cellBox=box,cellSha256=digest(source))
    elif entry['sourceMaterialId']!=entry['requestId']:raise ValueError('SINGLE_MATERIAL_MISMATCH')
    policy=entry.get('adaptationPolicy','preserve')
    if policy!='preserve':
        # Adaptation is a new explicit acceptance choice; never rewrite the old snapshot policy.
        if policy not in ('simple-strip','horizontal-frame-slice'):raise ValueError('ADAPTATION_POLICY')
        fn=adapt_strip if policy=='simple-strip' else adapt_frame
        report=fn(source,digest(source),*placement['outputSize'],output/'adaptation',policy=policy)
        source=output/'adaptation/adapted.png';lineage['adaptation']=report
    if digest(source)!=row['sourceSha256']:raise ValueError('DERIVATION_REPLAY_MISMATCH')
    mode='frame-bounds' if row['report'].get('fitting',{}).get('mode')=='frame-bounds' else 'contain'
    result=process(source,placement['outputSize'],output/'processed',background=role=='background',fit_mode=mode)
    if result['status']!='processed_pending_visual_review':raise ValueError('MATERIAL_GATE_FAILED')
    if result['materialSha256']!=row['report']['materialSha256']:raise ValueError('MATERIAL_REPLAY_MISMATCH')
    lineage['processing']=result
    return output/'processed/material.png',lineage


def build(spec_path, output, viewer, acceptance):
    if not acceptance.strip():raise ValueError('EXPLICIT_ACCEPTANCE_REQUIRED')
    return build_selection(spec_path,output,viewer,acceptance)


def build_selection(spec_path, output, viewer, acceptance=None):
    """Replay an accepted or review-required selection without changing old DAG state."""
    spec_path=Path(spec_path);output=Path(output);spec_sha=digest(spec_path);spec=read(spec_path)
    accepted=acceptance is not None
    kind='ui_accepted_material_selection_v1' if accepted else 'ui_received_variant_selection_v1'
    if spec['kind']!=kind:raise ValueError('SELECTION_KIND')
    if not 1<=len(spec['layers'])<=128:raise ValueError('LAYER_COUNT')
    expected=spec['expectedMaterialIds'];actual=[entry['materialId'] for entry in spec['layers']]
    if len(expected)!=len(set(expected)) or len(actual)!=len(set(actual)) or set(actual)!=set(expected):
        raise ValueError('ACCEPTED_LAYER_SET_MISMATCH')
    preview_key='acceptedPreview' if accepted else 'candidatePreview'
    preview_sha_key=preview_key+'Sha256'
    candidate=Path(spec[preview_key])
    if digest(candidate)!=spec[preview_sha_key]:raise ValueError('CANDIDATE_PREVIEW_CHANGED')
    reference=Path(spec['reference']);reference_sha=digest(reference)
    if reference_sha!=spec['referenceSha256']:raise ValueError('REFERENCE_CHANGED')
    with Image.open(reference) as image:width,height=image.size
    sources={};layers=[];lineage=[];bound={str(spec_path):spec_sha,str(reference):reference_sha,str(candidate):digest(candidate)}
    for evidence in spec.get('evidence',[]):
        path=Path(evidence['path'])
        if digest(path)!=evidence['sha256']:raise ValueError('EVIDENCE_CHANGED')
        bound[str(path)]=evidence['sha256']
    with tempfile.TemporaryDirectory(prefix='ui-accepted-replay-') as tmp:
        for i,entry in enumerate(spec['layers']):
            snapshot=Path(entry['snapshot']);frozen=inspect(snapshot,entry['snapshotDigest'])
            if digest(snapshot/'reference.png')!=reference_sha:raise ValueError('REFERENCE_MISMATCH')
            preview=Path(entry['preview']);report_path=preview/'report.json'
            if digest(report_path)!=entry['previewReportSha256']:raise ValueError('PREVIEW_REPORT_CHANGED')
            report=read(report_path);mid=entry['materialId']
            if Path(mid).name!=mid or mid in sources:raise ValueError('DUPLICATE_OR_UNSAFE_MATERIAL')
            if report['snapshotDigest']!=frozen['digest']:raise ValueError('PREVIEW_SNAPSHOT_MISMATCH')
            rows=[r for r in report['records'] if r['id']==mid]
            if len(rows)!=1 or rows[0]['report']['status']!='processed_pending_visual_review':raise ValueError('PREVIEW_BLOCKED')
            placements=sorted(read(snapshot/'placements.json')['materials'],key=lambda p:p['drawIndex'])
            frozen_ids=[p['id'] for p in placements]
            if frozen_ids!=expected or actual!=expected or len({p['drawIndex'] for p in placements})!=len(placements):
                raise ValueError('FROZEN_LAYER_SET_OR_ORDER_MISMATCH')
            row=rows[0];placement=next(p for p in placements if p['id']==mid)
            if row['xy']!=placement['xy']:raise ValueError('PLACEMENT_MISMATCH')
            visual_path=snapshot/'evidence/revised-visual-plan.json'
            visual=read(visual_path if visual_path.exists() else snapshot/'evidence/m1-draft.json')
            if visual['textPolicy']!=spec['textPolicy'] or visual['backgroundMode']!=spec['backgroundMode']:
                raise ValueError('POLICY_MISMATCH')
            material=next(m for m in visual['materials'] if m['id']==mid)
            path=preview/mid/'material.png'
            if digest(path)!=row['report']['materialSha256'] or digest(Path(row['source']))!=row['sourceSha256']:
                raise ValueError('PREVIEW_MATERIAL_CHANGED')
            replayed,evidence=replay(entry,row,placement,material['role'],reference_sha,Path(tmp)/str(i))
            sources[mid]=dict(path=str(replayed),sha256=digest(replayed))
            layers.append(dict(id=mid,name=material['label'],role=material['role'],path=f'layers/layer-{i+1:03}.png',
                x=row['xy'][0],y=row['xy'][1],width=placement['outputSize'][0],height=placement['outputSize'][1],visible=True))
            lineage.append(dict(materialId=mid,targetSnapshotDigest=frozen['digest'],**evidence))
            bound.update({str(path):digest(path),str(report_path):digest(report_path)})
        composition=dict(kind='ui_layer_composition_v1',canvas=dict(width=width,height=height),coordinates='top-left-pixels',
            order='array-back-to-front',textPolicy=spec['textPolicy'],backgroundMode=spec['backgroundMode'],
            reference='reference.png',preview='preview.png',layers=layers)
        check_composition(composition)
        recomposed=Image.new('RGBA',(width,height))
        for layer in layers:
            with Image.open(sources[layer['id']]['path']) as im:recomposed.alpha_composite(im,(layer['x'],layer['y']))
        with Image.open(candidate) as im:
            if im.size!=recomposed.size or im.convert('RGBA').tobytes()!=recomposed.tobytes():
                raise ValueError('CANDIDATE_COMPOSITION_MISMATCH')
        if any(digest(Path(p))!=sha for p,sha in bound.items()):raise ValueError('INPUT_CHANGED_DURING_REPLAY')
        issues=list(spec['knownDifferences'])
        if not accepted:issues.append('该变体回拼尚待视觉验收；来源重放与技术打包成功不等于视觉通过。')
        result=write_package(reference,composition,sources,output,viewer,issues)
    # Private lineage stays outside the portable ZIP. Public review semantics remain unchanged.
    record=dict(kind='ui_accepted_material_set_v1' if accepted else 'ui_received_variant_replay_v1',
        candidatePreviewSha256=spec[preview_sha_key],selectionSha256=spec_sha,
        verifiedInputs=bound,materials=lineage,packageSha256=result['sha256'],
        candidatePreviewMatched=True,originalDagPromoted=False,humanVisualAcceptance=False,
        generationCalls=0,modelCalls=0)
    if accepted:
        record.update(acceptance=acceptance,acceptedPreviewSha256=spec[preview_sha_key],acceptedPreviewMatched=True)
    record_name='acceptance.json' if accepted else 'variant-provenance.json'
    save(output/record_name,record)
    result.update(candidatePreviewMatched=True,provenanceSha256=digest(output/record_name),
                  originalDagPromoted=False,sourceReceiptReplayPassed=True,sourceJobsCount=len({e['job'] for e in spec['layers']}))
    if accepted:result.update(acceptedPreviewMatched=True,acceptanceRecordSha256=digest(output/record_name))
    save(output/'package-result.json',result)
    return result


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    for name in ('selection','output','viewer','acceptance'):p.add_argument('--'+name,required=True)
    a=p.parse_args();print(json.dumps(build(a.selection,a.output,a.viewer,a.acceptance),ensure_ascii=False,indent=2))
