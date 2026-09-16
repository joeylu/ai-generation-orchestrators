"""Explicit measured processing revision for a returned, still-reserved result.

No provider call, no replay of rejected/indeterminate batches, no implicit approval.
Revalidates actual source, approved measurements and extraction before raw import.
"""
from pathlib import Path
from .common import require,read_json,sha256,digest,write_json
from . import batch
from .adapter import _verified_handoff,import_result
from .board_extraction_revision import revise


def receive(run,bundle,strategy_path,revision_path,output,approval):
    run,bundle,output=Path(run),Path(bundle),Path(output)
    require(isinstance(approval,str) and bool(approval.strip()),'REVISION_APPROVAL_REQUIRED')
    h=_verified_handoff(bundle);frozen,plan=batch.load(run);key=h['asset']
    require(h['batch_digest']==frozen['digest'],'ADAPTER_BATCH_CHANGED')
    require(batch.state(run,frozen['requests'][key])=='reserved','REVISION_RESERVED_RESULT_REQUIRED')
    report=read_json(Path(revision_path))
    require(report.get('kind')=='ai_ui_board_extraction_revision_v1' and report.get('version')=='1.0' and
            report.get('digest')==digest({k:v for k,v in report.items() if k!='digest'}),'REVISION_REPORT_CHANGED')
    raw=bundle/'result.png';require(sha256(raw)==report['raw_sha256'],'BOARD_RAW_CHANGED')
    item=next(a for a in plan['assets'] if a['id']==key)
    require(f"component-family-board-v1:{report['original_strategy_digest']}:{report['board']}" in item['prompt'],'BOARD_PLAN_BINDING')
    # Re-extract from actual pixels; supplied part PNGs or claimed pass are never trusted.
    checked=revise(raw,Path(strategy_path),report['board'],report['raw_sha256'],report['extraction_policy'],report['reason'],output,report.get('measuredFrames'))
    require(checked['digest']==report['digest'],'REVISION_REPRODUCTION_CHANGED')
    directory=run/'requests'/frozen['requests'][key]['id']
    require(not (directory/'processing-revision.json').exists(),'REVISION_ALREADY_RECORDED')
    record=dict(kind='ui_explicit_processing_revision_v1',version='1.0',asset=key,batchDigest=frozen['digest'],
                rawSha256=report['raw_sha256'],revisionDigest=checked['digest'],approval=approval,
                originalPolicyUnchanged=True,originalPolicyPassed=False,human_visual_acceptance=False,
                specification=dict(version='1.0',originalStrategyDigest=checked['original_strategy_digest'],
                                   policy=checked['extraction_policy'],reason=checked['reason'],**({'measuredFrames':checked['measuredFrames']} if 'measuredFrames'in checked else {})))
    record['digest']=digest(record);write_json(directory/'processing-revision.json',record)
    return import_result(run,bundle)
