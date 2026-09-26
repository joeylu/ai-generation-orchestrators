"""Optional local Codex CLI transport; no production harness imports or retries."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import time

from jsonschema import Draft202012Validator
from .evaluate import check_relations, draw_order, read

CLI_MODEL = 'gpt-6-luna'
CLI_EFFORT = 'xhigh'


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def save(path, data):
    with path.open('x', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def skill_overrides():
    roots = {Path.home()/'.codex'/'skills', Path.home()/'.agents'/'skills'}
    if os.environ.get('CODEX_HOME'):
        roots.add(Path(os.environ['CODEX_HOME'])/'skills')
    paths = sorted({str(q.resolve()) for root in roots if root.exists()
                    for p in root.rglob('SKILL.md') for q in (p, p.parent)})
    return 'skills.config=['+','.join('{path='+json.dumps(p)+',enabled=false}' for p in paths)+']'


def transport_schema(schema):
    """Storage schemas may have optional arrays; structured model outputs may not."""
    import copy
    result=copy.deepcopy(schema)
    def visit(node):
        if isinstance(node,dict):
            node.pop('uniqueItems',None)
            if any(k in node for k in ('allOf','if','then','else')):raise ValueError('UNSUPPORTED_TRANSPORT_SCHEMA')
            if node.get('type')=='object':
                node['required']=list(node.get('properties',{}))
                node['additionalProperties']=False
            for value in node.values():visit(value)
        elif isinstance(node,list):
            for value in node:visit(value)
    visit(result)
    return result


def command(exe, run, cwd, model, effort):
    args = [exe, 'exec', '--strict-config', '--ignore-user-config', '--ephemeral',
            '--skip-git-repo-check', '--sandbox', 'read-only', '--cd', str(cwd),
            '--model', model, '--json', '--color', 'never',
            '--image', str(run/'reference.png'), '--output-schema', str(run/'schema.json'),
            '--output-last-message', str(run/'draft.json')]
    settings = ['approval_policy="never"', 'project_doc_max_bytes=0',
                'web_search="disabled"', 'suppress_unstable_features_warning=true',
                'model_reasoning_effort='+json.dumps(effort)]
    disabled = ['shell_tool', 'unified_exec', 'multi_agent', 'apps', 'plugins',
                'hooks', 'browser_use', 'browser_use_external', 'browser_use_full_cdp_access',
                'computer_use', 'in_app_browser', 'image_generation', 'memories',
                'skill_search', 'view_image', 'shell_snapshot', 'unbounded_connection_retries']
    settings += ['features.'+name+'=false' for name in disabled]
    settings += ['features.skip_host_skill_discovery=true']
    settings += [skill_overrides()]
    for value in settings:
        args += ['-c', value]
    return args+['-']


def inspect_events(path):
    counts, usage, violations, transport_notices = {}, None, [], 0
    completed = False
    for line in path.read_text(encoding='utf-8').splitlines():
        if not line.strip():
            continue
        event = json.loads(line)
        event_type = event.get('type', 'unknown')
        counts[event_type] = counts.get(event_type, 0)+1
        if event_type == 'turn.completed':
            completed, usage = True, event.get('usage')
        if event_type == 'turn.failed':
            violations.append(event_type)
        if event_type == 'error':
            if str(event.get('message', '')).startswith('Reconnecting...'):
                transport_notices += 1
            else:
                violations.append(event_type)
        if event_type.startswith('item.'):
            kind = event.get('item', {}).get('type', 'unknown')
            if kind == 'error' and str(event.get('item', {}).get('message', '')).startswith('Falling back from WebSockets to HTTPS transport.'):
                transport_notices += 1
            elif kind not in ('agent_message', 'reasoning'):
                violations.append('unexpected_item:'+kind)
    return {'eventCounts': counts, 'usage': usage, 'turnCompleted': completed,
            'unexpectedEvents': sorted(set(violations)), 'transportNotices':transport_notices}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('image', 'prompt', 'schema', 'output'):
        parser.add_argument('--'+name, required=True)
    parser.add_argument('--model', default=CLI_MODEL)
    parser.add_argument('--effort', default=CLI_EFFORT, choices=['low','medium','high','xhigh'])
    parser.add_argument('--codex', default='codex')
    parser.add_argument('--timeout', type=int, default=900)
    parser.add_argument('--execute', action='store_true', help='Submit one CLI run; otherwise prepare only')
    opts = parser.parse_args()
    if opts.timeout <= 0:
        parser.error('--timeout must be positive')
    exe = shutil.which(opts.codex)
    if not exe:
        parser.error('Codex CLI executable not found')
    schema = read(Path(opts.schema))
    Draft202012Validator.check_schema(schema)
    run = Path(opts.output).resolve()
    run.mkdir(parents=True, exist_ok=False)
    for name, src in [('reference.png',opts.image),('prompt.md',opts.prompt),('schema.json',opts.schema)]:
        (run/name).write_bytes(Path(src).read_bytes())
    (run/'schema.json').write_text(json.dumps(transport_schema(schema),ensure_ascii=False,indent=2),encoding='utf-8')
    prompt = (run/'prompt.md').read_text(encoding='utf-8-sig')
    version = subprocess.run([exe, '--version'], capture_output=True, text=True, check=True).stdout.strip()
    request = {'kind':'codex_cli_visual_request_v1', 'model':opts.model, 'effort':opts.effort,
               'cliVersion':version, 'inputs':{n:sha(run/n) for n in ('reference.png','prompt.md','schema.json')},
               'executeRequested':opts.execute, 'mediaGenerationCalls':0,
               'isolation':'Temporary cwd outside project; ignore user config; project docs off; feature tools disabled. Built-in/managed context still applies.',
               'timingScope':'process start to process exit; includes CLI startup, network and inference, not pure inference'}
    save(run/'request.json', request)
    if not opts.execute:
        save(run/'result.json', {'status':'prepared_only', 'modelCallSubmitted':False})
        print('prepared_only')
        return 0
    # Do not copy/read authentication. CLI uses its existing login and managed policies.
    with tempfile.TemporaryDirectory(prefix='ui-visual-call-') as cwd:
        argv = command(exe, run, Path(cwd), opts.model, opts.effort)
        started = datetime.now(timezone.utc).isoformat()
        save(run/'dispatch.json', {'startedAt':started, 'requestSha256':sha(run/'request.json')})
        before = time.perf_counter()
        result = {'kind':'codex_cli_visual_result_v1', 'status':'failed', 'startedAt':started,
                  'mediaGenerationCalls':0, 'automaticResubmissions':0, 'productionReady':False,
                  'humanVisualAcceptance':False}
        with (run/'events.jsonl').open('xb') as events, (run/'stderr.log').open('xb') as errors:
            try:
                process = subprocess.Popen(argv, stdin=subprocess.PIPE, stdout=events, stderr=errors,
                                           cwd=cwd, shell=False)
                try:
                    process.communicate(prompt.encode('utf-8'), timeout=opts.timeout)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.communicate()
                    result['failureCode'] = 'TIMEOUT_NO_RETRY'
                result['exitCode'] = process.returncode
            except OSError:
                result['failureCode'] = 'PROCESS_START_FAILED'
        result.update(finishedAt=datetime.now(timezone.utc).isoformat(),elapsedSeconds=time.perf_counter()-before)
        try:
            result.update(inspect_events(run/'events.jsonl'))
            if any(sha(run/n)!=h for n,h in request['inputs'].items()):
                result['failureCode']='INPUT_CHANGED'
            if (run/'draft.json').exists():
                result.update(responseSha256=sha(run/'draft.json'),responseBytes=(run/'draft.json').stat().st_size)
            if not result.get('failureCode') and result.get('exitCode') == 0 and result['turnCompleted'] and not result['unexpectedEvents']:
                plan = read(run/'draft.json')
                issues = [{'code':'SCHEMA','path':list(e.absolute_path),'message':e.message}
                          for e in Draft202012Validator(schema).iter_errors(plan)]
                if not issues:
                    issues = check_relations(plan)
                result['issues'] = issues
                result['status'] = 'structure_passed' if not issues else 'rejected'
                if not issues:
                    save(run/'draw-order.json', draw_order(plan, result['responseSha256']))
            else:
                result.setdefault('failureCode','CLI_OR_EVENT_FAILURE')
        except (ValueError, OSError, TypeError, KeyError):
            result['failureCode']='INVALID_OUTPUT'
        save(run/'result.json', result)
    print(json.dumps({k:result[k] for k in ('status','elapsedSeconds','failureCode') if k in result}))
    return 0 if result['status']=='structure_passed' else 1


if __name__ == '__main__':
    raise SystemExit(main())
