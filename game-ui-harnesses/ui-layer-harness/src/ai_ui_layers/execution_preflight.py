"""Read-only execution input checks for experimental snapshots. No provider calls."""
import argparse
import json
from pathlib import Path
import time

from PIL import Image
from .freeze_visual import inspect
from .compile_visual import validate, render_prompt
from .evaluate import read


def preflight(folder, expected_digest):
    started=time.perf_counter();folder=Path(folder)
    snapshot=inspect(folder,expected_digest)
    if (folder/'surface-details.json').exists() and read(folder/'surface-details.json'):
        raise ValueError('RETIRED_DRAWING_PLAN_REQUIRES_REPLAN')
    required={'execution-plan.candidate.json','reference.png','requests.json'}
    if not required <= snapshot['files'].keys():
        raise ValueError('UNBOUND_EXECUTION_INPUT')
    plan=read(folder/'execution-plan.candidate.json');validate(plan,source_base=folder)
    requests=read(folder/'requests.json')
    if requests.get('kind')!='ui_visual_requests_preview_v1' or requests.get('dispatchEnabled') is not False:
        raise ValueError('REQUEST_PREVIEW_REQUIRED')
    rows=requests['requests'];assets=plan['assets']
    if not (len(rows)==len(assets)==snapshot['plannedCalls']<=snapshot['maximumCalls']):
        raise ValueError('REQUEST_COUNT_MISMATCH')
    with Image.open(folder/'reference.png') as source:
        reference=source.convert('RGBA')
    total=0
    for row,asset in zip(rows,assets):
        if row['asset']!=asset['id'] or row['sourceRegion']!=asset['source_region'] or row['outputSize']!=asset['output_size']:
            raise ValueError('REQUEST_PLAN_MISMATCH')
        if row['reference']!='reference.png' or row['plannedCalls']!=1 or row['automaticRetries']!=0:
            raise ValueError('REQUEST_POLICY_MISMATCH')
        if row['crop'] not in snapshot['files'] or row['prompt'] not in snapshot['files']:
            raise ValueError('UNBOUND_EXECUTION_INPUT')
        if (folder/row['prompt']).read_text(encoding='utf-8')!=render_prompt(asset)+'\n':
            raise ValueError('PROMPT_COMPILER_MISMATCH')
        with Image.open(folder/row['crop']) as crop:
            expected=reference.crop(asset['source_region'])
            if crop.size!=expected.size or crop.convert('RGBA').tobytes()!=expected.tobytes():
                raise ValueError('CROP_REFERENCE_MISMATCH')
        total+=asset['output_size'][0]*asset['output_size'][1]
    return {'kind':'ui_visual_execution_preflight_v1','snapshotDigest':snapshot['digest'],
            'inputChecks':'passed','requestCount':len(rows),'totalTargetPixels':total,
            'generationCalls':0,'dispatchEnabled':False,'status':'execution_route_required',
            'legacyCompatibilityBlockers':snapshot['legacyCompatibilityBlockers'],
            'elapsedSeconds':time.perf_counter()-started}


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--snapshot',required=True);parser.add_argument('--expected-digest',required=True)
    args=parser.parse_args()
    print(json.dumps(preflight(args.snapshot,args.expected_digest),ensure_ascii=False,indent=2))
