"""Bound candidate derivation and one-shot planning repair for the host controller.

No model invocation, image dispatch, ownership inference or transport retry lives
here. Every candidate is independently reviewed by the existing host exchange.
"""
from copy import deepcopy
from pathlib import Path
from jsonschema import Draft202012Validator, ValidationError
from PIL import Image

from .evaluate import read, save, digest, check_relations
from .freeze_visual import body_digest
from .host_timing import measured
from . import host_m1, host_review, host_layout_registration as layout

PREFLIGHT = 'host-planning-preflight-v1'
REPAIR = 'one-repair-independent-rereview-v1'
DISABLED = 'disabled'
RULE = 'expand-explicit-owner-envelope-v1'
VISUAL = {'SAME_LAYER_OVERLAP_REVIEW', 'REPEATED_CARD_HEIGHT_OUTLIER_REVIEW'}
LIMITS = dict(maximumEdgePixels=2, maximumEdgeFraction=.01,
              maximumAreaGrowthFraction=.02, minimumObjectIntersectionFraction=.95)


def configure(config, fresh):
    if not fresh:
        if any(k in config for k in ('planningPreflightPolicy','planningRepairPolicy',
                'maximumPlanningRepairCalls','planningRepairer','planningRepairReviewer')):
            raise ValueError('PLANNING_REPAIR_REQUIRES_FRESH_HOST_M1')
        return
    config.setdefault('planningPreflightPolicy', PREFLIGHT)
    config.setdefault('planningRepairPolicy', DISABLED)
    config.setdefault('maximumPlanningRepairCalls', 0)
    if config['planningPreflightPolicy'] != PREFLIGHT:
        raise ValueError('HOST_PLANNING_PREFLIGHT_POLICY_UNKNOWN')
    enabled=config['planningRepairPolicy']==REPAIR
    if config['planningRepairPolicy'] not in (DISABLED, REPAIR):
        raise ValueError('HOST_PLANNING_REPAIR_POLICY_UNKNOWN')
    if type(config['maximumPlanningRepairCalls']) is not int or config['maximumPlanningRepairCalls']!=(2 if enabled else 0):
        raise ValueError('PLANNING_REPAIR_EXPLICIT_TWO_CALL_BUDGET_REQUIRED')
    if enabled:
        author=host_review._identity(config['planningRepairer'])
        reviewer=host_review._identity(config['planningRepairReviewer'])
        if reviewer in set(config['candidateAuthors'])|{author}:
            raise ValueError('INDEPENDENT_PLANNING_REPAIR_REVIEWER_REQUIRED')
    elif any(k in config for k in ('planningRepairer','planningRepairReviewer')):
        raise ValueError('PLANNING_REPAIR_DISABLED')


def enabled(config):
    return config.get('planningRepairPolicy')==REPAIR


def selected(root):
    root=Path(root)
    for name in ('repaired','initial'):
        folder=root/'planning-candidates'/name
        if (folder/'derivation.json').exists():return folder
    return None


def candidate(root):
    folder=selected(root)
    return folder/'candidate.json' if folder else Path(root)/'planning-m1/draft.json'


def review_root(root):
    return Path(root)/('planning-rereview' if (Path(root)/'planning-rereview').exists() else 'planning')


def settings(config, origin):
    with Image.open(Path(origin)/'reference.png') as image:size=list(image.size)
    return dict(canvas=size,referenceSha256=digest(Path(origin)/'reference.png'),
        layoutRequired=config.get('layoutPlanningPolicy')==layout.PLANNING,
        internalTargetsPolicy=config.get('layoutInternalTargetsPolicy'))


def assess(plan, schema, bound):
    """Schema errors are repairable planning findings, never integrity waivers."""
    errors=[dict(code='PLAN_SCHEMA',path='/'+ '/'.join(map(str,e.absolute_path)),
                 validator=e.validator) for e in Draft202012Validator(schema).iter_errors(plan)]
    warnings=[]
    if not errors:
        for row in check_relations(plan):
            (warnings if row['code'] in VISUAL else errors).append(row)
        # IDs are local to typed catalogs, as in alpha.6; duplicates within any
        # catalog remain errors. Text boxes have no crop authority but must be valid.
        for row in plan.get('textRegions',[]):
            box=row.get('bboxNorm')
            if box is not None and not (box[0]<box[2] and box[1]<box[3]):
                errors.append(dict(code='BOX_ORDER',id=row['id']))
        if bound['layoutRequired'] or 'layoutRegistration' in plan:
            try:
                layout.preflight_visual(plan,bound['referenceSha256'],bound['canvas'],bound['internalTargetsPolicy'])
                errors.extend(_constraint_errors(plan['layoutRegistration']['constraints']))
            except ValidationError as exc:errors.append(dict(code='PLAN_LAYOUT_SCHEMA',path='/'+ '/'.join(map(str,exc.absolute_path))))
            except (ValueError,KeyError) as exc:errors.append(dict(code=str(exc)))
    return dict(kind='ui_host_planning_preflight_v1',policy=PREFLIGHT,
        candidateDigest=body_digest(plan),technicalErrors=errors,visualWarnings=warnings,
        status='blocked' if errors else 'program_valid',generationCalls=0,modelCalls=0,
        visualAcceptanceAsserted=False)


def _constraint_errors(constraints):
    """Reject algebraically impossible declarations without estimating artwork."""
    errors=[];intervals={}
    for row in constraints:
        a=(row['a']['materialId'],row['a']['edge']);b=(row['b']['materialId'],row['b']['edge'])
        delta=row['expectedDelta'];tolerance=row['tolerancePixels']
        if a==b and abs(delta)>tolerance:
            errors.append(dict(code='LAYOUT_SELF_CONSTRAINT_CONTRADICTION',id=row['id']))
        if a>b:a,b=b,a;delta=-delta
        intervals.setdefault((a,b),[]).append((delta-tolerance,delta+tolerance,row['id']))
    for rows in intervals.values():
        if max(r[0] for r in rows)>min(r[1] for r in rows):
            errors.append(dict(code='LAYOUT_CONSTRAINT_INTERVAL_CONTRADICTION',ids=[r[2] for r in rows]))
    return errors


def _intersection(a,b):
    return max(0,min(a[2],b[2])-max(a[0],b[0]))*max(0,min(a[3],b[3])-max(a[1],b[1]))


def normalize(plan, schema, bound):
    """Union only declared, unambiguous owner envelopes; never shrink objects."""
    before=assess(plan,schema,bound);result=deepcopy(plan);changes=[];refusals=[]
    errors=before['technicalErrors']
    if not errors or any(e['code']!='OBJECT_OUTSIDE_MATERIAL' for e in errors):
        return result,changes,refusals
    if plan['unknowns']:
        return result,changes,[dict(reason='UNRESOLVED_CONTOUR_OR_OWNERSHIP')]
    affected={e['materialId'] for e in errors}
    for index,owner in enumerate(result['materials']):
        if owner['id'] not in affected:continue
        children=[o for o in plan['objects'] if o['materialId']==owner['id']]
        old=owner['bboxNorm'];boxes=[o['bboxNorm'] for o in children if o.get('bboxNorm') is not None]
        new=[min([old[0]]+[b[0] for b in boxes]),min([old[1]]+[b[1] for b in boxes]),
             max([old[2]]+[b[2] for b in boxes]),max([old[3]]+[b[3] for b in boxes])]
        width,height=old[2]-old[0],old[3]-old[1]
        delta=[abs(a-b) for a,b in zip(old,new)]
        reason=None
        if owner['role']!='foreground' or any(o['kind'] in ('unknown','background') for o in children):
            reason='AMBIGUOUS_OWNER_OR_CONTOUR'
        elif any(d*bound['canvas'][i%2]>LIMITS['maximumEdgePixels']+1e-9 or
                 d>(width if i%2==0 else height)*LIMITS['maximumEdgeFraction']+1e-12
                 for i,d in enumerate(delta)):
            reason='EXPANSION_TOO_LARGE'
        elif (new[2]-new[0])*(new[3]-new[1])>width*height*(1+LIMITS['maximumAreaGrowthFraction']):
            reason='AREA_GROWTH_TOO_LARGE'
        elif any(_intersection(old,b)<(b[2]-b[0])*(b[3]-b[1])*LIMITS['minimumObjectIntersectionFraction'] for b in boxes):
            reason='OWNER_INTERSECTION_TOO_SMALL'
        elif any(_intersection(new,o['bboxNorm'])>_intersection(old,o['bboxNorm'])+1e-12
                 for o in plan['objects'] if o['materialId']!=owner['id'] and o.get('bboxNorm') is not None):
            reason='FOREIGN_OWNERSHIP_IN_EXPANSION'
        elif any(_intersection(new,m['bboxNorm'])>_intersection(old,m['bboxNorm'])+1e-12
                 for m in plan['materials'] if m['id']!=owner['id'] and m['role']=='foreground'):
            reason='FOREIGN_OWNERSHIP_IN_EXPANSION'
        elif any(owner['id'] in (c['a']['materialId'],c['b']['materialId'])
                 for c in plan.get('layoutRegistration',{}).get('constraints',[])):
            reason='CONSTRAINED_OWNER_REQUIRES_MODEL_REPAIR'
        if reason:refusals.append(dict(materialId=owner['id'],reason=reason));continue
        owner['bboxNorm']=new
        changes.append(dict(rule=RULE,path=f'/materials/{index}/bboxNorm',materialId=owner['id'],
            old=old,new=new,objectIds=[o['id'] for o in children],edgeExpansionPixels=[
                d*bound['canvas'][i%2] for i,d in enumerate(delta)]))
    # A union that creates another technical defect is not a safe derivation.
    after=assess(result,schema,bound)
    if any(e['code']!='OBJECT_OUTSIDE_MATERIAL' for e in after['technicalErrors']):
        return deepcopy(plan),[],[dict(reason='DERIVATION_CREATED_TECHNICAL_ERROR')]
    return result,changes,refusals


def _copy_tree(source, target):
    target.mkdir(parents=True)
    for name in host_review._files(Path(source)):
        path=target/name;path.parent.mkdir(parents=True,exist_ok=True)
        path.write_bytes((Path(source)/name).read_bytes())


def model_changes(before, after, path=''):
    """Describe changed JSON pointers; large replaced nodes use content digests."""
    if body_digest(before)==body_digest(after):return []
    if isinstance(before,dict) and isinstance(after,dict):
        rows=[]
        for key in sorted(set(before)|set(after)):
            child=path+'/'+key.replace('~','~0').replace('/','~1')
            if key not in before or key not in after:
                rows.append(dict(path=child,operation='add' if key in after else 'remove',
                    valueDigest=body_digest(after[key] if key in after else before[key])))
            else:rows.extend(model_changes(before[key],after[key],child))
        return rows
    if isinstance(before,list) and isinstance(after,list) and len(before)==len(after):
        return [row for i,(a,b) in enumerate(zip(before,after)) for row in model_changes(a,b,path+'/'+str(i))]
    return [dict(path=path,operation='replace',beforeDigest=body_digest(before),afterDigest=body_digest(after))]


@measured('planning_preflight')
def derive(output, origin, config, *, repair=None, prior_review=None):
    output=Path(output);output.mkdir(parents=True,exist_ok=False)
    _copy_tree(origin,output/'origin')
    if repair is not None:_copy_tree(repair,output/'repair')
    if prior_review is not None:_copy_tree(prior_review,output/'prior-review')
    bound=settings(config,origin);save(output/'settings.json',bound)
    source=output/('repair/response.json' if repair is not None else 'origin/draft.json')
    raw=read(source);schema=read(output/'origin/schema.json')
    normalized,changes,refusals=normalize(raw,schema,bound)
    before=assess(raw,schema,bound);after=assess(normalized,schema,bound)
    if changes:save(output/'candidate.json',normalized)
    else:(output/'candidate.json').write_bytes(source.read_bytes())
    save(output/'report.json',dict(kind='ui_host_candidate_changes_v1',rule=RULE,limits=LIMITS,
        sourceSha256=digest(source),candidateSha256=digest(output/'candidate.json'),
        originalM1ResponseSha256=digest(output/'origin/draft.json'),changes=changes,refusals=refusals,
        modelChanges=model_changes(read(output/'repair/parent.json'),raw) if repair is not None else [],
        before=before,after=after,objectsModified=False,ownershipModified=False))
    authors=list(config['candidateAuthors'])
    if repair is not None and config['planningRepairer'] not in authors:authors.append(config['planningRepairer'])
    body=dict(kind='ui_host_candidate_derivation_v1',policy=PREFLIGHT,candidateAuthors=authors,
        modelRepairPerformed=repair is not None,
        files=host_review._files(output),generationCalls=0,visualAcceptanceAsserted=False)
    save(output/'derivation.json',dict(body,digest=body_digest(body)))
    verify_derivation(output)
    return output


def verify_derivation(folder, *, archived_runtime=None):
    folder=Path(folder);manifest=read(folder/'derivation.json')
    body={k:v for k,v in manifest.items() if k!='digest'}
    if manifest.get('kind')!='ui_host_candidate_derivation_v1' or manifest.get('policy')!=PREFLIGHT or body_digest(body)!=manifest['digest']:
        raise ValueError('HOST_CANDIDATE_DERIVATION_CHANGED')
    host_review._bound_files(folder,manifest['files'])
    if set(host_review._files(folder))!=set(manifest['files'])|{'derivation.json'}:
        raise ValueError('HOST_CANDIDATE_INVENTORY_CHANGED')
    _,origin=host_m1.verify(folder/'origin',archived_runtime=archived_runtime)
    bound=read(folder/'settings.json')
    with Image.open(folder/'origin/reference.png') as image:size=list(image.size)
    if bound['referenceSha256']!=origin['originalReferenceSha256'] or bound['canvas']!=size:
        raise ValueError('HOST_CANDIDATE_REFERENCE_CHANGED')
    repaired=manifest['modelRepairPerformed']
    if type(repaired) is not bool or (folder/'repair').exists()!=repaired:
        raise ValueError('HOST_CANDIDATE_REPAIR_ORIGIN_CHANGED')
    source=folder/('repair/response.json' if repaired else 'origin/draft.json')
    authors=[origin['plannerId']]
    if repaired:
        request=verify_repair(folder/'repair',archived_runtime=archived_runtime)
        if request['originalM1ResponseSha256']!=origin['responseSha256']:
            raise ValueError('HOST_REPAIR_M1_BINDING_CHANGED')
        preauth=read(folder/'repair/preauthorization.json')
        if preauth['scope']['requestSha256']!=origin['requestSha256']:
            raise ValueError('HOST_REPAIR_PREAUTHORIZATION_SOURCE_CHANGED')
        if request['repairerId'] not in authors:authors.append(request['repairerId'])
        trigger=read(folder/'repair/trigger.json')
        parent=read(folder/'repair/parent.json')
        if (digest(folder/'repair/reference.png')!=digest(folder/'origin/reference.png') or
                digest(folder/'repair/schema.json')!=digest(folder/'origin/schema.json') or
                digest(folder/'repair/original-planning-prompt.md')!=digest(folder/'origin/prompt.md') or
                trigger['preflightReportSha256']!=digest(folder/'repair/preflight.json') or
                request['parentCandidateSha256']!=digest(folder/'repair/parent.json')):
            raise ValueError('HOST_REPAIR_SOURCE_BINDING_CHANGED')
        if trigger['candidateSha256']!=digest(folder/'repair/parent.json'):
            raise ValueError('HOST_REPAIR_PARENT_CHANGED')
        if (folder/'prior-review').exists():
            prior=host_review.verify_run(folder/'prior-review',allow_issues=True,archived_runtime=archived_runtime)
            if prior!=parent or not (read(folder/'prior-review/m2/assessment.json')['blockers'] or
                    read(folder/'prior-review/m2/relation-assessment.json')['blockers']):
                raise ValueError('HOST_REPAIR_VERIFIED_BLOCKER_REQUIRED')
            if trigger['reviewSha256']!=digest(folder/'prior-review/m2/draft.json'):
                raise ValueError('HOST_REPAIR_REVIEW_BINDING_CHANGED')
        else:
            initial,_,_=normalize(read(folder/'origin/draft.json'),read(folder/'origin/schema.json'),bound)
            errors=assess(initial,read(folder/'origin/schema.json'),bound)['technicalErrors']
            if parent!=initial or not errors or trigger['technicalErrors']!=errors or trigger['reviewSha256'] is not None:
                raise ValueError('HOST_REPAIR_VERIFIED_BLOCKER_REQUIRED')
    if manifest['candidateAuthors']!=authors:raise ValueError('HOST_CANDIDATE_AUTHORS_CHANGED')
    raw=read(source);schema=read(folder/'origin/schema.json')
    normalized,changes,refusals=normalize(raw,schema,bound)
    expected=dict(kind='ui_host_candidate_changes_v1',rule=RULE,limits=LIMITS,
        sourceSha256=digest(source),candidateSha256=digest(folder/'candidate.json'),
        originalM1ResponseSha256=origin['responseSha256'],changes=changes,refusals=refusals,
        modelChanges=model_changes(read(folder/'repair/parent.json'),raw) if repaired else [],
        before=assess(raw,schema,bound),after=assess(normalized,schema,bound),objectsModified=False,ownershipModified=False)
    if read(folder/'candidate.json')!=normalized or read(folder/'report.json')!=expected:
        raise ValueError('HOST_CANDIDATE_DERIVATION_CHANGED')
    return manifest,expected


@measured('planning_repair')
def prepare_repair(root, config, parent, report, *, prior_review=None):
    root=Path(root);root.mkdir(exist_ok=False)
    origin=Path(parent)/'origin'
    (root/'parent.json').write_bytes((Path(parent)/'candidate.json').read_bytes())
    (root/'reference.png').write_bytes((origin/'reference.png').read_bytes())
    (root/'schema.json').write_bytes((origin/'schema.json').read_bytes())
    (root/'original-planning-prompt.md').write_bytes((origin/'prompt.md').read_bytes())
    trigger=dict(kind='ui_host_planning_repair_trigger_v1',candidateSha256=digest(root/'parent.json'),
        preflightReportSha256=digest(Path(parent)/'report.json'),technicalErrors=report['after']['technicalErrors'],
        reviewSha256=None,reviewBlockers=[],generationCalls=0)
    (root/'preflight.json').write_bytes((Path(parent)/'report.json').read_bytes())
    if prior_review is not None:
        host_review.verify_run(prior_review,allow_issues=True)
        trigger.update(reviewSha256=digest(Path(prior_review)/'m2/draft.json'),reviewBlockers=
            read(Path(prior_review)/'m2/assessment.json')['blockers']+
            read(Path(prior_review)/'m2/relation-assessment.json')['blockers'])
        (root/'prior-review.json').write_bytes((Path(prior_review)/'m2/draft.json').read_bytes())
    if not (trigger['technicalErrors'] or trigger['reviewBlockers']):
        raise ValueError('HOST_REPAIR_VERIFIED_BLOCKER_REQUIRED')
    save(root/'trigger.json',trigger)
    from .experimental_executor import verified
    save(root/'preauthorization.json',dict(configDigest=config['digest'],
        scope=verified(root.parent/'scopes/planning_generate/scope.json'),
        authorization=verified(root.parent/'scopes/planning_generate/authorization.json')))
    (root/'prompt.md').write_text('Repair the complete candidate planning JSON against the clean original reference. '
        'Resolve the attached verified planning errors with minimal justified changes. '
        'Retain the visual, text, ownership, layout and user requirements in original-planning-prompt.md. '
        'For this repair only, its fresh-planning instruction is superseded by use of the attached parent candidate. '
        'Preserve complete owned contours, material identities, text policy and independent ownership. '
        'Do not shrink objects to fit, guess ownership, ignore errors, generate images or invoke another model. '
        'When source evidence is ambiguous retain an explicit unknown; do not fabricate a resolution. '
        'Return the complete schema-conforming plan. These frozen inputs are read-only; write output outside the host run.\n',encoding='utf-8')
    save(root/'request.json',dict(kind='ui_host_planning_repair_request_v1',policy=REPAIR,
        originalM1ResponseSha256=digest(origin/'draft.json'),parentCandidateSha256=digest(root/'parent.json'),
        repairerId=config['planningRepairer'],model=config['planningModel'],effort=config['planningEffort'],
        inputs=host_review._files(root),runtime=host_review.runtime_files(),maximumCalls=1,
        maximumRepairs=1,maximumIndependentRereviews=1,automaticRetries=0,generationCalls=0))


def verify_repair(root, *, archived_runtime=None):
    root=Path(root);request=read(root/'request.json')
    if (root/'receive-failed.json').exists():raise ValueError('HOST_REPAIR_RECEIVE_FAILED')
    if (request.get('kind')!='ui_host_planning_repair_request_v1' or request.get('policy')!=REPAIR or
            request.get('runtime')!=(host_review.runtime_files() if archived_runtime is None else archived_runtime) or
            any(request.get(k)!=1 for k in ('maximumCalls','maximumRepairs','maximumIndependentRereviews')) or
            request.get('automaticRetries')!=0 or request.get('generationCalls')!=0):
        raise ValueError('HOST_REPAIR_REQUEST_CHANGED')
    host_review._bound_files(root,request['inputs'])
    expected_inputs={'parent.json','reference.png','schema.json','preflight.json','trigger.json','preauthorization.json','prompt.md',
                     'original-planning-prompt.md'}
    if (root/'prior-review.json').exists():expected_inputs.add('prior-review.json')
    if set(request['inputs'])!=expected_inputs:raise ValueError('HOST_REPAIR_INPUTS_CHANGED')
    preauth=read(root/'preauthorization.json');scope=preauth['scope'];auth=preauth['authorization']
    for row in (scope,auth):
        if row['digest']!=body_digest({k:v for k,v in row.items() if k!='digest'}):
            raise ValueError('HOST_REPAIR_PREAUTHORIZATION_CHANGED')
    conditional=scope.get('conditionalPlanningRepair',{})
    if (scope['stage']!='planning_generate' or auth['scopeDigest']!=scope['digest'] or
            conditional.get('policy')!=REPAIR or conditional.get('maximumAdditionalCalls')!=2 or
            conditional.get('maximumRepairs')!=1 or conditional.get('maximumIndependentRereviews')!=1 or
            conditional.get('repairerId')!=request['repairerId'] or conditional.get('reviewerId') in
            (scope['plannerId'],request['repairerId']) or request['model']!=scope['model'] or request['effort']!=scope['effort']):
        raise ValueError('HOST_REPAIR_PREAUTHORIZATION_CHANGED')
    att=read(root/'host-attestation.json')
    expected=dict(kind='ui_host_planning_repair_attestation_v1',requestSha256=digest(root/'request.json'),
        responseSha256=digest(root/'response.json'),parentCandidateSha256=request['parentCandidateSha256'],
        repairerId=request['repairerId'],model=request['model'],effort=request['effort'],
        hostAssertedModelResponse=True,notProviderReceipt=True,notCryptographicallyPlatformVerified=True,
        dispatchEvidenceSha256=digest(root/'host-dispatch-evidence.bin'),returnEvidenceSha256=digest(root/'host-return-evidence.bin'))
    if att!=expected or att['dispatchEvidenceSha256']==att['returnEvidenceSha256']:
        raise ValueError('HOST_REPAIR_ATTESTATION_CHANGED')
    if read(root/'accepted.json')!=dict(kind='ui_host_planning_repair_received_v1',
            outputs={n:digest(root/n) for n in ('request.json','response.json','host-attestation.json',
                'host-dispatch-evidence.bin','host-return-evidence.bin')}):
        raise ValueError('HOST_REPAIR_RECEIPT_CHANGED')
    read(root/'response.json') # Invalid/nonfinite/duplicate-key JSON is transport failure, not another repair.
    return request


@measured('planning_repair')
def receive_repair(root, response, *, host_attestation, dispatch_evidence, return_evidence):
    root=Path(root)
    if (root/'response.json').exists() or Path(response).resolve().is_relative_to(root.resolve()):
        raise ValueError('HOST_REPAIR_FRESH_EXTERNAL_RESPONSE_REQUIRED')
    for path,name in ((response,'response.json'),(host_attestation,'host-attestation.json'),
            (dispatch_evidence,'host-dispatch-evidence.bin'),(return_evidence,'host-return-evidence.bin')):
        (root/name).write_bytes(Path(path).read_bytes())
    try:
        # Validate the original evidence before publishing a received record.
        request=read(root/'request.json');host_review._bound_files(root,request['inputs'])
        att=read(root/'host-attestation.json')
        expected=dict(kind='ui_host_planning_repair_attestation_v1',requestSha256=digest(root/'request.json'),
            responseSha256=digest(root/'response.json'),parentCandidateSha256=request['parentCandidateSha256'],
            repairerId=request['repairerId'],model=request['model'],effort=request['effort'],
            hostAssertedModelResponse=True,notProviderReceipt=True,notCryptographicallyPlatformVerified=True,
            dispatchEvidenceSha256=digest(root/'host-dispatch-evidence.bin'),returnEvidenceSha256=digest(root/'host-return-evidence.bin'))
        if att!=expected or att['dispatchEvidenceSha256']==att['returnEvidenceSha256']:
            raise ValueError('HOST_REPAIR_ATTESTATION_CHANGED')
        read(root/'response.json')
        save(root/'accepted.json',dict(kind='ui_host_planning_repair_received_v1',outputs={n:digest(root/n)
            for n in ('request.json','response.json','host-attestation.json','host-dispatch-evidence.bin','host-return-evidence.bin')}))
        verify_repair(root)
    except Exception as exc:
        save(root/'receive-failed.json',dict(reason=str(exc),automaticRetry=False));raise
