"""Fixtures only: no model, generation tool or external service calls."""
import _bootstrap
import unittest
import io
import json
from contextlib import redirect_stdout
from pathlib import Path
from unittest.mock import patch
from PIL import Image, ImageDraw

from ai_ui_layers import host_material_review as host
from ai_ui_layers.evaluate import read, save, digest
from ai_ui_layers import experimental_executor as exchange
from ai_ui_layers.freeze_visual import freeze
from test_single_material_review import SingleMaterialReviewTests
from test_sheet_delivery import SheetDeliveryTests
from test_compile_visual import VisualCompileTests


class HostEvidence:
    def prepare(self,key,folder=None):
        folder=folder or self.root/('host-'+key)
        host.prepare(self.job,key,folder,material_authors=['fixture-generator'],review_registry=self.root/'registry')
        return folder

    def response(self,folder,answer=None,raw=None,reviewer='fixture-independent-reviewer'):
        request=read(folder/'request.json');base=self.root/(folder.name+'-evidence');base.mkdir()
        response=base/'response.json'
        if raw is None:
            answer=answer or dict(materialIds=request['materialIds'],findings=[])
            if request['kind']=='ui_host_output_review_request_v2':
                inventory=read(folder/'review/ownership-inventory.json')
                answer=dict(answer)
                answer.setdefault('ownershipObservations',[dict(materialId=e['materialId'],
                    owned=[dict(objectId=o['objectId'],state='complete',evidence='Fixture owned artwork complete.') for o in e['owned']],
                    foreign=[dict(materialId=o['materialId'],objectId=o['objectId'],state='absent',evidence='Fixture foreign artwork absent.') for o in e['foreign']])
                    for e in inventory['entries']])
            save(response,answer)
        else:response.write_bytes(raw)
        dispatch=base/'dispatch';dispatch.write_bytes(b'fixture independent host dispatch observation')
        returned=base/'returned';returned.write_bytes(b'fixture actual return observation')
        attestation=base/'attestation.json'
        save(attestation,dict(kind='ui_host_output_review_attestation_v1',requestSha256=digest(folder/'request.json'),
            responseSha256=digest(response),rawSha256=request['rawSha256'],submissionDigest=request['submissionDigest'],
            materialAuthors=request['materialAuthors'],reviewerId=reviewer,hostAssertedModelResponse=True,
            notProviderReceipt=True,notCryptographicallyPlatformVerified=True,
            dispatchEvidenceSha256=digest(dispatch),returnEvidenceSha256=digest(returned)))
        return dict(output=folder,response=response,request_sha256=digest(folder/'request.json'),
            response_sha256=digest(response),host_attestation=attestation,dispatch_evidence=dispatch,return_evidence=returned)


class HostSingleTests(HostEvidence,unittest.TestCase):
    def setUp(self):SingleMaterialReviewTests.setUp(self)

    def test_single_pass_no_transport_and_single_use_registry(self):
        before=host.files(self.job);folder=self.prepare('asset-coin-a')
        with self.assertRaises(FileExistsError):self.prepare('asset-coin-a',self.root/'another-review')
        result=host.receive(**self.response(folder))
        self.assertEqual(result['status'],'reviewed_pending_visual_acceptance')
        self.assertEqual(result['modelCalls'],1);self.assertFalse(result['humanVisualAcceptance'])
        host.verify_run(folder)
        self.assertEqual(before,host.files(self.job))
        self.assertFalse(list(folder.rglob('transport.json')))
        self.assertFalse(list(folder.rglob('events.jsonl')))

    def test_public_cli_prepares_and_receives_without_model(self):
        from ai_ui_layers.delivery_dag import main
        folder=self.root/'public-review';stdout=io.StringIO()
        arguments=['ui_layer.py','prepare-output-review','--received-job',str(self.job),
                   '--request-id','asset-coin-a','--output',str(folder),'--material-author','fixture-generator',
                   '--review-registry',str(self.root/'registry')]
        with patch('sys.argv',arguments),redirect_stdout(stdout):main()
        self.assertEqual(json.loads(stdout.getvalue())['modelCalls'],0)
        external=self.response(folder);stdout=io.StringIO()
        arguments=['ui_layer.py','receive-output-review','--output',str(folder),'--response',str(external['response']),
            '--request-sha256',external['request_sha256'],'--response-sha256',external['response_sha256'],
            '--host-attestation',str(external['host_attestation']),'--dispatch-evidence',str(external['dispatch_evidence']),
            '--return-evidence',str(external['return_evidence'])]
        with patch('sys.argv',arguments),redirect_stdout(stdout):main()
        self.assertEqual(json.loads(stdout.getvalue())['status'],'reviewed_pending_visual_acceptance')
        with patch('sys.argv',['ui_layer.py','prepare-output-review','--output',str(self.root/'unsupported'),
                               '--context-prompt-version','v7']),self.assertRaises(SystemExit):main()

    def test_received_single_in_partial_batch_reviews_before_next_request(self):
        from ai_ui_layers.single_material_review import review as legacy_review,prepare_review
        job=self.root/'partial-job'
        snapshot=self.job/'snapshot'
        config=exchange.prepare(snapshot,self.snapshot_digest,job,['asset-coin-a','asset-coin-b'])
        exchange.authorize(job,config['digest'],'offline serial fixture only')
        first=exchange.next_request(job)
        raw=self.root/'serial-raw.png';image=Image.new('RGBA',(400,200))
        ImageDraw.Draw(image).rectangle((20,30,379,169),fill=(50,70,90,220));image.save(raw)
        exchange.receive(job,first['submissionDigest'],raw)
        self.assertEqual(exchange.status(job)['status'],'ready')
        with self.assertRaisesRegex(ValueError,'ONE_RECEIVED_MATERIAL_REQUIRED'):
            legacy_review(job,self.root/'legacy-partial',request_id='asset-coin-a')
        with self.assertRaisesRegex(ValueError,'ONE_RECEIVED_MATERIAL_REQUIRED'):
            prepare_review(job,self.root/'no-explicit-id',received_request_only=True)
        folder=self.root/'partial-review'
        with self.assertRaisesRegex(ValueError,'RECEIVED_REQUEST_REQUIRED'):
            host.prepare(job,'asset-coin-b',self.root/'not-received',material_authors=['fixture-generator'],review_registry=self.root/'registry')
        self.job=job;host.prepare(job,'asset-coin-a',folder,material_authors=['fixture-generator'],review_registry=self.root/'registry')
        host.receive(**self.response(folder));host.verify_run(folder)
        review_files=host.files(folder)
        second=exchange.next_request(job)
        self.assertEqual(second['asset'],'asset-coin-b')
        self.assertEqual(exchange.status(job)['status'],'awaiting_result')
        host.verify_run(folder)
        exchange.receive(job,second['submissionDigest'],raw)
        self.assertEqual(exchange.status(job)['status'],'raw_complete')
        host.verify_run(folder)
        self.assertEqual(review_files,host.files(folder))
        later=self.prepare('asset-coin-b');host.receive(**self.response(later))
        host.verify_run(later);host.verify_run(folder)
        # The legacy complete-batch gate still admits the original review path.
        prepared=prepare_review(job,self.root/'legacy-complete',request_id='asset-coin-a')
        self.assertEqual(prepared['status'],'awaiting_host_review')

    def test_duplicate_json_and_schema_failure_sealed_no_retry(self):
        for i,raw in enumerate((b'{"materialIds":[],"materialIds":[],"findings":[]}',b'{"materialIds":["asset-coin-a"]}')):
            registry=self.root/('registry-'+str(i));folder=self.root/('bad-'+str(i))
            host.prepare(self.job,'asset-coin-a',folder,material_authors=['fixture-generator'],review_registry=registry)
            arguments=self.response(folder,raw=raw)
            with self.assertRaises(Exception):host.receive(**arguments)
            self.assertEqual((folder/'review/draft.json').read_bytes(),raw)
            self.assertEqual(read(folder/'result.json')['status'],'indeterminate_review_no_retry')
            with self.assertRaisesRegex(ValueError,'ALREADY_TERMINAL'):host.receive(**arguments)
            with self.assertRaises(FileExistsError):
                host.prepare(self.job,'asset-coin-a',self.root/('retry-'+str(i)),material_authors=['fixture-generator'],review_registry=registry)

    def test_material_author_cannot_review(self):
        folder=self.prepare('asset-coin-a')
        with self.assertRaisesRegex(ValueError,'INDEPENDENT_OUTPUT_REVIEWER'):
            host.receive(**self.response(folder,reviewer='fixture-generator'))
        self.assertEqual(read(folder/'result.json')['modelCalls'],1)

    def test_visual_uncertainty_remains_blocking(self):
        folder=self.prepare('asset-coin-a')
        finding=dict(materialId='asset-coin-a',category='uncertain',referenceState='not-applicable',
            generatedState='not-applicable',magnitude='uncertain',ownership='ambiguous',
            evidence='Owned corner cannot be resolved.',suggestion='New explicit user decision required.')
        result=host.receive(**self.response(folder,dict(materialIds=['asset-coin-a'],findings=[finding])))
        self.assertEqual(result['status'],'blocked_no_retry')
        with self.assertRaisesRegex(ValueError,'NOT_PASSED'):host.verify_run(folder)

    def test_runtime_raw_input_and_evidence_changes_fail(self):
        folder=self.prepare('asset-coin-a')
        with patch.object(host,'runtime_files',return_value={}):
            with self.assertRaisesRegex(ValueError,'RUNTIME_CHANGED'):host.verify_prepared(folder)
        path=folder/'review/reference.png';old=path.read_bytes();path.write_bytes(old+b'changed')
        with self.assertRaisesRegex(ValueError,'EVIDENCE_CHANGED'):host.verify_prepared(folder)
        path.write_bytes(old);host.receive(**self.response(folder))
        evidence=folder/'review/host-return-evidence.bin';evidence.write_bytes(b'changed provenance')
        with self.assertRaisesRegex(ValueError,'EVIDENCE_CHANGED'):host.verify_run(folder)
        evidence.write_bytes(b'fixture actual return observation')
        raw=self.job/'attempts/asset-coin-a/raw.png';raw.write_bytes(raw.read_bytes()+b'changed raw')
        with self.assertRaisesRegex(ValueError,'EVIDENCE_CHANGED'):host.verify_run(folder)

    def test_missing_complete_request_set_cannot_extract(self):
        folder=self.prepare('asset-coin-a');host.receive(**self.response(folder))
        with self.assertRaisesRegex(ValueError,'COMPLETE_OUTPUT_REVIEW_SET'):
            host.extract(self.job/'snapshot',self.snapshot_digest,[folder],self.root/'incomplete')
        self.assertFalse((self.root/'incomplete').exists())


class HostSheetTests(HostEvidence,unittest.TestCase):
    def setUp(self):
        self.review=SheetDeliveryTests.review.__get__(self)
        SheetDeliveryTests.setUp(self)
        SheetDeliveryTests.media(self)

    def test_sheet_order_alpha_detail_and_complete_extract(self):
        before=host.files(self.job);folders=[]
        for key in read(self.job/'job.json')['assets']:
            folder=self.prepare(key);request=read(folder/'request.json')
            if key in self.sheets:
                detail=read(folder/'review/detail-compare.json')
                self.assertEqual([row['materialId'] for row in detail['rows']],request['materialIds'])
                prompt=(folder/'review/prompt.md').read_text(encoding='utf-8')
                self.assertIn('excludedForeignArtwork',prompt);self.assertIn('Unused cells must be empty',prompt)
            host.receive(**self.response(folder));folders.append(folder)
        snapshot=self.job/'snapshot';frozen=read(snapshot/'snapshot.json')
        result=host.extract(snapshot,frozen['digest'],folders,self.root/'extraction')
        self.assertEqual(len(result['materials']),5);host.verify_extraction(self.root/'extraction')
        self.assertEqual(before,host.files(self.job))
        with self.assertRaisesRegex(ValueError,'COMPLETE_OUTPUT_REVIEW_SET'):
            host.extract(snapshot,frozen['digest'],folders+folders[:1],self.root/'duplicates')

    def test_wrong_sheet_order_is_terminal(self):
        key=self.sheets[0];folder=self.prepare(key);ids=read(folder/'request.json')['materialIds']
        with self.assertRaisesRegex(ValueError,'IDENTITY_MISMATCH'):
            host.receive(**self.response(folder,dict(materialIds=list(reversed(ids)),findings=[])))
        self.assertEqual(read(folder/'result.json')['status'],'indeterminate_review_no_retry')

    def test_candidate_exports_all_receipts_without_reviews_or_body_observations(self):
        import zipfile
        before=host.files(self.job);snapshot=self.job/'snapshot'
        frozen=host.prepare_candidate(snapshot,read(snapshot/'snapshot.json')['digest'],self.root/'candidate')
        jobs={key:self.job for key in read(self.job/'job.json')['assets']}
        result=host.deliver_candidate(self.root/'candidate',frozen['candidateDigest'],jobs,
                                      self.root/'candidate-output',self.root/'viewer')
        self.assertEqual(result['status'],'pending-human-review')
        self.assertEqual(result['modelCalls'],0);self.assertEqual(self.calls,0)
        self.assertFalse(result['humanVisualAcceptance']);self.assertFalse(result['originalDagPromoted'])
        self.assertEqual(result['layerCount'],5);self.assertEqual(before,host.files(self.job))
        with zipfile.ZipFile(self.root/'candidate-output/delivery/ui-layers.zip') as archive:
            review=json.loads(archive.read('review.json'))
            self.assertEqual(review['status'],'review-required')
            self.assertFalse(review['humanVisualAcceptance'])
            self.assertTrue(any('intermediate visual review deferred' in issue for issue in review['issues']))
        for row in result['geometry']:
            self.assertFalse(row['observedBody']);self.assertFalse(row['alphaSupportClipped'])
            if row['materialId']!='asset-scene':
                self.assertEqual(row['outputTransparentSamplingGuard'],2)
                with Image.open(self.root/'candidate-output/materials'/(row['materialId']+'.png')) as image:
                    bounds=image.getchannel('A').getbbox()
                    self.assertTrue(0<bounds[0]<bounds[2]<image.width)
                    self.assertTrue(0<bounds[1]<bounds[3]<image.height)

    def test_candidate_plan_freezes_overlap_findings_without_claiming_m2_and_delivers(self):
        import os
        from ai_ui_layers.compile_visual import HARNESS,compile_plan
        from ai_ui_layers.freeze_visual import inspect
        snapshot=self.job/'snapshot'
        visual=read(snapshot/'evidence/m1-draft.json')
        foreground=[m for m in visual['materials'] if m['role']=='foreground']
        foreground[1]['zOrder']=foreground[0]['zOrder']
        foreground[1]['bboxNorm']=list(foreground[0]['bboxNorm'])
        with self.assertRaisesRegex(ValueError,'UNRESOLVED_PLAN_RELATIONS'):
            compile_plan(visual,[1000,1000],digest(snapshot/'reference.png'))
        seed=self.root/'candidate-plan.json';save(seed,visual)
        new_snapshot=self.root/'candidate-snapshot'
        manifest=host.freeze_candidate_plan(seed,snapshot/'reference.png',digest(snapshot/'reference.png'),
            Path(os.environ.get('UI_LAYER_TEST_CONTRACT_DIR',str(HARNESS/'planning-harness'))),new_snapshot,8)
        self.assertFalse(manifest['newM2ReviewPerformed']);self.assertTrue(manifest['planningReviewDeferred'])
        self.assertTrue(manifest['planningVisualFindings'])
        self.assertFalse((new_snapshot/'evidence/m2-draft.json').exists())
        inspect(new_snapshot,manifest['digest'])
        self.job=self.root/'new-candidate-job';exchange.prepare(new_snapshot,manifest['digest'],self.job)
        SheetDeliveryTests.media(self)
        frozen=host.prepare_candidate(new_snapshot,manifest['digest'],self.root/'candidate')
        jobs={key:self.job for key in read(self.job/'job.json')['assets']}
        result=host.deliver_candidate(self.root/'candidate',frozen['candidateDigest'],jobs,
                                      self.root/'candidate-output',self.root/'viewer')
        self.assertEqual(result['status'],'pending-human-review');self.assertEqual(result['modelCalls'],0)
        review=read(self.root/'candidate-output/delivery/package/review.json')
        self.assertTrue(any('SAME_LAYER_OVERLAP_REVIEW' in issue for issue in review['issues']))

    def test_measured_candidate_contract_and_zip_recomposition(self):
        import io
        import zipfile
        from ai_ui_layers.layer_package import composite
        snapshot=self.job/'snapshot';jobs={key:self.job for key in read(self.job/'job.json')['assets']}
        before=host.files(self.job)
        frozen=host.prepare_candidate(snapshot,read(snapshot/'snapshot.json')['digest'],self.root/'measured',
                                      registration_policy=host.CANDIDATE_MEASURED)
        contract=read(self.root/'measured/candidate.json')
        self.assertEqual(contract['registrationPolicy'],host.CANDIDATE_MEASURED)
        result=host.deliver_candidate(self.root/'measured',frozen['candidateDigest'],jobs,
                                      self.root/'measured-output',self.root/'viewer')
        self.assertEqual(result['registrationPolicy'],host.CANDIDATE_MEASURED)
        self.assertEqual(result['status'],'pending-human-review');self.assertEqual(before,host.files(self.job))
        for row in result['geometry']:
            if row['materialId']=='asset-scene':continue
            self.assertEqual(row['appliedAdaptationPolicy'],host.CANDIDATE_MEASURED)
            self.assertTrue(row['sourceUnthresholded']);self.assertFalse(row['alphaSupportClipped'])
            self.assertFalse(row['observedBody']);self.assertFalse(row['humanVisualAcceptance'])
            with Image.open(self.root/'measured-output/materials'/(row['materialId']+'.png')) as layer:
                bounds=layer.getchannel('A').getbbox()
                self.assertGreaterEqual(bounds[0],2);self.assertGreaterEqual(bounds[1],2)
                self.assertLessEqual(bounds[2],layer.width-2);self.assertLessEqual(bounds[3],layer.height-2)
        package=self.root/'measured-output/delivery/package'
        replay=composite(package,read(package/'composition.json'))
        with zipfile.ZipFile(self.root/'measured-output/delivery/ui-layers.zip') as archive:
            self.assertEqual(archive.read('composition.json'),(package/'composition.json').read_bytes())
            with Image.open(io.BytesIO(archive.read('preview.png'))) as preview:
                self.assertEqual(preview.convert('RGBA').tobytes(),replay.tobytes())
            for layer in read(package/'composition.json')['layers']:
                self.assertEqual(archive.read(layer['path']),(package/layer['path']).read_bytes())
        contract['registrationPolicy']=host.CANDIDATE_FIT;save(self.root/'changed-measured-policy.json',contract)
        (self.root/'measured/candidate.json').write_bytes((self.root/'changed-measured-policy.json').read_bytes())
        with self.assertRaisesRegex(ValueError,'RECORD_CHANGED'):
            host.deliver_candidate(self.root/'measured',frozen['candidateDigest'],jobs,
                                   self.root/'tampered-output',self.root/'viewer')
        default=host.prepare_candidate(snapshot,read(snapshot/'snapshot.json')['digest'],self.root/'default')
        self.assertEqual(read(self.root/'default/candidate.json')['registrationPolicy'],host.CANDIDATE_FIT)
        with self.assertRaisesRegex(ValueError,'CANDIDATE_REGISTRATION_POLICY'):
            host.prepare_candidate(snapshot,read(snapshot/'snapshot.json')['digest'],self.root/'invalid',
                                   registration_policy='invented-policy')

    def test_anchor_locked_candidate_contract_and_export_keep_proxy_transform(self):
        snapshot=self.job/'snapshot';jobs={key:self.job for key in read(self.job/'job.json')['assets']}
        frozen=host.prepare_candidate(snapshot,read(snapshot/'snapshot.json')['digest'],self.root/'anchored',
                                      registration_policy=host.CANDIDATE_ANCHORED)
        result=host.deliver_candidate(self.root/'anchored',frozen['candidateDigest'],jobs,
                                      self.root/'anchored-output',self.root/'viewer')
        self.assertEqual(result['registrationPolicy'],host.CANDIDATE_ANCHORED)
        for row in result['geometry']:
            if row['materialId']=='asset-scene':continue
            self.assertTrue(row['anchorLocked']);self.assertFalse(row['supportMayAlterPlacement'])
            self.assertEqual(row['translationDeviations'],[0,0])
            self.assertEqual(row['scaleReduction'],0)
        self.assertEqual(result['status'],'pending-human-review')

    def test_candidate_background_uniform_padding_and_nonzero_alpha_guard(self):
        snapshot=self.job/'snapshot';manifest=read(snapshot/'snapshot.json')
        row=next(r for r in read(snapshot/'requests.json')['requests'] if r.get('kind')!='sheet' and r['asset']!='asset-scene')
        replacements={}
        for key in ('asset-scene',row['asset']):
            job=self.root/('replace-'+key);config=exchange.prepare(snapshot,manifest['digest'],job,[key])
            exchange.authorize(job,config['digest'],'fixture independent new scope')
            submission=exchange.next_request(job);raw=self.root/(key+'-new.png')
            if key=='asset-scene':Image.new('RGB',(240,232),(40,50,60)).save(raw)
            else:
                image=Image.new('RGBA',(240,240));ImageDraw.Draw(image).rectangle((30,30,210,210),fill=(50,70,90,230))
                image.putpixel((1,1),(40,60,80,1));image.save(raw)
            exchange.receive(job,submission['submissionDigest'],raw);replacements[key]=job
        frozen=host.prepare_candidate(snapshot,manifest['digest'],self.root/'candidate')
        jobs={key:replacements.get(key,self.job) for key in read(self.job/'job.json')['assets']}
        result=host.deliver_candidate(self.root/'candidate',frozen['candidateDigest'],jobs,
                                      self.root/'candidate-output',self.root/'viewer')
        scene=next(g for g in result['geometry'] if g['materialId']=='asset-scene')
        self.assertTrue(scene['backgroundEdgePadding'])
        foreground=next(g for g in result['geometry'] if g['materialId']==row['asset'])
        self.assertEqual(foreground['sourceFullAlphaBox'][:2],[1,1])
        self.assertFalse(foreground['alphaSupportClipped'])

    def test_candidate_native_alpha_and_sheet_seams_remain_technical_gates(self):
        snapshot=self.job/'snapshot';manifest=read(snapshot/'snapshot.json')
        key=self.sheets[0];job=self.root/'bad-sheet';config=exchange.prepare(snapshot,manifest['digest'],job,[key])
        exchange.authorize(job,config['digest'],'fixture new bad technical source')
        submission=exchange.next_request(job);raw=self.root/'bad-native.png'
        with Image.open(self.job/'attempts'/key/'raw.png') as original:
            image=original.convert('RGBA')
        ImageDraw.Draw(image).line((1,image.height//2,image.width-2,image.height//2),fill=(50,70,90,255))
        image.save(raw)
        exchange.receive(job,submission['submissionDigest'],raw)
        frozen=host.prepare_candidate(snapshot,manifest['digest'],self.root/'candidate')
        jobs={k:job if k==key else self.job for k in read(self.job/'job.json')['assets']}
        with self.assertRaisesRegex(ValueError,'SHEET_CONTOUR_TOUCHES_CELL_BOUNDARY') as raised:
            host.deliver_candidate(self.root/'candidate',frozen['candidateDigest'],jobs,
                                  self.root/'candidate-output',self.root/'viewer')
        self.assertEqual(raised.exception.failed_request_ids,[key])

    def test_candidate_ambiguous_safe_sheet_split_survives_complete_zip_delivery(self):
        snapshot=self.job/'snapshot';manifest=read(snapshot/'snapshot.json');key=self.sheets[0]
        job=self.root/'new-ambiguous-sheet';config=exchange.prepare(snapshot,manifest['digest'],job,[key])
        exchange.authorize(job,config['digest'],'fixture new candidate source')
        submission=exchange.next_request(job);raw=self.root/'ambiguous-native.png'
        with Image.open(self.job/'attempts'/key/'raw.png') as original:image=original.convert('RGBA')
        image.putpixel((image.width//2-5,image.height//2),(11,21,31,1));image.save(raw)
        source_before=raw.read_bytes();exchange.receive(job,submission['submissionDigest'],raw)
        frozen=host.prepare_candidate(snapshot,manifest['digest'],self.root/'candidate')
        jobs={k:job if k==key else self.job for k in read(self.job/'job.json')['assets']}
        result=host.deliver_candidate(self.root/'candidate',frozen['candidateDigest'],jobs,
                                      self.root/'candidate-output',self.root/'viewer')
        split=next(row for row in result['sheetSplits'] if row['requestId']==key)
        self.assertEqual(split['candidateSheetSplitPolicy'],host.CANDIDATE_SPLIT)
        self.assertEqual(split['strictExtractionIssue'],'SHEET_AMBIGUOUS_EMPTY_BANDS')
        self.assertTrue(split['reconstructionPixelExact']);self.assertEqual(raw.read_bytes(),source_before)
        self.assertEqual(result['status'],'pending-human-review')
        review=read(self.root/'candidate-output/delivery/package/review.json')
        self.assertTrue(any(host.CANDIDATE_SPLIT in issue and 'SHEET_AMBIGUOUS_EMPTY_BANDS' in issue
                            for issue in review['issues']))

    def test_candidate_keeps_blocked_review_findings_and_strict_terminal(self):
        key=self.sheets[0];folder=self.prepare(key);ids=read(folder/'request.json')['materialIds']
        finding=dict(materialId=ids[0],category='uncertain',referenceState='not-applicable',
            generatedState='not-applicable',magnitude='uncertain',ownership='ambiguous',
            evidence='Fixture corner unresolved.',suggestion='Inspect final composition.')
        host.receive(**self.response(folder,dict(materialIds=ids,findings=[finding])))
        old=host.files(folder);snapshot=self.job/'snapshot'
        frozen=host.prepare_candidate(snapshot,read(snapshot/'snapshot.json')['digest'],self.root/'candidate')
        jobs={key:self.job for key in read(self.job/'job.json')['assets']}
        result=host.deliver_candidate(self.root/'candidate',frozen['candidateDigest'],jobs,
            self.root/'candidate-output',self.root/'viewer',[folder])
        self.assertEqual(result['visualEvidence'][0]['status'],'blocked_no_retry')
        self.assertEqual(result['visualEvidence'][0]['findings'],[finding])
        self.assertEqual(old,host.files(folder))
        with self.assertRaisesRegex(ValueError,'OUTPUT_REVIEW_NOT_PASSED'):host.verify_run(folder)

    def test_candidate_report_keeps_foreign_presence_even_when_findings_empty(self):
        from test_ownership_observation import complete
        key=self.sheets[0];folder=self.prepare(key)
        inventory=read(folder/'review/ownership-inventory.json');observations=complete(inventory)
        foreign=next(row for row in observations if row['foreign'])['foreign'][0]
        foreign['state']='present';foreign['evidence']='Fixture parent contains a foreign child.'
        review_result=host.receive(**self.response(folder,dict(materialIds=inventory['materialIds'],
            findings=[],ownershipObservations=observations)))
        self.assertEqual(review_result['status'],'blocked_no_retry')
        old=host.files(folder);snapshot=self.job/'snapshot'
        frozen=host.prepare_candidate(snapshot,read(snapshot/'snapshot.json')['digest'],self.root/'candidate')
        jobs={key:self.job for key in read(self.job/'job.json')['assets']}
        result=host.deliver_candidate(self.root/'candidate',frozen['candidateDigest'],jobs,
            self.root/'candidate-output',self.root/'viewer',[folder])
        evidence=result['visualEvidence'][0]
        self.assertEqual(evidence['findings'],[])
        self.assertEqual(evidence['ownershipObservations'],observations)
        self.assertEqual(evidence['blockers'],review_result['blockers'])
        self.assertTrue(evidence['ownershipDeclarationsOnly'])
        issues=read(self.root/'candidate-output/delivery/package/review.json')['issues']
        self.assertTrue(any('OWNERSHIP_OBSERVATION_BLOCKED' in issue and foreign['objectId'] in issue
            for issue in issues))
        self.assertEqual(old,host.files(folder));self.assertFalse(result['humanVisualAcceptance'])

    def test_candidate_cannot_ignore_missing_receipt_changed_raw_or_policy(self):
        snapshot=self.job/'snapshot'
        frozen=host.prepare_candidate(snapshot,read(snapshot/'snapshot.json')['digest'],self.root/'candidate')
        jobs={key:self.job for key in read(self.job/'job.json')['assets']}
        with self.assertRaisesRegex(ValueError,'COMPLETE_RECEIVED_REQUEST_SET'):
            host.deliver_candidate(self.root/'candidate',frozen['candidateDigest'],{},self.root/'missing',self.root/'viewer')
        raw=self.job/'attempts'/self.sheets[0]/'raw.png';old=raw.read_bytes();raw.write_bytes(old+b'changed')
        with self.assertRaisesRegex(ValueError,'RESULT_CHANGED'):
            host.deliver_candidate(self.root/'candidate',frozen['candidateDigest'],jobs,self.root/'changed',self.root/'viewer')
        raw.write_bytes(old)
        config=self.root/'candidate/candidate.json';body=read(config);body['registrationPolicy']='legacy-region-fit'
        save(self.root/'changed-policy.json',body)
        config.write_bytes((self.root/'changed-policy.json').read_bytes())
        with self.assertRaisesRegex(ValueError,'RECORD_CHANGED'):
            host.deliver_candidate(self.root/'candidate',frozen['candidateDigest'],jobs,self.root/'changed-policy',self.root/'viewer')


class CandidateSingletonSubstitutionTests(unittest.TestCase):
    """Complete-sheet replacement uses fresh real fixture authorizations and receipts."""
    def setUp(self):
        from ai_ui_layers.compile_visual import HARNESS
        VisualCompileTests.setUp(self)
        self.contract=HARNESS/'planning-harness'
        self.visual=read(self.contract/'examples/visual-plan-scoped.json');self.visual['unknowns']=[]
        self.seed=self.root/'seed.json';save(self.seed,self.visual);self.reference=self.run/'m1/reference.png'
        self.sheet_snapshot=self.root/'sheet-snapshot'
        self.manifest=host.freeze_candidate_plan(self.seed,self.reference,digest(self.reference),self.contract,self.sheet_snapshot,16)
        self.job=self.root/'original-sheet-job';config=exchange.prepare(self.sheet_snapshot,self.manifest['digest'],self.job)
        exchange.authorize(self.job,config['digest'],'fixture original bounded sheet scope')
        while exchange.status(self.job)['status']=='ready':
            request=exchange.next_request(self.job)
            if 'materialIds' in request:
                columns,rows=request['grid'];image=Image.new('RGBA',(columns*100,rows*100));draw=ImageDraw.Draw(image)
                for i in range(len(request['materialIds'])):
                    x=i%columns*100;y=i//columns*100;draw.rectangle((x+15,y+15,x+84,y+84),fill=(50,60,70,255))
                draw.line((1,image.height//2,image.width-2,image.height//2),fill=(50,60,70,255))
            elif request['asset']=='asset-scene':image=Image.new('RGB',(240,240),(50,60,70))
            else:
                image=Image.new('RGBA',(240,240));ImageDraw.Draw(image).rectangle((20,20,219,219),fill=(50,60,70,255))
            raw=self.root/'raw-fixture.png';image.save(raw);exchange.receive(self.job,request['submissionDigest'],raw)
        self.sheet=next(row for row in read(self.sheet_snapshot/'requests.json')['requests'] if row.get('kind')=='sheet')
        self.single_snapshot=self.root/'single-snapshot'
        self.single_manifest=host.freeze_candidate_plan(self.seed,self.reference,digest(self.reference),self.contract,
            self.single_snapshot,16,generation_mode='single')
        self.replacements=self.new_jobs(self.single_snapshot,'replacement')
        frozen=host.prepare_candidate(self.sheet_snapshot,self.manifest['digest'],self.root/'candidate')
        self.candidate_digest=frozen['candidateDigest']
        self.received={key:self.job for key in read(self.job/'job.json')['assets']}
        self.viewer=self.root/'viewer';self.viewer.mkdir()
        (self.viewer/'viewer.html').write_text('<html></html>');(self.viewer/'viewer.js').write_text('void 0;')

    def new_jobs(self,snapshot,prefix,authorize=True):
        manifest=read(snapshot/'snapshot.json');result={}
        for mid in self.sheet['materialIds']:
            job=self.root/(prefix+'-'+mid);config=exchange.prepare(snapshot,manifest['digest'],job,[mid])
            result[mid]=job
            if not authorize:continue
            exchange.authorize(job,config['digest'],'fixture one fresh singleton authorization')
            request=exchange.next_request(job);raw=self.root/(prefix+'-'+mid+'.png')
            image=Image.new('RGBA',(240,240));ImageDraw.Draw(image).rectangle((20,20,219,219),fill=(70,80,90,230))
            image.putpixel((2,3),(11,21,31,1));image.save(raw);exchange.receive(job,request['submissionDigest'],raw)
        return result

    def deliver(self,materials,name='delivered'):
        return host.deliver_candidate(self.root/'candidate',self.candidate_digest,self.received,self.root/name,
                                      self.viewer,received_materials=materials)

    def test_complete_fresh_singletons_replace_failed_sheet_and_preserve_original_terminal(self):
        before=host.files(self.job)
        with Image.open(self.job/'attempts'/self.sheet['asset']/'raw.png') as image:
            with self.assertRaisesRegex(ValueError,'SHEET_CONTOUR_TOUCHES_CELL_BOUNDARY'):
                host.cells(image,self.sheet,actual_gaps=True)
        result=self.deliver(self.replacements)
        self.assertEqual(result['status'],'pending-human-review');self.assertEqual(result['modelCalls'],0)
        self.assertFalse(result['humanVisualAcceptance']);self.assertFalse(result['originalDagPromoted'])
        substitution=result['materialSubstitutions'][0]
        self.assertFalse(substitution['originalSheetExtractionPassed']);self.assertFalse(substitution['originalSheetDelivered'])
        self.assertEqual(substitution['strictExtractionIssue'],'SHEET_CONTOUR_TOUCHES_CELL_BOUNDARY')
        self.assertEqual(substitution['materialIds'],self.sheet['materialIds'])
        self.assertEqual(len(substitution['replacementSources']),len(self.replacements))
        for binding in substitution['replacementSources']:
            self.assertEqual(binding['snapshotDigest'],self.single_manifest['digest'])
            self.assertNotEqual(binding['snapshotDigest'],self.manifest['digest'])
            self.assertEqual(exchange.status(self.replacements[binding['materialId']])['assignedCalls'],1)
        self.assertEqual(before,host.files(self.job))
        self.assertTrue((self.root/'delivered/delivery/ui-layers.zip').is_file())
        review=read(self.root/'delivered/delivery/package/review.json')
        self.assertTrue(any('Fresh singleton substitution' in issue and 'SHEET_CONTOUR_TOUCHES_CELL_BOUNDARY' in issue for issue in review['issues']))
        self.assertEqual(self.single_manifest['generationMode'],'single');self.assertFalse(self.single_manifest['newM2ReviewPerformed'])

    def test_partial_sheet_original_singleton_and_unreceived_material_are_rejected(self):
        first=self.sheet['materialIds'][0]
        with self.assertRaisesRegex(ValueError,'COMPLETE_SHEET_SUBSTITUTION_REQUIRED'):
            self.deliver({first:self.replacements[first]},'partial')
        singleton=next(row['asset'] for row in read(self.sheet_snapshot/'requests.json')['requests'] if row.get('kind')!='sheet')
        with self.assertRaisesRegex(ValueError,'ONLY_COMPLETE_SHEET_MATERIAL_SUBSTITUTIONS_ALLOWED'):
            self.deliver({singleton:self.job},'original-singleton')
        unreceived=self.new_jobs(self.single_snapshot,'unreceived',authorize=False)
        with self.assertRaisesRegex(ValueError,'RECEIVED_REQUEST_REQUIRED'):
            self.deliver(unreceived,'unreceived')

    def test_changed_reference_plan_and_policy_are_not_cross_snapshot_substitutions(self):
        from ai_ui_layers.visual_policy import FIELDS
        changed_reference=self.root/'changed-reference.png';Image.new('RGB',(1000,1000),(90,80,70)).save(changed_reference)
        changed_plan=self.root/'changed-plan.json';visual=read(self.seed);visual['materials'][0]['label']+=' changed';save(changed_plan,visual)
        policy=self.root/'changed-policy.json';save(policy,{field:values[0] for field,values in FIELDS.items()})
        for name,seed,reference,kwargs in (('reference',self.seed,changed_reference,{}),
                ('plan',changed_plan,self.reference,{}),('policy',self.seed,self.reference,dict(visual_policy=policy))):
            snapshot=self.root/('changed-'+name+'-snapshot')
            host.freeze_candidate_plan(seed,reference,digest(reference),self.contract,snapshot,16,generation_mode='single',**kwargs)
            jobs=self.new_jobs(snapshot,'changed-'+name)
            with self.assertRaisesRegex(ValueError,'SUBSTITUTION_SOURCE_PLAN_OR_POLICY_CHANGED|SUBSTITUTION_REFERENCE_CHANGED'):
                self.deliver(jobs,'changed-'+name+'-output')

    def test_changed_singleton_row_and_duplicate_cli_mid_are_rejected(self):
        first=self.sheet['materialIds'][0];job=self.replacements[first]
        requests=read(job/'snapshot/requests.json');requests['requests'][0]['outputSize'][0]+=1
        with (job/'snapshot/requests.json').open('w',encoding='utf-8') as stream:json.dump(requests,stream)
        with self.assertRaisesRegex(ValueError,'ARTIFACT_CHANGED'):
            self.deliver(self.replacements,'changed-row')
        from ai_ui_layers.delivery_dag import main
        args=['ui_layer.py','deliver-candidate-layers','--candidate','unused','--job-digest','unused',
            '--received-source','sheet=unused','--received-material','mid=one','--received-material','mid=two',
            '--output','unused','--viewer','unused']
        with patch('sys.argv',args),self.assertRaises(SystemExit):main()

    def test_single_mode_preserves_v7_texture_policy_prompts_and_exact_asset_structure(self):
        from ai_ui_layers.visual_policy import FIELDS
        import test_visual_texture_pipeline as fixture
        sample=fixture.VisualTexturePipelineTests();sample.setUp();self.addCleanup(sample.doCleanups)
        strict=sample.frozen('source-texture-review')
        visual=strict/'evidence/revised-visual-plan.json'
        if not visual.exists():visual=strict/'evidence/m1-draft.json'
        policy=self.root/'texture-policy.json';save(policy,{field:values[0] for field,values in FIELDS.items()})
        kwargs=dict(visual_policy=policy,visual_textures=sample.input,
                    prior_texture_review=strict/'evidence/visual-texture-final-review.json')
        sheets=self.root/'texture-sheets';singles=self.root/'texture-singles'
        a=host.freeze_candidate_plan(visual,sample.source,digest(sample.source),self.contract,sheets,16,**kwargs)
        b=host.freeze_candidate_plan(visual,sample.source,digest(sample.source),self.contract,singles,16,generation_mode='single',**kwargs)
        self.assertEqual(read(sheets/'execution-plan.candidate.json'),read(singles/'execution-plan.candidate.json'))
        self.assertEqual(read(sheets/'placements.json'),read(singles/'placements.json'))
        for field in ('sourcePlanSha256','referenceSha256','visualPolicySha256','visualTexturesSha256','visualTextureBindingsSha256'):
            self.assertEqual(a[field],b[field])
        requests=read(singles/'requests.json')
        self.assertEqual(requests['kind'],'ui_visual_requests_preview_v1')
        self.assertTrue(all(row.get('kind')!='sheet' and 'materialIds' not in row for row in requests['requests']))
        coin=next(row for row in requests['requests'] if row['asset']=='asset-coin-a')
        prompt=(singles/coin['prompt']).read_text(encoding='utf-8')
        self.assertIn('tiny-print',prompt);self.assertIn('visual-material-context-prompt-v7',read(singles/'execution-plan.candidate.json')['assets'][0]['prompt'])
        self.assertFalse(b['newM2ReviewPerformed']);self.assertFalse(b['newTextureReviewPerformed'])


class MeasuredAlphaSupportTests(unittest.TestCase):
    def quantity(self):
        image=Image.new('RGBA',(2180,760));draw=ImageDraw.Draw(image)
        draw.rectangle((60,171,2109,539),fill=(60,70,80,230))
        draw.rectangle((60,540,2109,692),fill=(60,70,80,7))
        image.putpixel((56,167),(11,21,31,1));image.putpixel((2116,692),(41,51,61,1))
        return image

    def test_measured_body_is_not_shrunk_by_faint_extension_and_source_is_unchanged(self):
        image=self.quantity();before=image.tobytes();owner=[100,100,436,161]
        canvas,region,report=host.measured_alpha_support(image,owner,(600,300))
        self.assertEqual(report['sourceFullAlphaBox'],[56,167,2117,693])
        self.assertEqual(report['sourceMeasuredAlphaBox'],[60,171,2110,540])
        self.assertGreater(report['actualScale'],.16);self.assertEqual(report['actualScale'],report['desiredScale'])
        self.assertGreater(region[3],owner[3]);self.assertGreater(canvas.height,61)
        self.assertEqual(image.tobytes(),before);self.assertTrue(report['sourceUnthresholded'])
        self.assertFalse(report['observedBody']);self.assertFalse(report['humanVisualAcceptance'])
        self.assertFalse(report['resampledAlphaValuesAreSourcePixelExact'])
        self.assertGreater(report['actualRenderedSupportBox'][3],owner[3])

    def test_reference_boundary_uses_minimum_translation_before_scale_reduction(self):
        image=self.quantity();owner=[100,180,436,241]
        canvas,region,report=host.measured_alpha_support(image,owner,(600,250))
        self.assertEqual(report['actualScale'],report['desiredScale'])
        self.assertEqual(report['translationDeviations'][0],0)
        self.assertLess(report['translationDeviations'][1],0)
        expected=250-2-report['actualScale']*(report['sourceFullAlphaBox'][3]+2)
        self.assertAlmostEqual(report['actualTranslation'][1],expected)
        self.assertLessEqual(region[3],250);self.assertFalse(report['alphaSupportClipped'])

    def test_support_larger_than_reference_reduces_one_uniform_scale(self):
        image=Image.new('RGBA',(200,100));draw=ImageDraw.Draw(image)
        draw.rectangle((1,1,198,98),fill=(30,40,50,1));draw.rectangle((80,40,99,59),fill=(60,70,80,230))
        before=image.tobytes();canvas,region,report=host.measured_alpha_support(image,[25,25,75,75],(100,100))
        self.assertLess(report['actualScale'],report['desiredScale'])
        self.assertGreater(report['scaleReduction'],0)
        self.assertEqual(report['inverseAffine'][0],report['inverseAffine'][4])
        self.assertTrue(0<=region[0]<region[2]<=100 and 0<=region[1]<region[3]<=100)
        self.assertEqual(image.tobytes(),before)

    def test_completely_faint_alpha_falls_back_to_full_support(self):
        image=Image.new('RGBA',(120,80));ImageDraw.Draw(image).rectangle((10,10,109,69),fill=(30,40,50,7))
        canvas,region,report=host.measured_alpha_support(image,[10,10,110,70],(140,100))
        self.assertIsNone(report['sourceMeasuredAlphaBox']);self.assertEqual(report['measurementFallback'],'full-alpha-box')
        self.assertEqual(report['sourcePlacementBox'],[10,10,110,70]);self.assertTrue(report['sourceUnthresholded'])
        self.assertIsNotNone(canvas.getchannel('A').getbbox())

    def test_all_measured_components_contribute_without_largest_component_selection(self):
        image=Image.new('RGBA',(160,100));draw=ImageDraw.Draw(image)
        draw.rectangle((10,10,39,39),fill=(50,60,70,230));draw.rectangle((120,70,139,89),fill=(80,90,100,40))
        canvas,region,report=host.measured_alpha_support(image,[20,20,150,100],(200,140))
        self.assertEqual(report['sourceMeasuredAlphaBox'],[10,10,140,90])
        self.assertEqual(report['sourcePlacementBox'],[10,10,140,90])
        self.assertEqual(report['measurementThreshold'],8)
        pixels=__import__('numpy').array(canvas)
        self.assertTrue((pixels[:,:,3]>0).any())
        self.assertTrue((pixels[pixels[:,:,3]==0,:3]==0).all())


class CandidateSheetSplitTests(unittest.TestCase):
    """No model calls: all nonzero alpha and all RGBA partition pixels survive."""
    def picture(self):
        image=Image.new('RGBA',(200,100));draw=ImageDraw.Draw(image)
        draw.rectangle((20,20,75,79),fill=(50,60,70,230))
        draw.rectangle((125,20,180,79),fill=(70,80,90,255))
        image.putpixel((90,40),(21,31,41,1));image.putpixel((110,40),(51,61,71,1))
        return image,dict(grid=[2,1],materialIds=['left','right'])

    def verify_partition(self,image,row,expected_cut):
        with self.assertRaisesRegex(ValueError,'^SHEET_AMBIGUOUS_EMPTY_BANDS$'):
            host.cells(image,row,actual_gaps=True)
        boxes,report=host.candidate_sheet_cells(image,row)
        self.assertEqual(report['strictExtractionIssue'],'SHEET_AMBIGUOUS_EMPTY_BANDS')
        self.assertEqual(report['candidateSheetSplitPolicy'],host.CANDIDATE_SPLIT)
        self.assertEqual(report['xCuts'],[0,expected_cut,200])
        self.assertTrue(report['allSourcePixelsRetained']);self.assertTrue(report['reconstructionPixelExact'])
        self.assertEqual(report['sourceRgbaPixelsSha256'],report['reconstructedRgbaPixelsSha256'])
        rebuilt=Image.new('RGBA',image.size)
        for box in boxes:rebuilt.paste(image.crop(box),box[:2])
        self.assertEqual(rebuilt.tobytes(),image.tobytes())
        self.assertEqual(rebuilt.getpixel((90,40)),(21,31,41,1))
        self.assertEqual(rebuilt.getpixel((110,40)),(51,61,71,1))

    def test_ambiguous_bands_use_transparent_nominal_and_keep_alpha_one(self):
        image,row=self.picture();self.verify_partition(image,row,100)

    def test_nontransparent_nominal_uses_unique_nearest_without_cutting_alpha(self):
        image,row=self.picture()
        for x in (99,100,101):image.putpixel((x,40),(101,111,121,1))
        self.verify_partition(image,row,98)

    def test_nearest_transparent_cut_tie_stops(self):
        image,row=self.picture()
        for x in (99,100):image.putpixel((x,40),(101,111,121,1))
        before=image.tobytes()
        with self.assertRaisesRegex(ValueError,'CANDIDATE_NEAREST_SEAM_TIE'):
            host.candidate_sheet_cells(image,row)
        self.assertEqual(image.tobytes(),before)

    def test_no_transparent_seam_in_frozen_search_range_stops(self):
        image=Image.new('RGBA',(200,200));draw=ImageDraw.Draw(image)
        for x in (20,125):
            for y in (20,125):draw.rectangle((x,y,x+55,y+54),fill=(50,60,70,255))
        for x in (90,110):image.putpixel((x,40),(21,31,41,1))
        draw.line((20,75,20,125),fill=(50,60,70,1))
        before=image.tobytes()
        with self.assertRaisesRegex(ValueError,'CANDIDATE_NO_TRANSPARENT_SEAM'):
            host.candidate_sheet_cells(image,dict(grid=[2,2],materialIds=['a','b','c','d']))
        self.assertEqual(image.tobytes(),before)

    def test_strict_success_is_preferred_and_other_failure_is_not_reinterpreted(self):
        image,row=self.picture();image.putpixel((90,40),(0,0,0,0));image.putpixel((110,40),(0,0,0,0))
        strict=host.cells(image,row,actual_gaps=True);boxes,report=host.candidate_sheet_cells(image,row)
        self.assertEqual(boxes,strict);self.assertIsNone(report['strictExtractionIssue'])
        image=Image.new('RGBA',(200,100),(50,60,70,255))
        with self.assertRaisesRegex(ValueError,'^SHEET_NATIVE_ALPHA_REQUIRED$'):
            host.candidate_sheet_cells(image,row)

    def boundary_picture(self,alpha=1):
        image,row=self.picture()
        for x in (90,110):image.putpixel((x,40),(0,0,0,0))
        image.putpixel((0,0),(11,21,31,alpha));image.putpixel((199,99),(41,51,61,alpha))
        return image,row

    def test_faint_true_source_boundary_gets_guard_and_exact_pixel_partition(self):
        image,row=self.boundary_picture();before=image.tobytes()
        with self.assertRaisesRegex(ValueError,'^SHEET_CONTOUR_TOUCHES_CELL_BOUNDARY$'):
            host.cells(image,row,actual_gaps=True)
        boxes,report=host.candidate_sheet_cells(image,row)
        self.assertEqual(report['strictExtractionIssue'],'SHEET_CONTOUR_TOUCHES_CELL_BOUNDARY')
        self.assertEqual(report['rawOuterBoundaryNonzeroAlphaCount'],2)
        self.assertEqual(report['rawOuterBoundaryNonzeroAlphaMaximum'],1)
        self.assertTrue(report['sourceBoundaryAlphaPresent']);self.assertTrue(report['sourcePixelPartitionExact'])
        self.assertEqual(report['samplingGuard'],2);self.assertFalse(report['alphaQualityAccepted'])
        reconstructed=Image.new('RGBA',image.size)
        for box in boxes:
            cell=host.candidate_cell(image,box,report);w,h=box[2]-box[0],box[3]-box[1]
            self.assertEqual(cell.size,(w+4,h+4))
            self.assertEqual(cell.getchannel('A').getextrema()[0],0)
            content=cell.crop((2,2,w+2,h+2))
            self.assertEqual(content.tobytes(),image.crop(box).tobytes())
            reconstructed.paste(content,box[:2])
        self.assertEqual(reconstructed.tobytes(),before);self.assertEqual(image.tobytes(),before)
        self.assertEqual(reconstructed.getpixel((0,0)),(11,21,31,1))
        self.assertEqual(reconstructed.getpixel((199,99)),(41,51,61,1))

    def test_nonfaint_source_boundary_is_not_padded_into_a_pass(self):
        image,row=self.boundary_picture(alpha=2);before=image.tobytes()
        with self.assertRaisesRegex(ValueError,'CANDIDATE_SOURCE_OUTER_ALPHA_NOT_FAINT'):
            host.candidate_sheet_cells(image,row)
        self.assertEqual(image.tobytes(),before)

    def test_ambiguous_bands_and_faint_source_boundary_preserve_both_facts(self):
        image,row=self.picture();image.putpixel((0,0),(11,21,31,1));before=image.tobytes()
        with self.assertRaisesRegex(ValueError,'^SHEET_AMBIGUOUS_EMPTY_BANDS$'):
            host.cells(image,row,actual_gaps=True)
        boxes,report=host.candidate_sheet_cells(image,row)
        self.assertEqual(report['strictExtractionIssue'],'SHEET_AMBIGUOUS_EMPTY_BANDS')
        self.assertEqual(report['samplingGuard'],2)
        self.assertEqual(report['rawOuterBoundaryNonzeroAlphaCount'],1)
        self.assertEqual(report['rawOuterBoundaryNonzeroAlphaMaximum'],1)
        self.assertTrue(report['sourcePixelPartitionExact']);self.assertFalse(report['alphaQualityAccepted'])
        reconstructed=Image.new('RGBA',image.size)
        for box in boxes:
            guarded=host.candidate_cell(image,box,report);w,h=box[2]-box[0],box[3]-box[1]
            reconstructed.paste(guarded.crop((2,2,w+2,h+2)),box[:2])
        self.assertEqual(reconstructed.tobytes(),before);self.assertEqual(image.tobytes(),before)

    def test_ambiguous_bands_do_not_hide_nonfaint_source_boundary(self):
        image,row=self.picture();image.putpixel((0,0),(11,21,31,2));before=image.tobytes()
        with self.assertRaisesRegex(ValueError,'^SHEET_AMBIGUOUS_EMPTY_BANDS$'):
            host.cells(image,row,actual_gaps=True)
        with self.assertRaisesRegex(ValueError,'SHEET_AMBIGUOUS_EMPTY_BANDS: CANDIDATE_SOURCE_OUTER_ALPHA_NOT_FAINT'):
            host.candidate_sheet_cells(image,row)
        self.assertEqual(image.tobytes(),before)

    def test_faint_source_boundary_never_waives_nonzero_internal_seam(self):
        image,row=self.boundary_picture()
        ImageDraw.Draw(image).line((75,50,125,50),fill=(11,21,31,1));before=image.tobytes()
        with self.assertRaisesRegex(ValueError,'CANDIDATE_NO_TRANSPARENT_SEAM'):
            host.candidate_sheet_cells(image,row)
        self.assertEqual(image.tobytes(),before)


class HostStripTests(HostEvidence,unittest.TestCase):
    def setUp(self):
        VisualCompileTests.setUp(self)
        visual=self.visual;background=next(m for m in visual['materials'] if m['role']=='background');visual['materials']=[background,dict(visual['materials'][0],id='strip',role='foreground',
            bboxNorm=[.1,.1,.9,.2],zOrder=1,adaptationPolicy='simple-strip',preserveText=[])]
        visual['backgroundMode']='scene-only';visual['textPolicy']='remove-business-text';background['preserveText']=[]
        visual['objects']=[visual['objects'][0],dict(visual['objects'][0],id='strip-object',materialId='strip',kind='decoration',bboxNorm=None)]
        (self.run/'m1/draft.json').unlink();save(self.run/'m1/draft.json',visual)
        request=read(self.run/'request.json');request['inputs']['draft.json']=digest(self.run/'m1/draft.json')
        # The historical fixture request does not bind draft.json; update its explicit result hash only.
        result=read(self.run/'result.json');result['sourcePlanSha256']=digest(self.run/'m1/draft.json')
        (self.run/'result.json').unlink();save(self.run/'result.json',result)
        review_request=read(self.run/'m2/request.json');review_request['sourcePlanSha256']=digest(self.run/'m1/draft.json')
        (self.run/'m2/request.json').unlink();save(self.run/'m2/request.json',review_request)
        self.snapshot=self.root/'snapshot';frozen=freeze(self.run,self.snapshot,2);self.snapshot_digest=frozen['digest']
        self.job=self.root/'strip-job';config=exchange.prepare(self.snapshot,self.snapshot_digest,self.job)
        exchange.authorize(self.job,config['digest'],'offline fixture only');request=exchange.next_request(self.job)
        raw=self.root/'strip.png';image=Image.new('RGBA',(400,200));ImageDraw.Draw(image).rectangle((20,50,379,149),fill=(60,80,90,255));image.save(raw)
        if request['asset']=='asset-scene':Image.new('RGB',(100,100),(60,70,80)).save(raw)
        exchange.receive(self.job,request['submissionDigest'],raw)
        if exchange.status(self.job)['status']=='ready':
            request=exchange.next_request(self.job)
            image.save(raw) if request['asset']=='strip' else Image.new('RGB',(100,100),(60,70,80)).save(raw)
            exchange.receive(self.job,request['submissionDigest'],raw)

    def test_strip_adapter_and_fingerprints_are_bound(self):
        folder=self.prepare('strip');host.receive(**self.response(folder));output=self.root/'extraction'
        background=self.prepare('asset-scene');host.receive(**self.response(background))
        result=host.extract(self.snapshot,self.snapshot_digest,[folder,background],output)
        self.assertNotEqual(result['materials']['strip'],result['rawMaterials']['strip'])
        self.assertEqual(result['adaptationEvidence']['materials']['strip']['policy'],'simple-strip')
        host.verify_extraction(output)
        from ai_ui_layers.automatic_registration import run as register
        from ai_ui_layers.body_registration import KIND,POLICY_SUPPORT
        source=Path(result['materials']['strip']);reference=self.snapshot/'reference.png'
        with Image.open(source) as image:body=list(image.convert('RGBA').getchannel('A').point(lambda a:255 if a>=128 else 0).getbbox())
        target=[100,100,100+body[2]-body[0],100+body[3]-body[1]]
        observation=self.root/'body-observation.json'
        scope=dict(snapshotDigest=self.snapshot_digest,materialId='strip',sourceSha256=digest(source),
                   referenceSha256=digest(reference),sourceBodyBox=body,targetBodyBox=target)
        save(observation,dict(kind='ui_body_observation_v1',**scope,boundaryStatus='complete',issues=[]))
        contract=self.root/'body-contract.json'
        save(contract,dict(kind=KIND,**scope,evidence=dict(path=str(observation),sha256=digest(observation),
             basis='Explicit fixture body observation'),issues=[]))
        config=self.root/'registration.json'
        save(config,dict(snapshot=str(self.snapshot),snapshotDigest=self.snapshot_digest,materials=result['materials'],
            registrationPolicy=POLICY_SUPPORT,wholePlacements={'strip':dict(path=str(contract),sha256=digest(contract))}))
        register(config,self.root/'registration',selected=[])
        viewer=self.root/'viewer';viewer.mkdir();(viewer/'viewer.html').write_text('<html></html>');(viewer/'viewer.js').write_text('void 0;')
        packaged=host.package(output,self.root/'registration/preview',self.root/'package',viewer)
        self.assertTrue((self.root/'package/ui-layers.zip').is_file())
        self.assertEqual(packaged['layerCount'],2)
        adapted=Path(result['materials']['strip']);old=adapted.read_bytes();adapted.write_bytes(old+b'changed')
        with self.assertRaisesRegex(ValueError,'EVIDENCE_CHANGED'):host.verify_extraction(output)
        adapted.write_bytes(old);report=output/'adaptation/strip/result.json';report.write_bytes(report.read_bytes()+b'changed')
        with self.assertRaisesRegex(ValueError,'EVIDENCE_CHANGED'):host.verify_extraction(output)

class HostFrozenTests(HostEvidence,unittest.TestCase):
    def test_old_host_snapshot_inspects_without_upgrading_planning_runtime(self):
        import hashlib
        from test_host_review import HostReviewTests
        from ai_ui_layers import host_review
        from ai_ui_layers.freeze_visual import inspect
        fixture=HostReviewTests('test_external_review_freezes_and_inspects_without_provider_receipts')
        fixture.setUp();self.addCleanup(fixture.doCleanups)
        # Explicit previous-install fingerprint test double, not historical source code.
        # Keep the complete runtime map and vary one file fingerprint deterministically.
        old_runtime=dict(host_review.runtime_files())
        previous_file=next(iter(sorted(old_runtime)))
        old_runtime[previous_file]=hashlib.sha256(b'fixture previous-install program bytes').hexdigest()
        with patch.object(host_review,'runtime_files',return_value=old_runtime):
            fixture.prepare();fixture.receive();frozen=fixture.freeze()
        self.assertNotEqual(old_runtime,host_review.runtime_files())
        with self.assertRaisesRegex(ValueError,'RUNTIME_CHANGED'):
            host_review.verify_prepared(fixture.root)
        snapshot=fixture.base/'frozen';before=host.files(snapshot);inspect(snapshot,frozen['digest'])
        self.root=fixture.base;self.job=self.root/'output-job'
        config=exchange.prepare(snapshot,frozen['digest'],self.job)
        exchange.authorize(self.job,config['digest'],'offline new material fixture only')
        while exchange.status(self.job)['status']=='ready':
            request=exchange.next_request(self.job);raw=self.root/'received-fixture.png'
            if 'materialIds' in request:
                columns,rows=request['grid'];image=Image.new('RGBA',(columns*100,rows*100))
                draw=ImageDraw.Draw(image)
                for i,mid in enumerate(request['materialIds']):
                    x=i%columns*100;y=i//columns*100
                    draw.rectangle((x+15,y+15,x+84,y+84),fill=(60,90,100,255))
            elif request['asset']=='asset-scene':image=Image.new('RGB',(200,200),(30,40,50))
            else:
                image=Image.new('RGBA',(200,200));ImageDraw.Draw(image).rectangle((20,20,179,179),fill=(80,90,100,255))
            image.save(raw);exchange.receive(self.job,request['submissionDigest'],raw)
        key=config['assets'][0];folder=self.prepare(key);host.receive(**self.response(folder));host.verify_run(folder)
        self.assertEqual(host.files(snapshot),before)
