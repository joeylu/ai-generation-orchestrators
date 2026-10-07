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
from .extract_sheets import cells, partition_cells, _review_variant, prepare_sheet_review
from .sheet_pixels import prepare as prepare_pixels, STRICT_SEAM, validate_seam_policy
from .single_material_review import prepare_review
from . import ownership_observation as ownership
from . import material_reuse as reuse, reuse_pipeline, reuse_image_review

BACKGROUND_VISUAL_POLICY = 'record-until-final-composite-v1'
BACKGROUND_DEFERRED_STATUS = 'background_observed_pending_final_composite'


def validate_background_visual_policy(value, bound, request_id=None):
    if value is None:return
    if (value != BACKGROUND_VISUAL_POLICY or bound is None or
            request_id is not None and request_id != bound['materialId']):
        raise ValueError('PROTECTED_BACKGROUND_VISUAL_POLICY_REQUIRED')


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


def prepare(job, request_id, output, *, material_authors, review_registry, background_visual_review_policy=None,
            sheet_seam_policy=STRICT_SEAM):
    job=Path(job).resolve();output=Path(output).resolve()
    validate_seam_policy(sheet_seam_policy)
    authors=list(material_authors)
    if not authors or len(authors)!=len(set(authors)):raise ValueError('MATERIAL_AUTHORS_REQUIRED')
    for author in authors:_identity(author)
    config,row,receipt,raw=source(job,request_id)
    snapshot=job/'snapshot';manifest=inspect(snapshot,config['snapshotDigest'])
    from . import background_region_pipeline as bg_region
    validate_background_visual_policy(background_visual_review_policy,
        bg_region.snapshot_input(snapshot,manifest),request_id)
    reuse_doc=reuse_pipeline.snapshot_input(snapshot,manifest)
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
        if reuse_pipeline.scoped(reuse_doc,row.get('materialIds',[request_id])) is not None:
            visual_path=snapshot/'evidence/revised-visual-plan.json'
            visual=read(visual_path if visual_path.exists() else snapshot/'evidence/m1-draft.json')
            mids,extraction=reuse_image_review.prepare(snapshot,manifest,row,visual,raw,
                dict(receipt,receiptSha256=digest(job/'attempts'/request_id/'received.json')),config,output,reuse_doc)
        elif row.get('kind')!='sheet':
            prepared=prepare_review(job,output,request_id,received_request_only=True)
            if prepared['status']=='blocked_no_retry':return prepared
            mids=[request_id]
            material=Path(prepared.get('protectedCandidate',str(raw)))
            extraction=dict(materials={request_id:str(material)},records=[dict(materialId=request_id,
                requestId=request_id,sourceSha256=receipt['rawSha256'],outputSha256=digest(material),
                jobDigest=config['digest'],submissionDigest=receipt['submissionDigest'],
                receiptSha256=digest(job/'attempts'/request_id/'received.json'))],adaptations={})
            if 'protectedCandidate' in prepared:
                extraction['records'][0]['backgroundRegion']=read(output/'background-region-binding.json')
        else:
            output.mkdir(parents=True);(output/'prepared').mkdir();folder=output/'review';folder.mkdir()
            target=output/'prepared'/('sheet.png');pixel_report=prepare_pixels(raw,target)
            with Image.open(target) as image:boxes,partition=partition_cells(image,row,sheet_seam_policy)
            save(output/'sheet-partition.json',partition)
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
            extraction=dict(materials=materials,records=records,adaptations=adaptations,
                sheetSeamPolicy=sheet_seam_policy,sheetPartitionSha256=digest(output/'sheet-partition.json'))
        folder=output/'review';policy=snapshot_policy(snapshot,manifest)
        if read(folder/'schema.json')!=schema_for(policy):raise ValueError('OUTPUT_SCHEMA_MISMATCH')
        visual_path=snapshot/'evidence/revised-visual-plan.json'
        visual=read(visual_path if visual_path.exists() else snapshot/'evidence/m1-draft.json')
        inventory=ownership.inventory(visual,read(snapshot/'execution-plan.candidate.json'),mids)
        save(folder/'ownership-inventory.json',inventory)
        # This is still the deterministic preparation transaction; no review
        # request has been frozen yet. Replace its newly produced base schema.
        (folder/'schema.json').write_text(json.dumps(ownership.extend_schema(schema_for(policy),inventory),
            ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
        prompt_path=folder/'prompt.md'
        prompt_path.write_text(prompt_path.read_text(encoding='utf-8')+'\n'+ownership.review_prompt(inventory)+'\n',encoding='utf-8')
        if background_visual_review_policy is not None:
            prompt_path.write_text(prompt_path.read_text(encoding='utf-8')+
                '\nThis protected background has an explicit record-until-final-composite policy. '
                'Report every actual discrepancy and all owned/foreign observations truthfully, '
                'including missing, present and uncertain states. Do not report complete or absent '
                'to permit continuation. These background visual observations remain unresolved '
                'until the full composite is compared with the original; foreground UI may occlude '
                'background regions. No visibility or acceptance conclusion is asserted now.\n',encoding='utf-8')
        # Ownership extends producer attachments before this host request is
        # frozen. Bind the final bytes in the nested request as well; keeping
        # its base schema/prompt hashes would give the reviewer two conflicting
        # input inventories even though the outer request is correct.
        nested_request=read(folder/'request.json')
        nested_request['inputs']={name:digest(folder/name) for name in nested_request['inputs']}
        nested_request['inputs']['ownership-inventory.json']=digest(folder/'ownership-inventory.json')
        if row.get('kind')=='sheet' and (output/'sheet-partition.json').is_file():
            shutil.copyfile(output/'sheet-partition.json',folder/'sheet-partition.json')
            nested_request['inputs']['sheet-partition.json']=digest(folder/'sheet-partition.json')
        (folder/'request.json').write_text(json.dumps(nested_request,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
        save(output/'extraction-candidate.json',extraction)
        # Every immutable producer file is pinned, including source crop and raw/receipt chain.
        request=dict(kind='ui_host_output_review_request_v2',requestId=request_id,materialIds=mids,
            ownershipInventorySha256=digest(folder/'ownership-inventory.json'),
            materialAuthors=authors,job=str(job),jobDigest=config['digest'],snapshotDigest=config['snapshotDigest'],
            submissionDigest=receipt['submissionDigest'],rawSha256=receipt['rawSha256'],
            sourceFiles=files(job),runtime=runtime_files(),reservation=str(reservation),reservationSha256=digest(reservation),
            inputs=files(output),modelCallsMaximum=1,automaticRetry=False,
            humanVisualAcceptance=False,originalDagPromoted=False)
        if background_visual_review_policy is not None:
            request['backgroundVisualReviewPolicy']=background_visual_review_policy
        if row.get('kind')=='sheet' and (output/'sheet-partition.json').is_file():
            request['sheetSeamPolicy']=sheet_seam_policy
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
    if request['kind'] not in ('ui_host_output_review_request_v1','ui_host_output_review_request_v2'):raise ValueError('OUTPUT_REVIEW_KIND')
    if digest(output/'request.json')!=read(output/'preparation.json')['requestSha256']:
        raise ValueError('OUTPUT_REQUEST_CHANGED')
    if request['runtime']!=runtime_files():raise ValueError('RUNTIME_CHANGED_NEW_REVIEW_REQUIRED')
    if digest(Path(request['reservation']))!=request['reservationSha256']:raise ValueError('RESERVATION_CHANGED')
    if read(Path(request['reservation']))['output']!=str(output):raise ValueError('RESERVATION_OUTPUT_CHANGED')
    _bound_files(output,request['inputs']);job=Path(request['job']);_bound_files(job,request['sourceFiles'])
    nested_inputs=read(output/'review/request.json')['inputs']
    if request['kind']=='ui_host_output_review_request_v2' and not {
            'schema.json','prompt.md','ownership-inventory.json'}<=set(nested_inputs):
        raise ValueError('OUTPUT_NESTED_REVIEW_INPUTS_MISSING')
    _bound_files(output/'review',nested_inputs)
    config,row,receipt,raw=source(job,request['requestId'])
    if (request['jobDigest']!=config['digest'] or request['snapshotDigest']!=config['snapshotDigest'] or
            request['submissionDigest']!=receipt['submissionDigest'] or request['rawSha256']!=digest(raw) or
            request['materialIds']!=reuse.expanded_ids(reuse_pipeline.snapshot_input(job/'snapshot',inspect(job/'snapshot',config['snapshotDigest'])),row.get('materialIds',[request['requestId']]))):
        raise ValueError('OUTPUT_SOURCE_BINDING_CHANGED')
    snapshot=job/'snapshot';policy=snapshot_policy(snapshot,inspect(snapshot,config['snapshotDigest']))
    if 'sheetSeamPolicy' in request:
        validate_seam_policy(request['sheetSeamPolicy'])
        if row.get('kind')!='sheet':raise ValueError('OUTPUT_SHEET_POLICY_ON_SINGLE')
        with Image.open(output/'prepared/sheet.png') as image:
            boxes,partition=partition_cells(image,row,request['sheetSeamPolicy'])
        if read(output/'sheet-partition.json')!=partition or read(output/'review/sheet-partition.json')!=partition:
            raise ValueError('OUTPUT_SHEET_PARTITION_CHANGED')
        extraction=read(output/'extraction-candidate.json')
        if (extraction.get('sheetSeamPolicy')!=request['sheetSeamPolicy'] or
                extraction.get('sheetPartitionSha256')!=digest(output/'sheet-partition.json') or
                [r['sourceBox'] for r in extraction['records']]!=boxes):
            raise ValueError('OUTPUT_SHEET_PARTITION_BINDING_CHANGED')
    from . import background_region_pipeline as bg_region
    bg_bound=bg_region.snapshot_input(snapshot,inspect(snapshot,config['snapshotDigest']))
    validate_background_visual_policy(request.get('backgroundVisualReviewPolicy'),bg_bound,request['requestId'])
    if bg_bound is not None and request['requestId']==bg_bound['materialId']:
        binding=bg_region.verify_candidate(output,snapshot,inspect(snapshot,config['snapshotDigest']),raw,receipt['rawSha256'])
        candidate=read(output/'extraction-candidate.json')
        if (candidate['materials'].get(bg_bound['materialId'])!=str(output/'protected-background/candidate.png')
                or len(candidate['records'])!=1 or candidate['records'][0].get('backgroundRegion')!=binding
                or candidate['records'][0]['outputSha256']!=binding['candidateSha256']):raise ValueError('BG_REGION_EXTRACTION_CHANGED')
    reuse_image_review.verify(output,row,inspect(snapshot,config['snapshotDigest']),reuse_pipeline.snapshot_input(snapshot,inspect(snapshot,config['snapshotDigest'])))
    expected_schema=schema_for(policy)
    if request['kind']=='ui_host_output_review_request_v2':
        visual_path=snapshot/'evidence/revised-visual-plan.json'
        visual=read(visual_path if visual_path.exists() else snapshot/'evidence/m1-draft.json')
        expected=ownership.inventory(visual,read(snapshot/'execution-plan.candidate.json'),request['materialIds'])
        inventory_path=output/'review/ownership-inventory.json'
        if digest(inventory_path)!=request['ownershipInventorySha256'] or read(inventory_path)!=expected:
            raise ValueError('OUTPUT_OWNERSHIP_INVENTORY_CHANGED')
        expected_schema=ownership.extend_schema(expected_schema,expected)
    if read(output/'review/schema.json')!=expected_schema:raise ValueError('OUTPUT_SCHEMA_CHANGED')
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
    assessment=classify({k:v for k,v in answer.items() if k!='ownershipObservations'},request['materialIds'],policy)
    ownership_result={}
    if request['kind']=='ui_host_output_review_request_v2':
        checked=ownership.assess(read(folder/'ownership-inventory.json'),answer['ownershipObservations'])
        assessment['blockers'].extend(checked['blockers'])
        ownership_result=dict(ownershipInventorySha256=request['ownershipInventorySha256'],
            ownershipDeclarationsOnly=checked['declarationsOnly'],ownershipObservationCoverage='complete')
    deferred={}
    if request.get('backgroundVisualReviewPolicy') is not None:
        # Classify and validate complete coverage first. Preserve the original
        # blocking decisions; only their final visual disposition is deferred.
        findings=dict(policy=request['backgroundVisualReviewPolicy'],
            findings=answer['findings'],decisions=assessment['decisions'],
            blockers=assessment['blockers'],ownershipObservations=answer['ownershipObservations'],
            finalCompositeReviewPending=True,visualReviewPassed=False)
        deferred=dict(deferredVisualFindings=findings)
        assessment['warnings'].append(dict(category='deferred-background-visual-review',
            materialId=request['requestId'],evidence=json.dumps(findings,ensure_ascii=False,sort_keys=True),
            suggestion='Judge all recorded background observations against the complete final composite and original.'))
    return dict(status=BACKGROUND_DEFERRED_STATUS if deferred else ('blocked_no_retry' if assessment['blockers'] else 'reviewed_pending_visual_acceptance'),
                requestId=request['requestId'],materialIds=request['materialIds'],rawSha256=request['rawSha256'],
                reviewSha256=digest(folder/'draft.json'),modelCalls=1,humanVisualAcceptance=False,
                originalDagPromoted=False,automaticRetry=False,**assessment,**ownership_result,**deferred)


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
    allowed=(request.get('backgroundVisualReviewPolicy')==BACKGROUND_VISUAL_POLICY and
             result['status']==BACKGROUND_DEFERRED_STATUS)
    if result['status']!='reviewed_pending_visual_acceptance' and not allowed:raise ValueError('OUTPUT_REVIEW_NOT_PASSED')
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
CANDIDATE_SUBSTITUTION = 'complete-sheet-fresh-singletons-v1'
CANDIDATE_MEASURED = 'measured-alpha-support-v1'
CANDIDATE_ANCHORED = 'measured-alpha-anchor-locked-v2'


def measured_alpha_support(image, owner, reference_size, *, anchor_locked=False):
    """Geometry-only alpha measurement; render all original RGBA with one affine."""
    import numpy as np
    raw=image.convert('RGBA');before=raw.tobytes();alpha=raw.getchannel('A');full=alpha.getbbox()
    if full is None:raise ValueError('EMPTY_LAYER')
    measured=alpha.point(lambda value:255 if value>=8 else 0).getbbox()
    fallback=measured is None;body=full if fallback else measured
    width,height=reference_size
    if min(width,height)<=4 or not 0<=owner[0]<owner[2]<=width or not 0<=owner[1]<owner[3]<=height:
        raise ValueError('CANDIDATE_SUPPORT_REFERENCE_GEOMETRY')
    desired=min((owner[2]-owner[0])/(body[2]-body[0]),(owner[3]-owner[1])/(body[3]-body[1]))
    # Reserve two source pixels for cubic interpolation and two destination pixels.
    scale=(desired if anchor_locked else
           min(desired,(width-4)/(full[2]-full[0]+4),(height-4)/(full[3]-full[1]+4)))
    center=[(owner[i]+owner[i+2])/2 for i in (0,1)]
    desired_shift=[center[i]-(body[i]+body[i+2])/2*scale for i in (0,1)]
    lower=[2-scale*(full[i]-2) for i in (0,1)]
    upper=[reference_size[i]-2-scale*(full[i+2]+2) for i in (0,1)]
    if anchor_locked:
        # Support controls storage only. It must never relocate or shrink the
        # placement anchor to turn an incompatible source into a fitting one.
        if any(desired_shift[i]<lower[i]-1e-9 or desired_shift[i]>upper[i]+1e-9 for i in (0,1)):
            raise ValueError('CANDIDATE_ANCHOR_SUPPORT_OUTSIDE_REFERENCE')
        shift=list(desired_shift)
    else:
        if any(lower[i]>upper[i]+1e-9 for i in (0,1)):raise ValueError('CANDIDATE_SUPPORT_NO_SAFE_AFFINE')
        shift=[min(max(desired_shift[i],lower[i]),max(lower[i],upper[i])) for i in (0,1)]
    expanded=(width+4,height+4)
    if expanded[0]*expanded[1]>18_000_000:raise ValueError('CANDIDATE_SUPPORT_PIXEL_LIMIT')
    source_guard=Image.new('RGBA',(raw.width+4,raw.height+4));source_guard.paste(raw,(2,2))
    coefficients=(1/scale,0,(-shift[0]-2)/scale+2,0,1/scale,(-shift[1]-2)/scale+2)
    rendered=source_guard.transform(expanded,Image.Transform.AFFINE,coefficients,Image.Resampling.BICUBIC)
    pixels=np.array(rendered);pixels[pixels[:,:,3]==0,:3]=0;rendered=Image.fromarray(pixels)
    visible=rendered.getchannel('A').getbbox()
    if visible is None or visible[0]<2 or visible[1]<2 or visible[2]>width+2 or visible[3]>height+2:
        raise ValueError('CANDIDATE_SUPPORT_WOULD_CLIP_REFERENCE')
    actual=[visible[i]-2 for i in range(4)]
    if actual[0]<2 or actual[1]<2 or actual[2]>width-2 or actual[3]>height-2:
        raise ValueError('CANDIDATE_SUPPORT_OUTPUT_GUARD_FAILED')
    region=[min(owner[0],actual[0]-2),min(owner[1],actual[1]-2),max(owner[2],actual[2]+2),max(owner[3],actual[3]+2)]
    canvas=rendered.crop((region[0]+2,region[1]+2,region[2]+2,region[3]+2))
    if raw.tobytes()!=before:raise ValueError('CANDIDATE_SOURCE_CHANGED_DURING_SUPPORT_FIT')
    # Publishing the union must retain every actually rendered nonzero alpha pixel.
    replay=Image.new('RGBA',expanded);replay.paste(canvas,(region[0]+2,region[1]+2))
    if replay.tobytes()!=rendered.tobytes():raise ValueError('CANDIDATE_SUPPORT_CROP_CHANGED_RENDER')
    actual_body=[body[i]*scale+shift[i%2] for i in range(4)]
    geometry=dict(sourceFullAlphaBox=list(full),sourceMeasuredAlphaBox=list(measured) if measured else None,
        sourcePlacementBox=list(body),measurementThreshold=8,measurementFallback='full-alpha-box' if fallback else None,
        sourceUnthresholded=True,measurementIsGeometryOnly=True,desiredScale=desired,actualScale=scale,
        uniformScale=scale,scaleReduction=desired-scale,desiredTranslationAtActualScale=desired_shift,
        actualTranslation=shift,translationDeviations=[shift[i]-desired_shift[i] for i in (0,1)],
        desiredTargetBox=owner,actualMeasuredPlacementBox=actual_body,layerCanvasRegion=region,
        actualRenderedSupportBox=actual,sourceTransparentSamplingGuard=2,outputTransparentSamplingGuard=2,
        inverseAffine=list(coefficients),observedBody=False,humanVisualAcceptance=False,
        alphaSupportClipped=False,sourcePixelsUnchanged=True,resampledAlphaValuesAreSourcePixelExact=False,
        alphaPolicy='Unthresholded source RGBA; uniform cubic resampling; zero RGB at alpha zero; no canvas clipping.')
    if anchor_locked:
        geometry.update(anchorLocked=True,supportMayAlterPlacement=False,
                        positionBasis='measured-alpha-proxy-not-observed-body')
    return canvas,region,geometry


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
                          visual_policy=None, visual_textures=None, prior_texture_review=None,generation_mode='sheets',
                          context_prompt_version='v8'):
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
    if generation_mode not in ('single','sheets'):raise ValueError('GENERATION_MODE')
    if context_prompt_version not in ('v7','v8'):raise ValueError('CONTEXT_PROMPT_VERSION')
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
    plan,placements=compile_plan(visual,picture.size,source_sha,generation_reference='context-crops',context_prompt_version=context_prompt_version,
                                 planning_review_deferred=True,visual_policy=policy,texture_doc=texture_doc,texture_bindings=texture_bindings)
    groups=build_groups(visual,plan,CONTEXT_GROUP_POLICY) if generation_mode=='sheets' else None
    if (groups['plannedCalls'] if groups else len(plan['assets']))>max_calls:raise ValueError('CALL_LIMIT_EXCEEDED')
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
    if groups:save(output/'generation-groups.json',groups)
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
    for group in (groups['groups'] if groups else [dict(id=asset['id'],mode='single') for asset in plan['assets']]):
        if group['mode']=='single':row=singles[group['id']]
        else:
            folder=output/'sheets'/group['id'];folder.mkdir(parents=True)
            (folder/'prompt.txt').write_text(prompt(visual,plan,group['materialIds'],group,version=context_prompt_version)+
                generation_guidance(policy)+textures.generation_guidance(texture_doc,texture_bindings,group['materialIds'],visual,
                    context=request_references(references,group['materialIds']),group=group)+'\n',encoding='utf-8')
            row=dict(asset=group['id'],kind='sheet',materialIds=group['materialIds'],grid=group['grid'],
                reference='reference.png',prompt=(folder/'prompt.txt').relative_to(output).as_posix(),
                outputSize=group['outputSize'],plannedCalls=1,automaticRetries=0)
        row.update(generationReference='context-crops',references=request_references(references,row.get('materialIds',[row['asset']])))
        rows.append(row)
    save(output/'requests.json',dict(kind='ui_visual_requests_preview_v2' if groups else 'ui_visual_requests_preview_v1',dispatchEnabled=False,
                                   generationReference='context-crops',requests=rows,**metadata))
    save(output/'compile-report.json',dict(contextPromptVersion=context_prompt_version,planningReviewDeferred=True,
        sourcePlanSha256=plan_sha,referenceSha256=source_sha,visualReviewPolicy=CANDIDATE_POLICY,
        planningVisualFindings=planning_findings,**metadata))
    manifest=dict(kind='ui_visual_frozen_experiment_v1',policy='deferred-visual-candidate-plan-v1',
        status='frozen_experimental_snapshot',executable=False,productionReady=False,humanVisualAcceptance=False,
        planningReviewDeferred=True,newM2ReviewPerformed=False,visualReviewPolicy=CANDIDATE_POLICY,
        planningVisualFindings=planning_findings,
        generationMode=generation_mode,generationReference='context-crops',contextPromptVersion=context_prompt_version,
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


def prepare_candidate(snapshot, expected_digest, output,registration_policy=CANDIDATE_FIT):
    """Freeze an explicit candidate-only contract; never authorize generation."""
    snapshot=Path(snapshot).resolve();output=Path(output).resolve()
    manifest=inspect(snapshot,expected_digest)
    if registration_policy not in (CANDIDATE_FIT,CANDIDATE_MEASURED,CANDIDATE_ANCHORED):raise ValueError('CANDIDATE_REGISTRATION_POLICY')
    if output.exists() or output.is_relative_to(snapshot):raise ValueError('FRESH_INDEPENDENT_OUTPUT_REQUIRED')
    output.mkdir(parents=True)
    from .experimental_executor import record
    result=record(output/'candidate.json',dict(kind='ui_deferred_visual_delivery_v1',
        snapshot=str(snapshot),snapshotDigest=manifest['digest'],snapshotFiles=files(snapshot),
        runtime=runtime_files(),visualReviewPolicy=CANDIDATE_POLICY,registrationPolicy=registration_policy,
        candidateSheetSplitPolicy=CANDIDATE_SPLIT,
        candidateSourceBoundaryPolicy=CANDIDATE_BOUNDARY,
        candidateMaterialSubstitutionPolicy=CANDIDATE_SUBSTITUTION,
        modelCallsMaximum=0,humanVisualAcceptance=False,originalDagPromoted=False,
        scope='Candidate export only; visual review deferred to final whole-image human acceptance.'))
    return dict(status='candidate_policy_frozen',candidateDigest=result['digest'],
                modelCalls=0,humanVisualAcceptance=False)


def deliver_candidate(candidate, candidate_digest, received_jobs, output, viewer, review_runs=(),received_materials=None):
    """Derive a complete candidate from actual receipts, without claiming visual passes."""
    import numpy as np
    import re
    from .layer_package import write_package
    candidate=Path(candidate).resolve();output=Path(output).resolve()
    contract=verified(candidate/'candidate.json')
    if (contract['digest']!=candidate_digest or contract['kind']!='ui_deferred_visual_delivery_v1'
            or contract['visualReviewPolicy']!=CANDIDATE_POLICY or contract['registrationPolicy'] not in (CANDIDATE_FIT,CANDIDATE_MEASURED,CANDIDATE_ANCHORED)
            or contract.get('candidateSheetSplitPolicy')!=CANDIDATE_SPLIT
            or contract.get('candidateSourceBoundaryPolicy')!=CANDIDATE_BOUNDARY
            or contract.get('candidateMaterialSubstitutionPolicy')!=CANDIDATE_SUBSTITUTION
            or contract['runtime']!=runtime_files()):raise ValueError('CANDIDATE_CONTRACT_CHANGED')
    snapshot=Path(contract['snapshot']);_bound_files(snapshot,contract['snapshotFiles'])
    original_manifest=inspect(snapshot,contract['snapshotDigest'])
    rows=read(snapshot/'requests.json')['requests']
    if set(received_jobs)!={row['asset'] for row in rows}:raise ValueError('COMPLETE_RECEIVED_REQUEST_SET_REQUIRED')
    visual_path=snapshot/'evidence/revised-visual-plan.json'
    visual=read(visual_path if visual_path.exists() else snapshot/'evidence/m1-draft.json')
    owned={m['id']:m for m in visual['materials']}
    placements=sorted(read(snapshot/'placements.json')['materials'],key=lambda p:p['drawIndex'])
    if {p['id'] for p in placements}!=set(owned):raise ValueError('COMPLETE_LAYER_SET_REQUIRED')
    if len({p['drawIndex'] for p in placements})!=len(placements):raise ValueError('AMBIGUOUS_ORDER')
    if received_materials is not None and type(received_materials) is not dict:
        raise ValueError('RECEIVED_MATERIAL_MAP_REQUIRED')
    received_materials=dict(received_materials or {})
    replaceable={mid for row in rows if row.get('kind')=='sheet' for mid in row['materialIds']}
    if not set(received_materials)<=replaceable:raise ValueError('ONLY_COMPLETE_SHEET_MATERIAL_SUBSTITUTIONS_ALLOWED')
    for row in rows:
        mids=set(row.get('materialIds',[]));selected=mids&set(received_materials)
        if selected and selected!=mids:raise ValueError('COMPLETE_SHEET_SUBSTITUTION_REQUIRED')
    if received_materials and original_manifest.get('policy')!='deferred-visual-candidate-plan-v1':
        raise ValueError('CANDIDATE_SNAPSHOT_REQUIRED_FOR_SUBSTITUTIONS')
    sources={};bindings=[];evidence=[];sheet_splits=[];substitutions=[]
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
                if set(row['materialIds'])<=set(received_materials):
                    issue=None
                    try:cells(image,row,actual_gaps=True)
                    except ValueError as exc:issue=str(exc)
                    replacement_bindings=[]
                    for mid in row['materialIds']:
                        new_job=Path(received_materials[mid]).resolve()
                        new_config,new_row,new_receipt,new_raw=source(new_job,mid)
                        new_snapshot=new_job/'snapshot';new_manifest=inspect(new_snapshot,new_config['snapshotDigest'])
                        if (new_job==job or new_config['assets']!=[mid] or new_config['maximumCalls']!=1
                                or new_row.get('kind')=='sheet' or new_row['asset']!=mid
                                or new_manifest.get('policy')!='deferred-visual-candidate-plan-v1'
                                or new_manifest.get('generationMode')!='single'
                                or new_config.get('referenceMode')!='context-crops' or 'promptVariant' in new_config):
                            raise ValueError('FRESH_CANDIDATE_SINGLETON_RECEIPT_REQUIRED')
                        for field in ('sourcePlanSha256','referenceSha256','visualPolicySha256','visualTexturePolicy',
                                      'visualTexturesSha256','visualTextureBindingsSha256'):
                            if new_manifest.get(field)!=original_manifest.get(field):
                                raise ValueError('SUBSTITUTION_SOURCE_PLAN_OR_POLICY_CHANGED')
                        if (digest(new_snapshot/'evidence/revised-visual-plan.json')!=new_manifest['sourcePlanSha256']
                                or digest(visual_path)!=original_manifest['sourcePlanSha256']):
                            raise ValueError('SUBSTITUTION_SOURCE_PLAN_FINGERPRINT_CHANGED')
                        if digest(new_snapshot/'reference.png')!=digest(snapshot/'reference.png'):
                            raise ValueError('SUBSTITUTION_REFERENCE_CHANGED')
                        for name in ('execution-plan.candidate.json','placements.json','generation-references.json'):
                            if read(new_snapshot/name)!=read(snapshot/name):
                                raise ValueError('SUBSTITUTION_COMPILED_STRUCTURE_CHANGED')
                        from .execution_preflight import preflight
                        preflight(new_snapshot,new_manifest['digest'])
                        binding=dict(materialId=mid,requestId=mid,replacedRequestId=key,jobDigest=new_config['digest'],
                            snapshotDigest=new_manifest['digest'],submissionDigest=new_receipt['submissionDigest'],
                            rawSha256=new_receipt['rawSha256'],receiptSha256=digest(new_job/'attempts'/mid/'received.json'))
                        replacement_bindings.append(binding);bindings.append(binding)
                        with Image.open(new_raw) as material:sources[mid]=material.convert('RGBA')
                    substitutions.append(dict(requestId=key,materialIds=row['materialIds'],policy=CANDIDATE_SUBSTITUTION,
                        strictExtractionIssue=issue,originalSheetExtractionPassed=issue is None,
                        originalSheetDelivered=False,originalSourceSha256=receipt['rawSha256'],
                        originalSubmissionDigest=receipt['submissionDigest'],replacementSources=replacement_bindings))
                    continue
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
        answer=read(root/'review/draft.json')
        observed={}
        if request['kind']=='ui_host_output_review_request_v2':
            observed=dict(ownershipObservations=answer['ownershipObservations'],
                ownershipInventorySha256=request['ownershipInventorySha256'],
                ownershipDeclarationsOnly=result['ownershipDeclarationsOnly'],
                blockers=result['blockers'])
        evidence.append(dict(requestId=request['requestId'],status=result['status'],
            resultSha256=digest(root/'result.json'),reviewSha256=result['reviewSha256'],
            findings=answer['findings'],**observed))
    for mid in owned:
        if re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_-]{0,127}',mid) is None:raise ValueError('CANDIDATE_MATERIAL_PATH')
    if output.exists() or output.is_relative_to(candidate) or output.is_relative_to(snapshot) or any(
            output.is_relative_to(Path(job).resolve()) for job in [*received_jobs.values(),*received_materials.values()]):
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
        if contract['registrationPolicy'] in (CANDIDATE_MEASURED,CANDIDATE_ANCHORED) and owned[mid]['role']!='background':
            canvas,layer_region,measured_geometry=measured_alpha_support(image,region,(width,height),
                anchor_locked=contract['registrationPolicy']==CANDIDATE_ANCHORED)
            path=output/'materials'/(mid+'.png');canvas.save(path)
            package_sources[mid]=dict(path=str(path),sha256=digest(path))
            layers.append(dict(id=mid,name=owned[mid]['label'],role=owned[mid]['role'],
                path=f'layers/layer-{index+1:03}.png',x=layer_region[0],y=layer_region[1],
                width=canvas.width,height=canvas.height,visible=True))
            geometry.append(dict(materialId=mid,ownershipRegion=region,appliedAdaptationPolicy=contract['registrationPolicy'],
                materialSha256=digest(path),declaredAdaptationPolicy=owned[mid].get('adaptationPolicy','preserve'),**measured_geometry))
            continue
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
            ('Uniform alpha-support fit uses ownership regions, without observed reference-body geometry.'
             if contract['registrationPolicy']==CANDIDATE_FIT else
             'Candidate registration policy: '+contract['registrationPolicy']+'; ownership targets have no observed reference-body geometry.')]
    issues.extend('Deferred planning finding: '+json.dumps(f,ensure_ascii=False,sort_keys=True)
                  for f in read(snapshot/'snapshot.json').get('planningVisualFindings',[]))
    issues.extend('Placement candidate: '+json.dumps(g,ensure_ascii=False,sort_keys=True) for g in geometry)
    issues.extend('Candidate sheet split: '+json.dumps(s,ensure_ascii=False,sort_keys=True) for s in sheet_splits)
    issues.extend('Fresh singleton substitution: '+json.dumps(s,ensure_ascii=False,sort_keys=True) for s in substitutions)
    issues.extend('Preserved visual findings: '+json.dumps(e,ensure_ascii=False,sort_keys=True) for e in evidence)
    result=write_package(snapshot/'reference.png',composition,package_sources,output/'delivery',viewer,issues)
    result.update(status='pending-human-review',visualReviewPolicy=CANDIDATE_POLICY,registrationPolicy=contract['registrationPolicy'],
        candidateDigest=candidate_digest,snapshotDigest=contract['snapshotDigest'],modelCalls=0,generationCalls=0,
        humanVisualAcceptance=False,originalDagPromoted=False,sourceBindings=bindings,
        geometry=geometry,visualEvidence=evidence,sheetSplits=sheet_splits,materialSubstitutions=substitutions)
    save(output/'result.json',result)
    return result
