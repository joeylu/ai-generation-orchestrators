"""Collect one completed image session after verifying its logged call."""
import argparse
import json
import re
from pathlib import Path
from .evaluate import read,save,digest
from .experimental_executor import receive, status, verified
from .postprocess_visual import process


def literal_prompt(code):
    m=re.search(r'prompt:\s*("(?:[^"\\]|\\.)*")',code)
    if m:return json.loads(m.group(1))
    m=re.search(r'prompt:\s*String\.raw`([^`\\]*)`',code,re.S)
    if m:
        prompt=m.group(1)
        if '${' in prompt:raise ValueError('UNSUPPORTED_TEMPLATE')
        return prompt
    if re.search(r'prompt:\s*`',code):
        prompt=re.split(r'prompt:\s*`',code,maxsplit=1)[1].split('`',1)[0]
        if '${' in prompt or re.search(r'\\(?!")',prompt):raise ValueError('UNSUPPORTED_TEMPLATE')
        return prompt.replace('\\"','"')
    if 'const prompt = `' in code and 'prompt});' in code:
        prompt=code.split('const prompt = `',1)[1].split('`',1)[0]
        if '${' in prompt or '\\' in prompt:raise ValueError('UNSUPPORTED_TEMPLATE')
        return prompt
    raise ValueError('UNSUPPORTED_PROMPT_ENCODING')


def collect(job, codex_home):
    job=Path(job);home=Path(codex_home)
    current=status(job)
    if current['status']!='awaiting_result':raise ValueError('ONE_PENDING_REQUEST_REQUIRED')
    pending=[asset for asset,state in current['requests'].items() if state=='awaiting_result_no_resubmit']
    if len(pending)!=1:raise ValueError('ONE_PENDING_REQUEST_REQUIRED')
    submission=verified(job/'attempts'/pending[0]/'submission.json')
    folder=job/'generation-sessions'/submission['digest']
    if not folder.is_dir():folder=job/'generation-session'  # Existing one-request jobs.
    result=read(folder/'session-result.json')
    if result['submissionDigest']!=submission['digest'] or result['exitCode']!=0 or len(result['sessionIds'])!=1:
        raise ValueError('SESSION_NOT_SUCCESSFUL')
    sid=result['sessionIds'][0]
    logs=list((home/'sessions').rglob('*'+sid+'.jsonl'))
    if len(logs)!=1:raise ValueError('AMBIGUOUS_SESSION_LOG')
    events=[json.loads(l) for l in logs[0].read_text(encoding='utf-8').splitlines()]
    calls=[e['payload'] for e in events if e.get('payload',{}).get('type')=='custom_tool_call'
           and 'tools.image_gen__imagegen(' in e['payload'].get('input','')]
    if len(calls)!=1 or calls[0]['input'].count('tools.image_gen__imagegen(')!=1:raise ValueError('IMAGE_CALL_COUNT')
    code=calls[0]['input']
    prompt=literal_prompt(code)
    request=read(folder/'tool-request.json')
    if request['asset']!=pending[0] or request['submissionDigest']!=submission['digest']:
        raise ValueError('SESSION_REQUEST_MISMATCH')
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
    response={'asset':asset,'job':str(job),'raw':str(raw),'sessionSeconds':result['elapsedSeconds'],
              'receiptDigest':received['digest'],'issues':[]}
    if 'materialIds' in request:
        response['postprocess']='deferred_to_sheet_extraction'
        return response
    a=next(a for a in read(job/'snapshot/execution-plan.candidate.json')['assets'] if a['id']==asset)
    placement=next(p for p in read(job/'snapshot/placements.json')['materials'] if p['id']==asset)
    post=process(raw,a['output_size'],job/'postprocess'/asset,background=a['role']=='background',
                 fit_mode=placement.get('fitMode','contain'))
    response.update(postprocess=post['status'],issues=post['issues'])
    return response


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--job',required=True);parser.add_argument('--codex-home',required=True)
    args=parser.parse_args()
    print(json.dumps(collect(args.job,args.codex_home),ensure_ascii=True,indent=2))
