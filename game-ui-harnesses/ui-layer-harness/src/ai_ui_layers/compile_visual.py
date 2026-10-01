"""Offline v5 compiler experiment. Produces candidates, never freezes or generates."""
import argparse
import json
from pathlib import Path
import sys
import time

from jsonschema import Draft202012Validator
from PIL import Image

from .evaluate import read, save, digest, pixel_box, check_relations, draw_order
from .short_prompt import carries_foreground
from .visual_policy import validate as validate_visual_policy, planning_policy, generation_guidance

HARNESS = Path(__file__).resolve().parents[4]/'game-ui-harnesses/ui-decomposition-harness'
sys.path.insert(0, str(HARNESS/'src'))
from ai_ui_decomposition.contract import KIND, TEXT_POLICY, GRANULARITY, validate
from ai_ui_decomposition.batch import _prompt


PROMPT_V2 = 'visual-material-prompt-v2:\n'
PROMPT_V3 = 'visual-material-prompt-v3:\n'
from .context_references import PROMPT_PREFIXES, PROMPT_PREFIX_V2, PROMPT_PREFIX_V3, validate_mode

def render_prompt(asset):
    # Historical immutable snapshots retain their original legacy rendering.
    for prefix in PROMPT_PREFIXES:
        if asset['prompt'].startswith(prefix):return asset['prompt'][len(prefix):]
    return asset['prompt'] if asset['prompt'].startswith((PROMPT_V2,PROMPT_V3)) else _prompt(asset)


def compile_plan(visual, size, source_sha, plan_id='visual-candidate', generation_reference='full',
                 context_prompt_version='v3', visual_policy=None):
    validate_mode(generation_reference)
    if visual_policy is not None:
        validate_visual_policy(visual_policy)
        if visual_policy['appearanceEvidence']=='bound-reference' and generation_reference!='context-crops':
            raise ValueError('BOUND_REFERENCE_REQUIRES_CONTEXT_CROPS')
    if visual['kind'] != 'ui_visual_plan_v5':
        raise ValueError('V5_REQUIRED')
    if check_relations(visual):
        raise ValueError('UNRESOLVED_PLAN_RELATIONS')
    if len(visual['materials']) > 128:
        raise ValueError('LEGACY_ASSET_LIMIT')
    assets, nodes, placements = [], [], []
    materials = sorted(visual['materials'], key=lambda m: (m['zOrder'], m['id']))
    for i, material in enumerate(materials):
        key = material['id']; background = material['role'] == 'background'
        l,t,r,b = pixel_box(material['bboxNorm'], *size)
        from .adapt_strip import validate_policy
        validate_policy(visual,material,[r-l,b-t])
        owned = [{'id': o['id'], 'kind': o['kind'], 'label': o['label']}
                 for o in visual['objects'] if o['materialId'] == key]
        overlapping = {m['id'] for m in materials if m['id'] != key
                       and m['role'] != 'background'
                       and (background or (m['bboxNorm'][0] < material['bboxNorm'][2]
                       and m['bboxNorm'][2] > material['bboxNorm'][0]
                       and m['bboxNorm'][1] < material['bboxNorm'][3]
                       and m['bboxNorm'][3] > material['bboxNorm'][1]))}
        excluded = [{'id': o['id'], 'label': o['label']} for o in visual['objects']
                    if o['materialId'] in overlapping]
        prompt = (PROMPT_V2 +
                  'Image 2 is the crop and layout authority; image 1 is context. Reconstruct only this owned artwork (JSON data): '
                  +json.dumps(owned, ensure_ascii=False)+'.\n'
                  'Exclude these overlapping separately owned objects (JSON data): '
                  +json.dumps(excluded, ensure_ascii=False)+'.\n'
                  'Remove ordinary business labels, values and action-button captions, except explicitly owned decorative lettering or logos. Fill removed text spaces with the surrounding surface; '
                  'do not close the spaces or move/enlarge remaining icons. Preserve owned decorative lettering exactly as visible (including plain-font slogans), graphic symbols, '
                  'integrated ornaments, count, order, proportions, colors, and relative spacing.\n')
        if any(o['kind']=='logo' for o in owned):prompt += ' Exception to ordinary-text removal: retain the exact lettering and artwork of the explicitly owned logo/wordmark. Do not remove its glyphs.'
        prompt += ' Preserve fixed dividers, line endpoints, tiny ornaments and decorative marks belonging to this surface; never drop them merely because they are small or noninteractive. Preserve their actual outlines, glow, gradients, material and decorative lettering as part of this generated asset. No program will redraw or restore missing artwork or text.'
        if background:
            prompt += 'Reconstruct the full opaque scene, filling UI-occluded regions from visible scene evidence.'
        else:
            prompt += ('Remove unrelated underlying panels and scene. Where excluded content covers an owned surface, '
                       'continue that surface without placeholders. Preserve the owned frame and attached ornaments. '
                       'For separate shapes grouped in this PNG, keep their individual outlines and original gaps: '
                       'no new shared backing, bridge or connecting strip.\n'
                       'Output a genuine transparent RGBA PNG: alpha=0 outside owned contours and in actual gaps, smooth alpha edges, opaque owned surfaces. No colored backdrop or painted checkerboard. Keep all contours visible, '
                       'with at least 3% canvas margin on EACH side, and at least 10% of the artwork short dimension. '
                       'Add this space outside the artwork; do not stretch artwork to fill the canvas. '
                       'The reference crop is '+str(r-l)+':'+str(b-t)+
                       '; preserve its layout proportions, but its box is not an alpha silhouette.')
        if 'backgroundMode' in visual:
            from .short_prompt import build
            prompt = PROMPT_V3 + build(visual,key,size)
        assets.append(dict(id=key, role='background' if background else 'important_component',
                           route='generated_completion' if background else 'generated_isolation',
                           output_mode='opaque_canvas' if background else 'keyed_component',
                           source_region=[l,t,r,b], output_size=[r-l,b-t], source_asset=None, prompt=prompt))
        nodes.append(dict(id='layer-'+str(i+1), asset=key, xy=[l,t]))
        placements.append(dict(id=key, sourceRegion=[l,t,r,b], outputSize=[r-l,b-t],
                               xy=[l,t], centerXY=[(l+r)/2,(t+b)/2], zOrder=material['zOrder'], drawIndex=i,
                               fitMode='frame-bounds' if carries_foreground(visual,material) else 'contain'))
    plan = dict(kind=KIND, id=plan_id, canvas=list(size),
                source=dict(path='reference.png', sha256=source_sha, size=list(size)),
                text_policy=TEXT_POLICY, granularity=GRANULARITY, assets=assets, nodes=nodes,
                groups=[dict(id='artwork', children=[n['id'] for n in nodes])],
                document=dict(name=plan_id, format='png_zip'), delivery_policy='unreviewed_draft')
    if generation_reference=='context-crops':
        from .context_references import PROMPT_PREFIX_V1, prompt as context_prompt
        if context_prompt_version not in ('v1','v2','v3'):raise ValueError('CONTEXT_PROMPT_VERSION')
        prefix={'v1':PROMPT_PREFIX_V1,'v2':PROMPT_PREFIX_V2,'v3':PROMPT_PREFIX_V3}[context_prompt_version]
        for asset in assets:
            asset['prompt']=prefix+context_prompt(visual,plan,[asset['id']],version=context_prompt_version)
    if visual_policy is not None:
        for asset in assets:asset['prompt']+=generation_guidance(visual_policy)
    return plan, placements


def selected_paths(run):
    if (run/'repair2').exists():return run/'repair2/candidate.json',run/'rereview2/draft.json'
    if (run/'repair').exists():return run/'repair/candidate.json',run/'rereview/draft.json'
    return run/'m1/draft.json',run/'m2/draft.json'


def verify_plan_evidence(folder, review, bound, visual):
    """Rebuild new provenance catalogs without upgrading historical reviews."""
    from .review_evidence import (build_catalog, build_review_schema,
                                  expected_small_material_ids, resolve_review,
                                  PROTOCOL_V1, PROTOCOL_V2)
    schema=read(folder/'schema.json')
    marker='planEvidenceCatalogDigest';name='plan-evidence-catalog.json'
    if marker not in schema.get('properties',{}):
        if (marker in review or 'planEvidenceProtocol' in review or
                'planEvidenceProtocol' in schema.get('properties',{}) or name in bound['inputs']):
            raise ValueError('PLAN_EVIDENCE_SCHEMA_MARKER_REQUIRED')
        return
    v2='planEvidenceProtocol' in schema.get('properties',{})
    if v2!=(('planEvidenceProtocol' in review)) or (
            v2 and review['planEvidenceProtocol']!=PROTOCOL_V2):
        raise ValueError('PLAN_EVIDENCE_PROTOCOL_MISMATCH')
    catalog=build_catalog(visual)
    if name not in bound['inputs']:
        raise ValueError('PLAN_EVIDENCE_CATALOG_INPUT_REQUIRED')
    for filename,expected in bound['inputs'].items():
        if digest(folder/filename)!=expected:
            raise ValueError('PLAN_EVIDENCE_REVIEW_INPUT_CHANGED')
    if read(folder/name)!=catalog:
        raise ValueError('PLAN_EVIDENCE_CATALOG_PLAN_MISMATCH')
    with Image.open(folder.parent/'m1/reference.png') as image:
        width,height=image.size
    selected=expected_small_material_ids(visual,width,height)
    focus_name='coverage-small-materials.json'
    if selected:
        if focus_name not in bound['inputs'] or not (folder/focus_name).is_file():
            raise ValueError('PLAN_EVIDENCE_FOCUS_REQUIRED')
        focus=read(folder/focus_name)
        items=focus['items'];overflow=focus['boundaryOnlyItems']
        if (len(items)!=min(12,len(selected)) or
                [row['materialId'] for row in items+overflow]!=selected):
            raise ValueError('PLAN_EVIDENCE_FOCUS_PLAN_MISMATCH')
    else:
        if focus_name in bound['inputs'] or (folder/focus_name).exists():
            raise ValueError('PLAN_EVIDENCE_UNEXPECTED_FOCUS')
        focus=None
    protocol=PROTOCOL_V2 if v2 else PROTOCOL_V1
    if schema!=build_review_schema(catalog,focus,planning_policy(folder.parent),protocol):
        raise ValueError('PLAN_EVIDENCE_SCHEMA_MISMATCH')
    resolve_review(review,visual)


def verify_boundary_evidence(folder, review, bound, visual, reference):
    """Recheck new coordinate evidence at offline compile/freeze entry points."""
    from .boundary_evidence import uses_bound_schema, validate_boundaries
    if not uses_bound_schema(read(folder/'schema.json')):return
    name='coverage-small-materials.json'
    if name not in bound['inputs']:
        raise ValueError('SMALL_BOUNDARY_FOCUS_INPUT_REQUIRED')
    for filename,expected in bound['inputs'].items():
        if digest(folder/filename)!=expected:
            raise ValueError('SMALL_BOUNDARY_REVIEW_INPUT_CHANGED')
    focus=read(folder/name)
    with Image.open(reference) as image:width,height=image.size
    owners={row['id']:row for row in visual['materials']}
    for row in focus['items']+focus['boundaryOnlyItems']:
        owner=owners.get(row['materialId'])
        if owner is None or owner['role']!='foreground':
            raise ValueError('SMALL_BOUNDARY_FOCUS_OWNER_MISMATCH')
        box=pixel_box(owner['bboxNorm'],width,height)
        if row['sourceBox']!=box:
            raise ValueError('SMALL_BOUNDARY_FOCUS_PLAN_MISMATCH')
        margin=max(16,(max(box[2]-box[0],box[3]-box[1])+1)//2)
        context=[max(0,box[0]-margin),max(0,box[1]-margin),
                 min(width,box[2]+margin),min(height,box[3]+margin)]
        if row['contextBox']!=context:
            raise ValueError('SMALL_BOUNDARY_CONTEXT_PLAN_MISMATCH')
    validate_boundaries(review,focus)


def verify_run(run, *, _allow_issues=False):
    run=Path(run)
    policy=planning_policy(run)
    if (run/'revision.json').exists():
        kind=read(run/'revision.json').get('kind')
        if kind=='ui_explicit_plan_revision_v1':
            from .revise_plan import verify_revision
        elif kind=='ui_rejected_frozen_crop_revision_v1':
            from .revise_frozen_crop import verify_revision
        else:
            raise ValueError('UNKNOWN_REVISION_KIND')
        return verify_revision(run, allow_issues=_allow_issues)
    request = read(run/'request.json'); result = read(run/'result.json')
    for name in ('reference.png', 'prompt.md', 'schema.json'):
        if digest(run/'m1'/name) != request['inputs'][name]:
            raise ValueError('M1_INPUT_CHANGED')
    if digest(run/'m1/draft.json') != result['sourcePlanSha256']:
        raise ValueError('PLAN_CHANGED')
    if digest(run/'m2/draft.json') != result['reviewSha256']:
        raise ValueError('REVIEW_CHANGED')
    review_request = read(run/'m2/request.json')
    if review_request['sourcePlanSha256'] != result['sourcePlanSha256']:
        raise ValueError('REVIEW_PLAN_MISMATCH')
    for name in ('prompt.md','schema.json','review-overlay.png','review-source.md'):
        if digest(run/'m2'/name) != review_request['inputs'][name]:
            raise ValueError('M2_INPUT_CHANGED')
    review = read(run/'m2/draft.json')
    Draft202012Validator(read(run/'m2/schema.json')).validate(review)
    verify_plan_evidence(run/'m2',review,review_request,read(run/'m1/draft.json'))
    verify_boundary_evidence(run/'m2',review,review_request,
                             read(run/'m1/draft.json'),run/'m1/reference.png')
    if result['unknownIssueIds'] or not result['sameSessionVerified']:
        raise ValueError('M2_UNRESOLVED')
    source=run/'m1/draft.json'
    for repair_name,review_name in [('repair','rereview'),('repair2','rereview2')]:
        if not (run/repair_name).exists():continue
        from .local_patch import merge_patch
        from .session_review import session_id
        if not (run/review_name/'result.json').exists():raise ValueError('REPAIRED_CANDIDATE_REQUIRES_NEW_REVIEW')
        merged,patch_report=merge_patch(source,read(run/repair_name/'draft.json'),read(run/'m1/schema.json'),digest(source))
        intermediate_program_issues = (repair_name=='repair' and (run/'repair2').exists())
        if (merged!=read(run/repair_name/'candidate.json') or
                (patch_report['programIssues'] and not intermediate_program_issues) or
                patch_report['unresolvedIssues']):
            raise ValueError('INVALID_REPAIR')
        rr=run/review_name;bound=read(rr/'request.json');receipt=read(rr/'result.json')
        transport=read(rr/'transport.json')
        if transport['exitCode'] or not transport['turnCompleted'] or transport.get('responseSha256')!=digest(rr/'draft.json'):
            raise ValueError('INVALID_REREVIEW_RECEIPT')
        if bound['sessionId']!=result['sessionId']:raise ValueError('SESSION_CHANGED')
        if bound['candidateSha256']!=digest(run/repair_name/'candidate.json') or bound['patchSha256']!=digest(run/repair_name/'draft.json'):
            raise ValueError('REPAIR_CHANGED')
        for name,value in bound['inputs'].items():
            if digest(rr/name)!=value:raise ValueError('REREVIEW_INPUT_CHANGED')
        if receipt['reviewSha256']!=digest(rr/'draft.json') or not receipt['sameSessionVerified']:
            raise ValueError('REREVIEW_CHANGED')
        if session_id(rr/'events.jsonl')!=result['sessionId']:raise ValueError('SESSION_CHANGED')
        review=read(rr/'draft.json');Draft202012Validator(read(rr/'schema.json')).validate(review)
        verify_plan_evidence(rr,review,bound,read(run/repair_name/'candidate.json'))
        verify_boundary_evidence(rr,review,bound,read(run/repair_name/'candidate.json'),
                                 run/'m1/reference.png')
        source=run/repair_name/'candidate.json'
    from .planning_review_policy import split
    visual = read(selected_paths(run)[0])
    if split(review,visual,visual_policy=policy)[0] and not _allow_issues:raise ValueError('M2_UNRESOLVED')
    Draft202012Validator(read(run/'m1/schema.json')).validate(visual)
    return visual


def compile_run(run, output, max_calls=128, generation_mode="single", generation_reference="full",
                context_prompt_version='v3'):
    validate_mode(generation_reference)
    if context_prompt_version not in ('v1','v2','v3'):raise ValueError('CONTEXT_PROMPT_VERSION')
    started = time.perf_counter(); run=Path(run); output=Path(output)
    if max_calls < 1:
        raise ValueError('INVALID_CALL_LIMIT')
    visual = verify_run(run)
    policy=planning_policy(run)
    plan_path,review_path=selected_paths(run)
    if generation_mode not in ('single','sheets'):raise ValueError('GENERATION_MODE')
    source = run/'m1/reference.png'; before=digest(source)
    with Image.open(source) as image:
        if image.getexif().get(274, 1) != 1:
            raise ValueError('NONIDENTITY_COORDINATE_MAPPING')
        image.load(); picture=image.convert('RGBA')
    plan, placements = compile_plan(visual, picture.size, before,
                                    generation_reference=generation_reference,
                                    context_prompt_version=context_prompt_version,visual_policy=policy)
    from .generation_groups import build_groups, DEFAULT_GROUP_POLICY, CONTEXT_GROUP_POLICY
    groups=build_groups(visual,plan,CONTEXT_GROUP_POLICY if generation_reference=='context-crops' else DEFAULT_GROUP_POLICY) if generation_mode=='sheets' else None
    calls=groups['plannedCalls'] if groups else len(plan['assets'])
    if calls>max_calls:raise ValueError('CALL_LIMIT_EXCEEDED')
    output.mkdir(parents=True, exist_ok=False)
    if policy is not None:
        (output/'visual-policy.json').write_bytes((run/'.dag/inputs/visual-policy.json').read_bytes())
    if groups:save(output/'generation-groups.json',groups)
    (output/'reference.png').write_bytes(source.read_bytes())
    if digest(output/'reference.png') != before:
        raise ValueError('REFERENCE_CHANGED')
    summary = validate(plan, source_base=output)
    save(output/'execution-plan.candidate.json', plan)
    save(output/'placements.json', {'basis':'declared material regions, no alpha measurement', 'materials':placements})
    save(output/'draw-order.json', draw_order(visual, digest(plan_path)))
    artifacts=[]
    for asset in plan['assets']:
        folder=output/'materials'/asset['id'];folder.mkdir(parents=True)
        picture.crop(asset['source_region']).save(folder/'reference-crop.png')
        (folder/'prompt.txt').write_text(render_prompt(asset)+'\n', encoding='utf-8')
        artifacts.append({'id':asset['id'], 'crop':(folder/'reference-crop.png').relative_to(output).as_posix(),
                          'cropSha256':digest(folder/'reference-crop.png'),
                          'prompt':(folder/'prompt.txt').relative_to(output).as_posix(),
                          'promptSha256':digest(folder/'prompt.txt')})
    if generation_reference=='context-crops':
        from .context_references import materialize
        save(output/'generation-references.json',materialize(output,plan,picture))
    blockers=[{'code':'LEGACY_VISIBLE_SUPPORT_MISSING', 'ids':[a['id'] for a in plan['assets'] if a['role']!='background'],
               'reason':'No measured/reference-observed foreground_support with reference-fit-v1; crop estimates cannot substitute.'},
              {'code':'LEGACY_COVERAGE_EVIDENCE_MISSING',
               'ids':[o['id'] for o in visual['objects'] if o['bboxNorm'] is None],
               'reason':'Legacy coverage requires independently localized object observations and review; do not copy material boxes into missing object regions.'},
              {'code':'LEGACY_GRANULARITY_EVIDENCE_MISSING',
               'reason':'Visual unit membership, split justifications and connections are not supplied by v5.'}]
    if visual['unknowns']:
        blockers.append({'code':'UNRESOLVED_UNKNOWNS','items':visual['unknowns']})
    if any(o['kind']=='logo' for o in visual['objects']):
        blockers.append({'code':'LEGACY_LOGO_PROMPT_CONFLICT','reason':'Legacy request template excludes logos; preservation policy needs explicit adapter resolution.'})
    report={'kind':'visual_compile_experiment_v1','status':'compiled_candidate_freeze_blocked',
            'sourcePlanSha256':digest(plan_path),'reviewSha256':digest(review_path),
            'sourceImageSha256':before,'candidateSha256':digest(output/'execution-plan.candidate.json'),
            'legacyStructureValidation':summary,'materialCount':len(plan['assets']),
            'layerCount':len(plan['nodes']),'plannedCalls':calls,'maximumCalls':max_calls,
            **({'generationReference':'context-crops'} if generation_reference=='context-crops' else {}),
            **({'contextPromptVersion':context_prompt_version} if generation_reference=='context-crops' and context_prompt_version!='v1' else {}),
            'generationCalls':0,'freezeExecuted':False,'productionReady':False,'humanVisualAcceptance':False,
            'blockers':blockers,'artifacts':artifacts,'elapsedSeconds':time.perf_counter()-started}
    if policy is not None:
        report['visualPolicySha256']=digest(output/'visual-policy.json')
    save(output/'compile-report.json', report)
    return report


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--run',required=True);parser.add_argument('--output',required=True)
    parser.add_argument('--max-calls',type=int,default=128)
    parser.add_argument('--generation-mode',choices=['single','sheets'],default='single')
    parser.add_argument('--generation-reference',choices=['full','context-crops'],default='full')
    opts=parser.parse_args()
    result=compile_run(opts.run,opts.output,opts.max_calls,opts.generation_mode,opts.generation_reference)
    print(json.dumps({k:result[k] for k in ('status','materialCount','plannedCalls','elapsedSeconds','blockers')},ensure_ascii=False))
