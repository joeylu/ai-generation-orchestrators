import _bootstrap
import copy
import json
import tempfile
import unittest
from pathlib import Path
from jsonschema import ValidationError
from PIL import Image
from ai_ui_layers import relation_review as relations
from ai_ui_layers.evaluate import read, digest, check_relations
from ai_ui_layers.compile_visual import HARNESS, compile_plan, verify_run
from ai_ui_layers.planning_dag import init, Dag
from ai_ui_layers.execution_preflight import preflight
from test_planning_dag import FakeModel, SID
from ai_ui_layers.evaluate import save


def plan():
    value=read(HARNESS/'planning-harness/examples/visual-plan-scoped.json')
    value['unknowns']=[]
    a=copy.deepcopy(value['materials'][1]); a.update(id='angled-a',bboxNorm=[.1,.1,.4,.4])
    b=copy.deepcopy(a); b.update(id='angled-b',bboxNorm=[.35,.1,.65,.4])
    value['materials']=[value['materials'][0],a,b]
    background=next(o for o in value['objects'] if o['kind']=='background')
    owner=next(o for o in value['objects'] if o['kind']!='background')
    oa=copy.deepcopy(owner); oa.update(id='angle-a',materialId=a['id'],bboxNorm=None)
    ob=copy.deepcopy(owner); ob.update(id='angle-b',materialId=b['id'],bboxNorm=None)
    value['objects']=[background,oa,ob]
    return value


def response(catalog, disposition='non-occluding'):
    return dict(relationReview=dict(catalogDigest=catalog['digest'],candidateDigest=catalog['candidateDigest'],
        referenceSha256=catalog['referenceSha256'],pairs={r['pairId']:dict(disposition=disposition,
            sourceEvidence='Fixture angled edges leave an open gap inside the intersecting AABB corners.',
            ownershipEvidence='Fixture each closed card contour belongs to its own material.')
            for r in catalog['pairs']}))


class RelationReviewTests(unittest.TestCase):
    def test_two_repairs_preserve_boxes_until_fresh_pair_review(self):
        with tempfile.TemporaryDirectory() as temp:
            temp=Path(temp); Image.new('RGB',(1000,1000)).save(temp/'input.png')
            root=init(temp/'input.png',temp/'run',8); calls=[]; base=FakeModel()
            def model(folder,sid,first):
                calls.append(folder.name)
                if folder.name in ('repair','repair2'):
                    request=read(folder/'request.json')
                    answer=dict(sourcePlanSha256=request['sourcePlanSha256'],
                        materials=dict(upsert=[],remove=[]),objects=dict(upsert=[],remove=[]),
                        unknowns=None,backgroundMode=None,textPolicy=None,unresolvedIssues=[])
                    answer['relationRepair']=response(read(folder/relations.NAME),'uncertain')['relationReview']
                    save(folder/'draft.json',answer)
                    (folder/'events.jsonl').write_text(json.dumps(dict(type='thread.started',thread_id=SID)))
                    save(folder/'transport.json',dict(exitCode=0,turnCompleted=True,unexpectedEvents=[],
                        responseSha256=digest(folder/'draft.json'),elapsedSeconds=.01))
                    return
                # Existing fake supplies coverage only; add explicit pair judgments here.
                if folder.name=='rereview2':
                    from test_planning_dag import bound_review,coverage
                    answer=bound_review(folder,dict(issues=[],coverageAudit=coverage(plan())))
                    save(folder/'draft.json',answer)
                    (folder/'events.jsonl').write_text(json.dumps(dict(type='thread.started',thread_id=SID)))
                    save(folder/'transport.json',dict(exitCode=0,turnCompleted=True,unexpectedEvents=[],
                        responseSha256=digest(folder/'draft.json'),elapsedSeconds=.01))
                else:base(folder,sid,first)
                answer=plan() if first else read(folder/'draft.json')
                if not first:
                    answer.update(response(read(folder/relations.NAME),
                        'non-occluding' if folder.name=='rereview2' else 'uncertain'))
                    answer.pop('smallMaterialAudit',None)
                (folder/'draft.json').write_text(json.dumps(answer),encoding='utf-8')
                transport=read(folder/'transport.json');transport['responseSha256']=digest(folder/'draft.json')
                (folder/'transport.json').write_text(json.dumps(transport),encoding='utf-8')
            result=Dag(root,model).execute()
            self.assertEqual(calls,['m1','m2','repair','rereview','repair2','rereview2'])
            self.assertEqual(result['status'],'frozen')
            self.assertEqual(read(root/'repair2/candidate.json'),plan())
            self.assertTrue(read(root/'repair2/report.json')['programIssues'])
            self.assertEqual(read(root/'rereview2/relation-assessment.json')['blockers'],[])
            self.assertEqual(verify_run(root),plan())
            snapshot=read(root/'frozen/snapshot.json')
            preflight(root/'frozen',snapshot['digest'])

    def test_only_reviewed_hint_is_discharged(self):
        p=plan(); self.assertEqual(len(check_relations(p)),1)
        review=response(relations.catalog(p,'a'*64))
        evidence=relations.assess(p,'a'*64,review)
        self.assertEqual(evidence['blockers'],[])
        compile_plan(p,(1000,1000),'a'*64,relation_evidence=evidence)
        with self.assertRaisesRegex(ValueError,'UNRESOLVED_PLAN_RELATIONS'):
            compile_plan(p,(1000,1000),'a'*64)
        changed=copy.deepcopy(p); changed['materials'][1]['label']+=' changed'
        with self.assertRaises(ValidationError):
            compile_plan(changed,(1000,1000),'a'*64,relation_evidence=evidence)
        with self.assertRaises(ValidationError):
            compile_plan(p,(1000,1000),'b'*64,relation_evidence=evidence)

    def test_missing_extra_uncertain_and_hard_errors_fail_closed(self):
        p=plan(); bound=relations.catalog(p,'a'*64)
        for state in ('real-occlusion','ownership-conflict','uncertain'):
            evidence=relations.assess(p,'a'*64,response(bound,state))
            with self.assertRaisesRegex(ValueError,'UNRESOLVED_PLAN_RELATIONS'):
                compile_plan(p,(1000,1000),'a'*64,relation_evidence=evidence)
        bad=response(bound); bad['relationReview']['pairs']={}
        with self.assertRaises(ValidationError):relations.assess(p,'a'*64,bad)
        bad=response(bound); bad['relationReview']['pairs']['extra']=next(iter(bad['relationReview']['pairs'].values()))
        with self.assertRaises(ValidationError):relations.assess(p,'a'*64,bad)
        p['objects'][1]['materialId']='missing-owner'
        evidence=relations.assess(p,'a'*64,response(relations.catalog(p,'a'*64)))
        self.assertTrue(any(i['code']=='MISSING_MATERIAL' for i in evidence['blockers']))
        with self.assertRaisesRegex(ValueError,'UNRESOLVED_PLAN_RELATIONS'):
            compile_plan(p,(1000,1000),'a'*64,relation_evidence=evidence)

    def test_fresh_dag_freeze_and_replay_preserve_pair_evidence(self):
        with tempfile.TemporaryDirectory() as temp:
            temp=Path(temp); Image.new('RGB',(1000,1000)).save(temp/'input.png')
            root=init(temp/'input.png',temp/'run',8)
            calls=[]; base=FakeModel(repair=False)
            def model(folder,sid,first):
                calls.append(folder.name)
                base(folder,sid,first)
                answer=plan() if first else read(folder/'draft.json')
                if not first:
                    answer.update(response(read(folder/relations.NAME)))
                    if 'smallMaterialAudit' not in read(folder/'schema.json')['properties']:
                        answer.pop('smallMaterialAudit',None)
                (folder/'draft.json').write_text(json.dumps(answer),encoding='utf-8')
                transport=read(folder/'transport.json');transport['responseSha256']=digest(folder/'draft.json')
                (folder/'transport.json').write_text(json.dumps(transport),encoding='utf-8')
            dag=Dag(root,model); result=dag.execute()
            self.assertEqual(calls,['m1','m2']);self.assertEqual(result['status'],'frozen')
            self.assertEqual(verify_run(root),plan())
            snapshot=read(root/'frozen/snapshot.json')
            self.assertEqual(preflight(root/'frozen',snapshot['digest'])['inputChecks'],'passed')
            # A zero-issue review is not enough to pass a changed pair or missing evidence.
            assessment=root/'m2/relation-assessment.json'
            assessment.write_text('{}')
            with self.assertRaises(ValueError):verify_run(root)
