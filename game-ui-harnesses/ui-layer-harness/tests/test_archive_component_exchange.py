import _bootstrap
import json
import unittest
from PIL import Image
from ai_ui_layers import archive_component_exchange as component
from ai_ui_layers import archive_material_edit as legacy
from ai_ui_layers.evaluate import read,save,digest
from test_host_geometry_observation import HostGeometryTests


class ComponentExchangeTests(unittest.TestCase):
    def setUp(self):
        HostGeometryTests.setUp(self)

    def freeze(self,job=None,child='child',archive=None):
        job=job or self.root/'component'
        result=component.freeze(archive or self.archive,'panel',child,job,name='Child detail',
            purpose='Extract exact QUEST mark.',owned=['QUEST wordmark'],delete=['parent frame'],reference_region=[4,6,20,22])
        self.assertEqual(result['generationCalls'],0)
        return job,result

    def native(self,job=None,child='child',archive=None):
        job,frozen=self.freeze(job,child,archive)
        component.authorize(job,frozen['digest'],'Fixture user authorizes one native extraction.')
        submission=component.next_request(job)
        raw=job.parent/(child+'-return.png');image=Image.new('RGBA',(18,20))
        image.paste((45,60,80,255),(3,3,15,17));image.putpixel((2,8),(45,60,80,1));image.save(raw)
        r=component.verify_frozen(job);evidence=job.parent/(child+'-evidence.json')
        save(evidence,dict(kind='ui_native_component_return_v1',submissionDigest=submission['submissionDigest'],
            parentLayerId='panel',componentId=child,referenceSha256=r['referenceSha256'],returnedSha256=digest(raw),
            hostObservedNativeReturn=True,notCryptographicallyProviderVerified=True))
        component.receive(job,submission['submissionDigest'],raw,evidence)
        return job,raw,submission,evidence

    def observe(self,job,child='child',valid=True):
        item=self.root/(child+'-observation');component.prepare_observation(job,item);r=read(item/'request.json')
        answer=dict(kind='ui_host_geometry_answer_v1',layerId=child,boundaryStatus='complete',
            sourceBodyBox=[3,3,15,17],targetBodyBox=[6,8,18,22],landmarkPairs=[],geometryIssues=[],materialIssues=[],
            evidence='Visible component corners, not the parent bounds.')
        if not valid:answer['layerId']='wrong'
        response=self.root/(child+'-answer.json');save(response,answer)
        dispatch=self.root/(child+'-dispatch.bin');dispatch.write_bytes(b'fixture component dispatch')
        returned=self.root/(child+'-observed.bin');returned.write_bytes(b'fixture original component answer')
        attestation=self.root/(child+'-attestation.json')
        save(attestation,dict(kind='ui_host_geometry_attestation_v1',requestSha256=digest(item/'request.json'),
            responseSha256=digest(response),inputsSha256=r['inputsSha256'],reviewerId='fixture-reviewer',
            materialAuthors=['fixture-author'],hostAssertedModelResponse=True,notProviderReceipt=True,
            notCryptographicallyPlatformVerified=True,dispatchEvidenceSha256=digest(dispatch),returnEvidenceSha256=digest(returned)))
        args=dict(host_attestation_path=attestation,dispatch_evidence_path=dispatch,return_evidence_path=returned)
        return item,response,args,answer

    def test_reference_only_child_and_parent_have_distinct_identities(self):
        job,frozen=self.freeze();r=component.verify_frozen(job);args=component.frozen_arguments(job)
        self.assertEqual(args['referenced_image_paths'],[str(job/'reference-crop.png'),str(job/'reference.png')])
        self.assertNotIn(str(job/'parent.png'),args['referenced_image_paths'])
        self.assertEqual(r['componentId'],'child');self.assertEqual(r['parentLayerId'],'panel')
        self.assertNotIn('originalLayer',r)
        self.assertIn('QUEST wordmark',args['prompt']);self.assertTrue(args['transparent_background'])
        with self.assertRaisesRegex(ValueError,'AUTHORIZATION_DIGEST'):
            component.authorize(job,'0'*64,'Fixture authorization')
        self.assertFalse((job/'authorization.json').exists())
        legacy_job=self.root/'legacy';legacy.freeze(self.archive,'panel',legacy_job,purpose='Fixture',owned=['panel'],delete=['child'])
        self.assertEqual(legacy.frozen_arguments(legacy_job)['referenced_image_paths'],
            [str(legacy_job/'source.png'),str(legacy_job/'reference.png')])
        self.assertNotIn('inputPolicy',legacy.verify_frozen(legacy_job))

    def test_known_parent_unique_child_and_safe_paths_required(self):
        for child in ['panel','../child','child/path','child\\path','', '.']:
            with self.assertRaisesRegex(ValueError,'SAFE_ID|UNIQUE_ID'):
                self.freeze(self.root/'bad',child)
            self.assertFalse((self.root/'bad').exists())
        with self.assertRaisesRegex(ValueError,'KNOWN_PARENT'):
            component.freeze(self.archive,'unknown','child',self.root/'bad',name='Child',purpose='Extract',
                owned=['detail'],delete=['parent'],reference_region=None)

    def test_authorization_text_is_immutable_before_first_dispatch(self):
        job,frozen=self.freeze()
        component.authorize(job,frozen['digest'],'Fixture original user authorizes this component only.')
        original=(job/'authorization.json').read_bytes()
        self.assertEqual(read(job/'authorization-binding.json')['authorizationSha256'],digest(job/'authorization.json'))
        authorization=read(job/'authorization.json')
        authorization['actualUserInstruction']='Different nonempty instruction that was never authorized.'
        (job/'authorization.json').write_text(json.dumps(authorization),encoding='utf-8')
        with self.assertRaisesRegex(ValueError,'COMPONENT_AUTHORIZATION_CHANGED'):component.next_request(job)
        self.assertFalse((job/'submission.json').exists())
        (job/'authorization.json').write_bytes(original)
        component.next_request(job)
        with self.assertRaises(FileExistsError):component.authorize(job,frozen['digest'],'Another authorization')

    def test_native_and_original_observation_preserve_bytes_and_faint_alpha(self):
        job,raw,submission,evidence=self.native();v=component.verify_received(job)
        self.assertEqual(v['rawPath'].read_bytes(),raw.read_bytes())
        with Image.open(v['rawPath']) as image:self.assertEqual(image.getpixel((2,8))[3],1)
        item,response,args,answer=self.observe(job);result=component.receive_observation(item,response,**args)
        r,a,source,reference=component.verify_observation(item)
        self.assertEqual(a,answer);self.assertEqual(source.read_bytes(),raw.read_bytes())
        self.assertEqual(reference.read_bytes(),(job/'reference.png').read_bytes())
        self.assertEqual(r['layerId'],'child');self.assertEqual(r['parentLayerId'],'panel');self.assertNotIn('originalLayer',r)
        self.assertFalse(result['strictBodyRegistrationPassed'])
        self.assertEqual((item/'answer/response.json').read_bytes(),response.read_bytes())
        for action in [lambda:component.next_request(job),lambda:component.receive(job,submission['submissionDigest'],raw,evidence),
            lambda:component.receive_observation(item,response,**args)]:
            with self.assertRaises(FileExistsError):action()

    def test_failed_native_and_observation_receives_are_terminal(self):
        job,frozen=self.freeze();component.authorize(job,frozen['digest'],'Fixture authorization')
        s=component.next_request(job);raw=self.root/'opaque.png';Image.new('RGB',(18,20),(30,40,50)).save(raw)
        r=component.verify_frozen(job);evidence=self.root/'opaque.json'
        save(evidence,dict(kind='ui_native_component_return_v1',submissionDigest=s['submissionDigest'],parentLayerId='panel',
            componentId='child',referenceSha256=r['referenceSha256'],returnedSha256=digest(raw),hostObservedNativeReturn=True,
            notCryptographicallyProviderVerified=True))
        with self.assertRaisesRegex(ValueError,'TRANSPARENT_ALPHA'):component.receive(job,s['submissionDigest'],raw,evidence)
        with self.assertRaises(FileExistsError):component.receive(job,s['submissionDigest'],raw,evidence)
        self.assertFalse((job/'received.json').exists())
        job,_,_,_=self.native(self.root/'other','other');item,response,args,_=self.observe(job,'other',False)
        with self.assertRaisesRegex(ValueError,'LAYER_ID'):component.receive_observation(item,response,**args)
        self.assertFalse((item/'result.json').exists())
        with self.assertRaises(FileExistsError):component.receive_observation(item,response,**args)

    def test_edit_and_observation_tampering_rejected(self):
        job,_,_,_=self.native();item,response,args,_=self.observe(job);component.receive_observation(item,response,**args)
        paths=[job/n for n in ['arguments.json','authorization.json','received.json','raw.png','parent.png','request.json']]
        paths+=[item/'answer/response.json',item/'answer/host-attestation.json',item/'source.png',item/'result.json']
        for path in paths:
            original=path.read_bytes();path.write_bytes(original+b' ')
            with self.assertRaises(Exception):component.verify_observation(item)
            path.write_bytes(original)
        request=read(item/'request.json');request['componentId']='renamed'
        (item/'request.json').write_text(json.dumps(request),encoding='utf-8')
        (item/'preparation.json').write_text(json.dumps(dict(requestSha256=digest(item/'request.json'))),encoding='utf-8')
        with self.assertRaisesRegex(ValueError,'BINDING_CHANGED'):component.verify_observation(item)

    def test_original_answer_cannot_be_replaced_with_refreshed_host_result(self):
        job,_,_,_=self.native();item,response,args,_=self.observe(job);component.receive_observation(item,response,**args)
        original_receipt=(item/'observation-receipt.json').read_bytes()
        answer=read(item/'answer/response.json');answer['targetBodyBox']=[7,8,19,22]
        (item/'answer/response.json').write_text(json.dumps(answer),encoding='utf-8')
        attestation=read(item/'answer/host-attestation.json');attestation['responseSha256']=digest(item/'answer/response.json')
        (item/'answer/host-attestation.json').write_text(json.dumps(attestation),encoding='utf-8')
        request=read(item/'request.json');result=component.geo.assess(request,answer)
        result.update(files={p.name:digest(p) for p in sorted((item/'answer').iterdir())},requestSha256=digest(item/'request.json'))
        (item/'result.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
        # Semantically valid refreshed host hashes cannot replace the sealed original return.
        with self.assertRaisesRegex(ValueError,'OBSERVATION_RECEIPT_CHANGED'):component.verify_observation(item)
        self.assertEqual((item/'observation-receipt.json').read_bytes(),original_receipt)

    def test_observation_receipt_identity_and_result_byte_hash_are_verified(self):
        job,_,_,_=self.native();item,response,args,_=self.observe(job);component.receive_observation(item,response,**args)
        receipt=read(item/'observation-receipt.json')
        self.assertEqual(receipt['resultSha256'],digest(item/'result.json'))
        self.assertEqual(receipt['answerFiles']['response.json'],digest(response))
        self.assertEqual(receipt['answerFiles']['host-attestation.json'],digest(item/'answer/host-attestation.json'))
        path=item/'observation-receipt.json';receipt['editBinding']['componentId']='other'
        path.write_text(json.dumps(receipt),encoding='utf-8')
        with self.assertRaisesRegex(ValueError,'OBSERVATION_RECEIPT_CHANGED'):component.verify_observation(item)

    def test_cross_archive_job_rebinding_rejected(self):
        job,_,_,_=self.native();item,_,_,_=self.observe(job)
        from ai_ui_layers.layer_package import write_package
        composition=read(self.root/'package/package/composition.json')
        source=self.root/'other-parent.png';Image.new('RGBA',(16,16),(60,30,90,128)).save(source)
        write_package(self.root/'reference.png',composition,dict(panel=dict(path=str(source),sha256=digest(source))),
            self.root/'other-package',self.root/'viewer',[])
        other,_,_,_=self.native(self.root/'cross/job',archive=self.root/'other-package/ui-layers.zip')
        request=read(item/'request.json');request['editJobPath']=str(other)
        (item/'request.json').write_text(json.dumps(request),encoding='utf-8')
        (item/'preparation.json').write_text(json.dumps(dict(requestSha256=digest(item/'request.json'))),encoding='utf-8')
        with self.assertRaisesRegex(ValueError,'BINDING_CHANGED'):component._verify_observation_prepared(item)

    def test_viewport_wrapper_uses_original_not_extended_world_reference(self):
        from test_viewport_geometry_revision import ViewportRevisionTests
        fixture=ViewportRevisionTests();fixture.setUp();self.addCleanup(fixture.doCleanups);fixture.export()
        archive=fixture.root/'revised/delivery/viewport-ui-layers.zip';loaded=component.load_archive(archive)
        self.assertEqual(loaded['originalSize'],[32,32]);self.assertEqual(loaded['worldShift'],[8,0])
        self.assertNotEqual(loaded['referenceBytes'],loaded['files']['reference.png'])
        self.assertEqual(loaded['referenceBytes'],(fixture.root/'reference.png').read_bytes())
        job,_=self.freeze(self.root/'wrapper-job',archive=archive)
        self.assertEqual((job/'reference.png').read_bytes(),loaded['referenceBytes'])
        self.assertEqual(component.verify_frozen(job)['parentLayer'],loaded['composition']['layers'][0])


if __name__=='__main__':unittest.main()
