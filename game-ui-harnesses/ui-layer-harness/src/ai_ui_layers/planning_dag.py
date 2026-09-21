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
from .codex_call import command, transport_schema
from .compile_visual import HARNESS
from .evaluate import read, save, digest, check_relations
from .freeze_visual import freeze, inspect
from .local_patch import patch_schema, merge_patch
from .session_review import invoke, resume_command, session_id, build_review_prompt, render_for_review

BASE=HARNESS/'planning-harness'
REPO=Path(__file__).resolve().parents[4]
GRAPH={'m1':[], 'check':['m1'], 'm2':['check'], 'repair':['m2'],
       'repair_check':['repair'], 'rereview':['repair_check'], 'freeze':['m2','rereview']}


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


def init(image, root, max_calls=128):
    root=Path(root).resolve();image=Path(image)
    with Image.open(image) as im:
        if im.format!='PNG' or im.getexif().get(274,1)!=1:raise ValueError('PNG_WITH_REFERENCE_COORDINATES_REQUIRED')
        im.load()
    if not 1<=max_calls<=128:raise ValueError('CALL_LIMIT')
    root.mkdir(parents=True,exist_ok=False);(root/'.dag').mkdir();inputs=root/'.dag/inputs';inputs.mkdir()
    for name,source in [('reference.png',image),('visual-plan.md',BASE/'prompts/visual-plan.md'),
                        ('visual-review.md',BASE/'prompts/visual-review.md'),('storage-schema.json',BASE/'schemas/visual-plan.schema.json')]:
        (inputs/name).write_bytes(source.read_bytes())
    save(root/'.dag/config.json',{'kind':'ui_planning_dag_v1','runtime':runtime_files(),
         'inputs':{p.name:digest(p) for p in inputs.iterdir()},'maxCalls':max_calls,
         'model':'gpt-5.6-luna','effort':'xhigh','graph':GRAPH,'maximumRepairs':1,'mediaGenerationCalls':0})
    save(root/'.dag/config-digest.json',{'sha256':digest(root/'.dag/config.json')})
    return root


def live_model(folder, sid, first):
    with tempfile.TemporaryDirectory(prefix='ui-planning-dag-') as cwd:
        if first:
            args=command(shutil.which('codex'),folder,Path(cwd),'gpt-5.6-luna','xhigh');args.remove('--ephemeral')
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

    def m1(self):
        p=self.folder('m1')
        for name,source in [('reference.png','reference.png'),('prompt.md','visual-plan.md')]:
            (p/name).write_bytes((self.inputs/source).read_bytes())
        save(p/'schema.json',transport_schema(read(self.inputs/'storage-schema.json')))
        save(self.root/'request.json',{'inputs':{n:digest(p/n) for n in ('reference.png','prompt.md','schema.json')},
             'model':self.config['model'],'effort':self.config['effort'],'mediaGenerationCalls':0,'repairOnce':True})
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
        schema={'type':'object','additionalProperties':False,'required':['issues'],'properties':{'issues':{'type':'array','items':{
            'type':'object','additionalProperties':False,'required':['code','category','ids','description','suggestedChange'],
            'properties':{'code':{'type':'string'},'category':{'type':'string','enum':['semantic','geometry']},
                          'ids':{'type':'array','items':{'type':'string'}},'description':{'type':'string'},'suggestedChange':{'type':'string'}}}}}}
        save(p/'schema.json',schema)
        prompt=build_review_prompt((p/'review-source.md').read_text(encoding='utf-8'),check_relations(plan))
        if name=='rereview':prompt+='\n检查修补后的完整候选，不再修补：\n'+json.dumps(plan,ensure_ascii=False)
        (p/'prompt.md').write_text(prompt,encoding='utf-8')
        bound={'sessionId':sid,'inputs':{n:digest(p/n) for n in ('schema.json','review-source.md','review-overlay.png','prompt.md')}}
        if name=='m2':bound['sourcePlanSha256']=digest(plan_path)
        else:bound.update(candidateSha256=digest(plan_path),patchSha256=digest(self.root/'repair/draft.json'))
        save(p/'request.json',bound);receipt=self.call(p)
        answer=read(p/'draft.json');known={o['id'] for k in ('materials','objects') for o in plan[k]}
        if any(set(i['ids'])-known for i in answer['issues']):raise ValueError('UNKNOWN_REVIEW_IDS')
        if name=='m2':
            first=read(self.root/'m1/transport.json')
            save(self.root/'result.json',{'sameSessionVerified':True,'sessionId':sid,'unknownIssueIds':[],
                 'sourcePlanSha256':digest(plan_path),'reviewSha256':digest(p/'draft.json'),
                 'm1Seconds':first['elapsedSeconds'],'m2Seconds':receipt['elapsedSeconds'],
                 'm3Executed':False,'productionReady':False,'humanVisualAcceptance':False})
        else:
            save(p/'result.json',{'sameSessionVerified':True,'sessionId':sid,'reviewSha256':digest(p/'draft.json'),
                 'seconds':receipt['elapsedSeconds'],'issueCount':len(answer['issues']),'automaticRetry':False})
            if answer['issues']:raise ValueError('REREVIEW_UNRESOLVED')

    def repair(self):
        p=self.folder('repair');source=self.root/'m1/draft.json';source_sha=digest(source)
        save(p/'schema.json',transport_schema(patch_schema(read(self.root/'m1/schema.json'),source_sha)))
        (p/'review-overlay.png').write_bytes((self.root/'m2/review-overlay.png').read_bytes())
        prompt=('继续同一会话，按 M2 与程序问题仅修补一次，不重写整个计划、不调用工具。'
                'materials/objects.upsert 为新增或替换的完整记录，remove 为删除 ID，保留无关记录。'
                'unknowns/backgroundMode/textPolicy 为 null 时沿用，preserveText 在对应素材记录内修订。'
                '无法解决的问题写 unresolvedIssues，不猜测。sourcePlanSha256 原样回传：'+source_sha+
                '\nM2问题：'+json.dumps(read(self.root/'m2/draft.json'),ensure_ascii=False)+
                '\n程序问题：'+json.dumps(read(self.root/'m1/program-check.json'),ensure_ascii=False))
        (p/'prompt.md').write_text(prompt,encoding='utf-8')
        save(p/'request.json',{'sessionId':read(self.root/'session.json')['sessionId'],'sourcePlanSha256':source_sha,
             'reviewSha256':digest(self.root/'m2/draft.json'),'inputs':{n:digest(p/n) for n in ('schema.json','prompt.md','review-overlay.png')}})
        self.call(p)

    def repair_check(self):
        p=self.root/'repair';source=self.root/'m1/draft.json'
        plan,report=merge_patch(source,read(p/'draft.json'),read(self.root/'m1/schema.json'),digest(source))
        save(p/'candidate.json',plan);save(p/'report.json',report)
        if report['programIssues'] or report['unresolvedIssues'] or plan['unknowns']:raise ValueError('REPAIR_UNRESOLVED')
        render_for_review(self.root/'m1/reference.png',plan,p/'preview')

    def execute(self):
        with locked(self.root):
            if not (self.root/'.dag/execution.json').exists():
                save(self.root/'.dag/execution.json',{'driver':'codex-cli' if self.model is live_model else 'injected-test-double'})
            self.node('m1',self.m1);self.node('check',self.check)
            self.node('m2',lambda:self.review('m2',self.root/'m1/draft.json',self.root/'m1/preview/materials-overlay.png'))
            needs=bool(read(self.root/'m2/draft.json')['issues'] or read(self.root/'m1/program-check.json')['issues'] or read(self.root/'m1/draft.json')['unknowns'])
            if needs:
                self.node('repair',self.repair);self.node('repair_check',self.repair_check)
                self.node('rereview',lambda:self.review('rereview',self.root/'repair/candidate.json',self.root/'repair/preview/materials-overlay.png'))
            self.node('freeze',lambda:freeze(self.root,self.root/'frozen',self.config['maxCalls']))
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
        records=[read(p) for p in (self.root/'.dag').glob('*/done.json')]
        model_times={name:read(self.root/name/'transport.json')['elapsedSeconds']
                     for name in ('m1','m2','repair','rereview') if (self.root/name/'transport.json').exists()}
        result={'kind':'ui_planning_dag_status_v1','status':'frozen' if completed else 'incomplete','nodes':nodes,
                'failures':{p.parent.name:read(p)['error'] for p in (self.root/'.dag').glob('*/failed.json')},
                'nodeSeconds':{r['node']:r['seconds'] for r in records},'mediaGenerationCalls':0,
                'modelCallSeconds':model_times,
                'programNodeSeconds':{r['node']:r['seconds'] for r in records if r['node'] in ('check','repair_check','freeze')},
                'driver':read(self.root/'.dag/execution.json')['driver'] if (self.root/'.dag/execution.json').exists() else 'not-started',
                'humanVisualAcceptance':False,'automaticRetries':0,'runtimeAndInputsVerified':True,
                'interventionTracking':'Pinned inputs/code and checkpoint integrity; external use of the model session is not independently audited.'}
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
