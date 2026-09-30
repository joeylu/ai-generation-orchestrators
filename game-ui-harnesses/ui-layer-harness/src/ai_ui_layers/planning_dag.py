"""Local reference-to-frozen-plan DAG. No image generation, services, or implicit retries."""
import argparse
from contextlib import contextmanager
import json
import os
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
from .planning_review_policy import split, signatures, REGIONS, DESCRIPTION_STATUSES, audit_rows
from .coverage_review import coverage_schema
from .session_review import invoke, resume_command, session_id, build_review_prompt, render_for_review, TransportFailure
from .visual_policy import load_input, planning_policy, planning_guidance, INPUT_NAME

BASE=HARNESS/'planning-harness'
REPO=Path(__file__).resolve().parents[4]
DEFAULT_GENERATION_MODE='sheets'
DEFAULT_GENERATION_REFERENCE='context-crops'
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
                   '仅文字撑大的可避免边界仍须收紧；去字效果与完整轮廓仍须生成后审查或验收。\n')

COVERAGE_GUIDANCE=('coverageAudit 按九区逐项清点：observedArtwork 是图形条目数组，先看干净原图再对照计划，'
    '重复实例及文字旁图形分别列项，不只遍历已有 ID。空区填 [] 和非空 emptyRegionEvidence；非空区该字段填 null。'
    'covered 须有真实 materialId、可选同属 objectId，planEvidenceQuote 逐字引自指定对象 label，'
    '未指定对象则引所属素材 label；引文须确实描述本项结构，泛称面板或 bbox 包含不能证明覆盖。'
    '缺失用 missing、不明用 uncertain，suggestedChange 非空；未知归属填 null，不编 ID。'
    'business-text 须绑定无保留字许可的素材，artwork 写原图完整文字实例的逐字内容；保留字/图形符号另项核对；'
    'optional-shadow 只在显式允许时用于所属孤立柔影，描边/高光/实体不能排除。'
    '每项 evidence 给原图位置及依据；covered 引文非空，其余引文填 null，非问题建议填 null。'
    '不输出旧 missingFromPlan；程序逐项派生阻断，复审仍清点全图。')


def itemized_coverage_prompt(prompt):
    lines=prompt.splitlines(keepends=True)
    matches=[index for index,line in enumerate(lines) if line.startswith('coverageAudit 按')]
    if len(matches)>1:raise ValueError('DUPLICATE_COVERAGE_GUIDANCE')
    if matches:
        lines[matches[0]]=COVERAGE_GUIDANCE+'\n'
        return ''.join(lines)
    return COVERAGE_GUIDANCE+'\n'+prompt


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
        source=root/('m1/draft.json' if name=='rereview' else 'repair/candidate.json')
    # Derive against the plan actually reviewed, never the repaired candidate.
    blockers,warnings=split(read(review),read(source),planning_policy(root))
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


def init(image, root, max_calls=128, generation_mode=DEFAULT_GENERATION_MODE, planning_notes=None, generation_reference=DEFAULT_GENERATION_REFERENCE, visual_policy=None):
    from .context_references import validate_mode
    validate_mode(generation_reference)
    policy_bytes=load_input(visual_policy)
    if policy_bytes is not None:
        policy=json.loads(policy_bytes.decode('utf-8-sig'))
        if policy['appearanceEvidence']=='bound-reference' and generation_reference!='context-crops':
            raise ValueError('BOUND_REFERENCE_CONTEXT_CROPS_REQUIRED')
    notes=read_notes(planning_notes)
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
    save(root/'.dag/config.json',{'kind':'ui_planning_dag_v1','runtime':runtime_files(),
         'inputs':{p.name:digest(p) for p in inputs.iterdir()},'maxCalls':max_calls,'generationMode':generation_mode,'generationReference':generation_reference,
         'model':CLI_MODEL,'effort':CLI_EFFORT,'graph':GRAPH,'maximumRepairs':2,'mediaGenerationCalls':0})
    save(root/'.dag/config-digest.json',{'sha256':digest(root/'.dag/config.json')})
    return root


def live_model(folder, sid, first):
    with tempfile.TemporaryDirectory(prefix='ui-planning-dag-') as cwd:
        if first:
            args=command(shutil.which('codex'),folder,Path(cwd),CLI_MODEL,CLI_EFFORT);args.remove('--ephemeral')
        else:args=resume_command(shutil.which('codex'),folder,Path(cwd),sid)
        return invoke(args,folder,cwd,(folder/'prompt.md').read_text(encoding='utf-8'))


class Dag:
    def __init__(self, root, model=live_model):
        self.root=Path(root).resolve();self.model=model;self.config=read(self.root/'.dag/config.json')
        self.inputs=self.root/'.dag/inputs'

    def verify(self):
        if digest(self.root/'.dag/config.json')!=read(self.root/'.dag/config-digest.json')['sha256']:
            raise ValueError('CONFIG_CHANGED')
        if self.config['runtime']!=runtime_files():raise ValueError('RUNTIME_CHANGED_NEW_RUN_REQUIRED')
        for name,value in self.config['inputs'].items():
            if digest(self.inputs/name)!=value:raise ValueError('INPUT_CHANGED')
        planning_policy(self.root)
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
        if 'planning-notes.txt' not in self.config['inputs']:return ''
        return ('\n用户确认的拆分要求（这是目标约束，不是模型观察结论；不代替几何、归属和质量检查）：\n'
                +(self.inputs/'planning-notes.txt').read_text(encoding='utf-8-sig')+'\n')

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
        save(p/'schema.json',transport_schema(read(self.inputs/'storage-schema.json')))
        request={'inputs':{n:digest(p/n) for n in ('reference.png','prompt.md','schema.json')},
                 'model':self.config['model'],'effort':self.config['effort'],'mediaGenerationCalls':0,
                 'maximumRepairs':self.config.get('maximumRepairs',1)}
        if policy is not None:request['visualPolicySha256']=self.config['inputs'][INPUT_NAME]
        save(self.root/'request.json',request)
        self.call(p,True)
        Draft202012Validator(read(self.inputs/'storage-schema.json')).validate(read(p/'draft.json'))

    def check(self):
        p=self.root/'m1';plan=read(p/'draft.json')
        save(p/'program-check.json',{'issues':check_relations(plan)})
        render_for_review(p/'reference.png',plan,p/'preview')

    def review(self,name,plan_path,overlay):
        p=self.folder(name);sid=read(self.root/'session.json')['sessionId'];plan=read(plan_path)
        policy=planning_policy(self.root)
        (p/'review-overlay.png').write_bytes(overlay.read_bytes())
        (p/'review-source.md').write_bytes((self.inputs/'visual-review.md').read_bytes())
        focus=make_focus(self.root/'m1/reference.png',p/'review-overlay.png',plan,p)
        small_focus=make_small_material_focus(self.root/'m1/reference.png',plan,p)
        sequence_focus=make_sequence_focus(self.root/'m1/reference.png',plan,p)
        issue_schema={'type':'object','additionalProperties':False,
            'required':['code','category','ids','description','suggestedChange'],
            'properties':{'code':{'type':'string'},'category':{'type':'string','enum':['semantic','geometry','cosmetic']},
                          'ids':{'type':'array','items':{'type':'string'}},'description':{'type':'string'},
                          'suggestedChange':{'type':'string'}}}
        required=['issues','coverageAudit']
        properties={'issues':{'type':'array','items':issue_schema},
                    'coverageAudit':{'type':'array','minItems':len(REGIONS),
                                     'maxItems':len(REGIONS),'items':coverage_schema()}}
        definitions={}
        if small_focus:
            part_schema={'type':'object','additionalProperties':False,
                'required':['visiblePart','observedAppearance','planEvidenceQuote','descriptionStatus','suggestedChange'],
                'properties':{'visiblePart':{'type':'string','minLength':1},
                              'observedAppearance':{'type':'string','minLength':1},
                              'planEvidenceQuote':{'type':'string'},
                              'descriptionStatus':{'type':'string','enum':list(DESCRIPTION_STATUSES)},
                              'suggestedChange':{'type':'string','minLength':1}}}
            if policy is not None:
                if policy['appearanceEvidence']=='bound-reference':
                    part_schema['properties']['descriptionStatus']['enum'].append('reference-bound')
                part_schema['properties']['deferredAppearance']={'type':['string','null']}
                part_schema['required'].append('deferredAppearance')
            material_schema={'type':'object','additionalProperties':False,
                'required':['parts','boundary'],
                'properties':{'boundary':{'type':'object','additionalProperties':False,
                        'required':['status','evidence'],'properties':{
                            'status':{'type':'string','enum':['complete','clipped','uncertain']},
                            'evidence':{'type':'string','minLength':1}}},
                    'parts':{'type':'array','minItems':1,'items':part_schema}}}
            required.append('smallMaterialAudit')
            definitions['smallMaterialAuditEntry']=material_schema
            properties['smallMaterialAudit']={'type':'object','additionalProperties':False,
                'required':[row['materialId'] for row in small_focus['items']],
                'properties':{row['materialId']:{'$ref':'#/$defs/smallMaterialAuditEntry'}
                              for row in small_focus['items']}}
            if small_focus['boundaryOnlyItems']:
                required.append('smallBoundaryAudit')
                definitions['smallBoundaryAuditEntry']={'type':'object','additionalProperties':False,
                    'required':['boundary'],
                    'properties':{'boundary':material_schema['properties']['boundary']}}
                properties['smallBoundaryAudit']={'type':'object','additionalProperties':False,
                    'required':[row['materialId'] for row in small_focus['boundaryOnlyItems']],
                    'properties':{row['materialId']:{'$ref':'#/$defs/smallBoundaryAuditEntry'}
                                  for row in small_focus['boundaryOnlyItems']}}
        schema={'type':'object','additionalProperties':False,'required':required,
                'properties':properties}
        if definitions:schema['$defs']=definitions
        if policy is not None:schema=transport_schema(schema)
        save(p/'schema.json',schema)
        prompt=BOX_TEXT_GUIDANCE+itemized_coverage_prompt(build_review_prompt(
            (p/'review-source.md').read_text(encoding='utf-8'),check_relations(plan)))
        if name.startswith('rereview'):
            findings=prior_findings(self.root,name)
            save(p/'prior-findings.json',findings)
            prompt+=rereview_context(plan,findings)
        if small_focus:
            prompt=('小素材附件：左为无标记原图上下文，右为裁片按原偏移放在相同坐标、相同比例的中性诊断视窗上。'
                    '中性区不是原图或 alpha；裁框为半开区间，右/下界不包含。诊断标签、边距不属于原图，上下文不改变归属。'
                    'smallMaterialAudit 按第一页 materialId 逐项填写。'
                    'boundary.status 判断候选框是否额外丢失原图可见自有轮廓：complete=全保留，clipped=漏可见部分，uncertain=无法确认；evidence 分清原图边缘与裁片边缘，不推测画外内容。'
                    '只按原图逐一列每个可辨部件，包括附属道具、部分遮挡和名称不确定的部分；'
                    'observedAppearance 写形状、颜色、浅色高光、暗色细点、表面印记或“无可辨印记”，不遗漏局部明暗点纹。'
                    'planEvidenceQuote 逐字引自所属素材或对象 label，只证明出处；descriptionStatus 判断观察与描述是否一致：'
                    'consistent=数量、形状、连接/间隙及显著外观一致，等价措辞允许；missing=缺少，conflicting=矛盾，uncertain=无法确认。'
                    '整体名、类别术语或部分颜色不能替代结构、色点、高光和印记；不要用自己的观察替模糊引文补足描述。'
                    '缺少描述填空引文；非 consistent 给局部 suggestedChange，consistent 填“无需修改”。'
                    '空/非原文引文或非 consistent 均阻断；不要把结构疑问降级为措辞告警。'+prompt)
            if small_focus['boundaryOnlyItems']:
                prompt=('后续页的 smallBoundaryAudit 按 materialId 逐项只做同一轮廓截断检查；'
                        'clipped/uncertain 须给原图依据。'+prompt)
            if small_focus.get('detail'):
                detail=small_focus['detail']
                prompt=('另附 '+detail['materialId']+' 的无标记原图上下文放大，原图像素范围 '+str(detail['sourceBox'])+
                        '，候选框 '+str(detail['candidateBox'])+'；核对框内外完整自有轮廓及明暗点纹。'+prompt)
        if focus:
            save(p/'focus-meta.json',focus)
            prompt=('先核对下列局部证据：近边固定装饰的完整轮廓，或重复对齐卡片各自闭合边框的真实四边与归属。局部附件左半是干净原图、右半是同坐标标框叠图；若有同行高度候选边，它们只是寻找轮廓的搜索点，不是自动改框坐标。区分卡片自身闭合边框与相邻容器的分隔线，只按可见连接判断；对齐比较本身不是缺陷，也不要因其他小告警跳过这一检查：'+json.dumps(focus,ensure_ascii=False)+'\n'+prompt)
        if policy is not None and policy['appearanceEvidence']=='bound-reference':
            prompt=prompt.replace('空/非原文引文或非 consistent 均阻断；不要把结构疑问降级为措辞告警。',
                                  '空/非原文引文或 missing/conflicting/uncertain 均阻断；合格 reference-bound 只记录警告，结构疑问不得降级。')
            prompt=prompt.replace('整体名、类别术语或部分颜色不能替代结构、色点、高光和印记；不要用自己的观察替模糊引文补足描述。',
                                  '整体名、类别术语或部分颜色不能替代结构、身份、状态、连接及显著高光、渐变和印记；仅细微表面可明确交给绑定原图，不用观察替模糊引文补足结构。')
        if policy is not None:
            prompt+=planning_guidance(policy)
            prompt+='smallMaterialAudit 每个 part 必填 deferredAppearance；只有 reference-bound 填非空字符串，其余状态填 null。\n'
            if policy['appearanceEvidence']=='bound-reference':
                prompt+=('reference-bound 仅用于所属逐字引文已证明结构、身份、数量、状态及连接关系，'
                         '剩余细微表面由本次绑定原图承接；填写非空 deferredAppearance 说明具体延期表面。'
                         '缺失/矛盾/不确定仍填对应状态，不借此跳过轮廓、归属或引文。\n')
        (p/'prompt.md').write_text(prompt+self.user_context(),encoding='utf-8')
        names=['schema.json','review-source.md','review-overlay.png','prompt.md']
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
        save(p/'request.json',bound);receipt=self.call(p)
        answer=read(p/'draft.json');known={o['id'] for k in ('materials','objects') for o in plan[k]}
        if small_focus and ({row['materialId'] for row in audit_rows(answer,'smallMaterialAudit')} !=
                            {row['materialId'] for row in small_focus['items']}):
            raise ValueError('SMALL_MATERIAL_AUDIT_IDS_REQUIRED')
        if small_focus and small_focus['boundaryOnlyItems'] and (
                {row['materialId'] for row in audit_rows(answer,'smallBoundaryAudit')} !=
                {row['materialId'] for row in small_focus['boundaryOnlyItems']}):
            raise ValueError('SMALL_BOUNDARY_AUDIT_IDS_REQUIRED')
        blockers,warnings=split(answer,plan,policy)
        if any(set(i['ids'])-known for i in blockers+warnings):raise ValueError('UNKNOWN_REVIEW_IDS')
        save(p/'assessment.json',dict(blockers=blockers,warnings=warnings,reviewSha256=digest(p/'draft.json')))
        if name=='m2':
            first=read(self.root/'m1/transport.json')
            save(self.root/'result.json',{'sameSessionVerified':True,'sessionId':sid,'unknownIssueIds':[],
                 'sourcePlanSha256':digest(plan_path),'reviewSha256':digest(p/'draft.json'),
                 'm1Seconds':first['elapsedSeconds'],'m2Seconds':receipt['elapsedSeconds'],
                 'm3Executed':False,'productionReady':False,'humanVisualAcceptance':False})
        else:
            save(p/'result.json',{'sameSessionVerified':True,'sessionId':sid,'reviewSha256':digest(p/'draft.json'),
                 'seconds':receipt['elapsedSeconds'],'issueCount':len(answer['issues']),'automaticRetry':False})
            if blockers:
                repeated=signatures(blockers)&signatures(findings['blockers'])
                if name=='rereview2' or repeated or (self.root/'revision.json').exists() or self.config.get('maximumRepairs',1)<2:
                    raise ValueError('REREVIEW_UNRESOLVED')

    def repair(self, source=None, review_dir=None, name='repair'):
        p=self.folder(name);source=source or self.root/'m1/draft.json';source_sha=digest(source)
        review_dir=review_dir or self.root/'m2'
        policy=planning_policy(self.root)
        plan=read(source);issues=dict(issues=split(read(review_dir/'draft.json'),plan,policy)[0])
        program_issues=check_relations(plan)
        ids={key for issue in issues['issues'] for key in issue['ids']}
        ids.update(key for issue in program_issues for key in issue.get('materialIds',[]))
        ids.update(issue['id'] for issue in program_issues if 'id' in issue)
        owners=ids | {o['materialId'] for o in plan['objects'] if o['id'] in ids}
        context=dict(materials=[m for m in plan['materials'] if m['id'] in owners],
                     objects=[o for o in plan['objects'] if o['materialId'] in owners])
        save(p/'source-context.json',context)
        save(p/'schema.json',transport_schema(patch_schema(read(self.root/'m1/schema.json'),source_sha)))
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
        if focus:prompt+='\n上一轮边界局部证据继续随附件提供：'+json.dumps(focus,ensure_ascii=False)
        if small_focus:
            prompt+='\n上一轮小素材原图放大证据继续随附件提供。'
            if detail:prompt+=' 无标记原图上下文放大对应 '+detail['materialId']+'，邻近像素不改变归属。'
        (p/'prompt.md').write_text(prompt+planning_guidance(policy)+self.user_context(),encoding='utf-8')
        names=['schema.json','prompt.md','review-overlay.png','source-context.json',*sequence_files]
        if focus:names+=['focus-meta.json']+[row['file'] for row in focus]
        if small_focus:names+=['coverage-small-materials.json',*small_files]
        if small_focus and detail:names.append(detail['file'])
        request={'sessionId':read(self.root/'session.json')['sessionId'],'sourcePlanSha256':source_sha,
             'originalImageResent':True,'originalReferenceSha256':digest(self.root/'m1/reference.png'),
             'reviewSha256':digest(review_dir/'draft.json'),'inputs':{n:digest(p/n) for n in names}}
        if policy is not None:request['visualPolicySha256']=self.config['inputs'][INPUT_NAME]
        save(p/'request.json',request)
        self.call(p)

    def repair_check(self, source=None, name='repair', allow_program_issues=False):
        p=self.root/name;source=source or self.root/'m1/draft.json'
        plan,report=merge_patch(source,read(p/'draft.json'),read(self.root/'m1/schema.json'),digest(source))
        report['remainingUnknowns']=plan['unknowns']
        save(p/'candidate.json',plan);save(p/'report.json',report)
        if (report['unresolvedIssues'] or plan['unknowns'] or
                (report['programIssues'] and not allow_program_issues)):
            raise ValueError('REPAIR_UNRESOLVED')
        render_for_review(self.root/'m1/reference.png',plan,p/'preview')

    def execute(self):
        with locked(self.root):
            if not (self.root/'.dag/execution.json').exists():
                save(self.root/'.dag/execution.json',{'driver':'codex-cli' if self.model is live_model else 'injected-test-double'})
            self.node('m1',self.m1);self.node('check',self.check)
            self.node('m2',lambda:self.review('m2',self.root/'m1/draft.json',self.root/'m1/preview/materials-overlay.png'))
            initial_plan=read(self.root/'m1/draft.json')
            policy=planning_policy(self.root)
            needs=bool(split(read(self.root/'m2/draft.json'),initial_plan,policy)[0] or read(self.root/'m1/program-check.json')['issues'] or initial_plan['unknowns'])
            if needs:
                self.node('repair',self.repair)
                self.node('repair_check',lambda:self.repair_check(allow_program_issues=True))
                self.node('rereview',lambda:self.review('rereview',self.root/'repair/candidate.json',self.root/'repair/preview/materials-overlay.png'))
                if (split(read(self.root/'rereview/draft.json'),read(self.root/'repair/candidate.json'),policy)[0] or
                        read(self.root/'repair/report.json')['programIssues']):
                    self.node('repair2',lambda:self.repair(self.root/'repair/candidate.json',self.root/'rereview','repair2'))
                    self.node('repair_check2',lambda:self.repair_check(self.root/'repair/candidate.json','repair2'))
                    self.node('rereview2',lambda:self.review('rereview2',self.root/'repair2/candidate.json',self.root/'repair2/preview/materials-overlay.png'))
            self.node('freeze',lambda:freeze(self.root,self.root/'frozen',self.config['maxCalls'],self.config.get('generationMode','single'),self.config.get('generationReference','full')))
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
        policy=planning_policy(self.root)
        sources={'m2':'m1/draft.json','rereview':'repair/candidate.json',
                 'rereview2':'repair2/candidate.json'}
        if policy is None:
            result['reviewWarnings']={}
            for name,path in sources.items():
                if not (self.root/name/'draft.json').exists():continue
                review=read(self.root/name/'draft.json')
                itemized=any(isinstance(row.get('observedArtwork'),list) for row in review.get('coverageAudit',[]))
                result['reviewWarnings'][name]=split(review,read(self.root/path) if itemized else None)[1]
        else:
            result['reviewWarnings']={name:split(read(self.root/name/'draft.json'),
                                      read(self.root/sources[name]),policy)[1]
                for name in sources if (self.root/name/'draft.json').exists()}
        if model_failures:result['modelCallFailures']=model_failures
        if completed:result['snapshotDigest']=inspect(self.root/'frozen')['digest']
        return result


def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('action',choices=['run','resume','status'])
    p.add_argument('--output',required=True);p.add_argument('--image');p.add_argument('--max-calls',type=int,default=128)
    p.add_argument('--generation-mode',choices=['single','sheets'],default=DEFAULT_GENERATION_MODE)
    p.add_argument('--generation-reference',choices=['full','context-crops'],default=DEFAULT_GENERATION_REFERENCE)
    p.add_argument('--visual-policy',help='New-run explicit visual evidence policy JSON')
    a=p.parse_args()
    if a.visual_policy is not None and a.action!='run':
        p.error('--visual-policy is only accepted for a new run')
    if a.action=='run':
        if not a.image:p.error('--image is required for run')
        init(a.image,a.output,a.max_calls,a.generation_mode,
             generation_reference=a.generation_reference,visual_policy=a.visual_policy)
    dag=Dag(a.output)
    try:result=dag.status() if a.action=='status' else dag.execute()
    except Exception as exc:
        result={'status':'stopped','reason':str(exc),'automaticRetry':False}
        if isinstance(exc,TransportFailure):result['failureDetails']=exc.details
        print(json.dumps(result,ensure_ascii=False));raise SystemExit(1)
    print(json.dumps(result,ensure_ascii=False,indent=2))


if __name__=='__main__':main()
