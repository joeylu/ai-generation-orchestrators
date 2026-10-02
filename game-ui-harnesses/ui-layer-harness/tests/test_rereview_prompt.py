"""Compact history must preserve findings against the plan actually reviewed."""
import _bootstrap
import copy
import json
import unittest

from ai_ui_layers.evaluate import read,digest
from ai_ui_layers.planning_dag import Dag,prior_findings
from ai_ui_layers.planning_review_policy import split
from ai_ui_layers.compile_visual import verify_run
from ai_ui_layers.freeze_visual import inspect
import test_planning_dag
import test_planning_convergence
import test_revise_plan


FINDINGS_MARKER='上轮待核销问题：'
CANDIDATE_MARKER='检查修补后的完整候选，本次仅复审：\n'


def json_after(text, marker):
    return json.JSONDecoder().raw_decode(text.split(marker,1)[1])[0]


def replace_answer(folder,answer):
    (folder/'draft.json').write_text(json.dumps(answer,ensure_ascii=False),encoding='utf-8')
    receipt=read(folder/'transport.json');receipt['responseSha256']=digest(folder/'draft.json')
    (folder/'transport.json').write_text(json.dumps(receipt),encoding='utf-8')


class RereviewPromptTests(unittest.TestCase):
    def setUp(self):
        test_planning_dag.DagTests.setUp(self)

    def test_derived_findings_and_warning_survive_without_successful_history(self):
        fake=test_planning_dag.FakeModel();before={};observations='Successful original context observation. '*150
        def call(folder,sid,first):
            fake(folder,sid,first)
            if folder.name=='m2':
                answer=read(folder/'draft.json');owner=next(iter(answer['smallMaterialAudit']))
                answer['cosmeticIssues']=[dict(code='DESCRIPTION_WORDING',ids=[owner],
                    description='A minor label wording issue.',suggestedChange='Optional wording adjustment.')]
                for row in answer['coverageAudit']:row['observedArtwork'][0]['evidence']=observations
                answer['coverageAudit'][2]['observedArtwork'].append(test_planning_dag.missing_artwork(
                    'Pale corner ornament','asset-panel','Describe the corner ornament.'))
                item=answer['smallMaterialAudit'][owner]
                focus=read(folder/'coverage-small-materials.json')
                focused=next(row for row in focus['items'] if row['materialId']==owner)
                item['boundary']=test_planning_dag.boundary_for(
                    focused,'clipped','Upper pale tip extends outside candidate.',
                    test_planning_dag.outside_pixel(focused))
                item['parts'][0].update(visiblePart='Pale attached tip',observedAppearance='White tip and dark dot',
                    planEvidenceId=None,suggestedChange='Record the tip and dark dot.')
                replace_answer(folder,answer);before['review']=copy.deepcopy(answer)
            if folder.name=='rereview':
                prompt=(folder/'prompt.md').read_text(encoding='utf-8')
                expected_blockers,expected_warnings=split(before['review'],read(self.root/'m1/draft.json'))
                prior=json_after(prompt,FINDINGS_MARKER)
                self.assertEqual(prior,dict(blockers=expected_blockers,warnings=expected_warnings))
                self.assertEqual({row['code'] for row in prior['blockers']},
                    {'UNASSIGNED_VISIBLE_ARTWORK','SMALL_MATERIAL_BOUNDARY_REVIEW','UNDESCRIBED_SMALL_MATERIAL_PART'})
                self.assertEqual(prior['warnings'][0]['category'],'cosmetic')
                self.assertNotIn(observations,prompt)
                self.assertEqual(json_after(prompt,CANDIDATE_MARKER),read(self.root/'repair/candidate.json'))
        self.assertEqual(Dag(self.root,call).execute()['status'],'frozen')
        self.assertEqual(read(self.root/'m2/draft.json'),before['review'])
        self.assertEqual(read(self.root/'frozen/evidence/m2-draft.json'),before['review'])
        self.assertEqual([name for name,_ in fake.calls],['m1','m2','repair','rereview'])
        findings=read(self.root/'rereview/prior-findings.json')
        self.assertEqual(findings,prior_findings(self.root,'rereview'))
        self.assertEqual(findings['sourcePlanSha256'],digest(self.root/'m1/draft.json'))
        self.assertEqual(findings['reviewSha256'],digest(self.root/'m2/draft.json'))
        self.assertEqual(read(self.root/'frozen/evidence/rereview-prior-findings.json'),findings)
        request=read(self.root/'rereview/request.json')
        self.assertEqual(request['inputs']['prior-findings.json'],digest(self.root/'rereview/prior-findings.json'))
        Dag(self.root,fake).execute();self.assertEqual(len(fake.calls),4)
        (self.root/'rereview/prior-findings.json').write_text('{}')
        with self.assertRaisesRegex(ValueError,'COMPLETED_OUTPUT_CHANGED'):Dag(self.root,fake).verify()
        with self.assertRaisesRegex(ValueError,'REREVIEW_INPUT_CHANGED'):verify_run(self.root)
        (self.root/'frozen/evidence/rereview-prior-findings.json').write_text('{}')
        with self.assertRaisesRegex(ValueError,'ARTIFACT_CHANGED'):inspect(self.root/'frozen')

    def test_new_candidate_quote_cannot_erase_prior_description_finding(self):
        fake=test_planning_dag.FakeModel();owner={};quote='A pale attached tip with a dark dot'
        def call(folder,sid,first):
            fake(folder,sid,first)
            if folder.name=='m2':
                answer=read(folder/'draft.json');owner['id']=next(iter(answer['smallMaterialAudit']))
                item=answer['smallMaterialAudit'][owner['id']];item['parts'][0]['planEvidenceId']=None
                replace_answer(folder,answer)
            if folder.name=='repair':
                answer=read(folder/'draft.json');source=read(self.root/'m1/draft.json')
                material=copy.deepcopy(next(m for m in source['materials'] if m['id']==owner['id']))
                material['label']+=' '+quote
                answer['materials']['upsert']=[m for m in answer['materials']['upsert'] if m['id']!=owner['id']]+[material]
                replace_answer(folder,answer)
            if folder.name=='rereview':
                prior=read(self.root/'m2/draft.json');candidate=read(self.root/'repair/candidate.json')
                with self.assertRaisesRegex(ValueError,'PLAN_EVIDENCE_DIGEST_MISMATCH'):
                    split(prior,candidate)
                findings=json_after((folder/'prompt.md').read_text(encoding='utf-8'),FINDINGS_MARKER)
                self.assertEqual(findings['blockers'],split(prior,read(self.root/'m1/draft.json'))[0])
                self.assertEqual(findings['blockers'][0]['code'],'UNDESCRIBED_SMALL_MATERIAL_PART')
        self.assertEqual(Dag(self.root,call).execute()['status'],'frozen')

    def test_overflow_boundary_findings_are_neither_truncated_nor_deduplicated(self):
        # This fabricated history tests finding cardinality, without a model receipt.
        # Keep its historical raw-plan contract instead of declaring normalization.
        config=self.root/'.dag/config.json';value=read(config);value.pop('normalizationPolicy',None)
        config.write_text(json.dumps(value),encoding='utf-8')
        (self.root/'.dag/config-digest.json').write_text(json.dumps(dict(sha256=digest(config))),encoding='utf-8')
        (self.root/'m1').mkdir();(self.root/'m2').mkdir()
        plan=dict(materials=[],objects=[])
        review=dict(issues=[],smallBoundaryAudit=[dict(materialId=f'icon-{i}',
            boundary=dict(status='uncertain',evidence=f'Visible extension {i} needs verification.')) for i in range(25)])
        for path,value in [('m1/draft.json',plan),('m2/draft.json',review)]:
            (self.root/path).write_text(json.dumps(value),encoding='utf-8')
        findings=prior_findings(self.root,'rereview')
        self.assertEqual(findings['blockers'],split(review,plan)[0])
        self.assertEqual(len(findings['blockers']),25)

    def test_second_rereview_uses_first_repaired_plan_and_first_rereview(self):
        self.calls=[]
        model=test_planning_convergence.ConvergenceTests.model(self)
        self.assertEqual(Dag(self.root,model).execute()['status'],'frozen')
        findings=read(self.root/'rereview2/prior-findings.json')
        self.assertEqual(findings['sourcePlanSha256'],digest(self.root/'repair/candidate.json'))
        self.assertNotEqual(findings['sourcePlanSha256'],digest(self.root/'repair2/candidate.json'))
        self.assertEqual(findings['reviewSha256'],digest(self.root/'rereview/draft.json'))
        self.assertEqual([i['code'] for i in findings['blockers']],['NEW_DETAIL'])
        prompt=(self.root/'rereview2/prompt.md').read_text(encoding='utf-8')
        self.assertEqual(json_after(prompt,CANDIDATE_MARKER),read(self.root/'repair2/candidate.json'))
        self.assertEqual(self.calls,['m1','m2','repair','rereview','repair2','rereview2'])


class RevisionRereviewPromptTests(unittest.TestCase):
    def setUp(self):
        test_revise_plan.RevisionTests.setUp(self)

    def test_child_rereview_binds_parent_review_to_child_source_plan(self):
        root=test_revise_plan.revise(self.parent,self.base/'child','One explicitly requested revision')
        model=lambda folder,sid,first:test_revise_plan.RevisionTests.model(self,folder,sid,first)
        self.assertEqual(test_revise_plan.RevisionDag(root,model).execute()['status'],'frozen')
        findings=read(root/'rereview/prior-findings.json')
        self.assertEqual(findings,prior_findings(root,'rereview'))
        self.assertEqual(findings['sourcePlanSha256'],digest(root/'source-plan.json'))
        self.assertEqual(findings['reviewSha256'],digest(root/'parent-review/draft.json'))
        self.assertEqual(findings['blockers'],split(read(root/'parent-review/draft.json'),read(root/'source-plan.json'))[0])
        self.assertEqual(read(root/'frozen/evidence/rereview-prior-findings.json'),findings)
        self.assertEqual(self.calls,['repair','rereview'])
        (root/'rereview/prior-findings.json').write_text('{}')
        with self.assertRaises(ValueError):verify_run(root)
