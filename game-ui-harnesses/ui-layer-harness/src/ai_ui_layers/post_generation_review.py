"""Read-only review packets and user-decision reports; never executes fixes."""
import argparse
from pathlib import Path
from jsonschema import Draft202012Validator
from .evaluate import read,save,digest
from .compile_visual import HARNESS
BASE=HARNESS/'planning-harness'


def prepare(reference, composite, materials, output, exclusions):
    output=Path(output);output.mkdir(parents=True,exist_ok=False)
    files={'reference':Path(reference),'composite':Path(composite),**{k:Path(v) for k,v in materials.items()}}
    if set(materials)&{'reference','composite'}:raise ValueError('RESERVED_MATERIAL_ID')
    inputs={k:{'path':str(v.resolve()),'sha256':digest(v)} for k,v in files.items()}
    for name,source in [('schema.json',BASE/'schemas/post-generation-review.schema.json'),('prompt.md',BASE/'prompts/post-generation-review.md')]:
        (output/name).write_bytes(source.read_bytes())
    save(output/'request.json',{'kind':'post-generation-review-request-v1','inputs':inputs,'materialIds':list(materials),
         'expectedExclusions':exclusions,'schemaSha256':digest(output/'schema.json'),'promptSha256':digest(output/'prompt.md'),
         'generationCalls':0,'automaticCorrection':False})


def receive(packet, candidate, reviewer):
    packet=Path(packet);candidate=Path(candidate);request=read(packet/'request.json')
    if reviewer not in ('host-visual','model-session'):raise ValueError('REVIEWER_REQUIRED')
    for value in request['inputs'].values():
        if digest(Path(value['path']))!=value['sha256']:raise ValueError('REVIEW_INPUT_CHANGED')
    for name in ('schema','prompt'):
        ext='json' if name=='schema' else 'md'
        if digest(packet/(name+'.'+ext))!=request[name+'Sha256']:raise ValueError('REVIEW_CONTRACT_CHANGED')
    answer=read(candidate);Draft202012Validator(read(packet/'schema.json')).validate(answer)
    ids=[i['id'] for i in answer['issues']]
    if len(ids)!=len(set(ids)):raise ValueError('DUPLICATE_ISSUE')
    for issue in answer['issues']:
        if not set(issue['materialIds'])<=set(request['materialIds']):raise ValueError('UNKNOWN_MATERIAL')
    report={'kind':'post-generation-review-result-v1','requestSha256':digest(packet/'request.json'),
            'candidateSha256':digest(candidate),'reviewer':reviewer,'issues':answer['issues'],
            'status':'awaiting_user_decision','userChoices':['accept_current','select_issues_for_one_revision','defer'],
            'automaticCorrection':False,'generationCalls':0,'humanVisualAcceptance':False}
    save(packet/'report.json',report)
    lines=['# 生成后视觉检查','', '当前结果等待用户决定；未执行任何修正或新生图。','']
    for issue in answer['issues']:
        lines.extend([f"- {issue['id']} ({issue['severity']}): {issue['observation']}",f"  建议：{issue['suggestedFix']}；处理方向：{issue['route']}"])
    (packet/'report.md').write_text('\n'.join(lines)+'\n',encoding='utf-8')
    return report

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--packet',required=True);p.add_argument('--candidate',required=True)
    p.add_argument('--reviewer',required=True,choices=['host-visual','model-session']);a=p.parse_args()
    receive(a.packet,a.candidate,a.reviewer)
