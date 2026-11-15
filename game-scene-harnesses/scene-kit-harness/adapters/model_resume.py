"""One approved byte-range recovery from an immutable partial. No inference."""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import shutil
import urllib.request

spec = importlib.util.spec_from_file_location('scene_shared_model_setup', Path(__file__).with_name('model_setup.py'))
setup = importlib.util.module_from_spec(spec); spec.loader.exec_module(setup)
require, seal, canonical = setup.require, setup.seal, setup.canonical


def unseal(value):
    body = {k: v for k, v in value.items() if k != 'sha256'}
    require(value.get('sha256') == setup.sha(canonical(body)), 'resume_record_integrity')
    return body


def fingerprint(path):
    path = setup.regular(path); size, digest = 0, hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(65536), b''):
            size += len(block); digest.update(block)
    return size, digest.hexdigest()


def validate(plan):
    unseal(plan)
    require(set(plan) == {'format', 'setupId', 'repository', 'revision', 'files', 'downloadBytes', 'completeBytes', 'prefix',
                         'destination', 'scope', 'packageInstall', 'inference', 'notes', 'sha256'}, 'resume_plan_fields')
    require(plan['format'] == 'ai_scene_local_model_resume_plan_v1' and plan['repository'] == setup.REPOSITORY
            and plan['revision'] == setup.REVISION and plan['files'] == setup.ARTIFACTS
            and plan['destination'] == '.ai-frame-animation/tools/scene-sam2'
            and plan['scope'] == 'copy-frozen-prefix-one-range-and-locked-configs' and plan['packageInstall'] is False
            and plan['inference'] is False and isinstance(plan['setupId'], str)
            and re.fullmatch(r'[a-z0-9]+(?:[._-][a-z0-9]+)*', plan['setupId'])
            and isinstance(plan['notes'], str) and len(plan['notes']) <= 2000, 'resume_catalog_or_scope')
    prefix = plan['prefix']
    require(set(prefix) == {'parentPlanSha256', 'failureSha256', 'byteLength', 'sha256'}
            and all(isinstance(prefix[k], str) and re.fullmatch('[a-f0-9]{64}', prefix[k]) for k in ['parentPlanSha256', 'failureSha256', 'sha256'])
            and type(prefix['byteLength']) is int and 0 < prefix['byteLength'] < setup.ARTIFACTS[0]['byteLength'], 'resume_prefix_binding')
    require(plan['completeBytes'] == sum(a['byteLength'] for a in setup.ARTIFACTS)
            and plan['downloadBytes'] == plan['completeBytes'] - prefix['byteLength'], 'resume_byte_budget')


def source_prefix(workspace, plan):
    root = workspace / plan['destination'] / plan['prefix']['parentPlanSha256']
    parent = json.loads(setup.regular(root / 'setup-plan.json').read_bytes()); setup.validate(parent)
    require(parent['sha256'] == plan['prefix']['parentPlanSha256'], 'resume_parent_plan')
    failure = json.loads(setup.regular(root / 'setup-failure.json').read_bytes()); unseal(failure)
    require(failure['sha256'] == plan['prefix']['failureSha256'] and failure['planSha256'] == parent['sha256']
            and failure['status'] == 'stopped-no-automatic-retry', 'resume_parent_failure')
    return setup.regular(root / 'model.safetensors.part')


def preflight(workspace, plan):
    validate(plan); workspace = setup.regular(workspace, directory=True)
    prefix = source_prefix(workspace, plan)
    require(fingerprint(prefix) == (plan['prefix']['byteLength'], plan['prefix']['sha256']), 'resume_prefix_changed')
    target = workspace / plan['destination'] / plan['sha256']
    require(not target.exists() and setup.ignored(workspace, target.relative_to(workspace)), 'fresh_ignored_target_required')
    required = plan['completeBytes'] * 2 + 64 * 1024 * 1024
    require(shutil.disk_usage(workspace).free >= required, 'resume_space_required')
    return {'format': 'ai_scene_local_model_resume_preflight_v1', 'planSha256': plan['sha256'], 'readyForExplicitResumeAuthorization': True,
            'prefixBytes': plan['prefix']['byteLength'], 'downloadBytes': plan['downloadBytes'], 'maximumArtifactRequests': len(plan['files']),
            'rangeStart': plan['prefix']['byteLength'], 'rangeEnd': plan['files'][0]['byteLength'] - 1,
            'minimumFreeBytes': required, 'networkRequests': 0, 'modelLoads': 0, 'inferenceCalls': 0, 'generationCalls': 0}


def download(url, headers):
    return urllib.request.build_opener(setup.PublicRedirect()).open(urllib.request.Request(url, headers=headers), timeout=30)


def install(workspace, plan, decision, opener=download):
    validate(plan)
    require(isinstance(decision, dict) and set(decision) == {'decisionId', 'decision', 'targetSha256', 'notes'}
            and decision['decision'] == 'approve-resume' and decision['targetSha256'] == plan['sha256']
            and isinstance(decision['decisionId'], str) and re.fullmatch(r'[a-z0-9]+(?:[._-][a-z0-9]+)*', decision['decisionId'])
            and isinstance(decision['notes'], str), 'explicit_resume_authorization_required')
    preflight(workspace, plan)
    workspace = Path(workspace).absolute(); prefix = source_prefix(workspace, plan)
    base = setup.regular(workspace / plan['destination'], directory=True)
    output = base / plan['sha256']; output.mkdir()
    def write_json(name, value):
        with (output / name).open('xb') as stream:
            stream.write(canonical(value) + b'\n')
    write_json('resume-plan.json', plan); write_json('resume-authorization.json', decision)
    phase, artifacts, downloaded, requests = 'prefix-copy', [], 0, 0
    current_file = 'model.safetensors'
    try:
        partial = output / 'model.safetensors.part'; copied, digest = 0, hashlib.sha256()
        with prefix.open('rb') as source, partial.open('xb') as sink:
            for block in iter(lambda: source.read(65536), b''):
                copied += len(block); require(copied <= plan['prefix']['byteLength'], 'resume_prefix_changed')
                digest.update(block); sink.write(block)
        require((copied, digest.hexdigest()) == (plan['prefix']['byteLength'], plan['prefix']['sha256']), 'resume_prefix_changed')
        first = plan['files'][0]; total = first['byteLength']; tail = total - copied
        url = f'https://huggingface.co/{setup.REPOSITORY}/resolve/{setup.REVISION}/{first["path"]}'
        phase = 'range-open'; requests += 1
        with opener(url, {'Range': f'bytes={copied}-{total - 1}', 'Accept-Encoding': 'identity'}) as source:
            phase = 'range-headers'
            require(source.status == 206 and source.headers.get('Content-Range') == f'bytes {copied}-{total - 1}/{total}', 'resume_range_response_required')
            if source.headers.get('Content-Length') is not None:
                require(source.headers.get('Content-Length') == str(tail), 'resume_range_length_header')
            phase = 'range-stream'; received = 0
            with partial.open('ab') as sink:
                for block in iter(lambda: source.read(65536), b''):
                    received += len(block); downloaded += len(block)
                    require(received <= tail, 'resume_range_oversize'); sink.write(block)
            require(received == tail, 'resume_tail_length')
        phase = 'whole-model-verify'
        require(fingerprint(partial) == (total, first['sha256']), 'resume_full_identity')
        partial.rename(output / first['path']); artifacts.append(first)
        for item in plan['files'][1:]:
            current_file = item['path']; phase = 'config-open'; requests += 1
            url = f'https://huggingface.co/{setup.REPOSITORY}/resolve/{setup.REVISION}/{item["path"]}'
            part = output / (item['path'] + '.part'); received = 0
            with opener(url, {'Accept-Encoding': 'identity'}) as source, part.open('xb') as sink:
                require(source.status == 200, 'resume_config_status'); phase = 'config-stream'
                for block in iter(lambda: source.read(65536), b''):
                    received += len(block); downloaded += len(block)
                    require(received <= item['byteLength'], 'resume_config_oversize'); sink.write(block)
            phase = 'config-verify'
            require(fingerprint(part) == (item['byteLength'], item['sha256']), 'resume_config_identity')
            part.rename(output / item['path']); artifacts.append(item)
        require(downloaded == plan['downloadBytes'], 'resume_transfer_budget')
        require(fingerprint(prefix) == (plan['prefix']['byteLength'], plan['prefix']['sha256']), 'resume_original_prefix_changed')
        result = seal({'format': 'ai_scene_local_model_resume_result_v1', 'planSha256': plan['sha256'], 'status': 'all-four-files-verified',
                       'artifacts': artifacts, 'copiedPrefixBytes': copied, 'downloadedBytes': downloaded, 'artifactRequests': requests,
                       'originalPrefixPreserved': True, 'packageInstalls': 0, 'modelLoads': 0, 'inferenceCalls': 0, 'generationCalls': 0})
        write_json('resume-result.json', result); return result
    except Exception as error:
        code = str(error) if isinstance(error, ValueError) and re.fullmatch('[a-z0-9_]+', str(error)) else 'resume_transfer_failed'
        write_json('resume-failure.json', seal({'format': 'ai_scene_local_model_resume_failure_v1', 'planSha256': plan['sha256'],
                   'status': 'stopped-no-automatic-retry', 'verifiedArtifacts': artifacts, 'downloadedBytes': downloaded,
                   'artifactRequests': requests, 'error': code, 'phase': phase, 'currentFile': current_file,
                   'errorType': type(error).__name__, 'httpStatus': getattr(error, 'code', None), 'generationCalls': 0}))
        raise ValueError(code) from None


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['preflight', 'install']); parser.add_argument('--workspace', required=True)
    parser.add_argument('--plan', required=True); parser.add_argument('--decision')
    args = parser.parse_args()
    try:
        plan = json.loads(setup.regular(args.plan).read_bytes())
        if args.command == 'preflight':
            require(args.decision is None, 'preflight_has_no_authorization'); result = preflight(args.workspace, plan)
        else:
            require(args.decision is not None, 'explicit_resume_authorization_required')
            result = install(args.workspace, plan, json.loads(setup.regular(args.decision).read_bytes()))
        print(json.dumps(result))
    except Exception as error:
        print(json.dumps({'status': 'stopped', 'error': str(error) if isinstance(error, ValueError) else 'resume_operation_failed', 'generationCalls': 0}))
        raise SystemExit(1)
