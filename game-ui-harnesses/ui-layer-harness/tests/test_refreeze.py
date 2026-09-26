import _bootstrap
from pathlib import Path
import tempfile
import json
import unittest
from PIL import Image
from ai_ui_layers.planning_dag import init, Dag
from ai_ui_layers.refreeze import freeze_reviewed
from ai_ui_layers.evaluate import digest, read, save
from test_planning_dag import FakeModel


class RefreezeTests(unittest.TestCase):
    def setUp(self):
        tmp=tempfile.TemporaryDirectory();self.addCleanup(tmp.cleanup)
        self.root=Path(tmp.name)
        image=self.root/'reference.png';Image.new('RGB',(1000,1000)).save(image)
        self.run=init(image,self.root/'run',1,generation_mode='sheets')
        self.model=FakeModel()
        with self.assertRaisesRegex(ValueError,'CALL_LIMIT_EXCEEDED'):
            Dag(self.run,self.model).execute()

    def test_new_capacity_freezes_without_model_or_source_mutation(self):
        before={str(p.relative_to(self.run)):digest(p) for p in self.run.rglob('*') if p.is_file() and p.name!='lock'}
        calls=list(self.model.calls)
        result=freeze_reviewed(self.run,self.root/'new-snapshot',4)
        self.assertEqual(result['plannedCalls'],4)
        self.assertEqual(result['modelCalls'],0)
        self.assertEqual(calls,self.model.calls)
        self.assertEqual(before,{str(p.relative_to(self.run)):digest(p) for p in self.run.rglob('*') if p.is_file() and p.name!='lock'})
        self.assertFalse(result['originalDagPromoted'])

    def test_explicit_regroup_creates_separate_single_request_snapshot(self):
        before={str(p.relative_to(self.run)):digest(p) for p in self.run.rglob('*') if p.is_file() and p.name!='lock'}
        output=self.root/'single-snapshot'
        result=freeze_reviewed(self.run,output,128,generation_mode='single')
        self.assertEqual((result['sourceGenerationMode'],result['generationMode']),('sheets','single'))
        requests=read(output/'requests.json')
        self.assertEqual(requests['kind'],'ui_visual_requests_preview_v1')
        self.assertEqual(len(requests['requests']),result['materialCount'])
        self.assertEqual(result['modelCalls'],0)
        self.assertEqual(before,{str(p.relative_to(self.run)):digest(p) for p in self.run.rglob('*') if p.is_file() and p.name!='lock'})

    def test_tampered_review_is_rejected(self):
        review=self.run/'m2/draft.json'
        data=read(review);data['issues']=[{}];review.write_text(json.dumps(data),encoding='utf-8')
        with self.assertRaisesRegex(ValueError,'COMPLETED_OUTPUT_CHANGED'):
            freeze_reviewed(self.run,self.root/'new-snapshot',4)

    def test_low_limit_still_fails_without_output(self):
        output=self.root/'new-snapshot'
        with self.assertRaisesRegex(ValueError,'CALL_LIMIT_EXCEEDED'):
            freeze_reviewed(self.run,output,1)
        self.assertFalse(output.exists())
