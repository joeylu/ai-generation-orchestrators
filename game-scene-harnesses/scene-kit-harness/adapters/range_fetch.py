"""Internal reserved fixed-catalog range transfer; no models, GPU, service or retries."""
import argparse
import http.client
import importlib.util
import json
from pathlib import Path
import re
import urllib.error
import urllib.parse
import urllib.request

spec = importlib.util.spec_from_file_location('scene_range_recovery', Path(__file__).with_name('model_recovery.py'))
worker = importlib.util.module_from_spec(spec); spec.loader.exec_module(worker)
setup, require, canonical, seal = worker.setup, worker.require, worker.canonical, worker.seal


class LockedRedirect(urllib.request.HTTPRedirectHandler):
    def __init__(self):
        self.count = 0

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        self.count += 1
        require(self.count <= 5, 'range_redirect_limit')
        parsed = urllib.parse.urlsplit(newurl)
        require(parsed.scheme == 'https' and not parsed.username and not parsed.password
                and (parsed.hostname == 'huggingface.co' or (parsed.hostname or '').endswith('.hf.co')), 'range_redirect_rejected')
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def download(request, timeout):
    return urllib.request.build_opener(LockedRedirect()).open(request, timeout=timeout)


def transfer(directory, number, timeout, opener=download):
    directory = setup.regular(directory, directory=True)
    require(re.fullmatch('[a-f0-9]{64}', directory.name) and directory.parent.name == 'scene-sam2'
            and directory.parent.parent.name == 'tools' and directory.parent.parent.parent.name == '.ai-frame-animation', 'range_output_scope')
    plan = json.loads(setup.regular(directory / 'recovery-plan.json').read_bytes()); worker.validate(plan)
    require(plan['format'] == 'ai_scene_bounded_model_recovery_plan_v2' and plan['sha256'] == directory.name
            and type(number) is int and 1 <= number <= plan['policy']['maximumRequests']
            and type(timeout) is int and 1 <= timeout <= plan['policy']['perRequestSeconds'], 'range_request_scope')
    decision = json.loads(setup.regular(directory / 'recovery-authorization.json').read_bytes())
    require(decision.get('decision') == 'approve-bounded-recovery' and decision.get('targetSha256') == plan['sha256'], 'range_authorization')
    started = json.loads(setup.regular(directory / f'request-{number:02d}-started.json').read_bytes()); worker.resume.unseal(started)
    start, end, total = started['rangeStart'], started['rangeEnd'], plan['files'][0]['byteLength']
    require(started['requestNumber'] == number and type(start) is int and type(end) is int
            and plan['prefix']['byteLength'] <= start <= end < total
            and end - start + 1 <= plan['policy']['maximumRangeBytes'], 'range_bounds')
    # Exclusive receipt prevents invoking the same reserved request twice.
    with (directory / f'request-{number:02d}-dispatched.json').open('xb') as stream:
        stream.write(canonical(seal({'format': 'ai_scene_range_dispatch_v1', 'planSha256': plan['sha256'], 'requestNumber': number})) + b'\n')
    url = f'https://huggingface.co/{setup.REPOSITORY}/resolve/{setup.REVISION}/model.safetensors'
    request = urllib.request.Request(url, headers={'Range': f'bytes={start}-{end}', 'Accept-Encoding': 'identity'})
    try:
        with opener(request, timeout) as response:
            interval = response.headers.get('Content-Range')
            metadata = seal({'format': 'ai_scene_range_response_v1', 'planSha256': plan['sha256'], 'requestNumber': number,
                             'httpStatus': response.status, 'contentRange': interval})
            with (directory / f'request-{number:02d}-response.json').open('xb') as stream:
                stream.write(canonical(metadata) + b'\n')
            require(response.status == 206 and interval == f'bytes {start}-{end}/{total}', 'range_response_required')
            require(response.headers.get('Content-Encoding', 'identity').lower() == 'identity', 'range_encoding_required')
            length = response.headers.get('Content-Length')
            require(length is None or length == str(end - start + 1), 'range_length_required')
            received = 0
            with (directory / f'fragment-{number:02d}.part').open('xb', buffering=0) as stream:
                while received <= end - start:
                    try:
                        block = response.read(min(65536, end - start + 2 - received))
                    except http.client.IncompleteRead as error:
                        block = error.partial
                        require(received + len(block) <= end - start + 1, 'range_oversize')
                        stream.write(block); return 18
                    if not block:
                        break
                    received += len(block); require(received <= end - start + 1, 'range_oversize'); stream.write(block)
            return 0 if received == end - start + 1 else 18
    except urllib.error.HTTPError as error:
        metadata = seal({'format': 'ai_scene_range_response_v1', 'planSha256': plan['sha256'], 'requestNumber': number,
                         'httpStatus': error.code, 'contentRange': None})
        path = directory / f'request-{number:02d}-response.json'
        if not path.exists():
            with path.open('xb') as stream:
                stream.write(canonical(metadata) + b'\n')
        error.close(); return 22
    except TimeoutError:
        return 28
    except (urllib.error.URLError, ConnectionError, OSError):
        return 56


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output-dir', required=True); parser.add_argument('--request-number', required=True, type=int)
    parser.add_argument('--timeout', required=True, type=int)
    args = parser.parse_args()
    try:
        code = transfer(args.output_dir, args.request_number, args.timeout)
    except Exception:
        code = 65  # Do not emit exception strings containing proxy or redirect addresses.
    raise SystemExit(code)
