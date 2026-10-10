"""Offline regression for no per-material model calls and honest warning output."""
import _bootstrap
import json
import unittest
import zipfile
from unittest.mock import patch

from ai_ui_layers import host_delivery as host, host_material_review as material, host_sheet_fallback as fallback
from ai_ui_layers.evaluate import read
from ai_ui_layers.viewport_geometry_revision import validate_viewport_archive
from test_host_material_review import HostEvidence
import test_host_sheet_fallback as fixtures


class FastWarningDeliveryTests(unittest.TestCase):
    setUp=fixtures.HostSheetFallbackTests.setUp
    prepare=fixtures.HostSheetFallbackTests.prepare
    acquire=fixtures.HostSheetFallbackTests.acquire

    def finish(self, unresolved=False):
        host.authorize(self.run,host.status(self.run)['scopeDigest'],'Offline material fixtures only')
        self.root=self.base; uncertain=None
        with patch.object(host.host_body_observation,'prepare',side_effect=AssertionError('No per-material body job')):
            while host.status(self.run)['stage']=='material_review':
                request=host.next_request(self.run);key=request['currentRequest']['requestId']
                folder=self.run/'reviews'/key
                answer=None
                if unresolved=='all' or unresolved and uncertain is None and len(read(folder/'request.json')['materialIds'])>1:
                    uncertain=key
                    mid=read(folder/'request.json')['materialIds'][0]
                    answer=dict(materialIds=[],findings=[dict(materialId=mid,category='uncertain',
                        referenceState='not-applicable',generatedState='not-applicable',magnitude='uncertain',
                        ownership='ambiguous',styleAspect='other',evidence='Blank fixture instances cannot be distinguished.',
                        suggestion='Inspect the final composite.')])
                evidence=HostEvidence.response(self,folder,answer)
                host.receive(self.run,request['submissionDigest'],evidence['response'],
                    host_attestation=evidence['host_attestation'],dispatch_evidence=evidence['dispatch_evidence'],
                    return_evidence=evidence['return_evidence'])
                self.assertEqual((folder/'review/draft.json').read_bytes(),evidence['response'].read_bytes())
        return uncertain

    def check_output(self):
        current=host.status(self.run)
        self.assertEqual(current['status'],'diagnostic_complete_pending_visual_acceptance')
        self.assertFalse(current['FullAutomationExecutionCompleted'])
        self.assertFalse(current['humanVisualAcceptance'])
        self.assertFalse((self.run/'body').exists())
        self.assertFalse((self.run/'body-input.json').exists())
        output=self.run/'diagnostic-output'; result=read(output/'result.json')
        self.assertEqual(result['layerCount'],len(self.plan['materials']))
        self.assertEqual(result['modelCalls'],0)
        self.assertEqual(result['generationCalls'],0)
        self.assertEqual(read(self.run/'visual-warning-report.json')['continuedBodyObservationCalls'],0)
        validate_viewport_archive(output/'delivery/viewport-ui-layers.zip')
        with zipfile.ZipFile(output/'diagnostic-sources.zip') as archive:
            for key in read(self.run/'images/job.json')['assets']:
                self.assertEqual(archive.read('raw/'+key+'.png'),(self.run/'images/attempts'/key/'raw.png').read_bytes())
        self.assertTrue(any(w.get('code')=='BODY_OBSERVATION_NOT_AVAILABLE'
            for w in read(output/'visual-warning-report.json')['warnings']))
        before=host._files(self.run);host.resume(self.run)
        self.assertEqual(before,host._files(self.run))

    def test_default_good_batch_delivers_without_any_body_reservation(self):
        self.prepare(maximumBodyCalls=1);self.acquire(False)
        self.assertEqual(read(self.run/'config.json')['bodyReviewPolicy'],fallback.FAST)
        self.assertNotIn('unresolved',read(self.run/'scopes/material_review/scope.json')['stops'])
        self.finish();self.check_output()
        result=read(self.run/'diagnostic-output/result.json')
        self.assertEqual(set(result['materialReviewReplay']['reviewedRequestIds']),set(read(self.run/'images/job.json')['assets']))

    def test_clipped_preparation_and_uncertain_identity_continue_without_retry(self):
        self.prepare();self.acquire(False,clipped=True)
        self.assertIsNotNone(self.clipped_key)
        original=read(self.run/'reviews'/self.clipped_key/'result.json')
        self.assertEqual(original['status'],'blocked_no_retry')
        self.assertEqual(original['modelCalls'],0)
        uncertain=self.finish(True);self.assertIsNotNone(uncertain)
        self.check_output()
        self.assertEqual(original,read(self.run/'reviews'/self.clipped_key/'result.json'))
        folder=self.run/'reviews'/uncertain
        material.verify_unresolved_run(folder)
        self.assertEqual(read(folder/'review/draft.json')['materialIds'],[])
        with self.assertRaisesRegex(ValueError,'OUTPUT_REVIEW_NOT_PASSED'):material.verify_run(folder)
        with self.assertRaisesRegex(ValueError,'ALREADY_TERMINAL'):
            material.receive(folder,'unused','unused',response_sha256='unused',host_attestation='unused',dispatch_evidence='unused',return_evidence='unused')
        output=self.run/'diagnostic-output'
        warnings=read(output/'visual-warning-report.json')['warnings']
        self.assertTrue(any(w.get('code')=='POSSIBLY_CLIPPED_SOURCE' for w in warnings))
        self.assertTrue(any(w.get('code')=='MATERIAL_IDENTITY_UNRESOLVED' for w in warnings))
        with zipfile.ZipFile(output/'diagnostic-sources.zip') as archive:
            evidence=json.loads(archive.read('diagnostic-evidence.json'))
            self.assertIn('MATERIAL_IDENTITY_UNRESOLVED',json.dumps(evidence))
        replay=read(output/'result.json')['materialReviewReplay']
        self.assertEqual(set(replay['unreviewedRequestIds']),{uncertain,self.clipped_key})

    def test_all_uncertain_reviews_keep_all_layers_without_formal_cutouts(self):
        self.prepare();self.acquire(False);self.finish('all');self.check_output()
        result=read(self.run/'diagnostic-output/result.json')
        self.assertEqual(result['materialReviewReplay']['reviewedMaterialIds'],[])
        self.assertEqual(result['materialReviewReplay']['reviewedRequestIds'],[])
        self.assertEqual(set(result['materialReviewReplay']['unreviewedRequestIds']),set(read(self.run/'images/job.json')['assets']))


if __name__=='__main__':unittest.main()
