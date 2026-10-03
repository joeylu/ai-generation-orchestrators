"""Experimental reference-to-layer delivery; media calls remain an explicit host exchange."""
import argparse
from contextlib import redirect_stdout
import json
import sys
from pathlib import Path
from PIL import Image
from . import planning_dag as planning
from . import visual_textures as textures
from . import experimental_executor as exchange
from .automatic_registration import run as register
from .evaluate import read, save, digest
from .freeze_visual import inspect
from .layer_package import build, sources_from_preview, validate_archive
from .extract_sheets import extract
from .adapt_strip import adapt_materials
from .review_single_job import run as review_single_job
from .session_review import TransportFailure
from .visual_policy import load_input, input_policy
from . import body_observation as body

GRAPH = {'planning': [], 'prepare': ['planning'], 'raw_complete': ['prepare'],
         'registration': ['raw_complete'], 'package': ['registration']}
BODY_GRAPH = {**GRAPH, 'body_prepare': ['raw_complete'],
              'body_observation': ['body_prepare'], 'registration': ['body_observation']}


def runtime_files():
    files = planning.runtime_files()
    for path in (planning.BASE/'schemas').glob('*.json'):
        files[path.relative_to(planning.REPO).as_posix()] = digest(path)
    for path in (planning.BASE/'prompts').glob('*.md'):
        files[path.relative_to(planning.REPO).as_posix()] = digest(path)
    return files


def init(image, root, viewer=None, target='ui-layers', max_calls=12, generation_mode=planning.DEFAULT_GENERATION_MODE, planning_notes=None, generation_reference=planning.DEFAULT_GENERATION_REFERENCE, visual_policy=None,
         context_prompt_version=None, registration_policy=body.POLICY, max_body_calls=body.DEFAULT_MAX_CALLS,
         planning_model=planning.CLI_MODEL, planning_effort=planning.CLI_EFFORT, planning_timeout=900, visual_textures=None):
    planning.validate_model_settings(planning_model, planning_effort, planning_timeout)
    from .context_references import validate_mode
    validate_mode(generation_reference)
    if generation_reference == 'context-crops':
        context_prompt_version = context_prompt_version or 'v7'
        if context_prompt_version not in ('v1','v2','v3','v4','v5','v6','v7'):
            raise ValueError('CONTEXT_PROMPT_VERSION')
    elif context_prompt_version is not None:
        raise ValueError('CONTEXT_PROMPT_REQUIRES_CONTEXT_CROPS')
    if registration_policy not in ('legacy-region-fit', body.POLICY):
        raise ValueError('DELIVERY_REGISTRATION_POLICY')
    if type(max_body_calls) is not int or not 1 <= max_body_calls <= 128:
        raise ValueError('BODY_CALL_LIMIT')
    notes=planning.read_notes(planning_notes)
    policy_bytes=load_input(visual_policy)
    texture_bytes=textures.load_input(visual_textures,image)
    if policy_bytes is not None:
        from .visual_policy import validate
        policy=validate(json.loads(policy_bytes.decode('utf-8-sig')))
        if policy['appearanceEvidence']=='bound-reference' and generation_reference!='context-crops':
            raise ValueError('BOUND_REFERENCE_REQUIRES_CONTEXT_CROPS')
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
    if policy_bytes is not None:
        (root/'.dag/inputs/visual-policy.json').write_bytes(policy_bytes)
        inputs['visual-policy.json']=Path(visual_policy)
    if texture_bytes is not None:
        (root/'.dag/inputs'/textures.INPUT_NAME).write_bytes(texture_bytes)
        inputs[textures.INPUT_NAME]=Path(visual_textures)
    save(root/'.dag/config.json', dict(kind='ui_delivery_dag_v1', target=target,
         graph=BODY_GRAPH if registration_policy == body.POLICY else GRAPH,
         maxCalls=max_calls, generationMode=generation_mode, generationReference=generation_reference, runtime=runtime_files(),
         registrationPolicy=registration_policy, maximumBodyCalls=max_body_calls,
         planningModel=planning_model, planningEffort=planning_effort, planningTimeoutSeconds=planning_timeout,
         **({'visualTexturePolicy':textures.POLICY} if texture_bytes is not None else {}),
         **({'contextPromptVersion':context_prompt_version} if context_prompt_version is not None else {}),
         inputs={name:digest(root/'.dag/inputs'/name) for name in inputs}))
    save(root/'.dag/config-digest.json', dict(sha256=digest(root/'.dag/config.json')))
    return root


class DeliveryDag(planning.Dag):
    def __init__(self, root, model=planning.live_model, registration_model=None, sheet_model=None, material_model=None, body_model=None):
        super().__init__(root, model)
        self.registration_model = registration_model
        self.sheet_model = sheet_model
        self.material_model = material_model
        self.body_model = body_model

    def verify(self):
        planning.validate_model_settings(self.config.get('planningModel',planning.CLI_MODEL),
            self.config.get('planningEffort',planning.CLI_EFFORT),self.config.get('planningTimeoutSeconds',900))
        if digest(self.root/'.dag/config.json') != read(self.root/'.dag/config-digest.json')['sha256']:
            raise ValueError('CONFIG_CHANGED')
        if self.config['runtime'] != runtime_files(): raise ValueError('RUNTIME_CHANGED_NEW_RUN_REQUIRED')
        version = self.config.get('contextPromptVersion')
        if version is not None and (self.config.get('generationReference') != 'context-crops' or
                version not in ('v1','v2','v3','v4','v5','v6','v7')):
            raise ValueError('CONTEXT_PROMPT_VERSION')
        policy = self.config.get('registrationPolicy', 'legacy-region-fit')
        if policy not in ('legacy-region-fit', body.POLICY):
            raise ValueError('DELIVERY_REGISTRATION_POLICY')
        if policy == body.POLICY and self.config['graph'] != BODY_GRAPH:
            raise ValueError('BODY_GRAPH_MISMATCH')
        for name, expected in self.config['inputs'].items():
            if digest(self.inputs/name) != expected: raise ValueError('INPUT_CHANGED')
        input_policy(self.inputs,self.config)
        textures.read_input(self.inputs,self.config)
        for done in (self.root/'.dag').glob('*/done.json'):
            for name, expected in read(done)['outputs'].items():
                if digest(self.root/name) != expected: raise ValueError('COMPLETED_OUTPUT_CHANGED:'+name)
        if (self.root/'planning/.dag/config.json').exists():
            planning.Dag(self.root/'planning', self.model).verify()
            if read(self.root/'planning/.dag/config.json')['inputs'].get('visual-policy.json')!=self.config['inputs'].get('visual-policy.json'):
                raise ValueError('VISUAL_POLICY_NESTED_RUN_MISMATCH')
            nested = read(self.root/'planning/.dag/config.json')
            if (nested.get('visualTexturePolicy')!=self.config.get('visualTexturePolicy') or
                    nested['inputs'].get(textures.INPUT_NAME)!=self.config['inputs'].get(textures.INPUT_NAME)):
                raise ValueError('VISUAL_TEXTURE_NESTED_RUN_MISMATCH')
            if (nested.get('model',planning.CLI_MODEL),nested.get('effort',planning.CLI_EFFORT),nested.get('timeoutSeconds',900)) != (
                    self.config.get('planningModel',planning.CLI_MODEL),self.config.get('planningEffort',planning.CLI_EFFORT),
                    self.config.get('planningTimeoutSeconds',900)):
                raise ValueError('PLANNING_MODEL_NESTED_RUN_MISMATCH')
            if (nested.get('generationReference','full') != self.config.get('generationReference','full') or
                    nested.get('contextPromptVersion','v3') != self.config.get('contextPromptVersion','v3')):
                raise ValueError('CONTEXT_PROMPT_NESTED_RUN_MISMATCH')
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
            extraction=extract(snapshot,inspect(snapshot)['digest'],sources,self.root/'extraction',self.sheet_model,
                               received_jobs={key:job for key in current['requests']},
                               material_model=self.material_model)
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

    def prepare_generation(self):
        snapshot = self.root/'planning/frozen'
        if self.config.get('registrationPolicy') == body.POLICY:
            body.validate_budget(snapshot, self.config['maximumBodyCalls'])
        return exchange.prepare(snapshot, inspect(snapshot)['digest'], self.root/'generation')

    def execute(self):
        with planning.locked(self.root):
            self.verify()
            # Let the nested DAG own its checkpoints so interruption between M1/M2 can resume.
            if not (self.root/'.dag/planning/done.json').exists():
                planroot = self.root/'planning'
                if not planroot.exists(): planning.init(self.inputs/'reference.png', planroot, self.config['maxCalls'],self.config.get('generationMode','single'),
                    self.inputs/'planning-notes.txt' if 'planning-notes.txt' in self.config['inputs'] else None,
                    self.config.get('generationReference','full'),
                    self.inputs/'visual-policy.json' if 'visual-policy.json' in self.config['inputs'] else None,
                    self.config.get('contextPromptVersion','v3') if self.config.get('generationReference')=='context-crops' else None,
                    planning_model=self.config.get('planningModel',planning.CLI_MODEL),
                    planning_effort=self.config.get('planningEffort',planning.CLI_EFFORT),
                    planning_timeout=self.config.get('planningTimeoutSeconds',900),
                    visual_textures=self.inputs/textures.INPUT_NAME if textures.INPUT_NAME in self.config['inputs'] else None)
                planning.Dag(planroot, self.model).execute()
                self.node('planning', lambda: save(self.root/'planning-result.json',
                          planning.Dag(planroot, self.model).status()))
            if self.config['target'] == 'frozen': return self.status()
            snapshot = self.root/'planning/frozen'
            self.node('prepare', self.prepare_generation)
            current = exchange.status(self.root/'generation')
            if current['status'] != 'raw_complete': return self.status()
            self.node('raw_complete', self.collect_raw)
            registration_input = self.root/'registration-input.json'
            if self.config.get('registrationPolicy') == body.POLICY:
                body_job = self.root/'body-observation'
                self.node('body_prepare', lambda: body.prepare(registration_input, body_job, self.config['maximumBodyCalls']))
                if body.status(body_job)['status'] == 'awaiting_body_authorization':
                    return self.status()
                registration_input = self.root/'body-registration-input.json'
                self.node('body_observation', lambda: body.execute(body_job, registration_input, self.body_model))
            self.node('registration', lambda: register(registration_input,
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
        for name in self.config['graph']:
            state = self.root/'.dag'/name
            nodes[name] = ('completed' if (state/'done.json').exists() else 'failed' if (state/'failed.json').exists()
                           else 'interrupted_or_running' if state.exists() else 'pending')
        result = dict(kind='ui_delivery_dag_status_v1', target=self.config['target'], nodes=nodes,
                      status='incomplete', automaticRetries=0, humanVisualAcceptance=False,
                      mediaDriver='explicit-host-exchange',
                      generationMode=self.config.get('generationMode','single'),
                      generationReference=self.config.get('generationReference','full'),
                      **({'contextPromptVersion':self.config.get('contextPromptVersion','v3')} if
                          self.config.get('generationReference')=='context-crops' else {}),
                      registrationPolicy=self.config.get('registrationPolicy','legacy-region-fit'),
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
        if (self.root/'body-observation/job.json').exists():
            result['bodyObservation'] = body.status(self.root/'body-observation')
            if result['bodyObservation']['status'] == 'awaiting_body_authorization':
                result['status'] = 'awaiting_body_authorization'
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
    p.add_argument('action', choices=['run','resume','status','authorize','authorize-body','next','receive','fail','register-materials','preview-groups','freeze-reviewed','prepare-host-review','receive-host-review','status-host-review','revise-frozen-crops','finish-received','finish-bundle','finish-variants','revise-package','adjust-opacity','freeze-background-region','inspect-background-region','apply-background-region'])
    p.add_argument('--candidate',help='Explicit offline v5 candidate seed for host review')
    p.add_argument('--contract-dir',help='Planning contract directory to snapshot for host review')
    p.add_argument('--response',help='External JSON response for the prepared host review')
    p.add_argument('--request-sha256',help='Exact prepared host review request digest')
    p.add_argument('--response-sha256',help='Optional external response digest')
    p.add_argument('--seed-author',action='append',help='Opaque offline candidate author ID, repeat for all authors')
    p.add_argument('--host-attestation',help='Explicit host provenance attestation JSON for external model review')
    p.add_argument('--dispatch-evidence',help='Actual host dispatch evidence file to fingerprint')
    p.add_argument('--return-evidence',help='Actual host return evidence file to fingerprint')
    p.add_argument('--config',help='For register-materials: bound explicit body registration config')
    p.add_argument('--source-sha256')
    p.add_argument('--edit-mask',help='Explicit binary L PNG allowed-edit region; not inferred from material boxes')
    p.add_argument('--edit-mask-sha256')
    p.add_argument('--blend-mask',help='Explicit L PNG proposal weights; zero outside the allowed-edit region')
    p.add_argument('--blend-mask-sha256')
    p.add_argument('--background-mode',choices=['scene-only','preserve-underlay'])
    p.add_argument('--text-policy',choices=['remove-business-text'])
    p.add_argument('--region-plan',help='Frozen background region directory for deterministic proposal application')
    p.add_argument('--region-digest',help='Expected background region plan digest')
    p.add_argument('--opacity',type=float,help='Explicit multiplier for existing alpha, greater than 0 and at most 1')
    p.add_argument('--received-job',help='Complete received image job for explicit postprocessing or review-required variant packaging')
    p.add_argument('--received-source',action='append',help='For finish-bundle: ASSET=RECEIVED_JOB, repeated once per frozen singleton request')
    p.add_argument('--accepted-prompt-variant',action='append',help='For finish-bundle: ASSET=SHA256 explicitly approved prompt variant')
    p.add_argument('--selection',help='Received variant selection or explicit package-derived layer revision selection')
    p.add_argument('--preview',help='Complete processed candidate preview for automatic received-variant discovery')
    p.add_argument('--jobs-root',help='Directory of received variant jobs for exact-source discovery')
    p.add_argument('--issues-file',help='Optional UTF-8 JSON array of known visual differences')
    p.add_argument('--planning-run',help='Completed reviewed planning directory for offline freezing')
    p.add_argument('--rejection',help='For revise-frozen-crops: explicit frozen-parent crop rejection JSON')
    p.add_argument('--output', required=True); p.add_argument('--image'); p.add_argument('--viewer')
    p.add_argument('--target', choices=['frozen','ui-layers'], default='ui-layers')
    p.add_argument('--max-calls', type=int, default=12)
    p.add_argument('--planning-model',help='New-run planning model, frozen for every planning turn')
    p.add_argument('--planning-effort',help='New-run planning reasoning effort')
    p.add_argument('--planning-timeout',type=int,help='New-run per-planning-call timeout in seconds (1..86400)')
    p.add_argument('--generation-mode', choices=['single','sheets'], default=planning.DEFAULT_GENERATION_MODE,
                   help='Generation layout for new runs (default: sheets); single uses one request per material')
    p.add_argument('--generation-reference',choices=['full','context-crops'],
                   help='New runs default to context-crops; freeze-reviewed inherits the source mode')
    p.add_argument('--regroup-generation-mode', choices=['single','sheets'],
                   help='For freeze-reviewed only: compile a fresh request layout from reviewed materials')
    p.add_argument('--context-prompt-version',choices=['v1','v2','v3','v4','v5','v6','v7'],
                   help='For new run or freeze-reviewed: frozen context prompt version; new context runs default to v7')
    p.add_argument('--registration-policy',choices=['legacy-region-fit',body.POLICY],
                   help='For new runs: default reference-body-auto-v1; historical runs retain their old policy')
    p.add_argument('--max-body-calls',type=int,
                   help='For new runs: maximum one body observation per foreground, default cap 12')
    p.add_argument('--planning-notes',help='UTF-8 user-confirmed planning constraints, frozen for a new run')
    p.add_argument('--visual-policy',help='Explicit visual evidence and tolerance JSON, frozen only for a new run')
    p.add_argument('--visual-textures',help='Source-bound visual texture preservation regions JSON, new run only')
    p.add_argument('--snapshot');p.add_argument('--snapshot-digest')
    p.add_argument('--job-digest'); p.add_argument('--approval'); p.add_argument('--submission-digest')
    p.add_argument('--source'); p.add_argument('--reason')
    a = p.parse_args()
    try:
        if a.action in ('prepare-host-review','receive-host-review','status-host-review'):
            if any(value is not None for value in (a.planning_model,a.planning_effort,a.planning_timeout)):
                p.error('host review does not accept CLI planning model settings')
            if a.context_prompt_version is not None:
                p.error('host review preparation freezes context prompt v7; no override accepted')
            if a.generation_reference is not None or a.regroup_generation_mode is not None or a.generation_mode!='sheets':
                p.error('host review preparation freezes sheets and context-crops; no override accepted')
        if a.action=='status-host-review':
            from .host_review import status
            print(json.dumps(status(Path(a.output)),ensure_ascii=False,indent=2));return
        if a.action=='prepare-host-review':
            if not all((a.candidate,a.image,a.contract_dir,a.seed_author)):
                p.error('--candidate, --image, --contract-dir and --seed-author required')
            from .host_review import prepare
            result=prepare(a.candidate,a.image,a.output,a.contract_dir,
                seed_author=a.seed_author,planning_notes=a.planning_notes,visual_policy=a.visual_policy,
                visual_textures=a.visual_textures,max_calls=a.max_calls)
            print(json.dumps(result,ensure_ascii=False,indent=2));return
        if a.action=='receive-host-review':
            if not all((a.response,a.request_sha256,a.host_attestation,a.dispatch_evidence,a.return_evidence)):
                p.error('--response, --request-sha256, --host-attestation, --dispatch-evidence and --return-evidence required')
            from .host_review import receive
            result=receive(a.output,a.response,a.request_sha256,response_sha256=a.response_sha256,
                           host_attestation=a.host_attestation,dispatch_evidence=a.dispatch_evidence,
                           return_evidence=a.return_evidence)
            print(json.dumps(result,ensure_ascii=False,indent=2));return
        if a.visual_textures is not None and a.action!='run':
            p.error('--visual-textures is only valid for a new run')
        if any(value is not None for value in (a.planning_model,a.planning_effort,a.planning_timeout)) and a.action!='run':
            p.error('--planning-model, --planning-effort and --planning-timeout are only valid for a new run')
        if a.config and a.action!='register-materials':p.error('--config is only valid for register-materials')
        if a.action=='revise-package':
            if not a.selection or not a.viewer:p.error('--selection and --viewer required')
            if any(token.split('=',1)[0] not in ('--selection','--output','--viewer')
                   for token in sys.argv[1:] if token.startswith('--')):
                p.error('revise-package only accepts a bound --selection, --output and --viewer')
            from .package_revision import revise
            result=revise(a.selection,a.output,a.viewer)
            print(json.dumps(result,ensure_ascii=False,indent=2));return
        if a.action=='register-materials':
            if not a.config:p.error('--config required')
            from .body_registration import POLICY as BODY_POLICY, POLICY_SUPPORT
            if read(Path(a.config)).get('registrationPolicy') not in (BODY_POLICY, POLICY_SUPPORT):
                raise ValueError('EXPLICIT_BODY_POLICY_REQUIRED')
            with redirect_stdout(sys.stderr):
                result=register(a.config,a.output,selected=[])
            print(json.dumps(result,ensure_ascii=False,indent=2));return
        if a.context_prompt_version is not None and a.action not in ('run','freeze-reviewed'):
            p.error('--context-prompt-version is only valid for run or freeze-reviewed')
        if (a.registration_policy is not None or a.max_body_calls is not None) and a.action!='run':
            p.error('--registration-policy and --max-body-calls are only valid for a new run')
        if a.visual_policy and a.action!='run':p.error('--visual-policy is only valid for a new run')
        if a.action=='revise-frozen-crops':
            if not a.planning_run or not a.rejection:p.error('--planning-run and --rejection required')
            from .revise_frozen_crop import init as init_crop_revision, FrozenCropDag
            with redirect_stdout(sys.stderr):
                result=FrozenCropDag(init_crop_revision(a.planning_run,a.output,a.rejection)).execute()
            print(json.dumps(result,ensure_ascii=False,indent=2));return
        if a.action=='freeze-background-region':
            required=('source','source_sha256','edit_mask','edit_mask_sha256','blend_mask','blend_mask_sha256','background_mode','text_policy','reason')
            if any(not getattr(a,key) for key in required):
                p.error('source and mask paths/SHA-256, --background-mode, --text-policy and --reason required')
            from .background_region import freeze as freeze_region
            result=freeze_region(a.source,a.source_sha256,a.edit_mask,a.edit_mask_sha256,
                                 a.blend_mask,a.blend_mask_sha256,a.output,a.background_mode,a.text_policy,a.reason)
            print(json.dumps(result,ensure_ascii=False,indent=2));return
        if a.action=='inspect-background-region':
            if not a.region_digest:p.error('--region-digest required; --output identifies the frozen region directory')
            from .background_region import inspect as inspect_region
            result=inspect_region(a.output,a.region_digest)
            print(json.dumps(result,ensure_ascii=False,indent=2));return
        if a.action=='apply-background-region':
            if not all((a.region_plan,a.region_digest,a.source,a.source_sha256)):
                p.error('--region-plan, --region-digest, --source and --source-sha256 required')
            from .background_region import apply as apply_region
            result=apply_region(a.region_plan,a.region_digest,a.source,a.source_sha256,a.output)
            print(json.dumps(result,ensure_ascii=False,indent=2));return
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
            result=freeze_reviewed(a.planning_run,a.output,a.max_calls,a.regroup_generation_mode,
                                   a.generation_reference,a.context_prompt_version)
            print(json.dumps(result,ensure_ascii=False,indent=2));return
        if a.action=='preview-groups':
            if not a.snapshot or not a.snapshot_digest:p.error('--snapshot and --snapshot-digest required')
            from .generation_groups import preview as preview_groups
            result=preview_groups(a.snapshot,a.snapshot_digest,a.output)
            print(json.dumps(result,ensure_ascii=False,indent=2));return
        if a.action == 'run':
            if not a.image: p.error('--image required')
            init(a.image,a.output,a.viewer,a.target,a.max_calls,a.generation_mode,a.planning_notes,a.generation_reference or planning.DEFAULT_GENERATION_REFERENCE,a.visual_policy,
                 a.context_prompt_version,a.registration_policy or body.POLICY,
                 a.max_body_calls if a.max_body_calls is not None else body.DEFAULT_MAX_CALLS,
                 planning_model=a.planning_model if a.planning_model is not None else planning.CLI_MODEL,
                 planning_effort=a.planning_effort if a.planning_effort is not None else planning.CLI_EFFORT,
                 planning_timeout=a.planning_timeout if a.planning_timeout is not None else 900,
                 **({'visual_textures':a.visual_textures} if a.visual_textures is not None else {}))
        if a.planning_notes and a.action!='run':p.error('--planning-notes is only valid for a new run')
        if a.generation_reference is not None and a.action!='run':p.error('--generation-reference is only valid for a new run or freeze-reviewed')
        dag = DeliveryDag(a.output); dag.verify(); job = dag.root/'generation'
        if a.action in ('run','resume'):
            with redirect_stdout(sys.stderr): result = dag.execute()
        elif a.action == 'status': result = dag.status()
        else:
            with planning.locked(dag.root):
                dag.verify()
                required = {'authorize':['job_digest','approval'], 'authorize-body':['job_digest','approval'], 'next':[],
                            'receive':['submission_digest','source'], 'fail':['submission_digest','reason']}[a.action]
                if any(not getattr(a,k) for k in required): p.error('missing exchange arguments')
                if a.action == 'authorize': result = exchange.authorize(job,a.job_digest,a.approval)
                elif a.action == 'authorize-body': result = body.authorize(dag.root/'body-observation',a.job_digest,a.approval)
                elif a.action == 'next': result = exchange.next_request(job)
                elif a.action == 'receive': result = exchange.receive(job,a.submission_digest,a.source)
                else: result = exchange.fail(job,a.submission_digest,a.reason)
        print(json.dumps(result,ensure_ascii=False,indent=2))
    except Exception as exc:
        result=dict(status='stopped',reason=str(exc),automaticRetry=False)
        if isinstance(exc,TransportFailure):result['failureDetails']=exc.details
        print(json.dumps(result,ensure_ascii=False))
        raise SystemExit(1)


if __name__ == '__main__': main()
