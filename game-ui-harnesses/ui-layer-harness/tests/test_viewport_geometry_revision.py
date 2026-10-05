import _bootstrap
import json
from pathlib import Path
import unittest
import zipfile
from PIL import Image
from ai_ui_layers.evaluate import read,save,digest
from ai_ui_layers.layer_package import write_package,validate_archive,composite
from ai_ui_layers import host_geometry_observation as observation
from ai_ui_layers import viewport_geometry_revision as viewport
from ai_ui_layers import archive_material_edit as edit
from test_host_geometry_observation import HostGeometryTests


class ViewportRevisionTests(unittest.TestCase):
    def setUp(self):
        HostGeometryTests.setUp(self)
        raw=self.root/'faint.png';image=Image.new('RGBA',(16,16))
        image.paste((30,60,90,255),(8,2,14,14));image.putpixel((0,0),(20,30,40,1));image.save(raw)
        composition=read(self.root/'package/package/composition.json')
        write_package(self.root/'reference.png',composition,dict(panel=dict(path=str(raw),sha256=digest(raw))),
                      self.root/'faint-package',self.root/'viewer',[])
        self.archive=self.root/'faint-package/ui-layers.zip'
        prepared=observation.prepare(self.archive,self.root/'faint-observation')
        self.item=self.root/'faint-observation'/prepared['items'][0]['directory']
        self.request=observation.verify_prepared(self.item)
        self.answer.update(sourceBodyBox=[8,2,14,14],targetBodyBox=[0,2,6,14])
        HostGeometryTests.receive(self)
        self.selection=self.root/'selection.json'
        save(self.selection,dict(kind='ui_observed_geometry_revision_v1',sourceArchive=str(self.archive),
            sourceArchiveSha256=digest(self.archive),fitPolicy=dict(maximumResidualPixels=32),
            observations=[dict(layerId='panel',directory=str(self.item),requestSha256=digest(self.item/'request.json'),
                               resultSha256=digest(self.item/'result.json'))]))

    def export(self):
        frozen=self.root/'frozen';config=viewport.freeze(self.selection,frozen,
            'Fixture user approves expanded-support-original-viewport-v1 for the displayed proposal.')
        return viewport.revise(frozen,config['digest'],self.root/'revised',self.root/'viewer')

    def test_draft_no_zip_and_unapproved_cannot_export(self):
        result=viewport.draft(self.selection,self.root/'draft',self.root/'viewer')
        self.assertEqual(result['status'],'unapproved-policy-proposal')
        self.assertFalse(result['approved'])
        self.assertEqual(list((self.root/'draft').rglob('*.zip')),[])
        self.assertEqual(result['viewport']['worldBoundsInOriginalCoordinates'],[-8,0,32,32])
        with self.assertRaisesRegex(ValueError,'ACTUAL_USER_POLICY'):
            viewport.freeze(self.selection,self.root/'invalid','')
        with self.assertRaises(FileNotFoundError):
            viewport.revise(self.root/'draft',result['proposalDigest'],self.root/'invalid',self.root/'viewer')

    def test_alpha_one_outside_original_viewport_is_preserved_and_no_clamp(self):
        result=self.export();delivery=self.root/'revised/delivery';composition=read(delivery/'package/composition.json')
        layer=composition['layers'][0]
        with Image.open(delivery/'package'/layer['path']) as image:
            self.assertEqual(image.getpixel((0,0))[3],1)
        geometry=result['records'][0]['geometry']
        self.assertEqual(geometry['uniformScale'],1)
        self.assertEqual(geometry['translation'],[-8,0])
        self.assertFalse(geometry['axisStretch']);self.assertFalse(geometry['implicitClamp'])
        self.assertFalse(geometry['alphaSupportClipped'])
        self.assertEqual(result['viewport']['worldShift'],[8,0])
        self.assertEqual(digest(delivery/'original-reference.png'),self.request['referenceSha256'])
        self.assertEqual(digest(self.item/'source.png'),self.request['sourceSha256'])

    def test_viewport_pixel_slice_wrapper_crc_and_recomposition(self):
        result=self.export();delivery=self.root/'revised/delivery';composition=read(delivery/'package/composition.json')
        world=composite(delivery/'package',composition)
        with Image.open(delivery/'viewport-preview.png') as image:
            self.assertEqual(image.size,(32,32));self.assertEqual(image.tobytes(),world.crop([8,0,40,32]).tobytes())
        inner=validate_archive(delivery/'ui-layers.zip')
        wrapper=viewport.validate_viewport_archive(delivery/'viewport-ui-layers.zip')
        self.assertEqual(inner['sha256'],wrapper['innerPackageSha256'])
        self.assertEqual(result['viewportArchiveSha256'],wrapper['sha256'])
        with zipfile.ZipFile(delivery/'viewport-ui-layers.zip') as z:
            self.assertIsNone(z.testzip());self.assertEqual(set(z.namelist()),viewport.WRAPPER_FILES)
            self.assertEqual(z.read('world-ui-layers.zip'),(delivery/'ui-layers.zip').read_bytes())
        with zipfile.ZipFile(delivery/'viewport-ui-layers.zip') as source,zipfile.ZipFile(self.root/'tampered.zip','w') as target:
            for name in source.namelist():target.writestr(name,b'changed' if name=='viewport-preview.png' else source.read(name))
        with self.assertRaisesRegex(ValueError,'CHECKSUM'):viewport.validate_viewport_archive(self.root/'tampered.zip')

    def test_approval_and_sealed_source_changes_rejected(self):
        config=viewport.freeze(self.selection,self.root/'frozen','Fixture explicit policy approval')
        authorization=self.root/'frozen/policy-authorization.json'
        original=authorization.read_bytes();authorization.write_bytes(original+b' ')
        with self.assertRaisesRegex(ValueError,'CONTRACT_CHANGED'):
            viewport.revise(self.root/'frozen',config['digest'],self.root/'bad',self.root/'viewer')
        authorization.write_bytes(original)
        path=self.item/'source.png';path.write_bytes(path.read_bytes()+b' ')
        with self.assertRaisesRegex(ValueError,'EVIDENCE_TREE_CHANGED'):
            viewport.revise(self.root/'frozen',config['digest'],self.root/'bad',self.root/'viewer')

    def test_native_edit_source_override_requires_real_bound_chain(self):
        job=self.root/'edit';frozen=edit.freeze(self.archive,'panel',job,purpose='Fixture delete child',
            owned=['base texture'],delete=['complete child frames'])
        edit.authorize(job,frozen['digest'],'Fixture user authorizes native edit')
        submission=edit.next_request(job)
        raw=self.root/'edited.png';image=Image.new('RGBA',(18,20))
        image.paste((30,60,90,255),(10,4,16,16));image.putpixel((2,2),(30,40,50,1));image.save(raw)
        evidence=self.root/'native-evidence.json';save(evidence,dict(kind='ui_native_material_edit_return_v1',
            submissionDigest=submission['submissionDigest'],returnedSha256=digest(raw),
            hostObservedNativeReturn=True,notCryptographicallyProviderVerified=True))
        edit.receive(job,submission['submissionDigest'],raw,evidence)
        prepared=observation.prepare(self.archive,self.root/'edited-observation',source_overrides={'panel':job})
        self.item=self.root/'edited-observation'/prepared['items'][0]['directory'];self.request=observation.verify_prepared(self.item)
        self.answer.update(sourceBodyBox=[10,4,16,16],targetBodyBox=[0,4,6,16])
        for name in ('response.json','attestation.json'): (self.root/name).unlink()
        HostGeometryTests.receive(self)
        spec=read(self.selection);spec['observations']=[dict(layerId='panel',directory=str(self.item),
            requestSha256=digest(self.item/'request.json'),resultSha256=digest(self.item/'result.json'))]
        self.selection.unlink();save(self.selection,spec)
        result=self.export()
        proof=result['records'][0]['sourceEvidence']
        self.assertEqual(proof['sourceOverride']['kind'],'ui_verified_archive_material_edit_source_v1')
        self.assertEqual(proof['sourceSha256'],digest(raw));self.assertEqual(proof['sourceSize'],[18,20])
        (job/'native-evidence.json').write_bytes(b'forged')
        with self.assertRaises(Exception):viewport.draft(self.selection,self.root/'bad',self.root/'viewer')


if __name__=='__main__':unittest.main()
