"""Real receipt/review/ZIP replay using offline fixtures only."""
import _bootstrap
import json
from pathlib import Path
import shutil
import unittest

from PIL import Image
from ai_ui_layers import experimental_executor as ex, material_cleanup as cleanup
from ai_ui_layers import host_material_review as host, layout_registration_revision as revision
from ai_ui_layers import viewport_geometry_revision as viewport
from ai_ui_layers.evaluate import read, save, digest
from ai_ui_layers.freeze_visual import freeze
from ai_ui_layers.layer_package import write_package
import test_material_cleanup as fixtures
import test_host_material_review as reviews


class SheetCleanupDeliveryTests(unittest.TestCase):
    setUp=fixtures.MaterialCleanupTests.setUp
    make_source=fixtures.MaterialCleanupTests.make_source
    response=reviews.HostEvidence.response

    def archive(self, mid, cell, native_sha, folder):
        background=self.root/(folder.name+'-background.png')
        with Image.open(self.reference) as image:w,h=image.size;image.convert('RGBA').save(background)
        with Image.open(cell) as image:cw,ch=image.size
        composition=dict(kind='ui_layer_composition_v1',canvas=dict(width=w,height=h),
            coordinates='top-left-pixels',order='array-back-to-front',textPolicy='remove-business-text',
            backgroundMode='scene-only',reference='reference.png',preview='preview.png',layers=[
                dict(id='background',name='Background',role='background',path='layers/layer-001.png',
                    x=0,y=0,width=w,height=h,visible=True),
                dict(id=mid,name='Owned cell',role='foreground',path='layers/layer-002.png',
                    x=0,y=0,width=cw,height=ch,visible=True)])
        write_package(self.reference,composition,dict(background=dict(path=str(background),sha256=digest(background)),
            **{mid:dict(path=str(cell),sha256=digest(cell))}),folder,self.viewer,
            ['Placement diagnosis: '+json.dumps(dict(materialId=mid,sourceSha256=native_sha))])
        shutil.copyfile(self.reference,folder/'original-reference.png')
        shutil.copyfile(folder/'package/preview.png',folder/'viewport-preview.png')
        save(folder/'viewport.json',dict(kind='ui_original_viewport_v1',policy=viewport.POLICY,
            originalSize=[w,h],worldSize=[w,h],worldShift=[0,0],worldViewportBox=[0,0,w,h],
            originalReferenceSha256=digest(self.reference)))
        viewport._wrapper(folder)
        return folder/'viewport-ui-layers.zip'

    def test_reviewed_sheet_member_replacement_matches_cell_not_whole_sheet(self):
        snapshot=self.root/'sheets';frozen=freeze(self.run,snapshot,5,generation_mode='sheets')
        self.reference=snapshot/'reference.png'
        row=next(r for r in read(snapshot/'requests.json')['requests'] if r.get('kind')=='sheet')
        mid=row['materialIds'][0];source=self.root/'received-sheet'
        self.make_source(snapshot,frozen['digest'],source,row['asset'])
        job=self.root/'cell-edit';config=cleanup.prepare_cleanup(snapshot,frozen['digest'],job,mid,source,row['asset'],
            source_cell_policy=cleanup.PREPARED_CELL_POLICY)
        cell=job/'cleanup/cleanup-source.png'
        ex.authorize(job,config['digest'],'offline edit fixture only')
        request=ex.next_request(job);ex.receive(job,request['submissionDigest'],cell)
        review=self.root/'edit-review'
        host.prepare(job,mid,review,material_authors=['fixture-generator'],review_registry=self.root/'registry')
        host.receive(**self.response(review));host.verify_run(review)
        self.viewer=self.root/'viewer';self.viewer.mkdir()
        for name in ('viewer.html','viewer.js'):(self.viewer/name).write_text('fixture',encoding='utf-8')
        wrong=self.archive(mid,cell,digest(source/'attempts'/row['asset']/'raw.png'),self.root/'wrong-parent')
        spec=dict(kind=revision.KIND,policy=revision.POLICY,sourceArchive=str(wrong),sourceArchiveSha256=digest(wrong),
            originalReferenceSha256=digest(self.reference),constraints=[],knownDifferences=['Fixture only.'],
            materials=[dict(materialId=mid,mode='uniform',targetBox=[100,100,220,180],measurementAlphaThreshold=128,
                receivedReplacement=dict(jobDirectory=str(job),jobDigest=config['digest'],reviewDirectory=str(review),
                    reviewRequestSha256=digest(review/'request.json'),reviewResultSha256=digest(review/'result.json')))])
        plan=self.root/'replacement.json';save(plan,spec)
        with self.assertRaisesRegex(ValueError,'NATIVE_LINEAGE_MISMATCH'):
            revision.revise(plan,self.root/'wrong-output',self.viewer)
        self.assertFalse((self.root/'wrong-output').exists())
        correct=self.archive(mid,cell,digest(cell),self.root/'correct-parent')
        spec.update(sourceArchive=str(correct),sourceArchiveSha256=digest(correct))
        plan.unlink();save(plan,spec)
        result=revision.revise(plan,self.root/'candidate',self.viewer)
        records={r['materialId']:r for r in result['records']}
        self.assertTrue(records['background']['byteIdentity'])
        replacement=records[mid]['receivedReplacement']
        self.assertEqual(replacement['sourceNativeSha256'],digest(cell))
        self.assertEqual(replacement['sourceRequestId'],row['asset'])
        self.assertEqual(replacement['sourceSheetSha256'],digest(source/'attempts'/row['asset']/'raw.png'))
        self.assertFalse(result['humanVisualAcceptance']);self.assertEqual(result['generationCalls'],0)


if __name__=='__main__':unittest.main()
