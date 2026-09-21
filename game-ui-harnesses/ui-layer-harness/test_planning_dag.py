import copy
import json
from pathlib import Path
import tempfile
import unittest
from PIL import Image
from planning_dag import init,Dag
from compile_visual import HARNESS
from evaluate import read,save,digest

SID='12345678-1234-1234-1234-123456789abc'

class FakeModel:
    def __init__(self,repair=False,unresolved=False,mismatch=False):
        self.calls=[];self.repair=repair;self.unresolved=unresolved;self.mismatch=mismatch
    def __call__(self,folder,sid,first):
        self.calls.append((folder.name,sid))
        if first:
            answer=read(HARNESS/'planning-harness/examples/visual-plan-scoped.json');answer['unknowns']=[]
        elif folder.name in ('m2','rereview'):
            issue={'code':'missing_detail','category':'semantic','ids':['asset-panel'],
                   'description':'fixture finding','suggestedChange':'clarify panel label'}
            answer={'issues':[issue] if (folder.name=='m2' and self.repair) or (folder.name=='rereview' and self.unresolved) else []}
        else:
            source=read(folder.parent/'m1/draft.json');panel=copy.deepcopy(next(m for m in source['materials'] if m['id']=='asset-panel'));panel['label']+=' fixed'
            answer={'sourcePlanSha256':digest(folder.parent/'m1/draft.json'),'materials':{'upsert':[panel],'remove':[]},
                    'objects':{'upsert':[],'remove':[]},'unknowns':None,'backgroundMode':None,'textPolicy':None,'unresolvedIssues':[]}
        save(folder/'draft.json',answer)
        observed='12345678-1234-1234-1234-123456789abd' if self.mismatch and not first else SID
        (folder/'events.jsonl').write_text(json.dumps({'type':'thread.started','thread_id':observed}))
        save(folder/'transport.json',{'exitCode':0,'turnCompleted':True,'unexpectedEvents':[],
             'responseSha256':digest(folder/'draft.json'),'elapsedSeconds':.01})

class DagTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        root=Path(self.tmp.name);source=root/'source.png';Image.new('RGB',(1000,1000)).save(source)
        self.root=init(source,root/'run',8)

    def test_direct_freeze_and_resume_never_replays_calls(self):
        model=FakeModel();dag=Dag(self.root,model);result=dag.execute()
        self.assertEqual(result['status'],'frozen');self.assertEqual(result['nodes']['repair'],'skipped')
        self.assertEqual(model.calls,[('m1',None),('m2',SID)])
        Dag(self.root,model).execute();self.assertEqual(len(model.calls),2)
        self.assertEqual(result['mediaGenerationCalls'],0)

    def test_one_repair_same_session_then_real_program_freeze(self):
        model=FakeModel(repair=True);result=Dag(self.root,model).execute()
        self.assertEqual(result['status'],'frozen')
        self.assertEqual(model.calls,[('m1',None),('m2',SID),('repair',SID),('rereview',SID)])
        self.assertTrue((self.root/'frozen/evidence/revised-visual-plan.json').exists())

    def test_unresolved_rereview_stops_and_resume_cannot_resubmit(self):
        model=FakeModel(repair=True,unresolved=True);dag=Dag(self.root,model)
        with self.assertRaisesRegex(ValueError,'REREVIEW_UNRESOLVED'):dag.execute()
        self.assertFalse((self.root/'frozen').exists())
        with self.assertRaisesRegex(ValueError,'NO_RESUBMIT'):Dag(self.root,model).execute()
        self.assertEqual(len(model.calls),4)

    def test_completed_checkpoint_continues_without_rerunning_m1(self):
        model=FakeModel();dag=Dag(self.root,model)
        dag.node('m1',dag.m1);dag.node('check',dag.check)
        self.assertEqual(Dag(self.root,model).execute()['status'],'frozen')
        self.assertEqual(len(model.calls),2)

    def test_uncertain_model_node_does_not_resubmit(self):
        def broken(folder,sid,first):raise TimeoutError('indeterminate fixture')
        with self.assertRaises(TimeoutError):Dag(self.root,broken).execute()
        model=FakeModel()
        with self.assertRaisesRegex(ValueError,'NO_RESUBMIT'):Dag(self.root,model).execute()
        self.assertFalse(model.calls)

    def test_changed_plan_or_session_blocks_freeze(self):
        model=FakeModel(mismatch=True)
        with self.assertRaisesRegex(ValueError,'SESSION_CHANGED'):Dag(self.root,model).execute()
        self.assertFalse((self.root/'frozen').exists())
        (self.root/'m1/draft.json').write_text('{}')
        with self.assertRaisesRegex(ValueError,'OUTPUT_CHANGED'):Dag(self.root,model).execute()

    def test_changed_runtime_blocks_resume_before_model(self):
        from unittest.mock import patch
        model=FakeModel()
        with patch('planning_dag.runtime_files',return_value={}):
            with self.assertRaisesRegex(ValueError,'RUNTIME_CHANGED'):Dag(self.root,model).execute()
        self.assertFalse(model.calls)

if __name__=='__main__':unittest.main()
