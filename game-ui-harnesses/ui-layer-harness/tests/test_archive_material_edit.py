import _bootstrap
import unittest
from PIL import Image
from ai_ui_layers.evaluate import read, save, digest
from ai_ui_layers import archive_material_edit as edit
from ai_ui_layers import host_geometry_observation as geometry
from ai_ui_layers.layer_package import write_package
from test_host_geometry_observation import HostGeometryTests


class ArchiveMaterialEditTests(unittest.TestCase):
    def setUp(self):
        HostGeometryTests.setUp(self)
        self.job=self.root/'edit'
        self.frozen=edit.freeze(self.archive,'panel',self.job,purpose='Remove duplicate children.',
            owned=['outer owned panel and texture'],delete=['all child icons and their empty frames'],
            reference_region=[4,6,20,22])

    def returned(self):
        # Deterministic public test fixture, never a model or a native tool call.
        raw=self.root/'native-return.png';image=Image.new('RGBA',(18,20))
        image.paste((45,60,80,255),(2,2,16,18));image.save(raw)
        edit.authorize(self.job,self.frozen['digest'],'Fixture user explicitly authorizes this one edit.')
        submission=edit.next_request(self.job)
        evidence=self.root/'native-return-evidence.json'
        save(evidence,dict(kind='ui_native_material_edit_return_v1',
            submissionDigest=submission['submissionDigest'],returnedSha256=digest(raw),
            hostObservedNativeReturn=True,notCryptographicallyProviderVerified=True))
        edit.receive(self.job,submission['submissionDigest'],raw,evidence)
        return raw,submission,evidence

    def test_frozen_prompt_preserves_owned_and_deletes_whole_children(self):
        request=edit.verify_frozen(self.job)
        prompt=(self.job/'prompt.md').read_text(encoding='utf-8')
        self.assertIn('including empty frames',prompt)
        self.assertIn('underlying owned surface',prompt)
        self.assertIn('native continuous transparent alpha',prompt)
        self.assertEqual(request['maximumCalls'],1)
        with Image.open(self.job/'reference-crop.png') as crop:self.assertEqual(crop.size,(16,16))
        with self.assertRaisesRegex(ValueError,'AUTHORIZATION_DIGEST'):
            edit.authorize(self.job,'0'*64,'Fixture authorization')
        self.assertFalse((self.job/'authorization.json').exists())

    def test_single_use_submission_and_actual_native_raw_chain(self):
        raw,submission,evidence=self.returned()
        verified=edit.verify_received(self.job)
        self.assertEqual(verified['layerId'],'panel')
        self.assertEqual(verified['rawPath'].read_bytes(),raw.read_bytes())
        self.assertEqual(verified['binding']['rawSha256'],digest(raw))
        self.assertTrue(read(self.job/'received.json')['notProviderReceipt'])
        with self.assertRaises(FileExistsError):edit.next_request(self.job)
        with self.assertRaises(FileExistsError):edit.authorize(self.job,self.frozen['digest'],'Again')
        with self.assertRaises(FileExistsError):edit.receive(self.job,submission['submissionDigest'],raw,evidence)

    def test_override_freezes_native_png_without_alpha_fitting(self):
        raw,_,_=self.returned()
        prepared=geometry.prepare(self.archive,self.root/'new-observation',['panel'],source_overrides={'panel':self.job})
        item=self.root/'new-observation'/prepared['items'][0]['directory']
        request=geometry.verify_prepared(item)
        self.assertEqual(request['sourceSize'],[18,20])
        self.assertEqual((item/'source.png').read_bytes(),raw.read_bytes())
        self.assertNotEqual(request['sourceSha256'],edit.verify_frozen(self.job)['sourceSha256'])
        self.assertEqual(request['sourceOverride']['kind'],'ui_verified_archive_material_edit_source_v1')
        self.assertEqual(request['referenceSha256'],self.request['referenceSha256'])
        path=item/'edit-evidence/native-evidence.json';path.write_bytes(path.read_bytes()+b' ')
        with self.assertRaisesRegex(ValueError,'FROZEN_CHAIN_CHANGED'):geometry.verify_prepared(item)

    def test_changed_archive_authorization_raw_or_native_evidence_rejected(self):
        self.returned()
        for path in [self.job/'authorization.json',self.job/'raw.png',self.job/'native-evidence.json',
                     self.job/'source.png',self.job/'prompt.md']:
            data=path.read_bytes();path.write_bytes(data+b'changed')
            with self.assertRaises(Exception):edit.verify_received(self.job)
            path.write_bytes(data)
        self.archive.write_bytes(self.archive.read_bytes()+b'changed')
        with self.assertRaisesRegex(ValueError,'SOURCE_ARCHIVE_CHANGED'):edit.verify_received(self.job)

    def test_failed_receive_is_terminal_and_cannot_simulate_evidence(self):
        edit.authorize(self.job,self.frozen['digest'],'Fixture authorization')
        submission=edit.next_request(self.job)
        raw=self.root/'wrong.png';Image.new('RGBA',(18,20),(20,30,40,255)).save(raw)
        evidence=self.root/'wrong.json';save(evidence,dict(kind='fake'))
        with self.assertRaisesRegex(ValueError,'RETURN_EVIDENCE_MISMATCH'):
            edit.receive(self.job,submission['submissionDigest'],raw,evidence)
        self.assertFalse((self.job/'received.json').exists())
        with self.assertRaises(FileExistsError):edit.receive(self.job,submission['submissionDigest'],raw,evidence)

    def test_wrong_layer_and_override_selection_rejected(self):
        with self.assertRaisesRegex(ValueError,'KNOWN_ARCHIVE_LAYER'):
            edit.freeze(self.archive,'unknown',self.root/'bad',purpose='Fixture',owned=['panel'],delete=['child'])
        with self.assertRaisesRegex(ValueError,'SOURCE_OVERRIDES'):
            geometry.prepare(self.archive,self.root/'bad-observation',['panel'],source_overrides={'unknown':self.job})

    def test_background_opaque_rgb_native_return_and_frozen_arguments(self):
        source=self.root/'background.png';Image.new('RGBA',(32,32),(10,20,30,255)).save(source)
        composition=read(self.root/'package/package/composition.json')
        composition['layers']=[dict(id='background',name='Background',role='background',
            path='layers/layer-001.png',x=0,y=0,width=32,height=32,visible=True)]
        write_package(self.root/'reference.png',composition,
            dict(background=dict(path=str(source),sha256=digest(source))),self.root/'bg-package',self.root/'viewer',[])
        job=self.root/'bg-edit';frozen=edit.freeze(self.root/'bg-package/ui-layers.zip','background',job,
            purpose='Remove embedded controls.',owned=['scene'],delete=['all control frames'])
        arguments=edit.frozen_arguments(job)
        self.assertFalse(arguments['transparent_background'])
        self.assertFalse(read(job/'schema.json')['nativeAlphaRequired'])
        self.assertEqual(read(job/'schema.json')['alphaPolicy'],'fully-opaque')
        self.assertIn('32:32',arguments['prompt'])
        authorization=edit.authorize(job,frozen['digest'],'Fixture background edit authorization')
        self.assertEqual(authorization['authorizationDigest'],digest(job/'authorization.json'))
        submission=edit.next_request(job);self.assertEqual(submission['arguments'],arguments)
        raw=self.root/'native-bg.png';Image.new('RGB',(40,40),(20,30,40)).save(raw)
        evidence=self.root/'bg-evidence.json';save(evidence,dict(kind='ui_native_material_edit_return_v1',
            submissionDigest=submission['submissionDigest'],returnedSha256=digest(raw),
            hostObservedNativeReturn=True,notCryptographicallyProviderVerified=True))
        edit.receive(job,submission['submissionDigest'],raw,evidence)
        self.assertEqual(edit.verify_received(job)['rawPath'].read_bytes(),raw.read_bytes())

    def test_foreground_opaque_return_rejected_despite_valid_host_hash(self):
        self.assertTrue(edit.frozen_arguments(self.job)['transparent_background'])
        edit.authorize(self.job,self.frozen['digest'],'Fixture authorization')
        submission=edit.next_request(self.job)
        raw=self.root/'opaque.png';Image.new('RGB',(18,20),(30,40,50)).save(raw)
        evidence=self.root/'opaque-evidence.json';save(evidence,dict(kind='ui_native_material_edit_return_v1',
            submissionDigest=submission['submissionDigest'],returnedSha256=digest(raw),
            hostObservedNativeReturn=True,notCryptographicallyProviderVerified=True))
        with self.assertRaisesRegex(ValueError,'TRANSPARENT_ALPHA_REQUIRED'):
            edit.receive(self.job,submission['submissionDigest'],raw,evidence)
        self.assertFalse((self.job/'received.json').exists())


if __name__=='__main__':unittest.main()
