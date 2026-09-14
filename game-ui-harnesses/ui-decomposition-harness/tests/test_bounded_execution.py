from copy import deepcopy
from pathlib import Path
import json
import unittest
from PIL import Image,ImageDraw
from ai_ui_decomposition import batch
from ai_ui_decomposition.bounded_execution import authorize,issue,select_plan,validate
from ai_ui_decomposition.cached import reuse_result
from ai_ui_decomposition.common import ContractError,digest,write_json
from ai_ui_decomposition.process import process


class BoundedExecutionTests(unittest.TestCase):
    def setUp(self):
        import test_harness
        self.f=test_harness.HarnessTests();self.f.setUp()
        self.plan=deepcopy(self.f.plan)
        repair=deepcopy(self.plan['assets'][1]);repair['id']='button-repair';repair['prompt']+=' Remove all baked dependent parts; preserve the exact empty base geometry.'
        self.plan['assets'].append(repair)
        self.plan['nodes'].append({'id':'repair-candidate','asset':'button-repair','xy':[8,24]})
        self.plan['groups'][1]['children'].append('repair-candidate')
        self.path=self.f.root/'candidate.json';write_json(self.path,self.plan)
        self.policy={'kind':'ai_ui_bounded_execution_v1','plan_digest':digest(self.plan),'initial_assets':['button'],
                     'replacements':{'button':'button-repair'},'maximum_calls':2,'maximum_replacements':1,'stop_on_indeterminate':True}
        self.policy_path=self.f.root/'policy.json';write_json(self.policy_path,self.policy)
        batch.freeze(self.path,self.f.workspace,'bounded',execution_policy=self.policy_path)
        self.run=self.f.workspace/'runs/bounded'
        self.raw=self.f.root/'returned.png';im=Image.new('RGB',(20,12),(248,8,248));ImageDraw.Draw(im).rectangle((2,2,17,9),fill='gold');im.save(self.raw)

    def tearDown(self):self.f.tearDown()

    def test_explicit_parallel_dispatch_retains_total_budget_and_unknown_stop(self):
        from ai_ui_decomposition.bounded_execution import authorize_parallel
        # Two independent initial requests, not a conditional replacement.
        policy={**self.policy,'initial_assets':['button','button-repair'],'replacements':{},'maximum_replacements':0}
        pp=self.f.root/'parallel-policy.json';write_json(pp,policy)
        batch.freeze(self.path,self.f.workspace,'parallel',execution_policy=pp);run=self.f.workspace/'runs/parallel'
        authorize(run,'Local fixture only');authorize_parallel(run,2,'Explicit two-request parallel fixture')
        batch.reserve(run,'button');batch.reserve(run,'button-repair')
        self.assertEqual(batch.status(run)['reserved'],2)
        with self.assertRaisesRegex(ContractError,'PENDING_REQUEST|BUDGET_EXHAUSTED'):batch.reserve(run,'button')
        batch.indeterminate(run,'button','Fixture unknown')
        with self.assertRaisesRegex(ContractError,'INDETERMINATE_STOP'):batch.reserve(run,'button-repair')

    def test_parallel_approval_cannot_be_silently_changed(self):
        from ai_ui_decomposition.bounded_execution import authorize_parallel
        authorize(self.run,'Local fixture only');authorize_parallel(self.run,2,'Explicit fixture')
        path=self.run/'parallel-dispatch-authorization.json';r=json.loads(path.read_text());r['maximum_pending']=3;path.write_text(json.dumps(r))
        with self.assertRaisesRegex(ContractError,'PARALLEL_AUTHORIZATION_CHANGED'):batch.reserve(self.run,'button')

    def test_verified_cache_does_not_spend_new_compute_budget(self):
        from ai_ui_decomposition.cached import result_binding
        authorize(self.run,'Local fixture only');batch.reserve(self.run,'button');batch.receive(self.run,'button',self.raw)
        plan=deepcopy(self.plan);plan['assets'][1]['cached_result']=result_binding(self.run,'button')
        policy={**self.policy,'plan_digest':digest(plan),'initial_assets':['button-repair'],
                'replacements':{},'maximum_calls':1,'maximum_replacements':0}
        validate(policy,plan)
        with self.assertRaisesRegex(ContractError,'REQUEST_COVERAGE'):
            validate({**policy,'initial_assets':['button','button-repair'],'maximum_calls':2},plan)
        path=self.f.root/'cached-plan.json';pp=self.f.root/'cached-policy.json';write_json(path,plan);write_json(pp,policy)
        batch.freeze(path,self.f.workspace,'cached',execution_policy=pp);run=self.f.workspace/'runs/cached'
        reuse_result(run,'button',self.run,'button');authorize(run,'Local fixture only')
        with self.assertRaisesRegex(ContractError,'CACHED_RESULT_NO_GENERATION'):batch.reserve(run,'button')
        batch.reserve(run,'button-repair');batch.receive(run,'button-repair',self.raw)
        selected=select_plan(run,path,self.f.root/'cached-selected')
        self.assertEqual(selected['selected'],{'button-repair':'button-repair'})

    def test_single_approval_conditional_replacement_and_zero_call_selection(self):
        with self.assertRaisesRegex(ContractError,'NOT_AUTHORIZED'):batch.reserve(self.run,'button')
        authorize(self.run,'Explicit local regression authorization only')
        with self.assertRaisesRegex(ContractError,'PRIOR_RESULT'):batch.reserve(self.run,'button-repair')
        batch.reserve(self.run,'button')
        with self.assertRaisesRegex(ContractError,'PENDING_REQUEST'):batch.reserve(self.run,'button-repair')
        batch.receive(self.run,'button',self.raw)
        with self.assertRaisesRegex(ContractError,'EVIDENCE_REQUIRED'):batch.reserve(self.run,'button-repair')
        issue(self.run,'button','baked_state_part','Explicit fixture observation of wrong independent-part ownership.')
        with self.assertRaisesRegex(ContractError,'UNRESOLVED'):select_plan(self.run,self.path,self.f.root/'bad-selection')
        batch.reserve(self.run,'button-repair');batch.receive(self.run,'button-repair',self.raw)
        with self.assertRaises(ContractError):batch.reserve(self.run,'button-repair')
        output=self.f.root/'selected';result=select_plan(self.run,self.path,output)
        self.assertEqual(result['selected'],{'button':'button-repair'})
        new=batch.freeze(output/'plan.json',self.f.workspace,'selected');self.assertEqual(new['maximum_calls'],0)
        selected=self.f.workspace/'runs/selected';reuse_result(selected,'button',self.run,'button-repair')
        process(selected);self.assertTrue((selected/'materials/button/material.png').exists())

    def test_indeterminate_is_global_stop_not_a_repair_trigger(self):
        authorize(self.run,'Regression');batch.reserve(self.run,'button');batch.indeterminate(self.run,'button','Unknown provider result')
        with self.assertRaisesRegex(ContractError,'INDETERMINATE_STOP'):batch.reserve(self.run,'button-repair')
        with self.assertRaisesRegex(ContractError,'INDETERMINATE_STOP'):select_plan(self.run,self.path,self.f.root/'selected')
        batch.recover_receive(self.run,'button',self.raw)
        with self.assertRaisesRegex(ContractError,'INDETERMINATE_STOP'):batch.reserve(self.run,'button-repair')

    def test_budget_and_cosmetic_issue_cannot_trigger_replacement(self):
        policy={**self.policy,'maximum_calls':1,'maximum_replacements':0};p=self.f.root/'limited.json';write_json(p,policy)
        batch.freeze(self.path,self.f.workspace,'limited',execution_policy=p);run=self.f.workspace/'runs/limited'
        authorize(run,'Regression');batch.reserve(run,'button');batch.receive(run,'button',self.raw)
        with self.assertRaisesRegex(ContractError,'BLOCKING_EVIDENCE'):issue(run,'button','texture_difference','Cosmetic only')
        issue(run,'button','wrong_semantic_asset','Explicit fixture defect')
        with self.assertRaisesRegex(ContractError,'BUDGET_EXHAUSTED'):batch.reserve(run,'button-repair')

    def test_frozen_policy_scope_and_lock_integrity(self):
        for mutate in [lambda p:p.update(maximum_calls=3),lambda p:p.update(stop_on_indeterminate=False),lambda p:p.update(plan_digest='0'*64)]:
            policy=deepcopy(self.policy);mutate(policy)
            with self.assertRaises(ContractError):validate(policy,self.plan)
        authorize(self.run,'Regression');(self.run/'execution-reservation.lock').write_text('fixture lock')
        with self.assertRaisesRegex(ContractError,'BUSY'):batch.reserve(self.run,'button')
        with (self.run/'execution-policy.json').open('a') as f:f.write(' ')
        with self.assertRaisesRegex(ContractError,'POLICY_CHANGED'):batch.load(self.run)

    def test_authorization_and_observation_tampering_fail_closed(self):
        authorize(self.run,'Regression');batch.reserve(self.run,'button');batch.receive(self.run,'button',self.raw)
        issue(self.run,'button','wrong_semantic_asset','Fixture evidence')
        path=self.run/'requests/fixture-r001-button-r001/execution-issue.json'
        data=json.loads(path.read_text());data['raw_sha256']='0'*64;path.write_text(json.dumps(data))
        with self.assertRaisesRegex(ContractError,'ISSUE_CHANGED'):batch.reserve(self.run,'button-repair')
        path=self.run/'execution-authorization.json';data=json.loads(path.read_text());data['approval']='changed';path.write_text(json.dumps(data))
        with self.assertRaisesRegex(ContractError,'AUTHORIZATION_CHANGED'):batch.reserve(self.run,'button-repair')
