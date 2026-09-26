import _bootstrap
import unittest

import test_accepted_materials
from ai_ui_layers.evaluate import read, save
from ai_ui_layers.review_required_variants import build
from ai_ui_layers.layer_package import validate_archive


class ReviewRequiredVariantTests(unittest.TestCase):
    def setUp(self):
        test_accepted_materials.AcceptanceTests.setUp(self)
        selection=read(self.spec)
        self.spec=self.root/'review-selection.json'
        selection['kind']='ui_received_variant_selection_v1'
        selection['candidatePreview']=selection.pop('acceptedPreview')
        selection['candidatePreviewSha256']=selection.pop('acceptedPreviewSha256')
        save(self.spec,selection)

    def test_replays_receipts_and_matches_candidate_without_acceptance(self):
        out=self.root/'review-required'
        result=build(self.spec,out,self.viewer)
        self.assertTrue(result['sourceReceiptReplayPassed'])
        self.assertTrue(result['candidatePreviewMatched'])
        self.assertFalse(result['originalDagPromoted'])
        self.assertFalse(result['humanVisualAcceptance'])
        self.assertEqual(validate_archive(out/'ui-layers.zip')['status'],'package_integrity_passed')
        self.assertEqual(read(out/'package/review.json')['status'],'review-required')
        self.assertFalse((out/'acceptance.json').exists())

    def test_tampered_receipt_source_fails_before_package(self):
        first=read(self.spec)['layers'][0]
        (self.job/'attempts'/first['requestId']/'raw.png').write_bytes(b'changed')
        out=self.root/'tampered'
        with self.assertRaises(ValueError):build(self.spec,out,self.viewer)
        self.assertFalse(out.exists())

    def test_omitted_layer_and_changed_candidate_fail_closed(self):
        selection=read(self.spec);selection['layers'].pop()
        changed=self.root/'omitted.json';save(changed,selection)
        with self.assertRaisesRegex(ValueError,'LAYER_SET_MISMATCH'):
            build(changed,self.root/'omitted',self.viewer)
        selection=read(self.spec);selection['candidatePreviewSha256']='0'*64
        changed=self.root/'changed.json';save(changed,selection)
        with self.assertRaisesRegex(ValueError,'CANDIDATE_PREVIEW_CHANGED'):
            build(changed,self.root/'changed',self.viewer)


if __name__=='__main__':unittest.main()
