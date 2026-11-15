"""Explicit digest-approved download of a fixed public SAM2 data-only catalog."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import shutil
import subprocess
import urllib.parse
import urllib.request

REPOSITORY = 'facebook/sam2.1-hiera-tiny'
REVISION = 'de431c4043854a71d8101e17995dfe596bf101a5'
ARTIFACTS = [
    {'path': 'model.safetensors', 'byteLength': 155908064, 'sha256': '48c14467e5cf9e51870511feb72c89688e82dd74523142c0538b663e193ac2a7'},
    {'path': 'config.json', 'byteLength': 5695, 'sha256': '860aff9751b139d83a4ad7df1e5535416fded533e0ead02625edbefcb9953cce'},
    {'path': 'preprocessor_config.json', 'byteLength': 683, 'sha256': '6ebf229ee259368ce4a8d4f2fe893a72b053023710853e257253939e601f583d'},
    {'path': 'processor_config.json', 'byteLength': 95, 'sha256': 'f8a68e865cfad115c1c2763f3d93eca7b1c622da06da2a9273eb437fb2389b6d'},
]


def require(value, code):
    if not value:
        raise ValueError(code)


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode('utf-8')


def sha(data):
    return hashlib.sha256(data).hexdigest()


def seal(value):
    return {**value, 'sha256': sha(canonical(value))}


def validate(plan):
    require(isinstance(plan, dict) and plan.get('sha256') == sha(canonical({k: v for k, v in plan.items() if k != 'sha256'})), 'setup_plan_integrity')
    require(set(plan) == {'format', 'setupId', 'repository', 'revision', 'files', 'downloadBytes', 'destination', 'scope', 'packageInstall', 'inference', 'notes', 'sha256'}, 'setup_plan_fields')
    require(plan['format'] == 'ai_scene_local_model_setup_plan_v1' and plan['repository'] == REPOSITORY and plan['revision'] == REVISION
            and plan['files'] == ARTIFACTS and plan['downloadBytes'] == sum(a['byteLength'] for a in ARTIFACTS)
            and plan['destination'] == '.ai-frame-animation/tools/scene-sam2'
            and plan['scope'] == 'locked-public-model-files-only' and plan['packageInstall'] is False and plan['inference'] is False
            and isinstance(plan['setupId'], str) and re.fullmatch(r'[a-z0-9]+(?:[._-][a-z0-9]+)*', plan['setupId'])
            and isinstance(plan['notes'], str) and len(plan['notes']) <= 2000, 'setup_catalog_or_scope')


def regular(path, directory=False):
    path = Path(path).absolute()
    require(not str(path).startswith('\\\\'), 'local_path_required')
    for p in [path, *path.parents]:
        require(not p.is_symlink() and not (getattr(p.stat(), 'st_file_attributes', 0) & 1024), 'linked_path_rejected')
    require(path.is_dir() if directory else path.is_file(), 'regular_input_required')
    return path


def ignored(workspace, target):
    return subprocess.run(['git', '-C', str(workspace), 'check-ignore', '-q', '--', target.as_posix()],
                          capture_output=True, check=False).returncode == 0


def preflight(workspace, plan):
    validate(plan); workspace = regular(workspace, directory=True)
    target = workspace / plan['destination'] / plan['sha256']
    require(not target.exists() and ignored(workspace, target.relative_to(workspace)), 'fresh_ignored_target_required')
    required = plan['downloadBytes'] * 2 + 64 * 1024 * 1024
    require(shutil.disk_usage(workspace).free >= required, 'setup_space_required')
    return {'format': 'ai_scene_local_model_setup_preflight_v1', 'planSha256': plan['sha256'], 'readyForExplicitSetupAuthorization': True,
            'downloadBytes': plan['downloadBytes'], 'minimumFreeBytes': required, 'ignoredDestination': True,
            'networkRequests': 0, 'packageInstalls': 0, 'modelLoads': 0, 'inferenceCalls': 0, 'generationCalls': 0}


class PublicRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        url = urllib.parse.urlparse(newurl)
        require(url.scheme == 'https' and not url.username and not url.password
                and (url.hostname == 'huggingface.co' or (url.hostname or '').endswith('.hf.co')), 'setup_redirect_rejected')
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def download(url):
    return urllib.request.build_opener(PublicRedirect()).open(url, timeout=30)


def install(workspace, plan, decision, opener=download):
    validate(plan)
    require(isinstance(decision, dict) and set(decision) == {'decisionId', 'decision', 'targetSha256', 'notes'}
            and decision['decision'] == 'approve-setup' and decision['targetSha256'] == plan['sha256']
            and isinstance(decision['decisionId'], str) and re.fullmatch(r'[a-z0-9]+(?:[._-][a-z0-9]+)*', decision['decisionId'])
            and isinstance(decision['notes'], str), 'explicit_setup_authorization_required')
    preflight(workspace, plan)
    workspace = Path(workspace).absolute(); base = workspace / plan['destination']
    # Check the existing ancestor before creating bounded directories.
    parent = base
    while not parent.exists():
        parent = parent.parent
    regular(parent, directory=True)
    base.mkdir(parents=True, exist_ok=True); regular(base, directory=True)
    output = base / plan['sha256']; output.mkdir()
    def write_json(name, value):
        with (output / name).open('xb') as stream:
            stream.write(canonical(value) + b'\n')
    write_json('setup-plan.json', plan)
    write_json('setup-authorization.json', decision)
    artifacts, phase, current_file = [], 'initialization', None
    try:
        for item in plan['files']:
            current_file = item['path']; phase = 'download-open'
            url = f'https://huggingface.co/{REPOSITORY}/resolve/{REVISION}/{item["path"]}'
            partial, count, digest = output / (item['path'] + '.part'), 0, hashlib.sha256()
            with opener(url) as source, partial.open('xb') as sink:
                phase = 'download-stream'
                while True:
                    block = source.read(65536)
                    if not block:
                        break
                    count += len(block)
                    require(count <= item['byteLength'], 'setup_download_oversize')
                    digest.update(block); sink.write(block)
            phase = 'download-verify'
            require(count == item['byteLength'] and digest.hexdigest() == item['sha256'], 'setup_download_identity')
            phase = 'download-publish'
            partial.rename(output / item['path']); artifacts.append(item)
        result = seal({'format': 'ai_scene_local_model_setup_result_v1', 'planSha256': plan['sha256'], 'status': 'locked-model-files-verified',
                       'artifacts': artifacts, 'packageInstalls': 0, 'modelLoads': 0, 'inferenceCalls': 0, 'generationCalls': 0})
        write_json('setup-result.json', result); return result
    except Exception as error:
        code = str(error) if isinstance(error, ValueError) and re.fullmatch('[a-z0-9_]+', str(error)) else 'setup_download_failed'
        write_json('setup-failure.json', seal({'format': 'ai_scene_local_model_setup_failure_v1', 'planSha256': plan['sha256'],
                   'status': 'stopped-no-automatic-retry', 'verifiedArtifacts': artifacts, 'error': code,
                   'errorType': type(error).__name__, 'httpStatus': getattr(error, 'code', None), 'phase': phase,
                   'currentFile': current_file, 'generationCalls': 0}))
        raise ValueError(code) from None


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['preflight', 'install']); parser.add_argument('--workspace', required=True)
    parser.add_argument('--plan', required=True); parser.add_argument('--decision')
    args = parser.parse_args()
    try:
        plan = json.loads(regular(args.plan).read_bytes())
        if args.command == 'preflight':
            require(args.decision is None, 'preflight_has_no_authorization')
            result = preflight(args.workspace, plan)
        else:
            require(args.decision is not None, 'explicit_setup_authorization_required')
            decision = json.loads(regular(args.decision).read_bytes())
            result = install(args.workspace, plan, decision)
        print(json.dumps(result))
    except Exception as error:
        print(json.dumps({'status': 'stopped', 'error': str(error) if isinstance(error, ValueError) else 'setup_operation_failed', 'generationCalls': 0}))
        raise SystemExit(1)
