"""Compile a verified audit into a fresh, unsubmitted plan using existing contracts."""
from copy import deepcopy
from pathlib import Path
import shutil

from . import batch
from .cached import result_binding, verified_result
from .common import digest, identifier, read_json, require, safe_relative, sha256, write_json
from .contract import validate


STRATEGIES = {
    'LONG_CONTROL_SUPPORT_ASPECT_MISMATCH': 'Render the foreground itself at the exact requested width:height ratio, not merely the canvas. Use a full-length empty fill template without a surrounding slot, frame, old partial value or excessive end margins. Do not shorten the strip to match the visible reference value; runtime clipping owns that value.',
    'missing_transparent_pixels': 'Keep at least one full target pixel of clear outside margin on every edge after fitting. For keyed output this margin must be uniformly the declared key color; do not extend the frame or shadow to all canvas corners.',
    'baked_state_part': 'Isolate only the requested owning part. Remove the baked dependent state part entirely; do not reproduce a complete assembled control. For an empty switch track, no thumb, knob or ON/OFF text may be present.',
    'wrong_semantic_asset': 'Follow the named part in the original prompt rather than copying unrelated objects visible in the full reference. Produce exactly that symbol and no surrounding item, container or decoration.',
}


def compile_plan(run: Path, source_plan: Path, audit_path: Path, output: Path,
                 plan_id: str, source_runs: list[Path] = ()) -> dict:
    frozen, original = batch.load(run)
    require(digest(read_json(source_plan)) == digest(original), 'REPAIR_SOURCE_PLAN_CHANGED')
    report = read_json(audit_path)
    require(report.get('kind') == 'ai_ui_material_audit_v1' and
            report.get('digest') == digest({k:v for k,v in report.items() if k!='digest'}), 'REPAIR_AUDIT_CHANGED')
    require(report.get('plan_digest') == digest(original) and report.get('batch_digest') == frozen['digest'], 'REPAIR_AUDIT_BINDING')
    require(report.get('profile') == 'functional-draft-v1', 'REPAIR_AUDIT_PROFILE')
    generated = {a['id']:a for a in original['assets'] if a['route'].startswith('generated_')}
    rows = report.get('assets', [])
    require(len(rows)==len(generated) and {r['asset'] for r in rows}==set(generated), 'REPAIR_AUDIT_COVERAGE')
    decisions = {}
    sources = {}
    for row in rows:
        key = row['asset']
        _, _, _, raw = verified_result(run, key)
        require(row['raw_sha256']==sha256(raw), 'REPAIR_RAW_CHANGED')
        require(not any(i['severity']=='needs_review' for i in row['issues']), 'REPAIR_UNRESOLVED_REVIEW')
        blockers = sorted({i['category'] for i in row['issues'] if i['severity']=='blocking'})
        require(all(c in STRATEGIES for c in blockers), 'REPAIR_STRATEGY_UNSUPPORTED')
        decisions[key] = blockers
        if not blockers:
            # Reuse must point to an original received result, never a reused receipt chain.
            for candidate in [run, *source_runs]:
                source_frozen, source_plan_body = batch.load(candidate)
                if key not in source_frozen['requests']:
                    continue
                entry = source_frozen['requests'][key]
                if batch.state(candidate, entry) != 'received':
                    continue
                binding = result_binding(candidate, key)
                source_asset = next(a for a in source_plan_body['assets'] if a['id']==key)
                fields = ('role','route','source_region','output_size','output_mode','prompt','source_asset')
                if binding['raw_sha256']==row['raw_sha256'] and source_frozen['source_sha256']==frozen['source_sha256'] and all(source_asset[k]==generated[key][k] for k in fields):
                    sources[key]=(candidate,binding)
                    break
            require(key in sources, 'REPAIR_ORIGINAL_REUSE_SOURCE_REQUIRED')
    require(not output.exists(), 'REPAIR_OUTPUT_EXISTS')
    plan = deepcopy(original)
    plan['id'] = identifier(plan_id)
    base = source_plan.resolve().parent
    # Validate identities before creating any output; copy allowlisted inputs only.
    validate(plan, source_base=base)
    output.mkdir(parents=True)
    for obj in [plan['source'], *[a['material_source'] for a in plan['assets'] if a['route']=='imported_material']]:
        src = safe_relative(base, obj['path'])
        dst = safe_relative(output, obj['path'])
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(src, dst)
        require(sha256(dst)==obj['sha256'], 'REPAIR_INPUT_COPY_CHANGED')
    for asset in plan['assets']:
        key=asset['id']
        if key not in decisions:
            continue
        if decisions[key]:
            asset.pop('cached_result',None)
            asset['prompt'] += '\nRepair constraints: ' + ' '.join(STRATEGIES[c] for c in decisions[key])
        else:
            asset['cached_result']=sources[key][1]
    summary = validate(plan, source_base=output)
    write_json(output/'plan.json',plan)
    result = dict(kind='ai_ui_material_repair_plan_v1', audit_digest=report['digest'],
        plan_digest=digest(plan), maximum_calls=summary['generated_requests'], automatic_retries=0,
        replacements=[k for k,v in decisions.items() if v], reuse=list(sources),
        strategies={k:v for k,v in decisions.items() if v}, compute_authorized=False,
        human_visual_acceptance=False)
    result['digest']=digest(result)
    write_json(output/'repair-plan.json',result)
    return result
