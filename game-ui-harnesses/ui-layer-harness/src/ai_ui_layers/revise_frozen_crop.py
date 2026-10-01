"""One explicit crop-only revision of a frozen plan rejected by visual inspection."""
import copy
import json
from pathlib import Path, PurePosixPath
import re
import shutil
import tempfile

from jsonschema import Draft202012Validator, ValidationError
from PIL import Image

from . import planning_dag as planning
from .compile_visual import selected_paths
from .evaluate import check_relations, digest, pixel_box, read, save
from .freeze_visual import freeze, inspect
from .local_patch import merge_patch, patch_schema
from .planning_review_policy import split
from .review_focus import make_focus, make_small_material_focus
from .sequence_focus import make_sequence_focus
from .session_review import session_id, render_for_review
from .visual_policy import planning_policy, snapshot_policy, planning_guidance, INPUT_NAME


KIND='ui_rejected_frozen_crop_revision_v1'
REJECTION_KIND='ui_frozen_crop_rejection_v1'
GRAPH={'repair':[], 'repair_check':['repair'], 'rereview':['repair_check'],
       'freeze':['rereview']}
REJECTION_SCHEMA={
    'type':'object','additionalProperties':False,
    'required':['kind','parentSnapshotDigest','referenceSha256','findings'],
    'properties':{
        'kind':{'const':REJECTION_KIND},
        'parentSnapshotDigest':{'type':'string','pattern':'^[0-9a-f]{64}$'},
        'referenceSha256':{'type':'string','pattern':'^[0-9a-f]{64}$'},
        'findings':{'type':'array','minItems':1,'items':{
            'type':'object','additionalProperties':False,
            'required':['materialId','sourceEvidence'],
            'properties':{'materialId':{'type':'string','minLength':1},
                          'sourceEvidence':{'type':'string','minLength':1}}}}}}


def _safe_file(base, name):
    relative=PurePosixPath(name)
    target=(base/name).resolve()
    if (relative.is_absolute() or '..' in relative.parts or '\\' in name or ':' in name
            or not target.is_relative_to(base)):
        raise ValueError('REVISION_PATH_ESCAPE')
    return target


def _verify_parent_state(source):
    source=Path(source).resolve()
    config=read(source/'.dag/config.json')
    if digest(source/'.dag/config.json')!=read(source/'.dag/config-digest.json')['sha256']:
        raise ValueError('PARENT_CONFIG_CHANGED')
    if config['kind']!='ui_planning_dag_v1':raise ValueError('PARENT_PLANNING_REQUIRED')
    for name,sha in config['inputs'].items():
        if digest(_safe_file(source/'.dag/inputs',name))!=sha:raise ValueError('PARENT_INPUT_CHANGED')
    for done in (source/'.dag').glob('*/done.json'):
        for name,sha in read(done)['outputs'].items():
            if digest(_safe_file(source,name))!=sha:raise ValueError('PARENT_OUTPUT_CHANGED')
    if not (source/'.dag/freeze/done.json').exists():raise ValueError('FROZEN_PARENT_REQUIRED')
    snapshot=inspect(source/'frozen')
    if planning_policy(source)!=snapshot_policy(source/'frozen',snapshot):
        raise ValueError('PARENT_VISUAL_POLICY_CHANGED')
    if snapshot.get('generationReference','full')!=config.get('generationReference','full'):
        raise ValueError('PARENT_GENERATION_POLICY_CHANGED')
    # An old fixed runtime is read-only evidence: verify its recorded outputs,
    # rather than comparing its runtime fingerprint with the current checkout.
    from .compile_visual import verify_run
    verify_run(source)
    plan_path,review_path=selected_paths(source)
    if (snapshot['sourcePlanSha256']!=digest(plan_path) or
            snapshot['reviewSha256']!=digest(review_path) or
            snapshot['files'].get('reference.png')!=digest(source/'m1/reference.png') or
            read(source/'frozen/compile-report.json')['sourceImageSha256']!=digest(source/'m1/reference.png')):
        raise ValueError('PARENT_SELECTED_EVIDENCE_CHANGED')
    return config,snapshot,plan_path,review_path


def _context_prompt_version(snapshot):
    version=(snapshot.get('contextPromptVersion','v1')
             if snapshot.get('generationReference','full')=='context-crops' else 'v3')
    if version not in ('v1','v2','v3','v4','v5','v6','v7'):raise ValueError('PARENT_CONTEXT_PROMPT_VERSION_INVALID')
    return version


def _validate_rejection(rejection, snapshot, reference, plan):
    try:Draft202012Validator(REJECTION_SCHEMA).validate(rejection)
    except ValidationError as exc:raise ValueError('INVALID_CROP_REJECTION') from exc
    if (rejection['parentSnapshotDigest']!=snapshot['digest'] or
            rejection['referenceSha256']!=digest(reference)):
        raise ValueError('REJECTION_SOURCE_MISMATCH')
    ids=[row['materialId'] for row in rejection['findings']]
    foreground={row['id'] for row in plan['materials'] if row['role']=='foreground'}
    if len(ids)!=len(set(ids)) or set(ids)-foreground:
        raise ValueError('REJECTION_MATERIAL_IDS_INVALID')
    for row in rejection['findings']:
        evidence=row['sourceEvidence']
        if (not evidence.strip() or re.search(r'(?i)(?:[a-z]:[/\\]|https?://|\\\\|/home/|/users/)',evidence)):
            raise ValueError('REJECTION_SOURCE_EVIDENCE_INVALID')


def _parent_file_digests(source):
    files={}
    for path in source.rglob('*'):
        if not path.is_file() or path==source/'.dag/lock':continue
        if not path.resolve().is_relative_to(source):raise ValueError('PARENT_PATH_ESCAPE')
        files[path.relative_to(source).as_posix()]=digest(path)
    return files


def init(source, output, rejection_path):
    source=Path(source).resolve();output=Path(output).resolve()
    if output==source or output.is_relative_to(source) or source.is_relative_to(output):
        raise ValueError('SEPARATE_REVISION_REQUIRED')
    if output.exists():raise ValueError('NEW_REVISION_DIRECTORY_REQUIRED')
    config,snapshot,plan_path,review_path=_verify_parent_state(source)
    rejection_bytes=Path(rejection_path).read_bytes()
    rejection=json.loads(rejection_bytes.decode('utf-8-sig'))
    plan=read(plan_path);reference=source/'m1/reference.png'
    _validate_rejection(rejection,snapshot,reference,plan)
    parent_files=_parent_file_digests(source)
    notes=source/'.dag/inputs/planning-notes.txt'
    policy=planning_policy(source)
    planning.init(reference,output,config['maxCalls'],config.get('generationMode','single'),
                  notes if notes.exists() else None,
                  generation_reference=config.get('generationReference','full'),
                  visual_policy=source/'.dag/inputs'/INPUT_NAME if policy is not None else None)
    child_config=read(output/'.dag/config.json')
    child_config.update(graph=GRAPH,maximumRepairs=1,
                        contextPromptVersion=_context_prompt_version(snapshot))
    (output/'.dag/config.json').write_text(json.dumps(child_config,ensure_ascii=False,
        indent=2,allow_nan=False),encoding='utf-8')
    (output/'.dag/config-digest.json').write_text(json.dumps(
        {'sha256':digest(output/'.dag/config.json')},ensure_ascii=False,indent=2),encoding='utf-8')
    (output/'m1').mkdir();(output/'parent-review').mkdir()
    for name in ('reference.png','schema.json'):
        (output/'m1'/name).write_bytes((source/'m1'/name).read_bytes())
    (output/'source-plan.json').write_bytes(plan_path.read_bytes())
    (output/'parent-review/draft.json').write_bytes(review_path.read_bytes())
    (output/'rejection.json').write_bytes(rejection_bytes)
    inputs={p.relative_to(output).as_posix():digest(p) for p in output.rglob('*')
            if p.is_file() and '.dag' not in p.relative_to(output).parts}
    save(output/'revision.json',dict(kind=KIND,parent=str(source),parentFiles=parent_files,
         parentSnapshotDigest=snapshot['digest'],sourcePlanSha256=digest(plan_path),
         parentReviewSha256=digest(review_path),referenceSha256=digest(reference),
         rejectionSha256=digest(output/'rejection.json'),inputs=inputs,
         contextPromptVersion=_context_prompt_version(snapshot),
         maximumRepairs=1,mediaGenerationCalls=0,automaticRetry=False))
    save(output/'revision-digest.json',{'sha256':digest(output/'revision.json')})
    check_inputs(output)
    return output


def check_inputs(root):
    root=Path(root).resolve()
    revision=read(root/'revision.json')
    if revision.get('kind')!=KIND:raise ValueError('UNKNOWN_REVISION_KIND')
    if digest(root/'revision.json')!=read(root/'revision-digest.json')['sha256']:
        raise ValueError('REVISION_CHANGED')
    config=read(root/'.dag/config.json')
    if digest(root/'.dag/config.json')!=read(root/'.dag/config-digest.json')['sha256']:
        raise ValueError('CONFIG_CHANGED')
    if (config['runtime']!=planning.runtime_files() or config['graph']!=GRAPH or
            config['maximumRepairs']!=1 or revision['maximumRepairs']!=1 or
            config['model']!=planning.CLI_MODEL or config['effort']!=planning.CLI_EFFORT or
            config['mediaGenerationCalls']!=0 or
            config['contextPromptVersion']!=revision['contextPromptVersion']):
        raise ValueError('REVISION_RUNTIME_OR_GRAPH_CHANGED')
    if revision['mediaGenerationCalls']!=0 or revision['automaticRetry'] is not False:
        raise ValueError('REVISION_POLICY_CHANGED')
    for name,sha in config['inputs'].items():
        if digest(_safe_file(root/'.dag/inputs',name))!=sha:raise ValueError('INPUT_CHANGED')
    for name,sha in revision['inputs'].items():
        if digest(_safe_file(root,name))!=sha:raise ValueError('REVISION_INPUT_CHANGED')
    for done in (root/'.dag').glob('*/done.json'):
        if done.parent.name not in GRAPH:raise ValueError('UNEXPECTED_REVISION_NODE')
        for name,sha in read(done)['outputs'].items():
            if digest(_safe_file(root,name))!=sha:raise ValueError('COMPLETED_OUTPUT_CHANGED:'+name)
    source=Path(revision['parent']).resolve()
    if root==source or root.is_relative_to(source) or source.is_relative_to(root):
        raise ValueError('SEPARATE_REVISION_REQUIRED')
    for name,sha in revision['parentFiles'].items():
        if digest(_safe_file(source,name))!=sha:raise ValueError('PARENT_EVIDENCE_CHANGED')
    parent_config,snapshot,plan_path,review_path=_verify_parent_state(source)
    if (config['inputs'].get(INPUT_NAME)!=parent_config['inputs'].get(INPUT_NAME) or
            config['inputs'].get(INPUT_NAME)!=snapshot.get('visualPolicySha256')):
        raise ValueError('REVISION_VISUAL_POLICY_CHANGED')
    if planning_policy(root)!=snapshot_policy(source/'frozen',snapshot):
        raise ValueError('REVISION_VISUAL_POLICY_CHANGED')
    if (snapshot['digest']!=revision['parentSnapshotDigest'] or
            digest(plan_path)!=revision['sourcePlanSha256'] or
            digest(review_path)!=revision['parentReviewSha256'] or
            digest(source/'m1/reference.png')!=revision['referenceSha256'] or
            revision['contextPromptVersion']!=_context_prompt_version(snapshot)):
        raise ValueError('PARENT_EVIDENCE_CHANGED')
    if (config['maxCalls']!=parent_config['maxCalls'] or
            config['generationMode']!=parent_config.get('generationMode','single') or
            config['generationReference']!=parent_config.get('generationReference','full')):
        raise ValueError('REVISION_GENERATION_POLICY_CHANGED')
    rejection=read(root/'rejection.json')
    if digest(root/'rejection.json')!=revision['rejectionSha256']:
        raise ValueError('REJECTION_CHANGED')
    _validate_rejection(rejection,snapshot,source/'m1/reference.png',read(plan_path))
    if (digest(root/'source-plan.json')!=revision['sourcePlanSha256'] or
            digest(root/'parent-review/draft.json')!=revision['parentReviewSha256'] or
            digest(root/'m1/reference.png')!=revision['referenceSha256'] or
            digest(root/'m1/schema.json')!=digest(source/'m1/schema.json')):
        raise ValueError('REVISION_SOURCE_CHANGED')
    return revision


def rejection_findings(root):
    root=Path(root).resolve();revision=check_inputs(root)
    return dict(kind='ui_planning_prior_findings_v1',
        sourcePlanSha256=revision['sourcePlanSha256'],
        reviewSha256=revision['parentReviewSha256'],
        rejectionSha256=revision['rejectionSha256'],blockers=[],warnings=[],
        explicitRejectionFindings=[dict(materialId=row['materialId'],
            sourceEvidence=row['sourceEvidence']) for row in read(root/'rejection.json')['findings']])


def check_scope(root, candidate=None):
    root=Path(root).resolve();source=read(root/'source-plan.json')
    patch=read(root/'repair/draft.json')
    selected={row['materialId'] for row in read(root/'rejection.json')['findings']}
    if (patch['materials']['remove'] or patch['objects']['upsert'] or patch['objects']['remove'] or
            any(row['id'] not in selected for row in patch['materials']['upsert'])):
        raise ValueError('FROZEN_CROP_SCOPE_CHANGED')
    if (patch['unknowns'] is not None and patch['unknowns']!=source['unknowns'] or
            any(patch.get(key) is not None and patch[key]!=source[key]
                for key in ('backgroundMode','textPolicy'))):
        raise ValueError('FROZEN_CROP_SCOPE_CHANGED')
    if candidate is None:
        candidate,_=merge_patch(root/'source-plan.json',patch,read(root/'m1/schema.json'),
                                digest(root/'source-plan.json'))
    if any(candidate[key]!=source[key] for key in source if key!='materials'):
        raise ValueError('FROZEN_CROP_SCOPE_CHANGED')
    if len(candidate['materials'])!=len(source['materials']):
        raise ValueError('FROZEN_CROP_SCOPE_CHANGED')
    changed=[]
    with Image.open(root/'m1/reference.png') as image:size=image.size
    for before,after in zip(source['materials'],candidate['materials']):
        if before['id']!=after['id']:
            raise ValueError('FROZEN_CROP_SCOPE_CHANGED')
        old=copy.deepcopy(before);new=copy.deepcopy(after)
        old_box=old.pop('bboxNorm');new_box=new.pop('bboxNorm')
        if old!=new or (old_box!=new_box and before['id'] not in selected):
            raise ValueError('FROZEN_CROP_SCOPE_CHANGED')
        if old_box!=new_box:
            if pixel_box(old_box,*size)==pixel_box(new_box,*size):
                raise ValueError('FROZEN_CROP_NO_EFFECTIVE_CHANGE')
            changed.append(before['id'])
    if not changed:raise ValueError('FROZEN_CROP_NO_EFFECTIVE_CHANGE')
    return candidate


def _verify_receipt(folder, sid, *, first):
    request=read(folder/'request.json');receipt=read(folder/'transport.json')
    if (receipt.get('failure') or receipt['exitCode']!=0 or not receipt['turnCompleted'] or
            receipt['unexpectedEvents'] or receipt.get('responseSha256')!=digest(folder/'draft.json')):
        raise ValueError('INVALID_REVISION_RECEIPT')
    if (session_id(folder/'events.jsonl')!=sid or request.get('newSession',False) is not first or
            (not first and request.get('sessionId')!=sid)):
        raise ValueError('SESSION_CHANGED')
    for name,sha in request['inputs'].items():
        if digest(_safe_file(folder,name))!=sha:raise ValueError('REVISION_CALL_INPUT_CHANGED')
    Draft202012Validator(read(folder/'schema.json')).validate(read(folder/'draft.json'))
    return request


def verify_revision(root, allow_issues=False):
    root=Path(root).resolve();revision=check_inputs(root)
    if not all((root/'.dag'/name/'done.json').exists()
               for name in ('repair','repair_check','rereview')):
        raise ValueError('REVISION_STAGES_INCOMPLETE')
    sid=read(root/'session.json')['sessionId']
    if sid==read(Path(revision['parent'])/'session.json')['sessionId']:
        raise ValueError('PARENT_SESSION_REUSED')
    repair=root/'repair';review=root/'rereview'
    repair_request=_verify_receipt(repair,sid,first=True)
    if (repair_request['sourcePlanSha256']!=revision['sourcePlanSha256'] or
            repair_request['rejectionSha256']!=revision['rejectionSha256'] or
            repair_request['originalReferenceSha256']!=revision['referenceSha256']):
        raise ValueError('REVISION_REPAIR_SOURCE_CHANGED')
    candidate,report=merge_patch(root/'source-plan.json',read(repair/'draft.json'),
                                 read(root/'m1/schema.json'),revision['sourcePlanSha256'])
    check_scope(root,candidate)
    if (candidate!=read(repair/'candidate.json') or report['programIssues'] or
            report['unresolvedIssues'] or candidate['unknowns']):
        raise ValueError('REVISION_INVALID_PATCH')
    if dict(report,remainingUnknowns=candidate['unknowns'])!=read(repair/'report.json'):
        raise ValueError('REVISION_REPAIR_REPORT_CHANGED')
    review_request=_verify_receipt(review,sid,first=False)
    if (review_request['candidateSha256']!=digest(repair/'candidate.json') or
            review_request['patchSha256']!=digest(repair/'draft.json') or
            review_request['originalReferenceSha256']!=revision['referenceSha256']):
        raise ValueError('REVISION_REVIEW_MISMATCH')
    result=read(review/'result.json')
    if result['reviewSha256']!=digest(review/'draft.json') or not result['sameSessionVerified']:
        raise ValueError('REVISION_REVIEW_CHANGED')
    if read(review/'prior-findings.json')!=rejection_findings(root):
        raise ValueError('REVISION_PRIOR_FINDINGS_CHANGED')
    from .compile_visual import verify_boundary_evidence, verify_plan_evidence
    verify_plan_evidence(review,read(review/'draft.json'),review_request,candidate)
    verify_boundary_evidence(review,read(review/'draft.json'),review_request,candidate,
                             root/'m1/reference.png')
    blockers,warnings=split(read(review/'draft.json'),candidate,planning_policy(root))
    assessment=read(review/'assessment.json')
    if (assessment['blockers']!=blockers or assessment['warnings']!=warnings or
            assessment['reviewSha256']!=digest(review/'draft.json')):
        raise ValueError('REVISION_ASSESSMENT_CHANGED')
    known={row['id'] for field in ('materials','objects') for row in candidate[field]}
    if any(set(issue['ids'])-known for issue in blockers+warnings):
        raise ValueError('UNKNOWN_REVIEW_IDS')
    if blockers and not allow_issues:raise ValueError('M2_UNRESOLVED')
    return candidate


def frozen_live_model(folder, sid, first):
    if not first:return planning.live_model(folder,sid,False)
    with tempfile.TemporaryDirectory(prefix='ui-frozen-crop-') as cwd:
        args=planning.command(shutil.which('codex'),folder,Path(cwd),
                              planning.CLI_MODEL,planning.CLI_EFFORT)
        args.remove('--ephemeral')
        images=[folder/'reference.png',folder/'review-overlay.png']
        images+=sorted(folder.glob('focus-*.png'))
        images+=sorted(folder.glob('coverage-*.png'),key=lambda path:(
            0 if path.name=='coverage-small-materials.png' else
            1 if path.name.startswith('coverage-small-materials-') else 2,path.name))
        args[args.index('--image')+1]=','.join(str(path) for path in images)
        return planning.invoke(args,folder,cwd,(folder/'prompt.md').read_text(encoding='utf-8'))


class FrozenCropDag(planning.Dag):
    def __init__(self, root, model=frozen_live_model):
        super().__init__(root,model)

    def verify(self):
        super().verify();check_inputs(self.root)

    def repair(self):
        root=self.root;p=self.folder('repair');source=root/'source-plan.json'
        policy=planning_policy(root)
        plan=read(source);rejection=read(root/'rejection.json')
        source_sha=digest(source)
        (p/'reference.png').write_bytes((root/'m1/reference.png').read_bytes())
        save(p/'schema.json',planning.transport_schema(
            patch_schema(read(root/'m1/schema.json'),source_sha)))
        save(p/'source-context.json',dict(materials=[m for m in plan['materials']
            if m['id'] in {row['materialId'] for row in rejection['findings']}],
            objects=[o for o in plan['objects'] if o['materialId'] in
                {row['materialId'] for row in rejection['findings']}]))
        render_for_review(p/'reference.png',plan,p/'source-preview')
        (p/'review-overlay.png').write_bytes((p/'source-preview/materials-overlay.png').read_bytes())
        focus=make_focus(p/'reference.png',p/'review-overlay.png',plan,p)
        if focus:save(p/'focus-meta.json',focus)
        small=make_small_material_focus(p/'reference.png',plan,p)
        sequence=make_sequence_focus(p/'reference.png',plan,p)
        prompt=(planning.BOX_TEXT_GUIDANCE+
            '这是已冻结规划在显式视觉检查后被拒收的独立新修订；旧模型审查不是本次问题来源。'
            '只对拒收记录列出的已有前景素材作一次裁框 bboxNorm 补丁，不增删素材和对象，不改标签、角色、层级、文字策略、unknowns 或其他字段。'
            '依据干净原图逐项核对四侧自有可见轮廓、浅色亮边及相邻归属；裁框为半开区间，右/下界像素不包含。'
            '候选裁片视窗的中性区不是原图或 alpha；原图上下文不改变归属，不凭色阈值自动扩框。'
            '无法确定真实边界时填 unresolvedIssues 并停止，不能猜测或原样返回。仅输出 schema 所需补丁，不调用工具。'
            '\n源计划 SHA-256：'+source_sha+
            '\n拒收证据 SHA-256：'+digest(root/'rejection.json')+
            '\n显式原图观察：'+json.dumps(rejection['findings'],ensure_ascii=False)+
            '\n完整原计划：'+json.dumps(plan,ensure_ascii=False)+
            '\n局部素材与对象：'+json.dumps(read(p/'source-context.json'),ensure_ascii=False))
        if small:prompt+='\n小素材同坐标原图/裁片证据：'+json.dumps(small,ensure_ascii=False)
        if focus:prompt+='\n局部边界证据：'+json.dumps(focus,ensure_ascii=False)
        if sequence:prompt+='\n序列原图证据：'+json.dumps(sequence,ensure_ascii=False)
        (p/'prompt.md').write_text(prompt+planning_guidance(policy)+self.user_context(),encoding='utf-8')
        names=['reference.png','schema.json','prompt.md','source-context.json','review-overlay.png']
        if focus:names+=['focus-meta.json']+[row['file'] for row in focus]
        if small:names+=['coverage-small-materials.json']+[row['file'] for row in small['pages']]
        if small and small.get('detail'):names.append(small['detail']['file'])
        if sequence:names+=['coverage-sequence-source.json']+[row['file'] for row in sequence['pages']]
        request=dict(newSession=True,sourcePlanSha256=source_sha,
             rejectionSha256=digest(root/'rejection.json'),
             originalReferenceSha256=digest(p/'reference.png'),
             inputs={name:digest(p/name) for name in names})
        if policy is not None:request['visualPolicySha256']=self.config['inputs'][INPUT_NAME]
        save(p/'request.json',request)
        self.call(p,first=True)
        if read(root/'session.json')['sessionId']==read(Path(read(root/'revision.json')['parent'])/'session.json')['sessionId']:
            raise ValueError('PARENT_SESSION_REUSED')

    def repair_check(self):
        super().repair_check(self.root/'source-plan.json')
        check_scope(self.root,read(self.root/'repair/candidate.json'))

    def execute(self):
        with planning.locked(self.root):
            if not (self.root/'.dag/execution.json').exists():
                save(self.root/'.dag/execution.json',{'driver':'codex-cli' if self.model is frozen_live_model
                     else 'injected-test-double'})
            self.node('repair',self.repair)
            self.node('repair_check',self.repair_check)
            self.node('rereview',lambda:self.review('rereview',self.root/'repair/candidate.json',
                 self.root/'repair/preview/materials-overlay.png'))
            self.node('freeze',lambda:freeze(self.root,self.root/'frozen',self.config['maxCalls'],
                 self.config['generationMode'],self.config['generationReference'],
                 self.config['contextPromptVersion']))
            return self.status()

    def status(self):
        self.verify();nodes={}
        for name in GRAPH:
            state=self.root/'.dag'/name
            nodes[name]=('completed' if (state/'done.json').exists() else
                         'failed' if (state/'failed.json').exists() else
                         'interrupted_or_running' if state.exists() else 'pending')
        frozen=nodes['freeze']=='completed'
        result={'kind':'ui_rejected_frozen_crop_status_v1',
                'status':'frozen' if frozen else 'incomplete','nodes':nodes,
                'failures':{p.parent.name:read(p)['error'] for p in
                            (self.root/'.dag').glob('*/failed.json')},
                'mediaGenerationCalls':0,'automaticRetries':0,'humanVisualAcceptance':False}
        if frozen:result['snapshotDigest']=inspect(self.root/'frozen')['digest']
        return result
