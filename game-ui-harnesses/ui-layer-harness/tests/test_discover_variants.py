import _bootstrap
import unittest

import test_accepted_materials
from ai_ui_layers import experimental_executor as exchange
from ai_ui_layers.discover_variants import discover
from ai_ui_layers.evaluate import read
from ai_ui_layers.review_required_variants import build


class DiscoveryTests(unittest.TestCase):
    def setUp(self):
        test_accepted_materials.AcceptanceTests.setUp(self)

    def test_finds_unique_received_sources_and_packages_without_manual_map(self):
        selection=self.root/'discovered.json'
        evidence=discover(self.snapshot,self.preview,self.root,selection)
        self.assertTrue(evidence['automaticVariantDiscovery'])
        self.assertEqual(evidence['sourceJobsCount'],1)
        result=build(selection,self.root/'delivered',self.viewer)
        self.assertTrue(result['candidatePreviewMatched'])
        self.assertTrue(result['sourceReceiptReplayPassed'])

    def test_duplicate_matching_received_source_stops_before_selection(self):
        first=read(self.spec)['layers'][0]['materialId']
        duplicate=self.root/'duplicate-job'
        job=exchange.prepare(self.snapshot,read(self.snapshot/'snapshot.json')['digest'],duplicate,assets=[first])
        exchange.authorize(duplicate,job['digest'],'fixture only')
        request=exchange.next_request(duplicate)
        exchange.receive(duplicate,request['submissionDigest'],self.job/'attempts'/first/'raw.png')
        selection=self.root/'ambiguous.json'
        with self.assertRaisesRegex(ValueError,'VARIANT_SOURCE_UNRESOLVED'):
            discover(self.snapshot,self.preview,self.root,selection)
        self.assertFalse(selection.exists())


if __name__=='__main__':unittest.main()
