"""Integrated offline fixtures: authentic local bytes, no tools or model calls."""
import _bootstrap
import hashlib
from pathlib import Path
import unittest
from PIL import Image, ImageDraw
from ai_ui_layers import host_delivery as host
from ai_ui_layers.evaluate import save, read, digest
from ai_ui_layers.freeze_visual import body_digest
import test_host_review as review_fixtures
from test_host_material_review import HostEvidence


class HostDeliveryTests(unittest.TestCase):
    def setUp(self):
        review_fixtures.HostReviewTests.setUp(self)
        viewer=self.base/'viewer';viewer.mkdir()
        (viewer/'viewer.html').write_text('<html></html>');(viewer/'viewer.js').write_text('void 0;')
        instruction='Preserve complete material support in storage and show the original viewport.'
        config=dict(seed=str(self.candidate),original=str(self.reference),contract=str(self.contract),viewer=str(viewer),
            candidateAuthors=['fixture-author'],materialAuthors=['fixture-generator'],
            planningReviewer='fixture-reviewer',materialReviewer='fixture-independent-reviewer',bodyReviewer='fixture-body-reviewer',
            planningModel='fixture-model',materialModel='fixture-model',bodyModel='fixture-model',
            planningDestination='offline-fixture',materialDestination='offline-fixture',bodyDestination='offline-fixture',
            planningEffort='medium',materialEffort='medium',bodyEffort='medium',imageDestination='offline-native-image-fixture',
            maximumImageCalls=16,maximumMaterialReviews=16,maximumBodyCalls=16,canvasPolicy=host.POLICY,
            canvasPolicyInstruction=instruction,canvasPolicyInstructionSha256=hashlib.sha256(instruction.encode()).hexdigest(),
            backgroundPolicy='uniform-whole-canvas-opaque-contain-edgepad-v1')
        self.config_path=self.base/'config.json';save(self.config_path,config)
        self.run=self.base/'integrated';host.prepare(self.config_path,self.run)
        self.root=self.run/'planning'

    def planning(self):
        current=host.status(self.run);host.authorize(self.run,current['scopeDigest'],'Offline fixture review only')
        request=host.next_request(self.run)
        save(self.response,review_fixtures.HostReviewTests.response_doc(self))
        self.prepared={'requestSha256':request['requestSha256']}
        review_fixtures.HostReviewTests.write_attestation(self)
        host.receive(self.run,request['submissionDigest'],self.response,host_attestation=self.attestation,
                     dispatch_evidence=self.dispatch,return_evidence=self.response)

    def test_authorization_reservation_terminal_and_tamper(self):
        with self.assertRaisesRegex(ValueError,'AUTHORIZATION_REQUIRED'):host.next_request(self.run)
        with self.assertRaisesRegex(ValueError,'BOUND_APPROVAL'):host.authorize(self.run,'0'*64,'fixture')
        digest_scope=host.status(self.run)['scopeDigest'];host.authorize(self.run,digest_scope,'fixture')
        request=host.next_request(self.run)
        with self.assertRaisesRegex(ValueError,'NO_RESUBMIT'):host.next_request(self.run)
        before=host._files(self.run);self.assertEqual(host.resume(self.run)['status'],'awaiting_result')
        self.assertEqual(host._files(self.run),before)
        host.fail(self.run,request['submissionDigest'],'Unknown host acceptance')
        self.assertEqual(host.status(self.run)['status'],'failed_no_retry')
        self.assertFalse(host.status(self.run)['FullAutomationExecutionCompleted'])
        with self.assertRaisesRegex(ValueError,'NO_NEXT'):host.next_request(self.run)
        path=self.run/'planning/m2/prompt.md';path.write_bytes(path.read_bytes()+b'changed')
        with self.assertRaisesRegex(ValueError,'CHANGED'):host.status(self.run)

    def test_new_default_uses_ownership_actions_and_explicit_v7_is_frozen(self):
        self.assertEqual(read(self.run/'config.json')['contextPromptVersion'],'v8')
        self.assertEqual(read(self.run/'config.json')['sheetSeamPolicy'],'nearest-unique-transparent-seam-v2')
        self.assertEqual(read(self.run/'planning/.dag/config.json')['contextPromptVersion'],'v8')
        self.planning()
        self.assertEqual(read(self.run/'frozen/snapshot.json')['contextPromptVersion'],'v8')
        self.assertTrue((self.run/'frozen/materials/asset-panel/prompt.txt').read_text('utf-8').startswith('OWNERSHIP FIRST.'))
        legacy=read(self.config_path);legacy['contextPromptVersion']='v7'
        legacy_path=self.base/'legacy-config.json';save(legacy_path,legacy)
        other=self.base/'explicit-legacy';host.prepare(legacy_path,other)
        self.assertEqual(read(other/'config.json')['contextPromptVersion'],'v7')
        self.assertEqual(read(other/'planning/.dag/config.json')['contextPromptVersion'],'v7')
        invalid={**legacy,'contextPromptVersion':'v99'}
        invalid_path=self.base/'invalid-config.json';save(invalid_path,invalid)
        with self.assertRaisesRegex(ValueError,'HOST_CONTEXT_PROMPT_VERSION'):
            host.prepare(invalid_path,self.base/'invalid-version')
        self.assertFalse((self.base/'invalid-version').exists())

    def test_explicit_legacy_seam_and_unknown_policy_before_output(self):
        legacy=read(self.config_path);legacy['sheetSeamPolicy']='strict-unique-empty-band-v1'
        path=self.base/'legacy-seam-config.json';save(path,legacy)
        run=self.base/'legacy-seam';host.prepare(path,run)
        self.assertEqual(read(run/'config.json')['sheetSeamPolicy'],legacy['sheetSeamPolicy'])
        legacy['sheetSeamPolicy']='unknown';path=self.base/'unknown-seam-config.json';save(path,legacy)
        with self.assertRaisesRegex(ValueError,'SHEET_SEAM_POLICY'):host.prepare(path,self.base/'unknown-seam')
        self.assertFalse((self.base/'unknown-seam').exists())

    def test_unsafe_submission_cannot_write_and_interrupted_receive_is_terminal(self):
        with self.assertRaisesRegex(ValueError,'DIGEST_REQUIRED'):
            host.receive(self.run,'../../escape',self.response)
        self.assertFalse((self.base/'escape').exists())
        host.authorize(self.run,host.status(self.run)['scopeDigest'],'fixture')
        request=host.next_request(self.run)
        save(self.run/'transaction.json',dict(operation='receive',submissionDigest=request['submissionDigest']))
        (self.run/'partial-original-answer').write_bytes(b'preserved original fixture')
        self.assertEqual(host.resume(self.run)['status'],'failed_no_retry')
        self.assertTrue((self.run/'partial-original-answer').exists())

    def test_invalid_duration_and_original_bad_review_are_preserved(self):
        config=read(self.config_path);config['maximumModelCallSeconds']=0
        invalid=self.base/'invalid-duration.json';save(invalid,config)
        with self.assertRaisesRegex(ValueError,'DURATION_REQUIRED'):host.prepare(invalid,self.base/'invalid-run')
        self.assertFalse((self.base/'invalid-run').exists())
        host.authorize(self.run,host.status(self.run)['scopeDigest'],'fixture')
        request=host.next_request(self.run)
        self.response.write_bytes(b'{"invalid":"genuine failed fixture answer"}')
        self.prepared={'requestSha256':request['requestSha256']}
        review_fixtures.HostReviewTests.write_attestation(self)
        with self.assertRaises(Exception):host.receive(self.run,request['submissionDigest'],self.response,
            host_attestation=self.attestation,dispatch_evidence=self.dispatch,return_evidence=self.response)
        self.assertEqual((self.run/'planning/m2/draft.json').read_bytes(),self.response.read_bytes())
        self.assertEqual(host.status(self.run)['status'],'failed_no_retry')
        with self.assertRaisesRegex(ValueError,'NO_NEXT'):host.next_request(self.run)

    def test_complete_sheet_workflow_separate_scopes_and_delivered_comparison(self):
        self.planning();self.assertEqual(host.status(self.run)['stage'],'images')
        self.assertEqual(read(self.run/'frozen/snapshot.json')['generationReference'],'context-crops')
        image_scope=host.status(self.run)['scopeDigest']
        host.authorize(self.run,image_scope,'Offline image fixtures only')
        sizes={a['id']:a['output_size'] for a in read(self.run/'frozen/execution-plan.candidate.json')['assets']}
        while host.status(self.run)['stage']=='images':
            request=host.next_request(self.run);raw=self.base/'raw.png'
            if 'materialIds' in request:
                columns,rows=request['grid'];image=Image.new('RGBA',(columns*160,rows*160))
                draw=ImageDraw.Draw(image)
                for i,key in enumerate(request['materialIds']):
                    x=(i%columns)*160;y=(i//columns)*160
                    draw.rectangle((x+30,y+30,x+129,y+129),fill=(60,90,100,255))
            elif request['asset']=='asset-scene':image=Image.new('RGB',(240,240),(40,50,60))
            else:
                w,h=sizes[request['asset']];image=Image.new('RGBA',(w+40,h+40))
                ImageDraw.Draw(image).rectangle((20,20,w+19,h+19),fill=(80,90,100,255))
            image.save(raw);host.receive(self.run,request['submissionDigest'],raw)
        material_scope=host.status(self.run)['scopeDigest'];self.assertNotEqual(material_scope,image_scope)
        self.assertGreater(host.status(self.run)['maximumCalls'],1)
        with self.assertRaisesRegex(ValueError,'AUTHORIZATION_REQUIRED'):host.next_request(self.run)
        host.authorize(self.run,material_scope,'Offline independent material fixtures only')
        self.root=self.base
        while host.status(self.run)['stage']=='material_review':
            request=host.next_request(self.run);key=request['currentRequest']['requestId']
            evidence=HostEvidence.response(self,self.run/'reviews'/key)
            host.receive(self.run,request['submissionDigest'],evidence['response'],host_attestation=evidence['host_attestation'],
                dispatch_evidence=evidence['dispatch_evidence'],return_evidence=evidence['return_evidence'])
        self.assertEqual(host.status(self.run)['stage'],'body_observation')
        host.authorize(self.run,host.status(self.run)['scopeDigest'],'Offline body fixture only')
        while host.status(self.run)['stage']=='body_observation':
            request=host.next_request(self.run);key=request['materialId'];inputs=Path(request['inputDirectory'])
            mapping=read(inputs/'mapping.json');source=read(self.run/'body/job.json')['materials'][key]
            with Image.open(source) as image:box=image.getchannel('A').getbbox()
            # Fixtures use square sheet icons and proportional single-material rectangles.
            sx=mapping['source']['observationSize'][0]/mapping['source']['originalSize'][0]
            source_box=[round(v*sx) for v in box]
            response=self.base/(key+'-body.json')
            save(response,dict(sourceBodyBox=source_box,referenceCropBodyBox=[0,0,*mapping['referenceCropSize']],
                boundaryStatus='complete',issues=[],evidence='Offline matching whole rectangular fixture.'))
            dispatch=self.base/(key+'-dispatch');dispatch.write_bytes(b'fixture dispatch body')
            returned=self.base/(key+'-return');returned.write_bytes(b'fixture return body')
            attestation=self.base/(key+'-attestation.json')
            save(attestation,dict(kind='ui_host_body_attestation_v1',requestSha256=request['requestSha256'],
                submissionDigest=request['submissionDigest'],responseSha256=digest(response),inputsSha256=request['inputsSha256'],
                model=request['model'],effort=request['effort'],independentCall=True,reviewerId='fixture-body-reviewer',
                materialAuthors=request['materialAuthors'],hostAssertedModelResponse=True,notProviderReceipt=True,
                notCryptographicallyPlatformVerified=True,dispatchEvidenceSha256=digest(dispatch),returnEvidenceSha256=digest(returned)))
            host.receive(self.run,request['submissionDigest'],response,host_attestation=attestation,dispatch_evidence=dispatch,return_evidence=returned)
        result=host.status(self.run);self.assertTrue(result['FullAutomationExecutionCompleted']);self.assertTrue(result['visualAcceptancePending'])
        self.assertEqual(result['FullReferenceToDeliveryExecutionCompleted'],result['m1ModelExecuted'])
        self.assertFalse(result['humanVisualAcceptance']);self.assertTrue((self.run/'delivery/comparison/three-way-comparison.png').is_file())
        before=host._files(self.run);host.resume(self.run);self.assertEqual(before,host._files(self.run))
        host.status(self.run);self.assertEqual(before,host._files(self.run))
        comparison=self.run/'delivery/comparison/three-way-comparison.png'
        comparison.write_bytes(comparison.read_bytes()+b'changed output')
        with self.assertRaisesRegex(ValueError,'CHANGED'):host.status(self.run)


if __name__=='__main__':unittest.main()
