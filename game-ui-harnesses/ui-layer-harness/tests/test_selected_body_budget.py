"""Selected observations consume their selected count, with explicit warning binding."""
import _bootstrap
import unittest
from unittest.mock import patch

from ai_ui_layers import host_body_observation as host, visual_policy
from ai_ui_layers.evaluate import read, save
import test_host_body_observation as fixtures


class SelectedBodyBudgetTests(unittest.TestCase):
    setUp=fixtures.HostBodyObservationTests.setUp

    def select(self, count):
        config=read(self.inputs)
        _,ids=host.body.foreground(self.snapshot)
        self.assertGreater(len(ids),1)
        config['diagnosticMaterialIds']=ids[:count]
        self.inputs.unlink();save(self.inputs,config)
        return config['diagnosticMaterialIds']

    def test_selected_subset_fits_even_when_full_foreground_exceeds_cap(self):
        ids=self.select(1)
        with patch.object(visual_policy,'snapshot_policy',return_value=visual_policy.warning_policy()):
            result=host.prepare(self.inputs,self.job,1)
        self.assertEqual(result['maximumCalls'],1)
        self.assertEqual(set(read(self.job/'job.json')['requests']),set(ids))
        self.assertEqual(result['assignedCalls'],0)

    def test_selected_overflow_and_invalid_limit_still_fail_before_job(self):
        self.select(2)
        with patch.object(visual_policy,'snapshot_policy',return_value=visual_policy.warning_policy()):
            for maximum in (1,0,True,'2'):
                with self.subTest(maximum=maximum),self.assertRaisesRegex(ValueError,'BODY_CALL_'):
                    host.prepare(self.inputs,self.job,maximum)
        self.assertFalse(self.job.exists())

    def test_strict_snapshot_cannot_opt_into_diagnostic_subset(self):
        self.select(1)
        with self.assertRaisesRegex(ValueError,'BOUND_DIAGNOSTIC_BODY_SUBSET_REQUIRED'):
            host.prepare(self.inputs,self.job,1)
        self.assertFalse(self.job.exists())


if __name__=='__main__':unittest.main()
