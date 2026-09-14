"""Frozen optional replacement requests and a single local compute envelope.

No provider calls. Each request is single-use; unknown outcomes stop the envelope.
Replacement prompts are frozen up front, never invented by this executor.
"""
from copy import deepcopy
from pathlib import Path
import shutil
from .common import digest,read_json,write_json,require,sha256,safe_relative

ISSUES={'missing_transparent_pixels','baked_state_part','wrong_semantic_asset',
        'request_prompt_mismatch',
        'layout_overflow','state_registration_error','text_unreadable',
        'interaction_failure','LONG_CONTROL_SUPPORT_ASPECT_MISMATCH'}


def validate(policy,plan):
    require(isinstance(policy,dict) and set(policy)=={'kind','plan_digest','initial_assets','replacements','maximum_calls','maximum_replacements','stop_on_indeterminate'},'EXECUTION_POLICY_SCHEMA')
    require(policy['kind']=='ai_ui_bounded_execution_v1' and policy['plan_digest']==digest(plan),'EXECUTION_PLAN_MISMATCH')
    require(policy['stop_on_indeterminate'] is True,'EXECUTION_UNKNOWN_OUTCOME_POLICY')
    initial=policy['initial_assets'];pairs=policy['replacements']
    require(isinstance(initial,list) and initial and all(isinstance(k,str) for k in initial) and len(set(initial))==len(initial),'EXECUTION_INITIAL_ASSETS')
    require(isinstance(pairs,dict) and set(pairs)<=set(initial) and all(isinstance(v,str) for v in pairs.values()),'EXECUTION_REPLACEMENTS')
    require(len(set(pairs.values()))==len(pairs) and not set(initial)&set(pairs.values()),'EXECUTION_REPLACEMENTS')
    generated={a['id']:a for a in plan['assets'] if a['route'].startswith('generated_') and 'cached_result' not in a}
    require(set(generated)==set(initial)|set(pairs.values()),'EXECUTION_REQUEST_COVERAGE')
    for original,replacement in pairs.items():
        a,b=generated[original],generated[replacement]
        require(all(a[k]==b[k] for k in ('role','route','source_region','output_size','output_mode','source_asset')) and a['prompt']!=b['prompt'],'EXECUTION_REPLACEMENT_SCOPE')
    require(type(policy['maximum_calls']) is int and type(policy['maximum_replacements']) is int and
            0<=policy['maximum_replacements']<=len(pairs) and len(initial)<=policy['maximum_calls']<=len(initial)+policy['maximum_replacements'],'EXECUTION_BUDGET')
    return policy


def authorize(run,approval):
    from . import batch
    frozen,_=batch.load(run)
    require('bounded_execution' in frozen and isinstance(approval,str) and bool(approval.strip()),'EXECUTION_APPROVAL_REQUIRED')
    record={'kind':'ai_ui_bounded_authorization_v1','batch_digest':frozen['digest'],
            'policy_sha256':frozen['bounded_execution']['sha256'],'approval':approval,
            'request_sha256':{k:v['request_sha256'] for k,v in frozen['requests'].items()}}
    record['digest']=digest(record);write_json(run/'execution-authorization.json',record)
    return {'status':'authorized','authorization_digest':record['digest'],'generation_calls':0}


def _policy(run,frozen):return read_json(run/frozen['bounded_execution']['path'])


def authorize_parallel(run,maximum_pending,approval):
    """Additional explicit dispatch approval; never changes prompts or call budget."""
    from . import batch
    frozen,_=batch.load(run);policy=_policy(run,frozen)
    require(type(maximum_pending) is int and 1<=maximum_pending<=min(4,policy['maximum_calls']), 'EXECUTION_PARALLEL_LIMIT')
    require(isinstance(approval,str) and bool(approval.strip()),'EXECUTION_APPROVAL_REQUIRED')
    original=run/'execution-authorization.json';require(original.is_file(),'EXECUTION_NOT_AUTHORIZED')
    require(not _unknown_history(run,frozen),'EXECUTION_INDETERMINATE_STOP')
    require(all(batch.state(run,v)!='reserved' for v in frozen['requests'].values()),'EXECUTION_PENDING_REQUEST_STOP')
    record={'kind':'ai_ui_parallel_dispatch_authorization_v1','batch_digest':frozen['digest'],
            'authorization_sha256':sha256(original),'maximum_pending':maximum_pending,'approval':approval}
    record['digest']=digest(record);write_json(run/'parallel-dispatch-authorization.json',record);return record


def _parallel_limit(run,frozen):
    path=run/'parallel-dispatch-authorization.json'
    if not path.exists():return 1
    r=read_json(path)
    require(set(r)=={'kind','batch_digest','authorization_sha256','maximum_pending','approval','digest'} and
            r['kind']=='ai_ui_parallel_dispatch_authorization_v1' and r['digest']==digest({k:v for k,v in r.items() if k!='digest'}) and
            r['batch_digest']==frozen['digest'] and r['authorization_sha256']==sha256(run/'execution-authorization.json') and
            type(r['maximum_pending']) is int and 1<=r['maximum_pending']<=min(4,_policy(run,frozen)['maximum_calls']) and
            isinstance(r['approval'],str) and bool(r['approval'].strip()),'EXECUTION_PARALLEL_AUTHORIZATION_CHANGED')
    return r['maximum_pending']


def _unknown_history(run,frozen):
    return any((run/'requests'/v['id']/'indeterminate.json').exists() for v in frozen['requests'].values())


def admit(run,frozen,asset):
    from . import batch
    policy=_policy(run,frozen)
    path=run/'execution-authorization.json';require(path.is_file(),'EXECUTION_NOT_AUTHORIZED')
    auth=read_json(path)
    require(auth.get('digest')==digest({k:v for k,v in auth.items() if k!='digest'}) and
            auth.get('batch_digest')==frozen['digest'] and auth.get('policy_sha256')==frozen['bounded_execution']['sha256'] and
            auth.get('request_sha256')=={k:v['request_sha256'] for k,v in frozen['requests'].items()},'EXECUTION_AUTHORIZATION_CHANGED')
    states={k:batch.state(run,v) for k,v in frozen['requests'].items()}
    require(not _unknown_history(run,frozen),'EXECUTION_INDETERMINATE_STOP')
    require(sum(v=='reserved' for v in states.values())<_parallel_limit(run,frozen),'EXECUTION_PENDING_REQUEST_STOP')
    compute=set(policy['initial_assets'])|set(policy['replacements'].values())
    require(sum(states[k]!='prepared' for k in compute)<policy['maximum_calls'],'EXECUTION_CALL_BUDGET_EXHAUSTED')
    reverse={v:k for k,v in policy['replacements'].items()}
    require(not any(states[k]=='rejected' or _issue(run,frozen,k) for k in reverse),'EXECUTION_REPLACEMENT_FAILED')
    require(not any(states[k]=='rejected' or _issue(run,frozen,k) for k in policy['initial_assets'] if k not in policy['replacements']),'EXECUTION_NO_APPROVED_REPLACEMENT')
    if asset in reverse:
        require(sum(states[k]!='prepared' for k in reverse)<policy['maximum_replacements'],'EXECUTION_REPLACEMENT_BUDGET_EXHAUSTED')
        original=reverse[asset]
        require(states[original] in ('received','rejected'),'EXECUTION_PRIOR_RESULT_REQUIRED')
        require(states[original]=='rejected' or _issue(run,frozen,original),'EXECUTION_REPLACEMENT_EVIDENCE_REQUIRED')
    return sha256(path)


def _issue(run,frozen,asset):
    directory=run/'requests'/frozen['requests'][asset]['id'];path=directory/'execution-issue.json'
    if not path.is_file():return None
    record=read_json(path)
    require(record.get('digest')==digest({k:v for k,v in record.items() if k!='digest'}) and record.get('asset')==asset and
            record.get('batch_digest')==frozen['digest'] and record.get('raw_sha256')==sha256(directory/'raw.png'),'EXECUTION_ISSUE_CHANGED')
    return record


def issue(run,asset,category,evidence):
    from . import batch
    frozen,_=batch.load(run)
    require('bounded_execution' in frozen and asset in frozen['requests'],'EXECUTION_ASSET')
    require(batch.state(run,frozen['requests'][asset])=='received','EXECUTION_RECEIVED_REQUIRED')
    require(category in ISSUES and isinstance(evidence,str) and bool(evidence.strip()),'EXECUTION_BLOCKING_EVIDENCE_REQUIRED')
    directory=run/'requests'/frozen['requests'][asset]['id']
    record={'kind':'ai_ui_bounded_issue_v1','batch_digest':frozen['digest'],'asset':asset,
            'category':category,'evidence':evidence,'raw_sha256':sha256(directory/'raw.png'),
            'semantic_detection':'caller_observation','human_visual_acceptance':False}
    record['digest']=digest(record);write_json(directory/'execution-issue.json',record);return record


def select_plan(run,source_plan,output):
    """Select authenticated results into an ordinary zero-compute reuse plan."""
    from . import batch
    from .cached import result_binding
    from .contract import validate as validate_plan
    frozen,plan=batch.load(run);require('bounded_execution' in frozen,'EXECUTION_POLICY_REQUIRED')
    require(digest(read_json(source_plan))==digest(plan),'EXECUTION_SOURCE_PLAN_CHANGED')
    policy=_policy(run,frozen);states={k:batch.state(run,v) for k,v in frozen['requests'].items()}
    require(not _unknown_history(run,frozen),'EXECUTION_INDETERMINATE_STOP')
    selected={}
    for original in policy['initial_assets']:
        replacement=policy['replacements'].get(original)
        selected[original]=replacement if replacement and states[replacement]!='prepared' else original
        key=selected[original]
        require(states[key]=='received' and not _issue(run,frozen,key),'EXECUTION_UNRESOLVED_ASSET:'+original)
        if key==original:require(not _issue(run,frozen,original),'EXECUTION_UNRESOLVED_ASSET:'+original)
    require(not output.exists(),'EXECUTION_OUTPUT_EXISTS')
    result=deepcopy(plan);index={a['id']:a for a in plan['assets']}
    replacements=set(policy['replacements'].values())
    result['id']=plan['id']+'-selected'
    result['assets']=[a for a in result['assets'] if a['id'] not in replacements]
    for n,a in enumerate(result['assets']):
        if a['id'] not in selected:continue
        key=selected[a['id']];chosen=deepcopy(index[key]);chosen['id']=a['id'];chosen['cached_result']=result_binding(run,key)
        result['assets'][n]=chosen
    result['nodes']=[n for n in result['nodes'] if n['asset'] not in replacements]
    nodes={n['id'] for n in result['nodes']}
    for group in result['groups']:group['children']=[n for n in group['children'] if n in nodes]
    result['groups']=[g for g in result['groups'] if g['children']]
    source=source_plan.resolve().parent
    validate_plan(result,source_base=source)
    output.mkdir(parents=True)
    for obj in [result['source'],*[a['material_source'] for a in result['assets'] if a['route']=='imported_material']]:
        src=safe_relative(source,obj['path']);dst=safe_relative(output,obj['path']);dst.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(src,dst)
        require(sha256(dst)==obj['sha256'],'EXECUTION_SOURCE_COPY_CHANGED')
    write_json(output/'plan.json',result)
    record={'kind':'ai_ui_bounded_selection_v1','source_batch_digest':frozen['digest'],'plan_digest':digest(result),
            'selected':selected,'new_generation_calls':0,'human_visual_acceptance':False,'runtime_acceptance':'not_performed'}
    write_json(output/'selection.json',record);return record
