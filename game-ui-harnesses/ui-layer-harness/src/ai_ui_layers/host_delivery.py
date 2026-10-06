"""Explicit serial host workflow. Reservations are local attestations, not receipts.

This module neither invokes a model nor assembles its answers. The host dispatches
the exact reserved request and returns original bytes from an independent caller.
"""
import argparse
import hashlib
import json
from pathlib import Path
import secrets
import re
from PIL import Image, ImageOps, ImageDraw

from .evaluate import read, save, digest
from .experimental_executor import record, verified, lock
from .freeze_visual import body_digest
from . import host_review, host_material_review, experimental_executor
from . import host_body_observation, body_viewport_delivery
from .refreeze import freeze_reviewed

KIND = 'ui_integrated_host_delivery_v1'
POLICY = 'expanded-support-original-viewport-v1'
CONTROL = {'state.json', 'checkpoint.json', 'exchange.lock', 'transaction.json'}


def _files(root):
    return {p.relative_to(root).as_posix(): digest(p) for p in sorted(root.rglob('*'))
            if p.is_file() and '.journal' not in p.relative_to(root).parts
            and not (p.parent == root and p.name in CONTROL)}


def _control(root, name, value):
    """Program-owned atomic pointers with immutable, chained transition records."""
    directory=root/'.journal'/name;directory.mkdir(parents=True,exist_ok=True)
    entries=sorted(directory.glob('*.json'))
    previous=digest(entries[-1]) if entries else None
    record(directory/(str(len(entries)).zfill(8)+'.json'),dict(previousSha256=previous,value=value))
    temporary=root/(name+'.tmp')
    temporary.write_text(json.dumps(dict(value,digest=body_digest(value)),ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    temporary.replace(root/name)
    return dict(value,digest=body_digest(value))


def _verify_control(root,name):
    entries=sorted((root/'.journal'/name).glob('*.json'));previous=None;value=None
    for path in entries:
        entry=verified(path)
        if entry['previousSha256']!=previous:raise ValueError('HOST_CONTROL_JOURNAL_CHANGED')
        previous=digest(path);value=entry['value']
    pointer=verified(root/name)
    if value is None or {k:v for k,v in pointer.items() if k!='digest'}!=value:
        raise ValueError('HOST_CONTROL_POINTER_CHANGED')
    return pointer


def _checkpoint(root):
    _control(root,'checkpoint.json', dict(files=_files(root)))


def _load(root):
    config = verified(root/'config.json')
    if config['kind'] != KIND or config['runtime'] != host_review.runtime_files():
        raise ValueError('HOST_RUNTIME_CHANGED_NEW_RUN_REQUIRED')
    pinned = _verify_control(root,'checkpoint.json')['files']
    host_review._bound_files(root, pinned)
    if not (root/'transaction.json').exists() and _files(root) != pinned:
        raise ValueError('HOST_CHECKPOINT_FILES_CHANGED')
    state = _verify_control(root,'state.json')
    if state['configDigest'] != config['digest']:
        raise ValueError('HOST_STATE_CONFIG_CHANGED')
    return config, state


def _state(root, config, stage, **values):
    return _control(root,'state.json', dict(configDigest=config['digest'], stage=stage, **values))


def _scope(root, config, stage, request, request_dir, key=None):
    folder = root/'scopes'/(stage if key is None else stage+'-'+key)
    folder.mkdir(parents=True, exist_ok=False)
    prefix = 'planning' if stage == 'planning_review' else 'material'
    result = record(folder/'scope.json', dict(kind='ui_host_model_scope_v1', stage=stage,
        requestPath=str(request), requestSha256=digest(request),
        requestDirectory=str(request_dir), inputs=_files(request_dir),
        destination=config[prefix+'Destination'], model=config[prefix+'Model'],
        effort=config[prefix+'Effort'], reviewerId=config[prefix+'Reviewer'],
        maximumCallSeconds=config['maximumModelCallSeconds'],
        maximumCalls=1, automaticRetries=0,
        stops=['failed', 'unknown', 'unresolved', 'indeterminate', 'timeout'],
        notProviderReceipt=True, notCryptographicallyPlatformVerified=True))
    _state(root, config, stage, scope=str(folder.relative_to(root)),
           **({'requestId':key} if key else {}))
    return result


def _reviewed_snapshot(source):
    from .freeze_visual import inspect
    from .execution_preflight import preflight
    folder=Path(source['reviewedSnapshot']).resolve()
    manifest=inspect(folder,source['reviewedSnapshotDigest'])
    if (source.get('backgroundVisualReviewPolicy')!=host_material_review.BACKGROUND_VISUAL_POLICY or
            source.get('planningNotes') or manifest.get('planningDriver')!='host-model-exchange-v1' or
            manifest.get('policy')!='visual-plan-v5-experiment-v1' or
            'generation-groups.json' not in manifest['files'] or manifest.get('generationReference')!='context-crops' or
            manifest.get('contextPromptVersion')!='v7' or
            digest(folder/'reference.png')!=digest(Path(source['original'])) or
            manifest['sourcePlanSha256']!=digest(Path(source['seed'])) or
            manifest.get('backgroundRegionDigest')!=source.get('backgroundRegionDigest')):
        raise ValueError('EXACT_PRIOR_REVIEWED_SNAPSHOT_REQUIRED')
    for key,name in (('visualPolicy','visual-policy.json'),('visualTextures','visual-textures.json'),('materialReuse','material-reuse.json')):
        if bool(source.get(key))!=(name in manifest['files']) or source.get(key) and digest(Path(source[key]))!=digest(folder/name):
            raise ValueError('PRIOR_REVIEWED_INPUT_CHANGED')
    preflight(folder,manifest['digest'])
    visual=read(folder/'evidence/m1-draft.json')
    requests=read(folder/'requests.json')['requests']
    if (len(requests)>source['maximumImageCalls'] or len(requests)>source['maximumMaterialReviews'] or
            sum(m['role']=='foreground' for m in visual['materials'])>source['maximumBodyCalls']):
        raise ValueError('FINITE_DOWNSTREAM_CAPACITY_EXCEEDED')
    return folder,manifest


def prepare(config_path, output):
    """Freeze an offline Agent seed, exact model configuration and reviewed inputs."""
    source = read(Path(config_path)); root = Path(output).resolve()
    from . import background_region_pipeline as bg_region
    if bool(source.get('backgroundRegion'))!=bool(source.get('backgroundRegionDigest')):raise ValueError('BG_REGION_CONFIG_PAIR_REQUIRED')
    if source.get('backgroundRegion'):
        from .background_region import inspect as inspect_region
        inspect_region(source['backgroundRegion'],source['backgroundRegionDigest'])
    if 'backgroundVisualReviewPolicy' in source:
        if (source['backgroundVisualReviewPolicy']!=host_material_review.BACKGROUND_VISUAL_POLICY or
                not source.get('backgroundRegion') or source.get('backgroundPolicy')!=bg_region.POLICY):
            raise ValueError('PROTECTED_BACKGROUND_VISUAL_POLICY_REQUIRED')
    if bool(source.get('reviewedSnapshot'))!=bool(source.get('reviewedSnapshotDigest')):
        raise ValueError('PRIOR_REVIEWED_SNAPSHOT_PAIR_REQUIRED')
    if root.exists(): raise ValueError('FRESH_HOST_RUN_REQUIRED')
    for key,default in (('maximumModelCallSeconds',1800),('maximumImageCallSeconds',900)):
        source.setdefault(key,default)
        if type(source[key]) is not int or not 1 <= source[key] <= 3600:
            raise ValueError('FINITE_HOST_CALL_DURATION_REQUIRED')
    for key in ('candidateAuthors','materialAuthors'):
        values=source[key]
        if not isinstance(values,list) or not values or len(set(values)) != len(values):
            raise ValueError('EXPLICIT_HOST_AUTHORS_REQUIRED')
        for value in values: host_review._identity(value)
    for prefix in ('planning','material','body'):
        reviewer=host_review._identity(source[prefix+'Reviewer'])
        authors=source['candidateAuthors'] if prefix=='planning' else source['materialAuthors']
        if reviewer in authors: raise ValueError('INDEPENDENT_HOST_REVIEWER_REQUIRED')
        if any(not isinstance(source[prefix+key],str) or not source[prefix+key].strip()
               for key in ('Model','Destination')): raise ValueError('EXPLICIT_HOST_MODEL_DESTINATION_REQUIRED')
        if source[prefix+'Effort'] not in ('low','medium','high','xhigh','max','ultra'):
            raise ValueError('EXPLICIT_HOST_EFFORT_REQUIRED')
    if not isinstance(source['imageDestination'],str) or not source['imageDestination'].strip():
        raise ValueError('EXPLICIT_NATIVE_IMAGE_DESTINATION_REQUIRED')
    for key in ('maximumImageCalls','maximumMaterialReviews','maximumBodyCalls'):
        if type(source[key]) is not int or not 1 <= source[key] <= 128:
            raise ValueError('FINITE_HOST_CAPACITY_REQUIRED')
    instruction=source['canvasPolicyInstruction']
    if (source['canvasPolicy']!=POLICY or not isinstance(instruction,str) or not instruction.strip()
            or source['canvasPolicyInstructionSha256']!=hashlib.sha256(instruction.encode('utf-8')).hexdigest()):
        raise ValueError('EXPLICIT_BOUND_CANVAS_POLICY_REQUIRED')
    prior=_reviewed_snapshot(source) if source.get('reviewedSnapshot') else None
    root.mkdir(parents=True); inputs=root/'inputs';inputs.mkdir()
    for key in ('seed','original','planningNotes','visualPolicy','visualTextures','materialReuse'):
        if source.get(key):
            path=Path(source[key]);target=inputs/(key+path.suffix)
            target.write_bytes(path.read_bytes());source[key]=str(target)
    contract=root/'contract'
    for name in host_review.CONTRACT_DIGESTS:
        target=contract/name;target.parent.mkdir(parents=True,exist_ok=True)
        target.write_bytes((Path(source['contract'])/name).read_bytes())
    source['contract']=str(contract)
    viewer=root/'viewer';viewer.mkdir()
    for name in ('viewer.html','viewer.js'):
        (viewer/name).write_bytes((Path(source['viewer'])/name).read_bytes())
    source['viewer']=str(viewer)
    if source.get('backgroundRegion'):
        if source.get('backgroundPolicy')!=bg_region.POLICY:raise ValueError('BG_REGION_IDENTITY_POLICY_REQUIRED')
        from .background_region import inspect as inspect_region
        inspect_region(source['backgroundRegion'],source.get('backgroundRegionDigest'))
        target=inputs/'background-region';target.mkdir()
        for name in bg_region.NAMES:(target/name).write_bytes((Path(source['backgroundRegion'])/name).read_bytes())
        source['backgroundRegion']=str(target)
    elif source.get('backgroundPolicy')!='uniform-whole-canvas-opaque-contain-edgepad-v1':
        raise ValueError('EXPLICIT_BACKGROUND_POLICY_REQUIRED')
    config=record(root/'config.json',dict(source,kind=KIND,runtime=host_review.runtime_files(),
        planningMode='verified-prior-independent-host-review' if prior else 'offline-agent-seed-independent-host-review', m1ModelExecuted=False,
        **(dict(newM2ReviewPerformed=False,priorReviewedSnapshotDigest=prior[1]['digest'],priorM2ResponseSha256=prior[1]['reviewSha256']) if prior else {}),
        generationMode='sheets', generationReference='context-crops', contextPromptVersion='v7'))
    try:
        if prior:
            from .freeze_visual import inspect
            from .execution_preflight import preflight
            frozen=root/'frozen';frozen.mkdir()
            for name in [*prior[1]['files'],'snapshot.json']:
                path=Path(name)
                if path.is_absolute() or '..' in path.parts or not (prior[0]/path).resolve().is_relative_to(prior[0]):
                    raise ValueError('UNSAFE_PRIOR_SNAPSHOT_PATH')
                target=frozen/path;target.parent.mkdir(parents=True,exist_ok=True)
                target.write_bytes((prior[0]/path).read_bytes())
            inspect(frozen,prior[1]['digest']);preflight(frozen,prior[1]['digest'])
            experimental_executor.prepare(frozen,prior[1]['digest'],root/'images')
            _state(root,config,'images');_checkpoint(root)
            return status(root)
        host_review.prepare(config['seed'],config['original'],root/'planning',config['contract'],
            seed_author=config['candidateAuthors'], planning_notes=config.get('planningNotes'),
            visual_policy=config.get('visualPolicy'),visual_textures=config.get('visualTextures'),material_reuse=config.get('materialReuse'),
            max_calls=config['maximumImageCalls'],background_region=config.get('backgroundRegion'),
            background_region_digest=config.get('backgroundRegionDigest'))
        _scope(root,config,'planning_review',root/'planning/m2/request.json',root/'planning/m2')
    except Exception as exc:
        _state(root,config,'failed',reason=str(exc),automaticRetry=False)
        _checkpoint(root);raise
    _checkpoint(root)
    return status(root)


def status(run):
    root=Path(run).resolve();config,state=_load(root);stage=state['stage']
    result=dict(stage=stage,configDigest=config['digest'],
        planningMode=config['planningMode'],m1ModelExecuted=config['m1ModelExecuted'],
        FullAutomationExecutionCompleted=stage=='complete',visualAcceptancePending=True,
        humanVisualAcceptance=False,originalDagPromoted=False,automaticRetries=0,
        notProviderReceipt=True,notCryptographicallyPlatformVerified=True)
    result.update(maximumModelCallSeconds=config['maximumModelCallSeconds'],maximumImageCallSeconds=config['maximumImageCallSeconds'])
    if 'newM2ReviewPerformed' in config:result['newM2ReviewPerformed']=config['newM2ReviewPerformed']
    if config.get('backgroundVisualReviewPolicy'):
        result.update(deferredBackgroundVisualReview=True,
            backgroundVisualReviewPolicy=config['backgroundVisualReviewPolicy'],finalCompositeVisualAcceptancePending=True)
    if stage in ('planning_review','material_review'):
        scope=root/state['scope']; bound=verified(scope/'scope.json')
        rows=bound.get('requests',[bound])
        for row in rows:
            host_review._bound_files(Path(row['requestDirectory']),row['inputs'])
            if digest(Path(row['requestPath']))!=row['requestSha256']:raise ValueError('HOST_SCOPE_REQUEST_CHANGED')
        result.update(scopeDigest=bound['digest'],scopeDirectory=str(scope),maximumCalls=bound['maximumCalls'])
        pending=[row for row in rows if not (scope/(row.get('requestId','planning')+'-received.json')).exists()]
        outstanding=[row for row in pending if (scope/(row.get('requestId','planning')+'-submission.json')).exists()]
        if pending:result['requestSha256']=pending[0]['requestSha256']
        result['status']='awaiting_result' if outstanding else (
            'ready' if (scope/'authorization.json').exists() else 'awaiting_authorization')
    elif stage=='images':
        result.update(experimental_executor.status(root/'images'))
        result['scopeDigest']=verified(root/'images/job.json')['digest']
    elif stage=='body_observation':
        result.update(host_body_observation.status(root/'body'))
        result['scopeDigest']=verified(root/'body/job.json')['digest']
    else: result['status']='complete_pending_visual_acceptance' if stage=='complete' else 'failed_no_retry'
    if 'reason' in state: result['reason']=state['reason']
    if (root/'transaction.json').exists(): result['status']='interrupted_transaction_resume_required'
    return result


def authorize(run, scope_digest, approval):
    root=Path(run).resolve()
    with lock(root):
        config,state=_load(root);stage=state['stage']
        if not isinstance(approval,str) or not approval.strip():raise ValueError('EXPLICIT_BOUND_APPROVAL_REQUIRED')
        if stage in ('planning_review','material_review'):
            folder=root/state['scope'];scope=verified(folder/'scope.json')
            if scope['digest']!=scope_digest:raise ValueError('EXPLICIT_BOUND_APPROVAL_REQUIRED')
            if (folder/'authorization.json').exists() or list(folder.glob('*-submission.json')):raise ValueError('HOST_SCOPE_ALREADY_AUTHORIZED')
            record(folder/'authorization.json',dict(scopeDigest=scope_digest,approval=approval,maximumCalls=scope['maximumCalls']))
        elif stage=='images': experimental_executor.authorize(root/'images',scope_digest,approval)
        elif stage=='body_observation':host_body_observation.authorize(root/'body',scope_digest,approval)
        else:raise ValueError('HOST_STAGE_NOT_AUTHORIZABLE')
        _checkpoint(root)
    return status(root)


def next_request(run):
    root=Path(run).resolve()
    with lock(root):
        config,state=_load(root);stage=state['stage']
        if (root/'transaction.json').exists():raise ValueError('HOST_RESUME_REQUIRED')
        if stage in ('planning_review','material_review'):
            folder=root/state['scope'];scope=verified(folder/'scope.json')
            if not (folder/'authorization.json').exists():raise ValueError('HOST_SCOPE_AUTHORIZATION_REQUIRED')
            auth=verified(folder/'authorization.json')
            if auth['scopeDigest']!=scope['digest']:raise ValueError('HOST_AUTHORIZATION_CHANGED')
            rows=scope.get('requests',[scope])
            pending=[row for row in rows if not (folder/(row.get('requestId','planning')+'-received.json')).exists()]
            if not pending:raise ValueError('HOST_SCOPE_COMPLETE')
            if any((folder/(row.get('requestId','planning')+'-submission.json')).exists() for row in pending):
                raise ValueError('HOST_RESERVED_NO_RESUBMIT')
            row=pending[0];key=row.get('requestId','planning')
            submission=record(folder/(key+'-submission.json'),dict(scopeDigest=scope['digest'],requestId=key,
                authorizationDigest=auth['digest'],nonce=secrets.token_hex(16),
                evidenceBasis='Local reservation only; not proof of model execution.'))
            result=dict(scope,**({'currentRequest':row} if stage=='material_review' else {}),submissionDigest=submission['digest'])
        elif stage=='images':
            result=experimental_executor.next_request(root/'images')
            result.update(destination=config['imageDestination'],maximumCalls=1,maximumCallSeconds=config['maximumImageCallSeconds'])
        elif stage=='body_observation':
            result=host_body_observation.next_request(root/'body')
            if result is None:raise ValueError('HOST_BODY_FINISH_REQUIRED')
            result.update(destination=config['bodyDestination'],reviewerId=config['bodyReviewer'],maximumCalls=1,
                          maximumCallSeconds=config['maximumModelCallSeconds'])
        else:raise ValueError('HOST_NO_NEXT_REQUEST')
        _checkpoint(root)
    return dict(result,stage=stage)


def _terminal(root,config,reason):
    _state(root,config,'failed',reason=reason,automaticRetry=False)
    _checkpoint(root)


def receive(run, submission_digest, response, *, host_attestation=None, dispatch_evidence=None, return_evidence=None):
    root=Path(run).resolve()
    if not isinstance(submission_digest,str) or re.fullmatch('[0-9a-f]{64}',submission_digest) is None:
        raise ValueError('HOST_SUBMISSION_DIGEST_REQUIRED')
    with lock(root):
        config,state=_load(root);stage=state['stage']
        if stage in ('planning_review','material_review'):
            scope=root/state['scope'];bound=verified(scope/'scope.json')
            matches=[verified(path) for path in scope.glob('*-submission.json') if verified(path)['digest']==submission_digest]
            if len(matches)!=1:raise ValueError('HOST_RESERVED_SUBMISSION_REQUIRED')
            submission=matches[0];key=submission['requestId']
            if (scope/(key+'-received.json')).exists():
                raise ValueError('HOST_RESERVED_SUBMISSION_REQUIRED')
            if stage=='material_review':bound=next(row for row in bound['requests'] if row['requestId']==key)
        elif stage=='images':
            # Existing exchange rejects unreserved and already consumed submissions.
            matching=[verified(p) for p in (root/'images/attempts').glob('*/submission.json') if verified(p)['digest']==submission_digest]
            if len(matching)!=1 or (root/'images/attempts'/matching[0]['asset']/'received.json').exists():
                raise ValueError('HOST_RESERVED_SUBMISSION_REQUIRED')
            bound=None
        elif stage=='body_observation':
            host_body_observation._reserved(root/'body',submission_digest);bound=None
        else:raise ValueError('HOST_TERMINAL_NO_RETRY')
        record(root/'transaction.json',dict(operation='receive',stage=stage,submissionDigest=submission_digest))
        try:
            if stage!='images':
                if read(Path(host_attestation))['reviewerId']!=config[('planning' if stage=='planning_review' else 'material' if stage=='material_review' else 'body')+'Reviewer']:
                    raise ValueError('FROZEN_HOST_REVIEWER_REQUIRED')
            if stage=='planning_review':
                host_review.receive(root/'planning',response,bound['requestSha256'],
                    response_sha256=digest(Path(response)),host_attestation=host_attestation,
                    dispatch_evidence=dispatch_evidence,return_evidence=return_evidence)
                host_review.verify_run(root/'planning')
                record(scope/'planning-received.json',dict(submissionDigest=submission_digest,responseSha256=digest(Path(response))))
            elif stage=='material_review':
                host_material_review.receive(root/'reviews'/key,response,bound['requestSha256'],
                    response_sha256=digest(Path(response)),host_attestation=host_attestation,
                    dispatch_evidence=dispatch_evidence,return_evidence=return_evidence)
                _,review_result=host_material_review.verify_run(root/'reviews'/key)
                if review_result['status'] not in ('reviewed_pending_visual_acceptance',host_material_review.BACKGROUND_DEFERRED_STATUS):raise ValueError('HOST_MATERIAL_REVIEW_BLOCKED')
                record(scope/(key+'-received.json'),dict(submissionDigest=submission_digest,responseSha256=digest(Path(response))))
            elif stage=='images':experimental_executor.receive(root/'images',submission_digest,response)
            else:
                host_body_observation.receive(root/'body',submission_digest,response,
                    host_attestation_path=host_attestation,dispatch_evidence_path=dispatch_evidence,
                    return_evidence_path=return_evidence)
            (root/'transaction.json').unlink();_checkpoint(root)
        except Exception as exc:
            # Preserve exact answers even if the frozen reviewer identity is wrong.
            rejected=root/'rejected'/submission_digest;rejected.mkdir(parents=True,exist_ok=True)
            for path,name in ((response,'response'),(host_attestation,'attestation'),(dispatch_evidence,'dispatch'),(return_evidence,'return')):
                if path is not None and Path(path).is_file():(rejected/name).write_bytes(Path(path).read_bytes())
            (root/'transaction.json').unlink(missing_ok=True)
            _terminal(root,config,str(exc));raise
    return resume(root)


def fail(run, submission_digest, reason):
    root=Path(run).resolve()
    if not isinstance(submission_digest,str) or re.fullmatch('[0-9a-f]{64}',submission_digest) is None:
        raise ValueError('HOST_SUBMISSION_DIGEST_REQUIRED')
    with lock(root):
        config,state=_load(root)
        if not reason.strip():raise ValueError('HOST_FAILURE_REASON_REQUIRED')
        if state['stage'] in ('planning_review','material_review'):
            scope=root/state['scope'];matches=[verified(p) for p in scope.glob('*-submission.json') if verified(p)['digest']==submission_digest]
            if len(matches)!=1:raise ValueError('HOST_RESERVED_SUBMISSION_REQUIRED')
            submission=matches[0]
            if (scope/(submission['requestId']+'-received.json')).exists():raise ValueError('HOST_ALREADY_RECEIVED')
            record(scope/'failed.json',dict(submissionDigest=submission_digest,reason=reason,automaticRetry=False))
        elif state['stage']=='images':experimental_executor.fail(root/'images',submission_digest,reason)
        elif state['stage']=='body_observation':host_body_observation.fail(root/'body',submission_digest,reason)
        else:raise ValueError('HOST_TERMINAL_NO_RETRY')
        _terminal(root,config,reason)
    return status(root)


def _material_stage(root,config,keys):
    rows=[]
    background_id=None
    if config.get('backgroundVisualReviewPolicy'):
        from . import background_region_pipeline as bg_region
        from .freeze_visual import inspect
        background_id=bg_region.snapshot_input(root/'frozen',inspect(root/'frozen'))['materialId']
    for key in keys:
        folder=root/'reviews'/key
        host_material_review.prepare(root/'images',key,folder,material_authors=config['materialAuthors'],
                                     review_registry=root/'review-registry',
                                     **({'background_visual_review_policy':config['backgroundVisualReviewPolicy']}
                                        if key==background_id else {}))
        rows.append(dict(requestId=key,requestPath=str(folder/'request.json'),requestSha256=digest(folder/'request.json'),
                         requestDirectory=str(folder/'review'),inputs=_files(folder/'review')))
    scope=root/'scopes/material_review';scope.mkdir()
    record(scope/'scope.json',dict(kind='ui_host_material_batch_scope_v1',stage='material_review',requests=rows,
        destination=config['materialDestination'],model=config['materialModel'],effort=config['materialEffort'],
        reviewerId=config['materialReviewer'],maximumCalls=len(rows),automaticRetries=0,
        maximumCallSeconds=config['maximumModelCallSeconds'],
        stops=['failed','unknown','unresolved','indeterminate','timeout'],notProviderReceipt=True,
        notCryptographicallyPlatformVerified=True))
    _state(root,config,'material_review',scope='scopes/material_review')


def _comparison(root):
    folder=root/'delivery/comparison';folder.mkdir()
    with Image.open(root/'delivery/original-reference.png') as source:original=source.convert('RGBA')
    with Image.open(root/'delivery/viewport-preview.png') as source:preview=source.convert('RGBA')
    composition=read(root/'delivery/package/composition.json')
    materials={layer['id']:str(root/'delivery/package'/layer['path']) for layer in composition['layers']}
    width,height=original.size;atlas=Image.new('RGBA',(width,height),(224,226,230,255))
    count=len(materials);columns=max(1,int(count**.5));rows=(count+columns-1)//columns
    cellw,cellh=max(1,width//columns),max(1,height//rows)
    for i,(mid,path) in enumerate(materials.items()):
        with Image.open(path) as source:tile=ImageOps.contain(source.convert('RGBA'),(max(1,cellw-12),max(1,cellh-28)))
        x=(i%columns)*cellw+(cellw-tile.width)//2;y=(i//columns)*cellh+22
        atlas.alpha_composite(tile,(x,y));ImageDraw.Draw(atlas).text(((i%columns)*cellw+5,(i//columns)*cellh+4),mid,fill='black')
    atlas.save(folder/'independent-material-atlas.png')
    combined=Image.new('RGBA',(width*3,height+28),'white')
    for i,(label,image) in enumerate((('Original',original),('Independent materials',atlas),('Recomposed viewport',preview))):
        combined.alpha_composite(image,(i*width,28));ImageDraw.Draw(combined).text((i*width+8,7),label,fill='black')
    combined.save(folder/'three-way-comparison.png')
    save(folder/'comparison.json',dict(kind='ui_host_three_way_comparison_v1',visualAcceptancePending=True,
         originalSha256=digest(root/'delivery/original-reference.png'),viewportSha256=digest(root/'delivery/viewport-preview.png'),
         materialSha256={mid:digest(Path(path)) for mid,path in materials.items()},
         files={p.name:digest(p) for p in folder.iterdir() if p.is_file()}))


def resume(run):
    """Advance only deterministic stages. A pending reservation is never rebuilt."""
    root=Path(run).resolve()
    with lock(root):
        config,state=_load(root);stage=state['stage']
        if (root/'transaction.json').exists():
            # No external call is replayed after an interrupted receive transaction.
            _terminal(root,config,'INTERRUPTED_TRANSACTION_NO_RESUBMIT')
            (root/'transaction.json').unlink();return status(root)
        if stage in ('failed','complete'):return status(root)
        advancing=stage=='planning_review' and (root/state['scope']/'planning-received.json').exists()
        if stage=='material_review':
            scope=root/state['scope'];rows=verified(scope/'scope.json')['requests']
            advancing=all((scope/(row['requestId']+'-received.json')).exists() for row in rows)
        if stage=='images':advancing=experimental_executor.status(root/'images')['status']=='raw_complete'
        if stage=='body_observation':
            current=host_body_observation.status(root/'body')
            advancing=current['sealedCalls']==current['maximumCalls'] and current['status'] in ('ready','completed')
        if not advancing:return status(root)
        record(root/'transaction.json',dict(operation='deterministic-advance',stage=stage))
        try:
            if stage=='planning_review':
                frozen=freeze_reviewed(root/'planning',root/'frozen',config['maximumImageCalls'],
                    generation_mode='sheets',generation_reference='context-crops',context_prompt_version='v7')
                requests=read(root/'frozen/requests.json')['requests']
                visual=read(root/'planning/m1/draft.json')
                bodies=sum(m['role']=='foreground' for m in visual['materials'])
                if len(requests)>config['maximumMaterialReviews'] or bodies>config['maximumBodyCalls']:
                    raise ValueError('FINITE_DOWNSTREAM_CAPACITY_EXCEEDED')
                experimental_executor.prepare(root/'frozen',frozen['digest'],root/'images')
                _state(root,config,'images')
            elif stage=='images':
                job,_=experimental_executor.load_job(root/'images')
                _material_stage(root,config,job['assets'])
            elif stage=='material_review':
                job,_=experimental_executor.load_job(root/'images');keys=job['assets']
                for key in keys:
                    if (root/'reviews'/key/'result.json').exists():host_material_review.verify_run(root/'reviews'/key)
                extraction=host_material_review.extract(root/'frozen',job['snapshotDigest'],
                    [root/'reviews'/key for key in keys],root/'extraction')
                body_config=dict(snapshot=str(root/'frozen'),snapshotDigest=job['snapshotDigest'],
                    materials=extraction['materials'],materialAuthors=config['materialAuthors'],
                    canvasPolicy=config['canvasPolicy'],canvasPolicyInstruction=config['canvasPolicyInstruction'],
                    canvasPolicyInstructionSha256=config['canvasPolicyInstructionSha256'],backgroundPolicy=config['backgroundPolicy'],
                    maximumCallSeconds=config['maximumModelCallSeconds'],destination=config['bodyDestination'],reviewerId=config['bodyReviewer'])
                if (root/'frozen/material-reuse.json').exists():
                    body_config['reviewedReuseExtraction']=dict(path=str(root/'extraction'),sha256=digest(root/'extraction/result.json'))
                if (root/'frozen/background-region/plan.json').exists():
                    body_config['reviewedBackgroundExtraction']=dict(path=str(root/'extraction'),sha256=digest(root/'extraction/result.json'))
                save(root/'body-input.json',body_config)
                host_body_observation.prepare(root/'body-input.json',root/'body',config['maximumBodyCalls'],
                    model=config['bodyModel'],effort=config['bodyEffort'])
                _state(root,config,'body_observation')
            else:
                host_body_observation.finish(root/'body',root/'body-output.json')
                extraction=read(root/'extraction/result.json')
                body_viewport_delivery.build(root/'body-output.json',root/'delivery',root/'viewer',warnings=extraction['warnings'])
                _comparison(root)
                _state(root,config,'complete')
            (root/'transaction.json').unlink();_checkpoint(root)
        except Exception as exc:
            (root/'transaction.json').unlink(missing_ok=True)
            _terminal(root,config,str(exc));raise
    return status(root)


def main():
    parser=argparse.ArgumentParser(description=__doc__);commands=parser.add_subparsers(dest='command',required=True)
    for command in ('host-run','host-status','host-next','host-authorize','host-receive','host-fail','host-resume'):
        child=commands.add_parser(command)
        if command=='host-run':child.add_argument('--config',required=True);child.add_argument('--output',required=True)
        else:child.add_argument('--run',required=True)
        if command in ('host-authorize','host-receive','host-fail'):child.add_argument('--digest',required=True)
        if command=='host-authorize':child.add_argument('--approval',required=True)
        if command=='host-fail':child.add_argument('--reason',required=True)
        if command=='host-receive':
            child.add_argument('--response',required=True)
            for key in ('host-attestation','dispatch-evidence','return-evidence'):child.add_argument('--'+key)
    args=parser.parse_args();command=args.command
    if command=='host-run':result=prepare(args.config,args.output)
    elif command=='host-authorize':result=authorize(args.run,args.digest,args.approval)
    elif command=='host-receive':result=receive(args.run,args.digest,args.response,host_attestation=args.host_attestation,
        dispatch_evidence=args.dispatch_evidence,return_evidence=args.return_evidence)
    elif command=='host-fail':result=fail(args.run,args.digest,args.reason)
    else:result={'host-status':status,'host-next':next_request,'host-resume':resume}[command](args.run)
    print(json.dumps(result,ensure_ascii=False,allow_nan=False))
