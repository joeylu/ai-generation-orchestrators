"""Collect a completed single-image session after verifying its logged call."""
import json
import re
from pathlib import Path
from PIL import Image
from .evaluate import read,save,digest
from .experimental_executor import receive
from .postprocess_visual import process


def collect(job, codex_home):
    job=Path(job);home=Path(codex_home);folder=job/'generation-session'
    result=read(folder/'session-result.json')
    if result['exitCode']!=0 or len(result['sessionIds'])!=1:raise ValueError('SESSION_NOT_SUCCESSFUL')
    sid=result['sessionIds'][0]
    logs=list((home/'sessions').rglob('*'+sid+'.jsonl'))
    if len(logs)!=1:raise ValueError('AMBIGUOUS_SESSION_LOG')
    events=[json.loads(l) for l in logs[0].read_text(encoding='utf-8').splitlines()]
    calls=[e['payload'] for e in events if e.get('payload',{}).get('type')=='custom_tool_call'
           and 'tools.image_gen__imagegen(' in e['payload'].get('input','')]
    if len(calls)!=1 or calls[0]['input'].count('tools.image_gen__imagegen(')!=1:raise ValueError('IMAGE_CALL_COUNT')
    code=calls[0]['input']
    m=re.search(r'prompt:\s*("(?:[^"\\]|\\.)*")',code)
    if m:prompt=json.loads(m.group(1))
    elif re.search(r'prompt:\s*`',code):
        prompt=re.split(r'prompt:\s*`',code,maxsplit=1)[1].split('`',1)[0]
        if '${' in prompt or '\\' in prompt:raise ValueError('UNSUPPORTED_TEMPLATE')
    elif 'const prompt = `' in code and 'prompt});' in code:
        prompt=code.split('const prompt = `',1)[1].split('`',1)[0]
        if '${' in prompt or '\\' in prompt:raise ValueError('UNSUPPORTED_TEMPLATE')
    else:raise ValueError('UNSUPPORTED_PROMPT_ENCODING')
    request=read(folder/'tool-request.json')
    expected=request['arguments']['prompt']
    if prompt.rstrip('\n')!=expected.rstrip('\n'):raise ValueError('PROMPT_CHANGED')
    count=len(request['arguments']['referenced_image_paths'])
    if not re.search(r'num_last_images_to_include:\s*'+str(count)+r'\b',code):raise ValueError('REFERENCE_COUNT')
    images=list((home/'generated_images'/sid).glob('*.png'))
    if len(images)!=1:raise ValueError('AMBIGUOUS_OUTPUT')
    save(folder/'image-call-audit.json',{'observedImageCalls':1,'exactPromptMatch':prompt==expected,'promptMatchIgnoringTrailingNewline':True,
         'sessionId':sid,'sourceSha256':digest(images[0])})
    received=receive(job,result['submissionDigest'],images[0])
    asset=request['asset'];raw=job/'attempts'/asset/'raw.png'
    a=next(a for a in read(job/'snapshot/execution-plan.candidate.json')['assets'] if a['id']==asset)
    placement=next(p for p in read(job/'snapshot/placements.json')['materials'] if p['id']==asset)
    post=process(raw,a['output_size'],job/'postprocess',background=a['role']=='background',
                 fit_mode=placement.get('fitMode','contain'))
    return {'asset':asset,'job':str(job),'raw':str(raw),'sessionSeconds':result['elapsedSeconds'],
            'postprocess':post['status'],'issues':post['issues']}
