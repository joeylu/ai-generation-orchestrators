"""Independent candidate review exchange. Host evidence never asserts provider receipts."""
from pathlib import Path, PurePosixPath
import json
import re
from jsonschema import Draft202012Validator
from PIL import Image
from .evaluate import read, save, digest, check_relations
from . import relation_review, visual_textures as textures
from .visual_policy import load_input, planning_policy, planning_guidance, INPUT_NAME
from .planning_review_policy import split
from .review_evidence import build_catalog, build_review_schema, PROTOCOL_V4
from .review_focus import make_focus, make_small_material_focus
from .sequence_focus import make_sequence_focus
from .boundary_evidence import guidance as boundary_guidance
from .session_review import render_for_review, build_review_prompt
from . import material_reuse as reuse, reuse_pipeline
from . import background_region_pipeline as bg_region
from .planning_dag import (BOX_TEXT_GUIDANCE, itemized_coverage_prompt, read_notes,
                           locked)

DRIVER = 'host-model-exchange-v1'
CONTRACT_DIGESTS = {
    'schemas/visual-plan.schema.json':'e9f5fd26fed4f432d35d8a323e3dba322aafd635ac5a7349a5b0ed437c4ff0e5',
    'prompts/visual-plan.md':'01a6838e147cd3ce9b885bda2486e90b7e60dc5ea1ff365733d8fc4348c0f6a6',
    'prompts/visual-review.md':'6a8acae3d168bf1d365b18bd145ce49f9e79dd7fcee145dfed956d3ea306a150'}


def _identity(value):
    if not isinstance(value,str) or re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}',value) is None:
        raise ValueError('HOST_OPAQUE_ID_REQUIRED')
    return value


def validate_attestation(attestation, request, response_sha):
    required={'kind','requestSha256','responseSha256','seedSha256','candidateAuthors','reviewerId',
              'hostAssertedModelResponse','notCryptographicallyPlatformVerified',
              'dispatchEvidenceSha256','returnEvidenceSha256'}
    if set(attestation)!=required or attestation['kind']!='ui_host_review_attestation_v1':
        raise ValueError('HOST_ATTESTATION_REQUIRED')
    for field in ('requestSha256','responseSha256','seedSha256','dispatchEvidenceSha256','returnEvidenceSha256'):
        if not isinstance(attestation[field],str) or re.fullmatch('[0-9a-f]{64}',attestation[field]) is None:
            raise ValueError('HOST_ATTESTATION_DIGEST_REQUIRED')
    if (attestation['responseSha256']!=response_sha or
            attestation['seedSha256']!=request['sourcePlanSha256'] or
            attestation['candidateAuthors']!=request['candidateAuthors'] or
            attestation['hostAssertedModelResponse'] is not True or
            attestation['notCryptographicallyPlatformVerified'] is not True):
        raise ValueError('HOST_ATTESTATION_BINDING_MISMATCH')
    reviewer=_identity(attestation['reviewerId'])
    authors=attestation['candidateAuthors']
    if not isinstance(authors,list) or not authors or len(set(authors))!=len(authors):
        raise ValueError('HOST_CANDIDATE_AUTHORS_REQUIRED')
    for author in authors:_identity(author)
    if reviewer in authors:raise ValueError('INDEPENDENT_HOST_REVIEWER_REQUIRED')
    if attestation['dispatchEvidenceSha256']==attestation['returnEvidenceSha256']:
        raise ValueError('DISTINCT_DISPATCH_RETURN_EVIDENCE_REQUIRED')


def runtime_files():
    """Pin public program code in the active install, never external host paths."""
    from .compile_visual import HARNESS
    base=Path(__file__).resolve().parents[4]
    paths=list(Path(__file__).parent.glob('*.py'))+list((HARNESS/'src').rglob('*.py'))
    return {p.relative_to(base).as_posix():digest(p) for p in sorted(paths)}


def _files(root):
    return {p.relative_to(root).as_posix():digest(p) for p in sorted(root.rglob('*'))
            if p.is_file() and p.name!='lock'}


def _bound_files(root, files):
    for name, sha in files.items():
        relative=PurePosixPath(name)
        path=(root/name).resolve()
        if relative.is_absolute() or '\\' in name or ':' in name or '..' in relative.parts or not path.is_relative_to(root.resolve()):
            raise ValueError('HOST_EVIDENCE_PATH_ESCAPE')
        if digest(path)!=sha:raise ValueError('HOST_EVIDENCE_CHANGED:'+name)


def verify_prepared(root):
    root=Path(root)
    config=read(root/'.dag/config.json')
    if config.get('planningDriver')!=DRIVER:raise ValueError('HOST_DRIVER_REQUIRED')
    if (config.get('reviewEvidenceProtocol')!=PROTOCOL_V4 or
            config.get('coverageTextPolicy')!='exact-fragments-v1' or
            config.get('relationReviewPolicy')!=relation_review.POLICY):
        raise ValueError('HOST_REVIEW_POLICY_CHANGED')
    if any((root/name).exists() for name in ('session.json','m1/transport.json','m2/transport.json',
                                            'm1/events.jsonl','m2/events.jsonl')):
        raise ValueError('HOST_EXCHANGE_FORBIDS_CLI_RECEIPTS')
    if digest(root/'.dag/config.json')!=read(root/'.dag/config-digest.json')['sha256']:
        raise ValueError('CONFIG_CHANGED')
    if config.get('runtime')!=runtime_files():raise ValueError('RUNTIME_CHANGED_NEW_RUN_REQUIRED')
    prep=read(root/'.dag/exchange-preparation.json')
    _bound_files(root,prep['files'])
    if prep.get('requestSha256')!=digest(root/'m2/request.json'):
        raise ValueError('HOST_REQUEST_BINDING_CHANGED')
    for name,sha in config['inputs'].items():
        if digest(root/'.dag/inputs'/name)!=sha:raise ValueError('INPUT_CHANGED')
    request=read(root/'m2/request.json')
    _bound_files(root/'m2',request['inputs'])
    if (request.get('planningDriver')!=DRIVER or
            request.get('sourcePlanSha256')!=digest(root/'m1/draft.json') or
            request.get('originalReferenceSha256')!=digest(root/'m1/reference.png')):
        raise ValueError('HOST_REQUEST_BINDING_CHANGED')
    plan=read(root/'m1/draft.json')
    Draft202012Validator(read(root/'m1/schema.json')).validate(plan)
    if plan.get('kind')!='ui_visual_plan_v5':raise ValueError('V5_REQUIRED')
    if config.get('hostM1Exchange'):
        _verify_m1_source(root/'m1/source',root/'m1/draft.json',request['candidateAuthors'],
                          digest(root/'m1/reference.png'),config['hostM1Exchange'])
    reuse_pipeline.planning_input(root,plan)
    bg_region.planning_input(root,plan)
    return plan


def verify_frozen(folder, snapshot, plan):
    """Recheck the complete host review from packaged evidence without host state."""
    folder=Path(folder);evidence=folder/'evidence'
    config=read(evidence/'host-review-config.json')
    if (config.get('planningDriver')!=DRIVER or config.get('reviewEvidenceProtocol')!=PROTOCOL_V4 or
            config.get('coverageTextPolicy')!='exact-fragments-v1' or
            config.get('relationReviewPolicy')!=relation_review.POLICY):
        raise ValueError('HOST_FROZEN_POLICY_CHANGED')
    if (snapshot.get('notProviderReceipt') is not True or snapshot.get('cliSessionAsserted') is not False or
            snapshot.get('notCryptographicallyPlatformVerified') is not True):
        raise ValueError('HOST_FROZEN_PROVENANCE_INVALID')
    if snapshot.get('offlineCandidateSeed') is not (not bool(config.get('hostM1Exchange'))):
        raise ValueError('HOST_FROZEN_M1_ORIGIN_CHANGED')
    if config.get('hostM1Exchange'):
        if snapshot.get('m1ModelExecuted') is not True or snapshot.get('hostM1Exchange')!=config['hostM1Exchange']:
            raise ValueError('HOST_FROZEN_M1_ORIGIN_CHANGED')
    elif snapshot.get('m1ModelExecuted') or snapshot.get('hostM1Exchange'):
        raise ValueError('HOST_FROZEN_M1_ORIGIN_CHANGED')
    request_path=evidence/'m2-request.json';response_path=evidence/'m2-draft.json'
    prepared=read(evidence/'host-review-preparation.json')
    _bound_files(evidence/'prepared',prepared['files'])
    if prepared.get('requestSha256')!=digest(request_path):raise ValueError('HOST_FROZEN_REQUEST_CHANGED')
    verify_exchange(read(evidence/'m2-exchange-provenance.json'),request_path,response_path,
                    evidence/'m2-host-attestation.json',evidence/'m2-host-dispatch-evidence.bin',
                    evidence/'m2-host-return-evidence.bin')
    request=read(request_path)
    if config.get('hostM1Exchange'):
        _verify_m1_source(evidence/'prepared/m1/source',evidence/'m1-draft.json',
            request['candidateAuthors'],digest(folder/'reference.png'),config['hostM1Exchange'])
    if (request.get('sourcePlanSha256')!=digest(evidence/'m1-draft.json') or
            request.get('originalReferenceSha256')!=digest(folder/'reference.png')):
        raise ValueError('HOST_FROZEN_INPUT_CHANGED')
    for name,sha in request['inputs'].items():
        if '/' in name or '\\' in name or ':' in name or digest(evidence/('m2-'+name))!=sha:
            raise ValueError('HOST_FROZEN_REVIEW_INPUT_CHANGED')
    for name,sha in config['inputs'].items():
        if '/' in name or '\\' in name or ':' in name or digest(evidence/('host-input-'+name))!=sha:
            raise ValueError('HOST_FROZEN_SOURCE_INPUT_CHANGED')
    Draft202012Validator(read(evidence/'m1-schema.json')).validate(plan)
    if plan['unknowns']:raise ValueError('UNRESOLVED_UNKNOWNS')
    policy=read(evidence/('host-input-'+INPUT_NAME)) if INPUT_NAME in config['inputs'] else None
    texture_doc=textures.snapshot_input(folder,snapshot)
    catalog=build_catalog(plan)
    if read(evidence/'m2-plan-evidence-catalog.json')!=catalog:
        raise ValueError('HOST_FROZEN_CATALOG_CHANGED')
    focus_path=evidence/'m2-coverage-small-materials.json'
    focus=read(focus_path) if focus_path.exists() else None
    from .review_evidence import expected_small_material_ids, resolve_review
    from .evaluate import pixel_box
    with Image.open(folder/'reference.png') as image:width,height=image.size
    expected=expected_small_material_ids(plan,width,height)
    if expected:
        if focus is None or ([item['materialId'] for item in focus['items']+focus['boundaryOnlyItems']]!=expected or
                              len(focus['items'])!=min(12,len(expected))):
            raise ValueError('PLAN_EVIDENCE_FOCUS_PLAN_MISMATCH')
    elif focus is not None:raise ValueError('PLAN_EVIDENCE_UNEXPECTED_FOCUS')
    if focus:
        owners={row['id']:row for row in plan['materials']}
        for row in focus['items']+focus['boundaryOnlyItems']:
            owner=owners.get(row['materialId'])
            if owner is None or owner['role']!='foreground':raise ValueError('SMALL_BOUNDARY_FOCUS_OWNER_MISMATCH')
            box=pixel_box(owner['bboxNorm'],width,height)
            margin=max(16,(max(box[2]-box[0],box[3]-box[1])+1)//2)
            context=[max(0,box[0]-margin),max(0,box[1]-margin),min(width,box[2]+margin),min(height,box[3]+margin)]
            if row['sourceBox']!=box or row['contextBox']!=context:
                raise ValueError('SMALL_BOUNDARY_FOCUS_PLAN_MISMATCH')
    schema=build_review_schema(catalog,focus,policy,PROTOCOL_V4,'exact-fragments-v1')
    schema=textures.bind_review_schema(schema,texture_doc,plan)
    schema=relation_review.bind_schema(schema,relation_review.catalog(plan,digest(folder/'reference.png')))
    reuse_doc=None
    if reuse_pipeline.INPUT_NAME in config['inputs']:
        reuse_doc=reuse.validate(read(evidence/('host-input-'+reuse_pipeline.INPUT_NAME)),plan,
            digest(folder/'reference.png'),digest(evidence/'m1-draft.json'))
        schema=reuse.review_schema(schema,reuse_doc)
    schema,bg_bound=bg_region.frozen_schema(folder,config,plan,digest(folder/'reference.png'),schema)
    if schema!=read(evidence/'m2-schema.json'):raise ValueError('HOST_FROZEN_SCHEMA_CHANGED')
    review=read(response_path);Draft202012Validator(schema).validate(review)
    reuse.validate_review(review,reuse_doc)
    bg_region.validate_review(review,bg_bound)
    resolve_review(review,plan,'exact-fragments-v1')
    if focus:
        from .boundary_evidence import validate_boundaries
        validate_boundaries(review,focus)
    if split(review,plan,policy,'exact-fragments-v1',texture_doc)[0]:raise ValueError('M2_UNRESOLVED')


def _verify_m1_source(source,candidate,authors,reference_sha,binding):
    from . import host_m1
    _,provenance=host_m1.bind_candidate(source,candidate,authors,reference_sha)
    if binding!=dict(requestSha256=provenance['requestSha256'],responseSha256=provenance['responseSha256'],
            plannerId=provenance['plannerId'],m1ModelExecuted=True):
        raise ValueError('HOST_M1_REVIEW_SOURCE_CHANGED')


def prepare(candidate, reference, output, contract_dir, *, seed_author, planning_notes=None,
            visual_policy=None, visual_textures=None, material_reuse=None, max_calls=128,
            background_region=None, background_region_digest=None, context_prompt_version='v8',m1_source=None,
            generation_mode='sheets'):
    """Snapshot an explicit seed or source-bound host M1 and prepare independent M2."""
    root=Path(output).resolve();contract=Path(contract_dir)
    if context_prompt_version not in ('v7','v8'):raise ValueError('HOST_CONTEXT_PROMPT_VERSION')
    if generation_mode not in ('single','sheets'):raise ValueError('HOST_GENERATION_MODE_UNSUPPORTED')
    for name,sha in CONTRACT_DIGESTS.items():
        if digest(contract/name)!=sha:raise ValueError('HOST_PLANNING_CONTRACT_NOT_SUPPORTED:'+name)
    authors=[seed_author] if isinstance(seed_author,str) else list(seed_author)
    if not authors or len(set(authors))!=len(authors):raise ValueError('HOST_CANDIDATE_AUTHORS_REQUIRED')
    for author in authors:_identity(author)
    m1_binding=None
    if m1_source is not None:
        from . import host_m1
        _,provenance=host_m1.bind_candidate(m1_source,candidate,authors,digest(Path(reference)))
        m1_binding=dict(requestSha256=provenance['requestSha256'],responseSha256=provenance['responseSha256'],
            plannerId=provenance['plannerId'],m1ModelExecuted=True)
    if root.exists():raise ValueError('FRESH_OUTPUT_REQUIRED')
    if not 1<=max_calls<=128:raise ValueError('CALL_LIMIT')
    schema=read(contract/'schemas/visual-plan.schema.json');plan=read(Path(candidate))
    Draft202012Validator(schema).validate(plan)
    if plan.get('kind')!='ui_visual_plan_v5':raise ValueError('V5_REQUIRED')
    with Image.open(reference) as image:
        if image.format!='PNG' or image.getexif().get(274,1)!=1:
            raise ValueError('PNG_WITH_REFERENCE_COORDINATES_REQUIRED')
        image.load()
    policy_bytes=load_input(visual_policy)
    texture_bytes=textures.load_input(visual_textures,reference)
    notes=read_notes(planning_notes)
    reuse_bytes=None
    if material_reuse is not None:
        reuse_bytes=Path(material_reuse).read_bytes()
        import json
        reuse.validate(json.loads(reuse_bytes),plan,digest(Path(reference)),digest(Path(candidate)))
    inputs=root/'.dag/inputs';inputs.mkdir(parents=True)
    for name,source in [('reference.png',Path(reference)),('source-plan.json',Path(candidate)),
                         ('storage-schema.json',contract/'schemas/visual-plan.schema.json'),
                         ('visual-plan.md',contract/'prompts/visual-plan.md'),
                         ('visual-review.md',contract/'prompts/visual-review.md')]:
        (inputs/name).write_bytes(source.read_bytes())
    if policy_bytes is not None:(inputs/INPUT_NAME).write_bytes(policy_bytes)
    if texture_bytes is not None:(inputs/textures.INPUT_NAME).write_bytes(texture_bytes)
    if reuse_bytes is not None:(inputs/reuse_pipeline.INPUT_NAME).write_bytes(reuse_bytes)
    if notes is not None:(inputs/'planning-notes.txt').write_bytes(notes)
    if (background_region is None)!=(background_region_digest is None):raise ValueError('BG_REGION_CONFIG_PAIR_REQUIRED')
    if background_region is not None:bg_region.copy_inputs(background_region,background_region_digest,inputs)
    config=dict(kind='ui_planning_dag_v1',planningDriver=DRIVER,
        runtime=runtime_files(),
        generationMode=generation_mode,generationReference='context-crops',contextPromptVersion=context_prompt_version,
        maxCalls=max_calls,relationReviewPolicy=relation_review.POLICY,
        reviewEvidenceProtocol=PROTOCOL_V4,coverageTextPolicy='exact-fragments-v1',
        inputs={p.name:digest(p) for p in inputs.iterdir()},
        mediaGenerationCalls=0,maximumRepairs=0,
        **({'hostM1Exchange':m1_binding,'candidateAuthors':authors} if m1_binding else
           {'offlineCandidateSeed':dict(sourcePlanSha256=digest(inputs/'source-plan.json'),
                                  candidateAuthors=authors,m1ModelExecuted=False)}),
        **({'visualTexturePolicy':textures.POLICY} if texture_bytes is not None else {}))
    if background_region is not None:config['backgroundRegionDigest']=background_region_digest
    save(root/'.dag/config.json',config)
    save(root/'.dag/config-digest.json',dict(sha256=digest(root/'.dag/config.json')))
    m1=root/'m1';m1.mkdir()
    for source,target in [('reference.png','reference.png'),('source-plan.json','draft.json'),
                          ('storage-schema.json','schema.json'),('visual-plan.md','prompt.md')]:
        (m1/target).write_bytes((inputs/source).read_bytes())
    if m1_source is not None:
        copied=m1/'source';copied.mkdir()
        for name in host_m1.FILES:(copied/name).write_bytes((Path(m1_source)/name).read_bytes())
    save(m1/'seed.json',dict(kind='ui_host_generated_candidate_v1' if m1_binding else 'ui_offline_candidate_seed_v1',
         candidateSha256=digest(m1/'draft.json'),referenceSha256=digest(m1/'reference.png'),
         candidateAuthors=authors,m1ModelExecuted=bool(m1_binding),originalM1SuccessAsserted=False,
         **({'hostM1Exchange':m1_binding} if m1_binding else {})))
    save(m1/'program-check.json',dict(issues=check_relations(plan),unknowns=plan['unknowns']))
    render_for_review(m1/'reference.png',plan,m1/'preview')
    _prepare_review(root,plan)
    save(root/'.dag/exchange-preparation.json',dict(kind='ui_host_review_preparation_v1',
         requestSha256=digest(root/'m2/request.json'),files=_files(root)))
    verify_prepared(root)
    return dict(status='awaiting_host_review',planningDriver=DRIVER,
        requestSha256=digest(root/'m2/request.json'),reviewDirectory='m2',
        offlineCandidateSeed=not bool(m1_binding),modelCalls=0,generationCalls=0,
        unresolvedUnknowns=plan['unknowns'])


def _prepare_review(root, plan):
    inputs=root/'.dag/inputs';config=read(root/'.dag/config.json')
    p=root/'m2';p.mkdir();reference=root/'m1/reference.png'
    policy=planning_policy(root);texture_doc=textures.planning_input(root)
    catalog=build_catalog(plan);save(p/'plan-evidence-catalog.json',catalog)
    (p/'review-overlay.png').write_bytes((root/'m1/preview/materials-overlay.png').read_bytes())
    (p/'review-source.md').write_bytes((inputs/'visual-review.md').read_bytes())
    focus=make_focus(reference,p/'review-overlay.png',plan,p)
    small=make_small_material_focus(reference,plan,p)
    sequence=make_sequence_focus(reference,plan,p)
    schema=build_review_schema(catalog,small,policy,PROTOCOL_V4,coverage_text_policy=config['coverageTextPolicy'])
    schema=textures.bind_review_schema(schema,texture_doc,plan)
    relations=relation_review.catalog(plan,digest(reference))
    save(p/relation_review.NAME,relations)
    reuse_doc=reuse_pipeline.planning_input(root,plan)
    reuse_pipeline.source_focus(reference,plan,reuse_doc,p)
    bg_bound=bg_region.planning_input(root,plan)
    save(p/'schema.json',bg_region.schema(reuse.review_schema(relation_review.bind_schema(schema,relations),reuse_doc),bg_bound))
    if bg_bound is not None:
        for name in ('edit-mask.png','blend-mask.png','preview.png'):
            (p/(bg_region.PREFIX+name)).write_bytes((inputs/(bg_region.PREFIX+name)).read_bytes())
    checks=build_review_prompt((p/'review-source.md').read_text(encoding='utf-8'),check_relations(plan))
    checks=checks.replace('证据逐字引用所属素材/对象 label；',
        '覆盖项由程序按 materialId/objectId 还原本轮计划目录原文；小素材部件另选所属 planEvidenceId；',1)
    prompt=BOX_TEXT_GUIDANCE+itemized_coverage_prompt(checks,PROTOCOL_V4)
    prompt+=('\nIndependent review of the freshly generated host M1 plan. Its original response and source-bound exchange evidence are preserved. No CLI session is asserted.\n'
        if config.get('hostM1Exchange') else '\nIndependent review of an explicitly supplied offline candidate seed. No prior model session is asserted.\n')
    prompt+='\nReview the clean original reference, every material and object, all nine coverage regions, and every required small-material part. Use the exact typed response schema.\n'
    prompt+='\nCandidate plan:\n'+json.dumps(plan,ensure_ascii=False)
    prompt+='\nPlan evidence catalog:\n'+json.dumps(catalog,ensure_ascii=False)
    if focus:prompt+='\nBoundary context focus:\n'+json.dumps(focus,ensure_ascii=False)
    if small:
        prompt+=boundary_guidance(small)
        prompt+='\nSmall-material parts require visiblePart, observedAppearance, an owned planEvidenceId, and independent descriptionStatus. Inspect shape, count, gaps, attachments, colors, highlights and surface marks; generic owner names cannot replace structure evidence.\n'
        prompt+='\nOnly descriptionStatus=reference-bound permits deferredAppearance, which must then contain nonblank appearance evidence. For consistent, missing, conflicting or uncertain, deferredAppearance must be null.\n'
    if sequence:prompt+='\nInspect all repeated instances in the attached sequence-source pages.\n'
    prompt+=relation_review.guidance(relations)+planning_guidance(policy)+textures.guidance(texture_doc)
    prompt+=reuse_pipeline.guidance(reuse_doc)
    prompt+=bg_region.guidance(bg_bound)
    if reuse_doc is not None:prompt+='\nInspect reuse-source-focus.png and its mapping: every source instance is shown in declared order. The source crops include foreign objects and ordinary text; apply each original owner contract before comparing.\n'
    if (inputs/'planning-notes.txt').exists():
        prompt+='\nUser planning constraints:\n'+(inputs/'planning-notes.txt').read_text(encoding='utf-8-sig')
    (p/'prompt.md').write_text(prompt,encoding='utf-8')
    save(p/'request.json',dict(kind='ui_host_review_request_v1',planningDriver=DRIVER,
        sourcePlanSha256=digest(root/'m1/draft.json'),
        candidateAuthors=config.get('candidateAuthors') if config.get('hostM1Exchange') else config['offlineCandidateSeed']['candidateAuthors'],
        originalReferenceSha256=digest(reference),originalImageResent=True,
        inputs={path.name:digest(path) for path in sorted(p.iterdir()) if path.is_file()},
        **({'visualPolicySha256':config['inputs'][INPUT_NAME]} if policy is not None else {}),
        **({'visualTexturesSha256':config['inputs'][textures.INPUT_NAME]} if texture_doc is not None else {})))


def verify_exchange(provenance, request_path, response_path, attestation_path=None,
                    dispatch_path=None, return_path=None):
    attestation_path=attestation_path or request_path.parent/'host-attestation.json'
    attestation=read(attestation_path)
    validate_attestation(attestation,read(request_path),digest(response_path))
    if attestation['requestSha256']!=digest(request_path):raise ValueError('HOST_ATTESTATION_BINDING_MISMATCH')
    dispatch_path=dispatch_path or request_path.parent/'host-dispatch-evidence.bin'
    return_path=return_path or request_path.parent/'host-return-evidence.bin'
    if (digest(dispatch_path)!=attestation['dispatchEvidenceSha256'] or
            digest(return_path)!=attestation['returnEvidenceSha256']):
        raise ValueError('HOST_DISPATCH_RETURN_EVIDENCE_CHANGED')
    expected=dict(kind='ui_host_review_exchange_provenance_v1',planningDriver=DRIVER,
        responseOrigin='host-attested-model-response',notProviderReceipt=True,
        cliSessionAsserted=False,notCryptographicallyPlatformVerified=True,
        requestSha256=digest(request_path),responseSha256=digest(response_path),
        hostAttestationSha256=digest(attestation_path))
    if provenance!=expected:raise ValueError('HOST_EXCHANGE_PROVENANCE_INVALID')


def _assess(root, plan):
    from .compile_visual import verify_plan_evidence, verify_boundary_evidence
    folder=root/'m2';review=read(folder/'draft.json');bound=read(folder/'request.json')
    Draft202012Validator(read(folder/'schema.json')).validate(review)
    reuse.validate_review(review,reuse_pipeline.planning_input(root,plan))
    bg_region.validate_review(review,bg_region.planning_input(root,plan))
    verify_plan_evidence(folder,review,bound,plan)
    verify_boundary_evidence(folder,review,bound,plan,root/'m1/reference.png')
    blockers,warnings=split(review,plan,planning_policy(root),'exact-fragments-v1',textures.planning_input(root))
    known={row['id'] for key in ('materials','objects') for row in plan[key]}
    if any(set(item['ids'])-known for item in blockers+warnings):raise ValueError('UNKNOWN_REVIEW_IDS')
    relations=relation_review.assess(plan,digest(root/'m1/reference.png'),review)
    return dict(blockers=blockers,warnings=warnings,relationBlockers=relations['blockers'],
                reviewSha256=digest(folder/'draft.json')),relations


def receive(root, response, request_sha256, *, host_attestation, dispatch_evidence,
            return_evidence, response_sha256=None):
    root=Path(root).resolve();response=Path(response).resolve()
    with locked(root):
        if (root/'.dag/received.json').exists() or (root/'.dag/receive-failed.json').exists():
            raise ValueError('HOST_REVIEW_ALREADY_RECEIVED')
        plan=verify_prepared(root)
        if request_sha256!=digest(root/'m2/request.json'):raise ValueError('HOST_REQUEST_DIGEST_MISMATCH')
        if response.is_relative_to(root):raise ValueError('EXTERNAL_RESPONSE_REQUIRED')
        if (root/'m2/draft.json').exists():raise ValueError('HOST_RESPONSE_OUTPUT_EXISTS')
        raw=response.read_bytes()
        import hashlib
        sha=hashlib.sha256(raw).hexdigest()
        if response_sha256 is not None and sha!=response_sha256:raise ValueError('HOST_RESPONSE_DIGEST_MISMATCH')
        attestation_bytes=Path(host_attestation).read_bytes()
        dispatch_bytes=Path(dispatch_evidence).read_bytes()
        return_bytes=Path(return_evidence).read_bytes()
        (root/'m2/draft.json').write_bytes(raw)
        (root/'m2/host-attestation.json').write_bytes(attestation_bytes)
        (root/'m2/host-dispatch-evidence.bin').write_bytes(dispatch_bytes)
        (root/'m2/host-return-evidence.bin').write_bytes(return_bytes)
        provenance=dict(kind='ui_host_review_exchange_provenance_v1',planningDriver=DRIVER,
            responseOrigin='host-attested-model-response',notProviderReceipt=True,
            cliSessionAsserted=False,notCryptographicallyPlatformVerified=True,
            requestSha256=request_sha256,responseSha256=sha,
            hostAttestationSha256=digest(root/'m2/host-attestation.json'))
        try:
            verify_exchange(provenance,root/'m2/request.json',root/'m2/draft.json')
            save(root/'m2/exchange-provenance.json',provenance)
            assessment,relations=_assess(root,plan)
            save(root/'m2/assessment.json',assessment)
            save(root/'m2/relation-assessment.json',relations)
            verify_prepared(root)
            save(root/'.dag/received.json',dict(kind='ui_host_review_received_v1',
                 outputs={name:digest(root/'m2'/name) for name in (
                 'draft.json','host-attestation.json','host-dispatch-evidence.bin','host-return-evidence.bin',
                 'exchange-provenance.json','assessment.json','relation-assessment.json')}))
        except Exception as exc:
            save(root/'.dag/receive-failed.json',dict(kind='ui_host_review_receive_failure_v1',
                requestSha256=request_sha256,responseSha256=sha,error=type(exc).__name__+': '+str(exc),
                automaticRetry=False))
            raise
    return dict(status='review_received',planningDriver=DRIVER,**assessment,
                unknowns=plan['unknowns'],generationCalls=0)


def verify_run(root, allow_issues=False):
    root=Path(root);plan=verify_prepared(root)
    if (root/'.dag/receive-failed.json').exists():raise ValueError('HOST_REVIEW_RECEIVE_FAILED')
    received=read(root/'.dag/received.json')
    _bound_files(root/'m2',received['outputs'])
    verify_exchange(read(root/'m2/exchange-provenance.json'),root/'m2/request.json',root/'m2/draft.json')
    assessment,relations=_assess(root,plan)
    if read(root/'m2/assessment.json')!=assessment or read(root/'m2/relation-assessment.json')!=relations:
        raise ValueError('HOST_REVIEW_ASSESSMENT_CHANGED')
    if not allow_issues and (assessment['blockers'] or relations['blockers']):raise ValueError('M2_UNRESOLVED')
    return plan


def status(root):
    root=Path(root);plan=verify_prepared(root)
    base=dict(planningDriver=DRIVER,generationCalls=0,automaticRetry=False,
              requestSha256=digest(root/'m2/request.json'))
    failure=root/'.dag/receive-failed.json'
    if failure.exists():
        record=read(failure)
        if (record.get('requestSha256')!=base['requestSha256'] or
                record.get('responseSha256')!=digest(root/'m2/draft.json')):
            raise ValueError('HOST_FAILED_RESPONSE_CHANGED')
        return dict(base,status='review_receive_failed',failure=record)
    if not (root/'.dag/received.json').exists():return dict(base,status='awaiting_host_review',unknowns=plan['unknowns'])
    verify_run(root,allow_issues=True)
    assessment=read(root/'m2/assessment.json')
    blocked=bool(assessment['blockers'] or assessment['relationBlockers'] or plan['unknowns'])
    return dict(base,status='review_blocked' if blocked else 'ready_to_freeze',
                **assessment,unknowns=plan['unknowns'])
