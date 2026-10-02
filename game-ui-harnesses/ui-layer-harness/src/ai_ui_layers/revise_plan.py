"""Explicit, single-round child revision of a failed planning rereview. No media."""
import argparse
import json
from pathlib import Path
from jsonschema import Draft202012Validator
from . import planning_dag as planning
from .compile_visual import verify_run, selected_paths
from .evaluate import read, save, digest
from .local_patch import merge_patch
from .session_review import session_id
from .freeze_visual import freeze
from .planning_review_policy import split
from .visual_policy import planning_policy, INPUT_NAME


def verify_parent(source):
    config=read(source/'.dag/config.json')
    policy=planning_policy(source)
    if digest(source/'.dag/config.json')!=read(source/'.dag/config-digest.json')['sha256']:
        raise ValueError('PARENT_CONFIG_CHANGED')
    for name,sha in config['inputs'].items():
        if digest(source/'.dag/inputs'/name)!=sha:raise ValueError('PARENT_INPUT_CHANGED')
    for done in (source/'.dag').glob('*/done.json'):
        for name,sha in read(done)['outputs'].items():
            if digest(source/name)!=sha:raise ValueError('PARENT_OUTPUT_CHANGED')
    if (config['model'],config['effort'])!=(planning.CLI_MODEL,planning.CLI_EFFORT):
        raise ValueError('MODEL_CHANGED_NEW_SESSION_REQUIRED')
    failed=source/'.dag/rereview/failed.json'
    if not failed.exists() or read(failed)['error']!='ValueError: REREVIEW_UNRESOLVED':
        raise ValueError('FAILED_REREVIEW_REQUIRED')
    if (source/'frozen').exists():raise ValueError('UNFROZEN_PARENT_REQUIRED')
    verify_run(source,_allow_issues=True)
    if not split(read(source/'rereview/draft.json'),read(selected_paths(source)[0]),policy,
                 config.get('coverageTextPolicy'))[0]:
        raise ValueError('PARENT_ISSUES_REQUIRED')


def init(source, output, reason):
    source=Path(source).resolve();output=Path(output).resolve()
    if not reason.strip():raise ValueError('EXPLICIT_REVISION_REASON_REQUIRED')
    if output==source or output.is_relative_to(source):raise ValueError('SEPARATE_REVISION_REQUIRED')
    verify_parent(source)
    evidence={p.relative_to(source).as_posix():digest(p) for p in source.rglob('*')
              if p.is_file() and p.name!='lock'}
    config=read(source/'.dag/config.json')
    policy=planning_policy(source)
    notes=source/'.dag/inputs/planning-notes.txt'
    generation_reference=config.get('generationReference','full')
    context_version=(config.get('contextPromptVersion','v3')
                     if generation_reference=='context-crops' else None)
    planning.init(source/'m1/reference.png',output,config['maxCalls'],config.get('generationMode','single'),
                  notes if notes.exists() else None,generation_reference,
                  source/'.dag/inputs'/INPUT_NAME if policy is not None else None,
                  context_version)
    (output/'m1').mkdir();(output/'parent-review').mkdir()
    for name in ('reference.png','schema.json'):
        (output/'m1'/name).write_bytes((source/'m1'/name).read_bytes())
    (output/'source-plan.json').write_bytes(selected_paths(source)[0].read_bytes())
    (output/'session.json').write_bytes((source/'session.json').read_bytes())
    for name in ('draft.json','review-overlay.png'):
        (output/'parent-review'/name).write_bytes((source/'rereview'/name).read_bytes())
    inputs={p.relative_to(output).as_posix():digest(p) for p in output.rglob('*')
            if p.is_file() and '.dag' not in p.relative_to(output).parts}
    save(output/'revision.json',dict(kind='ui_explicit_plan_revision_v1',reason=reason,
         parent=str(source),parentFiles=evidence,inputs=inputs,maximumRepairs=1,
         mediaGenerationCalls=0,automaticRetry=False))
    save(output/'revision-digest.json',{'sha256':digest(output/'revision.json')})
    check_inputs(output)
    return output


def check_inputs(root):
    if digest(root/'revision.json')!=read(root/'revision-digest.json')['sha256']:
        raise ValueError('REVISION_CHANGED')
    record=read(root/'revision.json')
    for name,sha in record['inputs'].items():
        if digest(root/name)!=sha:raise ValueError('REVISION_INPUT_CHANGED')
    source=Path(record['parent'])
    for name,sha in record['parentFiles'].items():
        if digest(source/name)!=sha:raise ValueError('PARENT_EVIDENCE_CHANGED')
    if (read(root/'.dag/config.json')['inputs'].get(INPUT_NAME) !=
            read(source/'.dag/config.json')['inputs'].get(INPUT_NAME)):
        raise ValueError('REVISION_VISUAL_POLICY_CHANGED')
    if planning_policy(root)!=planning_policy(source):
        raise ValueError('REVISION_VISUAL_POLICY_CHANGED')
    parent=read(source/'.dag/config.json');child=read(root/'.dag/config.json')
    if (child.get('generationMode','single')!=parent.get('generationMode','single') or
            child.get('generationReference','full')!=parent.get('generationReference','full') or
            (parent.get('generationReference','full')=='context-crops' and
             child.get('contextPromptVersion','v3')!=parent.get('contextPromptVersion','v3'))):
        raise ValueError('REVISION_GENERATION_POLICY_CHANGED')


def verify_revision(root, allow_issues=False):
    check_inputs(root)
    policy=planning_policy(root)
    sid=read(root/'session.json')['sessionId']
    for stage in ('repair','rereview'):
        folder=root/stage;request=read(folder/'request.json');receipt=read(folder/'transport.json')
        if (receipt.get('failure') or receipt['exitCode'] or not receipt['turnCompleted']
                or receipt['unexpectedEvents'] or receipt['responseSha256']!=digest(folder/'draft.json')):
            raise ValueError('INVALID_REVISION_RECEIPT')
        if request['sessionId']!=sid or session_id(folder/'events.jsonl')!=sid:
            raise ValueError('SESSION_CHANGED')
        for name,sha in request['inputs'].items():
            if digest(folder/name)!=sha:raise ValueError('REVISION_CALL_INPUT_CHANGED')
        if request['originalReferenceSha256']!=digest(root/'m1/reference.png'):
            raise ValueError('REVISION_REFERENCE_CHANGED')
        Draft202012Validator(read(folder/'schema.json')).validate(read(folder/'draft.json'))
    source=root/'source-plan.json';repair=root/'repair';review=root/'rereview'
    config=read(root/'.dag/config.json')
    check_scope(root)
    bound=read(repair/'request.json')
    if bound['sourcePlanSha256']!=digest(source) or bound['reviewSha256']!=digest(root/'parent-review/draft.json'):
        raise ValueError('REVISION_SOURCE_CHANGED')
    from . import relation_review
    relations=(relation_review.catalog(read(source),digest(root/'m1/reference.png'))
               if config.get('relationReviewPolicy')==relation_review.POLICY else None)
    strict_schema=(root/'.dag/inputs/storage-schema.json'
                   if config.get('normalizationPolicy') is not None else root/'m1/schema.json')
    candidate,report=merge_patch(source,read(repair/'draft.json'),read(strict_schema),digest(source),relations)
    hard_issues=[issue for issue in report['programIssues']
                 if relations is None or issue['code']!='SAME_LAYER_OVERLAP_REVIEW']
    if candidate!=read(repair/'candidate.json') or hard_issues or report['unresolvedIssues'] or candidate['unknowns']:
        raise ValueError('REVISION_INVALID_PATCH')
    bound=read(review/'request.json')
    if bound['candidateSha256']!=digest(repair/'candidate.json') or bound['patchSha256']!=digest(repair/'draft.json'):
        raise ValueError('REVISION_REVIEW_MISMATCH')
    from .compile_visual import verify_boundary_evidence, verify_plan_evidence
    verify_plan_evidence(review,read(review/'draft.json'),bound,candidate)
    verify_boundary_evidence(review,read(review/'draft.json'),bound,candidate,
                             root/'m1/reference.png')
    blockers,warnings=split(read(review/'draft.json'),candidate,policy,config.get('coverageTextPolicy'))
    if relation_review.policy(root):
        evidence=relation_review.verify_stage(root,review,candidate)
        blockers+=planning.Dag.relation_blockers(evidence['blockers'])
        assessment=read(review/'assessment.json')
        if assessment!=dict(blockers=blockers,warnings=warnings,reviewSha256=digest(review/'draft.json')):
            raise ValueError('REVISION_ASSESSMENT_CHANGED')
    if blockers and not allow_issues:raise ValueError('M2_UNRESOLVED')
    return candidate


def check_scope(root):
    plan=read(root/'source-plan.json');patch=read(root/'repair/draft.json')
    parent=Path(read(root/'revision.json')['parent'])
    parent_config=read(parent/'.dag/config.json')
    ids={key for issue in split(read(root/'parent-review/draft.json'),plan,planning_policy(parent),
                               parent_config.get('coverageTextPolicy'))[0]
         for key in issue['ids']}
    owners=ids|{o['materialId'] for o in plan['objects'] if o['id'] in ids}
    allowed={'materials':{m['id'] for m in plan['materials'] if m['id'] in owners},
             'objects':{o['id'] for o in plan['objects'] if o['materialId'] in owners}}
    for field in allowed:
        changed=set(patch[field]['remove'])|{row['id'] for row in patch[field]['upsert']}
        if not changed<=allowed[field]:raise ValueError('REVISION_OUTSIDE_REVIEW_SCOPE')
    for field in ('backgroundMode','textPolicy','unknowns'):
        if patch.get(field) is not None and patch[field]!=plan[field]:
            raise ValueError('REVISION_GLOBAL_CHANGE')


class RevisionDag(planning.Dag):
    def verify(self):
        super().verify();check_inputs(self.root)

    def repair_check(self, source=None):
        check_scope(self.root);super().repair_check(source)

    def execute(self):
        with planning.locked(self.root):
            self.node('repair',lambda:self.repair(self.root/'source-plan.json',self.root/'parent-review'))
            self.node('repair_check',lambda:self.repair_check(self.root/'source-plan.json'))
            self.node('rereview',lambda:self.review('rereview',self.root/'repair/candidate.json',
                                                  self.root/'repair/preview/materials-overlay.png'))
            self.node('freeze',lambda:freeze(self.root,self.root/'frozen',self.config['maxCalls'],
                                            self.config['generationMode'],self.config.get('generationReference','full'),
                                            self.config.get('contextPromptVersion','v3')))
            return {'status':'frozen','snapshotDigest':read(self.root/'frozen/snapshot.json')['digest'],
                    'mediaGenerationCalls':0,'automaticRetry':False,'humanVisualAcceptance':False}


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--source',required=True,help='Failed planning directory, not delivery root')
    p.add_argument('--output',required=True);p.add_argument('--reason',required=True)
    a=p.parse_args()
    try:print(json.dumps(RevisionDag(init(a.source,a.output,a.reason)).execute(),ensure_ascii=False))
    except Exception as exc:
        print(json.dumps({'status':'stopped','reason':str(exc),'automaticRetry':False}));raise SystemExit(1)
