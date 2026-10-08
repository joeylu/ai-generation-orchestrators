"""Serial offline host exchange for independently observed whole-body anchors.

The host supplies original responses and provenance evidence. Hash checks bind
that assertion; they are not cryptographic proof of platform execution. This
module never invokes a model, generates artwork, or retries a reserved call.
"""
from pathlib import Path
import json
import hashlib
import secrets
import time

from PIL import Image
from jsonschema import Draft202012Validator

from . import body_observation as body
from . import body_registration as registration
from . import host_body_profile as profile
from . import body_coverage
from .automatic_registration import observation_image
from .evaluate import read, save, digest
from .experimental_executor import record, verified, lock
from .freeze_visual import inspect, body_digest
from .host_review import _identity

KIND = 'ui_host_body_observation_job_v1'
FILES = (*body.FILES, 'source-original.png')
ANSWER_FILES = ('response.json', 'host-attestation.json', 'dispatch.bin', 'return.bin')
EXPANDED_POLICY = 'expanded-support-original-viewport-v1'


def _authors(config, key):
    authors = config.get('materialAuthors')
    if isinstance(authors, dict):
        authors = authors.get(key)
    if not isinstance(authors, list) or not authors or len(set(authors)) != len(authors):
        raise ValueError('HOST_MATERIAL_AUTHORS_REQUIRED')
    for value in authors:
        _identity(value)
    return authors


def prepare(config_path, output, maximum, model='gpt-6.1-sol', effort='medium', canvas_policy=None):
    """Freeze exact attachments, requested model/budget and author identities."""
    config_path, output = Path(config_path).resolve(), Path(output).resolve()
    config = read(config_path)
    observation_policy = profile.validate(config.get('bodyObservationPolicy', profile.LEGACY))
    snapshot = Path(config['snapshot']).resolve()
    inspect(snapshot, config['snapshotDigest'])
    from .visual_policy import snapshot_policy
    fit_policy = registration.validate_fit_policy(config.get('bodyFitPolicy'), snapshot_policy(snapshot))
    coverage_policy = config.get('bodyCoveragePolicy')
    profile.validate_binding(observation_policy, fit_policy, coverage_policy)
    visual, ids = body.foreground(snapshot)
    body.validate_budget(snapshot, maximum)
    if set(config['materials']) != {m['id'] for m in visual['materials']}:
        raise ValueError('COMPLETE_BODY_MATERIAL_SET_REQUIRED')
    if not isinstance(model, str) or not model.strip() or effort not in ('low', 'medium', 'high', 'xhigh', 'max', 'ultra'):
        raise ValueError('EXACT_HOST_MODEL_EFFORT_REQUIRED')
    if canvas_policy is not None and 'canvasPolicy' in config and canvas_policy != config['canvasPolicy']:
        raise ValueError('BODY_CANVAS_POLICY_OVERRIDE_CONFLICT')
    canvas_policy = config.get('canvasPolicy', body.CANVAS_POLICY) if canvas_policy is None else canvas_policy
    if canvas_policy not in (body.CANVAS_POLICY, EXPANDED_POLICY):
        raise ValueError('EXPLICIT_CANVAS_POLICY_REQUIRED')
    canvas_fields = {}
    if canvas_policy == EXPANDED_POLICY:
        instruction = config.get('canvasPolicyInstruction')
        if (not isinstance(instruction, str) or not instruction.strip() or
                config.get('canvasPolicyInstructionSha256') != hashlib.sha256(instruction.encode('utf-8')).hexdigest()):
            raise ValueError('BOUND_CANVAS_POLICY_INSTRUCTION_REQUIRED')
        canvas_fields = dict(canvasPolicyInstruction=instruction, canvasPolicyInstructionSha256=config['canvasPolicyInstructionSha256'])
    paths = {k: str(Path(v).resolve()) for k, v in config['materials'].items()}
    hashes = {k: digest(Path(v)) for k, v in paths.items()}
    authors = {k: _authors(config, k) for k in ids}
    reference = snapshot / 'reference.png'
    placements = {p['id']: p for p in read(snapshot / 'placements.json')['materials']}
    for key in ids:
        if Path(key).name != key or key in ('.', '..'):
            raise ValueError('UNSAFE_MATERIAL_ID')
        with Image.open(paths[key]) as image:
            if image.convert('RGBA').getchannel('A').point(lambda a: 255 if a >= 128 else 0).getbbox() is None:
                raise ValueError('BODY_CORE_NOT_OBSERVABLE:' + key)
    output.mkdir(parents=True, exist_ok=False)
    (output / 'requests').mkdir()
    (output / 'attempts').mkdir()
    (output / 'reference-original.png').write_bytes(reference.read_bytes())
    requests = {}
    for key in ids:
        folder = output / 'requests' / key
        folder.mkdir()
        source = Path(paths[key])
        (folder / 'source-original.png').write_bytes(source.read_bytes())
        region = placements[key]['sourceRegion']
        mapping = dict(reference=observation_image(reference, folder / 'reference.png'),
                       source=observation_image(source, folder / 'generated.png',
                           alpha_visibility=profile.alpha_profile(observation_policy)), referenceCropRegion=region)
        if profile.alpha_profile(observation_policy):
            profile.prepare(folder, mapping)
        with Image.open(reference) as image:
            registration._box(region, image.size)
            crop = image.crop(tuple(region))
            crop.save(folder / 'reference-crop.png')
            mapping['referenceCropSize'] = list(crop.size)
        prompt = ('Observe only this material and its corresponding complete body. Images in order: '
                  'full reference, reference ownership crop, generated transparent material. Return '
                  'sourceBodyBox in generated attachment pixels and referenceCropBodyBox in crop pixels '
                  'as half-open integer boxes. Include all solid artwork, outlines and internal symbols; '
                  'exclude external soft shadows and transparent margins. Never anchor only an inner icon. '
                  'If occluded, incomplete, uncertain or multiple independent anchors cannot correspond, '
                  'return uncertain or not-whole with issues and null boxes. Complete requires empty issues. '
                  'Do not repaint or repair. The deterministic program preserves every nonzero alpha pixel.\n'
                  + json.dumps(dict(material=next(m for m in visual['materials'] if m['id'] == key),
                                    objects=[o for o in visual['objects'] if o['materialId'] == key],
                                    mapping=mapping), ensure_ascii=False))
        if profile.alpha_profile(observation_policy):
            prompt += profile.GUIDANCE + json.dumps(dict(bodyFitPolicy=fit_policy,
                visualPolicy=snapshot_policy(snapshot)), ensure_ascii=False)
        if observation_policy == profile.SOFT_EFFECTS:
            prompt += profile.SOFT_EFFECT_GUIDANCE
        (folder / 'prompt.md').write_text(prompt, encoding='utf-8')
        save(folder / 'schema.json', profile.schema(observation_policy))
        save(folder / 'mapping.json', mapping)
        files = (*FILES, *profile.PREVIEWS) if profile.alpha_profile(observation_policy) else FILES
        requests[key] = dict(inputs={n: digest(folder / n) for n in files}, sourceSha256=hashes[key],
                             sourceRegion=region, materialAuthors=authors[key])
    record(output / 'job.json', dict(kind=KIND, nonce=secrets.token_hex(16), snapshot=str(snapshot),
        snapshotDigest=config['snapshotDigest'], referenceSha256=digest(reference), materials=paths,
        sourceHashes=hashes, requests=requests, maximumCalls=len(ids), configuredMaximumCalls=maximum,
        registrationPolicy=body.POLICY, outputRegistrationPolicy=body.SUPPORT_POLICY, canvasPolicy=canvas_policy,
        model=model, effort=effort, driver='host-model-exchange-v1', automaticRetries=0, generationCalls=0,
        configPath=str(config_path), configSha256=digest(config_path),
        bodyObservationPolicy=observation_policy, bodyFitPolicy=fit_policy,
        **(dict(bodyCoveragePolicy=coverage_policy) if coverage_policy is not None else {}), **canvas_fields))
    return status(output)


def load(job):
    job = Path(job)
    config = verified(job / 'job.json')
    if (config['kind'] != KIND or config['driver'] != 'host-model-exchange-v1' or
            config['automaticRetries'] != 0 or config['generationCalls'] != 0 or
            config['registrationPolicy'] != body.POLICY or config['outputRegistrationPolicy'] != body.SUPPORT_POLICY):
        raise ValueError('HOST_BODY_JOB_POLICY_CHANGED')
    snapshot = Path(config['snapshot'])
    inspect(snapshot, config['snapshotDigest'])
    if digest(Path(config['configPath'])) != config['configSha256']:
        raise ValueError('BODY_CONFIG_CHANGED')
    source_config = read(Path(config['configPath']))
    observation_policy = profile.validate(config.get('bodyObservationPolicy', profile.LEGACY))
    if (observation_policy != source_config.get('bodyObservationPolicy', profile.LEGACY)
            or config.get('bodyFitPolicy') != source_config.get('bodyFitPolicy')
            or config.get('bodyCoveragePolicy') != source_config.get('bodyCoveragePolicy')):
        raise ValueError('BODY_PROFILE_BINDING_CHANGED')
    from .visual_policy import snapshot_policy
    registration.validate_fit_policy(config.get('bodyFitPolicy'), snapshot_policy(snapshot))
    profile.validate_binding(observation_policy, config.get('bodyFitPolicy'), config.get('bodyCoveragePolicy'))
    if (digest(snapshot / 'reference.png') != config['referenceSha256'] or
            digest(job / 'reference-original.png') != config['referenceSha256']):
        raise ValueError('BODY_REFERENCE_CHANGED')
    _, ids = body.foreground(snapshot)
    if set(ids) != set(config['requests']) or len(ids) != config['maximumCalls']:
        raise ValueError('BODY_JOB_SCOPE_CHANGED')
    for key, path in config['materials'].items():
        if digest(Path(path)) != config['sourceHashes'][key]:
            raise ValueError('BODY_SOURCE_CHANGED')
    for key, request in config['requests'].items():
        files = (*FILES, *profile.PREVIEWS) if profile.alpha_profile(observation_policy) else FILES
        if set(request['inputs']) != set(files) or any(
                digest(job / 'requests' / key / n) != sha for n, sha in request['inputs'].items()):
            raise ValueError('BODY_REQUEST_CHANGED')
        if profile.alpha_profile(observation_policy):
            folder = job/'requests'/key
            if digest(folder/'source-original.png') != config['sourceHashes'][key]:
                raise ValueError('BODY_DISPLAY_SOURCE_CHANGED')
            profile.verify(folder, read(folder/'mapping.json'))
            if read(folder/'schema.json') != profile.schema(observation_policy):
                raise ValueError('BODY_PROFILE_SCHEMA_CHANGED')
    return config


def _authorization(job, config):
    if not (job / 'authorization.json').exists():
        return None
    auth = verified(job / 'authorization.json')
    if (auth['jobDigest'] != config['digest'] or auth['maximumCalls'] != config['maximumCalls'] or
            auth['model'] != config['model'] or auth['effort'] != config['effort'] or auth['automaticRetries'] != 0):
        raise ValueError('BODY_AUTHORIZATION_CHANGED')
    return auth


def authorize(job, job_digest, approval):
    job = Path(job)
    with lock(job):
        config = load(job)
        if job_digest != config['digest'] or not isinstance(approval, str) or not approval.strip():
            raise ValueError('EXPLICIT_BOUND_BODY_APPROVAL_REQUIRED')
        if (job / 'authorization.json').exists() or any((job / 'attempts').iterdir()):
            raise ValueError('BODY_AUTHORIZATION_ALREADY_USED')
        return record(job / 'authorization.json', dict(kind='ui_host_body_approval_v1',
            jobDigest=job_digest, maximumCalls=config['maximumCalls'], approval=approval,
            model=config['model'], effort=config['effort'], automaticRetries=0))


def _attempts(job, config):
    result = {}
    auth = _authorization(job, config)
    for folder in (job / 'attempts').iterdir():
        if not folder.is_dir() or folder.name not in config['requests']:
            raise ValueError('BODY_ATTEMPT_SCOPE_CHANGED')
        submission = verified(folder / 'submission.json')
        if (submission['jobDigest'] != config['digest'] or submission['materialId'] != folder.name or
                submission['request'] != config['requests'][folder.name] or
                submission['model'] != config['model'] or submission['effort'] != config['effort'] or
                auth is None or submission['authorizationDigest'] != auth['digest']):
            raise ValueError('BODY_SUBMISSION_CHANGED')
        seal = verified(folder / 'seal.json') if (folder / 'seal.json').exists() else None
        if seal:
            if seal['submissionDigest'] != submission['digest']:
                raise ValueError('BODY_SEAL_BINDING_CHANGED')
            for name, sha in seal['files'].items():
                if Path(name).is_absolute() or '..' in Path(name).parts:
                    raise ValueError('BODY_SEALED_PATH_UNSAFE')
                if digest(folder / name) != sha:
                    raise ValueError('BODY_SEALED_EVIDENCE_CHANGED')
            actual_files = {p.relative_to(folder).as_posix() for p in folder.rglob('*')
                            if p.is_file() and p.name != 'seal.json'}
            if actual_files != set(seal['files']):
                raise ValueError('BODY_SEALED_EVIDENCE_SET_CHANGED')
            if seal['status'] == 'sealed':
                _attestation(folder, submission)
        result[folder.name] = (submission, seal)
    return result


def status(job):
    job = Path(job)
    config = load(job)
    auth = _authorization(job, config)
    attempts = _attempts(job, config)
    current = 'ready' if auth or not config['requests'] else 'awaiting_body_authorization'
    if any(s is None for _, s in attempts.values()):
        current = 'awaiting_host_response'
    if any(s and s['status'] != 'sealed' for _, s in attempts.values()):
        current = 'blocked_no_retry'
    if (job / 'result.json').exists():
        result = verified(job / 'result.json')
        if result['jobDigest'] != config['digest'] or digest(Path(result['outputConfig'])) != result['outputConfigSha256']:
            raise ValueError('BODY_RESULT_CHANGED')
        current = 'completed'
    return dict(status=current, jobDigest=config['digest'], maximumCalls=config['maximumCalls'],
                configuredMaximumCalls=config['configuredMaximumCalls'], assignedCalls=len(attempts),
                sealedCalls=sum(s is not None and s['status'] == 'sealed' for _, s in attempts.values()),
                model=config['model'], effort=config['effort'], canvasPolicy=config['canvasPolicy'],
                generationCalls=0, automaticRetries=0, humanVisualAcceptance=False)


def next_request(job):
    """Reserve exactly one item before the host dispatches an independent call."""
    job = Path(job)
    with lock(job):
        current = status(job)
        if current['status'] != 'ready':
            raise ValueError('BODY_NOT_READY_NO_RESUBMIT')
        config = load(job)
        auth = _authorization(job, config)
        pending = [k for k in config['requests'] if not (job / 'attempts' / k).exists()]
        if not pending:
            return None
        key = pending[0]
        folder = job / 'attempts' / key
        folder.mkdir()
        submission = record(folder / 'submission.json', dict(kind='ui_host_body_submission_v1',
            jobDigest=config['digest'], authorizationDigest=auth['digest'], materialId=key,
            request=config['requests'][key], model=config['model'], effort=config['effort'],
            independentCall=True, reservedAt=time.time(), nonce=secrets.token_hex(16)))
        return dict(submissionDigest=submission['digest'], materialId=key, model=config['model'],
                    effort=config['effort'], requestSha256=digest(folder / 'submission.json'),
                    requestPath=str((folder / 'submission.json').resolve()),
                    inputDirectory=str((job / 'requests' / key).resolve()),
                    inputs=config['requests'][key]['inputs'],
                    attachments=[dict(name=n, path=str((job / 'requests' / key / n).resolve()),
                                      sha256=config['requests'][key]['inputs'][n])
                                 for n in ('reference.png', 'reference-crop.png', 'generated.png',
                                     *(profile.PREVIEWS if profile.alpha_profile(config.get('bodyObservationPolicy')) else ()))],
                    inputsSha256=body_digest(config['requests'][key]['inputs']),
                    materialAuthors=config['requests'][key]['materialAuthors'])


def _reserved(job, submission_digest):
    config = load(job)
    _authorization(job, config)
    matches = [(k, s) for k, (s, seal) in _attempts(job, config).items() if s['digest'] == submission_digest]
    if len(matches) != 1:
        raise ValueError('BOUND_BODY_SUBMISSION_REQUIRED')
    key, submission = matches[0]
    folder = job / 'attempts' / key
    if (folder / 'seal.json').exists() or (folder / 'receive-reservation.json').exists():
        raise ValueError('BODY_RESPONSE_ALREADY_CONSUMED_NO_RETRY')
    return config, key, folder, submission


def _attestation(folder, submission):
    attestation = read(folder / 'host-attestation.json')
    reviewer = _identity(attestation.get('reviewerId'))
    if reviewer in submission['request']['materialAuthors']:
        raise ValueError('INDEPENDENT_BODY_REVIEWER_REQUIRED')
    expected = dict(kind='ui_host_body_attestation_v1', requestSha256=digest(folder / 'submission.json'),
        submissionDigest=submission['digest'], responseSha256=digest(folder / 'response.json'),
        inputsSha256=body_digest(submission['request']['inputs']),
        model=submission['model'], effort=submission['effort'], independentCall=True,
        reviewerId=reviewer, materialAuthors=submission['request']['materialAuthors'],
        hostAssertedModelResponse=True, notProviderReceipt=True, notCryptographicallyPlatformVerified=True,
        dispatchEvidenceSha256=digest(folder / 'dispatch.bin'), returnEvidenceSha256=digest(folder / 'return.bin'))
    if attestation != expected or expected['dispatchEvidenceSha256'] == expected['returnEvidenceSha256']:
        raise ValueError('BODY_HOST_ATTESTATION_BINDING_MISMATCH')
    if not (folder / 'dispatch.bin').stat().st_size or not (folder / 'return.bin').stat().st_size:
        raise ValueError('BODY_HOST_EVIDENCE_EMPTY')
    return expected


def _seal(folder, submission, state, reason=''):
    files = {p.relative_to(folder).as_posix(): digest(p) for p in folder.rglob('*')
             if p.is_file() and p.name != 'seal.json'}
    return record(folder / 'seal.json', dict(kind='ui_host_body_seal_v1', submissionDigest=submission['digest'],
                  status=state, reason=reason, files=files, automaticRetries=0, humanVisualAcceptance=False))


def receive(job, submission_digest, response_path, *, host_attestation_path, dispatch_evidence_path, return_evidence_path):
    """Consume an original host return once, including failed or uncertain returns."""
    job = Path(job)
    with lock(job):
        config, key, folder, submission = _reserved(job, submission_digest)
        record(folder / 'receive-reservation.json', dict(submissionDigest=submission_digest, reservedAt=time.time()))
        try:
            for source, name in zip((response_path, host_attestation_path, dispatch_evidence_path, return_evidence_path), ANSWER_FILES):
                with (folder / name).open('xb') as target:
                    target.write(Path(source).read_bytes())
            _attestation(folder, submission)
            answer = read(folder / 'response.json')
            Draft202012Validator(read(job / 'requests' / key / 'schema.json')).validate(answer)
            if answer['boundaryStatus'] != 'complete' or answer['issues']:
                raise ValueError('BODY_OBSERVATION_UNRESOLVED')
            mapping = read(job / 'requests' / key / 'mapping.json')
            source_box = body.original_source_box(answer['sourceBodyBox'], mapping['source'])
            local = registration._box(answer['referenceCropBodyBox'], mapping['referenceCropSize'])
            region = config['requests'][key]['sourceRegion']
            target = [v + region[i % 2] for i, v in enumerate(local)]
            observation = dict(kind='ui_body_observation_v1', snapshotDigest=config['snapshotDigest'], materialId=key,
                sourceSha256=config['sourceHashes'][key], referenceSha256=config['referenceSha256'],
                sourceBodyBox=source_box, targetBodyBox=target, boundaryStatus='complete', issues=[])
            modern = config.get('bodyCoveragePolicy') == body_coverage.POLICY
            if modern:
                body_coverage.declarations(answer[body_coverage.FIELD])
                observation.update(kind=body_coverage.OBSERVATION_KIND,
                                   **{body_coverage.FIELD: answer[body_coverage.FIELD]})
            save(folder / 'observation.json', observation)
            save(folder / 'body-contract.json', {k: v for k, v in observation.items() if k != 'boundaryStatus'} | dict(
                kind=body_coverage.CONTRACT_KIND if modern else registration.KIND,
                evidence=dict(path=str((folder / 'observation.json').resolve()),
                sha256=digest(folder / 'observation.json'), basis=answer['evidence'])))
            entry = dict(path=str((folder / 'body-contract.json').resolve()), sha256=digest(folder / 'body-contract.json'))
            from .visual_policy import snapshot_policy
            visual_policy = snapshot_policy(Path(config['snapshot']))
            if answer.get('materialIssues') and (visual_policy is None
                    or not all(visual_policy.get(name) == 'record'
                               for name in ('minorColor', 'minorStyle', 'minorGeometry'))):
                raise ValueError('BODY_APPEARANCE_FINDING_REQUIRES_EXPLICIT_TOLERANCE')
            if config['canvasPolicy'] == EXPANDED_POLICY:
                from .body_viewport_delivery import validate_contract
                checked = validate_contract(job / 'requests' / key / 'source-original.png', job / 'reference-original.png',
                    entry, region, key, config['snapshotDigest'], visual_policy=visual_policy,
                    fit_policy=config.get('bodyFitPolicy'), coverage_policy=config.get('bodyCoveragePolicy'))
                save(folder / 'registration-check.json', checked)
            else:
                registration.process(job / 'requests' / key / 'source-original.png', job / 'reference-original.png',
                    entry, region, key, config['snapshotDigest'], folder / 'registration-check', policy=body.SUPPORT_POLICY,
                    visual_policy=visual_policy, fit_policy=config.get('bodyFitPolicy'),
                    coverage_policy=config.get('bodyCoveragePolicy'))
            load(job)
            return _seal(folder, submission, 'sealed')
        except Exception as exc:
            _seal(folder, submission, 'blocked_no_retry', str(exc))
            raise


def fail(job, submission_digest, reason):
    """Mark an indeterminate/failed host dispatch terminal without another call."""
    job = Path(job)
    with lock(job):
        if not isinstance(reason, str) or not reason.strip():
            raise ValueError('BODY_FAILURE_REASON_REQUIRED')
        _, _, folder, submission = _reserved(job, submission_digest)
        return _seal(folder, submission, 'blocked_no_retry', reason)


def finish(job, output):
    job = Path(job)
    output = Path(output).resolve()
    with lock(job):
        current = status(job)
        config = load(job)
        if current['status'] != 'ready' or current['sealedCalls'] != config['maximumCalls']:
            raise ValueError('ALL_GENUINE_BODY_RESPONSES_REQUIRED')
        entries = {key: dict(path=str((job / 'attempts' / key / 'body-contract.json').resolve()),
                           sha256=digest(job / 'attempts' / key / 'body-contract.json')) for key in config['requests']}
        result = dict(read(Path(config['configPath'])), registrationPolicy=body.SUPPORT_POLICY, wholePlacements=entries)
        if profile.alpha_profile(config.get('bodyObservationPolicy')):
            result['bodyObservationWarnings'] = [dict(materialId=key,
                responseSha256=digest(job/'attempts'/key/'response.json'),
                **{name: read(job/'attempts'/key/'response.json')[name]
                   for name in ('geometryDifferences', 'materialIssues')}) for key in config['requests']]
            if config.get('bodyCoveragePolicy') == body_coverage.POLICY:
                for row in result['bodyObservationWarnings']:
                    row[body_coverage.FIELD] = read(job/'attempts'/row['materialId']/'response.json')[body_coverage.FIELD]
        if config['canvasPolicy'] == EXPANDED_POLICY:
            result.update(canvasPolicy=config['canvasPolicy'], canvasPolicyInstruction=config['canvasPolicyInstruction'],
                          canvasPolicyInstructionSha256=config['canvasPolicyInstructionSha256'])
        save(output, result)
        record(job / 'result.json', dict(status='completed', jobDigest=config['digest'], outputConfig=str(output),
            outputConfigSha256=digest(output), modelCalls=len(entries), generationCalls=0, automaticRetries=0,
            responseOrigin='host-attested-model-response', notCryptographicallyPlatformVerified=True,
            humanVisualAcceptance=False))
    return status(job)
