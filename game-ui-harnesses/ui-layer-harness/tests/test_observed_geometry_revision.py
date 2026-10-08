"""Offline package and geometry fixtures, no provider or model calls."""
import _bootstrap
from copy import deepcopy
import json
from pathlib import Path
import tempfile
import unittest
import zipfile

import numpy as np
from PIL import Image, ImageDraw
from ai_ui_layers import observed_geometry_revision as revision
from ai_ui_layers import host_geometry_observation as observation
from ai_ui_layers.evaluate import digest,read,save
from ai_ui_layers.layer_package import write_package,validate_archive,composite


def answer(mid='body',boundary='complete',target=None):
    return dict(kind='ui_host_geometry_answer_v1',layerId=mid,boundaryStatus=boundary,
        sourceBodyBox=[10,10,30,30] if boundary=='complete' else None,
        targetBodyBox=(target or [40,40,60,60]) if boundary=='complete' else None,
        landmarkPairs=[],geometryIssues=[],materialIssues=['Fixture style mismatch remains.'],
        evidence='Fixture actual visible shape correspondence.')


class ObservedGeometryTests(unittest.TestCase):
    def setUp(self):
        self.temporary=tempfile.TemporaryDirectory();self.addCleanup(self.temporary.cleanup)
        self.root=Path(self.temporary.name);self.viewer=self.root/'viewer';self.viewer.mkdir()
        for name in ('viewer.html','viewer.js'):(self.viewer/name).write_text('fixture',encoding='utf-8')
        self.source=self.root/'source.png';image=Image.new('RGBA',(40,40))
        ImageDraw.Draw(image).rectangle((10,10,29,29),fill=(40,60,90,255))
        image.putpixel((2,2),(50,80,90,1));image.save(self.source)
        self.reference=self.root/'reference.png';Image.new('RGBA',(100,100)).save(self.reference)
        self.layer=dict(id='body',name='Body',role='foreground',path='layers/layer-001.png',
                        x=20,y=20,width=40,height=40,visible=True)
        composition=dict(kind='ui_layer_composition_v1',canvas=dict(width=100,height=100),
            coordinates='top-left-pixels',order='array-back-to-front',textPolicy='remove-business-text',
            backgroundMode='scene-only',reference='reference.png',preview='preview.png',layers=[self.layer])
        self.original=self.root/'original'
        write_package(self.reference,composition,{'body':dict(path=str(self.source),sha256=digest(self.source))},
                      self.original,self.viewer,['Old blocked body proof stays unresolved.'])
        self.archive=self.original/'ui-layers.zip';self.batch=self.root/'batch'
        observation.prepare(self.archive,self.batch,observation_policy=observation.POLICY);self.item=self.batch/'items/000'

    def receive(self,value):
        response=self.root/'response.json';save(response,value)
        dispatch=self.root/'dispatch.bin';dispatch.write_bytes(b'fixture dispatch')
        returned=self.root/'return.bin';returned.write_bytes(b'fixture actual return')
        request=read(self.item/'request.json');attestation=self.root/'attestation.json'
        save(attestation,dict(kind='ui_host_geometry_attestation_v1',requestSha256=digest(self.item/'request.json'),
            responseSha256=digest(response),inputsSha256=request['inputsSha256'],reviewerId='fixture-reviewer',
            materialAuthors=['fixture-author'],hostAssertedModelResponse=True,notProviderReceipt=True,
            notCryptographicallyPlatformVerified=True,dispatchEvidenceSha256=digest(dispatch),
            returnEvidenceSha256=digest(returned)))
        observation.receive(self.item,response,host_attestation_path=attestation,
            dispatch_evidence_path=dispatch,return_evidence_path=returned)

    def freeze(self):
        selection=self.root/'selection.json'
        save(selection,dict(kind=revision.KIND,sourceArchive=str(self.archive),sourceArchiveSha256=digest(self.archive),
            fitPolicy=dict(maximumResidualPixels=10),observations=[dict(layerId='body',directory=str(self.item),
                requestSha256=digest(self.item/'request.json'),resultSha256=digest(self.item/'result.json'))]))
        frozen=self.root/'frozen';return frozen,revision.freeze(selection,frozen)

    def test_faint_alpha_is_storage_not_fit_and_zero_hidden_rgb(self):
        geometry=revision.fit(answer(),0);self.assertEqual(geometry['uniformScale'],1)
        self.assertEqual(geometry['translation'],[30,30])
        rendered,report=revision.transform(self.source,geometry,(100,100),self.layer)
        self.assertEqual(report['sourceFullAlphaBox'],[2,2,30,30])
        self.assertEqual(report['layerCanvasRegion'],[32,32,60,60])
        self.assertEqual(rendered.getpixel((0,0))[3],1)
        pixels=np.array(rendered);self.assertFalse(np.any(pixels[pixels[:,:,3]==0,:3]))

    def test_landmarks_do_not_infer_body_and_no_rotation(self):
        value=answer(boundary='visible-landmarks')
        value['landmarkPairs']=[dict(id=str(i),source=s,target=[2*s[0]+5,2*s[1]+7],evidence='actual visible fixture point')
                                for i,s in enumerate([[10,10],[30,10],[10,30],[20,20]])]
        geometry=revision.fit(value,0)
        self.assertEqual(geometry['uniformScale'],2);self.assertEqual(geometry['translation'],[5,7])
        self.assertFalse(geometry['hiddenBoundaryInference'])
        value['landmarkPairs'][0]['target'][0]+=9
        with self.assertRaisesRegex(ValueError,'RESIDUAL'):revision.fit(value,1)

    def test_nonfinite_malformed_and_axis_mismatch(self):
        value=answer();value['sourceBodyBox'][0]=float('nan')
        with self.assertRaisesRegex(ValueError,'FINITE'):revision.fit(value,10)
        value=answer();value['sourceBodyBox']=[1,2,3]
        with self.assertRaises(ValueError):revision.fit(value,10)
        with self.assertRaisesRegex(ValueError,'FINITE'):revision.fit(answer(),float('inf'))
        value=answer(target=[40,40,80,60])
        geometry=revision.fit(value,10);self.assertEqual(geometry['uniformScale'],1.5)
        self.assertGreater(max(geometry['residualPixels']),0)
        with self.assertRaisesRegex(ValueError,'RESIDUAL'):revision.fit(value,1)

    def test_support_outside_canvas_not_translated_or_clipped(self):
        geometry=revision.fit(answer(target=[1,1,21,21]),0)
        with self.assertRaisesRegex(ValueError,'SUPPORT_OUTSIDE_CANVAS'):
            revision.transform(self.source,geometry,(100,100),self.layer)
        self.receive(answer(target=[1,1,21,21]));frozen,config=self.freeze()
        result=revision.revise(frozen,config['digest'],self.root/'out',self.viewer)
        self.assertEqual(result['records'][0]['status'],'unchanged')
        self.assertIn('SUPPORT_OUTSIDE_CANVAS',result['records'][0]['reason'])

    def test_unresolved_unchanged_and_material_issues_preserved(self):
        value=answer(boundary='uncertain');self.receive(value);frozen,config=self.freeze()
        result=revision.revise(frozen,config['digest'],self.root/'out',self.viewer)
        self.assertEqual(result['records'][0]['reason'],'unresolved-observed-geometry')
        self.assertEqual(result['records'][0]['assessment']['geometryIssues'],[])
        self.assertEqual(result['records'][0]['assessment']['materialIssues'],value['materialIssues'])
        with zipfile.ZipFile(self.root/'out/delivery/ui-layers.zip') as z:
            self.assertEqual(z.read(self.layer['path']),self.source.read_bytes())
            self.assertEqual(json.loads(z.read('composition.json'))['layers'][0],self.layer)

    def test_identity_keeps_png_bytes_and_package_replay_is_exact(self):
        self.receive(answer(target=[30,30,50,50]));frozen,config=self.freeze()
        result=revision.revise(frozen,config['digest'],self.root/'out',self.viewer)
        revision.revise(frozen,config['digest'],self.root/'out2',self.viewer)
        self.assertEqual(result['records'][0]['reason'],'exact-identity-fit')
        self.assertEqual((self.root/'out/delivery/ui-layers.zip').read_bytes(),(self.root/'out2/delivery/ui-layers.zip').read_bytes())
        self.assertEqual((self.root/'out/delivery/package'/self.layer['path']).read_bytes(),self.source.read_bytes())

    def test_changed_package_pixel_composition_replay_and_strict_false(self):
        self.receive(answer());frozen,config=self.freeze();out=self.root/'out'
        result=revision.revise(frozen,config['digest'],out,self.viewer)
        revision.revise(frozen,config['digest'],self.root/'out2',self.viewer)
        self.assertEqual((out/'delivery/ui-layers.zip').read_bytes(),(self.root/'out2/delivery/ui-layers.zip').read_bytes())
        validate_archive(out/'delivery/ui-layers.zip');folder=out/'delivery/package'
        with Image.open(folder/'preview.png') as preview:
            self.assertEqual(preview.tobytes(),composite(folder,read(folder/'composition.json')).tobytes())
        for field in ('strictBodyRegistrationPassed','humanVisualAcceptance','fullAutomaticDagPassed','originalDagPromoted'):
            self.assertFalse(result[field])
        self.assertIn('Old blocked body proof stays unresolved.',read(folder/'review.json')['issues'])
        self.assertEqual(read(out/'revision-provenance.json')['sourceManifest'],read(self.original/'package/manifest.json'))

    def test_evidence_replay_after_freeze_is_rejected(self):
        self.receive(answer());frozen,config=self.freeze()
        (self.item/'answer/response.json').write_bytes((self.item/'answer/response.json').read_bytes()+b' ')
        with self.assertRaisesRegex(ValueError,'FROZEN_EVIDENCE_TREE_CHANGED'):
            revision.revise(frozen,config['digest'],self.root/'out',self.viewer)
        self.assertFalse((self.root/'out').exists())

    def test_rgb_foreground_and_whole_background_contain_edgepad(self):
        source=self.root/'rgb.png';Image.new('RGB',(40,20),(20,60,90)).save(source)
        original_bytes=source.read_bytes()
        observed=answer(target=[30,40,70,60]);observed['sourceBodyBox']=[0,0,40,20]
        image,geometry=revision.transform(source,revision.fit(observed,0),(100,100),self.layer)
        self.assertEqual(image.mode,'RGBA');self.assertEqual(geometry['originalMode'],'RGB')
        background=dict(self.layer,role='background',x=0,y=0,width=100,height=100)
        observed['sourceBodyBox']=[0,0,40,20];observed['targetBodyBox']=[0,0,100,100]
        image,geometry=revision.background_transform(source,observed,(100,100),background)
        self.assertEqual(image.getchannel('A').getextrema(),(255,255))
        self.assertEqual(geometry['uniformScale'],2.5)
        self.assertEqual(geometry['backgroundEdgePadding'],[0,25,0,25])
        self.assertTrue(geometry['canvasAspectMismatch']);self.assertFalse(geometry['axisStretch'])
        self.assertEqual(source.read_bytes(),original_bytes)
        observed['sourceBodyBox']=[1,0,40,20]
        with self.assertRaisesRegex(ValueError,'OBSERVED_WHOLE_CANVAS'):
            revision.background_transform(source,observed,(100,100),background)

    def test_verified_edit_source_override_is_packaged_and_replayed(self):
        from ai_ui_layers import archive_material_edit as edit
        job=self.root/'edit';config=edit.freeze(self.archive,'body',job,purpose='Fixture child deletion',
            owned=['Fixture body'],delete=['Fixture duplicated child'])
        edit.authorize(job,config['digest'],'Offline fixture compute authorization')
        submitted=edit.next_request(job)
        raw=self.root/'edited.png';image=Image.new('RGBA',(40,40))
        ImageDraw.Draw(image).rectangle((10,10,29,29),fill=(140,80,10,255));image.save(raw)
        native=self.root/'native.json';save(native,dict(kind='ui_native_material_edit_return_v1',
            submissionDigest=submitted['submissionDigest'],returnedSha256=digest(raw),
            hostObservedNativeReturn=True,notCryptographicallyProviderVerified=True))
        edit.receive(job,submitted['submissionDigest'],raw,native)
        self.batch=self.root/'edited-batch';observation.prepare(self.archive,self.batch,
            observation_policy=observation.POLICY,source_overrides={'body':job})
        self.item=self.batch/'items/000';self.receive(answer(target=[30,30,50,50]))
        frozen,config=self.freeze();out=self.root/'edited-out'
        result=revision.revise(frozen,config['digest'],out,self.viewer)
        self.assertEqual(result['records'][0]['status'],'geometry-candidate')
        self.assertFalse(result['records'][0]['geometry']['byteIdentity'])
        self.assertEqual(result['records'][0]['sourceEvidence']['sourceOverride']['binding']['rawSha256'],digest(raw))
        folder=out/'delivery/package'
        self.assertNotEqual((folder/self.layer['path']).read_bytes(),self.source.read_bytes())
        with Image.open(folder/'preview.png') as preview:self.assertEqual(preview.getpixel((35,35)),(140,80,10,255))
        revision.revise(frozen,config['digest'],self.root/'edited-out2',self.viewer)
        self.assertEqual((out/'delivery/ui-layers.zip').read_bytes(),(self.root/'edited-out2/delivery/ui-layers.zip').read_bytes())
        (job/'raw.png').write_bytes((job/'raw.png').read_bytes()+b' ')
        with self.assertRaises(ValueError):revision.revise(frozen,config['digest'],self.root/'tampered-edit',self.viewer)


if __name__=='__main__':unittest.main()
