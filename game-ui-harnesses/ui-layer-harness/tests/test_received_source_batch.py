"""Operation-local verification reduces repeated decoding without retaining trust."""
import _bootstrap
import unittest
from unittest.mock import patch

from ai_ui_layers import received_source_batch as batch, host_material_review as host
from ai_ui_layers import experimental_executor as executor
from ai_ui_layers.evaluate import read
import test_single_material_review as material_fixtures


class ReceivedBatchTests(unittest.TestCase):
    setUp=material_fixtures.SingleMaterialReviewTests.setUp

    def test_multiple_source_reads_verify_job_once_per_operation(self):
        with patch.object(batch,'load_job',wraps=batch.load_job) as load, \
                patch.object(executor,'load_job',wraps=executor.load_job) as nested_load:
            for _ in range(2):
                with batch.received_sources(self.job) as sources:
                    for _ in range(3):
                        host.source(self.job,'asset-coin-a',source_batch=sources)
                    sources.check_files(self.job,sources.file_hashes)
            self.assertEqual(load.call_count,2)
            self.assertEqual(nested_load.call_count,0)

    def test_batch_status_matches_public_status(self):
        expected=executor.status(self.job)['requests']
        with batch.received_sources(self.job) as sources:
            self.assertEqual(sources.states,expected)

    def test_change_during_initial_validation_is_in_final_inventory_check(self):
        original=batch.load_job
        def changed(job):
            result=original(job)
            (job/'unbound-file.txt').write_text('changed during validation',encoding='utf-8')
            return result
        with patch.object(batch,'load_job',side_effect=changed):
            with self.assertRaisesRegex(ValueError,'RECEIVED_BATCH_INPUT_CHANGED'):
                with batch.received_sources(self.job) as sources:
                    host.source(self.job,'asset-coin-a',source_batch=sources)

    def test_each_batch_reverifies_authorization_submission_receipt_and_raw(self):
        attempt=self.job/'attempts/asset-coin-a'
        for path,key,error in (
                (self.job/'authorization.json','jobDigest','AUTHORIZATION_CHANGED'),
                (attempt/'submission.json','requestDigest','REQUEST_CHANGED'),
                (attempt/'received.json','submissionDigest','RESULT_BINDING'),
                (attempt/'raw.png',None,'RESULT_CHANGED')):
            with self.subTest(error=error):
                with batch.received_sources(self.job):pass
                original=path.read_bytes()
                try:
                    if key:
                        value=read(path);value.pop('digest');value[key]='0'*64
                        path.unlink()
                        executor.record(path,value)
                    else:path.write_bytes(original+b'changed raw fixture')
                    with self.assertRaisesRegex(ValueError,error):
                        with batch.received_sources(self.job):pass
                finally:path.write_bytes(original)

    def test_failed_state_never_becomes_received_or_resubmittable(self):
        attempt=self.job/'attempts/asset-coin-a'
        received=read(attempt/'received.json')
        (attempt/'received.json').unlink()
        executor.record(attempt/'failed.json',dict(submissionDigest=received['submissionDigest']))
        before=host.files(self.job)
        with batch.received_sources(self.job) as sources:
            self.assertEqual(sources.states,executor.status(self.job)['requests'])
            self.assertEqual(sources.states['asset-coin-a'],'failed_no_resubmit')
            with self.assertRaisesRegex(ValueError,'RECEIVED_REQUEST_REQUIRED'):
                host.source(self.job,'asset-coin-a',source_batch=sources)
        with self.assertRaisesRegex(ValueError,'NOT_READY_NO_RESUBMIT'):
            executor.next_request(self.job)
        self.assertEqual(host.files(self.job),before)

    def test_changed_source_during_batch_is_rejected_at_operation_boundary(self):
        with self.assertRaisesRegex(ValueError,'RECEIVED_BATCH_INPUT_CHANGED'):
            with batch.received_sources(self.job) as sources:
                _,_,_,raw=host.source(self.job,'asset-coin-a',source_batch=sources)
                raw.write_bytes(raw.read_bytes()+b'changed fixture')
        with self.assertRaises(ValueError):
            with batch.received_sources(self.job):pass


if __name__=='__main__':unittest.main()
