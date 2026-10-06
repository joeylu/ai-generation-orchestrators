"""Offline preparation failure: preserve producer evidence and terminal host state."""
import _bootstrap
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from ai_ui_layers import host_delivery as host
from ai_ui_layers.evaluate import read, save, digest


class HostMaterialPreparationFailureTests(unittest.TestCase):
    def test_blocked_prepare_preserves_reason_and_seals_without_retry(self):
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary)
            config=host.record(root/'config.json',dict(kind=host.KIND,runtime={},
                materialAuthors=['fixture-generator'],planningMode='offline-fixture',
                m1ModelExecuted=False,maximumModelCallSeconds=30,maximumImageCallSeconds=30))
            host._state(root,config,'images');host._checkpoint(root)
            result=dict(status='blocked_no_retry',reason='MATERIAL_GATE_FAILED',
                materialId='explorer',modelCalls=0,humanVisualAcceptance=False)

            def blocked_prepare(job,request_id,folder,**kwargs):
                self.assertEqual(request_id,'explorer')
                folder.mkdir(parents=True)
                save(folder/'result.json',result)
                (folder/'processed').mkdir()
                save(folder/'processed/report.json',dict(issues=['POSSIBLY_CLIPPED_SOURCE']))
                return result

            reason=('HOST_MATERIAL_PREPARATION_BLOCKED:requestId=explorer:reason=MATERIAL_GATE_FAILED'
                    ':issues=["POSSIBLY_CLIPPED_SOURCE"]')
            with patch.object(host.host_review,'runtime_files',return_value={}), \
                 patch.object(host.experimental_executor,'status',return_value={'status':'raw_complete'}), \
                 patch.object(host.experimental_executor,'load_job',return_value=({'assets':['explorer']},{})), \
                 patch.object(host.host_material_review,'prepare',side_effect=blocked_prepare) as prepare:
                with self.assertRaises(ValueError) as raised:host.resume(root)
                self.assertEqual(str(raised.exception),reason)
                current=host.status(root)
                self.assertEqual(current['status'],'failed_no_retry')
                self.assertEqual(current['reason'],reason)
                self.assertEqual(current['automaticRetries'],0)
                self.assertFalse(current['FullAutomationExecutionCompleted'])
                self.assertFalse((root/'transaction.json').exists())
                self.assertFalse((root/'reviews/explorer/request.json').exists())
                self.assertFalse((root/'scopes/material_review').exists())
                self.assertEqual(read(root/'reviews/explorer/result.json'),result)
                report=root/'reviews/explorer/processed/report.json'
                self.assertEqual(read(report)['issues'],['POSSIBLY_CLIPPED_SOURCE'])
                report_sha=digest(report)
                before=host._files(root)
                self.assertEqual(host.resume(root)['status'],'failed_no_retry')
                self.assertEqual(prepare.call_count,1)
                self.assertEqual(host._files(root),before)
                self.assertEqual(digest(report),report_sha)


if __name__=='__main__':unittest.main()
