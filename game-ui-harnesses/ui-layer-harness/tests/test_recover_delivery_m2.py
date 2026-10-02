import _bootstrap  # Enable source-layout imports for unittest discovery.
import json
import unittest
from unittest.mock import patch
import test_delivery_dag
from test_planning_dag import FakeModel
from ai_ui_layers.delivery_dag import DeliveryDag
from ai_ui_layers.recover_delivery_m2 import recover
from ai_ui_layers.evaluate import digest, read
from ai_ui_layers import planning_dag as planning
from ai_ui_layers.planning_normalization import m1_plan_path, PLAN_NAME, REPORT_NAME


class RecoveryTests(unittest.TestCase):
    setUp=test_delivery_dag.DeliveryTests.setUp
    def interrupted_m1(self, *, duplicates=False, legacy=False):
        original=FakeModel(repair=False)
        actual_init=planning.init
        def legacy_init(*args,**kwargs):
            root=actual_init(*args,**kwargs)
            path=root/'.dag/config.json';config=read(path)
            for key in ('normalizationPolicy','coverageTextPolicy','relationReviewPolicy','reviewEvidenceProtocol'):
                config.pop(key,None)
            storage=root/'.dag/inputs/storage-schema.json'
            schema=read(storage);schema['title']='Archived fixture storage contract'
            storage.write_text(json.dumps(schema),encoding='utf-8')
            config['inputs']['storage-schema.json']=digest(storage)
            path.write_text(json.dumps(config),encoding='utf-8')
            (root/'.dag/config-digest.json').write_text(json.dumps({'sha256':digest(path)}),encoding='utf-8')
            return root
        def interrupted(folder,sid,first):
            if not first:raise TimeoutError('fixture interrupted review')
            original(folder,sid,first)
            if duplicates:
                raw=read(folder/'draft.json')
                raw['materials'][0]['preserveText']=['STAY','PEOPLE','STAY','PEOPLE']
                (folder/'draft.json').write_text(json.dumps(raw),encoding='utf-8')
                receipt=read(folder/'transport.json');receipt['responseSha256']=digest(folder/'draft.json')
                (folder/'transport.json').write_text(json.dumps(receipt),encoding='utf-8')
        with patch.object(planning,'init',legacy_init if legacy else actual_init):
            with self.assertRaises(TimeoutError):DeliveryDag(self.run,interrupted).execute()

    def test_new_policy_copies_verified_normalized_artifacts_without_rewriting_source(self):
        self.interrupted_m1(duplicates=True)
        old=self.run/'planning'
        before={p.relative_to(self.run):digest(p) for p in self.run.rglob('*') if p.is_file() and p.name!='lock'}
        new=recover(self.run,self.root/'recovered-normalized','User authorizes new review after interruption')/'planning'
        for name in ('draft.json','schema.json','transport.json',PLAN_NAME,REPORT_NAME):
            self.assertEqual((new/'m1'/name).read_bytes(),(old/'m1'/name).read_bytes())
        self.assertEqual(m1_plan_path(new),new/'m1'/PLAN_NAME)
        self.assertEqual(read(m1_plan_path(new))['materials'][0]['preserveText'],['STAY','PEOPLE'])
        self.assertEqual(before,{p.relative_to(self.run):digest(p) for p in self.run.rglob('*') if p.is_file() and p.name!='lock'})

    def test_legacy_reuse_keeps_original_contract_without_default_policy_upgrade(self):
        self.interrupted_m1(legacy=True)
        old=self.run/'planning'
        new=recover(self.run,self.root/'recovered-legacy','User authorizes new review after interruption')/'planning'
        config=read(new/'.dag/config.json')
        for key in ('normalizationPolicy','coverageTextPolicy','relationReviewPolicy','reviewEvidenceProtocol'):
            self.assertNotIn(key,config)
        self.assertEqual((new/'m1/schema.json').read_bytes(),(old/'m1/schema.json').read_bytes())
        self.assertEqual((new/'.dag/inputs/storage-schema.json').read_bytes(),
                         (old/'.dag/inputs/storage-schema.json').read_bytes())
        self.assertEqual(read(new/'.dag/inputs/storage-schema.json')['title'],
                         'Archived fixture storage contract')
        self.assertEqual(m1_plan_path(new),new/'m1/draft.json')
        self.assertFalse((new/'m1'/PLAN_NAME).exists())

    def test_changed_derived_plan_is_rejected_before_new_output(self):
        self.interrupted_m1(duplicates=True)
        (self.run/'planning/m1'/PLAN_NAME).write_text('{}',encoding='utf-8')
        with self.assertRaisesRegex(ValueError,'COMPLETED_OUTPUT_CHANGED'):
            recover(self.run,self.root/'bad-normalized','Explicit new review')
        self.assertFalse((self.root/'bad-normalized').exists())
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
