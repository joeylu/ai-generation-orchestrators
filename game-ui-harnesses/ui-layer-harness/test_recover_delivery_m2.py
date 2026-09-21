import unittest
import test_delivery_dag
from test_planning_dag import FakeModel
from delivery_dag import DeliveryDag
from recover_delivery_m2 import recover
from evaluate import digest


class RecoveryTests(unittest.TestCase):
    setUp=test_delivery_dag.DeliveryTests.setUp
    def test_explicit_recovery_preserves_original_and_reuses_m1(self):
        original=FakeModel()
        def interrupted(folder,sid,first):
            if not first: raise TimeoutError('fixture interrupted review')
            return original(folder,sid,first)
        with self.assertRaises(TimeoutError):DeliveryDag(self.run,interrupted).execute()
        before=digest(self.run/'planning/.dag/m2/failed.json')
        new=recover(self.run,self.root/'recovered','User requests continuation after host interruption')
        model=FakeModel(); result=DeliveryDag(new,model).execute()
        self.assertEqual(result['status'],'awaiting_authorization')
        self.assertEqual([name for name,_ in model.calls],['m2'])
        self.assertEqual(before,digest(self.run/'planning/.dag/m2/failed.json'))

    def test_completed_m2_cannot_be_recovered(self):
        self.dag.execute()
        with self.assertRaisesRegex(ValueError,'PLANNING_ONLY'):recover(self.run,self.root/'bad','fixture')
