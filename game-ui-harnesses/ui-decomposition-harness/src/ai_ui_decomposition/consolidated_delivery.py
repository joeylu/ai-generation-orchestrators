"""Data-only consolidated material selection -> existing official acceptance entry."""
from pathlib import Path
from .common import read_json,require,digest,sha256,safe_relative,write_json
from .sourced_handoff import prepare_from_sources
from .handoff_build import build_and_run


def verify(plan_path,workspace):
    plan=read_json(Path(plan_path));workspace=Path(workspace).resolve()
    require(plan.get('kind')=='ui_consolidated_delivery_plan_v1' and plan.get('version')=='1.0','CONSOLIDATED_VERSION')
    require(plan.get('digest')==digest({k:v for k,v in plan.items() if k!='digest'}),'CONSOLIDATED_PLAN_CHANGED')
    for ref in plan['inputs']:
        require(sha256(safe_relative(workspace,ref['path']))==ref['sha256'],'CONSOLIDATED_INPUT_CHANGED')
    compiled=safe_relative(workspace,plan['compiledDirectory'])
    # Every compiler input used by the builder must be included in the envelope.
    declared={r['path'] for r in plan['inputs']}
    require(all(p.relative_to(workspace).as_posix() in declared for p in compiled.iterdir() if p.is_file()),'CONSOLIDATED_INPUT_COVERAGE')
    sources={k:{**v,'runDirectory':str(safe_relative(workspace,v['runDirectory']))} for k,v in plan['sources'].items()}
    for key,value in sources.items():
        require(value['expectedRawSha256'] is not None or key==plan['generation']['target'],'CONSOLIDATED_UNBOUND_REUSE')
    return plan,compiled,sources


def run(plan_path,workspace,component_root,output):
    plan,compiled,sources=verify(plan_path,workspace)
    output=Path(output);require(not output.exists(),'OUTPUT_EXISTS');output.mkdir(parents=True)
    from .acceptance_execution import AcceptanceExecution
    execution=AcceptanceExecution(plan['acceptanceTimeoutSeconds'])
    report=dict(kind='ui_consolidated_delivery_execution_v1',planDigest=plan['digest'],status='failed',human_visual_acceptance=False,mediaCalls=0)
    try:
        execution.start('material-join')
        build=prepare_from_sources(compiled,sources,output/'prepared',component_root)
        execution.start('official-acceptance')
        result=build_and_run(build,Path(component_root),output/'acceptance',max(1,int(execution.remaining())))
        report.update(status=result['status'],acceptance='acceptance/handoff-job.json')
        if 'delivery' in result:report['delivery']={**result['delivery'],'path':'acceptance/'+result['delivery']['path']}
    except Exception as exc:
        from .workflow_worker import _error_code
        report['errorCode']=_error_code(exc)
    finally:
        write_json(output/'execution.json',report)
    return report
