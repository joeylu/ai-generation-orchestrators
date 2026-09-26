import _bootstrap
import json
import unittest

from ai_ui_layers.evaluate import read, digest
from ai_ui_layers.planning_dag import Dag
from ai_ui_layers.planning_review_policy import split
from test_planning_dag import FakeModel
import test_planning_dag


class SmallBoundaryReviewTests(unittest.TestCase):
    def setUp(self):
        test_planning_dag.DagTests.setUp(self)

    def test_clipped_and_uncertain_boundary_block_even_without_textual_issues(self):
        for status in ('clipped','uncertain'):
            blockers,warnings=split(dict(issues=[],smallMaterialAudit=[dict(
                materialId='symbol',parts=[],boundary=dict(status=status,evidence='Top contour crosses crop.'))]))
            self.assertEqual(blockers[0]['code'],'SMALL_MATERIAL_BOUNDARY_REVIEW')
            self.assertEqual(blockers[0]['category'],'geometry')
            self.assertFalse(warnings)

    def test_repeated_clipped_boundary_enters_repair_then_stops(self):
        base=FakeModel()
        def model(folder,sid,first):
            base(folder,sid,first)
            if folder.name in ('m2','rereview'):
                answer=read(folder/'draft.json')
                answer['smallMaterialAudit'][0]['boundary']=dict(
                    status='clipped',evidence='The owned top contour extends above the candidate.')
                (folder/'draft.json').write_text(json.dumps(answer),encoding='utf-8')
                receipt=read(folder/'transport.json');receipt['responseSha256']=digest(folder/'draft.json')
                (folder/'transport.json').write_text(json.dumps(receipt),encoding='utf-8')
        with self.assertRaisesRegex(ValueError,'REREVIEW_UNRESOLVED'):
            Dag(self.root,model).execute()
        self.assertEqual([name for name,_ in base.calls],['m1','m2','repair','rereview'])
        self.assertIn('SMALL_MATERIAL_BOUNDARY_REVIEW',
                      (self.root/'repair/prompt.md').read_text(encoding='utf-8'))
        self.assertFalse((self.root/'frozen').exists())

    def test_missing_boundary_response_fails_before_freeze(self):
        from jsonschema import ValidationError
        base=FakeModel()
        def model(folder,sid,first):
            base(folder,sid,first)
            if folder.name=='m2':
                answer=read(folder/'draft.json')
                del answer['smallMaterialAudit'][0]['boundary']
                (folder/'draft.json').write_text(json.dumps(answer),encoding='utf-8')
                receipt=read(folder/'transport.json');receipt['responseSha256']=digest(folder/'draft.json')
                (folder/'transport.json').write_text(json.dumps(receipt),encoding='utf-8')
        with self.assertRaises(ValidationError):Dag(self.root,model).execute()
        self.assertFalse((self.root/'frozen').exists())
