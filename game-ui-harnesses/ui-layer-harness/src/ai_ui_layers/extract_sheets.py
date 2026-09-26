"""Fail-closed grid extraction with a bound visual identity review per sheet."""
from pathlib import Path
import json
import shutil

import numpy as np
from PIL import Image, ImageOps
from jsonschema import Draft202012Validator

from .evaluate import read, save, digest
from .freeze_visual import inspect
from .automatic_registration import observation_image, call_model
from .sheet_pixels import prepare, axis_cuts
from .short_prompt import exclusions
from .sheet_review_policy import SCHEMA as REVIEW_SCHEMA, PROMPT as REVIEW_PROMPT, classify


def review_entries(visual, material_ids):
    owned={m['id']:m for m in visual['materials']}
    return [dict(cellIndex=i,material=owned[mid],
                 objects=[o for o in visual['objects'] if o['materialId']==mid],
                 excludedForeignArtwork=exclusions(visual,owned[mid]))
            for i,mid in enumerate(material_ids)]


def detail_comparison(snapshot, sheet, row, boxes, output):
    """Put each frozen reference crop beside its received cell for close visual review."""
    width, height = 720, 240
    board = Image.new('RGB', (width * 2, height * len(boxes)), (34, 40, 48))
    records = []
    with Image.open(sheet) as generated:
        for index, (mid, bounds) in enumerate(zip(row['materialIds'], boxes)):
            reference = snapshot/'materials'/mid/'reference-crop.png'
            generated_cell = generated.crop(tuple(bounds)).convert('RGBA')
            content_box = generated_cell.getchannel('A').point(
                lambda alpha: 255 if alpha >= 8 else 0).getbbox()
            if content_box is None: raise ValueError('SHEET_MISSING_MATERIAL')
            with Image.open(reference) as original:
                pair = (original.convert('RGBA'), generated_cell.crop(content_box))
                sizes = [list(image.size) for image in pair]
                for column, image in enumerate(pair):
                    view = ImageOps.contain(image, (width - 40, height - 32), Image.Resampling.LANCZOS)
                    x = column * width + (width - view.width) // 2
                    y = index * height + (height - view.height) // 2
                    board.paste(view, (x, y), view)
            records.append(dict(materialId=mid, referenceCropSha256=digest(reference),
                                generatedCellBox=bounds, generatedContentBox=list(content_box),
                                originalSizes=sizes))
    board.save(output/'detail-compare.png')
    save(output/'detail-compare.json', dict(kind='ui_sheet_detail_comparison_v1',
         rows=records, left='frozen reference crop', right='received material cell',
         display='generated alpha support cropped at 8; independent uniform fit per pane; display scale is not geometry evidence',
         imageSha256=digest(output/'detail-compare.png')))


def _review_variant(row, source, raw_boxes, visual, sizes, output):
    """Review explicitly adapted frame cells as a new derived sheet, retaining raw cells."""
    from .adapt_frame import adapt as adapt_frame, POLICY
    from .adapt_strip import validate_policy
    ids = row['materialIds']
    materials = {m['id']: m for m in visual['materials']}
    selected = [mid for mid in ids if materials[mid].get('adaptationPolicy', 'preserve') == POLICY]
    if not selected:
        return source, raw_boxes, {}, {}
    base = output / 'adapted' / row['asset']
    base.mkdir(parents=True)
    files, reports, cell_hashes = [], {}, {}
    with Image.open(source) as image:
        for mid, box in zip(ids, raw_boxes):
            raw_cell = base / (mid + '-raw-cell.png')
            image.crop(tuple(box)).save(raw_cell)
            cell_hashes[mid] = digest(raw_cell)
            if mid in selected:
                validate_policy(visual, materials[mid], sizes[mid])
                reports[mid] = adapt_frame(raw_cell, cell_hashes[mid], *sizes[mid], base / mid)
                files.append(base / mid / 'adapted.png')
            else:
                files.append(raw_cell)
    columns, rows = row['grid']
    widths, heights = [], []
    for file in files:
        with Image.open(file) as image:
            widths.append(image.width); heights.append(image.height)
    cell_width, cell_height = max(widths) + 48, max(heights) + 48
    review = base / 'review-sheet.png'
    sheet = Image.new('RGBA', (columns * cell_width, rows * cell_height))
    for index, file in enumerate(files):
        with Image.open(file) as image:
            x = (index % columns) * cell_width + (cell_width - image.width) // 2
            y = (index // columns) * cell_height + (cell_height - image.height) // 2
            sheet.paste(image, (x, y))
    sheet.save(review)
    with Image.open(review) as image:
        review_boxes = cells(image, row, actual_gaps=True)
    save(base / 'evidence.json', dict(sourcePreparedSha256=digest(source), rawCellSha256=cell_hashes,
         reviewSheetSha256=digest(review), adapted=reports, reviewBoxes=review_boxes,
         humanVisualAcceptance=False))
    return review, review_boxes, reports, cell_hashes


def cells(image, row, actual_gaps=False):
    if 'A' not in image.getbands():raise ValueError('SHEET_NATIVE_ALPHA_REQUIRED')
    alpha=np.asarray(image.getchannel('A'))
    if alpha.min()!=0 or alpha.max()==0:raise ValueError('SHEET_NATIVE_ALPHA_REQUIRED')
    columns,rows=row['grid'];count=len(row['materialIds']);bounds=[]
    if columns*rows<count or count<2:raise ValueError('SHEET_GRID')
    xs=axis_cuts(alpha,columns,1) if actual_gaps else [x*image.width//columns for x in range(columns+1)]
    ys=axis_cuts(alpha,rows,0) if actual_gaps else [y*image.height//rows for y in range(rows+1)]
    for i in range(columns*rows):
        x=i%columns;y=i//columns
        box=[xs[x],ys[y],xs[x+1],ys[y+1]]
        l,t,r,b=box;a=alpha[t:b,l:r]
        if min(r-l,b-t)<32:raise ValueError('SHEET_CELL_TOO_SMALL')
        if i>=count:
            if a.any():raise ValueError('SHEET_UNUSED_CELL_NOT_EMPTY')
            continue
        if not (a>=8).any():raise ValueError('SHEET_MISSING_MATERIAL')
        # Every cut must still be transparent on the prepared pixels.
        if a[0,:].any() or a[-1,:].any() or a[:,0].any() or a[:,-1].any():
            raise ValueError('SHEET_CONTOUR_TOUCHES_CELL_BOUNDARY')
        bounds.append(box)
    return bounds


def extract(snapshot, expected_digest, sources, output, model_call=None, selected_request=None):
    snapshot=Path(snapshot).resolve();inspect(snapshot,expected_digest)
    output=Path(output).resolve();output.mkdir(parents=True,exist_ok=False)
    rows=read(snapshot/'requests.json')['requests']
    if selected_request is not None:
        selected=[row for row in rows if row['asset']==selected_request and row.get('kind')=='sheet']
        if len(selected)!=1:raise ValueError('SHEET_SELECTION_REQUIRED')
        rows=selected
    if set(sources)!={r['asset'] for r in rows}:raise ValueError('SHEET_REQUEST_COVERAGE')
    visual_path=snapshot/'evidence/revised-visual-plan.json'
    visual=read(visual_path if visual_path.exists() else snapshot/'evidence/m1-draft.json')
    owned={m['id']:m for m in visual['materials']}
    originals={k:digest(Path(v)) for k,v in sources.items()}
    reports=[];materials={};adaptations={};calls=0;warnings=[];decisions=[]
    schema=dict(type='object',additionalProperties=False,required=['materialIds','issues'],properties={
        'materialIds':dict(type='array',items=dict(type='string')),
        'issues':dict(type='array',items=dict(type='string')),
        'warnings':dict(type='array',items=dict(type='object',additionalProperties=False,
            required=['category','materialId','evidence','suggestion'],properties={
                'category':dict(enum=['minor-progress-deviation','minor-style-deviation']),
                'materialId':dict(type='string'),
                'evidence':dict(type='string',minLength=1),
                'suggestion':dict(type='string',minLength=1)}))})
    # New model requests require warnings; legacy adapters may omit them, never downgrade issues.
    request_schema=REVIEW_SCHEMA
    try:
        checked={};prepared={};preparation={}
        sizes={a['id']:a['output_size'] for a in read(snapshot/'execution-plan.candidate.json')['assets']}
        (output/'prepared').mkdir()
        for row in rows:
            if row.get('kind')=='sheet':
                key=row['asset'];target=output/'prepared'/(key+'.png')
                preparation[key]=prepare(Path(sources[key]),target);prepared[key]=target
                with Image.open(target) as im:checked[key]=cells(im,row,actual_gaps=True)
        save(output/'cell-preflight.json',dict(sourceSha256=originals,preparation=preparation,cells=checked))
        for row in rows:
            key=row['asset'];source=Path(sources[key])
            if row.get('kind')!='sheet':materials[key]=str(source);continue
            source=prepared[key];prepared_hash=digest(source)
            review_source,review_boxes,frame_reports,cell_hashes = _review_variant(
                row,source,checked[key],visual,sizes,output)
            adaptations.update(frame_reports)
            review_hash=digest(review_source)
            folder=output/key;folder.mkdir()
            mappings=dict(reference=observation_image(snapshot/'reference.png',folder/'reference.png'),
                          generated=observation_image(review_source,folder/'generated.png'))
            detail_comparison(snapshot,review_source,row,review_boxes,folder)
            save(folder/'observation-mapping.json',mappings);save(folder/'schema.json',request_schema)
            entries=review_entries(visual,row['materialIds'])
            adapted_note=('For frame-sliced cells, inspect protected end ornaments, '
                          'both middle-band seams and paper/border continuity. ' if frame_reports else '')
            prompt=('Compare image 1 (complete original UI) with image 2 (generated sheet, after any explicitly frozen deterministic frame adaptation). '
                'Image 3 shows each frozen reference crop beside its generated cell, in material order: '
                'reference on the left and generated on the right. Generated transparent padding was '
                'excluded for this close-up. Each pane was resized uniformly and '
                'independently for visibility; compare contour aspect and internal layout, not display size. '
                'For every material, inspect the surface outline, corner shape and line weight at this '
                'close scale. A stronger border or newly beveled corner is a finding even when the '
                'icon and progress fill are correct. Reference crops may contain removed business text, '
                'scene pixels or foreign artwork; apply the ownership and text rules below. '
                + adapted_note +
                'No tools. Verify every assigned cell contains exactly its assigned material: correct '
                'identity, observed state, complete silhouette, relative proportions, integrated details, '
                'and material ownership. Each entry owns only its listed objects. '
                'excludedForeignArtwork belongs to other materials even when visible inside its reference box; '
                'its absence is required, not a missing-detail error. Its presence is foreign contamination. '
                'Retain all owned graphics; these exclusions do not excuse distorted geometry or lost owned details. '
                'Also verify text policy and absence of duplicate artwork. The frozen text policy is '
                'remove-business-text: ordinary labels and numbers visible only in image 1 are intentionally '
                'removed from image 2. Do not report those missing glyphs as issues; require only each '
                'entry\'s exact preserveText, if any. Judge proportions from the visible artwork contour and '
                'internal motifs, not from removed glyphs or the rectangular crop. Transparent padding and '
                'placement within a grid cell are irrelevant; compare geometry inside each artwork assembly. '
                'Grid is row-major, zero-based. Return observed materialIds in cell order '
                'only when identifiable; do not merely echo the assignment. Unused cells must be empty. '
                'Cell boxes are half-open pixels in image 2; use observation mappings. '
                + REVIEW_PROMPT + '\n'+json.dumps(dict(grid=row['grid'],sourceBoxes=review_boxes,observationMapping=mappings,entries=entries),ensure_ascii=False))
            (folder/'prompt.md').write_text(prompt,encoding='utf-8')
            inputs={n:digest(folder/n) for n in ('reference.png','generated.png','detail-compare.png',
                                                 'detail-compare.json','schema.json','prompt.md',
                                                 'observation-mapping.json')}
            adapted_evidence=(output/'adapted'/key/'evidence.json') if frame_reports else None
            adapted_hash=digest(adapted_evidence) if adapted_evidence else None
            save(folder/'request.json',dict(inputs=inputs,sourceSha256=originals[key],
                 preparedSha256=prepared_hash,reviewSourceSha256=review_hash,
                 adaptedEvidenceSha256=adapted_hash,materialIds=row['materialIds']))
            print(json.dumps(dict(stage='sheet-review',request=key)),flush=True)
            calls+=1;transport=(model_call or call_model)(folder)
            if transport.get('exitCode')!=0 or not transport.get('turnCompleted') or transport.get('unexpectedEvents') or transport.get('failure'):
                raise ValueError('SHEET_REVIEW_TRANSPORT_FAILED')
            if transport.get('responseSha256')!=digest(folder/'draft.json'):raise ValueError('SHEET_RESPONSE_CHANGED')
            if (any(digest(folder/n)!=h for n,h in inputs.items()) or digest(source)!=prepared_hash or
                digest(review_source)!=review_hash or digest(Path(sources[key]))!=originals[key] or
                (adapted_evidence and digest(adapted_evidence)!=adapted_hash) or
                any(digest(output/'adapted'/key/mid/'adapted.png')!=report['outputSha256'] or
                    digest(output/'adapted'/key/mid/'raw.png')!=cell_hashes[mid]
                    for mid,report in frame_reports.items())):
                raise ValueError('SHEET_INPUT_CHANGED')
            answer=read(folder/'draft.json')
            if 'findings' in answer:
                assessment=classify(answer,row['materialIds'])
                save(folder/'assessment.json',dict(assessment,policy='sheet-observation-severity-v1',
                     reviewSha256=digest(folder/'draft.json'),humanVisualAcceptance=False))
                decisions.extend(dict(d,requestId=key,reviewSha256=digest(folder/'draft.json'))
                                 for d in assessment['decisions'])
                answer=dict(materialIds=answer['materialIds'],issues=assessment['blockers'],
                            warnings=assessment['warnings'])
            else:
                # Legacy adapters are conservative: their textual issues always block.
                Draft202012Validator(schema).validate(answer)
            for warning in answer.get('warnings',[]):
                if warning['materialId'] not in row['materialIds']:raise ValueError('SHEET_WARNING_MATERIAL_MISMATCH')
                warnings.append(dict(warning,requestId=key,reviewSha256=digest(folder/'draft.json')))
            if answer['issues']:raise ValueError('SHEET_VISUAL_ISSUES: '+json.dumps(answer['issues'],ensure_ascii=False))
            if answer['materialIds']!=row['materialIds']:raise ValueError('SHEET_IDENTITY_MISMATCH')
            with Image.open(source) as im:
                im.load()
                for mid,box in zip(row['materialIds'],checked[key]):
                    target=folder/(mid+'.png')
                    if mid in frame_reports:
                        shutil.copyfile(output/'adapted'/key/mid/'adapted.png',target)
                        if digest(target)!=frame_reports[mid]['outputSha256']:
                            raise ValueError('SHEET_ADAPTATION_CHANGED')
                    else:
                        im.crop(box).save(target)
                    materials[mid]=str(target.resolve())
                    reports.append(dict(materialId=mid,requestId=key,sourceSha256=originals[key],
                        preparedSha256=prepared_hash,preparation=preparation[key],
                        sourceBox=box,reviewSourceSha256=review_hash,
                        reviewBox=review_boxes[row['materialIds'].index(mid)],
                        outputSha256=digest(target),reviewSha256=digest(folder/'draft.json')))
        expected=set(owned) if selected_request is None else set(rows[0]['materialIds'])
        if set(materials)!=expected:raise ValueError('SHEET_MATERIAL_COVERAGE')
        if any(digest(Path(v))!=originals[k] for k,v in sources.items()):raise ValueError('SHEET_INPUT_CHANGED')
        if any(digest(v)!=preparation[k]['preparedSha256'] for k,v in prepared.items()):raise ValueError('SHEET_INPUT_CHANGED')
        inspect(snapshot,expected_digest)
        result=dict(status='extracted_pending_material_validation' if selected_request is None else
                    'selected_sheet_extracted_pending_material_validation',materials=materials,
                    records=reports,sourceSha256=originals,modelCalls=calls,humanVisualAcceptance=False,warnings=warnings,decisions=decisions)
        if adaptations:result['adaptations']=adaptations
        if selected_request is not None:result['selectedRequest']=selected_request
    except Exception as exc:
        save(output/'result.json',dict(status='blocked_no_retry',reason=str(exc),modelCalls=calls,
            records=reports,sourceSha256=originals,humanVisualAcceptance=False,warnings=warnings,decisions=decisions))
        raise
    save(output/'result.json',result)
    return result
