"""Experimental reference-to-layer delivery; media calls remain an explicit host exchange."""
import argparse
from contextlib import redirect_stdout
import json
import sys
from pathlib import Path
from PIL import Image
from . import planning_dag as planning
from . import experimental_executor as exchange
from .automatic_registration import run as register
from .evaluate import read, save, digest
from .freeze_visual import inspect
from .layer_package import build, sources_from_preview, validate_archive
from .extract_sheets import extract
from .adapt_strip import adapt_materials
from .review_single_job import run as review_single_job

GRAPH = {'planning': [], 'prepare': ['planning'], 'raw_complete': ['prepare'],
         'registration': ['raw_complete'], 'package': ['registration']}


def runtime_files():
    files = planning.runtime_files()
    for path in (planning.BASE/'schemas').glob('*.json'):
        files[path.relative_to(planning.REPO).as_posix()] = digest(path)
    for path in (planning.BASE/'prompts').glob('*.md'):
        files[path.relative_to(planning.REPO).as_posix()] = digest(path)
    return files


def init(image, root, viewer=None, target='ui-layers', max_calls=12, generation_mode='single', planning_notes=None):
    notes=planning.read_notes(planning_notes)
    root = Path(root).resolve(); image = Path(image)
    if target not in ('frozen', 'ui-layers'): raise ValueError('DELIVERY_TARGET')
    if not 1 <= max_calls <= 128: raise ValueError('CALL_LIMIT')
    if generation_mode not in ('single','sheets'):raise ValueError('GENERATION_MODE')
    with Image.open(image) as im:
        if im.format != 'PNG' or im.getexif().get(274, 1) != 1: raise ValueError('PNG_REQUIRED')
        im.load()
    inputs = {'reference.png': image}
    if target == 'ui-layers':
        if viewer is None: raise ValueError('BUILT_VIEWER_REQUIRED')
        for name in ('viewer.html', 'viewer.js'):
            path = Path(viewer)/name
            if not path.is_file(): raise ValueError('BUILT_VIEWER_REQUIRED')
            inputs[name] = path
    root.mkdir(parents=True, exist_ok=False); (root/'.dag/inputs').mkdir(parents=True)
    for name, source in inputs.items(): (root/'.dag/inputs'/name).write_bytes(source.read_bytes())
    if notes is not None:
        (root/'.dag/inputs/planning-notes.txt').write_bytes(notes)
        inputs['planning-notes.txt']=Path(planning_notes)
    save(root/'.dag/config.json', dict(kind='ui_delivery_dag_v1', target=target, graph=GRAPH,
         maxCalls=max_calls, generationMode=generation_mode, runtime=runtime_files(),
         inputs={name:digest(root/'.dag/inputs'/name) for name in inputs}))
    save(root/'.dag/config-digest.json', dict(sha256=digest(root/'.dag/config.json')))
    return root


class DeliveryDag(planning.Dag):
    def __init__(self, root, model=planning.live_model, registration_model=None, sheet_model=None, material_model=None):
        super().__init__(root, model)
        self.registration_model = registration_model
        self.sheet_model = sheet_model
        self.material_model = material_model

    def verify(self):
        if digest(self.root/'.dag/config.json') != read(self.root/'.dag/config-digest.json')['sha256']:
            raise ValueError('CONFIG_CHANGED')
        if self.config['runtime'] != runtime_files(): raise ValueError('RUNTIME_CHANGED_NEW_RUN_REQUIRED')
        for name, expected in self.config['inputs'].items():
            if digest(self.inputs/name) != expected: raise ValueError('INPUT_CHANGED')
        for done in (self.root/'.dag').glob('*/done.json'):
            for name, expected in read(done)['outputs'].items():
                if digest(self.root/name) != expected: raise ValueError('COMPLETED_OUTPUT_CHANGED:'+name)
        if (self.root/'planning/.dag/config.json').exists():
            planning.Dag(self.root/'planning', self.model).verify()
        if (self.root/'raw-receipts.json').exists():
            for name, expected in read(self.root/'raw-receipts.json').items():
                if digest(self.root/'generation'/name) != expected: raise ValueError('RAW_RECEIPT_CHANGED')

    def collect_raw(self):
        job = self.root/'generation'
        current = exchange.status(job)
        if current['status'] != 'raw_complete': raise ValueError('RAW_INCOMPLETE')
        snapshot = job/'snapshot'
        receipts={p.relative_to(job).as_posix():digest(p) for p in job.rglob('*')
                  if p.is_file() and p.name!='exchange.lock'}
        sources={key:str(job/'attempts'/key/'raw.png') for key in current['requests']}
        pre_adapted={}
        if self.config.get('generationMode')=='sheets':
            extraction=extract(snapshot,inspect(snapshot)['digest'],sources,self.root/'extraction',self.sheet_model)
            sources=extraction['materials'];pre_adapted=extraction.get('adaptations',{})
        else:
            review_single_job(job,self.root/'material-review',self.material_model)
        sources=adapt_materials(snapshot,sources,self.root/'adaptation',pre_adapted)
        if any(digest(job/name)!=sha for name,sha in receipts.items()):raise ValueError('RAW_RECEIPT_CHANGED')
        save(self.root/'registration-input.json', dict(snapshot=str(snapshot),
             snapshotDigest=inspect(snapshot)['digest'],
             materials=sources))
        # Bind exchange receipts as well as raw bytes; later mutation cannot silently change provenance.
        save(self.root/'raw-receipts.json', receipts)

    def execute(self):
        with planning.locked(self.root):
            self.verify()
            # Let the nested DAG own its checkpoints so interruption between M1/M2 can resume.
            if not (self.root/'.dag/planning/done.json').exists():
                planroot = self.root/'planning'
                if not planroot.exists(): planning.init(self.inputs/'reference.png', planroot, self.config['maxCalls'],self.config.get('generationMode','single'),
                    self.inputs/'planning-notes.txt' if 'planning-notes.txt' in self.config['inputs'] else None)
                planning.Dag(planroot, self.model).execute()
                self.node('planning', lambda: save(self.root/'planning-result.json',
                          planning.Dag(planroot, self.model).status()))
            if self.config['target'] == 'frozen': return self.status()
            snapshot = self.root/'planning/frozen'
            self.node('prepare', lambda: exchange.prepare(snapshot, inspect(snapshot)['digest'], self.root/'generation'))
            current = exchange.status(self.root/'generation')
            if current['status'] != 'raw_complete': return self.status()
            self.node('raw_complete', self.collect_raw)
            self.node('registration', lambda: register(self.root/'registration-input.json',
                      self.root/'registration', model_call=self.registration_model))
            self.node('package', lambda: build(self.root/'generation/snapshot',
                      sources_from_preview(self.root/'generation/snapshot', self.root/'registration/preview',
                          self.visual_warnings()),
                      self.root/'delivery', self.inputs))
            return self.status()

    def visual_warnings(self):
        warnings=[]
        for name in ('extraction','material-review'):
            path=self.root/name/'result.json'
            if path.exists():warnings.extend(read(path).get('warnings',[]))
        return warnings

    def status(self):
        self.verify()
        nodes = {}
        for name in GRAPH:
            state = self.root/'.dag'/name
            nodes[name] = ('completed' if (state/'done.json').exists() else 'failed' if (state/'failed.json').exists()
                           else 'interrupted_or_running' if state.exists() else 'pending')
        result = dict(kind='ui_delivery_dag_status_v1', target=self.config['target'], nodes=nodes,
                      status='incomplete', automaticRetries=0, humanVisualAcceptance=False,
                      mediaDriver='explicit-host-exchange',
                      generationMode=self.config.get('generationMode','single'),
                      nodeSeconds={p.parent.name:read(p)['seconds'] for p in (self.root/'.dag').glob('*/done.json')},
                      failures={p.parent.name:read(p)['error'] for p in (self.root/'.dag').glob('*/failed.json')})
        if (self.root/'planning/.dag/config.json').exists():
            result['planning'] = planning.Dag(self.root/'planning', self.model).status()
        if (self.root/'raw-receipts.json').exists():
            for name, expected in read(self.root/'raw-receipts.json').items():
                if digest(self.root/'generation'/name) != expected: raise ValueError('RAW_RECEIPT_CHANGED')
        if (self.root/'generation/job.json').exists():
            result['generation'] = exchange.status(self.root/'generation')
            result['status'] = result['generation']['status']
        if (self.root/'extraction/result.json').exists():
            evidence=read(self.root/'extraction/result.json')
            result['extraction']={k:evidence[k] for k in ('status','modelCalls','humanVisualAcceptance')}
            if 'reason' in evidence:result['extraction']['reason']=evidence['reason']
            result['extraction']['warnings']=evidence.get('warnings',[])
            result['extraction']['decisions']=evidence.get('decisions',[])
        if (self.root/'adaptation/result.json').exists():
            result['adaptation']=read(self.root/'adaptation/result.json')
        if (self.root/'material-review/result.json').exists():
            result['materialReview']=read(self.root/'material-review/result.json')
        if self.config['target'] == 'frozen' and nodes['planning'] == 'completed': result['status'] = 'frozen'
        if nodes['package'] == 'completed':
            result['package'] = validate_archive(self.root/'delivery/ui-layers.zip')
            result['status'] = 'delivered_pending_visual_review'
        elif any(v in ('failed', 'interrupted_or_running') for v in nodes.values()): result['status'] = 'stopped_no_retry'
        if 'planning' in result and any(v in ('failed','interrupted_or_running') for v in result['planning']['nodes'].values()):
            result['status'] = 'stopped_no_retry'
        return result


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('action', choices=['run','resume','status','authorize','next','receive','fail','preview-groups','freeze-reviewed','finish-received','finish-bundle','finish-variants','adjust-opacity'])
    p.add_argument('--source-sha256')
    p.add_argument('--opacity',type=float,help='Explicit multiplier for existing alpha, greater than 0 and at most 1')
    p.add_argument('--received-job',help='Complete received image job for explicit postprocessing or review-required variant packaging')
    p.add_argument('--received-source',action='append',help='For finish-bundle: ASSET=RECEIVED_JOB, repeated once per frozen singleton request')
    p.add_argument('--accepted-prompt-variant',action='append',help='For finish-bundle: ASSET=SHA256 explicitly approved prompt variant')
    p.add_argument('--selection',help='Complete received variant selection for receipt replay and review-required packaging')
    p.add_argument('--preview',help='Complete processed candidate preview for automatic received-variant discovery')
    p.add_argument('--jobs-root',help='Directory of received variant jobs for exact-source discovery')
    p.add_argument('--issues-file',help='Optional UTF-8 JSON array of known visual differences')
    p.add_argument('--planning-run',help='Completed reviewed planning directory for offline freezing')
    p.add_argument('--output', required=True); p.add_argument('--image'); p.add_argument('--viewer')
    p.add_argument('--target', choices=['frozen','ui-layers'], default='ui-layers')
    p.add_argument('--max-calls', type=int, default=12)
    p.add_argument('--generation-mode', choices=['single','sheets'], default='single')
    p.add_argument('--regroup-generation-mode', choices=['single','sheets'],
                   help='For freeze-reviewed only: compile a fresh request layout from reviewed materials')
    p.add_argument('--planning-notes',help='UTF-8 user-confirmed planning constraints, frozen for a new run')
    p.add_argument('--snapshot');p.add_argument('--snapshot-digest')
    p.add_argument('--job-digest'); p.add_argument('--approval'); p.add_argument('--submission-digest')
    p.add_argument('--source'); p.add_argument('--reason')
    a = p.parse_args()
    try:
        if a.action=='adjust-opacity':
            if not a.source or not a.source_sha256 or a.opacity is None or not a.reason:
                p.error('--source, --source-sha256, --opacity and --reason required')
            from .adjust_opacity import adjust
            result=adjust(a.source,a.source_sha256,a.opacity,a.output,a.reason)
            print(json.dumps(result,ensure_ascii=False,indent=2));return
        if a.action=='finish-received':
            if not a.received_job or not a.job_digest or not a.viewer:
                p.error('--received-job, --job-digest and --viewer required')
            from .finish_received import finish
            with redirect_stdout(sys.stderr):
                result=finish(a.received_job,a.job_digest,a.output,a.viewer)
            print(json.dumps(result,ensure_ascii=False,indent=2));return
        if a.action=='finish-bundle':
            if not a.snapshot or not a.snapshot_digest or not a.viewer or not a.received_source:
                p.error('--snapshot, --snapshot-digest, --viewer and --received-source required')
            selection={}
            for item in a.received_source:
                asset,sep,job=item.partition('=')
                if not sep or not asset or not job or asset in selection:
                    p.error('each --received-source must be a unique ASSET=RECEIVED_JOB')
                selection[asset]=job
            variants={}
            for item in a.accepted_prompt_variant or []:
                asset,sep,sha=item.partition('=')
                if not sep or not asset or len(sha)!=64 or any(c not in '0123456789abcdef' for c in sha.lower()) or asset in variants:
                    p.error('each --accepted-prompt-variant must be a unique ASSET=SHA256')
                variants[asset]=sha.lower()
            from .finish_bundle import finish
            with redirect_stdout(sys.stderr):
                result=finish(a.snapshot,a.snapshot_digest,selection,a.output,a.viewer,
                              allowed_variants=variants)
            print(json.dumps(result,ensure_ascii=False,indent=2));return
        if a.action=='finish-variants':
            if not a.viewer:p.error('--viewer required')
            by_preview=bool(a.snapshot or a.preview or a.jobs_root)
            by_job=bool(a.received_job or a.job_digest)
            if sum((bool(a.selection),by_preview,by_job))!=1:
                p.error('provide --selection, --received-job with --job-digest, or all of --snapshot, --preview and --jobs-root')
            if by_preview and not (a.snapshot and a.preview and a.jobs_root):
                p.error('--snapshot, --preview and --jobs-root required together')
            if by_job and not (a.received_job and a.job_digest):
                p.error('--received-job and --job-digest required together')
            issues=read(Path(a.issues_file)) if a.issues_file else []
            if not isinstance(issues,list):raise ValueError('ISSUES_FILE_ARRAY_REQUIRED')
            if by_job:
                from .raw_review_required import finish as finish_raw_review_required
                result=finish_raw_review_required(a.received_job,a.job_digest,a.output,a.viewer,issues)
                print(json.dumps(result,ensure_ascii=False,indent=2));return
            from .review_required_variants import build as finish_variants
            selection=a.selection
            discovery=None
            if not selection:
                from .discover_variants import discover
                target=Path(a.output)
                if target.exists():raise FileExistsError('OUTPUT_EXISTS')
                selection=str(target.with_name(target.name+'-selection.json'))
                discovery=discover(a.snapshot,a.preview,a.jobs_root,selection,issues)
            result=finish_variants(selection,a.output,a.viewer)
            if discovery:
                result.update(automaticVariantDiscovery=True,selectionSha256=discovery['selectionSha256'])
                save(Path(a.output)/'discovery.json',discovery)
            print(json.dumps(result,ensure_ascii=False,indent=2));return
        if a.action=='freeze-reviewed':
            if not a.planning_run:p.error('--planning-run required')
            from .refreeze import freeze_reviewed
            result=freeze_reviewed(a.planning_run,a.output,a.max_calls,a.regroup_generation_mode)
            print(json.dumps(result,ensure_ascii=False,indent=2));return
        if a.action=='preview-groups':
            if not a.snapshot or not a.snapshot_digest:p.error('--snapshot and --snapshot-digest required')
            from .generation_groups import preview as preview_groups
            result=preview_groups(a.snapshot,a.snapshot_digest,a.output)
            print(json.dumps(result,ensure_ascii=False,indent=2));return
        if a.action == 'run':
            if not a.image: p.error('--image required')
            init(a.image,a.output,a.viewer,a.target,a.max_calls,a.generation_mode,a.planning_notes)
        if a.planning_notes and a.action!='run':p.error('--planning-notes is only valid for a new run')
        dag = DeliveryDag(a.output); dag.verify(); job = dag.root/'generation'
        if a.action in ('run','resume'):
            with redirect_stdout(sys.stderr): result = dag.execute()
        elif a.action == 'status': result = dag.status()
        else:
            with planning.locked(dag.root):
                dag.verify()
                required = {'authorize':['job_digest','approval'], 'next':[],
                            'receive':['submission_digest','source'], 'fail':['submission_digest','reason']}[a.action]
                if any(not getattr(a,k) for k in required): p.error('missing exchange arguments')
                if a.action == 'authorize': result = exchange.authorize(job,a.job_digest,a.approval)
                elif a.action == 'next': result = exchange.next_request(job)
                elif a.action == 'receive': result = exchange.receive(job,a.submission_digest,a.source)
                else: result = exchange.fail(job,a.submission_digest,a.reason)
        print(json.dumps(result,ensure_ascii=False,indent=2))
    except Exception as exc:
        print(json.dumps(dict(status='stopped',reason=str(exc),automaticRetry=False),ensure_ascii=False))
        raise SystemExit(1)


if __name__ == '__main__': main()
