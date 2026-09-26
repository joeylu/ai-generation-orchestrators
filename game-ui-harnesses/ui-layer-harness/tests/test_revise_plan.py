import _bootstrap
import copy
import json
from pathlib import Path
import tempfile
import unittest
from PIL import Image
from test_planning_dag import FakeModel, SID, coverage, small_audit
from ai_ui_layers.planning_dag import init, Dag
from ai_ui_layers.revise_plan import init as revise, RevisionDag
from ai_ui_layers.compile_visual import verify_run
from ai_ui_layers.evaluate import read, save, digest
from ai_ui_layers.execution_preflight import preflight


class RevisionTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.base=Path(self.temp.name);image=self.base/'source.png'
        Image.new('RGB',(1000,1000)).save(image)
        self.parent=init(image,self.base/'parent',12,'sheets')
        with self.assertRaisesRegex(ValueError,'REREVIEW_UNRESOLVED'):
            Dag(self.parent,FakeModel(repair=True,unresolved=True)).execute()
        self.calls=[]

    def model(self,folder,sid,first):
        self.assertEqual(sid,SID);self.assertFalse(first);self.calls.append(folder.name)
        if folder.name=='repair':
            source=folder.parent/'source-plan.json'
            panel=copy.deepcopy(read(source)['materials'][1]);panel['label']+=' revised'
            answer=dict(sourcePlanSha256=digest(source),materials={'upsert':[panel],'remove':[]},
                        objects={'upsert':[],'remove':[]},unknowns=None,backgroundMode=None,textPolicy=None,unresolvedIssues=[])
        else:answer={'issues':[],'coverageAudit':coverage(),'smallMaterialAudit':small_audit(folder)}
        save(folder/'draft.json',answer)
        (folder/'events.jsonl').write_text(json.dumps({'type':'thread.started','thread_id':sid}))
        save(folder/'transport.json',dict(exitCode=0,turnCompleted=True,unexpectedEvents=[],
             responseSha256=digest(folder/'draft.json'),elapsedSeconds=.01))

    def test_revision_freezes_without_new_m1_and_preserves_parent(self):
        before={p.relative_to(self.parent):digest(p) for p in self.parent.rglob('*') if p.is_file()}
        root=revise(self.parent,self.base/'child','User requested one local revision')
        result=RevisionDag(root,self.model).execute()
        self.assertEqual(self.calls,['repair','rereview'])
        self.assertEqual(result['status'],'frozen')
        self.assertFalse((root/'m1/draft.json').exists())
        self.assertTrue((root/'frozen/evidence/parent-review.json').exists())
        preflight(root/'frozen',result['snapshotDigest'])
        self.assertEqual(before,{p.relative_to(self.parent):digest(p) for p in self.parent.rglob('*') if p.is_file()})
        self.assertEqual(verify_run(root),read(root/'repair/candidate.json'))
        (root/'repair/candidate.json').write_text('{}')
        with self.assertRaises(ValueError):verify_run(root)

    def test_parent_tamper_blocks_before_call(self):
        root=revise(self.parent,self.base/'child','Explicit revision')
        (self.parent/'rereview/draft.json').write_text('{"issues":[]}')
        with self.assertRaisesRegex(ValueError,'PARENT_EVIDENCE_CHANGED'):
            RevisionDag(root,self.model).execute()
        self.assertEqual(self.calls,[])

    def test_failed_new_review_cannot_be_replayed_or_frozen(self):
        root=revise(self.parent,self.base/'child','Explicit revision')
        def unresolved(folder,sid,first):
            self.model(folder,sid,first)
            if folder.name=='rereview':
                (folder/'draft.json').write_bytes((self.parent/'rereview/draft.json').read_bytes())
                receipt=read(folder/'transport.json');receipt['responseSha256']=digest(folder/'draft.json')
                (folder/'transport.json').write_text(json.dumps(receipt))
        with self.assertRaisesRegex(ValueError,'REREVIEW_UNRESOLVED'):RevisionDag(root,unresolved).execute()
        with self.assertRaisesRegex(ValueError,'NO_RESUBMIT'):RevisionDag(root,unresolved).execute()
        with self.assertRaisesRegex(ValueError,'M2_UNRESOLVED'):verify_run(root)
        self.assertFalse((root/'frozen').exists());self.assertEqual(len(self.calls),2)


if __name__=='__main__':unittest.main()
