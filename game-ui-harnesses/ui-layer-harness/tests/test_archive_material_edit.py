import _bootstrap
import json
import os
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

    def test_default_prompt_bytes_and_request_scope_remain_legacy(self):
        expected=('Edit only the actual source.png material using the original reference.png and reference-crop.png as visual evidence.\n'
            'Purpose: Remove duplicate children.\nPreserve ONLY these owned surfaces/details: ["outer owned panel and texture"]'
            '\nDELETE each listed child and its entire decoration/frame, including empty frames: ["all child icons and their empty frames"]'
            '\nRecover the underlying owned surface naturally where deleted children occupied it. '
            'Preserve the owned outer silhouette, texture, lighting and native continuous transparent alpha. '
            'Return one genuine native transparent PNG with the complete owned material. '
            'Do not alpha-crop, fit to an ownership rectangle, redraw geometry programmatically, '
            'leave placeholder frames, add children, or use a recomposed preview as reference.\n')
        self.assertEqual((self.job/'prompt.md').read_bytes(),expected.replace('\n',os.linesep).encode('utf-8'))
        request=edit.verify_frozen(self.job)
        self.assertNotIn('geometryIntent',request)
        self.assertEqual(request['args'],dict(purpose='Remove duplicate children.',
            owned=['outer owned panel and texture'],delete=['all child icons and their empty frames'],
            referenceRegion=[4,6,20,22]))
        self.assertEqual(edit.frozen_arguments(self.job),dict(prompt=expected,
            referenced_image_paths=[str(self.job/'source.png'),str(self.job/'reference.png'),
                                    str(self.job/'reference-crop.png')],transparent_background=True))
        self.assertEqual(self.frozen['generationCalls'],0)

    def reference_structure_job(self):
        job=self.root/'structure-edit'
        frozen=edit.freeze(self.archive,'panel',job,purpose='Restore visible reference proportions.',
            owned=['panel texture'],delete=['child icons and frames'],reference_region=[4,6,20,22],
            geometry_intent='reference-visible-structure')
        self.assertEqual(frozen['generationCalls'],0)
        return job,frozen

    def test_reference_visible_structure_has_unambiguous_geometry_and_alpha_contract(self):
        job,frozen=self.reference_structure_job();request=edit.verify_frozen(job)
        arguments=edit.frozen_arguments(job);prompt=arguments['prompt']
        self.assertEqual(request['geometryIntent'],'reference-visible-structure')
        self.assertEqual(read(job/'arguments.json')['geometryIntent'],request['geometryIntent'])
        self.assertEqual(request['args'],read(job/'arguments.json'))
        self.assertNotIn('Preserve the owned outer silhouette',prompt)
        for instruction in ['source.png supplies ONLY owned texture and detail material evidence',
            'Replace any confirmed incorrect old silhouette', 'internal relative layout',
            'true original-canvas clipping boundary', 'Do not infer hidden boundaries',
            'Do not bake deleted children', 'rectangle is not the body silhouette',
            'Separate the native visible body', 'reference-supported soft shadow/glow',
            'alpha exactly zero', 'do not erase faint alpha', 'no isolated fragments or unrelated halos']:
            self.assertIn(instruction,prompt)
        self.assertEqual(arguments['referenced_image_paths'],[str(job/'reference-crop.png'),
            str(job/'reference.png'),str(job/'source.png')])
        self.assertIn('Image 1 is reference-crop.png, the primary visible structure target',prompt)
        self.assertIn('Image 3 is source.png',prompt)
        self.assertTrue(arguments['transparent_background'])
        edit.authorize(job,frozen['digest'],'Fixture explicit single edit authorization')
        self.assertEqual(edit.next_request(job)['arguments'],arguments)

    def test_intent_tampering_rejected_by_frozen_and_authorization_hash_chains(self):
        job,frozen=self.reference_structure_job()
        edit.authorize(job,frozen['digest'],'Fixture explicit single edit authorization')
        # Editing any of the three bound representations cannot reuse authorization.
        for filename in ['arguments.json','image-gen-arguments.json','request.json']:
            path=job/filename;original=path.read_bytes()
            path.write_bytes(original.replace(b'reference-visible-structure',b'preserve-source-geometry'))
            with self.assertRaisesRegex(ValueError,'EDIT_REQUEST_CHANGED|EDIT_FROZEN_INPUT_CHANGED'):
                edit.next_request(job)
            self.assertFalse((job/'submission.json').exists())
            path.write_bytes(original)
        # Even coherent refreezing of all public hashes cannot reuse the old human authorization.
        args=read(job/'arguments.json');args.pop('geometryIntent')
        (job/'arguments.json').write_text(json.dumps(args),encoding='utf-8')
        prompt=(self.job/'prompt.md').read_text(encoding='utf-8')
        (job/'prompt.md').write_text(prompt,encoding='utf-8')
        tool_args=read(job/'image-gen-arguments.json');tool_args['prompt']=prompt
        (job/'image-gen-arguments.json').write_text(json.dumps(tool_args),encoding='utf-8')
        request=read(job/'request.json');request.pop('geometryIntent');request['args']=args
        for filename in ['arguments.json','prompt.md','image-gen-arguments.json']:
            request['files'][filename]=digest(job/filename)
        request.pop('digest');request['digest']=edit._hash(request)
        (job/'request.json').write_text(json.dumps(request),encoding='utf-8')
        (job/'preparation.json').write_text(json.dumps(dict(requestSha256=digest(job/'request.json'))),encoding='utf-8')
        edit.verify_frozen(job)
        with self.assertRaisesRegex(ValueError,'EDIT_AUTHORIZATION_CHANGED'):edit.next_request(job)
        self.assertFalse((job/'submission.json').exists())

    def test_unknown_geometry_intent_rejected_before_creating_job(self):
        job=self.root/'invalid-intent'
        with self.assertRaisesRegex(ValueError,'EDIT_GEOMETRY_INTENT_INVALID'):
            edit.freeze(self.archive,'panel',job,purpose='Fixture',owned=['panel'],delete=['child'],
                geometry_intent='force-rectangle')
        self.assertFalse(job.exists())

    def test_reference_input_order_without_crop_and_resealed_order_tamper_rejected(self):
        job=self.root/'structure-no-crop'
        frozen=edit.freeze(self.archive,'panel',job,purpose='Restore visible geometry.',
            owned=['texture'],delete=['icons'],geometry_intent='reference-visible-structure')
        self.assertEqual(frozen['generationCalls'],0)
        arguments=edit.frozen_arguments(job)
        self.assertEqual(arguments['referenced_image_paths'],[str(job/'reference.png'),str(job/'source.png')])
        self.assertIn('Image 1 is the full original reference.png',arguments['prompt'])
        # The exact order is checked even if someone refreshes the file/request hashes.
        arguments['referenced_image_paths'].reverse()
        (job/'image-gen-arguments.json').write_text(json.dumps(arguments),encoding='utf-8')
        request=read(job/'request.json');request['files']['image-gen-arguments.json']=digest(job/'image-gen-arguments.json')
        request.pop('digest');request['digest']=edit._hash(request)
        (job/'request.json').write_text(json.dumps(request),encoding='utf-8')
        (job/'preparation.json').write_text(json.dumps(dict(requestSha256=digest(job/'request.json'))),encoding='utf-8')
        edit.verify_frozen(job)
        with self.assertRaisesRegex(ValueError,'EDIT_FROZEN_IMAGE_ARGUMENTS_CHANGED'):edit.frozen_arguments(job)

    def test_reference_structure_receive_preserves_native_faint_alpha_and_size(self):
        job,frozen=self.reference_structure_job()
        edit.authorize(job,frozen['digest'],'Fixture explicit single edit authorization')
        submission=edit.next_request(job)
        raw=self.root/'structure-native.png';image=Image.new('RGBA',(23,19))
        image.paste((45,60,80,255),(3,2,17,16));image.putpixel((2,8),(45,60,80,1))
        image.putpixel((18,8),(45,60,80,37));image.save(raw)
        evidence=self.root/'structure-evidence.json'
        save(evidence,dict(kind='ui_native_material_edit_return_v1',
            submissionDigest=submission['submissionDigest'],returnedSha256=digest(raw),
            hostObservedNativeReturn=True,notCryptographicallyProviderVerified=True))
        edit.receive(job,submission['submissionDigest'],raw,evidence)
        verified=edit.verify_received(job)
        self.assertEqual(verified['rawPath'].read_bytes(),raw.read_bytes())
        with Image.open(verified['rawPath']) as received:
            self.assertEqual(received.size,(23,19))
            self.assertEqual(received.getpixel((2,8))[3],1)
        receipt=read(job/'received.json')
        self.assertFalse(receipt['humanVisualAcceptance'])
        self.assertFalse(receipt['strictBodyRegistrationPassed'])
        self.assertFalse(receipt['originalDagPromoted'])

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
        structure=self.root/'bg-structure-edit'
        structured=edit.freeze(self.root/'bg-package/ui-layers.zip','background',structure,
            purpose='Restore visible scene proportions.',owned=['scene'],delete=['control frames'],
            geometry_intent='reference-visible-structure')
        arguments=edit.frozen_arguments(structure)
        self.assertEqual(structured['generationCalls'],0)
        self.assertFalse(arguments['transparent_background'])
        self.assertEqual(arguments['referenced_image_paths'],[str(structure/'reference.png'),str(structure/'source.png')])
        self.assertIn('preserve the positions of visible physical scene objects',arguments['prompt'])
        self.assertIn('background fully opaque',arguments['prompt'])
        self.assertIn('32:32',arguments['prompt'])
        self.assertNotIn('remaining canvas must have alpha exactly zero',arguments['prompt'])

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
