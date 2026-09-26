import _bootstrap  # Enable source-layout imports for unittest discovery.
import json
import unittest
import test_delivery_dag
from test_planning_dag import FakeModel
from ai_ui_layers.delivery_dag import DeliveryDag
from ai_ui_layers.recover_delivery_m2 import recover
from ai_ui_layers.evaluate import digest, read


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

    def test_old_model_session_cannot_resume_under_new_model(self):
        original=FakeModel()
        def interrupted(folder,sid,first):
            if not first:raise TimeoutError('fixture interrupted review')
            return original(folder,sid,first)
        with self.assertRaises(TimeoutError):DeliveryDag(self.run,interrupted).execute()
        config_path=self.run/'planning/.dag/config.json'
        config=read(config_path);config['model']='gpt-5.6-luna'
        config_path.write_text(json.dumps(config),encoding='utf-8')
        (self.run/'planning/.dag/config-digest.json').write_text(
            json.dumps({'sha256':digest(config_path)}),encoding='utf-8')
        with self.assertRaisesRegex(ValueError,'MODEL_CHANGED_NEW_SESSION_REQUIRED'):
            recover(self.run,self.root/'old-model','User requests recovery')
        self.assertFalse((self.root/'old-model').exists())
