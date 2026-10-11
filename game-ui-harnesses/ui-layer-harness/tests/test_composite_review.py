"""Offline complete-host regression: one final review, no per-request model calls."""
import _bootstrap
from pathlib import Path
import unittest
from unittest.mock import patch

from ai_ui_layers import composite_review as review, host_delivery as host
from ai_ui_layers.evaluate import read, save, digest
from ai_ui_layers.viewport_geometry_revision import validate_viewport_archive
import test_host_sheet_fallback as fixtures


def finish_composite(owner, answer=None, *, bad_reviewer=False):
    current=host.status(owner.run)
    host.authorize(owner.run,current['scopeDigest'],'Offline single final-review fixture only')
    reservation=host.next_request(owner.run)
    request=read(owner.run/'final-review/request.json')
    response=owner.base/'composite-answer.json'
    save(response,answer if answer is not None else dict(summary='Offline assembled comparison.',findings=[]))
    dispatch=owner.base/'composite-dispatch.bin';dispatch.write_bytes(b'Offline final review dispatch')
    returned=owner.base/'composite-return.bin';returned.write_bytes(b'Offline final review return')
    attestation=owner.base/'composite-attestation.json'
    save(attestation,dict(kind='ui_host_composite_review_attestation_v1',
        requestSha256=digest(owner.run/'final-review/request.json'),responseSha256=digest(response),
        reviewerId='fixture-generator' if bad_reviewer else request['reviewerId'],
        materialAuthors=request['materialAuthors'],model=request['model'],effort=request['effort'],
        independentCall=True,hostAssertedModelResponse=True,notProviderReceipt=True,
        notCryptographicallyPlatformVerified=True,dispatchEvidenceSha256=digest(dispatch),returnEvidenceSha256=digest(returned)))
    with owner.assertRaisesRegex(ValueError,'NO_RESUBMIT'):
        host.next_request(owner.run)
    return host.receive(owner.run,reservation['submissionDigest'],response,host_attestation=attestation,
                        dispatch_evidence=dispatch,return_evidence=returned)


class CompositeReviewTests(unittest.TestCase):
    setUp=fixtures.HostSheetFallbackTests.setUp
    acquire=fixtures.HostSheetFallbackTests.acquire

    def prepare(self):
        fixtures.HostSheetFallbackTests.prepare(self,materialReviewPolicy=review.POLICY,
                                                maximumMaterialReviews=1,maximumBodyCalls=1)

    def test_warning_default_and_historical_missing_policy(self):
        config={};review.configure(config,fast=True)
        self.assertEqual(config[review.FIELD],review.POLICY)
        self.assertFalse(review.enabled({}))
        strict={};review.configure(strict,fast=False)
        self.assertEqual(strict[review.FIELD],review.LEGACY)
        for config in ({review.FIELD:'unknown'},{review.FIELD:review.POLICY}):
            with self.assertRaisesRegex(ValueError,'BOUND_WARNING'):
                review.configure(config,fast=False)

    def test_many_images_one_review_after_zip_and_warnings_never_block(self):
        self.prepare()
        with (patch.object(host.host_material_review,'prepare',side_effect=AssertionError('No individual model packet')),
              patch.object(host.host_body_observation,'prepare',side_effect=AssertionError('No body observation'))):
            self.acquire(False)
        current=host.status(self.run)
        self.assertEqual(current['stage'],review.STAGE)
        self.assertEqual(current['maximumCalls'],1)
        self.assertEqual(current['perRequestMaterialReviewCalls'],0)
        self.assertFalse(current['compositeReviewCompleted'])
        self.assertFalse((self.run/'scopes/material_review').exists())
        request=read(self.run/'final-review/request.json')
        delivery=self.run/request['diagnosticDelivery']
        validate_viewport_archive(delivery/'viewport-ui-layers.zip')
        packet=read(self.run/'final-review/dispatch.json')
        self.assertEqual([r['file'] for r in packet['images']],['reference.png','recomposition.png','materials.png'])
        self.assertIn('not an assertion that removal succeeded',packet['prompt'])
        self.assertIn('including text copied unchanged from the original',packet['prompt'])
        self.assertIn('an empty list permits no ordinary text',packet['prompt'])
        self.assertIn('Keep owned single-character icon pictograms as artwork',packet['prompt'])
        self.assertNotIn('are intentionally blank',packet['prompt'])
        hashes={p.parent.name:digest(p) for p in (self.run/'images/attempts').glob('*/raw.png')}
        zip_hash=digest(delivery/'viewport-ui-layers.zip')
        answer=dict(summary='Visible duplicate subject in assembled fixture.',findings=[dict(
            category='ownership',materialIds=[request['materialIds'][0]],evidence='A foreign fixture subject overlaps the background.')])
        final=finish_composite(self,answer)
        self.assertEqual(final['stage'],'diagnostic_complete')
        self.assertEqual(final['compositeReviewCalls'],1)
        self.assertEqual(final['finalCompositeReviewReport']['sha256'],digest(self.run/'final-composite-warning-report.json'))
        self.assertFalse(final['humanVisualAcceptance'])
        self.assertFalse(final['FullAutomationExecutionCompleted'])
        self.assertEqual(digest(delivery/'viewport-ui-layers.zip'),zip_hash)
        self.assertEqual(hashes,{p.parent.name:digest(p) for p in (self.run/'images/attempts').glob('*/raw.png')})
        report=read(self.run/'final-composite-warning-report.json')
        self.assertEqual(report['composite'][0]['severity'],'warning')
        self.assertEqual((self.run/'final-review/response.json').read_bytes(),(self.base/'composite-answer.json').read_bytes())
        with self.assertRaisesRegex(ValueError,'NO_NEXT'):
            host.next_request(self.run)
        before=host._files(self.run);host.resume(self.run)
        self.assertEqual(before,host._files(self.run))

    def test_empty_findings_do_not_certify_individual_materials(self):
        self.prepare();self.acquire(False)
        final=finish_composite(self)
        self.assertTrue(final['compositeReviewCompleted'])
        self.assertFalse(final['independentMaterialDeliveryComplete'])
        self.assertFalse(final['strictVisualReviewPassed'])
        self.assertFalse((self.run/'body').exists())

    def test_residual_text_is_one_warning_without_extra_calls_or_image_changes(self):
        self.prepare();self.acquire(False)
        request=read(self.run/'final-review/request.json')
        packet=read(self.run/'final-review/dispatch.json')
        material=next(row for row in packet['materials'] if not row['preserveText'])
        self.assertEqual(packet['maximumCalls'],1)
        self.assertEqual(packet['perRequestReviewCalls'],0)
        self.assertEqual(packet['bodyObservationCalls'],0)
        delivery=self.run/request['diagnosticDelivery']
        zip_hash=digest(delivery/'viewport-ui-layers.zip')
        raws={p: digest(p) for p in (self.run/'images/attempts').glob('*/raw.png')}
        final=finish_composite(self,dict(summary='Ordinary button label remains.',findings=[dict(
            category='text',materialIds=[material['materialId']],
            evidence='A visible ordinary button label remains although preserveText is empty.')]))
        self.assertEqual(final['stage'],'diagnostic_complete')
        self.assertEqual(final['compositeReviewCalls'],1)
        report=read(self.run/'final-composite-warning-report.json')
        self.assertEqual(report['composite'][0]['category'],'text')
        self.assertEqual(report['composite'][0]['severity'],'warning')
        self.assertEqual(digest(delivery/'viewport-ui-layers.zip'),zip_hash)
        self.assertEqual({p:digest(p) for p in raws},raws)
        self.assertFalse(final['strictVisualReviewPassed'])
        self.assertFalse(final['humanVisualAcceptance'])
        with self.assertRaisesRegex(ValueError,'NO_NEXT'):host.next_request(self.run)

    def test_bad_sheet_still_reaches_one_final_review_and_retains_raw(self):
        self.prepare();bad=self.acquire(True)
        self.assertIsNotNone(bad)
        self.assertEqual(host.status(self.run)['stage'],review.STAGE)
        raw=self.run/'images/attempts'/bad/'raw.png';before=digest(raw)
        finish_composite(self)
        self.assertEqual(digest(raw),before)
        self.assertTrue(read(self.run/'visual-warning-report.json')['excludedUncertainMaterialIds'])

    def test_invalid_original_answer_is_terminal_and_preserved(self):
        self.prepare();self.acquire(False)
        with self.assertRaises(Exception):
            finish_composite(self,dict(summary='Invalid material identity.',findings=[dict(
                category='ownership',materialIds=['invented-material'],evidence='Invalid fixture.')]))
        self.assertEqual(host.status(self.run)['status'],'failed_no_retry')
        self.assertEqual(host.status(self.run)['compositeReviewCalls'],1)
        self.assertEqual(host.status(self.run)['completedCompositeReviewCalls'],0)
        self.assertEqual((self.run/'final-review/response.json').read_bytes(),(self.base/'composite-answer.json').read_bytes())
        self.assertFalse((self.run/'final-review/result.json').exists())
        with self.assertRaisesRegex(ValueError,'NO_NEXT'):
            host.next_request(self.run)


if __name__=='__main__':unittest.main()
