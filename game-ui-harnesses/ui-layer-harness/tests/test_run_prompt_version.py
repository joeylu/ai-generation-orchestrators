import _bootstrap  # Enable source-layout imports for unittest discovery.
import json
import tempfile
import unittest
from pathlib import Path

from PIL import Image

from ai_ui_layers import delivery_dag as delivery
from ai_ui_layers import planning_dag as planning
from ai_ui_layers.evaluate import read, digest
from ai_ui_layers.freeze_visual import body_digest
from ai_ui_layers.recover_delivery_m2 import recover
from ai_ui_layers.revise_plan import init as revise, RevisionDag
from test_planning_dag import FakeModel
import test_revise_plan


class RunPromptVersionTests(unittest.TestCase):
    def setUp(self):
        tmp=tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root=Path(tmp.name)
        self.image=self.root/'reference.png'
        Image.new('RGB',(1000,1000)).save(self.image)

    def plan(self, name, **options):
        run=planning.init(self.image,self.root/name,8,**options)
        result=planning.Dag(run,FakeModel()).execute()
        self.assertEqual(result['status'],'frozen')
        return run,result

    def remove_context_field(self, run):
        path=run/'.dag/config.json'
        config=read(path)
        config.pop('contextPromptVersion')
        path.write_text(json.dumps(config),encoding='utf-8')
        (run/'.dag/config-digest.json').write_text(
            json.dumps({'sha256':digest(path)}),encoding='utf-8')

    def test_new_context_run_defaults_to_v7_and_freezes_version(self):
        run,status=self.plan('default')
        config=read(run/'.dag/config.json')
        snapshot=read(run/'frozen/snapshot.json')
        compiled=read(run/'frozen/compile-report.json')
        plan=read(run/'frozen/execution-plan.candidate.json')
        self.assertEqual(config['generationReference'],'context-crops')
        self.assertEqual(config['contextPromptVersion'],'v7')
        self.assertEqual(snapshot['contextPromptVersion'],'v7')
        self.assertEqual(compiled['contextPromptVersion'],'v7')
        self.assertEqual(status['contextPromptVersion'],'v7')
        self.assertTrue(all(asset['prompt'].startswith('visual-material-context-prompt-v7:\n')
                            for asset in plan['assets']))
        self.assertEqual(planning.Dag(run,FakeModel()).status()['contextPromptVersion'],'v7')

    def test_explicit_context_version_is_bound_without_changing_default(self):
        run,status=self.plan('v6',generation_mode='single',context_prompt_version='v6')
        self.assertEqual(status['contextPromptVersion'],'v6')
        self.assertEqual(read(run/'.dag/config.json')['contextPromptVersion'],'v6')
        self.assertEqual(read(run/'frozen/snapshot.json')['contextPromptVersion'],'v6')
        self.assertTrue(all(asset['prompt'].startswith('visual-material-context-prompt-v6:\n')
                            for asset in read(run/'frozen/execution-plan.candidate.json')['assets']))

    def test_historical_missing_config_field_keeps_v3_freeze(self):
        run=planning.init(self.image,self.root/'legacy',8,generation_mode='single')
        config_path=run/'.dag/config.json'
        config=read(config_path)
        config.pop('contextPromptVersion')
        config_path.write_text(json.dumps(config),encoding='utf-8')
        (run/'.dag/config-digest.json').write_text(
            json.dumps({'sha256':digest(config_path)}),encoding='utf-8')
        status=planning.Dag(run,FakeModel()).execute()
        self.assertEqual(status['contextPromptVersion'],'v3')
        self.assertEqual(read(run/'frozen/snapshot.json')['contextPromptVersion'],'v3')
        self.assertTrue(all(asset['prompt'].startswith('visual-material-context-prompt-v3:\n')
                            for asset in read(run/'frozen/execution-plan.candidate.json')['assets']))

    def test_full_reference_has_no_context_version_and_rejects_explicit_one(self):
        run,status=self.plan('full',generation_mode='single',generation_reference='full')
        self.assertNotIn('contextPromptVersion',read(run/'.dag/config.json'))
        self.assertNotIn('contextPromptVersion',read(run/'frozen/snapshot.json'))
        self.assertNotIn('contextPromptVersion',status)
        rejected=self.root/'full-explicit'
        with self.assertRaisesRegex(ValueError,'CONTEXT_PROMPT_REQUIRES_CONTEXT_CROPS'):
            planning.init(self.image,rejected,8,generation_reference='full',
                          context_prompt_version='v7')
        self.assertFalse(rejected.exists())

    def test_unknown_explicit_version_rejected_before_creating_run(self):
        rejected=self.root/'unknown-version'
        with self.assertRaisesRegex(ValueError,'CONTEXT_PROMPT_VERSION'):
            planning.init(self.image,rejected,8,context_prompt_version='v99')
        self.assertFalse(rejected.exists())

    def test_frozen_snapshot_version_must_match_new_config(self):
        run,_=self.plan('mismatch',generation_mode='single')
        snapshot_path=run/'frozen/snapshot.json'
        snapshot=read(snapshot_path)
        snapshot['contextPromptVersion']='v6'
        snapshot['digest']=body_digest({k:v for k,v in snapshot.items() if k!='digest'})
        snapshot_path.write_text(json.dumps(snapshot),encoding='utf-8')
        with self.assertRaisesRegex(ValueError,'FROZEN_CONTEXT_PROMPT_VERSION_MISMATCH'):
            planning.Dag(run,FakeModel()).status()

    def test_recover_old_delivery_inherits_missing_v3_and_legacy_registration(self):
        viewer=self.root/'viewer';viewer.mkdir()
        (viewer/'viewer.html').write_text('<html></html>',encoding='utf-8')
        (viewer/'viewer.js').write_text('void 0;',encoding='utf-8')
        source=delivery.init(self.image,self.root/'interrupted',viewer,
                             generation_mode='single',context_prompt_version='v3',
                             registration_policy='legacy-region-fit')
        model=FakeModel()
        def interrupted(folder,sid,first):
            if not first:raise TimeoutError('fixture review interrupted')
            return model(folder,sid,first)
        with self.assertRaises(TimeoutError):
            delivery.DeliveryDag(source,interrupted).execute()
        self.remove_context_field(source)
        self.remove_context_field(source/'planning')
        child=recover(source,self.root/'recovered','Explicit fixture recovery')
        root_config=read(child/'.dag/config.json')
        nested_config=read(child/'planning/.dag/config.json')
        self.assertEqual(root_config['contextPromptVersion'],'v3')
        self.assertEqual(nested_config['contextPromptVersion'],'v3')
        self.assertEqual(root_config['registrationPolicy'],'legacy-region-fit')
        self.assertEqual(root_config['generationMode'],'single')

    def test_revision_inherits_v7_and_old_missing_v3_through_freeze(self):
        for version in ('v7','v3'):
            with self.subTest(version=version):
                parent=planning.init(self.image,self.root/('parent-'+version),12,
                                     generation_mode='sheets',context_prompt_version=version)
                with self.assertRaisesRegex(ValueError,'REREVIEW_UNRESOLVED'):
                    planning.Dag(parent,FakeModel(repair=True,unresolved=True)).execute()
                if version=='v3':self.remove_context_field(parent)
                child=revise(parent,self.root/('revision-'+version),'Explicit fixture revision')
                self.assertEqual(read(child/'.dag/config.json')['contextPromptVersion'],version)
                self.calls=[]
                result=RevisionDag(child,lambda folder,sid,first:
                    test_revise_plan.RevisionTests.model(self,folder,sid,first)).execute()
                self.assertEqual(result['status'],'frozen')
                self.assertEqual(read(child/'frozen/snapshot.json')['contextPromptVersion'],version)
                self.assertEqual(read(child/'frozen/compile-report.json')['contextPromptVersion'],version)


if __name__=='__main__':
    unittest.main()
