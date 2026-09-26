"""One received experimental material: deterministic gate, then one CLI visual review."""
import json
from pathlib import Path

from PIL import Image
from jsonschema import Draft202012Validator

from .automatic_registration import call_model, observation_image
from .evaluate import read, save, digest
from .experimental_executor import load_job, status, verified
from .extract_sheets import review_entries
from .postprocess_visual import process
from .sheet_review_policy import SCHEMA, PROMPT, classify


def comparison(reference, generated, output):
    with Image.open(reference) as im:
        original=im.convert('RGBA')
    with Image.open(generated) as im:
        created=im.convert('RGBA')
    support=created.getchannel('A').point(lambda a: 255 if a>=8 else 0).getbbox()
    if support is None:raise ValueError('EMPTY_MATERIAL')
    created=created.crop(support)
    pane_w,pane_h=720,300
    canvas=Image.new('RGBA',(pane_w*2,pane_h),(29,37,47,255))
    for i,image in enumerate((original,created)):
        scale=min((pane_w-32)/image.width,(pane_h-32)/image.height)
        image=image.resize((max(1,round(image.width*scale)),max(1,round(image.height*scale))),
                           Image.Resampling.LANCZOS)
        x=i*pane_w+(pane_w-image.width)//2
        y=(pane_h-image.height)//2
        canvas.alpha_composite(image,(x,y))
    canvas.convert('RGB').save(output)
    return dict(referenceSha256=digest(reference),generatedSha256=digest(generated),
                generatedSupportBox=list(support),displayPane=[pane_w,pane_h],
                policy='two-independent-uniform-display-fits-not-geometry-measurement')


def finalize_failed_transport(output):
    """Record a terminal failed review from immutable transport evidence; never dispatch again."""
    output=Path(output);folder=output/'review'
    if (output/'result.json').exists():return read(output/'result.json')
    request=read(folder/'request.json');transport=read(folder/'transport.json')
    if any(digest(folder/name)!=value for name,value in request['inputs'].items()):
        raise ValueError('MATERIAL_REVIEW_INPUT_CHANGED')
    if (transport.get('exitCode')==0 and transport.get('turnCompleted') and
            not transport.get('unexpectedEvents') and not transport.get('failure')):
        raise ValueError('TRANSPORT_DID_NOT_FAIL')
    result=dict(status='indeterminate_review_no_retry',reason='MATERIAL_REVIEW_TRANSPORT_FAILED',
                materialId=request['materialId'],rawSha256=request['rawSha256'],
                transportSha256=digest(folder/'transport.json'),modelCalls=1,
                humanVisualAcceptance=False,originalDagPromoted=False)
    save(output/'result.json',result)
    return result


def review_prompt(asset, visual):
    entries=review_entries(visual,[asset])
    return ('Compare image 1, the original rectangular reference crop, against image 2, '
            'the received raw generated material. Image 3 places the original on the '
            'left and the generated visible artwork on the right; each pane is fitted '
            'independently for inspection, not measurement. The reference crop may '
            'contain scene pixels, removed business text and artwork assigned to other '
            'materials. Each entry owns only its listed objects. '
            'excludedForeignArtwork belongs to other materials even when visible '
            'inside this crop; its absence is required, not missing artwork. If an '
            'excluded child card, icon, progress bar or button is removed as a complete '
            'unit, do not demand its outline or contents be restored. Its presence in '
            'the generated material is foreign contamination. Preserve all owned '
            'outlines, corners, separators, translucency and attached details. The '
            'frozen policy removes ordinary business text and numeric labels; their '
            'absence is expected. Inspect contour aspect, internal layout, missing or '
            'extra OWNED details and output transparency. Scene pixels outside or '
            'visible through a translucent material are not owned. Do not infer '
            'geometry only from crop rectangles. Report a visible raw proportion '
            'error before target fitting. No tools or fixes. '+PROMPT+
            '\nExpected materialIds: '+asset+'. Entries: '+json.dumps(entries,ensure_ascii=False))


def review(job, output, model_call=None, request_id=None):
    job=Path(job);output=Path(output)
    config,index=load_job(job)
    if status(job)['status']!='raw_complete' or (request_id is None and len(config['assets'])!=1):
        raise ValueError('ONE_RECEIVED_MATERIAL_REQUIRED')
    asset=request_id or config['assets'][0]
    if asset not in config['assets'] or index[asset].get('kind')=='sheet':
        raise ValueError('ONE_RECEIVED_MATERIAL_REQUIRED')
    row=index[asset];raw=job/'attempts'/asset/'raw.png'
    receipt=verified(job/'attempts'/asset/'received.json')
    if digest(raw)!=receipt['rawSha256']:raise ValueError('RESULT_CHANGED')
    output.mkdir(parents=True,exist_ok=False)
    gate=process(raw,row['outputSize'],output/'processed')
    if gate['issues']:
        result=dict(status='blocked_no_retry',reason='MATERIAL_GATE_FAILED',materialId=asset,
                    rawSha256=receipt['rawSha256'],modelCalls=0,humanVisualAcceptance=False)
        save(output/'result.json',result);return result
    folder=output/'review';folder.mkdir()
    reference=job/'snapshot'/row['crop']
    observation_image(reference,folder/'reference.png')
    observation_image(raw,folder/'generated.png')
    detail=comparison(reference,raw,folder/'detail-compare.png')
    save(folder/'detail-compare.json',detail)
    save(folder/'schema.json',SCHEMA)
    visual_path=job/'snapshot/evidence/revised-visual-plan.json'
    visual=read(visual_path if visual_path.is_file() else job/'snapshot/evidence/m1-draft.json')
    prompt=review_prompt(asset,visual)
    (folder/'prompt.md').write_text(prompt,encoding='utf-8')
    names=('reference.png','generated.png','detail-compare.png','detail-compare.json',
           'schema.json','prompt.md')
    bound={name:digest(folder/name) for name in names}
    save(folder/'request.json',dict(kind='ui_single_material_review_v1',materialId=asset,
         jobDigest=config['digest'],submissionDigest=receipt['submissionDigest'],
         rawSha256=receipt['rawSha256'],referenceSha256=digest(reference),inputs=bound,
         modelCallsMaximum=1,automaticRetry=False))
    try:
        transport=(model_call or call_model)(folder)
    except ValueError:
        if (folder/'transport.json').is_file():return finalize_failed_transport(output)
        raise
    if (transport.get('exitCode')!=0 or not transport.get('turnCompleted') or
            transport.get('unexpectedEvents') or transport.get('failure')):
        raise ValueError('MATERIAL_REVIEW_TRANSPORT_FAILED')
    if (transport.get('responseSha256')!=digest(folder/'draft.json') or
            any(digest(folder/name)!=value for name,value in bound.items()) or
            digest(raw)!=receipt['rawSha256'] or digest(reference)!=detail['referenceSha256']):
        raise ValueError('MATERIAL_REVIEW_INPUT_CHANGED')
    answer=read(folder/'draft.json');Draft202012Validator(SCHEMA).validate(answer)
    assessment=classify(answer,[asset])
    save(folder/'assessment.json',dict(assessment,policy='sheet-observation-severity-v1',
                                      reviewSha256=digest(folder/'draft.json'),humanVisualAcceptance=False))
    result=dict(status='blocked_no_retry' if assessment['blockers'] else 'reviewed_pending_visual_acceptance',
                materialId=asset,rawSha256=receipt['rawSha256'],processedSha256=gate['materialSha256'],
                reviewSha256=digest(folder/'draft.json'),modelCalls=1,
                blockers=assessment['blockers'],warnings=assessment['warnings'],
                humanVisualAcceptance=False,originalDagPromoted=False)
    save(output/'result.json',result)
    return result
