import unittest
import test_harness
from ai_ui_decomposition import batch
from ai_ui_decomposition.common import ContractError, digest, read_json, write_json, sha256
from ai_ui_decomposition.material_audit import audit
from ai_ui_decomposition.material_repair import compile_plan
from ai_ui_decomposition.cached import reuse_result


class MaterialRepairTests(unittest.TestCase):
    def setUp(self):
        self.fixture=test_harness.HarnessTests()
        self.fixture.setUp()
        self.addCleanup(self.fixture.tearDown)
        f=self.fixture
        batch.reserve(f.run,'button')
        batch.receive(f.run,'button',f.raw_component())

    def report(self, category=None):
        f=self.fixture
        observations=None
        if category:
            observations=f.root/'observations.json'
            write_json(observations,dict(kind='ai_ui_material_observations_v1',plan_digest=digest(f.plan),
                findings=[dict(asset='button',raw_sha256=sha256(f.root/'raw.png'),category=category,
                               observer='model',evidence='Local fixture observation')]))
        audit(f.run,f.root/'audit',observations)
        return f.root/'audit/material-audit.json'

    def compile(self, report):
        f=self.fixture
        return compile_plan(f.run,f.plan_path,report,f.root/'repair','repair-r001')

    def test_cosmetic_only_reuses_original_with_zero_calls(self):
        result=self.compile(self.report('texture_difference'))
        f=self.fixture
        self.assertEqual(result['maximum_calls'],0)
        batch.freeze(f.root/'repair/plan.json',f.workspace,'repair-r001')
        run=f.workspace/'runs/repair-r001'
        reuse_result(run,'button',f.run,'button')
        self.assertEqual(batch.status(run)['reused'],1)
        self.assertFalse(result['compute_authorized'])

    def test_blocker_produces_new_prompt_without_reservation(self):
        result=self.compile(self.report('baked_state_part'))
        f=self.fixture
        plan=read_json(f.root/'repair/plan.json')
        self.assertEqual(result['maximum_calls'],1)
        self.assertIn('no thumb',plan['assets'][1]['prompt'])
        self.assertNotIn('cached_result',plan['assets'][1])
        self.assertEqual(read_json(f.plan_path),f.plan)

    def test_unknown_evidence_blocks_planning(self):
        with self.assertRaisesRegex(ContractError,'REPAIR_UNRESOLVED_REVIEW'):
            self.compile(self.report('uncertain'))

    def test_changed_audit_rejected(self):
        path=self.report()
        body=read_json(path);body['assets']=[]
        path=self.fixture.root/'corrupted-audit.json';write_json(path,body)
        with self.assertRaisesRegex(ContractError,'REPAIR_AUDIT_CHANGED'):
            self.compile(path)

    def test_unsupported_failure_does_not_guess_repair(self):
        with self.assertRaisesRegex(ContractError,'REPAIR_STRATEGY_UNSUPPORTED'):
            self.compile(self.report('interaction_failure'))

    def test_existing_output_is_preserved(self):
        report=self.report()
        self.compile(report)
        with self.assertRaisesRegex(ContractError,'REPAIR_OUTPUT_EXISTS'):
            self.compile(report)
