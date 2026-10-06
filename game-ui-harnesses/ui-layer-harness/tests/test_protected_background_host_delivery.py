"""Fresh integrated protected-background fixtures, without model/provider calls."""
import _bootstrap
from pathlib import Path
import unittest
import tempfile
from unittest.mock import patch
from PIL import Image, ImageDraw, PngImagePlugin
from ai_ui_layers import host_delivery as host, background_region as region
from ai_ui_layers import background_region_pipeline as pipeline
from ai_ui_layers.evaluate import read, save, digest
from ai_ui_layers.execution_preflight import preflight
from ai_ui_layers.host_material_review import verify_prepared, verify_extraction
from ai_ui_layers.frozen_image_arguments import tool_arguments, validate, TRANSPORT
from test_host_delivery import HostDeliveryTests
import test_host_review as fixtures


class ProtectedHostDeliveryTests(unittest.TestCase):
    def setUp(self):
        HostDeliveryTests.setUp(self)
        # Use a smaller complete canvas to limit repeated PNG verification cost.
        # Planning geometry remains normalized; the full workflow stays real.
        with Image.open(self.reference) as image:image.resize((500,500)).save(self.reference)
        self.plan['backgroundMode']='scene-only';self.plan['textPolicy']='remove-business-text'
        fixtures.save(self.candidate,self.plan)
        edit=self.base/'edit.png';blend=self.base/'blend.png'
        mask=Image.new('L',(500,500));ImageDraw.Draw(mask).rectangle((100,100,399,399),fill=255);mask.save(edit)
        mask.putpixel((100,100),128);mask.save(blend)
        self.region=self.base/'region'
        self.region_plan=region.freeze(self.reference,digest(self.reference),edit,digest(edit),blend,digest(blend),
            self.region,'scene-only','remove-business-text','Explicit offline fixture source-pixel protection.')
        config=read(self.config_path);config.update(backgroundRegion=str(self.region),
            backgroundRegionDigest=self.region_plan['digest'],backgroundPolicy=pipeline.POLICY)
        fixtures.save(self.config_path,config);self.run=self.base/'protected-integrated'
        host.prepare(self.config_path,self.run);self.root=self.run/'planning'

    def planning(self,confirmed=True):
        current=host.status(self.run);host.authorize(self.run,current['scopeDigest'],'Offline scope fixture only')
        request=host.next_request(self.run);answer=fixtures.HostReviewTests.response_doc(self)
        answer['backgroundRegionAudit']=dict(regionDigest=self.region_plan['digest'],materialId='asset-scene',
            scopeCoverageConfirmed=confirmed,noObviousProtectedUI=True,backgroundOwnershipConfirmed=True,
            evidence='Independent offline source, masks and preview show permitted scope and protected source points.')
        if hasattr(self,'reuse_doc'):
            answer['reuseAudit']=[dict(prototypeMaterialId='asset-coin-a',instanceMaterialIds=['asset-coin-b'],
                equivalent=True,evidence='Independent same-state badge fixture comparison.')]
        save(self.response,answer);self.prepared={'requestSha256':request['requestSha256']}
        fixtures.HostReviewTests.write_attestation(self)
        return host.receive(self.run,request['submissionDigest'],self.response,host_attestation=self.attestation,
            dispatch_evidence=self.dispatch,return_evidence=self.response)

    def test_complete_flow_raw_candidate_review_body_identity_package(self):
        original_new=Image.new
        def fixture_new(mode,size,*args,**kwargs):
            # Existing integrated fixture supplies a small background by default.
            # Opt-in fixture supplies its independently declared exact source canvas.
            if mode=='RGB' and size==(240,240):size=(500,500)
            return original_new(mode,size,*args,**kwargs)
        with patch('PIL.Image.new',side_effect=fixture_new):
            HostDeliveryTests.test_complete_sheet_workflow_separate_scopes_and_delivered_comparison(self)
        frozen=self.run/'frozen';manifest=read(frozen/'snapshot.json');preflight(frozen,manifest['digest'])
        review=self.run/'reviews/asset-scene';verify_prepared(review)
        candidate=review/'protected-background/candidate.png';raw=self.run/'images/attempts/asset-scene/raw.png'
        self.assertNotEqual(digest(raw),digest(candidate))
        self.assertEqual((review/'protected-background/proposal.png').read_bytes(),raw.read_bytes())
        self.assertEqual((review/'review/native-proposal.png').read_bytes(),raw.read_bytes())
        bound=read(review/'background-region-binding.json')
        self.assertEqual(bound['rawSha256'],read(self.run/'images/attempts/asset-scene/received.json')['rawSha256'])
        extraction=read(self.run/'extraction/result.json');verify_extraction(self.run/'extraction')
        self.assertEqual(extraction['materials']['asset-scene'],str(candidate))
        composition=read(self.run/'delivery/package/composition.json')
        layer=next(l for l in composition['layers'] if l['id']=='asset-scene')
        final=self.run/'delivery/package'/layer['path']
        self.assertEqual(final.read_bytes(),candidate.read_bytes())
        pipeline.check_final(final,frozen,pipeline.snapshot_input(frozen,manifest))
        proof=next(r for r in read(self.run/'delivery/body-provenance.json')['records'] if r['materialId']=='asset-scene')['backgroundRegion']
        self.assertFalse(proof['maskCoverageProven']);self.assertEqual(proof['protectedChangedPixels'],0)
        self.assertNotIn('submissionDigest',proof);self.assertNotIn('jobDigest',proof)
        before=candidate.read_bytes();candidate.write_bytes(before+b'tampered')
        with self.assertRaises(ValueError):verify_prepared(review)
        candidate.write_bytes(before)

    def test_rejected_mask_scope_is_terminal_before_images(self):
        with self.assertRaisesRegex(ValueError,'MASK_SCOPE_REVIEW_NOT_CONFIRMED'):self.planning(False)
        self.assertEqual(host.status(self.run)['status'],'failed_no_retry')
        self.assertFalse((self.run/'images').exists())

    def test_generation_visual_references_and_supported_paths(self):
        self.planning();host.authorize(self.run,host.status(self.run)['scopeDigest'],'Offline image fixture only')
        request=host.next_request(self.run);self.assertEqual(request['asset'],'asset-scene')
        args=request['arguments'];self.assertTrue(any(p.endswith('edit-mask.png') for p in args['referenced_image_paths']))
        self.assertTrue(any(p.endswith('preview.png') for p in args['referenced_image_paths']))
        self.assertIn('no API inpainting mask',args['prompt'])
        transport=tool_arguments(request,False);self.assertIn('referenced_image_paths',transport)
        self.assertNotIn('num_last_images_to_include',transport)
        validate(dict(kind=TRANSPORT,submissionDigest=request['submissionDigest'],arguments=transport))

    def _reject_actual_raw(self,raw,reason):
        self.planning();host.authorize(self.run,host.status(self.run)['scopeDigest'],'Offline fixture only')
        request=host.next_request(self.run);self.assertEqual(request['asset'],'asset-scene')
        with self.assertRaisesRegex(ValueError,reason):host.receive(self.run,request['submissionDigest'],raw)
        self.assertEqual(host.status(self.run)['status'],'failed_no_retry')
        self.assertFalse((self.run/'reviews').exists())
        with self.assertRaisesRegex(ValueError,'NO_NEXT'):host.next_request(self.run)
        rejected=self.run/'images/attempts/asset-scene/rejected-raw.png'
        self.assertEqual(rejected.read_bytes(),raw.read_bytes())
        failure=read(self.run/'images/attempts/asset-scene/failed.json')
        self.assertEqual(failure['rejectedRawSha256'],digest(raw))
        self.assertFalse((self.run/'images/attempts/asset-scene/received.json').exists())

    def test_wrong_size_is_immediately_terminal_and_actual_raw_retained(self):
        raw=self.base/'wrong-size.png';Image.new('RGB',(240,240),(40,50,60)).save(raw)
        self._reject_actual_raw(raw,'CANVAS_MISMATCH')

    def test_wrong_profile_is_immediately_terminal_and_actual_raw_retained(self):
        raw=self.base/'wrong-profile.png';profile=PngImagePlugin.PngInfo();profile.add(b'sRGB',b'\x00')
        Image.new('RGB',(500,500),(40,50,60)).save(raw,pnginfo=profile)
        self._reject_actual_raw(raw,'COLOR_PROFILE_MISMATCH')

    def test_input_mask_and_source_binding_tamper_blocked(self):
        original=(self.run/'planning/.dag/inputs/background-region-edit-mask.png').read_bytes()
        (self.run/'planning/.dag/inputs/background-region-edit-mask.png').write_bytes(original+b'tampered')
        with self.assertRaises(ValueError):host.status(self.run)
        other=self.base/'other.png';Image.new('RGB',(1000,1000),(0,0,0)).save(other)
        with self.assertRaisesRegex(ValueError,'SOURCE_OR_SCOPE'):
            pipeline._validate(self.region_plan,self.plan,digest(other))

class CombinedProtectedReuseTests(unittest.TestCase):
    def setUp(self):
        ProtectedHostDeliveryTests.setUp(self)
        for obj in self.plan['objects']:
            if obj['materialId'] in ('asset-coin-a','asset-coin-b'):
                obj['kind']='badge';obj['bboxNorm']=None
        fixtures.save(self.candidate,self.plan)
        from ai_ui_layers import material_reuse
        self.reuse_doc=dict(kind=material_reuse.KIND,referenceSha256=digest(self.reference),sourcePlanSha256=digest(self.candidate),
            groups=[dict(prototypeMaterialId='asset-coin-a',instanceMaterialIds=['asset-coin-b'],evidence='Explicit fixture same-state reuse.')])
        path=self.base/'combined-reuse.json';save(path,self.reuse_doc)
        config=read(self.config_path);config['materialReuse']=str(path);fixtures.save(self.config_path,config)
        self.run=self.base/'combined-integrated';host.prepare(self.config_path,self.run);self.root=self.run/'planning'

    def planning(self):return ProtectedHostDeliveryTests.planning(self)

    def test_combined_reuse_and_region_full_workflow(self):
        ProtectedHostDeliveryTests.test_complete_flow_raw_candidate_review_body_identity_package(self)
        extraction=read(self.run/'extraction/result.json')
        self.assertEqual(digest(Path(extraction['materials']['asset-coin-a'])),digest(Path(extraction['materials']['asset-coin-b'])))
        manifest=read(self.run/'frozen/snapshot.json')
        self.assertIn('backgroundRegionDigest',manifest);self.assertIn('materialReuseSha256',manifest)
        self.assertEqual(manifest['generatedMaterialCount'],len(self.plan['materials'])-1)


class BackgroundSnapshotMetadataTests(unittest.TestCase):
    def test_absent_optional_region_leaves_partial_unit_manifest_unchanged(self):
        with tempfile.TemporaryDirectory() as temporary:
            self.assertIsNone(pipeline.snapshot_input(temporary,{'digest':'fixture-only'}))

    def test_unbound_physical_region_cannot_be_ignored_as_default(self):
        with tempfile.TemporaryDirectory() as temporary:
            (Path(temporary)/'background-region').mkdir()
            with self.assertRaisesRegex(ValueError,'SNAPSHOT_METADATA'):
                pipeline.snapshot_input(temporary,{'files':{}})


if __name__=='__main__':unittest.main()
