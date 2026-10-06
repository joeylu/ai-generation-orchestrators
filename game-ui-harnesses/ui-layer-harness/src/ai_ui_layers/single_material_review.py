"""One received experimental material: deterministic gate, then one CLI visual review."""
import json
from pathlib import Path

from PIL import Image, ImageDraw
from jsonschema import Draft202012Validator

from .automatic_registration import call_model, observation_image
from .evaluate import read, save, digest
from .experimental_executor import load_job, status, verified
from .extract_sheets import review_entries
from .postprocess_visual import process
from .sheet_review_policy import PROMPT, classify, schema_for
from .review_image import fit_resampling, ALPHA_VISIBILITY_GUIDANCE
from .visual_policy import snapshot_policy, output_review_guidance
from . import visual_textures


def comparison(reference, generated, output, processed=None):
    with Image.open(reference) as im:
        original=im.convert('RGBA')
    with Image.open(generated) as im:
        created=im.convert('RGBA')
    support=created.getchannel('A').point(lambda a: 255 if a>=8 else 0).getbbox()
    if support is None:raise ValueError('EMPTY_MATERIAL')
    created=created.crop(support)
    images=[original,created]
    if processed is not None:
        with Image.open(processed) as im:
            images.append(im.convert('RGBA'))
    pane_w,pane_h=720,300
    canvas=Image.new('RGBA',(pane_w*len(images),pane_h),(29,37,47,255))
    draw=ImageDraw.Draw(canvas)
    tile=24
    for pane in range(1,len(images)):
        for y in range(0,pane_h,tile):
            for x in range(0,pane_w,tile):
                shade=190 if (x//tile+y//tile)%2 else 235
                draw.rectangle((pane*pane_w+x,y,pane*pane_w+min(x+tile,pane_w)-1,
                                min(y+tile,pane_h)-1),fill=(shade,shade,shade,255))
    for i,image in enumerate(images):
        scale=min((pane_w-32)/image.width,(pane_h-32)/image.height)
        size=(max(1,round(image.width*scale)),max(1,round(image.height*scale)))
        image=image.resize(size,fit_resampling(image.size,size))
        x=i*pane_w+(pane_w-image.width)//2
        y=(pane_h-image.height)//2
        canvas.alpha_composite(image,(x,y))
    canvas.convert('RGB').save(output)
    return dict(referenceSha256=digest(reference),generatedSha256=digest(generated),
                **({'processedSha256':digest(processed)} if processed is not None else {}),
                generatedSupportBox=list(support),displayPane=[pane_w,pane_h],
                policy='independent-uniform-display-fits-right-checkerboard-not-geometry-measurement')


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


def review_prompt(asset, visual, visual_policy=None):
    entries=review_entries(visual,[asset])
    return ('Compare image 1, the original rectangular reference crop, against image 2, '
            'the alpha-composited visibility preview of the received raw generated material. '
            + ALPHA_VISIBILITY_GUIDANCE +
            'Image 3 places the original on the left, '
            'the raw generated artwork in the middle and its deterministic target-size fit on '
            'the right. Each checkerboard reveals alpha and is not generated artwork. Each pane '
            'is fitted independently for inspection, not measurement; enlarged source pixels '
            'are shown without smoothing. The reference crop may '
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
            'geometry only from crop rectangles. Transparent output margins are required; '
            'different occupancy of the reference crop and raw canvas is not a contour error. '
            'Report a visible raw proportion error before target fitting, and report any '
            'texture damage introduced by the target-size fit. No tools or fixes. '+PROMPT+
            (output_review_guidance(visual_policy) if visual_policy is not None else '')+
            '\nExpected materialIds: '+asset+'. Entries: '+json.dumps(entries,ensure_ascii=False))


def background_review_prompt(asset, visual, visual_policy=None):
    entries=review_entries(visual,[asset])
    return ('Compare image 1, the original full reference, with image 2, the generated opaque underlay. '
            'Image 3 shows the reference, raw underlay and deterministic target-size fit in three '
            'independently fitted panes for inspection, not measurement. '
            'This material owns the visible background scene; foreground UI materials in the reference are '
            'separately owned and their removal is expected. Do not infer details hidden behind those controls. '
            'Inspect visible background pattern, structure, colors and placement, and confirm the output stays opaque. '
            'Report changed visible artwork, not the absence of separately owned UI or ordinary text. '
            'No tools or fixes. '+PROMPT+
            (output_review_guidance(visual_policy) if visual_policy is not None else '')+
            '\nExpected materialIds: '+asset+'. Entries: '+json.dumps(entries,ensure_ascii=False))


def prepare_review(job, output, request_id=None, *, received_request_only=False):
    """Prepare attachments; host-only explicit selection permits a partial received batch."""
    job=Path(job);output=Path(output)
    config,index=load_job(job)
    snapshot=job/'snapshot'
    manifest=read(snapshot/'snapshot.json')
    visual_policy=snapshot_policy(snapshot,manifest)
    policy_sha=manifest['visualPolicySha256'] if visual_policy is not None else None
    current=status(job)
    if received_request_only:
        if request_id is None or current['requests'].get(request_id)!='raw_received':
            raise ValueError('ONE_RECEIVED_MATERIAL_REQUIRED')
    elif current['status']!='raw_complete' or (request_id is None and len(config['assets'])!=1):
        raise ValueError('ONE_RECEIVED_MATERIAL_REQUIRED')
    asset=request_id or config['assets'][0]
    if asset not in config['assets'] or index[asset].get('kind')=='sheet':
        raise ValueError('ONE_RECEIVED_MATERIAL_REQUIRED')
    row=index[asset];raw=job/'attempts'/asset/'raw.png'
    receipt=verified(job/'attempts'/asset/'received.json')
    if digest(raw)!=receipt['rawSha256']:raise ValueError('RESULT_CHANGED')
    assets=read(job/'snapshot/execution-plan.candidate.json')['assets']
    matching=[item for item in assets if item['id']==asset]
    if len(matching)!=1 or matching[0]['role'] not in ('background','important_component'):
        raise ValueError('UNKNOWN_MATERIAL_ROLE')
    background=matching[0]['role']=='background'
    output.mkdir(parents=True,exist_ok=False)
    gate=process(raw,row['outputSize'],output/'processed',background=background)
    if gate['issues']:
        result=dict(status='blocked_no_retry',reason='MATERIAL_GATE_FAILED',materialId=asset,
                    rawSha256=receipt['rawSha256'],modelCalls=0,humanVisualAcceptance=False)
        save(output/'result.json',result);return result
    folder=output/'review';folder.mkdir()
    reference=job/'snapshot'/row['crop']
    mappings=dict(reference=observation_image(reference,folder/'reference.png',alpha_visibility=True),
                  generated=observation_image(raw,folder/'generated.png',alpha_visibility=True))
    save(folder/'observation-mapping.json',mappings)
    processed=output/'processed/material.png'
    detail=comparison(reference,raw,folder/'detail-compare.png',processed)
    save(folder/'detail-compare.json',detail)
    save(folder/'schema.json',schema_for(visual_policy))
    visual_path=job/'snapshot/evidence/revised-visual-plan.json'
    visual=read(visual_path if visual_path.is_file() else job/'snapshot/evidence/m1-draft.json')
    texture_doc=visual_textures.snapshot_input(snapshot,manifest)
    texture_bindings=visual_textures.snapshot_bindings(snapshot,manifest,visual)
    texture_metadata={key:manifest[key] for key in ('visualTexturePolicy','visualTexturesSha256','visualTextureBindingsSha256') if key in manifest}
    prompt=(background_review_prompt if background else review_prompt)(asset,visual,visual_policy)
    if texture_doc is not None:
        prompt+=visual_textures.generation_guidance(texture_doc,texture_bindings,[asset],visual,context=row.get('references'))
        prompt+='\nReview protected texture shapes against source appearance, including ink, count, layout and proportions. Their removal, invented lettering, uncertain preservation or damaged protected artwork blocks acceptance. Ordinary text removal does not apply to these approved shapes. Actual review metadata: '+json.dumps(dict(materialId=asset,rawSha256=receipt['rawSha256'],sourceRegion=row['sourceRegion'],comparison=detail),ensure_ascii=False)
    (folder/'prompt.md').write_text(prompt,encoding='utf-8')
    names=('reference.png','generated.png','detail-compare.png','detail-compare.json','observation-mapping.json',
           'schema.json','prompt.md')
    bound={name:digest(folder/name) for name in names}
    save(folder/'request.json',dict(kind='ui_single_material_review_v1',materialId=asset,
         jobDigest=config['digest'],submissionDigest=receipt['submissionDigest'],
         rawSha256=receipt['rawSha256'],referenceSha256=digest(reference),inputs=bound,
         modelCallsMaximum=1,automaticRetry=False,
         **texture_metadata,**({'visualPolicySha256':policy_sha} if visual_policy is not None else {})))
    return dict(status="awaiting_host_review", materialId=asset, gate=gate)


def review(job, output, model_call=None, request_id=None):
    prepared=prepare_review(job,output,request_id)
    if prepared["status"]=="blocked_no_retry":return prepared
    job=Path(job);output=Path(output);folder=output/"review"
    config,index=load_job(job);asset=prepared["materialId"];row=index[asset]
    raw=job/"attempts"/asset/"raw.png";reference=job/"snapshot"/row["crop"]
    receipt=verified(job/"attempts"/asset/"received.json")
    snapshot=job/"snapshot";manifest=read(snapshot/"snapshot.json")
    visual_policy=snapshot_policy(snapshot,manifest);policy_sha=manifest.get("visualPolicySha256")
    texture_doc=visual_textures.snapshot_input(snapshot,manifest)
    texture_metadata={key:manifest[key] for key in ("visualTexturePolicy","visualTexturesSha256","visualTextureBindingsSha256") if key in manifest}
    bound=read(folder/"request.json")["inputs"];detail=read(folder/"detail-compare.json")
    gate=prepared["gate"];processed=output/"processed/material.png"
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
            digest(raw)!=receipt['rawSha256'] or digest(reference)!=detail['referenceSha256'] or
            digest(processed)!=gate['materialSha256']):
        raise ValueError('MATERIAL_REVIEW_INPUT_CHANGED')
    if texture_doc is not None:
        from .freeze_visual import inspect
        inspect(snapshot,manifest['digest'])
    answer=read(folder/'draft.json');Draft202012Validator(schema_for(visual_policy)).validate(answer)
    assessment=classify(answer,[asset],visual_policy)
    save(folder/'assessment.json',dict(assessment,policy='sheet-observation-severity-v1',
                                      reviewSha256=digest(folder/'draft.json'),humanVisualAcceptance=False,
                                      **texture_metadata,**({'visualPolicySha256':policy_sha} if visual_policy is not None else {})))
    result=dict(status='blocked_no_retry' if assessment['blockers'] else 'reviewed_pending_visual_acceptance',
                materialId=asset,rawSha256=receipt['rawSha256'],processedSha256=gate['materialSha256'],
                reviewSha256=digest(folder/'draft.json'),modelCalls=1,
                blockers=assessment['blockers'],warnings=assessment['warnings'],decisions=assessment['decisions'],
                humanVisualAcceptance=False,originalDagPromoted=False)
    save(output/'result.json',result)
    return result
