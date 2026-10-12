"""Explicit host workflow with bounded independent material review reservations.

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
from . import host_body_observation, body_viewport_delivery, host_m1
from .refreeze import freeze_reviewed
from .sheet_pixels import NEAREST_SEAM, STRICT_SEAM, FAINT_GLOW_SEAM, validate_seam_policy
from . import host_sheet_fallback
from . import material_review_dispatch
from . import host_layout_registration
from . import planning_capacity
from . import composite_review
from .validation_scope import operation
from . import host_timing
from . import host_planning

KIND = 'ui_integrated_host_delivery_v1'
POLICY = 'expanded-support-original-viewport-v1'
PLANNING_REUSE='verified-planning-snapshot-reuse-v1'
CONTROL = {'state.json', 'checkpoint.json', 'exchange.lock', 'transaction.json'}
MODEL_STAGES = ('planning_generate', 'planning_review', 'planning_repair', 'planning_rereview',
                'material_review', composite_review.STAGE)


def _files(root):
    control = CONTROL
    if (root/'config.json').is_file() and read(root/'config.json').get('timingPolicy') == host_timing.POLICY:
        control = CONTROL | {host_timing.NAME}
    return {p.relative_to(root).as_posix(): digest(p) for p in sorted(root.rglob('*'))
            if p.is_file() and '.journal' not in p.relative_to(root).parts
            and not (p.parent == root and p.name in control)}


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


@host_timing.measured('orchestration')
def _checkpoint(root):
    _control(root,'checkpoint.json', dict(files=_files(root)))


@host_timing.measured('orchestration')
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
    if config.get('timingPolicy') == host_timing.POLICY:
        _verify_control(root, host_timing.NAME)
    host_timing.bound(root, config, state['stage'])
    return config, state


def _state(root, config, stage, **values):
    return _control(root,'state.json', dict(configDigest=config['digest'], stage=stage, **values))


def _scope(root, config, stage, request, request_dir, key=None):
    folder = root/'scopes'/(stage if key is None else stage+'-'+key)
    folder.mkdir(parents=True, exist_ok=False)
    prefix = 'planning' if stage.startswith('planning_') else 'material'
    result = record(folder/'scope.json', dict(kind='ui_host_model_scope_v1', stage=stage,
        requestPath=str(request), requestSha256=digest(request),
        requestDirectory=str(request_dir), inputs=_files(request_dir),
        destination=config[prefix+'Destination'], model=config[prefix+'Model'],
        effort=config[prefix+'Effort'],
        **({'plannerId':config['m1Planner']} if stage=='planning_generate' else
           {'repairerId':config['planningRepairer']} if stage=='planning_repair' else
           {'reviewerId':config['planningRepairReviewer']} if stage=='planning_rereview' else
           {'reviewerId':config[prefix+'Reviewer']}),
        maximumCallSeconds=config['maximumModelCallSeconds'],
        maximumCalls=1, automaticRetries=0,
        **({'conditionalPlanningRepair':dict(policy=host_planning.REPAIR,
            maximumAdditionalCalls=2,maximumRepairs=1,maximumIndependentRereviews=1,
            repairerId=config['planningRepairer'],reviewerId=config['planningRepairReviewer'],
            trigger='received-verified-planning-errors-only',unknownResultsTerminal=True)}
            if stage=='planning_generate' and host_planning.enabled(config) else {}),
        **({'requestId':key} if key else {}),
        **({'reviewPacketPath':str(request_dir/'dispatch.json'),
            'reviewPacketSha256':digest(request_dir/'dispatch.json')} if stage==composite_review.STAGE else {}),
        stops=(['failed', 'unknown-receipt', 'invalid-technical-contract', 'indeterminate', 'timeout']
               if config.get('visualReviewMode')=='warning' else
               ['failed', 'unknown', 'unresolved', 'indeterminate', 'timeout']),
        notProviderReceipt=True, notCryptographicallyPlatformVerified=True))
    _state(root, config, stage, scope=str(folder.relative_to(root)),
           **({'requestId':key} if key else {}))
    return result


def _reviewed_snapshot(source):
    from .freeze_visual import inspect
    from .execution_preflight import preflight
    folder=Path(source['reviewedSnapshot']).resolve()
    manifest=inspect(folder,source['reviewedSnapshotDigest'])
    explicit_reuse=source.get('reviewedSnapshotPolicy')==PLANNING_REUSE
    if 'reviewedSnapshotPolicy' in source and not explicit_reuse:raise ValueError('REVIEWED_SNAPSHOT_POLICY_UNKNOWN')
    from .visual_policy import snapshot_policy, warnings_only
    if explicit_reuse and (not host_sheet_fallback.final_composite_first(source) or
            manifest.get('m1ModelExecuted') is not True or source.get('backgroundRegion') or
            source.get('backgroundVisualReviewPolicy') or not warnings_only(snapshot_policy(folder,manifest))):
        raise ValueError('REVIEWED_SNAPSHOT_WARNING_M1_REQUIRED')
    if (not explicit_reuse and source.get('backgroundVisualReviewPolicy')!=host_material_review.BACKGROUND_VISUAL_POLICY or
            source.get('planningNotes') or manifest.get('planningDriver')!='host-model-exchange-v1' or
            manifest.get('policy')!='visual-plan-v5-experiment-v1' or
            source.get('generationMode','sheets')!='sheets' or
            'generation-groups.json' not in manifest['files'] or
            manifest.get('generationReference')!='context-crops' or
            manifest.get('contextPromptVersion') not in ('v7','v8','v9','v10','v11','v12','v13') or
            manifest.get('contextPromptVersion')!=source.get('contextPromptVersion',manifest.get('contextPromptVersion')) or
            digest(folder/'reference.png')!=digest(Path(source['original'])) or
            manifest['sourcePlanSha256']!=digest(Path(source['seed'])) or
            manifest.get('backgroundRegionDigest')!=source.get('backgroundRegionDigest')):
        raise ValueError('EXACT_PRIOR_REVIEWED_SNAPSHOT_REQUIRED')
    for key,name in (('visualPolicy','visual-policy.json'),('visualTextures','visual-textures.json'),('materialReuse','material-reuse.json')):
        if bool(source.get(key))!=(name in manifest['files']) or source.get(key) and digest(Path(source[key]))!=digest(folder/name):
            raise ValueError('PRIOR_REVIEWED_INPUT_CHANGED')
    preflight(folder,manifest['digest'])
    from .generation_groups import COMPACT_CONTROL_POLICIES
    actual_group_policy=read(folder/'generation-groups.json')['policy']
    if ((source.get('generationGroupingPolicy') is not None or actual_group_policy in COMPACT_CONTROL_POLICIES)
            and source.get('generationGroupingPolicy')!=actual_group_policy):
        raise ValueError('PRIOR_REVIEWED_GROUPING_POLICY_CHANGED')
    visual=read(folder/'evidence/m1-draft.json')
    requests=read(folder/'requests.json')['requests']
    if (len(requests)>source['maximumImageCalls'] or composite_review.required_calls(source,len(requests))>source['maximumMaterialReviews'] or
            not host_sheet_fallback.final_composite_first(source) and
            sum(m['role']=='foreground' for m in visual['materials'])>source['maximumBodyCalls']):
        raise ValueError('FINITE_DOWNSTREAM_CAPACITY_EXCEEDED')
    return folder,manifest


@host_timing.track('prepare')
@operation
def prepare(config_path, output):
    """Freeze a fresh M1 request or an explicitly supplied candidate seed."""
    source = read(Path(config_path)); root = Path(output).resolve()
    fresh_m1=source.get('planningMode')==host_m1.MODE
    if 'planningMode' in source and not fresh_m1:
        raise ValueError('HOST_PLANNING_MODE_UNSUPPORTED')
    if fresh_m1:
        if any(source.get(k) for k in ('seed','reviewedSnapshot','materialReuse','visualTextures','backgroundRegion')):
            raise ValueError('FRESH_M1_FORBIDS_PREPLANNED_INPUTS')
        planner=host_review._identity(source['m1Planner'])
        if source.get('candidateAuthors')!=[planner]:raise ValueError('FRESH_M1_AUTHOR_REQUIRED')
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
    if source.get('reviewedSnapshotPolicy') and not source.get('reviewedSnapshot'):
        raise ValueError('REVIEWED_SNAPSHOT_POLICY_REQUIRES_SNAPSHOT')
    if root.exists(): raise ValueError('FRESH_HOST_RUN_REQUIRED')
    source.setdefault('timingPolicy', host_timing.POLICY)
    if source['timingPolicy'] != host_timing.POLICY:
        raise ValueError('HOST_TIMING_POLICY_UNKNOWN')
    source.setdefault('generationMode','sheets')
    if source['generationMode'] not in ('single','sheets'):
        raise ValueError('HOST_GENERATION_MODE_UNSUPPORTED')
    planning_capacity.configure(source,fresh_m1)
    host_planning.configure(source,fresh_m1)
    from .generation_groups import configured_policy
    configured_policy(source,source['generationMode'],'context-crops')
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
    from . import host_body_profile, body_registration, body_coverage
    from .visual_policy import load_input, _decode, warning_policy, warnings_only
    policy_data = load_input(source.get('visualPolicy'))
    visual_policy = _decode(policy_data) if policy_data is not None else None
    mode=source.get('visualReviewMode','bound-policy')
    if mode not in ('bound-policy','warning'):
        raise ValueError('HOST_VISUAL_REVIEW_MODE_UNSUPPORTED')
    if mode=='warning':
        if visual_policy is not None and not warnings_only(visual_policy):
            raise ValueError('WARNING_MODE_REQUIRES_V5_POLICY_NEW_RUN')
        visual_policy=visual_policy or warning_policy()
    if warnings_only(visual_policy):
        source['visualReviewMode']='warning'
    host_sheet_fallback.configure(source)
    composite_review.configure(source,fast=host_sheet_fallback.final_composite_first(source))
    material_review_dispatch.configure(source,fast=host_sheet_fallback.local(source))
    source.setdefault('maximumConcurrentImageCalls',3 if host_sheet_fallback.local(source) else 1)
    experimental_executor.concurrency(dict(maximumConcurrentCalls=source['maximumConcurrentImageCalls']))
    host_layout_registration.configure(source,fast=host_sheet_fallback.final_composite_first(source))
    if host_sheet_fallback.local(source):
        source.setdefault('bodyUnresolvedPolicy',host_body_observation.UNRESOLVED_POLICY)
    if 'bodyUnresolvedPolicy' in source and (source['bodyUnresolvedPolicy']!=host_body_observation.UNRESOLVED_POLICY
            or source.get('visualReviewMode')!='warning' or not host_sheet_fallback.local(source)):
        raise ValueError('BOUND_WARNING_BODY_UNRESOLVED_POLICY_REQUIRED')
    source.setdefault('bodyObservationPolicy', host_body_profile.SOFT_EFFECTS
        if visual_policy is not None and visual_policy.get('minorGeometry') == 'record' else host_body_profile.POLICY)
    host_body_profile.validate(source['bodyObservationPolicy'])
    if warnings_only(visual_policy) and not host_body_profile.alpha_profile(source['bodyObservationPolicy']):
        raise ValueError('WARNING_MODE_REQUIRES_ALPHA_BODY_PROFILE')
    if source['bodyObservationPolicy'] == host_body_profile.SOFT_EFFECTS:
        source.setdefault('bodyCoveragePolicy', body_coverage.POLICY)
    if ('bodyFitPolicy' not in source and host_body_profile.alpha_profile(source['bodyObservationPolicy'])
            and visual_policy is not None and visual_policy.get('minorGeometry') == 'record'):
        source['bodyFitPolicy'] = dict(kind=body_registration.FIT_POLICY,
            maximumResidualPixels=32, denseBoundaryMarginPixels=4)
    body_registration.validate_fit_policy(source.get('bodyFitPolicy'), visual_policy)
    host_body_profile.validate_binding(source['bodyObservationPolicy'], source.get('bodyFitPolicy'), source.get('bodyCoveragePolicy'))
    prior=_reviewed_snapshot(source) if source.get('reviewedSnapshot') else None
    version=source.get('contextPromptVersion',prior[1]['contextPromptVersion'] if prior else 'v13')
    if version not in ('v7','v8','v9','v10','v11','v12','v13'):raise ValueError('HOST_CONTEXT_PROMPT_VERSION')
    source.setdefault('sheetSeamPolicy',NEAREST_SEAM)
    validate_seam_policy(source['sheetSeamPolicy'])
    if source['sheetSeamPolicy'] == FAINT_GLOW_SEAM and (
            not composite_review.enabled(source) or not host_sheet_fallback.final_composite_first(source) or
            source.get('sheetCompositePolicy') != host_sheet_fallback.PREPARED_COMPOSITE_POLICY):
        raise ValueError('FAINT_GLOW_SEAM_REQUIRES_BOUND_WARNING_FINAL_COMPOSITE')
    root.mkdir(parents=True); inputs=root/'inputs';inputs.mkdir()
    for key in ('seed','original','planningNotes','visualPolicy','visualTextures','materialReuse','layoutContract'):
        if source.get(key):
            path=Path(source[key]);target=inputs/(key+path.suffix)
            target.write_bytes(path.read_bytes());source[key]=str(target)
    if mode=='warning' and policy_data is None:
        target=inputs/'visualPolicy.json';save(target,visual_policy)
        source['visualPolicy']=str(target)
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
        planningMode=host_m1.MODE if fresh_m1 else 'verified-prior-independent-host-review' if prior else 'offline-agent-seed-independent-host-review', m1ModelExecuted=False,
        **(dict(newM2ReviewPerformed=False,priorReviewedSnapshotDigest=prior[1]['digest'],priorM2ResponseSha256=prior[1]['reviewSha256']) if prior else {}),
        generationReference='context-crops', contextPromptVersion=version))
    _control(root, host_timing.NAME, dict(kind='ui_host_timing_event_v1', action='initialized'))
    host_timing.bound(root, config, 'planning_generate' if fresh_m1 else 'planning_review')
    try:
        if fresh_m1:
            host_m1.prepare(root/'planning-m1',config)
            _scope(root,config,'planning_generate',root/'planning-m1/request.json',root/'planning-m1')
            _checkpoint(root)
            return status(root)
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
            host_layout_registration.freeze(root,config)
            layout_path=root/'frozen-layout-contract.json'
            experimental_executor.prepare(frozen,prior[1]['digest'],root/'images',
                layout_contract=layout_path if layout_path.exists() else None,
                maximum_concurrent_calls=config.get('maximumConcurrentImageCalls',1))
            _state(root,config,'images');_checkpoint(root)
            return status(root)
        host_review.prepare(config['seed'],config['original'],root/'planning',config['contract'],
            seed_author=config['candidateAuthors'], planning_notes=config.get('planningNotes'),
            visual_policy=config.get('visualPolicy'),visual_textures=config.get('visualTextures'),material_reuse=config.get('materialReuse'),
            max_calls=config['maximumImageCalls'],generation_mode=config['generationMode'],background_region=config.get('backgroundRegion'),
            background_region_digest=config.get('backgroundRegionDigest'),context_prompt_version=version,
            generation_grouping_policy=config.get('generationGroupingPolicy'))
        _scope(root,config,'planning_review',root/'planning/m2/request.json',root/'planning/m2')
    except Exception as exc:
        _state(root,config,'failed',reason=str(exc),automaticRetry=False)
        _checkpoint(root);raise
    _checkpoint(root)
    return status(root)


def _warning_report(root):
    return read(root/('final-composite-warning-report.json' if (root/'final-composite-warning-report.json').exists()
                      else 'visual-warning-report.json'))


@operation
def status(run):
    root=Path(run).resolve();config,state=_load(root);stage=state['stage']
    result=dict(stage=stage,configDigest=config['digest'],
        generationMode=config.get('generationMode','sheets'),
        planningMode=config['planningMode'],m1ModelExecuted=config['m1ModelExecuted'],
        FullAutomationExecutionCompleted=stage=='complete',FullReferenceToDeliveryExecutionCompleted=False,
        visualAcceptancePending=True,
        humanVisualAcceptance=False,originalDagPromoted=False,automaticRetries=0,
        notProviderReceipt=True,notCryptographicallyPlatformVerified=True)
    if config['planningMode']==host_m1.MODE:
        proof=root/'planning-m1/exchange-provenance.json'
        result['m1ModelExecuted']=proof.is_file()
        if proof.is_file():host_m1.verify_exchange(root/'planning-m1')
        result['FullReferenceToDeliveryExecutionCompleted']=stage=='complete' and proof.is_file()
    result.update(maximumModelCallSeconds=config['maximumModelCallSeconds'],maximumImageCallSeconds=config['maximumImageCallSeconds'])
    if config.get('planningPreflightPolicy'):
        repairs=len(list((root/'scopes/planning_repair').glob('*-submission.json')))
        rereviews=len(list((root/'scopes/planning_rereview').glob('*-submission.json')))
        planning_calls=len(list((root/'scopes').glob('planning*/*-submission.json')))
        result.update(planningPreflightPolicy=config['planningPreflightPolicy'],
            planningRepairPolicy=config['planningRepairPolicy'],maximumPlanningRepairCalls=config['maximumPlanningRepairCalls'],
            maximumPlanningModelCalls=2+config['maximumPlanningRepairCalls'],planningModelCallsUsed=planning_calls,
            planningRepairCallsUsed=repairs,planningRereviewCallsUsed=rereviews,
            planningCallCountBasis='consumed-local-reservations; not provider execution telemetry')
        selection=host_planning.selected(root)
        if selection:
            manifest,report=host_planning.verify_derivation(selection)
            result.update(candidatePlan=dict(path=str(selection/'candidate.json'),sha256=report['candidateSha256']),
                planningPreflight=report['after'],candidateDerivationSha256=digest(selection/'derivation.json'))
    if planning_capacity.report_path(root).is_file():
        capacity=verified(planning_capacity.report_path(root))
        result['planningCapacity']={key:capacity[key] for key in (
            'materialCount','plannedCalls','sheetCalls','standaloneCalls','requiredCalls','maximumCalls','exceeded','status')}
    if 'bodyReviewPolicy' in config:
        result['bodyReviewPolicy']=config['bodyReviewPolicy']
    if 'layoutRegistrationPolicy' in config:
        result['layoutRegistrationPolicy']=config['layoutRegistrationPolicy']
    if config.get('visualReviewMode')=='warning':
        result.update(visualReviewMode='warning',strictVisualReviewPassed=False,
                      finalCompositeVisualAcceptancePending=True)
        if stage in ('complete','diagnostic_complete'):
            result['visualWarningCount']=_warning_report(root)['warningCount']
    if composite_review.FIELD in config:
        result[composite_review.FIELD]=config[composite_review.FIELD]
    if composite_review.enabled(config):
        completed=(root/'final-review/result.json').is_file()
        reservations=len(list((root/'scopes'/(composite_review.STAGE+'-'+composite_review.KEY)).glob('*-submission.json')))
        result.update(perRequestMaterialReviewCalls=0,maximumCompositeReviewCalls=1,
                      compositeReviewCompleted=completed,compositeReviewCalls=reservations,
                      completedCompositeReviewCalls=1 if completed else 0,
                      compositeReviewCallCountBasis='consumed-local-reservations; not provider execution telemetry')
        if (root/'final-composite-warning-report.json').is_file():
            result['finalCompositeReviewReport']=dict(path='final-composite-warning-report.json',
                sha256=digest(root/'final-composite-warning-report.json'))
    if 'newM2ReviewPerformed' in config:result['newM2ReviewPerformed']=config['newM2ReviewPerformed']
    if config.get('backgroundVisualReviewPolicy'):
        result.update(deferredBackgroundVisualReview=True,
            backgroundVisualReviewPolicy=config['backgroundVisualReviewPolicy'],finalCompositeVisualAcceptancePending=True)
    if stage in MODEL_STAGES:
        scope=root/state['scope']; bound=verified(scope/'scope.json')
        rows=bound.get('requests',[bound])
        for row in rows:
            host_review._bound_files(Path(row['requestDirectory']),row['inputs'])
            if digest(Path(row['requestPath']))!=row['requestSha256']:raise ValueError('HOST_SCOPE_REQUEST_CHANGED')
        result.update(scopeDigest=bound['digest'],scopeDirectory=str(scope),maximumCalls=bound['maximumCalls'])
        pending,outstanding,ready,slots=material_review_dispatch.availability(bound,rows,
            {row.get('requestId','planning') for row in rows if (scope/(row.get('requestId','planning')+'-received.json')).exists()},
            {row.get('requestId','planning') for row in rows if (scope/(row.get('requestId','planning')+'-submission.json')).exists()})
        if ready:result['requestSha256']=ready[0]['requestSha256']
        elif pending:result['requestSha256']=pending[0]['requestSha256']
        result['status']=('awaiting_authorization' if not (scope/'authorization.json').exists() else
            'ready' if ready and slots else 'awaiting_result')
        if stage=='material_review':
            result.update(maximumConcurrentCalls=bound.get('maximumConcurrentCalls',1),
                outstandingRequestIds=[row['requestId'] for row in outstanding],
                unreservedRequestCount=len(ready),availableReviewSlots=min(slots,len(ready)))
    elif stage=='images':
        result.update(experimental_executor.status(root/'images'))
        result['scopeDigest']=verified(root/'images/job.json')['digest']
    elif stage=='body_observation':
        result.update(host_body_observation.status(root/'body'))
        result['scopeDigest']=verified(root/'body/job.json')['digest']
    elif stage=='diagnostic_complete':
        report=_warning_report(root)
        result.update(status='diagnostic_complete_pending_visual_acceptance',deliveryMode='diagnostic',
            diagnosticExecutionCompleted=True,independentMaterialDeliveryComplete=False,
            unresolvedMaterialIds=report['unresolvedMaterialIds'],
            diagnosticDelivery=str(root/report['diagnosticDelivery']))
        if 'layoutRegistration' in report:result['layoutRegistration']=report['layoutRegistration']
        if 'materialRepairPlan' in report:result['materialRepairPlan']=report['materialRepairPlan']
    else: result['status']='complete_pending_visual_acceptance' if stage=='complete' else 'failed_no_retry'
    if 'reason' in state: result['reason']=state['reason']
    if (root/'transaction.json').exists(): result['status']='interrupted_transaction_resume_required'
    return result


@host_timing.track('authorize')
@operation
def authorize(run, scope_digest, approval):
    root=Path(run).resolve()
    with lock(root):
        config,state=_load(root);stage=state['stage']
        if not isinstance(approval,str) or not approval.strip():raise ValueError('EXPLICIT_BOUND_APPROVAL_REQUIRED')
        if stage in MODEL_STAGES:
            folder=root/state['scope'];scope=verified(folder/'scope.json')
            if scope['digest']!=scope_digest:raise ValueError('EXPLICIT_BOUND_APPROVAL_REQUIRED')
            if (folder/'authorization.json').exists() or list(folder.glob('*-submission.json')):raise ValueError('HOST_SCOPE_ALREADY_AUTHORIZED')
            record(folder/'authorization.json',dict(scopeDigest=scope_digest,approval=approval,maximumCalls=scope['maximumCalls']))
        elif stage=='images': experimental_executor.authorize(root/'images',scope_digest,approval)
        elif stage=='body_observation':host_body_observation.authorize(root/'body',scope_digest,approval)
        else:raise ValueError('HOST_STAGE_NOT_AUTHORIZABLE')
        _checkpoint(root)
    return status(root)


@host_timing.track('next')
@operation
def next_request(run, *, count=1):
    root=Path(run).resolve()
    if type(count) is not int or not 1 <= count <= material_review_dispatch.MAX_CONCURRENT:
        raise ValueError('FINITE_HOST_RESERVATION_COUNT_REQUIRED')
    with lock(root):
        config,state=_load(root);stage=state['stage']
        if (root/'transaction.json').exists():raise ValueError('HOST_RESUME_REQUIRED')
        if stage in ('failed','complete','diagnostic_complete'):raise ValueError('HOST_NO_NEXT_REQUEST')
        if count!=1 and stage not in ('material_review','images'):
            raise ValueError('MULTIPLE_RESERVATIONS_ONLY_FOR_IMAGES_OR_MATERIAL_REVIEW')
        if stage in MODEL_STAGES:
            folder=root/state['scope'];scope=verified(folder/'scope.json')
            if not (folder/'authorization.json').exists():raise ValueError('HOST_SCOPE_AUTHORIZATION_REQUIRED')
            auth=verified(folder/'authorization.json')
            if auth['scopeDigest']!=scope['digest']:raise ValueError('HOST_AUTHORIZATION_CHANGED')
            rows=scope.get('requests',[scope])
            pending,outstanding,ready,slots=material_review_dispatch.availability(scope,rows,
                {row.get('requestId','planning') for row in rows if (folder/(row.get('requestId','planning')+'-received.json')).exists()},
                {row.get('requestId','planning') for row in rows if (folder/(row.get('requestId','planning')+'-submission.json')).exists()})
            if not pending:raise ValueError('HOST_SCOPE_COMPLETE')
            if not ready or not slots:
                raise ValueError('HOST_RESERVED_NO_RESUBMIT')
            if stage in ('planning_repair','planning_rereview'):
                used=len(list((root/'scopes').glob('planning*/*-submission.json')))
                extra=sum(len(list((root/'scopes'/s).glob('*-submission.json')))
                    for s in ('planning_repair','planning_rereview'))
                if (not host_planning.enabled(config) or used>=4 or extra>=config['maximumPlanningRepairCalls']):
                    raise ValueError('PLANNING_REPAIR_BUDGET_EXHAUSTED')
            if count>slots:raise ValueError('HOST_REVIEW_CONCURRENCY_LIMIT_NO_RESUBMIT')
            reservations=[]
            for row in ready[:count]:
                key=row.get('requestId','planning')
                submission=record(folder/(key+'-submission.json'),dict(scopeDigest=scope['digest'],requestId=key,
                    authorizationDigest=auth['digest'],nonce=secrets.token_hex(16),
                    evidenceBasis='Local reservation only; not proof of model execution.'))
                reservations.append(dict(currentRequest=row,submissionDigest=submission['digest']))
            result=(dict(scope,reservations=reservations) if count!=1 else
                dict(scope,**({'currentRequest':reservations[0]['currentRequest']} if stage in ('material_review',composite_review.STAGE) else {}),
                    submissionDigest=reservations[0]['submissionDigest']))
        elif stage=='images':
            result=experimental_executor.next_request(root/'images',count=count)
            metadata=dict(destination=config['imageDestination'],maximumCalls=1,
                maximumCallSeconds=config['maximumImageCallSeconds'])
            if count!=1:
                result['reservations']=[dict(currentRequest=dict(row,**metadata),
                    submissionDigest=row['submissionDigest']) for row in result['reservations']]
                metadata['maximumCalls']=len(result['reservations'])
            result.update(metadata)
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


@host_timing.track('receive')
@operation
def receive(run, submission_digest, response, *, host_attestation=None, dispatch_evidence=None, return_evidence=None,
            refill_images=False):
    root=Path(run).resolve()
    if type(refill_images) is not bool:raise ValueError('HOST_IMAGE_REFILL_BOOLEAN_REQUIRED')
    if not isinstance(submission_digest,str) or re.fullmatch('[0-9a-f]{64}',submission_digest) is None:
        raise ValueError('HOST_SUBMISSION_DIGEST_REQUIRED')
    with lock(root):
        config,state=_load(root);stage=state['stage']
        if stage in MODEL_STAGES:
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
        host_timing.consumed(submission_digest)
        record(root/'transaction.json',dict(operation='receive',stage=stage,submissionDigest=submission_digest))
        try:
            if stage!='images':
                attestation=read(Path(host_attestation))
                actor=attestation.get('plannerId') if stage=='planning_generate' else attestation.get('repairerId') if stage=='planning_repair' else attestation.get('reviewerId')
                expected=(config['m1Planner'] if stage=='planning_generate' else
                    config['planningRepairer'] if stage=='planning_repair' else
                    config['planningRepairReviewer'] if stage=='planning_rereview' else
                    config[('planning' if stage=='planning_review' else 'material' if stage in ('material_review',composite_review.STAGE) else 'body')+'Reviewer'])
                if actor!=expected:
                    raise ValueError('FROZEN_HOST_REVIEWER_REQUIRED')
            if stage=='planning_generate':
                host_m1.receive(root/'planning-m1',response,host_attestation=host_attestation,
                    dispatch_evidence=dispatch_evidence,return_evidence=return_evidence)
                record(scope/'planning-received.json',dict(submissionDigest=submission_digest,responseSha256=digest(Path(response))))
            elif stage in ('planning_review','planning_rereview'):
                planning=root/('planning' if stage=='planning_review' else 'planning-rereview')
                host_review.receive(planning,response,bound['requestSha256'],
                    response_sha256=digest(Path(response)),host_attestation=host_attestation,
                    dispatch_evidence=dispatch_evidence,return_evidence=return_evidence)
                host_review.verify_run(planning,allow_issues=host_planning.enabled(config))
                record(scope/'planning-received.json',dict(submissionDigest=submission_digest,responseSha256=digest(Path(response))))
            elif stage=='planning_repair':
                host_planning.receive_repair(root/'planning-repair',response,host_attestation=host_attestation,
                    dispatch_evidence=dispatch_evidence,return_evidence=return_evidence)
                record(scope/'planning-received.json',dict(submissionDigest=submission_digest,responseSha256=digest(Path(response))))
            elif stage=='material_review':
                host_material_review.receive(root/'reviews'/key,response,bound['requestSha256'],
                    response_sha256=digest(Path(response)),host_attestation=host_attestation,
                    dispatch_evidence=dispatch_evidence,return_evidence=return_evidence)
                material_result=read(root/'reviews'/key/'result.json')
                if material_result['status']==host_material_review.IDENTITY_UNRESOLVED_STATUS:
                    _,review_result=host_material_review.verify_unresolved_run(root/'reviews'/key)
                    if config.get('identityObservationPolicy')!=host_material_review.IDENTITY_POLICY or not host_sheet_fallback.local(config):
                        raise ValueError('BOUND_WARNING_IDENTITY_POLICY_REQUIRED')
                    (root/'material-identity-fallback').mkdir(exist_ok=True)
                    record(root/'material-identity-fallback'/(key+'.json'),dict(
                        policy=config['identityObservationPolicy'],requestSha256=digest(root/'reviews'/key/'request.json'),
                        resultSha256=digest(root/'reviews'/key/'result.json'),warnings=[dict(
                            w,requestId=key) for w in review_result['warnings'] if w.get('code')=='MATERIAL_IDENTITY_UNRESOLVED']))
                else:
                    _,review_result=host_material_review.verify_run(root/'reviews'/key)
                    if review_result['status'] not in ('reviewed_pending_visual_acceptance',host_material_review.BACKGROUND_DEFERRED_STATUS):raise ValueError('HOST_MATERIAL_REVIEW_BLOCKED')
                record(scope/(key+'-received.json'),dict(submissionDigest=submission_digest,responseSha256=digest(Path(response))))
            elif stage==composite_review.STAGE:
                composite_review.receive(root,response,host_attestation=host_attestation,
                    dispatch_evidence=dispatch_evidence,return_evidence=return_evidence)
                record(scope/(key+'-received.json'),dict(submissionDigest=submission_digest,responseSha256=digest(Path(response))))
            elif stage=='images':experimental_executor.receive(root/'images',submission_digest,response)
            else:
                try:
                    host_body_observation.receive(root/'body',submission_digest,response,
                        host_attestation_path=host_attestation,dispatch_evidence_path=dispatch_evidence,
                        return_evidence_path=return_evidence)
                except ValueError as error:
                    if (str(error)!='BODY_OBSERVATION_UNRESOLVED' or
                            config.get('bodyUnresolvedPolicy')!=host_body_observation.UNRESOLVED_POLICY or
                            not host_body_observation.status(root/'body').get('unresolvedMaterialIds')):
                        raise
            (root/'transaction.json').unlink();_checkpoint(root)
        except Exception as exc:
            # Preserve exact answers even if the frozen reviewer identity is wrong.
            rejected=root/'rejected'/submission_digest;rejected.mkdir(parents=True,exist_ok=True)
            for path,name in ((response,'response'),(host_attestation,'attestation'),(dispatch_evidence,'dispatch'),(return_evidence,'return')):
                if path is not None and Path(path).is_file():(rejected/name).write_bytes(Path(path).read_bytes())
            (root/'transaction.json').unlink(missing_ok=True)
            _terminal(root,config,str(exc));raise
    result=resume(root)
    if refill_images and result['stage']=='images' and result['status']=='ready':
        result=dict(result,nextImageRequest=next_request(root))
    return result


@host_timing.track('fail')
def fail(run, submission_digest, reason):
    root=Path(run).resolve()
    if not isinstance(submission_digest,str) or re.fullmatch('[0-9a-f]{64}',submission_digest) is None:
        raise ValueError('HOST_SUBMISSION_DIGEST_REQUIRED')
    with lock(root):
        config,state=_load(root)
        if not reason.strip():raise ValueError('HOST_FAILURE_REASON_REQUIRED')
        if state['stage'] in MODEL_STAGES:
            scope=root/state['scope'];matches=[verified(p) for p in scope.glob('*-submission.json') if verified(p)['digest']==submission_digest]
            if len(matches)!=1:raise ValueError('HOST_RESERVED_SUBMISSION_REQUIRED')
            submission=matches[0]
            if (scope/(submission['requestId']+'-received.json')).exists():raise ValueError('HOST_ALREADY_RECEIVED')
            record(scope/'failed.json',dict(submissionDigest=submission_digest,reason=reason,automaticRetry=False))
        elif state['stage']=='images':experimental_executor.fail(root/'images',submission_digest,reason)
        elif state['stage']=='body_observation':host_body_observation.fail(root/'body',submission_digest,reason)
        else:raise ValueError('HOST_TERMINAL_NO_RETRY')
        host_timing.consumed(submission_digest)
        _terminal(root,config,reason)
    return status(root)


def _material_stage(root,config,keys):
    from .received_source_batch import received_sources
    with received_sources(root/'images') as source_batch:
        return _prepare_material_stage(root,config,keys,source_batch)


def _prepare_material_stage(root,config,keys,source_batch):
    rows=[]; preparation_warnings=[]
    background_id=None
    if config.get('backgroundVisualReviewPolicy'):
        from . import background_region_pipeline as bg_region
        from .freeze_visual import inspect
        background_id=bg_region.snapshot_input(root/'frozen',inspect(root/'frozen'))['materialId']
    for key in keys:
        folder=root/'reviews'/key
        prepared=host_material_review.prepare(root/'images',key,folder,material_authors=config['materialAuthors'],
                                     review_registry=root/'review-registry',
                                     source_batch=source_batch,
                                     review_dispatch_policy=config.get('materialReviewDispatchPolicy'),
                                     identity_observation_policy=config.get('identityObservationPolicy'),
                                     sheet_seam_policy=config.get('sheetSeamPolicy',STRICT_SEAM),
                                     **({'background_visual_review_policy':config['backgroundVisualReviewPolicy']}
                                        if key==background_id else {}))
        if prepared['status']=='blocked_no_retry':
            if config.get('materialPreparationPolicy')==host_sheet_fallback.PREPARATION_POLICY:
                from .native_clipping_warning import native_clipping_evidence
                _,row,receipt,raw=host_material_review.source(root/'images',key,source_batch=source_batch)
                targets={a['id']:a['output_size'] for a in read(root/'frozen/execution-plan.candidate.json')['assets']}
                report_path=folder/'processed/report.json'
                warning=native_clipping_evidence(raw,receipt['rawSha256'],targets[key],read(report_path),prepared) if report_path.exists() and row.get('kind')!='sheet' else None
                if warning is not None:
                    preparation_warnings.append(dict(warning,requestId=key,materialIds=[key],
                        preparationResultSha256=digest(folder/'result.json'),reportSha256=digest(report_path)))
                    continue
            reason='HOST_MATERIAL_PREPARATION_BLOCKED:requestId='+key+':reason='+prepared['reason']
            report=folder/'processed/report.json'
            if report.is_file():
                try:issues=read(report).get('issues')
                except (OSError,ValueError,AttributeError):issues=None
                if issues:reason+=':issues='+json.dumps(issues,separators=(',',':'))
            raise ValueError(reason)
        row=dict(requestId=key,requestPath=str(folder/'request.json'),requestSha256=digest(folder/'request.json'),
                 requestDirectory=str(folder/'review'),inputs=_files(folder/'review'))
        if config.get('materialReviewDispatchPolicy')==material_review_dispatch.POLICY:
            row.update(reviewPacketPath=str(folder/'review'/material_review_dispatch.NAME),
                       reviewPacketSha256=digest(folder/'review'/material_review_dispatch.NAME))
        rows.append(row)
    if preparation_warnings:
        record(root/'material-preparation-fallback.json',dict(policy=config['materialPreparationPolicy'],warnings=preparation_warnings))
    if not rows:
        return False
    scope=root/'scopes/material_review';scope.mkdir(parents=True)
    record(scope/'scope.json',dict(kind='ui_host_material_batch_scope_v1',stage='material_review',requests=rows,
        destination=config['materialDestination'],model=config['materialModel'],effort=config['materialEffort'],
        reviewerId=config['materialReviewer'],maximumCalls=len(rows),automaticRetries=0,
        maximumConcurrentCalls=min(config.get('maximumConcurrentMaterialReviews',1),len(rows)),
        maximumCallSeconds=config['maximumModelCallSeconds'],
        stops=(['failed','unknown-receipt','invalid-technical-contract','indeterminate','timeout']
            if config.get('visualReviewMode')=='warning' else ['failed','unknown','unresolved','indeterminate','timeout']),notProviderReceipt=True,
        notCryptographicallyPlatformVerified=True))
    _state(root,config,'material_review',scope='scopes/material_review')
    return True


def _comparison(root, *, diagnostic=False):
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
    atlas.save(folder/('candidate-material-atlas.png' if diagnostic else 'independent-material-atlas.png'))
    combined=Image.new('RGBA',(width*3,height+28),'white')
    labels=('Unverified candidate cells','Diagnostic viewport - review required') if diagnostic else ('Independent materials','Recomposed viewport')
    for i,(label,image) in enumerate((('Original',original),(labels[0],atlas),(labels[1],preview))):
        combined.alpha_composite(image,(i*width,28));ImageDraw.Draw(combined).text((i*width+8,7),label,fill='black')
    combined.save(folder/'three-way-comparison.png')
    save(folder/'comparison.json',dict(kind='ui_host_three_way_comparison_v1',visualAcceptancePending=True,
         **({'diagnosticOnly':True,'independentSeparationVerified':False} if diagnostic else {}),
         originalSha256=digest(root/'delivery/original-reference.png'),viewportSha256=digest(root/'delivery/viewport-preview.png'),
         materialSha256={mid:digest(Path(path)) for mid,path in materials.items()},
         files={p.name:digest(p) for p in folder.iterdir() if p.is_file()}))


def _diagnostic_comparison(root):
    report=read(root/'visual-warning-report.json')
    delivery=Path(report['diagnosticDelivery'])
    if delivery not in (Path('diagnostic-output/delivery'),Path('layout-output/delivery')):
        raise ValueError('HOST_DIAGNOSTIC_DELIVERY_PATH')
    _comparison(root/delivery.parent,diagnostic=True)


def _planning_review_stage(root,config,bundle,stage):
    manifest,report=host_planning.verify_derivation(bundle)
    if report['after']['technicalErrors']:raise ValueError('PLANNING_PREFLIGHT_BLOCKED')
    host_layout_registration.preflight_plan(root,config)
    planning_capacity.prepare(root,config)
    target=root/('planning' if stage=='planning_review' else 'planning-rereview')
    host_review.prepare(bundle/'candidate.json',config['original'],target,config['contract'],
        seed_author=manifest['candidateAuthors'],planning_notes=config.get('planningNotes'),
        visual_policy=config.get('visualPolicy'),max_calls=config['maximumImageCalls'],
        generation_mode=config.get('generationMode','sheets'),context_prompt_version=config['contextPromptVersion'],
        m1_source=root/'planning-m1',candidate_derivation=bundle,
        generation_grouping_policy=config.get('generationGroupingPolicy'))
    _scope(root,config,stage,target/'m2/request.json',target/'m2')
    if stage=='planning_rereview':_planning_branch_authorization(root,config,stage)


def _planning_branch_authorization(root,config,stage):
    """Bind the conditional M1 approval to this exact derived request once."""
    original=verified(root/'scopes/planning_generate/scope.json')
    auth=verified(root/'scopes/planning_generate/authorization.json')
    if (not host_planning.enabled(config) or auth['scopeDigest']!=original['digest'] or
            original.get('conditionalPlanningRepair',{}).get('maximumAdditionalCalls')!=2):
        raise ValueError('PLANNING_REPAIR_PREAUTHORIZATION_REQUIRED')
    scope=verified(root/'scopes'/stage/'scope.json')
    record(root/'scopes'/stage/'authorization.json',dict(scopeDigest=scope['digest'],
        approval='Conditional planning repair approval inherited from the immutable M1 scope.',
        maximumCalls=1,parentAuthorizationDigest=auth['digest'],parentScopeDigest=original['digest'],
        triggerSha256=digest(root/'planning-repair/trigger.json'),configDigest=config['digest']))


def _planning_repair_stage(root,config,bundle, *, prior_review=None):
    if not host_planning.enabled(config):
        report=read(bundle/'report.json')
        raise ValueError('PLANNING_PREFLIGHT_BLOCKED_REPAIR_DISABLED:'+report['after']['technicalErrors'][0]['code'])
    if (root/'scopes/planning_repair').exists() or (root/'planning-repair').exists():
        raise ValueError('PLANNING_REPAIR_BUDGET_EXHAUSTED')
    _,report=host_planning.verify_derivation(bundle)
    host_planning.prepare_repair(root/'planning-repair',config,bundle,report,prior_review=prior_review)
    _scope(root,config,'planning_repair',root/'planning-repair/request.json',root/'planning-repair')
    _planning_branch_authorization(root,config,'planning_repair')


@host_timing.track('resume')
@operation
def resume(run):
    """Advance only deterministic stages. A pending reservation is never rebuilt."""
    root=Path(run).resolve()
    with lock(root):
        config,state=_load(root);stage=state['stage']
        if (root/'transaction.json').exists():
            # No external call is replayed after an interrupted receive transaction.
            _terminal(root,config,'INTERRUPTED_TRANSACTION_NO_RESUBMIT')
            (root/'transaction.json').unlink();return status(root)
        if stage in ('failed','complete','diagnostic_complete'):return status(root)
        advancing=stage in ('planning_generate','planning_review','planning_repair','planning_rereview') and (root/state['scope']/'planning-received.json').exists()
        if stage=='material_review':
            scope=root/state['scope'];rows=verified(scope/'scope.json')['requests']
            advancing=all((scope/(row['requestId']+'-received.json')).exists() for row in rows)
        if stage==composite_review.STAGE:
            advancing=(root/state['scope']/(composite_review.KEY+'-received.json')).exists()
        if stage=='images':advancing=experimental_executor.status(root/'images')['status']=='raw_complete'
        if stage=='body_observation':
            current=host_body_observation.status(root/'body')
            advancing=current.get('consumedCalls',current['sealedCalls'])==current['maximumCalls'] and current['status'] in ('ready','completed')
        if not advancing:return status(root)
        record(root/'transaction.json',dict(operation='deterministic-advance',stage=stage))
        try:
            if stage=='planning_generate':
                host_m1.verify(root/'planning-m1')
                if config.get('planningPreflightPolicy')==host_planning.PREFLIGHT:
                    _state(root,config,'planning_preflight',sourceStage=stage,generationCalls=0,modelCalls=0)
                    bundle=host_planning.derive(root/'planning-candidates/initial',root/'planning-m1',config)
                    report=read(bundle/'report.json')
                    if report['after']['technicalErrors']:_planning_repair_stage(root,config,bundle)
                    else:_planning_review_stage(root,config,bundle,'planning_review')
                else:
                    host_layout_registration.preflight_plan(root,config)
                    planning_capacity.prepare(root,config)
                    host_review.prepare(root/'planning-m1/draft.json',config['original'],root/'planning',config['contract'],
                        seed_author=config['candidateAuthors'],planning_notes=config.get('planningNotes'),
                        visual_policy=config.get('visualPolicy'),max_calls=config['maximumImageCalls'],
                        generation_mode=config.get('generationMode','sheets'),context_prompt_version=config['contextPromptVersion'],
                        m1_source=root/'planning-m1',generation_grouping_policy=config.get('generationGroupingPolicy'))
                    _scope(root,config,'planning_review',root/'planning/m2/request.json',root/'planning/m2')
            elif stage=='planning_repair':
                host_planning.verify_repair(root/'planning-repair')
                _state(root,config,'planning_preflight',sourceStage=stage,generationCalls=0,modelCalls=0)
                prior=root/'planning' if (root/'planning/.dag/received.json').exists() else None
                bundle=host_planning.derive(root/'planning-candidates/repaired',root/'planning-m1',config,
                    repair=root/'planning-repair',prior_review=prior)
                report=read(bundle/'report.json')
                if report['after']['technicalErrors']:
                    previous=read(root/'planning-repair/trigger.json')['technicalErrors']
                    repeated={e['code'] for e in previous}&{e['code'] for e in report['after']['technicalErrors']}
                    raise ValueError('PLANNING_REPAIR_REPEATED_BLOCKER' if repeated else 'PLANNING_REPAIR_UNRESOLVED')
                _planning_review_stage(root,config,bundle,'planning_rereview')
            elif stage in ('planning_review','planning_rereview'):
                planning=root/('planning' if stage=='planning_review' else 'planning-rereview')
                checked=host_review.status(planning)
                if checked['status']=='review_blocked':
                    if stage=='planning_rereview':raise ValueError('PLANNING_REREVIEW_UNRESOLVED_BUDGET_EXHAUSTED')
                    _planning_repair_stage(root,config,host_planning.selected(root),prior_review=planning)
                    (root/'transaction.json').unlink();_checkpoint(root)
                    return status(root)
                frozen=freeze_reviewed(planning,root/'frozen',config['maximumImageCalls'],
                    generation_mode=config.get('generationMode','sheets'),generation_reference='context-crops',context_prompt_version=config['contextPromptVersion'])
                planning_capacity.verify_frozen(root,config)
                requests=read(root/'frozen/requests.json')['requests']
                visual=read(planning/'m1/draft.json')
                bodies=sum(m['role']=='foreground' for m in visual['materials'])
                if composite_review.required_calls(config,len(requests))>config['maximumMaterialReviews'] or not host_sheet_fallback.final_composite_first(config) and bodies>config['maximumBodyCalls']:
                    raise ValueError('FINITE_DOWNSTREAM_CAPACITY_EXCEEDED')
                host_layout_registration.freeze(root,config)
                layout_path=root/'frozen-layout-contract.json'
                experimental_executor.prepare(root/'frozen',frozen['digest'],root/'images',
                    layout_contract=layout_path if layout_path.exists() else None,
                    maximum_concurrent_calls=config.get('maximumConcurrentImageCalls',1))
                _state(root,config,'images')
            elif stage=='images':
                job,_=experimental_executor.load_job(root/'images')
                warnings=host_sheet_fallback.findings(root/'images',config)
                if composite_review.enabled(config):
                    if warnings:
                        record(root/'sheet-fallback.json',dict(policy=config['sheetFailurePolicy'],warnings=warnings))
                    host_sheet_fallback.build(root,config,warnings)
                    _diagnostic_comparison(root)
                    folder,_=composite_review.prepare(root,config)
                    _scope(root,config,composite_review.STAGE,folder/'request.json',folder,key=composite_review.KEY)
                elif warnings and host_sheet_fallback.local(config):
                    record(root/'sheet-fallback.json',dict(policy=config['sheetFailurePolicy'],warnings=warnings))
                    unresolved={w['requestId'] for w in warnings}
                    keys=[key for key in job['assets'] if key not in unresolved]
                    if keys:
                        if not _material_stage(root,config,keys):
                            host_sheet_fallback.build(root,config,host_sheet_fallback.warnings(root))
                            _diagnostic_comparison(root)
                            _state(root,config,'diagnostic_complete')
                    else:
                        host_sheet_fallback.build(root,config,warnings)
                        _diagnostic_comparison(root)
                        _state(root,config,'diagnostic_complete')
                elif warnings:
                    host_sheet_fallback.build(root,config,warnings)
                    _diagnostic_comparison(root)
                    _state(root,config,'diagnostic_complete')
                else:
                    if not _material_stage(root,config,job['assets']):
                        host_sheet_fallback.build(root,config,host_sheet_fallback.warnings(root))
                        _diagnostic_comparison(root)
                        _state(root,config,'diagnostic_complete')
            elif stage==composite_review.STAGE:
                _,request,_=composite_review.verify(root)
                result=verified(root/'final-review/result.json')
                if result['requestSha256']!=digest(root/'final-review/request.json') or result['responseSha256']!=digest(root/'final-review/response.json'):
                    raise ValueError('COMPOSITE_REVIEW_RESULT_CHANGED')
                report=read(root/'visual-warning-report.json')
                record(root/'final-composite-warning-report.json',dict(report,
                    materialReviewPolicy=composite_review.POLICY,composite=result['warnings'],
                    compositeReviewCompleted=True,compositeReviewCalls=1,perRequestMaterialReviewCalls=0,
                    warningCount=report['warningCount']+len(result['warnings']),
                    compositeReviewResultSha256=digest(root/'final-review/result.json')))
                _state(root,config,'diagnostic_complete')
            elif stage=='material_review':
                job,_=experimental_executor.load_job(root/'images');keys=job['assets']
                if host_sheet_fallback.local(config) and (host_sheet_fallback.warnings(root) or host_sheet_fallback.final_composite_first(config)):
                    if host_sheet_fallback.prepare_body(root,config):
                        _state(root,config,'body_observation')
                    else:
                        host_sheet_fallback.build(root,config,host_sheet_fallback.warnings(root))
                        _diagnostic_comparison(root)
                        _state(root,config,'diagnostic_complete')
                    (root/'transaction.json').unlink();_checkpoint(root)
                    return status(root)
                for key in keys:
                    if (root/'reviews'/key/'result.json').exists():host_material_review.verify_run(root/'reviews'/key)
                extraction=host_material_review.extract(root/'frozen',job['snapshotDigest'],
                    [root/'reviews'/key for key in keys],root/'extraction')
                body_config=dict(snapshot=str(root/'frozen'),snapshotDigest=job['snapshotDigest'],
                    materials=extraction['materials'],materialAuthors=config['materialAuthors'],
                    canvasPolicy=config['canvasPolicy'],canvasPolicyInstruction=config['canvasPolicyInstruction'],
                    canvasPolicyInstructionSha256=config['canvasPolicyInstructionSha256'],backgroundPolicy=config['backgroundPolicy'],
                    maximumCallSeconds=config['maximumModelCallSeconds'],destination=config['bodyDestination'],reviewerId=config['bodyReviewer'])
                # Missing fields preserve historical host-run semantics. New
                # prepare() freezes the selected profile before model execution.
                for name in ('bodyObservationPolicy','bodyFitPolicy','bodyCoveragePolicy','bodyUnresolvedPolicy'):
                    if name in config:body_config[name]=config[name]
                if (root/'frozen/material-reuse.json').exists():
                    body_config['reviewedReuseExtraction']=dict(path=str(root/'extraction'),sha256=digest(root/'extraction/result.json'))
                if (root/'frozen/background-region/plan.json').exists():
                    body_config['reviewedBackgroundExtraction']=dict(path=str(root/'extraction'),sha256=digest(root/'extraction/result.json'))
                save(root/'body-input.json',body_config)
                host_body_observation.prepare(root/'body-input.json',root/'body',config['maximumBodyCalls'],
                    model=config['bodyModel'],effort=config['bodyEffort'])
                _state(root,config,'body_observation')
            else:
                if host_sheet_fallback.local(config) and (host_sheet_fallback.warnings(root) or
                        host_body_observation.status(root/'body').get('unresolvedMaterialIds')):
                    warnings=host_sheet_fallback.warnings(root)
                    host_sheet_fallback.build(root,config,warnings)
                    _diagnostic_comparison(root)
                    _state(root,config,'diagnostic_complete')
                    (root/'transaction.json').unlink();_checkpoint(root)
                    return status(root)
                host_body_observation.finish(root/'body',root/'body-output.json')
                extraction=read(root/'extraction/result.json')
                body_viewport_delivery.build(root/'body-output.json',root/'delivery',root/'viewer',warnings=extraction['warnings'])
                if config.get('visualReviewMode')=='warning':
                    from .visual_policy import snapshot_policy
                    planning=read(root/'frozen/planning-warnings.json')['warnings']
                    body_warnings=read(root/'body-output.json').get('bodyObservationWarnings',[])
                    fit_warnings=[dict(materialId=row['materialId'], **row['geometry']['appearanceTolerance'])
                        for row in read(root/'delivery/body-provenance.json')['records']
                        if row.get('geometry',{}).get('appearanceTolerance',{}).get('visualFitWarnings')]
                    coverage_warnings=[dict(materialId=row['materialId'],
                        **row['geometry']['denseBoundaryCheck'])
                        for row in read(root/'delivery/body-provenance.json')['records']
                        if row.get('geometry',{}).get('denseBoundaryCheck',{}).get('visualCoverageWarnings')]
                    count=len(planning)+len(extraction['warnings'])+len(fit_warnings)+sum(
                        len(row['visualCoverageWarnings']) for row in coverage_warnings)+sum(
                        len(row['geometryDifferences'])+len(row['materialIssues']) for row in body_warnings)
                    save(root/'visual-warning-report.json',dict(kind='ui_visual_warning_report_v1',
                        visualPolicy=snapshot_policy(root/'frozen'), planning=planning,
                        material=extraction['warnings'], body=body_warnings, fit=fit_warnings,
                        coverage=coverage_warnings, warningCount=count,
                        executionCompleted=True,strictVisualReviewPassed=False,humanVisualAcceptance=False,
                        finalCompositeVisualAcceptancePending=True))
                _comparison(root)
                _state(root,config,'complete')
            (root/'transaction.json').unlink();_checkpoint(root)
        except Exception as exc:
            (root/'transaction.json').unlink(missing_ok=True)
            _terminal(root,config,str(exc));raise
    return status(root)


def main():
    parser=argparse.ArgumentParser(description=__doc__);commands=parser.add_subparsers(dest='command',required=True)
    for command in ('host-run','host-status','host-next','host-authorize','host-receive','host-fail','host-resume','host-timings'):
        child=commands.add_parser(command)
        if command=='host-run':child.add_argument('--config',required=True);child.add_argument('--output',required=True)
        else:child.add_argument('--run',required=True)
        if command in ('host-authorize','host-receive','host-fail'):child.add_argument('--digest',required=True)
        if command=='host-authorize':child.add_argument('--approval',required=True)
        if command=='host-next':child.add_argument('--count',type=int,default=1)
        if command=='host-fail':child.add_argument('--reason',required=True)
        if command=='host-receive':
            child.add_argument('--response',required=True)
            child.add_argument('--refill-images',action='store_true')
            for key in ('host-attestation','dispatch-evidence','return-evidence'):child.add_argument('--'+key)
    args=parser.parse_args();command=args.command
    if command=='host-run':result=prepare(args.config,args.output)
    elif command=='host-authorize':result=authorize(args.run,args.digest,args.approval)
    elif command=='host-receive':result=receive(args.run,args.digest,args.response,host_attestation=args.host_attestation,
        dispatch_evidence=args.dispatch_evidence,return_evidence=args.return_evidence,refill_images=args.refill_images)
    elif command=='host-fail':result=fail(args.run,args.digest,args.reason)
    elif command=='host-next':result=next_request(args.run,count=args.count)
    else:result={'host-status':status,'host-resume':resume,'host-timings':host_timing.report}[command](args.run)
    print(json.dumps(result,ensure_ascii=False,allow_nan=False))
