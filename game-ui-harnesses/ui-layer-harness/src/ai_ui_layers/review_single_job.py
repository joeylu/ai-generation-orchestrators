"""Strict foreground review of a complete singleton job before registration."""
from pathlib import Path
from .evaluate import read, save
from .experimental_executor import load_job, status
from .postprocess_visual import process
from .single_material_review import review


def run(job, output, model_call=None):
    job, output = Path(job).resolve(), Path(output).resolve()
    config, requests = load_job(job)
    if status(job)['status'] != 'raw_complete':
        raise ValueError('RAW_INCOMPLETE')
    if any(row.get('kind') == 'sheet' for row in requests.values()):
        raise ValueError('SINGLE_REQUESTS_REQUIRED')
    assets = {row['id']: row for row in read(job/'snapshot/execution-plan.candidate.json')['assets']}
    if set(requests) != set(assets):
        raise ValueError('COMPLETE_MATERIAL_SET_REQUIRED')
    output.mkdir(parents=True, exist_ok=False)
    result = dict(status='running', modelCalls=0, humanVisualAcceptance=False,
                  jobDigest=config['digest'], records=[], warnings=[],
                  scope='foreground raw materials only; background and final composite remain pending visual acceptance')
    try:
        # Validate every raw image before spending any review calls.
        preflight = {}
        for key, row in requests.items():
            preflight[key] = process(job/'attempts'/key/'raw.png', row['outputSize'],
                output/'preflight'/key, background=assets[key]['role']=='background')
        save(output/'preflight.json', preflight)
        if any(row['status'] != 'processed_pending_visual_review' for row in preflight.values()):
            raise ValueError('MATERIAL_GATE_FAILED')
        for key in requests:
            if assets[key]['role'] == 'background':
                continue
            result['modelCalls'] += 1
            record = review(job, output/key, model_call=model_call, request_id=key)
            result['records'].append(record)
            if record['status'] != 'reviewed_pending_visual_acceptance' or record.get('blockers'):
                raise ValueError('SINGLE_MATERIAL_REVIEW_BLOCKED:'+key)
            result['warnings'].extend(dict(w, reviewSha256=record['reviewSha256'])
                                      for w in record['warnings'])
        result['status'] = 'reviewed_pending_visual_acceptance'
    except Exception as exc:
        result.update(status='blocked_no_retry', reason=str(exc))
        save(output/'result.json', result)
        raise
    save(output/'result.json', result)
    return result
