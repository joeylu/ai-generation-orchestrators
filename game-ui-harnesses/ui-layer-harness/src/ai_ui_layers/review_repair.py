"""One same-session review of a repaired candidate; never retries or generates media."""
import argparse
import json
from pathlib import Path
import shutil
import tempfile
from jsonschema import Draft202012Validator
from .evaluate import read,save,digest,check_relations
from .codex_call import CLI_MODEL, CLI_EFFORT
from .local_patch import merge_patch
from .session_review import invoke,resume_command,session_id,build_review_prompt,render_for_review


def run(root):
    root=Path(root).resolve();m1=root/'m1';repair=root/'repair';folder=root/'rereview'
    result=read(root/'result.json');sid=result['sessionId']
    bound=read(root/'request.json')
    if (bound['model'],bound['effort'])!=(CLI_MODEL,CLI_EFFORT):
        raise ValueError('MODEL_CHANGED_NEW_SESSION_REQUIRED')
    candidate,report=merge_patch(m1/'draft.json',read(repair/'draft.json'),read(m1/'schema.json'),result['sourcePlanSha256'])
    if candidate!=read(repair/'candidate.json') or report['programIssues'] or report['unresolvedIssues']:
        raise ValueError('REPAIR_NOT_READY')
    folder.mkdir()
    render_for_review(m1/'reference.png',candidate,folder/'preview')
    (folder/'review-overlay.png').write_bytes((folder/'preview/materials-overlay.png').read_bytes())
    for name in ('schema.json','review-source.md'):(folder/name).write_bytes((root/'m2'/name).read_bytes())
    prompt=build_review_prompt((folder/'review-source.md').read_text(encoding='utf-8'),check_relations(candidate))
    prompt+='\n本轮检查修补后的最终候选，以此完整候选为准；确认修补解决了问题，并检查是否有遗漏。不再修补。\n'+json.dumps(candidate,ensure_ascii=False)
    (folder/'prompt.md').write_text(prompt,encoding='utf-8')
    save(folder/'request.json',{'sessionId':sid,'candidateSha256':digest(repair/'candidate.json'),
        'patchSha256':digest(repair/'draft.json'),
        'inputs':{n:digest(folder/n) for n in ('schema.json','review-source.md','review-overlay.png','prompt.md')}})
    with tempfile.TemporaryDirectory(prefix='ui-rereview-') as cwd:
        receipt=invoke(resume_command(shutil.which('codex'),folder,Path(cwd),sid),folder,cwd,prompt)
    if session_id(folder/'events.jsonl')!=sid:raise ValueError('SESSION_CHANGED')
    review=read(folder/'draft.json');Draft202012Validator(read(folder/'schema.json')).validate(review)
    save(folder/'result.json',{'sameSessionVerified':True,'sessionId':sid,
        'reviewSha256':digest(folder/'draft.json'),'seconds':receipt['elapsedSeconds'],
        'issueCount':len(review['issues']),'automaticRetry':False})
    print(json.dumps(review,ensure_ascii=False))


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--run',required=True);run(parser.parse_args().run)
