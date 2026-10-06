"""Prepare instance comparisons from genuine singleton/sheet prototype sources."""
from pathlib import Path
import math, json
from PIL import Image
from .evaluate import read, save, digest
from . import material_reuse as reuse, reuse_pipeline
from .sheet_pixels import prepare as prepare_pixels
from .extract_sheets import cells, _review_variant, prepare_sheet_review


def prepare(snapshot, manifest, row, visual, raw, receipt, job_config, output, doc):
    output.mkdir(parents=True);folder=output/'review';folder.mkdir()
    (output/'materials').mkdir()
    key=row['asset'];generated=row.get('materialIds',[key]);sub=reuse_pipeline.scoped(doc,generated)
    canonical={};records=[];lineage={};adaptations={}
    if row.get('kind')=='sheet':
        (output/'prepared').mkdir();source=output/'prepared/sheet.png'
        pixel_report=prepare_pixels(raw,source)
        with Image.open(source) as image:boxes=cells(image,row,actual_gaps=True)
        sizes={a['id']:a['output_size'] for a in read(snapshot/'execution-plan.candidate.json')['assets']}
        _,_,adaptations,_=_review_variant(row,source,boxes,visual,sizes,output)
        if adaptations:raise ValueError('REUSE_REQUEST_ADAPTATION_UNSUPPORTED')
        with Image.open(source) as image:
            for mid,box in zip(generated,boxes):
                path=output/'materials'/(mid+'.png');image.crop(box).save(path);canonical[mid]=str(path)
    else:
        source=raw;pixel_report=None
        from .postprocess_visual import process
        gate=process(raw,row['outputSize'],output/'processed',background=False)
        if gate['issues']:raise ValueError('MATERIAL_GATE_FAILED')
        with Image.open(raw) as image:boxes=[[0,0,*image.size]]
        canonical[key]=str(raw)
    for mid,box in zip(generated,boxes):
        facts=dict(requestId=key,sourceSha256=receipt['rawSha256'],sourceBox=box,
            jobDigest=job_config['digest'],submissionDigest=receipt['submissionDigest'],
            receiptSha256=receipt['receiptSha256'],reuseContractSha256=manifest['materialReuseSha256'])
        if pixel_report is not None:facts.update(preparedSha256=digest(source),preparation=pixel_report)
        lineage[mid]=facts
        records.append(dict(facts,materialId=mid,outputSha256=digest(Path(canonical[mid]))))
    derived=reuse.derive(sub,canonical,output/'instances',lineage)
    mids=reuse.expanded_ids(doc,generated)
    materials={mid:derived['materials'][mid] for mid in mids}
    for entry in derived['records']:
        records.append(dict(entry['lineage'],materialId=entry['materialId'],outputSha256=entry['outputSha256'],
            prototypeMaterialId=entry['prototypeMaterialId'],prototypeSourceSha256=entry['prototypeSourceSha256'],
            reuseMappingSha256=entry['reuseMappingSha256'],derivation=entry['derivation']))
    records=[next(r for r in records if r['materialId']==mid) for mid in mids]
    # Diagnostic atlas copies complete PNG pixels unchanged. Its coordinates are
    # observation data, never new generation cells or final material geometry.
    images=[]
    for mid in mids:
        with Image.open(materials[mid]) as im:images.append(im.convert('RGBA'))
    cellw=max(im.width for im in images);cellh=max(im.height for im in images)
    columns=min(4,len(images));rows=math.ceil(len(images)/columns)
    if cellw*cellh*columns*rows>32_000_000:raise ValueError('REUSE_REVIEW_ATLAS_TOO_LARGE')
    atlas=Image.new('RGBA',(cellw*columns,cellh*rows));review_boxes=[]
    for i,im in enumerate(images):
        x=(i%columns)*cellw;y=(i//columns)*cellh
        atlas.paste(im,(x,y));review_boxes.append([x,y,x+im.width,y+im.height])
    display=output/'instance-atlas.png';atlas.save(display)
    review_row=dict(row,materialIds=mids,grid=[columns,rows])
    prepare_sheet_review(snapshot,manifest,review_row,visual,source,digest(source),display,review_boxes,
        {},{key:boxes},{key:receipt['rawSha256']},output,folder)
    prompt=folder/'prompt.md'
    prompt.write_text(prompt.read_text('utf-8')+
        '\nThis observation atlas includes byte-identical declared prototype instances. It is a deterministic '
        'comparison attachment, not the provider raw sheet. Compare EACH material with its own original crop '
        'and ownership. Different states, missing owned parts, foreign contamination or incompatible proportions '
        'block that instance. Do not copy a prototype decision to other instances.\nReuse declarations: '+json.dumps(sub,ensure_ascii=False),encoding='utf-8')
    save(output/'reuse-derivation.json',dict(contractSha256=manifest['materialReuseSha256'],scope=sub,
        generatedMaterialIds=generated,instanceMaterialIds=mids,records=derived['records']))
    return mids,dict(materials=materials,records=records,adaptations={})


def verify(output, row, manifest, doc):
    output=Path(output);sub=reuse_pipeline.scoped(doc,row.get('materialIds',[row['asset']]))
    if sub is None:return
    value=read(output/'reuse-derivation.json');candidate=read(output/'extraction-candidate.json')
    generated=row.get('materialIds',[row['asset']])
    if (value['scope']!=sub or value['contractSha256']!=manifest['materialReuseSha256']
            or value['generatedMaterialIds']!=generated or value['instanceMaterialIds']!=reuse.expanded_ids(doc,generated)
            or list(candidate['materials'])!=value['instanceMaterialIds']):raise ValueError('REUSE_DERIVATION_CHANGED')
    by_id={r['materialId']:r for r in candidate['records']}
    for group in sub['groups']:
        parent=group['prototypeMaterialId'];p=Path(candidate['materials'][parent]);h=digest(p)
        for mid in group['instanceMaterialIds']:
            r=by_id[mid]
            if (digest(Path(candidate['materials'][mid]))!=h or r['prototypeMaterialId']!=parent
                    or r['prototypeSourceSha256']!=h or r['outputSha256']!=h
                    or r['reuseContractSha256']!=manifest['materialReuseSha256']
                    or r['reuseMappingSha256']!=reuse.fingerprint(sub) or r['derivation']!=reuse_pipeline.POLICY):
                raise ValueError('REUSE_INSTANCE_CHANGED')
            for name in ('requestId','sourceSha256','sourceBox','jobDigest','submissionDigest','receiptSha256'):
                if r[name]!=by_id[parent][name]:raise ValueError('REUSE_SOURCE_LINEAGE_CHANGED')
