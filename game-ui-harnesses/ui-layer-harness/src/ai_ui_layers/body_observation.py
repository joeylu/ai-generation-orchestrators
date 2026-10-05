"""Bound, single-use body observations for new delivery runs; no implicit retries."""
import json
import math
from pathlib import Path
import shutil
import tempfile
import time

from PIL import Image
from jsonschema import Draft202012Validator

from .automatic_registration import observation_image
from .body_registration import KIND, _box, POLICY_SUPPORT, process as process_body
from .codex_call import command, transport_schema, CLI_MODEL, CLI_EFFORT
from .evaluate import read, save, digest
from .experimental_executor import record, verified, lock
from .freeze_visual import inspect
from .session_review import invoke, resume_command, session_id

POLICY = 'reference-body-auto-v1'
SUPPORT_POLICY = POLICY_SUPPORT
CANVAS_POLICY = 'preserve-alpha-in-reference-v1'
DEFAULT_MAX_CALLS = 12
FILES = ('reference.png', 'reference-crop.png', 'generated.png', 'prompt.md', 'schema.json', 'mapping.json')


def schema():
    rect = {'type': ['array', 'null'], 'items': {'type': 'integer', 'minimum': 0},
            'minItems': 4, 'maxItems': 4}
    return transport_schema({'type': 'object', 'properties': {
        'boundaryStatus': {'type': 'string', 'enum': ['complete', 'uncertain', 'not-whole']},
        'sourceBodyBox': rect, 'referenceCropBodyBox': rect,
        'evidence': {'type': 'string', 'minLength': 1, 'maxLength': 2000},
        'issues': {'type': 'array', 'items': {'type': 'string', 'minLength': 1}, 'maxItems': 32},
    }})


def foreground(snapshot):
    path = snapshot / 'evidence/revised-visual-plan.json'
    visual = read(path if path.exists() else snapshot / 'evidence/m1-draft.json')
    return visual, [m['id'] for m in visual['materials'] if m['role'] == 'foreground']


def validate_budget(snapshot, maximum):
    if type(maximum) is not int or not 1 <= maximum <= 128:
        raise ValueError('BODY_CALL_LIMIT')
    _, ids = foreground(Path(snapshot))
    if len(ids) > maximum:
        raise ValueError('BODY_CALL_BUDGET_EXCEEDED')
    return len(ids)


def prepare(config_path, output, maximum):
    config_path, output = Path(config_path), Path(output)
    config = read(config_path)
    snapshot = Path(config['snapshot']).resolve()
    inspect(snapshot, config['snapshotDigest'])
    visual, ids = foreground(snapshot)
    validate_budget(snapshot, maximum)
    if set(config['materials']) != {m['id'] for m in visual['materials']}:
        raise ValueError('COMPLETE_BODY_MATERIAL_SET_REQUIRED')
    reference = snapshot / 'reference.png'
    material_paths = {k: str(Path(v).resolve()) for k, v in config['materials'].items()}
    source_hashes = {k: digest(Path(v)) for k, v in material_paths.items()}
    placements = {p['id']: p for p in read(snapshot / 'placements.json')['materials']}
    output.mkdir(parents=True, exist_ok=False)
    (output / 'requests').mkdir()
    (output / 'attempts').mkdir()
    requests = {}
    for key in ids:
        folder = output / 'requests' / key
        folder.mkdir()
        mapping = {'reference': observation_image(reference, folder / 'reference.png'),
                   'source': observation_image(Path(material_paths[key]), folder / 'generated.png'),
                   'referenceCropRegion': placements[key]['sourceRegion']}
        with Image.open(reference) as image:
            image.crop(tuple(placements[key]['sourceRegion'])).save(folder / 'reference-crop.png')
        with Image.open(folder / 'reference-crop.png') as crop:
            mapping['referenceCropSize'] = list(crop.size)
        with Image.open(material_paths[key]) as source:
            raw = source.convert('RGBA')
            core = raw.getchannel('A').point(lambda a: 255 if a >= 128 else 0).getbbox()
            if core is None:
                raise ValueError('BODY_CORE_NOT_OBSERVABLE:' + key)
        objects = [o for o in visual['objects'] if o['materialId'] == key]
        prompt = ('只观察本份素材的完整可见主体，不重绘、不修补、不判整体视觉通过。'
                  '附件依次为完整原图、所属原图裁片、生成透明素材。'
                  'sourceBodyBox 使用生成附件像素；referenceCropBodyBox 使用原图裁片像素，都是半开整数框。'
                  '两框须对应同一个完整主体，含实体、描边和所属内部图形，排除透明余量与外部柔影；'
                  '不能只框内部X或图标，也不能把整个裁片当成实测主体。'
                  '生成主体须包含所有实心图形。原图主体被遮挡、边界不明、多个独立锚点无法整体对应时'
                  '填uncertain或not-whole，给issues，不猜框。完整且无问题才填complete和空issues。'
                  '本观察只决定主体对应；程序另行保留全部非零alpha并决定PNG画布，不删除弱透明像素。\n'
                  + json.dumps({'material': next(m for m in visual['materials'] if m['id'] == key),
                                'objects': objects, 'mapping': mapping,
                                'sourceDenseAlphaBoxOriginalPixels': list(core)}, ensure_ascii=False))
        (folder / 'prompt.md').write_text(prompt, encoding='utf-8')
        save(folder / 'schema.json', schema())
        save(folder / 'mapping.json', mapping)
        requests[key] = {'inputs': {n: digest(folder / n) for n in FILES},
                         'sourceSha256': source_hashes[key], 'sourceRegion': placements[key]['sourceRegion']}
    record(output / 'job.json', {'kind': 'ui_body_observation_job_v1',
        'snapshot': str(snapshot), 'snapshotDigest': config['snapshotDigest'],
        'referenceSha256': digest(reference), 'materials': material_paths,
        'sourceHashes': source_hashes, 'requests': requests,
        'maximumCalls': len(ids), 'configuredMaximumCalls': maximum,
        'registrationPolicy': POLICY, 'outputRegistrationPolicy': SUPPORT_POLICY,
        'canvasPolicy': CANVAS_POLICY, 'model': CLI_MODEL, 'effort': CLI_EFFORT,
        'driver': 'codex-cli', 'automaticRetries': 0, 'generationCalls': 0,
        'configPath': str(config_path.resolve()), 'configSha256': digest(config_path),
        'purpose': 'Whole-material source/reference body observation only; one call per foreground; no repair.',
        'stopConditions': ['uncertain receipt', 'invalid output', 'unresolved observation', 'input changed'],
    })
    return status(output)


def load(job):
    job = Path(job)
    config = verified(job / 'job.json')
    if (config['kind'] != 'ui_body_observation_job_v1' or
            config['registrationPolicy'] != POLICY or config['outputRegistrationPolicy'] != SUPPORT_POLICY or
            config['canvasPolicy'] != CANVAS_POLICY or config['automaticRetries'] != 0 or
            (config['model'], config['effort']) != (CLI_MODEL, CLI_EFFORT)):
        raise ValueError('BODY_JOB_POLICY_CHANGED')
    snapshot = Path(config['snapshot'])
    inspect(snapshot, config['snapshotDigest'])
    if digest(Path(config['configPath'])) != config['configSha256']:
        raise ValueError('BODY_CONFIG_CHANGED')
    if digest(snapshot / 'reference.png') != config['referenceSha256']:
        raise ValueError('BODY_REFERENCE_CHANGED')
    for key, path in config['materials'].items():
        if digest(Path(path)) != config['sourceHashes'][key]:
            raise ValueError('BODY_SOURCE_CHANGED')
    _, ids = foreground(snapshot)
    if set(config['requests']) != set(ids) or config['maximumCalls'] != len(ids):
        raise ValueError('BODY_JOB_SCOPE_CHANGED')
    for key, request in config['requests'].items():
        folder = job / 'requests' / key
        if set(request['inputs']) != set(FILES):
            raise ValueError('BODY_REQUEST_INPUT_SET')
        if any(digest(folder / n) != value for n, value in request['inputs'].items()):
            raise ValueError('BODY_REQUEST_CHANGED')
    return config


def authorize(job, job_digest, approval):
    job = Path(job)
    with lock(job):
        config = load(job)
        if config['digest'] != job_digest or not approval.strip():
            raise ValueError('EXPLICIT_BOUND_BODY_APPROVAL_REQUIRED')
        if (job / 'authorization.json').exists() or any((job / 'attempts').iterdir()):
            raise ValueError('BODY_AUTHORIZATION_ALREADY_USED')
        return record(job / 'authorization.json', {'kind': 'ui_body_observation_approval_v1',
            'jobDigest': job_digest, 'maximumCalls': config['maximumCalls'],
            'approval': approval, 'automaticRetries': 0})


def status(job):
    job = Path(job)
    config = load(job)
    auth = verified(job / 'authorization.json') if (job / 'authorization.json').exists() else None
    if auth and (auth['jobDigest'] != config['digest'] or auth['maximumCalls'] != config['maximumCalls']):
        raise ValueError('BODY_AUTHORIZATION_CHANGED')
    attempts = list((job / 'attempts').iterdir())
    current = 'ready' if auth or not config['requests'] else 'awaiting_body_authorization'
    if attempts:
        current = 'blocked_no_retry'
    if (job / 'result.json').exists():
        result = verified(job / 'result.json')
        if result['jobDigest'] != config['digest']:
            raise ValueError('BODY_RESULT_BINDING')
        current = result['status']
        if current == 'completed':
            for rel, value in result['outputs'].items():
                if digest(job / rel) != value:
                    raise ValueError('BODY_RESULT_CHANGED')
            if digest(Path(result['outputConfig'])) != result['outputConfigSha256']:
                raise ValueError('BODY_OUTPUT_CONFIG_CHANGED')
    return {'status': current, 'jobDigest': config['digest'],
            'maximumCalls': config['maximumCalls'], 'assignedCalls': len(attempts),
            'registrationPolicy': POLICY, 'canvasPolicy': CANVAS_POLICY,
            'generationCalls': 0, 'automaticRetries': 0, 'humanVisualAcceptance': False}


def live_model(folder, sid, first):
    """New persistent session for this job; subsequent observations use that session."""
    exe = shutil.which('codex')
    if not exe:
        raise ValueError('CODEX_NOT_FOUND')
    with tempfile.TemporaryDirectory(prefix='ui-body-observation-') as cwd:
        if first:
            args = command(exe, folder, Path(cwd), CLI_MODEL, CLI_EFFORT)
            args.remove('--ephemeral')
        else:
            args = resume_command(exe, folder, Path(cwd), sid)
        images = [folder / n for n in ('reference.png', 'reference-crop.png', 'generated.png')]
        args[args.index('--image') + 1] = ','.join(map(str, images))
        return invoke(args, folder, cwd, (folder / 'prompt.md').read_text(encoding='utf-8'))


def original_source_box(value, mapping):
    checked = _box(value, mapping['observationSize'])
    original, observed = mapping['originalSize'], mapping['observationSize']
    mapped = [math.floor(v * original[i % 2] / observed[i % 2]) if i < 2 else
              math.ceil(v * original[i % 2] / observed[i % 2]) for i, v in enumerate(checked)]
    return _box(mapped, original)


def execute(job, output_config, model=None):
    job, output_config = Path(job), Path(output_config)
    with lock(job):
        current = status(job)
        if current['status'] != 'ready' or output_config.exists():
            raise ValueError('BODY_NOT_READY_NO_RESUBMIT')
        config = load(job)
        auth = verified(job / 'authorization.json') if config['requests'] else None
        contracts, sid, outputs = {}, None, {}
        try:
            for key, request in config['requests'].items():
                folder = job / 'attempts' / key
                folder.mkdir()
                record(folder / 'submission.json', {'jobDigest': config['digest'],
                    'authorizationDigest': auth['digest'], 'materialId': key,
                    'request': request, 'reservedAt': time.time()})
                prepared = job / 'requests' / key
                for name in FILES:
                    (folder / name).write_bytes((prepared / name).read_bytes())
                receipt = (model or live_model)(folder, sid, sid is None)
                if receipt is None:
                    receipt = read(folder / 'transport.json')
                elif (folder / 'transport.json').exists():
                    if read(folder / 'transport.json') != receipt:
                        raise ValueError('BODY_RECEIPT_CHANGED')
                else:
                    save(folder / 'transport.json', receipt)
                if (receipt.get('failure') or receipt.get('exitCode') != 0 or
                        not receipt.get('turnCompleted') or receipt.get('unexpectedEvents')):
                    raise ValueError('BODY_TRANSPORT_FAILED')
                if receipt.get('responseSha256') != digest(folder / 'draft.json'):
                    raise ValueError('BODY_RESPONSE_CHANGED')
                observed_sid = session_id(folder / 'events.jsonl')
                if sid is not None and observed_sid != sid:
                    raise ValueError('BODY_SESSION_CHANGED')
                if sid is None:
                    sid = observed_sid
                    save(job / 'session.json', {'sessionId': sid})
                if any(digest(folder / n) != value for n, value in request['inputs'].items()):
                    raise ValueError('BODY_CALL_INPUT_CHANGED')
                load(job)
                answer = read(folder / 'draft.json')
                Draft202012Validator(read(folder / 'schema.json')).validate(answer)
                if answer['boundaryStatus'] != 'complete' or answer['issues']:
                    raise ValueError('BODY_OBSERVATION_UNRESOLVED')
                mapping = read(folder / 'mapping.json')
                source_box = original_source_box(answer['sourceBodyBox'], mapping['source'])
                local_target = _box(answer['referenceCropBodyBox'], mapping['referenceCropSize'])
                region = request['sourceRegion']
                target_box = [v + region[i % 2] for i, v in enumerate(local_target)]
                observation = folder / 'observation.json'
                save(observation, {'kind': 'ui_body_observation_v1', 'snapshotDigest': config['snapshotDigest'],
                    'materialId': key, 'sourceSha256': request['sourceSha256'],
                    'referenceSha256': config['referenceSha256'], 'sourceBodyBox': source_box,
                    'targetBodyBox': target_box, 'boundaryStatus': 'complete', 'issues': []})
                contract = folder / 'body-contract.json'
                save(contract, {'kind': KIND, 'snapshotDigest': config['snapshotDigest'],
                    'materialId': key, 'sourceSha256': request['sourceSha256'],
                    'referenceSha256': config['referenceSha256'], 'sourceBodyBox': source_box,
                    'targetBodyBox': target_box, 'issues': [],
                    'evidence': {'path': str(observation.resolve()), 'sha256': digest(observation),
                                 'basis': answer['evidence']}})
                contracts[key] = {'path': str(contract.resolve()), 'sha256': digest(contract)}
                # Reject invalid body/alpha correspondence before spending the next call.
                from .visual_policy import snapshot_policy
                process_body(Path(config['materials'][key]), Path(config['snapshot']) / 'reference.png',
                             contracts[key], region, key, config['snapshotDigest'],
                             folder / 'registration-check', policy=SUPPORT_POLICY,
                             visual_policy=snapshot_policy(Path(config['snapshot'])))
                for name in (*FILES, 'submission.json', 'transport.json', 'draft.json', 'events.jsonl', 'observation.json', 'body-contract.json'):
                    path = folder / name
                    outputs[path.relative_to(job).as_posix()] = digest(path)
                for path in (folder / 'registration-check').iterdir():
                    outputs[path.relative_to(job).as_posix()] = digest(path)
            load(job)
            if contracts:
                outputs['session.json'] = digest(job / 'session.json')
                outputs['authorization.json'] = digest(job / 'authorization.json')
            prepared_config = read(Path(config['configPath']))
            save(output_config, {**prepared_config, 'registrationPolicy': SUPPORT_POLICY,
                                 'wholePlacements': contracts})
            record(job / 'result.json', {'status': 'completed', 'jobDigest': config['digest'],
                'outputs': outputs, 'outputConfig': str(output_config.resolve()),
                'outputConfigSha256': digest(output_config), 'modelCalls': len(contracts),
                'generationCalls': 0, 'automaticRetries': 0, 'humanVisualAcceptance': False})
        except Exception as exc:
            record(job / 'result.json', {'status': 'blocked_no_retry', 'reason': str(exc),
                'jobDigest': config['digest'], 'modelCallsStarted': len(list((job / 'attempts').iterdir())),
                'generationCalls': 0, 'automaticRetries': 0, 'humanVisualAcceptance': False})
            raise
        return status(job)
