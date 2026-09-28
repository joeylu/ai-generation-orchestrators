"""One authorized image request through a fresh persistent Codex CLI session."""
import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time

from .codex_call import command, CLI_MODEL, CLI_EFFORT
from .evaluate import read, save, digest
from .experimental_executor import next_request, fail, load_job
from . import frozen_image_arguments as frozen_args


def build_session_prompt(arguments, reference_mode='full-and-crop', transparent_background=None):
    if reference_mode=='sheet-crops-only':
        reference_instruction='The attached images are the exact source crops in sheet-cell order; there is no full reference attachment. '
    elif reference_mode=='crop-only':
        reference_instruction='The only attached image is the exact material crop. '
    elif reference_mode=='full-only' or len(arguments['referenced_image_paths'])==1:
        reference_instruction='The only attached image is the original full reference. '
    else:
        reference_instruction='Image 1 is the full reference; image 2 is the exact material crop. '
    return ('You are executing exactly one already approved image-generation request. '
            +reference_instruction+
            'Run the code below verbatim in functions.exec once. The local ui_layer_frozen tool supplies '
            'the immutable prompt, attached-image count and explicit transparency mode as data. '
            'Forward structuredContent directly; never copy, retype, rewrite or enhance the prompt. '
            'If exec yields, wait on that same cell until completion; never start another exec or image request. '
            'Do not use shell, web, agents or external APIs. '
            'If the tool or structuredContent is unavailable, stop. Do not retry after error or uncertainty. '
            'After success report the generated local image path or tool artifact identifier.\n'+frozen_args.RELAY_CODE)


def relay_config(folder, payload_sha):
    """Invocation-only stdio tool; never writes user or project configuration."""
    value=dict(command=sys.executable,
        args=['-I',str(Path(frozen_args.__file__).resolve()),'--payload',
              str((folder/'frozen-image-arguments.json').resolve()),'--sha256',payload_sha],
        enabled=True,required=True,enabled_tools=[frozen_args.TOOL])
    # JSON basic strings/arrays are valid TOML values, including literal Unicode.
    return 'mcp_servers.ui_layer_frozen={'+','.join(
        key+'='+json.dumps(item,ensure_ascii=False) for key,item in value.items())+'}'


def run(job):
    exe=shutil.which('codex')
    if not exe:raise ValueError('CODEX_CLI_UNAVAILABLE')
    job=Path(job).resolve();sessions_root=job/'generation-sessions';sessions_root.mkdir(exist_ok=True)
    request=next_request(job)
    folder=sessions_root/request['submissionDigest'];folder.mkdir()
    save(folder/'tool-request.json',request)
    arguments=request['arguments']
    config,_=load_job(job)
    if 'materialIds' in request:
        transparent_background=True
    else:
        assets=read(job/'snapshot/execution-plan.candidate.json')['assets']
        matched=[asset for asset in assets if asset['id']==request['asset']]
        if len(matched)!=1 or matched[0]['output_mode'] not in ('opaque_canvas','keyed_component'):
            raise ValueError('UNKNOWN_OUTPUT_MODE')
        transparent_background=matched[0]['output_mode']=='keyed_component'
    prompt=build_session_prompt(arguments,config['referenceMode'],transparent_background)
    (folder/'session-prompt.txt').write_text(prompt,encoding='utf-8')
    payload_sha=frozen_args.prepare(folder,request,transparent_background)
    before=time.perf_counter()
    with tempfile.TemporaryDirectory(prefix='ui-image-session-') as cwd:
        args=command(exe,folder,Path(cwd),CLI_MODEL,CLI_EFFORT)
        args.remove('--ephemeral')
        i=args.index('--output-schema');del args[i:i+2]
        i=args.index('--image');args[i:i+2]=['--image',','.join(arguments['referenced_image_paths'])]
        args[args.index('features.image_generation=false')]='features.image_generation=true'
        args[-1:-1]=['-c',relay_config(folder,payload_sha)]
        save(folder/'dispatch.json',{'startedAt':datetime.now(timezone.utc).isoformat(),
             'submissionDigest':request['submissionDigest'],'promptSha256':digest(folder/'session-prompt.txt'),
             'transparentBackground':transparent_background,
             'argumentTransport':frozen_args.TRANSPORT,'imageArgumentsSha256':payload_sha,
             'toolRequestSha256':digest(folder/'tool-request.json'),
             'argumentServerSha256':digest(Path(frozen_args.__file__)),
             'automaticResubmissions':0,'persistentSession':True})
        with (folder/'events.jsonl').open('xb') as out,(folder/'stderr.log').open('xb') as err:
            failure_code=None;exit_code=None
            try:
                process=subprocess.Popen(args,stdin=subprocess.PIPE,stdout=out,stderr=err,cwd=cwd,shell=False)
            except OSError:
                failure_code='PROCESS_START_FAILED'
            else:
                try:process.communicate(prompt.encode('utf-8'),timeout=900)
                except (subprocess.TimeoutExpired,OSError) as exc:
                    failure_code='TIMEOUT_NO_RETRY' if isinstance(exc,subprocess.TimeoutExpired) else 'PROCESS_IO_FAILED'
                    try:process.kill()
                    except OSError:pass  # The child may already have exited.
                    try:process.communicate()
                    except OSError:pass
                exit_code=process.returncode
        sessions=[]
        for line in (folder/'events.jsonl').read_text(encoding='utf-8').splitlines():
            event=json.loads(line)
            if event.get('type')=='thread.started':sessions.append(event['thread_id'])
        result={'exitCode':exit_code,'sessionIds':sessions,
                'elapsedSeconds':time.perf_counter()-before,'submissionDigest':request['submissionDigest'],
                'sessionDir':str(folder),
                **({'failureCode':failure_code} if failure_code else {}),
                'receiptStatus':('indeterminate_no_resubmit' if failure_code or exit_code!=0
                                 else 'inspect actual tool output before receiving; no automatic success')}
        save(folder/'session-result.json',result)
        if failure_code or exit_code!=0:
            fail(job,request['submissionDigest'],
                 'CLI timeout; provider acceptance indeterminate' if failure_code=='TIMEOUT_NO_RETRY' else
                 'CLI process start failed; reserved request terminal' if failure_code=='PROCESS_START_FAILED' else
                 'CLI communication failed; provider acceptance indeterminate' if failure_code=='PROCESS_IO_FAILED' else
                 'CLI exited nonzero; provider acceptance indeterminate')
        print(json.dumps(result))


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--job',required=True)
    run(parser.parse_args().job)
