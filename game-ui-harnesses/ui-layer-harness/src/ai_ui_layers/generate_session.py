"""One authorized image request through a fresh persistent Codex CLI session."""
import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import time

from .codex_call import command
from .evaluate import save, digest
from .experimental_executor import next_request, fail


def run(job):
    job=Path(job).resolve();folder=job/'generation-session';folder.mkdir()
    request=next_request(job);save(folder/'tool-request.json',request)
    arguments=request['arguments']
    reference_instruction=('The only attached image is the original full reference. ' if len(arguments['referenced_image_paths'])==1 else 'Image 1 is the full reference; image 2 is the exact material crop. ')
    prompt=('You are executing exactly one already approved image-generation request. '
            'Use the built-in image generation tool once with the exact prompt below and all attached images. '
            +reference_instruction+
            'Do not replan, rewrite or enhance the image prompt. Do not use shell, web, agents or external APIs. '
            'Do not retry the image call after error or uncertainty. If unavailable, report that and stop. '
            'After success report the generated local image path or tool artifact identifier. '
            'Only the image prompt between the delimiters belongs in the image tool prompt.\n'
            '<image_prompt>\n'+arguments['prompt']+'\n</image_prompt>')
    (folder/'session-prompt.txt').write_text(prompt,encoding='utf-8')
    before=time.perf_counter()
    with tempfile.TemporaryDirectory(prefix='ui-image-session-') as cwd:
        args=command(shutil.which('codex'),folder,Path(cwd),'gpt-5.6-luna','xhigh')
        args.remove('--ephemeral')
        i=args.index('--output-schema');del args[i:i+2]
        i=args.index('--image');args[i:i+2]=['--image',','.join(arguments['referenced_image_paths'])]
        args[args.index('features.image_generation=false')]='features.image_generation=true'
        save(folder/'dispatch.json',{'startedAt':datetime.now(timezone.utc).isoformat(),
             'submissionDigest':request['submissionDigest'],'promptSha256':digest(folder/'session-prompt.txt'),
             'automaticResubmissions':0,'persistentSession':True})
        with (folder/'events.jsonl').open('xb') as out,(folder/'stderr.log').open('xb') as err:
            process=subprocess.Popen(args,stdin=subprocess.PIPE,stdout=out,stderr=err,cwd=cwd)
            try:process.communicate(prompt.encode('utf-8'),timeout=900)
            except subprocess.TimeoutExpired:
                process.kill();process.communicate()
                fail(job,request['submissionDigest'],'CLI timeout; image acceptance indeterminate')
        sessions=[]
        for line in (folder/'events.jsonl').read_text(encoding='utf-8').splitlines():
            event=json.loads(line)
            if event.get('type')=='thread.started':sessions.append(event['thread_id'])
        result={'exitCode':process.returncode,'sessionIds':sessions,
                'elapsedSeconds':time.perf_counter()-before,'submissionDigest':request['submissionDigest'],
                'receiptStatus':'inspect actual tool output before receiving; no automatic success'}
        save(folder/'session-result.json',result)
        print(json.dumps(result))


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--job',required=True)
    run(parser.parse_args().job)
