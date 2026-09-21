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

GRAPH = {'planning': [], 'prepare': ['planning'], 'raw_complete': ['prepare'],
         'registration': ['raw_complete'], 'package': ['registration']}


def runtime_files():
    files = planning.runtime_files()
    for path in (planning.BASE/'schemas').glob('*.json'):
        files[path.relative_to(planning.REPO).as_posix()] = digest(path)
    for path in (planning.BASE/'prompts').glob('*.md'):
        files[path.relative_to(planning.REPO).as_posix()] = digest(path)
    return files


def init(image, root, viewer=None, target='ui-layers', max_calls=12):
    root = Path(root).resolve(); image = Path(image)
    if target not in ('frozen', 'ui-layers'): raise ValueError('DELIVERY_TARGET')
    if not 1 <= max_calls <= 128: raise ValueError('CALL_LIMIT')
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
    save(root/'.dag/config.json', dict(kind='ui_delivery_dag_v1', target=target, graph=GRAPH,
         maxCalls=max_calls, runtime=runtime_files(),
         inputs={name:digest(root/'.dag/inputs'/name) for name in inputs}))
    save(root/'.dag/config-digest.json', dict(sha256=digest(root/'.dag/config.json')))
    return root


class DeliveryDag(planning.Dag):
    def __init__(self, root, model=planning.live_model, registration_model=None):
        super().__init__(root, model)
        self.registration_model = registration_model

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
        save(self.root/'registration-input.json', dict(snapshot=str(snapshot),
             snapshotDigest=inspect(snapshot)['digest'],
             materials={key:str(job/'attempts'/key/'raw.png') for key in current['requests']}))
        # Bind exchange receipts as well as raw bytes; later mutation cannot silently change provenance.
        save(self.root/'raw-receipts.json', {p.relative_to(job).as_posix():digest(p)
             for p in job.rglob('*') if p.is_file() and p.name != 'exchange.lock'})

    def execute(self):
        with planning.locked(self.root):
            self.verify()
            # Let the nested DAG own its checkpoints so interruption between M1/M2 can resume.
            if not (self.root/'.dag/planning/done.json').exists():
                planroot = self.root/'planning'
                if not planroot.exists(): planning.init(self.inputs/'reference.png', planroot, self.config['maxCalls'])
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
                      sources_from_preview(self.root/'generation/snapshot', self.root/'registration/preview'),
                      self.root/'delivery', self.inputs))
            return self.status()

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
    p.add_argument('action', choices=['run','resume','status','authorize','next','receive','fail'])
    p.add_argument('--output', required=True); p.add_argument('--image'); p.add_argument('--viewer')
    p.add_argument('--target', choices=['frozen','ui-layers'], default='ui-layers')
    p.add_argument('--max-calls', type=int, default=12)
    p.add_argument('--job-digest'); p.add_argument('--approval'); p.add_argument('--submission-digest')
    p.add_argument('--source'); p.add_argument('--reason')
    a = p.parse_args()
    try:
        if a.action == 'run':
            if not a.image: p.error('--image required')
            init(a.image,a.output,a.viewer,a.target,a.max_calls)
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
