import unittest
from pathlib import Path
from unittest.mock import patch
from test_workflow_bridge import WorkflowBridgeTests as Fixture
from ai_ui_decomposition.workflow_exchange import exchange
from ai_ui_decomposition.adapter import builtin_image_arguments
from ai_ui_decomposition.common import read_json


class ExchangeTests(unittest.TestCase):
    preflight_mode='after-generation-v1'
    setUp=Fixture.setUp
    tearDown=Fixture.tearDown
    authorize=Fixture.authorize

    def test_one_exchange_per_image_returns_exact_arguments_and_finishes(self):
        self.authorize();result=exchange(self.job);count=0
        while result['nextRequest']:
            n=result['nextRequest'];count+=1
            bundle=Path(result['status']['bundle'])
            self.assertEqual(n['arguments'],builtin_image_arguments(bundle))
            self.assertTrue((bundle/'submission.json').exists())
            result=exchange(self.job,request_digest=n['requestDigest'],source=self.raw)
            self.assertGreaterEqual(result['timings']['totalSeconds'],result['timings']['receiveSeconds'])
        self.assertGreater(count,1)
        self.assertEqual(result['status']['nextNode'],'process')
        self.assertFalse((self.job/'nodes/process').exists())

    def test_no_authorization_or_duplicate_dispatch(self):
        with self.assertRaises(ValueError):exchange(self.job)
        self.authorize();first=exchange(self.job)
        with self.assertRaises(ValueError):exchange(self.job)
        n=first['nextRequest'];exchange(self.job,request_digest=n['requestDigest'],source=self.raw)
        with self.assertRaises(ValueError):exchange(self.job,request_digest=n['requestDigest'],source=self.raw)

    def test_bad_pair_or_bad_source_does_not_dispatch_more(self):
        with self.assertRaisesRegex(ValueError,'PAIR_REQUIRED'):
            exchange(self.job,request_digest='0'*64)
        self.authorize();r=exchange(self.job)
        with self.assertRaises(ValueError):
            exchange(self.job,request_digest=r['nextRequest']['requestDigest'],source=self.base/'missing.png')
        self.assertEqual(len(list((self.job/'nodes/generate/output/requests').glob('*/assignment.json'))),1)

    def test_interrupted_submission_never_replays_assignment(self):
        self.authorize()
        with patch('ai_ui_decomposition.workflow_exchange.record_submission',side_effect=RuntimeError('interrupted')):
            with self.assertRaises(RuntimeError):exchange(self.job)
        with self.assertRaises(ValueError):exchange(self.job)

    def test_failed_receive_never_prepares_next_call(self):
        with patch('ai_ui_decomposition.workflow_exchange.receive_generation',return_value={'status':'failed'}), \
             patch('ai_ui_decomposition.workflow_exchange.export_generation') as export:
            result=exchange(self.job,request_digest='fixture',source=self.raw)
        self.assertIsNone(result['nextRequest'])
        export.assert_not_called()


del Fixture
