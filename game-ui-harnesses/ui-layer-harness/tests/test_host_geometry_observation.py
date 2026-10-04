import _bootstrap
import copy
from pathlib import Path
import tempfile
import unittest

from PIL import Image
from ai_ui_layers.evaluate import save, read, digest
from ai_ui_layers.layer_package import write_package
from ai_ui_layers import host_geometry_observation as geometry


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
        self.answer = dict(kind='ui_host_geometry_answer_v1',layerId='panel',boundaryStatus='complete',
            sourceBodyBox=[2,2,14,14],targetBodyBox=[6,8,18,20],landmarkPairs=[],
            geometryIssues=[],materialIssues=[],evidence='Visible corners on both frozen fixture PNGs.')

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


if __name__ == '__main__':unittest.main()
