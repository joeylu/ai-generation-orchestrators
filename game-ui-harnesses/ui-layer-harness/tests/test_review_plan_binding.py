"""Coverage findings must retain the plan that makes their evidence invalid."""
import _bootstrap
import json
import unittest

from ai_ui_layers.compile_visual import verify_run
from ai_ui_layers.evaluate import read, digest
from ai_ui_layers.freeze_visual import freeze
from ai_ui_layers.planning_dag import Dag
from ai_ui_layers.revise_plan import init as revise, RevisionDag, check_scope
from test_planning_dag import FakeModel
import test_planning_dag
import test_planning_convergence


def invalid_quote(folder, description='Unrecorded attached emblem'):
    answer = read(folder/'draft.json')
    answer['issues'] = []
    part = answer['smallMaterialAudit'][0]['parts'][0]
    part.update(visiblePart=description, observedAppearance='Small colored emblem',
                planEvidenceQuote='This text does not occur in the reviewed plan.')
    (folder/'draft.json').write_text(json.dumps(answer), encoding='utf-8')
    receipt = read(folder/'transport.json')
    receipt['responseSha256'] = digest(folder/'draft.json')
    (folder/'transport.json').write_text(json.dumps(receipt), encoding='utf-8')


class ReviewPlanBindingTests(unittest.TestCase):
    def setUp(self):
        test_planning_dag.DagTests.setUp(self)

    def model(self, stages):
        base = FakeModel()
        def call(folder, sid, first):
            base(folder, sid, first)
            if folder.name in stages:
                invalid_quote(folder)
        return base, call

    def test_m2_invalid_nonempty_quote_enters_repair(self):
        base, call = self.model({'m2'})
        result = Dag(self.root, call).execute()
        self.assertEqual(result['status'], 'frozen')
        self.assertEqual([name for name, _ in base.calls], ['m1','m2','repair','rereview'])
        self.assertIn('UNDESCRIBED_SMALL_MATERIAL_PART',
                      (self.root/'repair/prompt.md').read_text(encoding='utf-8'))

    def test_same_invalid_quote_after_repair_stops_without_second_repair(self):
        base, call = self.model({'m2','rereview'})
        dag = Dag(self.root, call)
        with self.assertRaisesRegex(ValueError, 'REREVIEW_UNRESOLVED'):
            dag.execute()
        self.assertEqual([name for name, _ in base.calls], ['m1','m2','repair','rereview'])
        self.assertFalse((self.root/'frozen').exists())
        with self.assertRaisesRegex(ValueError, 'NO_RESUBMIT'):
            dag.execute()
        self.assertEqual(len(base.calls), 4)

    def test_direct_freeze_rechecks_quote_against_plan(self):
        _, call = self.model({'m2'})
        dag = Dag(self.root, call)
        dag.node('m1', dag.m1)
        dag.node('check', dag.check)
        dag.node('m2', lambda: dag.review('m2', self.root/'m1/draft.json',
                                        self.root/'m1/preview/materials-overlay.png'))
        with self.assertRaisesRegex(ValueError, 'M2_UNRESOLVED'):
            verify_run(self.root)
        with self.assertRaisesRegex(ValueError, 'M2_UNRESOLVED'):
            freeze(self.root, self.root/'direct-freeze', 8)
        self.assertFalse((self.root/'direct-freeze').exists())

    def test_explicit_revision_preserves_derived_issue_scope_and_freeze_gate(self):
        _, call = self.model({'m2','rereview'})
        with self.assertRaisesRegex(ValueError, 'REREVIEW_UNRESOLVED'):
            Dag(self.root, call).execute()
        child = revise(self.root, self.root.parent/'child', 'Explicit fixture revision')
        owner = read(self.root/'rereview/draft.json')['smallMaterialAudit'][0]['materialId']
        def model(folder, sid, first):
            self.assertFalse(first)
            if folder.name == 'repair':
                from ai_ui_layers.evaluate import save
                source = child/'source-plan.json'
                material = next(m for m in read(source)['materials'] if m['id'] == owner)
                material['label'] += ' revised'
                save(folder/'draft.json', dict(sourcePlanSha256=digest(source),
                    materials=dict(upsert=[material], remove=[]), objects=dict(upsert=[], remove=[]),
                    unknowns=None, backgroundMode=None, textPolicy=None, unresolvedIssues=[]))
                (folder/'events.jsonl').write_text(json.dumps(dict(type='thread.started', thread_id=sid)))
                save(folder/'transport.json', dict(exitCode=0, turnCompleted=True, unexpectedEvents=[],
                    responseSha256=digest(folder/'draft.json'), elapsedSeconds=.01))
            else:
                FakeModel()(folder, sid, first)
                invalid_quote(folder)
        dag = RevisionDag(child, model)
        with self.assertRaisesRegex(ValueError, 'REREVIEW_UNRESOLVED'):
            dag.execute()
        check_scope(child)
        with self.assertRaisesRegex(ValueError, 'M2_UNRESOLVED'):
            verify_run(child)
        self.assertFalse((child/'frozen').exists())


class RereviewPlanBindingTests(unittest.TestCase):
    def setUp(self):
        test_planning_convergence.ConvergenceTests.setUp(self)

    def test_new_invalid_quote_in_rereview_uses_second_bounded_repair(self):
        base = test_planning_convergence.ConvergenceTests.model(self)
        def call(folder, sid, first):
            base(folder, sid, first)
            if folder.name == 'rereview':
                invalid_quote(folder)
        self.assertEqual(Dag(self.root, call).execute()['status'], 'frozen')
        self.assertEqual(self.calls, ['m1','m2','repair','rereview','repair2','rereview2'])


if __name__ == '__main__':
    unittest.main()
