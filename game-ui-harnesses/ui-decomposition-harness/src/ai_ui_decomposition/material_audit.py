"""Offline, exhaustive material triage. Never grants compute or export approval."""
from pathlib import Path

from PIL import Image

from . import batch
from .cached import verified_result
from .common import ContractError, digest, read_json, require, sha256, write_json
from .media import contain, matte_key, opaque_exact, require_long_control_geometry, resize_material


COSMETIC = {'texture_difference', 'minor_color_difference', 'font_style_difference'}
BLOCKING = {'baked_state_part', 'wrong_semantic_asset', 'layout_overflow',
            'state_registration_error', 'text_unreadable', 'interaction_failure'}


def audit(run: Path, output: Path, observations: Path | None = None) -> dict:
    frozen, plan = batch.load(run)
    require(not output.exists(), 'AUDIT_OUTPUT_EXISTS')
    findings = read_json(observations) if observations else None
    if findings is not None:
        require(findings.get('kind') == 'ai_ui_material_observations_v1', 'AUDIT_OBSERVATIONS_KIND')
        require(findings.get('plan_digest') == digest(plan), 'AUDIT_PLAN_CHANGED')
        require(isinstance(findings.get('findings'), list), 'AUDIT_FINDINGS_REQUIRED')
    assets = {a['id']: a for a in plan['assets'] if a['route'].startswith('generated_')}
    raw_paths = {}
    for key in assets:
        verified_result(run, key)
        raw_paths[key] = run/'requests'/frozen['requests'][key]['id']/'raw.png'
    for item in (findings or {}).get('findings', []):
        require(isinstance(item, dict) and item.get('asset') in assets, 'AUDIT_ASSET_REFERENCE')
        require(item.get('raw_sha256') == sha256(raw_paths[item['asset']]), 'AUDIT_SOURCE_CHANGED')
        require(item.get('category') in COSMETIC | BLOCKING | {'uncertain'}, 'AUDIT_CATEGORY')
        require(item.get('observer') in {'human', 'model', 'local-check'}, 'AUDIT_OBSERVER')
        require(isinstance(item.get('evidence'), str) and item['evidence'].strip(), 'AUDIT_EVIDENCE_REQUIRED')
    output.mkdir(parents=True)
    rows = []
    for key, asset in assets.items():
        raw = raw_paths[key]
        issues = []
        row = dict(asset=key, raw_sha256=sha256(raw), target_size=asset['output_size'], issues=issues)
        try:
            with Image.open(raw) as source:
                material = (matte_key(source, asset['output_size']) if asset['output_mode']=='keyed_component'
                            else opaque_exact(source, asset['output_size']) if asset['output_mode']=='opaque_canvas'
                            else contain(source, asset['output_size']))
            if asset['route']=='generated_isolation' and 'resize' not in asset:
                require_long_control_geometry(material, asset['output_size'], asset.get('foreground_support'))
            material = resize_material(material, asset)
            row['alpha_bounds'] = material.getchannel('A').getbbox()
            row['alpha_extrema'] = list(material.getchannel('A').getextrema())
            if asset['output_mode'] != 'opaque_canvas':
                if row['alpha_bounds'] is None:
                    issues.append(dict(severity='blocking', category='empty_material'))
                elif row['alpha_extrema'][0] != 0:
                    issues.append(dict(severity='blocking', category='missing_transparent_pixels'))
        except ContractError as exc:
            issues.append(dict(severity='blocking', category=str(exc)))
        for item in (findings or {}).get('findings', []):
            if item['asset'] == key:
                issues.append(dict(item, severity=('warning' if item['category'] in COSMETIC else
                              'needs_review' if item['category']=='uncertain' else 'blocking')))
        row['action'] = ('repair_proposal' if any(i['severity']=='blocking' for i in issues) else
                         'review_evidence' if any(i['severity']=='needs_review' for i in issues) else
                         'reuse_candidate')
        rows.append(row)
    result = dict(kind='ai_ui_material_audit_v1', profile='functional-draft-v1',
                  plan_digest=digest(plan), batch_digest=frozen['digest'], assets=rows,
                  observations_digest=digest(findings) if findings else None,
                  semantic_review='caller_observations' if findings else 'not_performed',
                  status='needs_repair' if any(r['action']=='repair_proposal' for r in rows) else 'audit_complete',
                  human_visual_acceptance=False, visual_acceptance_ready=False,
                  compute_authorized=False, automatic_retries=0,
                  limitations=['Material triage only; runtime, state and reference acceptance remain required.',
                               'No automatic semantic detector or generation repair executor.'])
    result['digest'] = digest(result)
    write_json(output/'material-audit.json', result)
    write_json(output/'repair-proposal.json', dict(kind='ai_ui_material_repair_proposal_v1',
        audit_digest=result['digest'], replacements=[r['asset'] for r in rows if r['action']=='repair_proposal'],
        review_required=[r['asset'] for r in rows if r['action']=='review_evidence'],
        reuse_candidates=[r['asset'] for r in rows if r['action']=='reuse_candidate'],
        executable=False, requires_fresh_frozen_plan_authorization=True, human_visual_acceptance=False))
    return result
