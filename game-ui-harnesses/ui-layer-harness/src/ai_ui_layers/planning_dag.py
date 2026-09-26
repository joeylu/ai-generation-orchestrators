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
from .codex_call import command, transport_schema, CLI_MODEL, CLI_EFFORT
from .compile_visual import HARNESS
from .evaluate import read, save, digest, check_relations
from .freeze_visual import freeze, inspect
from .local_patch import patch_schema, merge_patch
from .review_focus import make_focus, make_small_material_focus
from .planning_review_policy import split, signatures, REGIONS
from .session_review import invoke, resume_command, session_id, build_review_prompt, render_for_review

BASE=HARNESS/'planning-harness'
REPO=Path(__file__).resolve().parents[4]
GRAPH={'m1':[], 'check':['m1'], 'm2':['check'], 'repair':['m2'],
       'repair_check':['repair'], 'rereview':['repair_check'],
       'repair2':['rereview'], 'repair_check2':['repair2'], 'rereview2':['repair_check2'],
       'freeze':['m2','rereview','rereview2']}


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


def init(image, root, max_calls=128, generation_mode="single", planning_notes=None):
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
    save(root/'.dag/config.json',{'kind':'ui_planning_dag_v1','runtime':runtime_files(),
         'inputs':{p.name:digest(p) for p in inputs.iterdir()},'maxCalls':max_calls,'generationMode':generation_mode,
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
            save(state/'failed.json',{'node':name,'seconds':time.perf_counter()-start,
                 'error':type(exc).__name__+': '+str(exc),'automaticRetry':False})
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
        for name,source in [('reference.png','reference.png'),('prompt.md','visual-plan.md')]:
            (p/name).write_bytes((self.inputs/source).read_bytes())
        with Image.open(p/'reference.png') as reference:
            width,height=reference.size
        context=(f'参考图原始画布：width={width}, height={height} 像素。'
                 'bboxNorm 的 x 除以完整画布宽、y 除以完整画布高；'
                 '不要使用界面显示尺寸、假定方形画布或附加留白作为分母。'
                 '全画布背景框不证明其他可见图形已被覆盖；有明确边界的界面覆盖区按视觉单元判断素材归属，'
                 '不能用背景全框代替覆盖检查。短标签放不下的可见细节分给多个对象，描述须完整。\n\n')
        (p/'prompt.md').write_text(context+(p/'prompt.md').read_text(encoding='utf-8-sig')+self.user_context(),encoding='utf-8')
        save(p/'schema.json',transport_schema(read(self.inputs/'storage-schema.json')))
        save(self.root/'request.json',{'inputs':{n:digest(p/n) for n in ('reference.png','prompt.md','schema.json')},
             'model':self.config['model'],'effort':self.config['effort'],'mediaGenerationCalls':0,'maximumRepairs':self.config.get('maximumRepairs',1)})
        self.call(p,True)
        Draft202012Validator(read(self.inputs/'storage-schema.json')).validate(read(p/'draft.json'))

    def check(self):
        p=self.root/'m1';plan=read(p/'draft.json')
        save(p/'program-check.json',{'issues':check_relations(plan)})
        render_for_review(p/'reference.png',plan,p/'preview')

    def review(self,name,plan_path,overlay):
        p=self.folder(name);sid=read(self.root/'session.json')['sessionId'];plan=read(plan_path)
        (p/'review-overlay.png').write_bytes(overlay.read_bytes())
        (p/'review-source.md').write_bytes((self.inputs/'visual-review.md').read_bytes())
        focus=make_focus(self.root/'m1/reference.png',p/'review-overlay.png',plan,p)
        small_focus=make_small_material_focus(self.root/'m1/reference.png',plan,p)
        issue_schema={'type':'object','additionalProperties':False,
            'required':['code','category','ids','description','suggestedChange'],
            'properties':{'code':{'type':'string'},'category':{'type':'string','enum':['semantic','geometry','cosmetic']},
                          'ids':{'type':'array','items':{'type':'string'}},'description':{'type':'string'},
                          'suggestedChange':{'type':'string'}}}
        missing_schema={'type':'object','additionalProperties':False,
            'required':['artwork','suggestedOwnerId','suggestedChange'],
            'properties':{'artwork':{'type':'string','minLength':1},
                          'suggestedOwnerId':{'type':'string','minLength':1},
                          'suggestedChange':{'type':'string','minLength':1}}}
        coverage_schema={'type':'object','additionalProperties':False,
            'required':['region','observedArtwork','missingFromPlan'],
            'properties':{'region':{'type':'string','enum':list(REGIONS)},
                          'observedArtwork':{'type':'string','minLength':1},
                          'missingFromPlan':{'type':'array','items':missing_schema}}}
        required=['issues','coverageAudit']
        properties={'issues':{'type':'array','items':issue_schema},
                    'coverageAudit':{'type':'array','minItems':len(REGIONS),
                                     'maxItems':len(REGIONS),'items':coverage_schema}}
        if small_focus:
            part_schema={'type':'object','additionalProperties':False,
                'required':['visiblePart','observedAppearance','planEvidenceQuote','suggestedChange'],
                'properties':{'visiblePart':{'type':'string','minLength':1},
                              'observedAppearance':{'type':'string','minLength':1},
                              'planEvidenceQuote':{'type':'string'},
                              'suggestedChange':{'type':'string','minLength':1}}}
            material_schema={'type':'object','additionalProperties':False,
                'required':['materialId','parts','boundary'],
                'properties':{'materialId':{'type':'string','enum':[
                    row['materialId'] for row in small_focus['items']]},
                    'boundary':{'type':'object','additionalProperties':False,
                        'required':['status','evidence'],'properties':{
                            'status':{'type':'string','enum':['complete','clipped','uncertain']},
                            'evidence':{'type':'string','minLength':1}}},
                    'parts':{'type':'array','minItems':1,'items':part_schema}}}
            required.append('smallMaterialAudit')
            properties['smallMaterialAudit']={'type':'array',
                'minItems':len(small_focus['items']),'maxItems':len(small_focus['items']),
                'items':material_schema}
        schema={'type':'object','additionalProperties':False,'required':required,
                'properties':properties}
        save(p/'schema.json',schema)
        prompt=build_review_prompt((p/'review-source.md').read_text(encoding='utf-8'),check_relations(plan))
        if name.startswith('rereview'):
            prior=self.root/('parent-review' if (self.root/'revision.json').exists() else 'm2' if name=='rereview' else 'rereview')/'draft.json'
            prompt+='\n先核销上轮问题；仍检查完整候选。新增阻断必须给原图证据，不能只换措辞重复问题。上轮问题：'+json.dumps(read(prior),ensure_ascii=False)
            prompt+='\n检查修补后的完整候选，本次仅复审：\n'+json.dumps(plan,ensure_ascii=False)
        if small_focus:
            prompt=('小素材附件每项左侧为原图上下文（粉框标候选裁片），右侧为无标记裁片；两侧独立等比放大。'
                    '先核对完整自有轮廓是否被框截断，boundary.status 填 complete/clipped/uncertain，evidence 说明原图依据；裁片外像素不自动属于此素材。'
                    '按附件的每个 materialId 填 smallMaterialAudit，'
                    '先只按原图逐一列出图标内每个可辨认的组成部分，并在 observedAppearance 写清外形、颜色、'
                    '表面印记或“无可辨印记”；小型附属道具和被部分遮挡的部分也要列出，不能因物体名称不确定而省略彩色点纹。'
                    '每个 visiblePart 的 planEvidenceQuote 必须逐字摘自该素材或其对象的现有 label，'
                    '且确实描述同一图形；没有对应描述就填空字符串，并给出局部 suggestedChange，'
                    '已覆盖的部件 suggestedChange 填“无需修改”；'
                    '程序会将空引文或不存在的引文转为修补阻断。不能用整体名称冒充内部部件的证据。'
                    '框内场景或底板仍按原归属，不自动算作图标内容；不要把诊断标签或暗色边距当作原图内容。'+prompt)
            if small_focus.get('detail'):
                prompt=('另附 '+small_focus['detail']['materialId']+' 的原图彩色局部放大，'
                        '先检查各部件内部的色点和印记；它只提供更多观察像素，不改变归属。'+prompt)
        if focus:
            save(p/'focus-meta.json',focus)
            prompt=('先核对下列局部证据：近边固定装饰的完整轮廓，或重复对齐卡片各自闭合边框的真实四边与归属。局部附件左半是干净原图、右半是同坐标标框叠图；若有同行高度候选边，它们只是寻找轮廓的搜索点，不是自动改框坐标。区分卡片自身闭合边框与相邻容器的分隔线，只按可见连接判断；对齐比较本身不是缺陷，也不要因其他小告警跳过这一检查：'+json.dumps(focus,ensure_ascii=False)+'\n'+prompt)
        (p/'prompt.md').write_text(prompt+self.user_context(),encoding='utf-8')
        names=['schema.json','review-source.md','review-overlay.png','prompt.md']
        if focus:names+=['focus-meta.json']+[row['file'] for row in focus]
        if small_focus:names+=['coverage-small-materials.json',small_focus['file']]
        if small_focus and small_focus.get('detail'):names.append(small_focus['detail']['file'])
        bound={'sessionId':sid,'originalImageResent':True,
               'originalReferenceSha256':digest(self.root/'m1/reference.png'),
               'inputs':{n:digest(p/n) for n in names}}
        if name=='m2':bound['sourcePlanSha256']=digest(plan_path)
        else:bound.update(candidateSha256=digest(plan_path),patchSha256=digest(plan_path.parent/'draft.json'))
        save(p/'request.json',bound);receipt=self.call(p)
        answer=read(p/'draft.json');known={o['id'] for k in ('materials','objects') for o in plan[k]}
        if small_focus and ({row['materialId'] for row in answer['smallMaterialAudit']} !=
                            {row['materialId'] for row in small_focus['items']}):
            raise ValueError('SMALL_MATERIAL_AUDIT_IDS_REQUIRED')
        blockers,warnings=split(answer,plan)
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
                previous=self.root/('parent-review' if (self.root/'revision.json').exists() else 'm2' if name=='rereview' else 'rereview')/'draft.json'
                previous_plan=(self.root/'source-plan.json' if (self.root/'revision.json').exists()
                               else self.root/('m1/draft.json' if name=='rereview' else 'repair/candidate.json'))
                repeated=signatures(blockers)&signatures(split(read(previous),read(previous_plan))[0])
                if name=='rereview2' or repeated or (self.root/'revision.json').exists() or self.config.get('maximumRepairs',1)<2:
                    raise ValueError('REREVIEW_UNRESOLVED')

    def repair(self, source=None, review_dir=None, name='repair'):
        p=self.folder(name);source=source or self.root/'m1/draft.json';source_sha=digest(source)
        review_dir=review_dir or self.root/'m2'
        plan=read(source);issues=dict(issues=split(read(review_dir/'draft.json'),plan)[0])
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
            detail=read(review_dir/'coverage-small-materials.json').get('detail')
            for name in ('coverage-small-materials.json','coverage-small-materials.png')+(
                    (detail['file'],) if detail else ()):
                (p/name).write_bytes((review_dir/name).read_bytes())
        prompt=('继续同一会话，按 M2 与程序问题仅修补一次，不重写整个计划、不调用工具。'
                'materials/objects.upsert 为新增或替换的完整记录，remove 为删除 ID，保留无关记录。'
                'unknowns/backgroundMode/textPolicy 为 null 时沿用，preserveText 在对应素材记录内修订。'
                '对 UNASSIGNED_VISIBLE_ARTWORK，先核对原图；确有遗漏时补齐所属材料与对象的可见内容描述，必要时新增对象或材料，不靠缩框或改 unknowns 掩盖。'
                '补充描述时保留旧 label 中未被问题否定的场景、图形和颜色，复查完整改写结果，不输出截断词或乱码。'
                '单条 label 上限 200 字符；若细节放不下，新增同素材对象承载描述，或按独立视觉单元拆素材，不截断句子，也不在素材与对象 label 中重复清单。'
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
            if detail:prompt+=' 彩色局部放大对应 '+detail['materialId']+'。'
        (p/'prompt.md').write_text(prompt+self.user_context(),encoding='utf-8')
        names=['schema.json','prompt.md','review-overlay.png','source-context.json']
        if focus:names+=['focus-meta.json']+[row['file'] for row in focus]
        if small_focus:names+=['coverage-small-materials.json','coverage-small-materials.png']
        if small_focus and detail:names.append(detail['file'])
        save(p/'request.json',{'sessionId':read(self.root/'session.json')['sessionId'],'sourcePlanSha256':source_sha,
             'originalImageResent':True,'originalReferenceSha256':digest(self.root/'m1/reference.png'),
             'reviewSha256':digest(review_dir/'draft.json'),'inputs':{n:digest(p/n) for n in names}})
        self.call(p)

    def repair_check(self, source=None, name='repair'):
        p=self.root/name;source=source or self.root/'m1/draft.json'
        plan,report=merge_patch(source,read(p/'draft.json'),read(self.root/'m1/schema.json'),digest(source))
        report['remainingUnknowns']=plan['unknowns']
        save(p/'candidate.json',plan);save(p/'report.json',report)
        if report['programIssues'] or report['unresolvedIssues'] or plan['unknowns']:raise ValueError('REPAIR_UNRESOLVED')
        render_for_review(self.root/'m1/reference.png',plan,p/'preview')

    def execute(self):
        with locked(self.root):
            if not (self.root/'.dag/execution.json').exists():
                save(self.root/'.dag/execution.json',{'driver':'codex-cli' if self.model is live_model else 'injected-test-double'})
            self.node('m1',self.m1);self.node('check',self.check)
            self.node('m2',lambda:self.review('m2',self.root/'m1/draft.json',self.root/'m1/preview/materials-overlay.png'))
            initial_plan=read(self.root/'m1/draft.json')
            needs=bool(split(read(self.root/'m2/draft.json'),initial_plan)[0] or read(self.root/'m1/program-check.json')['issues'] or initial_plan['unknowns'])
            if needs:
                self.node('repair',self.repair);self.node('repair_check',self.repair_check)
                self.node('rereview',lambda:self.review('rereview',self.root/'repair/candidate.json',self.root/'repair/preview/materials-overlay.png'))
                if split(read(self.root/'rereview/draft.json'),read(self.root/'repair/candidate.json'))[0]:
                    self.node('repair2',lambda:self.repair(self.root/'repair/candidate.json',self.root/'rereview','repair2'))
                    self.node('repair_check2',lambda:self.repair_check(self.root/'repair/candidate.json','repair2'))
                    self.node('rereview2',lambda:self.review('rereview2',self.root/'repair2/candidate.json',self.root/'repair2/preview/materials-overlay.png'))
            self.node('freeze',lambda:freeze(self.root,self.root/'frozen',self.config['maxCalls'],self.config.get('generationMode','single')))
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
        result={'kind':'ui_planning_dag_status_v1','status':'frozen' if completed else 'incomplete','nodes':nodes,
                'failures':{p.parent.name:read(p)['error'] for p in (self.root/'.dag').glob('*/failed.json')},
                'nodeSeconds':{r['node']:r['seconds'] for r in records},'mediaGenerationCalls':0,
                'modelCallSeconds':model_times,
                'programNodeSeconds':{r['node']:r['seconds'] for r in records if r['node'] in ('check','repair_check','freeze')},
                'driver':read(self.root/'.dag/execution.json')['driver'] if (self.root/'.dag/execution.json').exists() else 'not-started',
                'humanVisualAcceptance':False,'automaticRetries':0,'runtimeAndInputsVerified':True,
                'interventionTracking':'Pinned inputs/code and checkpoint integrity; external use of the model session is not independently audited.'}
        result['reviewWarnings']={name:split(read(self.root/name/'draft.json'))[1] for name in ('m2','rereview','rereview2') if (self.root/name/'draft.json').exists()}
        if completed:result['snapshotDigest']=inspect(self.root/'frozen')['digest']
        return result


def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('action',choices=['run','resume','status'])
    p.add_argument('--output',required=True);p.add_argument('--image');p.add_argument('--max-calls',type=int,default=128)
    a=p.parse_args()
    if a.action=='run':
        if not a.image:p.error('--image is required for run')
        init(a.image,a.output,a.max_calls)
    dag=Dag(a.output)
    try:result=dag.status() if a.action=='status' else dag.execute()
    except Exception as exc:
        print(json.dumps({'status':'stopped','reason':str(exc),'automaticRetry':False},ensure_ascii=False));raise SystemExit(1)
    print(json.dumps(result,ensure_ascii=False,indent=2))


if __name__=='__main__':main()
