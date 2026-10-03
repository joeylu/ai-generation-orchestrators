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
        if raw is None:save(response,answer or dict(materialIds=request['materialIds'],findings=[]))
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
