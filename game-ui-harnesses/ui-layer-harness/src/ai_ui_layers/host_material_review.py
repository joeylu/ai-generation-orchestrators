"""Single-use host exchange for actual received materials; never calls a model."""
from pathlib import Path
import shutil
import tempfile
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
