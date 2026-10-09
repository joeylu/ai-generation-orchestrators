"""Read-only partial replay of genuine host observations for a diagnostic export.

This never receives, finishes or resumes a source job. Missing observations remain
missing, and diagnostic exports cannot claim a complete automatic run.
"""
from pathlib import Path

from jsonschema import Draft202012Validator

from . import host_body_observation as host, body_observation as body
from . import body_registration as registration, body_coverage
from .body_viewport_delivery import validate_contract
from .evaluate import read, digest
from .host_material_review import files
from .visual_policy import snapshot_policy, warnings_only


def checked_replay(checked, body_job):
    job, config, snapshot, manifest, rows, visual, reuse, background, bindings = checked
    body_job = Path(body_job).resolve()
    before = files(body_job)
    frozen = host.load(body_job)
    if (frozen['snapshotDigest'] != manifest['digest'] or
            frozen['referenceSha256'] != digest(snapshot/'reference.png') or reuse is not None or
            any(row.get('kind') == 'sheet' for row in rows)):
        raise ValueError('DIAGNOSTIC_BODY_SINGLETON_SOURCE_SCOPE_REQUIRED')
    original = {b['requestId']:b['rawSha256'] for b in bindings}
    if frozen['sourceHashes'] != original:
        raise ValueError('DIAGNOSTIC_BODY_SOURCE_MISMATCH')
    policy = snapshot_policy(snapshot, manifest)
    results = []
    for mid, (submission, seal) in sorted(host._attempts(body_job, frozen).items()):
        if seal is None:
            raise ValueError('DIAGNOSTIC_BODY_UNSEALED_RETURN')
        # Only the specific coverage disposition changed by v5 is replayable
        # from a blocked attempt. Technical or unknown failures stay excluded.
        if seal['status'] != 'sealed' and not (
                seal['status'] == 'blocked_no_retry' and
                seal['reason'] == 'SOURCE_BODY_OMITS_SOLID_ARTWORK' and warnings_only(policy)):
            raise ValueError('DIAGNOSTIC_BODY_RETURN_NOT_REPLAYABLE')
        folder = body_job/'attempts'/mid
        host._attestation(folder, submission)
        answer = read(folder/'response.json')
        Draft202012Validator(read(body_job/'requests'/mid/'schema.json')).validate(answer)
        if answer['boundaryStatus'] != 'complete' or answer['issues']:
            raise ValueError('DIAGNOSTIC_BODY_UNRESOLVED')
        mapping = read(body_job/'requests'/mid/'mapping.json')
        source_box = body.original_source_box(answer['sourceBodyBox'], mapping['source'])
        local = registration._box(answer['referenceCropBodyBox'], mapping['referenceCropSize'])
        region = frozen['requests'][mid]['sourceRegion']
        target = [v+region[i % 2] for i,v in enumerate(local)]
        observation = read(folder/'observation.json')
        contract_path = folder/'body-contract.json'
        contract = read(contract_path)
        if (observation['sourceBodyBox'] != source_box or observation['targetBodyBox'] != target or
                contract['evidence']['basis'] != answer['evidence'] or
                Path(contract['evidence']['path']).resolve() != (folder/'observation.json').resolve() or
                observation.get(body_coverage.FIELD) != answer.get(body_coverage.FIELD)):
            raise ValueError('DIAGNOSTIC_BODY_RAW_CONVERSION_CHANGED')
        raw = job/'attempts'/mid/'raw.png'
        validated = validate_contract(raw, snapshot/'reference.png',
            dict(path=str(contract_path), sha256=digest(contract_path)), region, mid, manifest['digest'],
            visual_policy=policy, fit_policy=frozen.get('bodyFitPolicy'),
            coverage_policy=frozen.get('bodyCoveragePolicy'))
        results.append(dict(materialId=mid, sourceSha256=digest(raw),
            responseSha256=digest(folder/'response.json'), bodyContractSha256=digest(contract_path),
            observationSha256=digest(folder/'observation.json'), submissionDigest=submission['digest'],
            originalSealStatus=seal['status'], originalSealReason=seal.get('reason',''),
            originalSealSha256=digest(folder/'seal.json'), geometry=validated['geometry']))
    if not results:
        raise ValueError('DIAGNOSTIC_BODY_GENUINE_OBSERVATION_REQUIRED')
    if files(body_job) != before:
        raise ValueError('DIAGNOSTIC_BODY_INPUT_CHANGED')
    return dict(bodyJob=str(body_job), bodyJobDigest=frozen['digest'], bodyJobFiles=before,
        replayedObservations=results, missingMaterialIds=sorted(set(frozen['requests'])-{
            row['materialId'] for row in results}), originalDagPromoted=False, modelCalls=0,
        basis='Original host returns, schemas, attestations and coordinate mappings revalidated read-only.')


def portable(replay):
    return {k:v for k,v in replay.items() if k not in ('bodyJob','bodyJobFiles')}
