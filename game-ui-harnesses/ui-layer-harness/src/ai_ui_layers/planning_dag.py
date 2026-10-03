"""Local reference-to-frozen-plan DAG. No image generation, services, or implicit retries."""
import argparse
from contextlib import contextmanager
import json
import os
import re
from pathlib import Path
import shutil
import tempfile
import time
from jsonschema import Draft202012Validator
from PIL import Image
from .codex_call import command, transport_schema, transport_failure_details, CLI_MODEL, CLI_EFFORT
from .compile_visual import HARNESS
from .evaluate import read, save, digest, check_relations
from .freeze_visual import freeze, inspect
from .local_patch import patch_schema, merge_patch
from .review_focus import make_focus, make_small_material_focus
from .sequence_focus import make_sequence_focus
from .planning_review_policy import split, signatures, audit_rows
from .boundary_evidence import guidance as boundary_guidance, validate_boundaries
from .review_evidence import build_catalog, build_review_schema, configured_protocol, PROTOCOL_V3, PROTOCOL_V4
from . import relation_review
from .planning_normalization import m1_plan_path, provider_schema, derive, POLICY as NORMALIZATION_POLICY
from .session_review import invoke, resume_command, session_id, build_review_prompt, render_for_review, TransportFailure, validate_timeout
from .visual_policy import load_input, planning_policy, planning_guidance, INPUT_NAME
from . import visual_textures as textures

BASE=HARNESS/'planning-harness'
REPO=Path(__file__).resolve().parents[4]
DEFAULT_GENERATION_MODE='sheets'
DEFAULT_GENERATION_REFERENCE='context-crops'
DEFAULT_CONTEXT_PROMPT_VERSION='v7'
LEGACY_CONTEXT_PROMPT_VERSION='v3'
CONTEXT_PROMPT_VERSIONS=('v1','v2','v3','v4','v5','v6','v7')
GRAPH={'m1':[], 'check':['m1'], 'm2':['check'], 'repair':['m2'],
       'repair_check':['repair'], 'rereview':['repair_check'],
       'repair2':['rereview'], 'repair_check2':['repair2'], 'rereview2':['repair_check2'],
       'freeze':['m2','rereview','rereview2']}
BOX_TEXT_GUIDANCE=('素材框与对象辅助框都是保留图形的轴对齐包围框，不是去字遮罩。'
                   '素材框决定裁片、尺寸与归位；对象框仅作辅助定位，默认 null。'
                   '两项同素材例外必须非 null：同素材内分离控件各自的完整图形；同素材去字控件内与文字并排的集成功能图标。'
                   '已独立成素材的图标不因邻接外部文字自动要求对象框；若仍有定位歧义，须给原图依据，不以 null 本身为缺陷。'
                   '非 null 对象框须完整覆盖所指图形且位于所属素材内，必要内部定位框不得置空。'
                   '轮廓极值内不可避免的空隙含普通文字，不单独作为缩框依据；不得为避字截断图形。'
                   '仅文字撑大的可避免边界仍须收紧；去字效果与完整轮廓仍须生成后审查或验收。'
                   'static-composite 只规划当前可见外观；状态指原图可观察的选中标记、勾号、亮条、槽/填充和控件表面差异，描述真实颜色与结构。'
                   '有明确可见证据才使用启用/禁用等名称；截图不能判断点击是否有效等不可见业务行为时，不推断，也不作为本次视觉拆分的 unknowns 或 unresolvedIssues。'
                   '可见图形、边界、数量、遮挡、归属、层级或用户明确要求的输出状态仍有疑问时，保留 unknowns 并阻断；不得借此范围说明清除真实视觉疑问。\n')

COVERAGE_GUIDANCE=('coverageAudit 按九区逐项清点：observedArtwork 只列保留图形，businessText 只列待删除普通业务文字；'
    '先看干净原图再对照计划，重复实例及文字旁图形分别列项，不只遍历已有 ID。'
    '两数组都空才填非空 emptyRegionEvidence；任一非空时该字段填 null。'
    'covered 须有真实 materialId、可选同属 objectId；程序据此从本轮目录还原所属原文并核对对象归属。'
    'observedArtwork 不填写 planEvidenceId 或 planEvidenceQuote；所属原文仍须确实描述本项结构，'
    '泛称面板或 bbox 包含不能证明覆盖，归属也不代替视觉判断。'
    '缺失用 missing、不明用 uncertain，suggestedChange 非空；未知归属填 null。'
    'businessText 每项仅写原图完整文字实例的 artwork、所属 materialId 和原图 evidence，不填图形 objectId；'
    '须绑定无保留字许可的素材；保留字/图形符号另作图形核对。'
    'optional-shadow 只在显式允许时用于所属孤立柔影，描边/高光/实体不能排除。'
    '每项 evidence 给原图位置及依据；非问题建议填 null。'
    '顶层 issues 只列 semantic/geometry；cosmeticIssues 只用 schema 允许的 code，结构、状态与连接问题不降为 cosmetic。'
    '不输出旧 missingFromPlan；程序逐项派生阻断，复审仍清点全图。')


COVERAGE_LANES_GUIDANCE=('coverageAudit 按九区逐项清点，使用四个独立列表：'
    'coveredArtwork 只列所属描述确实完整覆盖的图形；unresolvedArtwork 列 missing/uncertain 图形及非空 suggestedChange；'
    'optionalShadowArtwork 只列显式容差允许的所属孤立柔影；businessText 只列待删普通业务文字。'
    '先看干净原图，再逐项对照本轮计划，重复实例及文字旁图形分别列项。'
    '四列表均空才填非空 emptyRegionEvidence，任一非空时填 null。'
    'coveredArtwork 和 optionalShadowArtwork 不填 disposition、suggestedChange 或 planEvidenceId，必须绑定真实 materialId；'
    '只有 coveredArtwork 可填同属 objectId，optionalShadowArtwork 的 objectId 必须 null。'
    '有裁框、层级、结构或描述修订需求的图形必须列入 unresolvedArtwork，不能同时声称已覆盖；未知归属填 null。'
    '程序按 materialId/objectId 还原本轮目录原文，泛称面板或 bbox 包含不能证明覆盖，编号不代替原图观察。'
    'businessText 每项写原图真实待删文字实例、所属 materialId 和 evidence，不填图形 objectId；保留装饰字列图形列表。'
    'optionalShadowArtwork 只绑定所属 materialId，objectId 必须填 null，不能用按钮/面板主体对象代指柔影；'
    '不包括描边、高光或实体，每项 evidence 给原图位置及孤立柔影依据；主体附带柔影不影响主体另列 coveredArtwork。'
    '顶层 issues 只列 semantic/geometry；cosmeticIssues 只用 schema 允许的 code，不把结构问题降为 cosmetic。'
    '不输出 observedArtwork、missingFromPlan 或 planEvidenceQuote；程序确定性解码列表后仍严格校验归属、覆盖及修补。')


def itemized_coverage_prompt(prompt, protocol=PROTOCOL_V3):
    guidance=COVERAGE_LANES_GUIDANCE if protocol==PROTOCOL_V4 else COVERAGE_GUIDANCE
    lines=prompt.splitlines(keepends=True)
    matches=[index for index,line in enumerate(lines) if line.startswith('coverageAudit 按')]
    if len(matches)>1:raise ValueError('DUPLICATE_COVERAGE_GUIDANCE')
    if matches:
        lines[matches[0]]=guidance+'\n'
        return ''.join(lines)
    return guidance+'\n'+prompt


def prior_findings(root, name):
    if name not in ('rereview','rereview2'):raise ValueError('REREVIEW_STAGE_REQUIRED')
    root=Path(root)
    if (root/'revision.json').exists() and read(root/'revision.json').get('kind')=='ui_rejected_frozen_crop_revision_v1':
        from .revise_frozen_crop import rejection_findings
        return rejection_findings(root)
    if (root/'revision.json').exists():
        review=root/'parent-review/draft.json';source=root/'source-plan.json'
    else:
        review=root/('m2/draft.json' if name=='rereview' else 'rereview/draft.json')
        source=m1_plan_path(root) if name=='rereview' else root/'repair/candidate.json'
    # Derive against the plan actually reviewed, never the repaired candidate.
    review_root=Path(read(root/'revision.json')['parent']) if review.parent.name=='parent-review' else root
    review_config=read(review_root/'.dag/config.json') if (review_root/'.dag/config.json').exists() else {}
    blockers,warnings=split(read(review),read(source),planning_policy(review_root),review_config.get('coverageTextPolicy'),textures.planning_input(review_root))
    return dict(kind='ui_planning_prior_findings_v1',sourcePlanSha256=digest(source),
                reviewSha256=digest(review),blockers=blockers,warnings=warnings)


def rereview_context(plan, findings):
    compact=lambda value:json.dumps(value,ensure_ascii=False,separators=(',',':'))
    external=('\n独立显式拒收证据（不是上一轮模型问题）：'+compact(findings['explicitRejectionFindings'])
              if findings.get('explicitRejectionFindings') else '')
    return ('\n先核销上轮问题；仍检查完整候选。新增阻断必须给原图证据，不能只换措辞重复问题。上轮待核销问题：'
            +compact({key:findings[key] for key in ('blockers','warnings')})
            +external+'\n检查修补后的完整候选，本次仅复审：\n'+compact(plan))


def runtime_files():
    files=list(Path(__file__).parent.glob('*.py'))+list((HARNESS/'src').rglob('*.py'))
    files += [BASE/'schemas/visual-plan.schema.json',BASE/'prompts/visual-plan.md',BASE/'prompts/visual-review.md']
    return {p.relative_to(REPO).as_posix():digest(p) for p in files if not p.name.startswith('test_')}


@contextmanager
def locked(root):
    with (root/'.dag/lock').open('a+b') as stream:
        stream.seek(0);stream.write(b'0');stream.flush();stream.seek(0)
        try:
            if os.name=='nt':
                import msvcrt
                msvcrt.locking(stream.fileno(),msvcrt.LK_NBLCK,1)
            else:
                import fcntl
                fcntl.flock(stream.fileno(),fcntl.LOCK_EX|fcntl.LOCK_NB)
        except OSError:raise ValueError('RUN_ALREADY_ACTIVE')
        try:yield
        finally:
            stream.seek(0)
            if os.name=='nt':msvcrt.locking(stream.fileno(),msvcrt.LK_UNLCK,1)
            else:fcntl.flock(stream.fileno(),fcntl.LOCK_UN)


def read_notes(path):
    if path is None:return None
    data=Path(path).read_bytes()
    if not data or len(data)>16384 or not data.decode('utf-8-sig').strip():
        raise ValueError('PLANNING_NOTES_SIZE_OR_EMPTY')
    return data


def validate_model_settings(model, effort, timeout):
    if not isinstance(model, str) or re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.-]{0,127}', model) is None:
        raise ValueError('PLANNING_MODEL')
    if effort not in ('none','minimal','low','medium','high','xhigh','max','ultra'):
        raise ValueError('PLANNING_EFFORT')
    validate_timeout(timeout)


def init(image, root, max_calls=128, generation_mode=DEFAULT_GENERATION_MODE, planning_notes=None, generation_reference=DEFAULT_GENERATION_REFERENCE, visual_policy=None, context_prompt_version=None,
         planning_model=CLI_MODEL, planning_effort=CLI_EFFORT, planning_timeout=900, visual_textures=None):
    validate_model_settings(planning_model, planning_effort, planning_timeout)
    from .context_references import validate_mode
    validate_mode(generation_reference)
    if generation_reference!='context-crops' and context_prompt_version is not None:
        raise ValueError('CONTEXT_PROMPT_REQUIRES_CONTEXT_CROPS')
    if generation_reference=='context-crops':
        context_prompt_version=(DEFAULT_CONTEXT_PROMPT_VERSION if context_prompt_version is None
                                else context_prompt_version)
        if context_prompt_version not in CONTEXT_PROMPT_VERSIONS:
            raise ValueError('CONTEXT_PROMPT_VERSION')
    policy_bytes=load_input(visual_policy)
    if policy_bytes is not None:
        policy=json.loads(policy_bytes.decode('utf-8-sig'))
        if policy['appearanceEvidence']=='bound-reference' and generation_reference!='context-crops':
            raise ValueError('BOUND_REFERENCE_CONTEXT_CROPS_REQUIRED')
    notes=read_notes(planning_notes)
    texture_bytes=textures.load_input(visual_textures,image)
    root=Path(root).resolve();image=Path(image)
    with Image.open(image) as im:
        if im.format!='PNG' or im.getexif().get(274,1)!=1:raise ValueError('PNG_WITH_REFERENCE_COORDINATES_REQUIRED')
        im.load()
    if not 1<=max_calls<=128:raise ValueError('CALL_LIMIT')
    if generation_mode not in ('single','sheets'):raise ValueError('GENERATION_MODE')
    root.mkdir(parents=True,exist_ok=False);(root/'.dag').mkdir();inputs=root/'.dag/inputs';inputs.mkdir()
    for name,source in [('reference.png',image),('visual-plan.md',BASE/'prompts/visual-plan.md'),
                        ('visual-review.md',BASE/'prompts/visual-review.md'),('storage-schema.json',BASE/'schemas/visual-plan.schema.json')]:
        (inputs/name).write_bytes(source.read_bytes())
    if notes is not None:(inputs/'planning-notes.txt').write_bytes(notes)
    if policy_bytes is not None:(inputs/INPUT_NAME).write_bytes(policy_bytes)
    if texture_bytes is not None:(inputs/textures.INPUT_NAME).write_bytes(texture_bytes)
    save(root/'.dag/config.json',{'kind':'ui_planning_dag_v1','runtime':runtime_files(),
         'inputs':{p.name:digest(p) for p in inputs.iterdir()},'maxCalls':max_calls,'generationMode':generation_mode,'generationReference':generation_reference,
         **({'contextPromptVersion':context_prompt_version} if context_prompt_version is not None else {}),
         'relationReviewPolicy':relation_review.POLICY,'normalizationPolicy':NORMALIZATION_POLICY,'coverageTextPolicy':'exact-fragments-v1',
         'reviewEvidenceProtocol':PROTOCOL_V4,
         **({'visualTexturePolicy':textures.POLICY} if texture_bytes is not None else {}),
         'model':planning_model,'effort':planning_effort,'timeoutSeconds':planning_timeout,
         'graph':GRAPH,'maximumRepairs':2,'mediaGenerationCalls':0})
    save(root/'.dag/config-digest.json',{'sha256':digest(root/'.dag/config.json')})
    return root


def live_model(folder, sid, first):
    config=read(folder.parent/'.dag/config.json')
    model=config.get('model',CLI_MODEL);effort=config.get('effort',CLI_EFFORT)
    timeout=config.get('timeoutSeconds',900)
    validate_model_settings(model, effort, timeout)
    with tempfile.TemporaryDirectory(prefix='ui-planning-dag-') as cwd:
        if first:
            args=command(shutil.which('codex'),folder,Path(cwd),model,effort);args.remove('--ephemeral')
        else:args=resume_command(shutil.which('codex'),folder,Path(cwd),sid,model,effort)
        return invoke(args,folder,cwd,(folder/'prompt.md').read_text(encoding='utf-8'),timeout=timeout)


class Dag:
    def __init__(self, root, model=live_model):
        self.root=Path(root).resolve();self.model=model;self.config=read(self.root/'.dag/config.json')
        self.inputs=self.root/'.dag/inputs'

    def verify(self):
        validate_model_settings(self.config.get('model',CLI_MODEL), self.config.get('effort',CLI_EFFORT),
                                self.config.get('timeoutSeconds',900))
        if digest(self.root/'.dag/config.json')!=read(self.root/'.dag/config-digest.json')['sha256']:
            raise ValueError('CONFIG_CHANGED')
        if self.config['runtime']!=runtime_files():raise ValueError('RUNTIME_CHANGED_NEW_RUN_REQUIRED')
        version=self.config.get('contextPromptVersion')
        reference=self.config.get('generationReference','full')
        if version is not None:
            if version not in CONTEXT_PROMPT_VERSIONS:raise ValueError('CONTEXT_PROMPT_VERSION')
            if reference!='context-crops':
                # Earlier frozen-crop revisions pin a redundant v3 on full-reference
                # children. Accept it only with that revision's bound internal record.
                revision_path=self.root/'revision.json'
                internal_full_crop=False
                if reference=='full' and version=='v3' and revision_path.is_file():
                    revision=read(revision_path)
                    if digest(revision_path)!=read(self.root/'revision-digest.json')['sha256']:
                        raise ValueError('REVISION_CHANGED')
                    internal_full_crop=(revision.get('kind')=='ui_rejected_frozen_crop_revision_v1'
                                        and revision.get('contextPromptVersion')=='v3')
                if not internal_full_crop:raise ValueError('CONTEXT_PROMPT_REQUIRES_CONTEXT_CROPS')
        for name,value in self.config['inputs'].items():
            if digest(self.inputs/name)!=value:raise ValueError('INPUT_CHANGED')
        if version is not None and reference=='context-crops' and (self.root/'frozen/snapshot.json').is_file():
            frozen=inspect(self.root/'frozen')
            compiled=read(self.root/'frozen/compile-report.json')
            if (frozen.get('contextPromptVersion','v1')!=version or
                    compiled.get('contextPromptVersion','v1')!=version):
                raise ValueError('FROZEN_CONTEXT_PROMPT_VERSION_MISMATCH')
        planning_policy(self.root)
        textures.planning_input(self.root)
        relation_review.policy(self.root)
        from .planning_normalization import validate_policy
        validate_policy(self.config.get('normalizationPolicy'))
        if self.config.get('coverageTextPolicy') not in (None,'exact-fragments-v1'):raise ValueError('COVERAGE_TEXT_POLICY_UNKNOWN')
        configured_protocol(self.config)
        for done in (self.root/'.dag').glob('*/done.json'):
            for name,value in read(done)['outputs'].items():
                if digest(self.root/name)!=value:raise ValueError('COMPLETED_OUTPUT_CHANGED:'+name)

    def files(self):
        return {p.relative_to(self.root).as_posix():digest(p) for p in self.root.rglob('*')
                if p.is_file() and '.dag' not in p.relative_to(self.root).parts}

    def node(self, name, action):
        self.verify();state=self.root/'.dag'/name
        if (state/'done.json').exists():return
        if state.exists():raise ValueError('NODE_INCOMPLETE_NO_RESUBMIT:'+name)
        state.mkdir();save(state/'started.json',{'node':name,'time':time.time()})
        before=self.files();start=time.perf_counter()
        print(json.dumps({'node':name,'status':'running'}),flush=True)
        try:
            action();self.verify();after=self.files()
            save(state/'done.json',{'node':name,'seconds':time.perf_counter()-start,
                'outputs':{k:v for k,v in after.items() if before.get(k)!=v}})
            print(json.dumps({'node':name,'status':'completed','seconds':time.perf_counter()-start}),flush=True)
        except Exception as exc:
            record={'node':name,'seconds':time.perf_counter()-start,
                    'error':type(exc).__name__+': '+str(exc),'automaticRetry':False}
            if isinstance(exc,TransportFailure):record['failureDetails']=exc.details
            save(state/'failed.json',record)
            raise

    def folder(self,name):
        p=self.root/name;p.mkdir();return p

    def call(self,folder,first=False):
        sid=None if first else read(self.root/'session.json')['sessionId']
        self.model(folder,sid,first)
        receipt=read(folder/'transport.json')
        if receipt.get('failure') or receipt['exitCode'] or not receipt['turnCompleted'] or receipt['unexpectedEvents']:
            raise ValueError('MODEL_CALL_FAILED')
        if receipt['responseSha256']!=digest(folder/'draft.json'):raise ValueError('MODEL_OUTPUT_CHANGED')
        observed=session_id(folder/'events.jsonl')
        if not first and observed!=sid:raise ValueError('SESSION_CHANGED')
        Draft202012Validator(read(folder/'schema.json')).validate(read(folder/'draft.json'))
        if first:save(self.root/'session.json',{'sessionId':observed})
        return receipt

    def user_context(self):
        texture_guidance=textures.guidance(textures.planning_input(self.root))
        if 'planning-notes.txt' not in self.config['inputs']:return texture_guidance
        return ('\n用户确认的拆分要求（这是目标约束，不是模型观察结论；不代替几何、归属和质量检查）：\n'
                +(self.inputs/'planning-notes.txt').read_text(encoding='utf-8-sig')+'\n'+texture_guidance)

    def review_split(self,review,plan):
        return split(review,plan,planning_policy(self.root),self.config.get('coverageTextPolicy'),textures.planning_input(self.root))

    def m1(self):
        p=self.folder('m1')
        policy=planning_policy(self.root)
        for name,source in [('reference.png','reference.png'),('prompt.md','visual-plan.md')]:
            (p/name).write_bytes((self.inputs/source).read_bytes())
        with Image.open(p/'reference.png') as reference:
            width,height=reference.size
        context=(BOX_TEXT_GUIDANCE+f'参考图原始画布：width={width}, height={height} 像素。'
                 'bboxNorm 的 x 除以完整画布宽、y 除以完整画布高；'
                 '不要使用界面显示尺寸、假定方形画布或附加留白作为分母。'
                 '全画布背景框不证明其他可见图形已被覆盖；有明确边界的界面覆盖区按视觉单元判断素材归属，'
                 '不能用背景全框代替覆盖检查。短标签放不下的可见细节分给多个对象，描述须完整；'
                 '类别名称不能代替部件数量、连接关系和真实间隙，按可见结构描述，不用不确定术语补全。\n\n')
        (p/'prompt.md').write_text(context+(p/'prompt.md').read_text(encoding='utf-8-sig')+
                                   planning_guidance(policy)+self.user_context(),encoding='utf-8')
        save(p/'schema.json',transport_schema(provider_schema(read(self.inputs/'storage-schema.json'),self.config.get('normalizationPolicy'))))
        request={'inputs':{n:digest(p/n) for n in ('reference.png','prompt.md','schema.json')},
                 'model':self.config['model'],'effort':self.config['effort'],
                 'timeoutSeconds':self.config.get('timeoutSeconds',900),'mediaGenerationCalls':0,
                 'maximumRepairs':self.config.get('maximumRepairs',1)}
        if policy is not None:request['visualPolicySha256']=self.config['inputs'][INPUT_NAME]
        if textures.INPUT_NAME in self.config['inputs']:request['visualTexturesSha256']=self.config['inputs'][textures.INPUT_NAME]
        save(self.root/'request.json',request)
        self.call(p,True)
        derive(p,self.inputs/'storage-schema.json',self.config.get('normalizationPolicy'))

    def check(self):
        p=self.root/'m1';plan=read(m1_plan_path(self.root))
        save(p/'program-check.json',{'issues':check_relations(plan)})
        render_for_review(p/'reference.png',plan,p/'preview')

    def review(self,name,plan_path,overlay):
        p=self.folder(name);sid=read(self.root/'session.json')['sessionId'];plan=read(plan_path)
        catalog=build_catalog(plan);save(p/'plan-evidence-catalog.json',catalog)
        policy=planning_policy(self.root)
        (p/'review-overlay.png').write_bytes(overlay.read_bytes())
        (p/'review-source.md').write_bytes((self.inputs/'visual-review.md').read_bytes())
        focus=make_focus(self.root/'m1/reference.png',p/'review-overlay.png',plan,p)
        small_focus=make_small_material_focus(self.root/'m1/reference.png',plan,p)
        sequence_focus=make_sequence_focus(self.root/'m1/reference.png',plan,p)
        protocol=configured_protocol(self.config)
        schema=build_review_schema(catalog,small_focus,policy,protocol,coverage_text_policy=self.config.get('coverageTextPolicy'))
        schema=textures.bind_review_schema(schema,textures.planning_input(self.root),plan)
        relations=None
        if relation_review.policy(self.root):
            relations=relation_review.catalog(plan,digest(self.root/'m1/reference.png'))
            save(p/relation_review.NAME,relations)
            schema=relation_review.bind_schema(schema,relations)
        save(p/'schema.json',schema)
        review_checks=build_review_prompt((p/'review-source.md').read_text(encoding='utf-8'),
                                          check_relations(plan))
        copied_quote='证据逐字引用所属素材/对象 label；'
        if review_checks.count(copied_quote)>1:raise ValueError('DUPLICATE_REVIEW_QUOTE_GUIDANCE')
        review_checks=review_checks.replace(copied_quote,
            '覆盖项由程序按 materialId/objectId 还原本轮计划目录原文；小素材部件另选所属 planEvidenceId；',1)
        prompt=BOX_TEXT_GUIDANCE+itemized_coverage_prompt(review_checks,protocol)
        if name.startswith('rereview'):
            findings=prior_findings(self.root,name)
            save(p/'prior-findings.json',findings)
            prompt+=rereview_context(plan,findings)
        if small_focus:
            prompt=('小素材附件：左为无标记原图上下文，右为裁片按原偏移放在相同坐标、相同比例的中性诊断视窗上。'
                    '中性区不是原图或 alpha；裁框为半开区间，右/下界不包含。诊断标签、边距不属于原图，上下文不改变归属。'
                    'smallMaterialAudit 按第一页 materialId 逐项填写。'
                    'boundary.status 判断候选框是否额外丢失原图可见自有轮廓：complete=全保留，clipped=漏可见部分，uncertain=无法确认；evidence 分清原图边缘与裁片边缘，不推测画外内容。'
                    '只按原图逐一列每个可辨保留图形部件，包括附属道具、部分遮挡和名称不确定的部分；'
                    '普通业务文字只填各区 businessText，不列入 smallMaterialAudit.parts。'
                    'observedAppearance 写形状、颜色、浅色高光、暗色细点、表面印记或“无可辨印记”，不遗漏局部明暗点纹。'
                    'planEvidenceId 从本轮目录选所属素材 m: 或同属对象 o: 的编号；没有真实描述依据填 null，不能拼接或猜测标签。'
                    '编号只证明出处，不代替观察；descriptionStatus 判断观察与描述是否一致：'
                    'consistent=数量、形状、连接/间隙及显著外观一致，等价措辞允许；missing=缺少，conflicting=矛盾，uncertain=无法确认。'
                    '整体名、类别术语或部分颜色不能替代结构、色点、高光和印记；不要用自己的观察替模糊的所属描述补足结构。'
                    '缺少描述依据填 null 编号；非 consistent 给局部 suggestedChange，consistent 填“无需修改”。'
                    '空/错属编号或非 consistent 均阻断；不要把结构疑问降级为措辞告警。'+prompt)
            if small_focus['boundaryOnlyItems']:
                prompt=('后续页的 smallBoundaryAudit 按 materialId 逐项只做同一轮廓截断检查；'
                        'clipped/uncertain 须给原图依据。'+prompt)
            if small_focus.get('detail'):
                detail=small_focus['detail']
                prompt=('另附 '+detail['materialId']+' 的无标记原图上下文放大，原图像素范围 '+str(detail['sourceBox'])+
                        '，候选框 '+str(detail['candidateBox'])+'；核对框内外完整自有轮廓及明暗点纹。'+prompt)
            prompt=boundary_guidance(small_focus)+prompt
        if focus:
            save(p/'focus-meta.json',focus)
            prompt=('先核对下列局部证据：近边固定装饰的完整轮廓，或重复对齐卡片各自闭合边框的真实四边与归属。局部附件左半是干净原图、右半是同坐标标框叠图；若有同行高度候选边，它们只是寻找轮廓的搜索点，不是自动改框坐标。区分卡片自身闭合边框与相邻容器的分隔线，只按可见连接判断；对齐比较本身不是缺陷，也不要因其他小告警跳过这一检查：'+json.dumps(focus,ensure_ascii=False)+'\n'+prompt)
        if policy is not None and policy['appearanceEvidence']=='bound-reference':
            prompt=prompt.replace('空/错属编号或非 consistent 均阻断；不要把结构疑问降级为措辞告警。',
                                  '空/错属编号或 missing/conflicting/uncertain 均阻断；合格 reference-bound 只记录警告，结构疑问不得降级。')
            prompt=prompt.replace('整体名、类别术语或部分颜色不能替代结构、色点、高光和印记；不要用自己的观察替模糊的所属描述补足结构。',
                                  '整体名、类别术语或部分颜色不能替代结构、身份、状态、连接及显著高光、渐变和印记；仅细微表面可明确交给绑定原图，不用观察替模糊的所属描述补足结构。')
        if policy is not None:
            prompt+=planning_guidance(policy)
            prompt+='smallMaterialAudit 每个 part 必填 deferredAppearance；只有 reference-bound 填非空字符串，其余状态填 null。\n'
            if policy['appearanceEvidence']=='bound-reference':
                prompt+=('reference-bound 仅用于所选所属描述已证明结构、身份、数量、状态及连接关系，'
                         '剩余细微表面由本次绑定原图承接；填写非空 deferredAppearance 说明具体延期表面。'
                         '缺失/矛盾/不确定仍填对应状态，不借此跳过轮廓、归属或描述核对。\n')
        if self.config.get('coverageTextPolicy'):
            prompt=prompt.replace('须绑定无保留字许可的素材；保留字/图形符号另作图形核对。',
                                  '待删textFragments不可与该素材或scene的保留字许可重合；保留字/图形符号另作图形核对。')
            graphic_lists='coveredArtwork 或 unresolvedArtwork' if protocol==PROTOCOL_V4 else 'observedArtwork'
            prompt+=('\n业务字精确片段合同：businessText每项必填textFragments，按原图写真实待删字串（可逐段），不得把图形符号写作文字；保留装饰字仍列'+graphic_lists+'。同素材可同时有待删业务字与获准装饰字，但待删片段不能与该素材或scene的preserveText重合。\n')
        prompt+=('\n本轮计划证据目录（摘要必须回填 planEvidenceCatalogDigest，协议填 '+protocol+'；'
                 '覆盖项由 materialId/objectId 定位，小素材 parts 才选择所属 planEvidenceId；'
                 '不得复制、拼接或改写 label；仍须独立对原图判断是否描述所见）：'
                 +json.dumps(catalog,ensure_ascii=False,separators=(',',':'))+'\n')
        if relations is not None:prompt+=relation_review.guidance(relations)
        (p/'prompt.md').write_text(prompt+self.user_context(),encoding='utf-8')
        names=['schema.json','review-source.md','review-overlay.png','prompt.md','plan-evidence-catalog.json']
        if relations is not None:names.append(relation_review.NAME)
        if name.startswith('rereview'):names.append('prior-findings.json')
        if focus:names+=['focus-meta.json']+[row['file'] for row in focus]
        if small_focus:names+=['coverage-small-materials.json']+[row['file'] for row in small_focus['pages']]
        if small_focus and small_focus.get('detail'):names.append(small_focus['detail']['file'])
        if sequence_focus:names+=['coverage-sequence-source.json']+[row['file'] for row in sequence_focus['pages']]
        bound={'sessionId':sid,'originalImageResent':True,
               'originalReferenceSha256':digest(self.root/'m1/reference.png'),
               'inputs':{n:digest(p/n) for n in names}}
        if name=='m2':bound['sourcePlanSha256']=digest(plan_path)
        else:bound.update(candidateSha256=digest(plan_path),patchSha256=digest(plan_path.parent/'draft.json'))
        if policy is not None:bound['visualPolicySha256']=self.config['inputs'][INPUT_NAME]
        if textures.INPUT_NAME in self.config['inputs']:bound['visualTexturesSha256']=self.config['inputs'][textures.INPUT_NAME]
        save(p/'request.json',bound);receipt=self.call(p)
        answer=read(p/'draft.json');known={o['id'] for k in ('materials','objects') for o in plan[k]}
        if small_focus and ({row['materialId'] for row in audit_rows(answer,'smallMaterialAudit')} !=
                            {row['materialId'] for row in small_focus['items']}):
            raise ValueError('SMALL_MATERIAL_AUDIT_IDS_REQUIRED')
        if small_focus and small_focus['boundaryOnlyItems'] and (
                {row['materialId'] for row in audit_rows(answer,'smallBoundaryAudit')} !=
                {row['materialId'] for row in small_focus['boundaryOnlyItems']}):
            raise ValueError('SMALL_BOUNDARY_AUDIT_IDS_REQUIRED')
        if small_focus:validate_boundaries(answer,small_focus)
        blockers,warnings=self.review_split(answer,plan)
        if relations is not None:
            assessment=relation_review.assess(plan,relations['referenceSha256'],answer)
            save(p/'relation-assessment.json',assessment)
            blockers+=self.relation_blockers(assessment['blockers'])
        if any(set(i['ids'])-known for i in blockers+warnings):raise ValueError('UNKNOWN_REVIEW_IDS')
        save(p/'assessment.json',dict(blockers=blockers,warnings=warnings,reviewSha256=digest(p/'draft.json')))
        if name=='m2':
            first=read(self.root/'m1/transport.json')
            save(self.root/'result.json',{'sameSessionVerified':True,'sessionId':sid,'unknownIssueIds':[],
                 'sourcePlanSha256':digest(self.root/'m1/draft.json'),'derivedSourcePlanSha256':digest(plan_path),'reviewSha256':digest(p/'draft.json'),
                 'm1Seconds':first['elapsedSeconds'],'m2Seconds':receipt['elapsedSeconds'],
                 'm3Executed':False,'productionReady':False,'humanVisualAcceptance':False})
        else:
            save(p/'result.json',{'sameSessionVerified':True,'sessionId':sid,'reviewSha256':digest(p/'draft.json'),
                 'seconds':receipt['elapsedSeconds'],
                 'issueCount':len(answer['issues'])+len(answer['cosmeticIssues']),
                 'automaticRetry':False})
            if blockers:
                repeated=signatures(blockers)&signatures(findings['blockers'])
                if name=='rereview2' or repeated or (self.root/'revision.json').exists() or self.config.get('maximumRepairs',1)<2:
                    raise ValueError('REREVIEW_UNRESOLVED')

    def repair(self, source=None, review_dir=None, name='repair'):
        p=self.folder(name);source=source or m1_plan_path(self.root);source_sha=digest(source)
        review_dir=review_dir or self.root/'m2'
        policy=planning_policy(self.root)
        review_root=Path(read(self.root/'revision.json')['parent']) if review_dir.name=='parent-review' else self.root
        review_config=read(review_root/'.dag/config.json') if (review_root/'.dag/config.json').exists() else {}
        plan=read(source);issues=dict(issues=split(read(review_dir/'draft.json'),plan,planning_policy(review_root),review_config.get('coverageTextPolicy'),textures.planning_input(review_root))[0])
        program_issues=self.reviewed_relations(plan,review_dir)
        ids={key for issue in issues['issues'] for key in issue['ids']}
        ids.update(key for issue in program_issues for key in issue.get('materialIds',[]))
        ids.update(issue['id'] for issue in program_issues if 'id' in issue)
        owners=ids | {o['materialId'] for o in plan['objects'] if o['id'] in ids}
        context=dict(materials=[m for m in plan['materials'] if m['id'] in owners],
                     objects=[o for o in plan['objects'] if o['materialId'] in owners])
        save(p/'source-context.json',context)
        relation_catalog=relation_review.catalog(plan,digest(self.root/'m1/reference.png')) if relation_review.policy(self.root) else None
        if relation_catalog is not None:save(p/relation_review.NAME,relation_catalog)
        save(p/'schema.json',transport_schema(patch_schema(read(self.inputs/'storage-schema.json'),source_sha,relation_catalog)))
        (p/'review-overlay.png').write_bytes((review_dir/'review-overlay.png').read_bytes())
        focus=read(review_dir/'focus-meta.json') if (review_dir/'focus-meta.json').exists() else []
        if focus:
            (p/'focus-meta.json').write_bytes((review_dir/'focus-meta.json').read_bytes())
            for row in focus:(p/row['file']).write_bytes((review_dir/row['file']).read_bytes())
        small_focus=(review_dir/'coverage-small-materials.json').exists()
        if small_focus:
            small_metadata=read(review_dir/'coverage-small-materials.json')
            detail=small_metadata.get('detail')
            small_files=[row['file'] for row in small_metadata.get('pages',[
                {'file':small_metadata['file']}])]
            for name in ['coverage-small-materials.json',*small_files,*([detail['file']] if detail else [])]:
                (p/name).write_bytes((review_dir/name).read_bytes())
        sequence_metadata=review_dir/'coverage-sequence-source.json'
        sequence_files=[]
        if sequence_metadata.exists():
            sequence_files=['coverage-sequence-source.json']+[row['file'] for row in read(sequence_metadata)['pages']]
            for filename in sequence_files:(p/filename).write_bytes((review_dir/filename).read_bytes())
        prompt=BOX_TEXT_GUIDANCE+('继续同一会话，按 M2 与程序问题仅修补一次，不重写整个计划、不调用工具。'
                'materials/objects.upsert 为新增或替换的完整记录，remove 为删除 ID，保留无关记录。'
                'materials.upsert 和 objects.upsert 各自每个 ID 最多一条完整记录；同 ID 来自多条问题的修改先合并为唯一最终完整记录，保留未被问题否定的内容。'
                '不存在 first/last 条覆盖规则；不以截断或拼接标签掩盖描述不足，不提交同 ID 的冲突版本。remove 不重复且不与 upsert 同 ID；无法形成一致完整记录时写 unresolvedIssues，程序仍拒绝重复 ID。'
                'unknowns/backgroundMode/textPolicy 为 null 时沿用，preserveText 在对应素材记录内修订。'
                '对 UNASSIGNED_VISIBLE_ARTWORK，先核对原图；确有遗漏时补齐所属材料与对象的可见内容描述，必要时新增对象或材料，不靠缩框或改 unknowns 掩盖。'
                '补充描述时保留旧 label 中未被问题否定的场景、图形和颜色，复查完整改写结果，不输出截断词或乱码。'
                '单条 label 上限 200 字符；素材 label 概述身份，对象 label 分别承载具体细节，背景细节对象仍归同一背景且不新增 kind=background。用完整短句、不重复清单；仅为独立视觉单元拆素材，不因描述长度拆图。'
                '先对照干净原图核对受影响素材、相邻素材及完整对象组的四边极值与唯一归属；M2 的 suggestedChange 是待验证建议，不是只修所提一边或照抄坐标。'
                '固定装饰不因新增记录就必须加辅助框；只有需要局部定位时提供，已有必要定位框不得为消除告警改成 null。'
                '非 null 框须覆盖名称所指完整图形及延伸，父素材框覆盖不能抵消辅助框截断。'
                '复核受影响容器的自身外边界及对象归属，不以子控件边缘替代容器边缘。'
                '重复卡片异常须沿原图核对自身闭合边框与相邻容器线；同行高度候选边仅供定位，不得直接照抄。若与 M2 结论冲突，以原图证据重新判断，不靠保留原框消除程序问题。'
                '无法解决的问题写 unresolvedIssues，不猜测。sourcePlanSha256 原样回传：'+source_sha+
                '\n受影响的原始素材及全部所属对象（未改写）：'+json.dumps(context,ensure_ascii=False)+
                '\nM2问题：'+json.dumps(issues,ensure_ascii=False)+
                '\n程序问题：'+json.dumps({'issues':program_issues},ensure_ascii=False))
        if relation_catalog is not None:
            prompt+=relation_review.guidance(relation_catalog).replace('relationReview','relationRepair')
            prompt+=('\n逐对关系修补：上轮真实派生关系证据 '+json.dumps(read(review_dir/'relation-assessment.json') if (review_dir/'relation-assessment.json').exists() else {'status':'no prior pair evidence; all raw hints require fresh review'},ensure_ascii=False)+
                     '。只修真实遮挡、归属或错框；正确AABB交叉不能缩框或任意改深度。保留pairId逐对解释未解决项于unresolvedIssues；空patch不能自行核销uncertain。修改后的candidate必须经下一轮绑定原图的逐对复审。')
        if focus:prompt+='\n上一轮边界局部证据继续随附件提供：'+json.dumps(focus,ensure_ascii=False)
        if small_focus:
            prompt+='\n上一轮小素材原图放大证据继续随附件提供。'
            if detail:prompt+=' 无标记原图上下文放大对应 '+detail['materialId']+'，邻近像素不改变归属。'
        (p/'prompt.md').write_text(prompt+planning_guidance(policy)+self.user_context(),encoding='utf-8')
        names=['schema.json','prompt.md','review-overlay.png','source-context.json',*sequence_files]
        if relation_catalog is not None:names.append(relation_review.NAME)
        if focus:names+=['focus-meta.json']+[row['file'] for row in focus]
        if small_focus:names+=['coverage-small-materials.json',*small_files]
        if small_focus and detail:names.append(detail['file'])
        request={'sessionId':read(self.root/'session.json')['sessionId'],'sourcePlanSha256':source_sha,
             'originalImageResent':True,'originalReferenceSha256':digest(self.root/'m1/reference.png'),
             'reviewSha256':digest(review_dir/'draft.json'),'inputs':{n:digest(p/n) for n in names}}
        if policy is not None:request['visualPolicySha256']=self.config['inputs'][INPUT_NAME]
        if textures.INPUT_NAME in self.config['inputs']:request['visualTexturesSha256']=self.config['inputs'][textures.INPUT_NAME]
        save(p/'request.json',request)
        self.call(p)

    def repair_check(self, source=None, name='repair', allow_program_issues=False):
        p=self.root/name;source=source or m1_plan_path(self.root)
        relation_catalog=relation_review.catalog(read(source),digest(self.root/'m1/reference.png')) if relation_review.policy(self.root) else None
        plan,report=merge_patch(source,read(p/'draft.json'),read(self.inputs/'storage-schema.json'),digest(source),relation_catalog)
        report['remainingUnknowns']=plan['unknowns']
        save(p/'candidate.json',plan);save(p/'report.json',report)
        if (report['unresolvedIssues'] or plan['unknowns'] or
                (report['programIssues'] and not allow_program_issues and
                 (not relation_review.policy(self.root) or any(i['code']!='SAME_LAYER_OVERLAP_REVIEW' for i in report['programIssues'])))):
            raise ValueError('REPAIR_UNRESOLVED')
        render_for_review(self.root/'m1/reference.png',plan,p/'preview')

    @staticmethod
    def relation_blockers(issues):
        return [dict(code=i['code'],category='geometry',ids=i.get('materialIds',[i['id']] if 'id' in i else []),
                     description=json.dumps(i,ensure_ascii=False),suggestedChange='Resolve against the original reference.') for i in issues]

    def reviewed_relations(self, plan, folder):
        if not relation_review.policy(self.root) or folder.name=='parent-review':return check_relations(plan)
        return relation_review.verify_stage(self.root,folder,plan)['blockers']

    def execute(self):
        with locked(self.root):
            if not (self.root/'.dag/execution.json').exists():
                save(self.root/'.dag/execution.json',{'driver':'codex-cli' if self.model is live_model else 'injected-test-double'})
            self.node('m1',self.m1);self.node('check',self.check)
            self.node('m2',lambda:self.review('m2',m1_plan_path(self.root),self.root/'m1/preview/materials-overlay.png'))
            initial_plan=read(m1_plan_path(self.root))
            policy=planning_policy(self.root)
            needs=bool(self.review_split(read(self.root/'m2/draft.json'),initial_plan)[0] or self.reviewed_relations(initial_plan,self.root/'m2') or initial_plan['unknowns'])
            if needs:
                self.node('repair',self.repair)
                self.node('repair_check',lambda:self.repair_check(allow_program_issues=True))
                self.node('rereview',lambda:self.review('rereview',self.root/'repair/candidate.json',self.root/'repair/preview/materials-overlay.png'))
                if (self.review_split(read(self.root/'rereview/draft.json'),read(self.root/'repair/candidate.json'))[0] or
                        self.reviewed_relations(read(self.root/'repair/candidate.json'),self.root/'rereview')):
                    self.node('repair2',lambda:self.repair(self.root/'repair/candidate.json',self.root/'rereview','repair2'))
                    self.node('repair_check2',lambda:self.repair_check(self.root/'repair/candidate.json','repair2'))
                    self.node('rereview2',lambda:self.review('rereview2',self.root/'repair2/candidate.json',self.root/'repair2/preview/materials-overlay.png'))
            self.node('freeze',lambda:freeze(self.root,self.root/'frozen',self.config['maxCalls'],
                self.config.get('generationMode','single'),self.config.get('generationReference','full'),
                self.config.get('contextPromptVersion',LEGACY_CONTEXT_PROMPT_VERSION)))
            return self.status()

    def status(self):
        self.verify();nodes={}
        for name in GRAPH:
            state=self.root/'.dag'/name
            nodes[name]=('completed' if (state/'done.json').exists() else 'failed' if (state/'failed.json').exists()
                         else 'interrupted_or_running' if state.exists() else 'pending')
        completed=nodes['freeze']=='completed'
        if completed and nodes['repair']=='pending':
            for name in ('repair','repair_check','rereview'):nodes[name]='skipped'
        if completed and nodes['repair2']=='pending':
            for name in ('repair2','repair_check2','rereview2'):nodes[name]='skipped'
        records=[read(p) for p in (self.root/'.dag').glob('*/done.json')]
        model_times={name:read(self.root/name/'transport.json')['elapsedSeconds']
                     for name in ('m1','m2','repair','rereview','repair2','rereview2') if (self.root/name/'transport.json').exists()}
        model_failures={name:details for name in model_times
                        if (details:=transport_failure_details(read(self.root/name/'transport.json')))}
        result={'kind':'ui_planning_dag_status_v1','status':'frozen' if completed else 'incomplete','nodes':nodes,
                'failures':{p.parent.name:read(p)['error'] for p in (self.root/'.dag').glob('*/failed.json')},
                'nodeSeconds':{r['node']:r['seconds'] for r in records},'mediaGenerationCalls':0,
                'modelCallSeconds':model_times,
                'programNodeSeconds':{r['node']:r['seconds'] for r in records if r['node'] in ('check','repair_check','freeze')},
                'driver':read(self.root/'.dag/execution.json')['driver'] if (self.root/'.dag/execution.json').exists() else 'not-started',
                'humanVisualAcceptance':False,'automaticRetries':0,'runtimeAndInputsVerified':True,
                'interventionTracking':'Pinned inputs/code and checkpoint integrity; external use of the model session is not independently audited.'}
        if self.config.get('generationReference','full')=='context-crops':
            result['contextPromptVersion']=self.config.get('contextPromptVersion',LEGACY_CONTEXT_PROMPT_VERSION)
        policy=planning_policy(self.root)
        sources={'m2':'m1/normalized-plan.json' if self.config.get('normalizationPolicy') else 'm1/draft.json','rereview':'repair/candidate.json',
                 'rereview2':'repair2/candidate.json'}
        if policy is None:
            result['reviewWarnings']={}
            for name,path in sources.items():
                if not (self.root/name/'draft.json').exists():continue
                review=read(self.root/name/'draft.json')
                itemized=('planEvidenceCatalogDigest' in review or
                          any(isinstance(row.get('observedArtwork'),list) for row in review.get('coverageAudit',[])))
                result['reviewWarnings'][name]=split(review,read(self.root/path) if itemized else None,coverage_text_policy=self.config.get('coverageTextPolicy'),visual_textures=textures.planning_input(self.root))[1]
        else:
            result['reviewWarnings']={name:split(read(self.root/name/'draft.json'),
                                      read(self.root/sources[name]),policy,self.config.get('coverageTextPolicy'),textures.planning_input(self.root))[1]
                for name in sources if (self.root/name/'draft.json').exists()}
        if model_failures:result['modelCallFailures']=model_failures
        if completed:result['snapshotDigest']=inspect(self.root/'frozen')['digest']
        return result


def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('action',choices=['run','resume','status'])
    p.add_argument('--output',required=True);p.add_argument('--image');p.add_argument('--max-calls',type=int,default=128)
    p.add_argument('--generation-mode',choices=['single','sheets'],default=DEFAULT_GENERATION_MODE)
    p.add_argument('--generation-reference',choices=['full','context-crops'],default=DEFAULT_GENERATION_REFERENCE)
    p.add_argument('--context-prompt-version',choices=CONTEXT_PROMPT_VERSIONS,
                   help='New context-crops run: default v7; explicit versions are frozen in the run config')
    p.add_argument('--visual-policy',help='New-run explicit visual evidence policy JSON')
    p.add_argument('--visual-textures',help='New-run source-bound visual texture preservation regions JSON')
    p.add_argument('--planning-model')
    p.add_argument('--planning-effort')
    p.add_argument('--planning-timeout',type=int)
    a=p.parse_args()
    if any(value is not None for value in (a.planning_model,a.planning_effort,a.planning_timeout)) and a.action!='run':
        p.error('planning model settings are only accepted for a new run')
    if a.visual_policy is not None and a.action!='run':
        p.error('--visual-policy is only accepted for a new run')
    if a.visual_textures is not None and a.action!='run':
        p.error('--visual-textures is only accepted for a new run')
    if a.context_prompt_version is not None and a.action!='run':
        p.error('--context-prompt-version is only accepted for a new run')
    if a.action=='run':
        if not a.image:p.error('--image is required for run')
        init(a.image,a.output,a.max_calls,a.generation_mode,
             generation_reference=a.generation_reference,visual_policy=a.visual_policy,
             context_prompt_version=a.context_prompt_version,
             planning_model=a.planning_model if a.planning_model is not None else CLI_MODEL,
             planning_effort=a.planning_effort if a.planning_effort is not None else CLI_EFFORT,
             planning_timeout=a.planning_timeout if a.planning_timeout is not None else 900,
             visual_textures=a.visual_textures)
    dag=Dag(a.output)
    try:result=dag.status() if a.action=='status' else dag.execute()
    except Exception as exc:
        result={'status':'stopped','reason':str(exc),'automaticRetry':False}
        if isinstance(exc,TransportFailure):result['failureDetails']=exc.details
        print(json.dumps(result,ensure_ascii=False));raise SystemExit(1)
    print(json.dumps(result,ensure_ascii=False,indent=2))


if __name__=='__main__':main()
