"""Explicit bounded curl recovery; cached configs and complete SHA remain authoritative."""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import shutil
import subprocess
import sys
import time

spec = importlib.util.spec_from_file_location('scene_resume_common', Path(__file__).with_name('model_resume.py'))
resume = importlib.util.module_from_spec(spec); spec.loader.exec_module(resume)
setup = resume.setup
require, seal, canonical = setup.require, setup.seal, setup.canonical


def validate(plan):
    resume.unseal(plan)
    v2 = plan.get('format') == 'ai_scene_bounded_model_recovery_plan_v2'
    transport_key = 'transport' if v2 else 'curlSha256'
    require(set(plan) == {'format', 'recoveryId', 'repository', 'revision', 'files', 'prefix', 'cacheSha256', transport_key,
                         'policy', 'destination', 'scope', 'packageInstall', 'inference', 'notes', 'sha256'}, 'recovery_plan_fields')
    require(plan['format'] in ['ai_scene_bounded_model_recovery_plan_v1', 'ai_scene_bounded_model_recovery_plan_v2'] and plan['repository'] == setup.REPOSITORY
            and plan['revision'] == setup.REVISION and plan['files'] == setup.ARTIFACTS
            and plan['destination'] == '.ai-frame-animation/tools/scene-sam2'
            and plan['scope'] == ('bounded-urllib-ranges-and-verified-cached-configs' if v2 else 'bounded-curl-tail-and-verified-cached-configs') and plan['inference'] is False
            and plan['packageInstall'] is False and isinstance(plan['recoveryId'], str)
            and re.fullmatch(r'[a-z0-9]+(?:[._-][a-z0-9]+)*', plan['recoveryId'])
            and isinstance(plan['notes'], str) and len(plan['notes']) <= 2000, 'recovery_scope')
    p = plan['prefix']
    require(set(p) == {'parentPlanSha256', 'failureSha256', 'byteLength', 'sha256'}
            and all(isinstance(p[k], str) and re.fullmatch('[a-f0-9]{64}', p[k]) for k in ['parentPlanSha256', 'failureSha256', 'sha256'])
            and type(p['byteLength']) is int and 0 < p['byteLength'] < plan['files'][0]['byteLength'], 'recovery_prefix')
    require(isinstance(plan['cacheSha256'], str) and re.fullmatch('[a-f0-9]{64}', plan['cacheSha256']), 'recovery_input_digests')
    if v2:
        transport = plan['transport']
        require(set(transport) == {'profile', 'pythonSha256', 'fetcherSha256'}
                and transport['profile'] == 'stdlib-urllib-system-settings-locked-https'
                and all(isinstance(transport[k], str) and re.fullmatch('[a-f0-9]{64}', transport[k])
                        for k in ['pythonSha256', 'fetcherSha256']), 'recovery_transport')
    else:
        require(isinstance(plan['curlSha256'], str) and re.fullmatch('[a-f0-9]{64}', plan['curlSha256']), 'recovery_input_digests')
    remaining = plan['files'][0]['byteLength'] - p['byteLength']
    expected_policy = {'maximumRequests': 8, 'maximumBodyBytes': remaining * 2, 'maximumSeconds': 300,
            'perRequestSeconds': 60, 'zeroProgressLimit': 2, 'maximumRedirectsPerRequest': 5,
            'continueAfterShortResponse': True, 'fullDownloadFallback': False}
    if v2:
        expected_policy.update(maximumRequests=6, maximumSeconds=180, perRequestSeconds=30, maximumRangeBytes=262144)
    require(plan['policy'] == expected_policy, 'recovery_bounds')


def inputs(workspace, plan, cache, curl):
    workspace = setup.regular(workspace, directory=True)
    parent = workspace / plan['destination'] / plan['prefix']['parentPlanSha256']
    p = json.loads(setup.regular(parent / 'resume-plan.json').read_bytes()); resume.validate(p)
    f = json.loads(setup.regular(parent / 'resume-failure.json').read_bytes()); resume.unseal(f)
    require(p['sha256'] == plan['prefix']['parentPlanSha256'] and f['sha256'] == plan['prefix']['failureSha256']
            and f['planSha256'] == p['sha256'] and f['status'] == 'stopped-no-automatic-retry', 'recovery_parent')
    prefix = setup.regular(parent / 'model.safetensors.part')
    require(resume.fingerprint(prefix) == (plan['prefix']['byteLength'], plan['prefix']['sha256']), 'recovery_prefix_changed')
    cache = setup.regular(cache); require(cache.stat().st_size <= 2097152, 'recovery_cache_size')
    raw = cache.read_bytes(); require(setup.sha(raw) == plan['cacheSha256'], 'recovery_cache_identity')
    metadata = json.loads(raw); resume.unseal(metadata)
    require(metadata.get('repository') == setup.REPOSITORY and metadata.get('revision') == setup.REVISION, 'recovery_cache_source')
    configs = []
    for expected in plan['files'][1:]:
        rows = [f for f in metadata['files'] if f['name'] == expected['path']]
        require(len(rows) == 1 and isinstance(rows[0]['text'], str), 'recovery_cached_config')
        data = rows[0]['text'].encode('utf-8')
        require(len(data) == expected['byteLength'] and setup.sha(data) == expected['sha256'], 'recovery_cached_config')
        configs.append(data)
    if plan['format'].endswith('_v2'):
        require(curl is None, 'recovery_transport_ambiguous')
        transport = setup.regular(sys.executable)
        require(resume.fingerprint(transport)[1] == plan['transport']['pythonSha256']
                and resume.fingerprint(Path(__file__).with_name('range_fetch.py'))[1] == plan['transport']['fetcherSha256'], 'recovery_python_identity')
    else:
        transport = setup.regular(curl)
        require(resume.fingerprint(transport)[1] == plan['curlSha256'], 'recovery_curl_identity')
    return workspace, prefix, cache, transport, configs


def preflight(workspace, plan, cache, curl):
    validate(plan); workspace, _, _, _, _ = inputs(workspace, plan, cache, curl)
    output = workspace / plan['destination'] / plan['sha256']
    require(not output.exists() and setup.ignored(workspace, output.relative_to(workspace)), 'fresh_ignored_target_required')
    required = sum(f['byteLength'] for f in plan['files']) * 2 + 64 * 1024 * 1024
    require(shutil.disk_usage(workspace).free >= required, 'recovery_space_required')
    return {'format': 'ai_scene_bounded_model_recovery_preflight_v1', 'planSha256': plan['sha256'],
            'readyForExplicitRecoveryAuthorization': True, 'prefixBytes': plan['prefix']['byteLength'],
            'expectedNewBodyBytes': plan['files'][0]['byteLength'] - plan['prefix']['byteLength'],
            'cachedConfigBytes': sum(f['byteLength'] for f in plan['files'][1:]), 'policy': plan['policy'],
            'networkRequests': 0, 'modelLoads': 0, 'inferenceCalls': 0}


def curl_request(curl, url, start, end, output, seconds, remaining_budget, runner):
    args = [str(curl), '--disable', '--silent', '--show-error', '--fail', '--location', '--max-redirs', '5',
            '--proto', '=https', '--proto-redir', '=https', '--connect-timeout', '15', '--max-time', str(seconds),
            '--max-filesize', str(min(end - start + 1, remaining_budget)), '--header', 'Accept-Encoding: identity',
            '--range', f'{start}-{end}', '--output', str(output), '--write-out', '{"metrics":%{json},"headers":%{header_json}}', url]
    try:
        result = runner(args, capture_output=True, timeout=seconds + 2)
        telemetry = json.loads(result.stdout) if result.stdout else {'metrics': {}, 'headers': {}}
        metrics, headers = telemetry['metrics'], telemetry['headers']
        ranges = headers.get('content-range', [])
        require(isinstance(ranges, list) and len(ranges) <= 1, 'recovery_ambiguous_range')
        # Only selected non-sensitive fields leave this function. Signed redirect URLs and stderr are discarded.
        return {'curlCode': result.returncode, 'httpStatus': int(metrics.get('http_code', metrics.get('response_code', 0))),
                'contentRange': ranges[0] if ranges else None, 'reportedBytes': int(metrics.get('size_download', 0))}
    except subprocess.TimeoutExpired:
        return {'curlCode': 28, 'httpStatus': 0, 'contentRange': None, 'reportedBytes': output.stat().st_size if output.exists() else 0}


def urllib_request(python, directory, number, seconds, runner):
    code = 28
    try:
        result = runner([str(python), '-B', str(Path(__file__).with_name('range_fetch.py')),
                         '--output-dir', str(directory), '--request-number', str(number), '--timeout', str(seconds)],
                        capture_output=True, timeout=seconds)
        code = result.returncode
    except subprocess.TimeoutExpired:
        pass  # subprocess.run kills and waits; retain only already written response bytes.
    metadata = directory / f'request-{number:02d}-response.json'
    info = {'httpStatus': 0, 'contentRange': None}
    if metadata.exists():
        info = json.loads(setup.regular(metadata).read_bytes()); resume.unseal(info)
        require(set(info) == {'format', 'planSha256', 'requestNumber', 'httpStatus', 'contentRange', 'sha256'}
                and info['format'] == 'ai_scene_range_response_v1'
                and info['planSha256'] == directory.name and info['requestNumber'] == number, 'recovery_response_identity')
    fragment = directory / f'fragment-{number:02d}.part'
    return {'curlCode': code, 'httpStatus': info['httpStatus'], 'contentRange': info['contentRange'],
            'reportedBytes': setup.regular(fragment).stat().st_size if fragment.exists() else 0}


def install(workspace, plan, decision, cache, curl, runner=subprocess.run):
    validate(plan)
    require(isinstance(decision, dict) and set(decision) == {'decisionId', 'decision', 'targetSha256', 'notes'}
            and decision['decision'] == 'approve-bounded-recovery' and decision['targetSha256'] == plan['sha256']
            and isinstance(decision['decisionId'], str) and re.fullmatch(r'[a-z0-9]+(?:[._-][a-z0-9]+)*', decision['decisionId'])
            and isinstance(decision['notes'], str), 'explicit_bounded_recovery_authorization_required')
    preflight(workspace, plan, cache, curl)
    workspace, prefix, cache, curl, configs = inputs(workspace, plan, cache, curl)
    base = setup.regular(workspace / plan['destination'], directory=True); output = base / plan['sha256']; output.mkdir()
    def write_json(name, value):
        with (output / name).open('xb') as stream:
            stream.write(canonical(value) + b'\n')
    write_json('recovery-plan.json', plan); write_json('recovery-authorization.json', decision)
    phase, events, consumed, artifacts, requests = 'prefix-copy', [], 0, [], 0
    try:
        part = output / 'model.safetensors.part'
        with prefix.open('rb') as source, part.open('xb') as sink:
            copied = 0
            for block in iter(lambda: source.read(65536), b''):
                copied += len(block); require(copied <= plan['prefix']['byteLength'], 'recovery_prefix_changed'); sink.write(block)
        require(resume.fingerprint(part) == (plan['prefix']['byteLength'], plan['prefix']['sha256']), 'recovery_prefix_changed')
        offset, total, no_progress = plan['prefix']['byteLength'], plan['files'][0]['byteLength'], 0
        policy = plan['policy']; deadline = time.monotonic() + policy['maximumSeconds']
        while offset < total:
            require(requests < policy['maximumRequests'] and time.monotonic() < deadline
                    and consumed < policy['maximumBodyBytes'], 'recovery_budget_exhausted')
            v2 = plan['format'].endswith('_v2')
            phase = 'urllib-range' if v2 else 'curl-range'; requests += 1; fragment = output / f'fragment-{requests:02d}.part'
            end = min(total - 1, offset + policy['maximumRangeBytes'] - 1) if v2 else total - 1
            write_json(f'request-{requests:02d}-started.json', seal({'format': 'ai_scene_model_recovery_request_started_v1',
                       'requestNumber': requests, 'rangeStart': offset, 'rangeEnd': end, 'generationCalls': 0}))
            url = f'https://huggingface.co/{setup.REPOSITORY}/resolve/{setup.REVISION}/model.safetensors'
            seconds = min(policy['perRequestSeconds'], max(1, int(deadline - time.monotonic())))
            info = urllib_request(curl, output, requests, seconds, runner) if v2 else curl_request(
                curl, url, offset, end, fragment, seconds, policy['maximumBodyBytes'] - consumed, runner)
            size = fragment.stat().st_size if fragment.exists() else 0
            consumed += max(size, info['reportedBytes']); require(consumed <= policy['maximumBodyBytes'], 'recovery_body_budget')
            require(info['reportedBytes'] == size and size <= end - offset + 1, 'recovery_body_identity')
            expected = f'bytes {offset}-{end}/{total}'
            valid_range = info['httpStatus'] == 206 and info['contentRange'] == expected
            event = seal({'format': 'ai_scene_model_recovery_request_v2' if v2 else 'ai_scene_model_recovery_request_v1', 'requestNumber': requests,
                          'rangeStart': offset, 'rangeEnd': end, ('transportExitCode' if v2 else 'curlCode'): info['curlCode'], 'httpStatus': info['httpStatus'],
                          'receivedBytes': size, 'validRange': valid_range,
                          'status': 'complete-response' if valid_range and size == end - offset + 1 and info['curlCode'] == 0 else 'incomplete-response'})
            events.append(event); write_json(f'request-{requests:02d}.json', event)
            if not valid_range:
                require(size == 0 and (info['httpStatus'] in [0, 408, 425, 429, 500, 502, 503, 504]), 'recovery_range_response_required')
            require(info['curlCode'] in [0, 6, 7, 18, 28, 35, 55, 56] or info['httpStatus'] in [408, 425, 429, 500, 502, 503, 504],
                    'recovery_transport_stopped' if v2 else 'recovery_curl_stopped')
            if valid_range and size:
                with fragment.open('rb') as source, part.open('ab') as sink:
                    shutil.copyfileobj(source, sink, 65536)
                offset += size; no_progress = 0
            else:
                no_progress += 1; require(no_progress < policy['zeroProgressLimit'], 'recovery_no_progress')
        phase = 'whole-model-verify'
        require(resume.fingerprint(part) == (total, plan['files'][0]['sha256']), 'recovery_whole_identity')
        part.rename(output / plan['files'][0]['path']); artifacts.append(plan['files'][0])
        for expected, data in zip(plan['files'][1:], configs):
            phase = 'cached-config-verify'
            require(len(data) == expected['byteLength'] and setup.sha(data) == expected['sha256'], 'recovery_cached_config')
            with (output / expected['path']).open('xb') as stream:
                stream.write(data)
            require(resume.fingerprint(output / expected['path']) == (expected['byteLength'], expected['sha256']), 'recovery_cached_config')
            artifacts.append(expected)
        require(resume.fingerprint(prefix) == (plan['prefix']['byteLength'], plan['prefix']['sha256'])
                and resume.fingerprint(cache)[1] == plan['cacheSha256'], 'recovery_source_changed')
        result = seal({'format': 'ai_scene_bounded_model_recovery_result_v2' if plan['format'].endswith('_v2') else 'ai_scene_bounded_model_recovery_result_v1', 'planSha256': plan['sha256'], 'status': 'all-four-files-verified',
                       'artifacts': artifacts, 'requests': requests, 'receivedBodyBytes': consumed, 'cachedConfigBytes': sum(len(b) for b in configs),
                       'originalPrefixPreserved': True, 'previousFailuresPreserved': True, 'packageInstalls': 0,
                       'modelLoads': 0, 'inferenceCalls': 0, 'generationCalls': 0})
        write_json('recovery-result.json', result); return result
    except Exception as error:
        code = str(error) if isinstance(error, ValueError) and re.fullmatch('[a-z0-9_]+', str(error)) else 'recovery_operation_failed'
        retained = sum(setup.regular(p).stat().st_size for p in output.glob('fragment-*.part'))
        write_json('recovery-failure.json', seal({'format': 'ai_scene_bounded_model_recovery_failure_v2' if plan['format'].endswith('_v2') else 'ai_scene_bounded_model_recovery_failure_v1', 'planSha256': plan['sha256'],
                   'status': 'stopped-within-budget', 'phase': phase, 'error': code, 'requests': requests, 'receivedBodyBytes': retained,
                   'verifiedArtifacts': artifacts, 'modelLoads': 0, 'inferenceCalls': 0, 'generationCalls': 0}))
        raise ValueError(code) from None


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['preflight', 'install']); parser.add_argument('--workspace', required=True)
    parser.add_argument('--plan', required=True); parser.add_argument('--decision'); parser.add_argument('--cache', required=True); parser.add_argument('--curl')
    args = parser.parse_args()
    try:
        plan = json.loads(setup.regular(args.plan).read_bytes())
        if args.command == 'preflight':
            require(args.decision is None, 'preflight_has_no_authorization'); result = preflight(args.workspace, plan, args.cache, args.curl)
        else:
            require(args.decision is not None, 'explicit_bounded_recovery_authorization_required')
            result = install(args.workspace, plan, json.loads(setup.regular(args.decision).read_bytes()), args.cache, args.curl)
        print(json.dumps(result))
    except Exception as error:
        print(json.dumps({'status': 'stopped', 'error': str(error) if isinstance(error, ValueError) else 'recovery_operation_failed', 'generationCalls': 0}))
        raise SystemExit(1)
