"""Single-use host exchange for actual received materials; never calls a model."""
from pathlib import Path
import shutil
import tempfile
import math
import json
from PIL import Image
from jsonschema import Draft202012Validator

from .evaluate import read, save, digest
from .experimental_executor import load_job, status as job_status, verified, lock
from .freeze_visual import inspect, body_digest
from .host_review import runtime_files, _bound_files, _identity
from .visual_policy import snapshot_policy
from .sheet_review_policy import classify, schema_for
from .extract_sheets import cells, _review_variant, prepare_sheet_review
from .sheet_pixels import prepare as prepare_pixels
from .single_material_review import prepare_review


def files(root):
    return {p.relative_to(root).as_posix():digest(p) for p in sorted(root.rglob('*'))
            if p.is_file() and p.name != 'exchange.lock'}


def source(job, request_id):
    config,index=load_job(job)
    if request_id not in config['assets'] or job_status(job)['requests'][request_id]!='raw_received':
        raise ValueError('RECEIVED_REQUEST_REQUIRED')
    receipt=verified(job/'attempts'/request_id/'received.json')
    raw=job/'attempts'/request_id/'raw.png'
    with Image.open(raw) as image:
        image.load()
        if (image.format!='PNG' or image.getexif().get(274,1)!=1 or
                list(image.size)!=receipt['size'] or image.convert('RGBA').getchannel('A').getextrema()[1]==0):
            raise ValueError('RECEIVED_PNG_MISMATCH')
    return config,index[request_id],receipt,raw


def prepare(job, request_id, output, *, material_authors, review_registry):
    job=Path(job).resolve();output=Path(output).resolve()
    authors=list(material_authors)
    if not authors or len(authors)!=len(set(authors)):raise ValueError('MATERIAL_AUTHORS_REQUIRED')
    for author in authors:_identity(author)
    config,row,receipt,raw=source(job,request_id)
    snapshot=job/'snapshot';manifest=inspect(snapshot,config['snapshotDigest'])
    if output.exists() or output.is_relative_to(job):raise ValueError('FRESH_INDEPENDENT_OUTPUT_REQUIRED')
    key=body_digest(dict(jobDigest=config['digest'],requestId=request_id,submissionDigest=receipt['submissionDigest']))
    registry=Path(review_registry).resolve()
    if registry.is_relative_to(job) or registry.is_relative_to(output):raise ValueError("INDEPENDENT_REVIEW_REGISTRY_REQUIRED")
    registry.mkdir(parents=True,exist_ok=True)
    reservation=registry/(key+".json")
    # Exclusive creation reserves this actual received request, including failed preparation.
    save(reservation,dict(kind='ui_output_review_reservation_v1',output=str(output),jobDigest=config['digest'],
         requestId=request_id,submissionDigest=receipt['submissionDigest'],materialAuthors=authors))
    try:
        if row.get('kind')!='sheet':
            prepared=prepare_review(job,output,request_id,received_request_only=True)
            if prepared['status']=='blocked_no_retry':return prepared
            mids=[request_id]
            extraction=dict(materials={request_id:str(raw)},records=[dict(materialId=request_id,
                requestId=request_id,sourceSha256=receipt['rawSha256'],outputSha256=receipt['rawSha256'],
                jobDigest=config['digest'],submissionDigest=receipt['submissionDigest'],
                receiptSha256=digest(job/'attempts'/request_id/'received.json'))],adaptations={})
        else:
            output.mkdir(parents=True);(output/'prepared').mkdir();folder=output/'review';folder.mkdir()
            target=output/'prepared'/('sheet.png');pixel_report=prepare_pixels(raw,target)
            with Image.open(target) as image:boxes=cells(image,row,actual_gaps=True)
            visual_path=snapshot/'evidence/revised-visual-plan.json'
            visual=read(visual_path if visual_path.exists() else snapshot/'evidence/m1-draft.json')
            sizes={a['id']:a['output_size'] for a in read(snapshot/'execution-plan.candidate.json')['assets']}
            review_source,review_boxes,adaptations,cell_hashes=_review_variant(row,target,boxes,visual,sizes,output)
            prepare_sheet_review(snapshot,manifest,row,visual,target,digest(target),review_source,review_boxes,
                                 adaptations,{request_id:boxes},{request_id:receipt['rawSha256']},output,folder)
            mids=row['materialIds'];materials={};records=[]
            (output/'materials').mkdir()
            with Image.open(target) as image:
                for mid,box,review_box in zip(mids,boxes,review_boxes):
                    result=output/'materials'/(mid+'.png')
                    if mid in adaptations:shutil.copyfile(output/'adapted'/request_id/mid/'adapted.png',result)
                    else:image.crop(box).save(result)
                    materials[mid]=str(result)
                    records.append(dict(materialId=mid,requestId=request_id,sourceSha256=receipt['rawSha256'],
                        preparedSha256=digest(target),preparation=pixel_report,sourceBox=box,
                        reviewSourceSha256=digest(review_source),reviewBox=review_box,outputSha256=digest(result),
                        jobDigest=config['digest'],submissionDigest=receipt['submissionDigest'],
                        receiptSha256=digest(job/'attempts'/request_id/'received.json')))
            extraction=dict(materials=materials,records=records,adaptations=adaptations)
        folder=output/'review';policy=snapshot_policy(snapshot,manifest)
        if read(folder/'schema.json')!=schema_for(policy):raise ValueError('OUTPUT_SCHEMA_MISMATCH')
        save(output/'extraction-candidate.json',extraction)
        # Every immutable producer file is pinned, including source crop and raw/receipt chain.
        request=dict(kind='ui_host_output_review_request_v1',requestId=request_id,materialIds=mids,
            materialAuthors=authors,job=str(job),jobDigest=config['digest'],snapshotDigest=config['snapshotDigest'],
            submissionDigest=receipt['submissionDigest'],rawSha256=receipt['rawSha256'],
            sourceFiles=files(job),runtime=runtime_files(),reservation=str(reservation),reservationSha256=digest(reservation),
            inputs=files(output),modelCallsMaximum=1,automaticRetry=False,
            humanVisualAcceptance=False,originalDagPromoted=False)
        save(output/'request.json',request)
        save(output/'preparation.json',dict(requestSha256=digest(output/'request.json')))
        verify_prepared(output)
        return dict(status='awaiting_output_review',requestSha256=digest(output/'request.json'),
                    requestId=request_id,materialIds=mids,modelCalls=0,humanVisualAcceptance=False)
    except Exception as exc:
        if output.exists() and not (output/'result.json').exists():
            save(output/'result.json',dict(status='blocked_no_retry',reason=str(exc),modelCalls=0,humanVisualAcceptance=False))
        raise


def verify_prepared(output):
    output=Path(output).resolve();request=read(output/'request.json')
    if request['kind']!='ui_host_output_review_request_v1':raise ValueError('OUTPUT_REVIEW_KIND')
    if digest(output/'request.json')!=read(output/'preparation.json')['requestSha256']:
        raise ValueError('OUTPUT_REQUEST_CHANGED')
    if request['runtime']!=runtime_files():raise ValueError('RUNTIME_CHANGED_NEW_REVIEW_REQUIRED')
    if digest(Path(request['reservation']))!=request['reservationSha256']:raise ValueError('RESERVATION_CHANGED')
    if read(Path(request['reservation']))['output']!=str(output):raise ValueError('RESERVATION_OUTPUT_CHANGED')
    _bound_files(output,request['inputs']);job=Path(request['job']);_bound_files(job,request['sourceFiles'])
    config,row,receipt,raw=source(job,request['requestId'])
    if (request['jobDigest']!=config['digest'] or request['snapshotDigest']!=config['snapshotDigest'] or
            request['submissionDigest']!=receipt['submissionDigest'] or request['rawSha256']!=digest(raw) or
            request['materialIds']!=row.get('materialIds',[request['requestId']])):
        raise ValueError('OUTPUT_SOURCE_BINDING_CHANGED')
    policy=snapshot_policy(job/'snapshot',inspect(job/'snapshot',config['snapshotDigest']))
    if read(output/'review/schema.json')!=schema_for(policy):raise ValueError('OUTPUT_SCHEMA_CHANGED')
    return request,policy


def provenance(output, request):
    folder=output/'review';attestation=read(folder/'host-attestation.json')
    expected=dict(kind='ui_host_output_review_attestation_v1',requestSha256=digest(output/'request.json'),
        responseSha256=digest(folder/'draft.json'),rawSha256=request['rawSha256'],
        submissionDigest=request['submissionDigest'],materialAuthors=request['materialAuthors'],
        reviewerId=attestation.get('reviewerId'),hostAssertedModelResponse=True,
        notProviderReceipt=True,notCryptographicallyPlatformVerified=True,
        dispatchEvidenceSha256=digest(folder/'host-dispatch-evidence.bin'),
        returnEvidenceSha256=digest(folder/'host-return-evidence.bin'))
    if attestation!=expected:raise ValueError('OUTPUT_HOST_ATTESTATION_MISMATCH')
    reviewer=_identity(attestation['reviewerId'])
    if reviewer in request['materialAuthors']:raise ValueError('INDEPENDENT_OUTPUT_REVIEWER_REQUIRED')
    if expected['dispatchEvidenceSha256']==expected['returnEvidenceSha256']:
        raise ValueError('DISTINCT_DISPATCH_RETURN_REQUIRED')
    return dict(kind='ui_host_output_review_provenance_v1',responseOrigin='host-attested-model-response',
                notProviderReceipt=True,notCryptographicallyPlatformVerified=True,
                requestSha256=expected['requestSha256'],responseSha256=expected['responseSha256'],
                hostAttestationSha256=digest(folder/'host-attestation.json'))


def assess(output, request, policy):
    folder=output/'review';answer=read(folder/'draft.json')
    Draft202012Validator(read(folder/'schema.json')).validate(answer)
    assessment=classify(answer,request['materialIds'],policy)
    return dict(status='blocked_no_retry' if assessment['blockers'] else 'reviewed_pending_visual_acceptance',
                requestId=request['requestId'],materialIds=request['materialIds'],rawSha256=request['rawSha256'],
                reviewSha256=digest(folder/'draft.json'),modelCalls=1,humanVisualAcceptance=False,
                originalDagPromoted=False,automaticRetry=False,**assessment)


def receive(output, response, request_sha256, *, response_sha256, host_attestation, dispatch_evidence, return_evidence):
    output=Path(output).resolve();folder=output/'review'
    with lock(output):
        if (output/'result.json').exists() or (folder/'draft.json').exists():raise ValueError('OUTPUT_REVIEW_ALREADY_TERMINAL')
        request,policy=verify_prepared(output)
        inputs=[Path(p).resolve() for p in (response,host_attestation,dispatch_evidence,return_evidence)]
        if any(p.is_relative_to(output) for p in inputs):raise ValueError('EXTERNAL_HOST_EVIDENCE_REQUIRED')
        try:
            # Seal bytes before parsing; an interrupted partial seal cannot be received again.
            for path,name in zip(inputs,('draft.json','host-attestation.json','host-dispatch-evidence.bin','host-return-evidence.bin')):
                with (folder/name).open('xb') as stream:stream.write(path.read_bytes())
            if request_sha256!=digest(output/'request.json') or response_sha256!=digest(folder/'draft.json'):
                raise ValueError('OUTPUT_REVIEW_DIGEST_MISMATCH')
            exchange=provenance(output,request);save(folder/'exchange-provenance.json',exchange)
            result=assess(output,request,policy);verify_prepared(output)
            result['outputs']={name:digest(folder/name) for name in (
                'draft.json','host-attestation.json','host-dispatch-evidence.bin','host-return-evidence.bin','exchange-provenance.json')}
            save(output/'result.json',result)
        except Exception as exc:
            save(output/'result.json',dict(status='indeterminate_review_no_retry',reason=str(exc),modelCalls=1,
                humanVisualAcceptance=False,automaticRetry=False,
                responseSha256=digest(folder/'draft.json') if (folder/'draft.json').exists() else None,requestSha256=digest(output/'request.json')))
            raise
    return result


def verify_run(output):
    output=Path(output).resolve();request,policy=verify_prepared(output);result=read(output/'result.json')
    if result['status']!='reviewed_pending_visual_acceptance':raise ValueError('OUTPUT_REVIEW_NOT_PASSED')
    _bound_files(output/'review',result['outputs'])
    if read(output/'review/exchange-provenance.json')!=provenance(output,request):raise ValueError('OUTPUT_PROVENANCE_CHANGED')
    if {k:v for k,v in result.items() if k!='outputs'}!=assess(output,request,policy):raise ValueError('OUTPUT_ASSESSMENT_CHANGED')
    return request,result


def extract(snapshot, expected_digest, review_runs, output):
    snapshot=Path(snapshot).resolve();manifest=inspect(snapshot,expected_digest)
    rows=read(snapshot/'requests.json')['requests'];expected={row['asset'] for row in rows}
    reviews=[(Path(p).resolve(),*verify_run(p)) for p in review_runs]
    ids=[request['requestId'] for _,request,_ in reviews]
    if len(ids)!=len(set(ids)) or set(ids)!=expected:raise ValueError('COMPLETE_OUTPUT_REVIEW_SET_REQUIRED')
    materials={};records=[];adaptations={};warnings=[];decisions=[];sources={};bindings=[]
    for root,request,result in reviews:
        if request['snapshotDigest']!=expected_digest:raise ValueError('OUTPUT_REVIEW_SNAPSHOT_MISMATCH')
        candidate=read(root/'extraction-candidate.json');key=request['requestId']
        if list(candidate['materials'])!=request['materialIds']:raise ValueError('OUTPUT_MATERIAL_ORDER_CHANGED')
        for mid,path in candidate['materials'].items():
            if mid in materials:raise ValueError('DUPLICATE_REVIEWED_MATERIAL')
            row=next(r for r in candidate['records'] if r['materialId']==mid)
            if digest(Path(path))!=row['outputSha256']:raise ValueError('REVIEWED_MATERIAL_CHANGED')
            materials[mid]=path
        records.extend(dict(row,reviewSha256=result['reviewSha256']) for row in candidate['records'])
        adaptations.update(candidate['adaptations']);sources[key]=request['rawSha256']
        warnings.extend(dict(w,requestId=key,reviewSha256=result['reviewSha256']) for w in result['warnings'])
        decisions.extend(dict(d,requestId=key,reviewSha256=result['reviewSha256']) for d in result['decisions'])
        bindings.append(dict(path=str(root),requestSha256=digest(root/'request.json'),resultSha256=digest(root/'result.json')))
    visual_path=snapshot/'evidence/revised-visual-plan.json'
    visual=read(visual_path if visual_path.exists() else snapshot/'evidence/m1-draft.json')
    if set(materials)!={m['id'] for m in visual['materials']}:raise ValueError('SHEET_MATERIAL_COVERAGE')
    result=dict(status='extracted_pending_material_validation',snapshotDigest=expected_digest,
        materials=materials,records=records,adaptations=adaptations,sourceSha256=sources,
        warnings=warnings,decisions=decisions,modelCalls=len(reviews),humanVisualAcceptance=False,reviewRuns=bindings)
    if output is not None:
        from .adapt_strip import adapt_materials
        output=Path(output).resolve();output.mkdir(parents=True,exist_ok=False)
        result['rawMaterials']=dict(materials)
        result['materials']=adapt_materials(snapshot,materials,output/'adaptation',adaptations)
        result['adaptationFiles']=files(output/'adaptation') if (output/'adaptation').exists() else {}
        result['finalMaterialSha256']={mid:digest(Path(path)) for mid,path in result['materials'].items()}
        result['adaptationEvidence']=read(output/'adaptation/result.json') if (output/'adaptation/result.json').exists() else None
        save(output/'result.json',result)
    return result


def verify_extraction(extraction):
    extraction=Path(extraction).resolve();result=read(extraction/'result.json')
    if result['status']!='extracted_pending_material_validation':raise ValueError('REVIEWED_EXTRACTION_REQUIRED')
    for binding in result['reviewRuns']:
        root=Path(binding['path']);verify_run(root)
        if (digest(root/'request.json')!=binding['requestSha256'] or digest(root/'result.json')!=binding['resultSha256']):
            raise ValueError('EXTRACTION_REVIEW_CHANGED')
    # Derive and compare complete extraction rather than trusting a hand-authored result.
    snapshot=Path(read(Path(result['reviewRuns'][0]['path'])/'request.json')['job'])/'snapshot'
    rebuilt=extract(snapshot,result['snapshotDigest'],[b['path'] for b in result['reviewRuns']],None)
    base={k:v for k,v in result.items() if k not in ('rawMaterials','adaptationFiles','finalMaterialSha256','adaptationEvidence')}
    base['materials']=result['rawMaterials']
    if rebuilt!=base:raise ValueError('EXTRACTION_RESULT_CHANGED')
    _bound_files(extraction/'adaptation',result['adaptationFiles'])
    from .adapt_strip import adapt_materials
    with tempfile.TemporaryDirectory() as temporary:
        derived=Path(temporary)/'adaptation'
        outputs=adapt_materials(snapshot,rebuilt['materials'],derived,rebuilt['adaptations'])
        evidence=read(derived/'result.json') if (derived/'result.json').exists() else None
        expected_paths={mid:str(extraction/'adaptation'/Path(path).relative_to(derived)) if Path(path).is_relative_to(derived) else path for mid,path in outputs.items()}
        if (result['materials']!=expected_paths or result['adaptationEvidence']!=evidence or
                result['finalMaterialSha256']!={mid:digest(Path(path)) for mid,path in outputs.items()} or
                result['adaptationFiles']!=(files(derived) if derived.exists() else {})):
            raise ValueError('EXTRACTION_ADAPTATION_CHANGED')
    if any(digest(Path(path))!=result['finalMaterialSha256'][mid] for mid,path in result['materials'].items()):
        raise ValueError('EXTRACTION_FINAL_MATERIAL_CHANGED')
    return snapshot,result


def package(extraction, preview, output, viewer):
    from .layer_package import sources_from_preview, build
    snapshot,result=verify_extraction(extraction)
    report=read(Path(preview)/'report.json')
    if report.get('registrationPolicy')!='reference-body-support-v1':raise ValueError('EXPLICIT_SUPPORT_REGISTRATION_REQUIRED')
    if report['snapshotDigest']!=result['snapshotDigest']:raise ValueError('PREVIEW_SNAPSHOT_MISMATCH')
    for row in report['records']:
        mid=row['id']
        if mid not in result['materials'] or row['sourceSha256']!=digest(Path(row['source'])):
            raise ValueError('PREVIEW_REVIEWED_SOURCE_MISMATCH')
        if row['sourceSha256']!=result['finalMaterialSha256'][mid]:
            raise ValueError('PREVIEW_REVIEWED_SOURCE_MISMATCH')
    return build(snapshot,sources_from_preview(snapshot,preview,result['warnings']),output,viewer)


CANDIDATE_POLICY = 'deferred-visual-review-v1'
CANDIDATE_FIT = 'uniform-alpha-contain-v1'
CANDIDATE_SPLIT = 'unique-nearest-frozen-grid-zero-alpha-seams-v1'
CANDIDATE_BOUNDARY = 'preserve-faint-source-boundary-guard-v1'


def candidate_sheet_cells(image, row):
    """Prefer strict gaps; ambiguous bands require a unique nearest transparent cut."""
    try:
        boxes=cells(image,row,actual_gaps=True)
        return boxes,dict(candidateSheetSplitPolicy='strict-unique-empty-band-v1',
                          strictExtractionIssue=None,allSourcePixelsRetained=True)
    except ValueError as exc:
        strict_issue=str(exc)
        if strict_issue not in ('SHEET_AMBIGUOUS_EMPTY_BANDS','SHEET_CONTOUR_TOUCHES_CELL_BOUNDARY'):raise
    import numpy as np
    alpha=np.asarray(image.getchannel('A'));columns,rows=row['grid']
    outer=np.zeros(alpha.shape,dtype=bool);outer[0,:]=outer[-1,:]=True;outer[:,0]=outer[:,-1]=True
    outer_count=int(np.count_nonzero(alpha[outer]));outer_max=int(alpha[outer].max())
    sampling_guard=0
    if outer_count:
        if outer_max>1:raise ValueError(strict_issue+': CANDIDATE_SOURCE_OUTER_ALPHA_NOT_FAINT')
        sampling_guard=2
    elif strict_issue=='SHEET_CONTOUR_TOUCHES_CELL_BOUNDARY':
        raise ValueError(strict_issue+': CANDIDATE_SOURCE_OUTER_ALPHA_NOT_FAINT')
    def cuts(count,axis):
        length=alpha.shape[axis];occupied=np.any(alpha!=0,axis=1-axis);result=[0]
        for i in range(1,count):
            center=i*length//count;radius=max(2,length//count//4)
            lo,hi=max(1,center-radius),min(length-1,center+radius)
            bands=[];start=None
            for pos in range(lo,hi+1):
                if not occupied[pos]:
                    if start is None:start=pos
                elif start is not None:
                    if pos-start>=2:bands.append((start,pos))
                    start=None
            if start is not None and hi+1-start>=2:bands.append((start,hi+1))
            possible=[min(max(center,left+1),right-1) for left,right in bands]
            if not possible:raise ValueError(strict_issue+': CANDIDATE_NO_TRANSPARENT_SEAM')
            distance=min(abs(cut-center) for cut in possible)
            nearest=[cut for cut in possible if abs(cut-center)==distance]
            if len(nearest)!=1:raise ValueError(strict_issue+': CANDIDATE_NEAREST_SEAM_TIE')
            cut=nearest[0]
            if occupied[cut-1] or occupied[cut]:raise ValueError('CANDIDATE_NONZERO_ALPHA_SEAM')
            result.append(cut)
        return result+[length]
    xs=cuts(columns,1);ys=cuts(rows,0);boxes=[]
    # Same cell gates as strict extraction, using only verified zero-alpha cuts.
    for i in range(columns*rows):
        x=i%columns;y=i//columns;box=[xs[x],ys[y],xs[x+1],ys[y+1]]
        l,t,r,b=box;a=alpha[t:b,l:r]
        if min(r-l,b-t)<32:raise ValueError('SHEET_CELL_TOO_SMALL')
        if i>=len(row['materialIds']):
            if a.any():raise ValueError('SHEET_UNUSED_CELL_NOT_EMPTY')
            continue
        if not (a>=8).any():raise ValueError('SHEET_MISSING_MATERIAL')
        for edge,is_source_outer in ((a[0,:],t==0),(a[-1,:],b==image.height),
                                      (a[:,0],l==0),(a[:,-1],r==image.width)):
            if edge.any() and not (sampling_guard and is_source_outer and int(edge.max())<=1):
                raise ValueError('SHEET_CONTOUR_TOUCHES_CELL_BOUNDARY')
        boxes.append(box)
    original=image.convert('RGBA');rebuilt=Image.new('RGBA',original.size);partition=[]
    for y in range(rows):
        for x in range(columns):
            box=[xs[x],ys[y],xs[x+1],ys[y+1]];partition.append(box)
            rebuilt.paste(original.crop(box),box[:2])
    if rebuilt.tobytes()!=original.tobytes():raise ValueError('CANDIDATE_SHEET_PIXEL_PARTITION_MISMATCH')
    import hashlib
    return boxes,dict(candidateSheetSplitPolicy=CANDIDATE_SPLIT,
        strictExtractionIssue=strict_issue,allSourcePixelsRetained=True,
        reconstructionPixelExact=True,sourcePixelPartitionExact=True,partitionBoxes=partition,
        sourceBoundaryPolicy=CANDIDATE_BOUNDARY if sampling_guard else None,samplingGuard=sampling_guard,
        rawOuterBoundaryNonzeroAlphaCount=outer_count,rawOuterBoundaryNonzeroAlphaMaximum=outer_max,
        sourceBoundaryAlphaPresent=outer_count>0,alphaQualityAccepted=False,
        xCuts=xs,yCuts=ys,maximumSeamDisplacementFraction=0.25,
        sourceRgbaPixelsSha256=hashlib.sha256(original.tobytes()).hexdigest(),
        reconstructedRgbaPixelsSha256=hashlib.sha256(rebuilt.tobytes()).hexdigest())


def candidate_cell(image, box, split):
    """Retain exact original RGBA values inside explicit transparent cell padding."""
    cell=image.crop(box).convert('RGBA');guard=split.get('samplingGuard',0)
    if guard:
        padded=Image.new('RGBA',(cell.width+2*guard,cell.height+2*guard))
        padded.paste(cell,(guard,guard))
        if padded.crop((guard,guard,guard+cell.width,guard+cell.height)).tobytes()!=cell.tobytes():
            raise ValueError('CANDIDATE_CELL_GUARD_CHANGED_SOURCE')
        return padded
    return cell


def freeze_candidate_plan(plan_path, reference, reference_sha256, contract_dir, output, max_calls,
                          visual_policy=None, visual_textures=None, prior_texture_review=None):
    """Schema-checked deterministic candidate snapshot, explicitly without M2 approval."""
    from .host_review import CONTRACT_DIGESTS
    from .compile_visual import compile_plan, render_prompt, validate
    from .generation_groups import build_groups, CONTEXT_GROUP_POLICY
    from .context_references import materialize, request_references, prompt
    from .execution_preflight import preflight
    from .visual_policy import load_input, generation_guidance
    from . import visual_textures as textures
    plan_path=Path(plan_path).resolve();reference=Path(reference).resolve();output=Path(output).resolve()
    schema_path=Path(contract_dir)/'schemas/visual-plan.schema.json'
    if digest(schema_path)!=CONTRACT_DIGESTS['schemas/visual-plan.schema.json']:
        raise ValueError('FIXED_PUBLIC_SCHEMA_REQUIRED')
    visual=read(plan_path);Draft202012Validator(read(schema_path)).validate(visual)
    if visual['unknowns']:raise ValueError('UNRESOLVED_UNKNOWNS')
    if type(max_calls) is not int or not 1<=max_calls<=128:raise ValueError('CALL_LIMIT_REQUIRED')
    source_sha=digest(reference);plan_sha=digest(plan_path)
    if source_sha!=reference_sha256:raise ValueError('REFERENCE_CHANGED')
    with Image.open(reference) as image:
        image.load()
        if image.format!='PNG' or image.getexif().get(274,1)!=1:raise ValueError('REFERENCE_PNG_REQUIRED')
        picture=image.convert('RGBA')
    policy_bytes=load_input(visual_policy);policy=read(Path(visual_policy)) if policy_bytes is not None else None
    texture_bytes=textures.load_input(visual_textures,reference) if visual_textures is not None else None
    texture_doc=read(Path(visual_textures)) if texture_bytes is not None else None
    texture_review=read(Path(prior_texture_review)) if prior_texture_review is not None else None
    if (texture_doc is None)!=(texture_review is None):raise ValueError('PRIOR_TEXTURE_BINDING_REVIEW_REQUIRED')
    texture_blockers,texture_bindings=textures.assess(texture_doc,visual,texture_review or {})
    if texture_blockers:raise ValueError('SOURCE_TEXTURE_BINDING_INVALID')
    from .evaluate import check_relations
    planning_findings=check_relations(visual)
    plan,placements=compile_plan(visual,picture.size,source_sha,generation_reference='context-crops',context_prompt_version='v7',
                                 planning_review_deferred=True,visual_policy=policy,texture_doc=texture_doc,texture_bindings=texture_bindings)
    groups=build_groups(visual,plan,CONTEXT_GROUP_POLICY)
    if groups['plannedCalls']>max_calls:raise ValueError('CALL_LIMIT_EXCEEDED')
    output.mkdir(parents=True,exist_ok=False);(output/'evidence').mkdir()
    metadata={}
    if policy_bytes is not None:
        (output/'visual-policy.json').write_bytes(policy_bytes);metadata['visualPolicySha256']=digest(output/'visual-policy.json')
    if texture_doc is not None:
        (output/'visual-textures.json').write_bytes(texture_bytes)
        save(output/'visual-texture-bindings.json',texture_bindings)
        (output/'evidence/visual-texture-final-review.json').write_bytes(Path(prior_texture_review).read_bytes())
        metadata.update(visualTexturePolicy=textures.POLICY,visualTexturesSha256=digest(output/'visual-textures.json'),
            visualTextureBindingsSha256=digest(output/'visual-texture-bindings.json'))
    (output/'reference.png').write_bytes(reference.read_bytes())
    (output/'evidence/revised-visual-plan.json').write_bytes(plan_path.read_bytes())
    (output/'evidence/visual-plan.schema.json').write_bytes(schema_path.read_bytes())
    if digest(output/'reference.png')!=source_sha or digest(output/'evidence/revised-visual-plan.json')!=plan_sha:
        raise ValueError('CANDIDATE_SOURCE_CHANGED')
    validate(plan,source_base=output)
    save(output/'execution-plan.candidate.json',plan)
    save(output/'placements.json',dict(basis='candidate declared ownership regions; no body observations',materials=placements))
    save(output/'generation-groups.json',groups)
    singles={}
    for asset in plan['assets']:
        folder=output/'materials'/asset['id'];folder.mkdir(parents=True)
        picture.crop(asset['source_region']).save(folder/'reference-crop.png')
        (folder/'prompt.txt').write_text(render_prompt(asset)+'\n',encoding='utf-8')
        singles[asset['id']]=dict(asset=asset['id'],reference='reference.png',
            crop=(folder/'reference-crop.png').relative_to(output).as_posix(),
            prompt=(folder/'prompt.txt').relative_to(output).as_posix(),sourceRegion=asset['source_region'],
            outputSize=asset['output_size'],plannedCalls=1,automaticRetries=0)
    references=materialize(output,plan,picture);save(output/'generation-references.json',references)
    rows=[]
    for group in groups['groups']:
        if group['mode']=='single':row=singles[group['id']]
        else:
            folder=output/'sheets'/group['id'];folder.mkdir(parents=True)
            (folder/'prompt.txt').write_text(prompt(visual,plan,group['materialIds'],group,version='v7')+
                generation_guidance(policy)+textures.generation_guidance(texture_doc,texture_bindings,group['materialIds'],visual,
                    context=request_references(references,group['materialIds']),group=group)+'\n',encoding='utf-8')
            row=dict(asset=group['id'],kind='sheet',materialIds=group['materialIds'],grid=group['grid'],
                reference='reference.png',prompt=(folder/'prompt.txt').relative_to(output).as_posix(),
                outputSize=group['outputSize'],plannedCalls=1,automaticRetries=0)
        row.update(generationReference='context-crops',references=request_references(references,row.get('materialIds',[row['asset']])))
        rows.append(row)
    save(output/'requests.json',dict(kind='ui_visual_requests_preview_v2',dispatchEnabled=False,
                                   generationReference='context-crops',requests=rows,**metadata))
    save(output/'compile-report.json',dict(contextPromptVersion='v7',planningReviewDeferred=True,
        sourcePlanSha256=plan_sha,referenceSha256=source_sha,visualReviewPolicy=CANDIDATE_POLICY,
        planningVisualFindings=planning_findings,**metadata))
    manifest=dict(kind='ui_visual_frozen_experiment_v1',policy='deferred-visual-candidate-plan-v1',
        status='frozen_experimental_snapshot',executable=False,productionReady=False,humanVisualAcceptance=False,
        planningReviewDeferred=True,newM2ReviewPerformed=False,visualReviewPolicy=CANDIDATE_POLICY,
        planningVisualFindings=planning_findings,
        generationMode='sheets',generationReference='context-crops',contextPromptVersion='v7',
        generationCalls=0,materialCount=len(plan['assets']),plannedCalls=len(rows),maximumCalls=max_calls,
        sourcePlanSha256=plan_sha,referenceSha256=source_sha,legacyCompatibilityBlockers=[
            dict(code='PLANNING_REVIEW_DEFERRED',reason='Candidate only; no M2 visual approval or body observation.')],
        files=files(output),**metadata)
    if texture_doc is not None:
        manifest.update(reviewSha256=digest(output/'evidence/visual-texture-final-review.json'),
            textureReviewOrigin='caller-supplied-prior-source-binding-review',newTextureReviewPerformed=False)
    manifest['digest']=body_digest(manifest);save(output/'snapshot.json',manifest)
    inspect(output,manifest['digest']);preflight(output,manifest['digest'])
    return manifest


def prepare_candidate(snapshot, expected_digest, output):
    """Freeze an explicit candidate-only contract; never authorize generation."""
    snapshot=Path(snapshot).resolve();output=Path(output).resolve()
    manifest=inspect(snapshot,expected_digest)
    if output.exists() or output.is_relative_to(snapshot):raise ValueError('FRESH_INDEPENDENT_OUTPUT_REQUIRED')
    output.mkdir(parents=True)
    from .experimental_executor import record
    result=record(output/'candidate.json',dict(kind='ui_deferred_visual_delivery_v1',
        snapshot=str(snapshot),snapshotDigest=manifest['digest'],snapshotFiles=files(snapshot),
        runtime=runtime_files(),visualReviewPolicy=CANDIDATE_POLICY,registrationPolicy=CANDIDATE_FIT,
        candidateSheetSplitPolicy=CANDIDATE_SPLIT,
        candidateSourceBoundaryPolicy=CANDIDATE_BOUNDARY,
        modelCallsMaximum=0,humanVisualAcceptance=False,originalDagPromoted=False,
        scope='Candidate export only; visual review deferred to final whole-image human acceptance.'))
    return dict(status='candidate_policy_frozen',candidateDigest=result['digest'],
                modelCalls=0,humanVisualAcceptance=False)


def deliver_candidate(candidate, candidate_digest, received_jobs, output, viewer, review_runs=()):
    """Derive a complete candidate from actual receipts, without claiming visual passes."""
    import numpy as np
    import re
    from .layer_package import write_package
    candidate=Path(candidate).resolve();output=Path(output).resolve()
    contract=verified(candidate/'candidate.json')
    if (contract['digest']!=candidate_digest or contract['kind']!='ui_deferred_visual_delivery_v1'
            or contract['visualReviewPolicy']!=CANDIDATE_POLICY or contract['registrationPolicy']!=CANDIDATE_FIT
            or contract.get('candidateSheetSplitPolicy')!=CANDIDATE_SPLIT
            or contract.get('candidateSourceBoundaryPolicy')!=CANDIDATE_BOUNDARY
            or contract['runtime']!=runtime_files()):raise ValueError('CANDIDATE_CONTRACT_CHANGED')
    snapshot=Path(contract['snapshot']);_bound_files(snapshot,contract['snapshotFiles'])
    inspect(snapshot,contract['snapshotDigest'])
    rows=read(snapshot/'requests.json')['requests']
    if set(received_jobs)!={row['asset'] for row in rows}:raise ValueError('COMPLETE_RECEIVED_REQUEST_SET_REQUIRED')
    visual_path=snapshot/'evidence/revised-visual-plan.json'
    visual=read(visual_path if visual_path.exists() else snapshot/'evidence/m1-draft.json')
    owned={m['id']:m for m in visual['materials']}
    placements=sorted(read(snapshot/'placements.json')['materials'],key=lambda p:p['drawIndex'])
    if {p['id'] for p in placements}!=set(owned):raise ValueError('COMPLETE_LAYER_SET_REQUIRED')
    if len({p['drawIndex'] for p in placements})!=len(placements):raise ValueError('AMBIGUOUS_ORDER')
    sources={};bindings=[];evidence=[];sheet_splits=[]
    for row in rows:
        key=row['asset'];job=Path(received_jobs[key]).resolve()
        try:config,actual,receipt,raw=source(job,key)
        except ValueError as exc:
            exc.failed_request_ids=[key]
            raise
        if config['snapshotDigest']!=contract['snapshotDigest'] or actual!=row:
            raise ValueError('CANDIDATE_RECEIVED_SOURCE_SCOPE_MISMATCH')
        bindings.append(dict(requestId=key,jobDigest=config['digest'],submissionDigest=receipt['submissionDigest'],
                             rawSha256=receipt['rawSha256'],receiptSha256=digest(job/'attempts'/key/'received.json')))
        with Image.open(raw) as image:
            image.load()
            if row.get('kind')=='sheet':
                # All nonzero alpha participates in seam and support checks; no alpha floor.
                try:boxes,split=candidate_sheet_cells(image,row)
                except ValueError as exc:
                    exc.failed_request_ids=[key]
                    raise
                sheet_splits.append(dict(requestId=key,sourceSha256=receipt['rawSha256'],**split))
                for mid,box in zip(row['materialIds'],boxes):sources[mid]=candidate_cell(image,box,split)
            else:sources[key]=image.convert('RGBA')
    if set(sources)!=set(owned):raise ValueError('COMPLETE_LAYER_SET_REQUIRED')
    # Existing review evidence is read and bound, including blocked terminal findings.
    # It does not become a passed review and never changes the old review directory.
    for root in review_runs:
        root=Path(root).resolve();request,policy=verify_prepared(root)
        if request['snapshotDigest']!=contract['snapshotDigest']:raise ValueError('OUTPUT_REVIEW_SNAPSHOT_MISMATCH')
        result=read(root/'result.json')
        if result['status'] not in ('blocked_no_retry','reviewed_pending_visual_acceptance'):
            raise ValueError('COMPLETE_VISUAL_FINDINGS_REQUIRED')
        _bound_files(root/'review',result['outputs'])
        if read(root/'review/exchange-provenance.json')!=provenance(root,request):raise ValueError('OUTPUT_PROVENANCE_CHANGED')
        if {k:v for k,v in result.items() if k!='outputs'}!=assess(root,request,policy):raise ValueError('OUTPUT_ASSESSMENT_CHANGED')
        matching=[b for b in bindings if b['requestId']==request['requestId']]
        if (len(matching)!=1 or matching[0]['rawSha256']!=request['rawSha256']
                or matching[0]['submissionDigest']!=request['submissionDigest']):raise ValueError('VISUAL_FINDINGS_SOURCE_MISMATCH')
        evidence.append(dict(requestId=request['requestId'],status=result['status'],
            resultSha256=digest(root/'result.json'),reviewSha256=result['reviewSha256'],
            findings=read(root/'review/draft.json')['findings']))
    for mid in owned:
        if re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_-]{0,127}',mid) is None:raise ValueError('CANDIDATE_MATERIAL_PATH')
    if output.exists() or output.is_relative_to(candidate) or output.is_relative_to(snapshot) or any(
            output.is_relative_to(Path(job).resolve()) for job in received_jobs.values()):
        raise ValueError('FRESH_INDEPENDENT_OUTPUT_REQUIRED')
    output.mkdir(parents=True);(output/'materials').mkdir()
    with Image.open(snapshot/'reference.png') as reference:width,height=reference.size
    layers=[];package_sources={};geometry=[]
    for index,p in enumerate(placements):
        mid=p['id'];image=sources[mid];alpha=image.getchannel('A');box=alpha.getbbox()
        if box is None:raise ValueError('EMPTY_LAYER')
        region=p['sourceRegion'];tw,th=region[2]-region[0],region[3]-region[1]
        if tw<=0 or th<=0:raise ValueError('CANDIDATE_TARGET_GEOMETRY')
        if owned[mid]['role']=='background':
            if alpha.getextrema()!=(255,255):raise ValueError('BACKGROUND_ALPHA')
            box=(0,0,image.width,image.height)
        elif alpha.getextrema()[0]!=0:raise ValueError('CANDIDATE_NATIVE_ALPHA_REQUIRED')
        crop=image.crop(box);background=owned[mid]['role']=='background'
        if not background:
            if min(tw,th)<=4:raise ValueError('CANDIDATE_TARGET_TOO_SMALL_FOR_ALPHA_GUARD')
            crop=Image.fromarray(np.pad(np.array(crop),((4,4),(4,4),(0,0)),mode='constant'))
        scale=min(tw/crop.width,th/crop.height) if background else min((tw-4)/crop.width,(th-4)/crop.height)
        # One affine scale on both axes; the full alpha support fits inside the owner.
        rw=min(tw,math.ceil(crop.width*scale)+(0 if background else 4))
        rh=min(th,math.ceil(crop.height*scale)+(0 if background else 4))
        if background:
            crop=Image.fromarray(np.pad(np.array(crop),((2,2),(2,2),(0,0)),mode='edge'))
        translation=2 if background else -2/scale
        fitted=crop.transform((rw,rh),Image.Transform.AFFINE,(1/scale,0,translation,0,1/scale,translation),
                              resample=Image.Resampling.BICUBIC)
        pixels=np.array(fitted);pixels[pixels[:,:,3]==0]=0
        if not background and (pixels[0,:,3].any() or pixels[-1,:,3].any() or pixels[:,0,3].any() or pixels[:,-1,3].any()):
            raise ValueError('CANDIDATE_ALPHA_GUARD_FAILED')
        fitted=Image.fromarray(pixels)
        if fitted.getchannel('A').getbbox() is None:raise ValueError('EMPTY_LAYER')
        canvas=Image.new('RGBA',(tw,th));offset=((tw-rw)//2,(th-rh)//2)
        canvas.paste(fitted,offset)
        background_pad=owned[mid]['role']=='background' and (rw!=tw or rh!=th)
        if background_pad:
            canvas=Image.fromarray(np.pad(pixels,((offset[1],th-rh-offset[1]),
                (offset[0],tw-rw-offset[0]),(0,0)),mode='edge'))
        path=output/'materials'/(mid+'.png');canvas.save(path)
        package_sources[mid]=dict(path=str(path),sha256=digest(path))
        layers.append(dict(id=mid,name=owned[mid]['label'],role=owned[mid]['role'],
            path=f'layers/layer-{index+1:03}.png',x=region[0],y=region[1],width=tw,height=th,visible=True))
        geometry.append(dict(materialId=mid,sourceFullAlphaBox=list(box),ownershipRegion=region,
            uniformScale=scale,desiredSize=[tw,th],actualSupportSize=[rw,rh],offset=list(offset),
            placementDeviation=[tw-rw,th-rh],observedBody=False,alphaSupportClipped=False,
            backgroundEdgePadding=background_pad,
            sourceTransparentSamplingGuard=0 if background else 4,
            outputTransparentSamplingGuard=0 if background else 2,
            actualRenderedSupportBox=list(canvas.getchannel('A').getbbox()),
            declaredAdaptationPolicy=owned[mid].get('adaptationPolicy','preserve'),
            appliedAdaptationPolicy=CANDIDATE_FIT,materialSha256=digest(path)))
    composition=dict(kind='ui_layer_composition_v1',canvas=dict(width=width,height=height),
        coordinates='top-left-pixels',order='array-back-to-front',textPolicy=visual['textPolicy'],
        backgroundMode=visual['backgroundMode'],reference='reference.png',preview='preview.png',layers=layers)
    issues=['Candidate only: intermediate visual review deferred; final whole-image human acceptance required.',
            'Uniform alpha-support fit uses ownership regions, without observed reference-body geometry.']
    issues.extend('Deferred planning finding: '+json.dumps(f,ensure_ascii=False,sort_keys=True)
                  for f in read(snapshot/'snapshot.json').get('planningVisualFindings',[]))
    issues.extend('Placement candidate: '+json.dumps(g,ensure_ascii=False,sort_keys=True) for g in geometry)
    issues.extend('Candidate sheet split: '+json.dumps(s,ensure_ascii=False,sort_keys=True) for s in sheet_splits)
    issues.extend('Preserved visual findings: '+json.dumps(e,ensure_ascii=False,sort_keys=True) for e in evidence)
    result=write_package(snapshot/'reference.png',composition,package_sources,output/'delivery',viewer,issues)
    result.update(status='pending-human-review',visualReviewPolicy=CANDIDATE_POLICY,registrationPolicy=CANDIDATE_FIT,
        candidateDigest=candidate_digest,snapshotDigest=contract['snapshotDigest'],modelCalls=0,generationCalls=0,
        humanVisualAcceptance=False,originalDagPromoted=False,sourceBindings=bindings,
        geometry=geometry,visualEvidence=evidence,sheetSplits=sheet_splits)
    save(output/'result.json',result)
    return result
