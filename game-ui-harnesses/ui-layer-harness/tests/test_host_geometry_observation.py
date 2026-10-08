import _bootstrap
import copy
from pathlib import Path
import tempfile
import unittest

from PIL import Image
from ai_ui_layers.evaluate import save, read, digest
from ai_ui_layers.layer_package import write_package
from ai_ui_layers import host_geometry_observation as geometry
from ai_ui_layers import observed_geometry_revision as revision


class HostGeometryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        ref = self.root/'reference.png'; Image.new('RGBA',(32,32),(25,35,45,255)).save(ref)
        source = self.root/'material.png'; Image.new('RGBA',(16,16),(30,60,90,128)).save(source)
        viewer = self.root/'viewer'; viewer.mkdir()
        (viewer/'viewer.html').write_text('<html></html>'); (viewer/'viewer.js').write_text('void 0;')
        composition = dict(kind='ui_layer_composition_v1',canvas=dict(width=32,height=32),
            coordinates='top-left-pixels',order='array-back-to-front',textPolicy='remove-business-text',
            backgroundMode='scene-only',reference='reference.png',preview='preview.png',
            layers=[dict(id='panel',name='Panel',role='foreground',path='layers/layer-001.png',
                         x=4,y=6,width=16,height=16,visible=True)])
        write_package(ref,composition,dict(panel=dict(path=str(source),sha256=digest(source))),
                      self.root/'package',viewer,['Offline test fixture'])
        self.archive = self.root/'package/ui-layers.zip'
        geometry.prepare(self.archive,self.root/'observation')
        self.item = self.root/'observation/items/000'
        self.request = geometry.verify_prepared(self.item)
        self.answer = dict(kind='ui_host_geometry_answer_v2',layerId='panel',boundaryStatus='complete',
            sourceBodyBox=[2,2,14,14],targetBodyBox=[6,8,18,20],landmarkPairs=[],
            geometryIssues=[],geometryDifferences=[],materialIssues=[],evidence='Visible corners on both frozen fixture PNGs.')

    def receive(self, answer=None, change=None):
        response=self.root/'response.json';save(response,answer or self.answer)
        dispatch=self.root/'dispatch';dispatch.write_bytes(b'offline dispatch fixture')
        returned=self.root/'return';returned.write_bytes(b'offline return fixture')
        attestation=dict(kind='ui_host_geometry_attestation_v1',requestSha256=digest(self.item/'request.json'),
            responseSha256=digest(response),inputsSha256=self.request['inputsSha256'],
            reviewerId='fixture-reviewer',materialAuthors=['fixture-author'],hostAssertedModelResponse=True,
            notProviderReceipt=True,notCryptographicallyPlatformVerified=True,
            dispatchEvidenceSha256=digest(dispatch),returnEvidenceSha256=digest(returned))
        if change:attestation.update(change)
        att=self.root/'attestation.json';save(att,attestation)
        return geometry.receive(self.item,response,host_attestation_path=att,
            dispatch_evidence_path=dispatch,return_evidence_path=returned)

    def test_material_issues_retained_and_geometry_usable(self):
        self.answer['materialIssues']=['Wrong wood texture remains unresolved.']
        result=self.receive()
        self.assertEqual(result['status'],'geometry_usable_candidate')
        self.assertEqual(result['materialIssues'],self.answer['materialIssues'])
        self.assertFalse(result['strictBodyRegistrationPassed'])
        request,answer,source,reference=geometry.verify_response(self.item)
        self.assertEqual(digest(source),request['sourceSha256'])
        self.assertEqual(digest(reference),request['referenceSha256'])
        self.assertEqual(answer,self.answer)
        with self.assertRaises(FileExistsError):self.receive()

    def test_geometry_issue_blocks_and_uncertain_cannot_fabricate_box(self):
        answer=copy.deepcopy(self.answer);answer['geometryIssues']=['Boundary ambiguous.']
        self.assertEqual(geometry.assess(self.request,answer)['status'],'unresolved')
        for state in ['uncertain','not-whole','visible-landmarks']:
            answer=copy.deepcopy(self.answer);answer['boundaryStatus']=state
            with self.assertRaisesRegex(ValueError,'NULL_PARTIAL'):geometry.assess(self.request,answer)
        answer.update(sourceBodyBox=None,targetBodyBox=None,boundaryStatus='uncertain')
        self.assertEqual(geometry.assess(self.request,answer)['status'],'unresolved')

    def test_visible_landmarks_need_separated_noncollinear_points(self):
        answer=copy.deepcopy(self.answer)
        answer.update(boundaryStatus='visible-landmarks',sourceBodyBox=None,targetBodyBox=None)
        points=[(2,2),(12,2),(2,12)]
        answer['landmarkPairs']=[dict(id=str(i),source=list(p),target=[p[0]+4,p[1]+6],
                                     evidence='Actual visible fixture corner.') for i,p in enumerate(points)]
        self.assertTrue(geometry.assess(self.request,answer)['geometryUsableCandidate'])
        for changed in [answer['landmarkPairs'][:2],
                        [dict(p,source=[i+1,i+1]) for i,p in enumerate(answer['landmarkPairs'])],
                        [dict(p,target=[i+1,i+1]) for i,p in enumerate(answer['landmarkPairs'])]]:
            invalid=dict(answer,landmarkPairs=changed)
            with self.assertRaisesRegex(ValueError,'NONCOLLINEAR'):geometry.assess(self.request,invalid)

    def test_nan_infinite_out_of_bounds_and_unknown_id_rejected(self):
        for value in [float('nan'),float('inf'),-1,17,True]:
            answer=copy.deepcopy(self.answer);answer['sourceBodyBox'][0]=value
            with self.assertRaises(Exception):geometry.assess(self.request,answer)
        answer=dict(self.answer,layerId='missing')
        with self.assertRaisesRegex(ValueError,'LAYER_ID'):geometry.assess(self.request,answer)
        for ids in [[],['missing'],['panel','panel']]:
            with self.assertRaisesRegex(ValueError,'MATERIAL_IDS'):
                geometry.prepare(self.archive,self.root/'invalid',ids)

    def test_source_archive_and_frozen_input_changes_rejected(self):
        path=self.item/'source.png'; original=path.read_bytes();path.write_bytes(b'changed')
        with self.assertRaisesRegex(ValueError,'INPUT_CHANGED'):geometry.verify_prepared(self.item)
        path.write_bytes(original)
        self.archive.write_bytes(self.archive.read_bytes()+b'changed archive identity')
        with self.assertRaisesRegex(ValueError,'SOURCE_ARCHIVE_CHANGED'):geometry.verify_prepared(self.item)

    def test_manifest_reference_and_return_changes_rejected(self):
        self.receive()
        for path in [self.item/'reference.png',self.item/'answer/return.bin',
                     self.root/'observation/source-package/manifest.json']:
            original=path.read_bytes();path.write_bytes(original+b'changed')
            with self.assertRaises(Exception):geometry.verify_response(self.item)
            path.write_bytes(original)
        geometry.verify_response(self.item)

    def test_host_hash_chain_and_independence_and_terminal_failure(self):
        with self.assertRaisesRegex(ValueError,'ATTESTATION_BINDING'):
            self.receive(change=dict(inputsSha256='0'*64))
        with self.assertRaises(FileExistsError):self.receive()
        self.assertFalse((self.item/'result.json').exists())

    def test_actual_alpha_previews_hide_invisible_rgb_and_preserve_native_bytes(self):
        raw=self.root/'hidden-rgb.png'
        image=Image.new('RGBA',(5,1),(190,100,45,0))
        for x,alpha in enumerate((0,1,128,254,255)):
            image.putpixel((x,0),(190,100,45,alpha))
        image.save(raw);native_sha=digest(raw)
        previews=geometry._source_previews(raw)
        for name,bg in [('source-over-light.png',240),('source-over-dark.png',32)]:
            preview=previews[name]
            self.assertEqual(preview.mode,'RGB');self.assertEqual(preview.size,(5,1))
            self.assertEqual(preview.getpixel((0,0)),(bg,bg,bg))
            self.assertEqual(preview.getpixel((4,0)),(190,100,45))
            self.assertEqual(preview.getpixel((2,0)),tuple((v*128+bg*127+127)//255 for v in (190,100,45)))
        self.assertEqual([previews['source-alpha.png'].getpixel((x,0))[0] for x in range(5)],
                         [0,1,128,254,255])
        self.assertEqual(digest(raw),native_sha)

    def test_default_v2_binds_opaque_previews_and_rejects_resealed_wrong_display(self):
        self.assertEqual(self.request['policy'],geometry.DEFAULT_POLICY)
        self.assertEqual(len(self.request['inputs']),7)
        self.assertIn('geometryDifferences',read(self.item/'schema.json')['required'])
        for name in ['source-over-light.png','source-over-dark.png','source-alpha.png']:
            with Image.open(self.item/name) as image:
                self.assertEqual(image.mode,'RGB');self.assertEqual(image.size,(16,16))
        # Even coherent hash rewriting cannot make an arbitrary picture a derived preview.
        path=self.item/'source-over-light.png'
        with Image.open(path) as image:changed=image.copy()
        changed.putpixel((0,0),(0,0,0));changed.save(path)
        request=read(self.item/'request.json');request['inputs'][path.name]=digest(path)
        request['inputsSha256']=geometry._canonical(request['inputs'])
        (self.item/'request.json').unlink();save(self.item/'request.json',request)
        (self.item/'preparation.json').unlink()
        save(self.item/'preparation.json',dict(requestSha256=digest(self.item/'request.json')))
        with self.assertRaisesRegex(ValueError,'ALPHA_PREVIEW_CHANGED'):
            geometry.verify_prepared(self.item)

    def test_measured_ratio_difference_reaches_fitter_and_residual_still_blocks(self):
        value=dict(self.answer,targetBodyBox=[6,8,18,18],
            geometryDifferences=['Visible target is shorter relative to its width.'],
            materialIssues=['Visible glow differs from reference.'])
        result=self.receive(value)
        self.assertTrue(result['geometryUsableCandidate'])
        self.assertEqual(result['geometryDifferences'],value['geometryDifferences'])
        self.assertEqual(result['materialIssues'],value['materialIssues'])
        self.assertFalse(result['strictBodyRegistrationPassed'])
        fit=revision.fit(value,1)
        self.assertFalse(fit['axisStretch']);self.assertGreater(max(fit['residualPixels']),0)
        with self.assertRaisesRegex(ValueError,'RESIDUAL_EXCEEDED'):revision.fit(value,.5)
        selection=self.root/'selection.json'
        save(selection,dict(kind=revision.KIND,sourceArchive=str(self.archive),sourceArchiveSha256=digest(self.archive),
            fitPolicy=dict(maximumResidualPixels=1),observations=[dict(layerId='panel',directory=str(self.item),
                requestSha256=digest(self.item/'request.json'),resultSha256=digest(self.item/'result.json'))]))
        frozen=self.root/'frozen';config=revision.freeze(selection,frozen)
        packaged=revision.revise(frozen,config['digest'],self.root/'revised',self.root/'viewer')
        record=packaged['records'][0]
        self.assertEqual(record['status'],'geometry-candidate')
        self.assertEqual(record['assessment']['geometryDifferences'],value['geometryDifferences'])
        self.assertEqual(record['assessment']['materialIssues'],value['materialIssues'])
        self.assertFalse(packaged['fullAutomaticDagPassed'])
        blocked=dict(value,geometryIssues=['The source boundary is ambiguous.'])
        self.assertFalse(geometry.assess(self.request,blocked)['geometryUsableCandidate'])

    def test_legacy_sealed_answer_keeps_old_gate_and_four_inputs(self):
        geometry.prepare(self.archive,self.root/'legacy',observation_policy=geometry.POLICY)
        self.item=self.root/'legacy/items/000';self.request=geometry.verify_prepared(self.item)
        self.assertEqual(len(self.request['inputs']),4)
        self.assertEqual((self.item/'prompt.md').read_text('utf-8'),geometry.PROMPT)
        self.assertEqual(read(self.item/'schema.json'),geometry.schema())
        value={k:v for k,v in self.answer.items() if k!='geometryDifferences'}
        value.update(kind='ui_host_geometry_answer_v1',geometryIssues=['Aspect ratio differs.'])
        result=self.receive(value)
        self.assertFalse(result['geometryUsableCandidate'])
        self.assertNotIn('geometryDifferences',result)
        self.assertEqual(geometry.verify_response(self.item)[1],value)


if __name__ == '__main__':unittest.main()
