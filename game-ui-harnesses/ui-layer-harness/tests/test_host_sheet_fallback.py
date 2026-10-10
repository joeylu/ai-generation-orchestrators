"""Offline host regression: a real received sheet cannot silently stop warning output."""
import _bootstrap
import unittest
from unittest.mock import patch
import zipfile

from PIL import Image, ImageDraw

from ai_ui_layers import host_delivery as host, host_sheet_fallback as fallback
from ai_ui_layers.evaluate import read, save
from ai_ui_layers.viewport_geometry_revision import validate_viewport_archive
from ai_ui_layers.evaluate import digest
from pathlib import Path
from test_host_material_review import HostEvidence
import test_host_delivery as fixtures


class HostSheetFallbackTests(unittest.TestCase):
    def setUp(self):
        fixtures.HostDeliveryTests.setUp(self)

    def prepare(self, warning=True, **changes):
        config=read(self.config_path)
        if warning:config['visualReviewMode']='warning'
        config.update(changes)
        path=self.base/'fallback-config.json';save(path,config)
        self.run=self.base/'fallback-host';host.prepare(path,self.run)
        self.root=self.run/'planning'
        original=fixtures.review_fixtures.HostReviewTests.response_doc
        def response(owner):
            answer=original(owner)
            if warning:
                for entry in answer['smallMaterialAudit'].values():
                    for part in entry['parts']:
                        if part['descriptionStatus']!='reference-bound':part['deferredAppearance']=None
            return answer
        with patch.object(fixtures.review_fixtures.HostReviewTests,'response_doc',response):
            fixtures.HostDeliveryTests.planning(self)

    def acquire(self, bad_sheet=True, clipped=False):
        host.authorize(self.run,host.status(self.run)['scopeDigest'],'Offline PNG fixture only.')
        bad=None
        while host.status(self.run)['stage']=='images':
            request=host.next_request(self.run)
            if 'materialIds' in request:
                columns,rows=request['grid'];image=Image.new('RGBA',(columns*160,rows*160))
                draw=ImageDraw.Draw(image)
                for i,mid in enumerate(request['materialIds']):
                    x=i%columns*160;y=i//columns*160
                    draw.rectangle((x+25,y+25,x+135,y+135),fill=(60,90,100,255))
                if bad_sheet and bad is None:
                    # Connected glow occupies every candidate seam and touches
                    # the outer canvas. Equal-grid candidates retain it exactly.
                    draw.line((0,80,image.width-1,80),fill=(80,90,100,80),width=3)
                    draw.line((80,0,80,image.height-1),fill=(80,90,100,80),width=3)
                    bad=request['asset']
            elif request['asset']=='asset-scene':
                # Native size differs from the original; the frozen whole
                # background policy must also work on the diagnostic branch.
                image=Image.new('RGB',(320,320),(40,50,60))
            else:
                image=Image.new('RGBA',(160,160))
                ImageDraw.Draw(image).rectangle((25,25,135,135),fill=(80,90,100,255))
                if clipped and not getattr(self,'clipped_key',None):
                    ImageDraw.Draw(image).rectangle((0,25,159,135),fill=(80,90,100,255))
                    self.clipped_key=request['asset']
            raw=self.base/'fixture-raw.png';image.save(raw)
            host.receive(self.run,request['submissionDigest'],raw)
        return bad

    def test_warning_sheet_failure_delivers_preview_zip_and_unchanged_raw(self):
        self.prepare(sheetFailurePolicy=fallback.POLICY)
        self.assertEqual(read(self.run/'config.json')['sheetFailurePolicy'],fallback.POLICY)
        with patch.object(host.host_material_review,'prepare',side_effect=AssertionError('No new review call on diagnostic branch')):
            bad=self.acquire()
        self.assertIsNotNone(bad)
        status=host.status(self.run)
        self.assertEqual(status['status'],'diagnostic_complete_pending_visual_acceptance')
        self.assertTrue(status['diagnosticExecutionCompleted'])
        self.assertFalse(status['FullAutomationExecutionCompleted'])
        self.assertFalse(status['FullReferenceToDeliveryExecutionCompleted'])
        self.assertFalse(status['independentMaterialDeliveryComplete'])
        self.assertFalse(status['humanVisualAcceptance'])
        self.assertEqual(status['automaticRetries'],0)
        output=self.run/'diagnostic-output'
        result=read(output/'result.json')
        self.assertEqual(result['generationCalls'],0);self.assertEqual(result['modelCalls'],0)
        self.assertEqual(result['layerCount'],len(self.plan['materials']))
        with Image.open(output/'delivery/viewport-preview.png') as preview, Image.open(self.reference) as reference:
            self.assertEqual(preview.size,reference.size)
        validate_viewport_archive(output/'delivery/viewport-ui-layers.zip')
        warning=read(self.run/'visual-warning-report.json')
        self.assertTrue(any(w.get('requestId')==bad for w in warning['material']))
        split=next(s for s in result['sheetPartitions'] if s['requestId']==bad)
        self.assertFalse(split['candidateExtractionPassed'])
        self.assertTrue(split['sourcePixelPartitionExact'])
        self.assertFalse(split['sourceBodyCompletenessObserved'])
        raw=self.run/'images/attempts'/bad/'raw.png'
        with zipfile.ZipFile(output/'diagnostic-sources.zip') as z:
            self.assertEqual(z.read('raw/'+bad+'.png'),raw.read_bytes())
            with Image.open(raw) as im:
                rebuilt=Image.new('RGBA',im.size)
                for i,box in enumerate(split['partitionBoxes']):
                    with Image.open(output/'source-evidence/cells'/(bad+'-cell-'+str(i)+'.png')) as cell:
                        rebuilt.paste(cell,box[:2])
                self.assertEqual(rebuilt.tobytes(),im.convert('RGBA').tobytes())
        self.assertTrue((output/'delivery/comparison/three-way-comparison.png').is_file())
        self.assertFalse((self.run/'scopes/material_review').exists())
        before=host._files(self.run)
        host.resume(self.run)
        self.assertEqual(before,host._files(self.run))
        with self.assertRaisesRegex(ValueError,'NO_NEXT'):host.next_request(self.run)
        report=output/'visual-warning-report.json'
        report.write_bytes(report.read_bytes()+b'changed fixture')
        with self.assertRaisesRegex(ValueError,'CHANGED'):host.status(self.run)

    def test_good_warning_sheets_continue_to_independent_material_review(self):
        self.prepare();self.acquire(False)
        self.assertEqual(read(self.run/'config.json')['sheetFailurePolicy'],fallback.LOCAL_POLICY)
        self.assertEqual(host.status(self.run)['stage'],'material_review')
        self.assertFalse((self.run/'diagnostic-output').exists())

    def test_local_failure_keeps_other_reviews_and_observed_placement(self):
        self.mixed_workflow()

    def test_unresolved_body_is_consumed_locally_without_inventing_geometry(self):
        self.mixed_workflow(bad_sheet=False,unresolved_body=True)

    def mixed_workflow(self,bad_sheet=True,unresolved_body=False):
        self.prepare(bodyReviewPolicy=fallback.EXHAUSTIVE);bad = self.acquire(bad_sheet)
        self.assertEqual(host.status(self.run)['stage'], 'material_review')
        scope = read(self.run/'scopes/material_review/scope.json')
        keys = {r['requestId'] for r in scope['requests']}
        all_keys = set(read(self.run/'images/job.json')['assets'])
        self.assertEqual(keys, all_keys-({bad} if bad else set()))
        self.assertFalse((self.run/'diagnostic-output').exists())
        host.authorize(self.run, host.status(self.run)['scopeDigest'], 'Offline partial reviews only')
        self.root = self.base
        while host.status(self.run)['stage'] == 'material_review':
            request = host.next_request(self.run);key = request['currentRequest']['requestId']
            evidence = HostEvidence.response(self,self.run/'reviews'/key)
            host.receive(self.run,request['submissionDigest'],evidence['response'],
                host_attestation=evidence['host_attestation'],dispatch_evidence=evidence['dispatch_evidence'],
                return_evidence=evidence['return_evidence'])
        body = read(self.run/'body/job.json')
        bad_ids = set(next(r['materialIds'] for r in read(self.run/'images/snapshot/requests.json')['requests'] if r['asset']==bad)) if bad else set()
        self.assertFalse(set(body['requests']) & bad_ids)
        if bad:self.assertEqual(set(body['diagnosticMaterialIds']),set(body['requests']))
        uncertain = next(iter(body['requests'])) if unresolved_body else None
        host.authorize(self.run,host.status(self.run)['scopeDigest'],'Offline partial body fixtures only')
        while host.status(self.run)['stage'] == 'body_observation':
            request = host.next_request(self.run);key = request['materialId']
            mapping = read(Path(request['inputDirectory'])/'mapping.json')
            with Image.open(body['materials'][key]) as image:box = image.getchannel('A').getbbox()
            scale = mapping['source']['observationSize'][0]/mapping['source']['originalSize'][0]
            # Deliberately observe an inset target; final geometry must retain
            # this genuine correspondence instead of the full ownership proxy.
            w,h = mapping['referenceCropSize'];target = [2,2,w-2,h-2]
            answer = dict(sourceBodyBox=[round(v*scale) for v in box],referenceCropBodyBox=target,
                boundaryStatus='complete',issues=[],geometryDifferences=[],materialIssues=[],evidence='Offline inset body fixture.')
            from ai_ui_layers import body_coverage
            answer[body_coverage.FIELD] = [dict(side=s,classification='none',evidence='No exterior fixture artwork.') for s in body_coverage.SIDES]
            if key == uncertain:
                answer.update(sourceBodyBox=None,referenceCropBodyBox=None,boundaryStatus='uncertain',
                    issues=['Complete body correspondence cannot be established in this fixture.'])
            response = self.base/(key+'-body-response.json');save(response,answer)
            dispatch = self.base/(key+'-body-dispatch');dispatch.write_bytes(b'fixture body dispatch')
            returned = self.base/(key+'-body-return');returned.write_bytes(b'fixture body return')
            attestation = self.base/(key+'-body-attestation.json')
            save(attestation,dict(kind='ui_host_body_attestation_v1',requestSha256=request['requestSha256'],
                submissionDigest=request['submissionDigest'],responseSha256=digest(response),inputsSha256=request['inputsSha256'],
                model=request['model'],effort=request['effort'],independentCall=True,reviewerId='fixture-body-reviewer',
                materialAuthors=request['materialAuthors'],hostAssertedModelResponse=True,notProviderReceipt=True,
                notCryptographicallyPlatformVerified=True,dispatchEvidenceSha256=digest(dispatch),returnEvidenceSha256=digest(returned)))
            host.receive(self.run,request['submissionDigest'],response,host_attestation=attestation,
                dispatch_evidence=dispatch,return_evidence=returned)
        status = host.status(self.run)
        self.assertEqual(status['status'],'diagnostic_complete_pending_visual_acceptance')
        self.assertFalse(status['FullAutomationExecutionCompleted'])
        self.assertEqual(set(status['unresolvedMaterialIds']),bad_ids|({uncertain} if uncertain else set()))
        result = read(self.run/'diagnostic-output/result.json')
        observed = {g['materialId']:g for g in result['geometry'] if g['observedBody']}
        self.assertEqual(set(observed),set(body['requests'])-({uncertain} if uncertain else set()))
        for mid,g in observed.items():
            checked = read(self.run/'body/attempts'/mid/'registration-check.json')
            self.assertEqual(g['uniformScale'],checked['geometry']['uniformScale'])
            self.assertEqual(g['translation'],checked['geometry']['translation'])
        self.assertTrue(all(not g['observedBody'] for g in result['geometry'] if g['materialId'] in bad_ids))
        self.assertEqual(set(result['materialReviewReplay']['reviewedRequestIds']),keys)
        validate_viewport_archive(self.run/'diagnostic-output/delivery/viewport-ui-layers.zip')
        if uncertain:
            seal = read(self.run/'body/attempts'/uncertain/'seal.json')
            self.assertEqual(seal['status'],'blocked_no_retry')
            self.assertEqual(seal['reason'],'BODY_OBSERVATION_UNRESOLVED')
            self.assertFalse((self.run/'body/attempts'/uncertain/'body-contract.json').exists())
            self.assertEqual(result['bodyReplay']['unresolvedObservations'][0]['materialId'],uncertain)
            self.assertEqual(read(self.run/'visual-warning-report.json')['continuedBodyObservationCalls'],len(body['requests']))
            self.assertTrue(any(w.get('code')=='BODY_OBSERVATION_UNRESOLVED'
                for w in read(self.run/'diagnostic-output/visual-warning-report.json')['warnings']))
            import json
            with zipfile.ZipFile(self.run/'diagnostic-output/diagnostic-sources.zip') as archive:
                evidence = json.loads(archive.read('diagnostic-evidence.json'))
                self.assertEqual(evidence['reviewReplay']['body']['unresolvedObservations'][0]['materialId'],uncertain)
            with zipfile.ZipFile(self.run/'diagnostic-output/delivery/ui-layers.zip') as archive:
                self.assertTrue(any('BODY_OBSERVATION_UNRESOLVED' in issue
                    for issue in json.loads(archive.read('review.json'))['issues']))
        with self.assertRaisesRegex(ValueError,'(SUBSET|UNRESOLVED_BODY)_CANNOT_FINISH'):
            host.host_body_observation.finish(self.run/'body',self.base/'forbidden-formal.json')
        before = host._files(self.run);host.resume(self.run);self.assertEqual(before,host._files(self.run))

    def test_strict_and_explicit_stop_keep_the_original_gate(self):
        self.prepare(False)
        self.assertEqual(read(self.run/'config.json')['sheetFailurePolicy'],fallback.STOP)
        with self.assertRaisesRegex(ValueError,'SHEET_CONTOUR_TOUCHES_CELL_BOUNDARY'):self.acquire()
        self.assertEqual(host.status(self.run)['status'],'failed_no_retry')
        self.assertFalse((self.run/'diagnostic-output').exists())
        self.assertFalse(fallback.enabled(dict(visualReviewMode='warning')))
        self.assertFalse(fallback.enabled(dict(visualReviewMode='warning',sheetFailurePolicy=fallback.STOP)))

    def test_unknown_or_unbound_fallback_is_rejected_before_creating_run(self):
        for index,change in enumerate((dict(sheetFailurePolicy='unknown'),dict(sheetFailurePolicy=fallback.POLICY),
                dict(bodyUnresolvedPolicy='unknown'),dict(bodyUnresolvedPolicy='record-unresolved-body-for-diagnostic-v1'))):
            config={**read(self.config_path),**change}
            path=self.base/('bad-config-'+str(index)+'.json');save(path,config)
            output=self.base/('bad-run-'+str(index))
            with self.assertRaisesRegex(ValueError,'POLICY|REQUIRES_WARNING_MODE'):
                host.prepare(path,output)
            self.assertFalse(output.exists())


class PublicReplayEvidenceTests(unittest.TestCase):
    def test_zip_evidence_omits_private_attempt_fields_and_keeps_warning_identity(self):
        import copy
        from ai_ui_layers.diagnostic_material_replay import public_value
        original = dict(bodyJobDigest='private-fixture-id',unresolvedObservations=[dict(
            materialId='icon-a',responseSha256='a'*64,submissionDigest='private-fixture-submission',
            originalSealStatus='blocked_no_retry',evidence='https://fixture.invalid/private')])
        before = copy.deepcopy(original)
        public = public_value(original)
        self.assertEqual(original,before)
        self.assertNotIn('bodyJobDigest',public)
        observation = public['unresolvedObservations'][0]
        self.assertEqual(observation['materialId'],'icon-a')
        self.assertEqual(observation['responseSha256'],'a'*64)
        self.assertNotIn('submissionDigest',observation)
        self.assertNotIn('originalSealStatus',observation)
        self.assertNotIn('https://',observation['evidence'])


if __name__=='__main__':unittest.main()
