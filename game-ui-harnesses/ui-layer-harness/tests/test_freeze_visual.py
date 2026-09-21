import _bootstrap  # Enable source-layout imports for unittest discovery.
import unittest
import json
from ai_ui_layers.evaluate import read,save,digest
import test_compile_visual
from ai_ui_layers.freeze_visual import freeze, inspect
from ai_ui_layers.execution_preflight import preflight


class VisualFreezeTests(unittest.TestCase):
    setUp = test_compile_visual.VisualCompileTests.setUp
    def test_scoped_contract_flows_to_single_reference_request(self):
        from ai_ui_layers.experimental_executor import prepare,authorize,next_request
        self.visual.update(backgroundMode='preserve-underlay',textPolicy='remove-business-text')
        for material in self.visual['materials']:material['preserveText']=[]
        (self.run/'m1/draft.json').write_text(json.dumps(self.visual))
        for path in (self.run/'result.json',self.run/'m2/request.json'):
            data=read(path);data['sourcePlanSha256']=digest(self.run/'m1/draft.json');path.write_text(json.dumps(data))
        out=self.root/'scoped';frozen=freeze(self.run,out,5)
        self.assertEqual(preflight(out,frozen['digest'])['inputChecks'],'passed')
        job=self.root/'job';config=prepare(out,frozen['digest'],job)
        self.assertEqual(config['referenceMode'],'full-only')
        authorize(job,config['digest'],'offline fixture authorization')
        request=next_request(job)
        self.assertEqual(len(request['arguments']['referenced_image_paths']),1)
        self.assertIn('preserveText list: []',request['arguments']['prompt'])
        self.assertNotIn('Image 2',request['arguments']['prompt'])

    def test_repaired_plan_requires_bound_clean_rereview(self):
        repair=self.run/'repair';repair.mkdir()
        with self.assertRaisesRegex(ValueError,'REQUIRES_NEW_REVIEW'):freeze(self.run,self.root/'blocked',5)
        sid='12345678-1234-1234-1234-123456789abc'
        result=read(self.run/'result.json');result['sessionId']=sid
        (self.run/'result.json').write_text(json.dumps(result))
        patch={'sourcePlanSha256':digest(self.run/'m1/draft.json'),
               'materials':{'upsert':[],'remove':[]},'objects':{'upsert':[],'remove':[]},
               'unknowns':None,'unresolvedIssues':[]}
        save(repair/'draft.json',patch);save(repair/'candidate.json',self.visual)
        rr=self.run/'rereview';rr.mkdir()
        (rr/'schema.json').write_bytes((self.run/'m2/schema.json').read_bytes())
        save(rr/'draft.json',{'issues':[]})
        (rr/'events.jsonl').write_text(json.dumps({'type':'thread.started','thread_id':sid}))
        save(rr/'request.json',{'sessionId':sid,'candidateSha256':digest(repair/'candidate.json'),
                              'patchSha256':digest(repair/'draft.json'),'inputs':{'schema.json':digest(rr/'schema.json')}})
        save(rr/'transport.json',{'exitCode':0,'turnCompleted':True,'responseSha256':digest(rr/'draft.json')})
        save(rr/'result.json',{'sameSessionVerified':True,'reviewSha256':digest(rr/'draft.json')})
        out=self.root/'repaired';frozen=freeze(self.run,out,5)
        self.assertEqual(preflight(out,frozen['digest'])['inputChecks'],'passed')
        self.assertTrue((out/'evidence/revised-visual-plan.json').exists())
        (repair/'candidate.json').write_text('{}')
        with self.assertRaisesRegex(ValueError,'INVALID_REPAIR'):freeze(self.run,self.root/'tampered',5)

    def test_freeze_and_detect_prompt_tampering(self):
        out=self.root/'frozen';result=freeze(self.run,out,5)
        self.assertEqual(inspect(out,result['digest'])['materialCount'],5)
        checked=preflight(out,result['digest'])
        self.assertEqual(checked['inputChecks'],'passed')
        self.assertEqual(checked['generationCalls'],0)
        self.assertFalse(checked['dispatchEnabled'])
        self.assertFalse(result['executable'])
        self.assertFalse((out/'batch.json').exists())
        prompt=next(out.glob('materials/*/prompt.txt'))
        prompt.write_text('changed',encoding='utf-8')
        with self.assertRaisesRegex(ValueError,'ARTIFACT_CHANGED'):
            inspect(out,result['digest'])

    def test_no_overwrite_and_wrong_expected_digest(self):
        out=self.root/'frozen';freeze(self.run,out,5)
        with self.assertRaises(FileExistsError):freeze(self.run,out,5)
        with self.assertRaisesRegex(ValueError,'UNEXPECTED_SNAPSHOT'):inspect(out,'wrong')
