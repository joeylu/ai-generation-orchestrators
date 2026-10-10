"""Operation-local verification reduces repeated decoding without retaining trust."""
import _bootstrap
import unittest
from unittest.mock import patch

from ai_ui_layers import received_source_batch as batch, host_material_review as host
from test_single_material_review import SingleMaterialReviewTests


class ReceivedBatchTests(unittest.TestCase):
    setUp=SingleMaterialReviewTests.setUp

    def test_multiple_source_reads_verify_job_once_per_operation(self):
        with patch.object(batch,'load_job',wraps=batch.load_job) as load,patch.object(batch,'status',wraps=batch.status) as status:
            for _ in range(2):
                with batch.received_sources(self.job) as sources:
                    for _ in range(3):
                        host.source(self.job,'asset-coin-a',source_batch=sources)
                    sources.check_files(self.job,sources.file_hashes)
            self.assertEqual(load.call_count,2)
            self.assertEqual(status.call_count,2)

    def test_changed_source_during_batch_is_rejected_at_operation_boundary(self):
        with self.assertRaisesRegex(ValueError,'RECEIVED_BATCH_INPUT_CHANGED'):
            with batch.received_sources(self.job) as sources:
                _,_,_,raw=host.source(self.job,'asset-coin-a',source_batch=sources)
                raw.write_bytes(raw.read_bytes()+b'changed fixture')
        with self.assertRaises(ValueError):
            with batch.received_sources(self.job):pass


if __name__=='__main__':unittest.main()
