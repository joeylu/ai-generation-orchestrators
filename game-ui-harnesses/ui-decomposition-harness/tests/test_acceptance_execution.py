import unittest
from unittest.mock import patch

from ai_ui_decomposition.acceptance_execution import AcceptanceExecution
from ai_ui_decomposition.common import ContractError


class AcceptanceExecutionTests(unittest.TestCase):
    def test_invalid_budgets(self):
        for value in [True, 0, -1, 86401, 1.5, '600', None]:
            with self.subTest(value=value), self.assertRaisesRegex(ContractError, 'STATE_TIMEOUT_INVALID'):
                AcceptanceExecution(value)

    def test_monotonic_stage_timings_and_deadline(self):
        with patch('ai_ui_decomposition.acceptance_execution.monotonic') as clock:
            clock.return_value=10
            execution=AcceptanceExecution(5)
            execution.start('evidence')
            clock.return_value=12
            execution.start('official-import')
            self.assertEqual(execution.remaining(),3)
            clock.return_value=16
            with self.assertRaisesRegex(ContractError,'STATE_ACCEPTANCE_TIMEOUT'):
                execution.remaining()
            report=execution.report(failed=True)
        self.assertEqual(report['elapsedSeconds'],6)
        self.assertEqual(report['automaticRetries'],0)
        self.assertEqual(report['stages'],[
            {'name':'evidence','status':'passed','elapsedSeconds':2},
            {'name':'official-import','status':'failed','elapsedSeconds':4}])

    def test_failure_before_first_stage(self):
        self.assertEqual(AcceptanceExecution(1).report(failed=True)['stages'],[])
