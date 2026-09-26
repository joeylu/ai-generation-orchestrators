import _bootstrap
import copy,json,tempfile,unittest
from pathlib import Path
from PIL import Image
from ai_ui_layers.planning_dag import init,Dag
from ai_ui_layers.compile_visual import verify_run
from ai_ui_layers.evaluate import read,save,digest
from test_planning_dag import FakeModel,SID,coverage,small_audit

class ConvergenceTests(unittest.TestCase):
    def setUp(self):
        t=tempfile.TemporaryDirectory();self.addCleanup(t.cleanup)
        root=Path(t.name);image=root/'input.png';Image.new('RGB',(1000,1000)).save(image)
        self.root=init(image,root/'run',8)
        self.calls=[]

    def model(self,terminal=False,cosmetic=False,bad=False):
        def call(folder,sid,first):
            self.calls.append(folder.name)
            if first:return FakeModel()(folder,sid,first)
            if folder.name in ('m2','rereview','rereview2'):
                issues=[]
                if folder.name!='rereview2' or terminal:
                    code={'m2':'FIRST','rereview':'NEW_DETAIL','rereview2':'THIRD'}[folder.name]
                    issues=[dict(code=('INVALID' if bad else 'MINOR_COLOR_TONE') if cosmetic else code,
                        category='cosmetic' if cosmetic else 'semantic',ids=['asset-panel'],
                        description='Visible evidence for this discrepancy.',suggestedChange='Clarify affected description.')]
                answer=dict(issues=issues,coverageAudit=coverage(),smallMaterialAudit=small_audit(folder))
            else:
                source=folder.parent/('repair/candidate.json' if folder.name=='repair2' else 'm1/draft.json')
                panel=copy.deepcopy(read(source)['materials'][1]);panel['label']+=' corrected'
                answer=dict(sourcePlanSha256=digest(source),materials=dict(upsert=[panel],remove=[]),
                    objects=dict(upsert=[],remove=[]),unknowns=None,backgroundMode=None,textPolicy=None,unresolvedIssues=[])
            save(folder/'draft.json',answer)
            (folder/'events.jsonl').write_text(json.dumps(dict(type='thread.started',thread_id=SID)))
            save(folder/'transport.json',dict(exitCode=0,turnCompleted=True,unexpectedEvents=[],responseSha256=digest(folder/'draft.json'),elapsedSeconds=.01))
        return call

    def test_second_bounded_repair_freezes_and_resume_does_not_repeat(self):
        model=self.model();dag=Dag(self.root,model)
        result=dag.execute();self.assertEqual(result['status'],'frozen')
        self.assertEqual(self.calls,['m1','m2','repair','rereview','repair2','rereview2'])
        self.assertEqual(verify_run(self.root),read(self.root/'repair2/candidate.json'))
        self.assertTrue((self.root/'frozen/evidence/repair2-draft.json').exists())
        dag.execute();self.assertEqual(len(self.calls),6)
        (self.root/'repair2/draft.json').write_text('{}')
        with self.assertRaises(Exception):verify_run(self.root)

    def test_second_review_failure_is_terminal(self):
        dag=Dag(self.root,self.model(terminal=True))
        with self.assertRaisesRegex(ValueError,'REREVIEW_UNRESOLVED'):dag.execute()
        self.assertEqual(len(self.calls),6);self.assertFalse((self.root/'frozen').exists())
        with self.assertRaisesRegex(ValueError,'NO_RESUBMIT'):dag.execute()
        self.assertEqual(len(self.calls),6)

    def test_distinct_coverage_findings_use_at_most_two_repairs(self):
        base=self.model()
        def model(folder,sid,first):
            base(folder,sid,first)
            if folder.name in ('m2','rereview'):
                answer=read(folder/'draft.json');answer['issues']=[]
                artwork='flying figure' if folder.name=='m2' else 'small attached palette'
                answer['coverageAudit'][2]['missingFromPlan']=[dict(
                    artwork=artwork,suggestedOwnerId='asset-panel',
                    suggestedChange='Add the observed artwork to the owned description.')]
                (folder/'draft.json').write_text(json.dumps(answer),encoding='utf-8')
                receipt=read(folder/'transport.json');receipt['responseSha256']=digest(folder/'draft.json')
                (folder/'transport.json').write_text(json.dumps(receipt),encoding='utf-8')
        result=Dag(self.root,model).execute()
        self.assertEqual(result['status'],'frozen')
        self.assertEqual(self.calls,['m1','m2','repair','rereview','repair2','rereview2'])

    def test_same_coverage_finding_after_repair_stops(self):
        base=self.model()
        def model(folder,sid,first):
            base(folder,sid,first)
            if folder.name in ('m2','rereview'):
                answer=read(folder/'draft.json');answer['issues']=[]
                answer['coverageAudit'][2]['missingFromPlan']=[dict(
                    artwork='same missing figure',suggestedOwnerId='asset-panel',
                    suggestedChange='Restore the same missing figure.')]
                (folder/'draft.json').write_text(json.dumps(answer),encoding='utf-8')
                receipt=read(folder/'transport.json');receipt['responseSha256']=digest(folder/'draft.json')
                (folder/'transport.json').write_text(json.dumps(receipt),encoding='utf-8')
        with self.assertRaisesRegex(ValueError,'REREVIEW_UNRESOLVED'):
            Dag(self.root,model).execute()
        self.assertEqual(self.calls,['m1','m2','repair','rereview'])
        self.assertFalse((self.root/'frozen').exists())

    def test_cosmetic_only_freezes_without_repair_and_preserves_warnings(self):
        result=Dag(self.root,self.model(cosmetic=True)).execute()
        self.assertEqual(result['status'],'frozen');self.assertEqual(len(self.calls),2)
        self.assertEqual(read(self.root/'frozen/planning-warnings.json')['warnings'][0]['code'],'MINOR_COLOR_TONE')
        self.assertTrue(result['reviewWarnings']['m2'])

    def test_invalid_cosmetic_code_fails_closed(self):
        with self.assertRaisesRegex(ValueError,'UNKNOWN_COSMETIC'):Dag(self.root,self.model(cosmetic=True,bad=True)).execute()
        self.assertEqual(len(self.calls),2);self.assertFalse((self.root/'frozen').exists())

    def test_two_repairs_then_authorized_fixture_delivery_keeps_warning(self):
        from unittest.mock import patch
        import zipfile
        from ai_ui_layers import delivery_dag as delivery
        from test_delivery_dag import DeliveryTests
        parent=self.root.parent;viewer=parent/'viewer';viewer.mkdir()
        (viewer/'viewer.html').write_text('<html></html>');(viewer/'viewer.js').write_text('void 0;')
        self.run=delivery.init(parent/'input.png',parent/'delivery',viewer)
        base=self.model()
        def model(folder,sid,first):
            base(folder,sid,first)
            if folder.name=='rereview2':
                answer=dict(issues=[dict(code='MINOR_COLOR_TONE',category='cosmetic',ids=['asset-panel'],
                    description='Slight tone difference only.',suggestedChange='Optional tone adjustment.')],
                    coverageAudit=coverage(),smallMaterialAudit=small_audit(folder))
                (folder/'draft.json').write_text(json.dumps(answer),encoding='utf-8')
                receipt=read(folder/'transport.json');receipt['responseSha256']=digest(folder/'draft.json')
                (folder/'transport.json').write_text(json.dumps(receipt),encoding='utf-8')
        dag=delivery.DeliveryDag(self.run,model)
        self.assertEqual(dag.execute()['status'],'awaiting_authorization')
        self.assertEqual(len(self.calls),6)
        DeliveryTests.complete_media(self)
        with patch('ai_ui_layers.delivery_dag.register',side_effect=DeliveryTests.fixture_registration):
            result=dag.execute()
        self.assertEqual(result['status'],'delivered_pending_visual_review')
        self.assertFalse(result['humanVisualAcceptance'])
        with zipfile.ZipFile(self.run/'delivery/ui-layers.zip') as archive:
            review=json.loads(archive.read('review.json'))
            self.assertTrue(any('MINOR_COLOR_TONE' in item for item in review['issues']))
        dag.execute();self.assertEqual(len(self.calls),6)
