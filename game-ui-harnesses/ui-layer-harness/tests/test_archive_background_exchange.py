import _bootstrap
import json
from pathlib import Path
import tempfile
import unittest

from PIL import Image
from ai_ui_layers import archive_background_exchange as exchange
from ai_ui_layers import archive_component_exchange as component
from ai_ui_layers import viewport_geometry_revision as viewport
from ai_ui_layers.evaluate import digest, read, save
from ai_ui_layers.layer_package import write_package, composite


class BackgroundExchangeTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.viewer = self.root/'viewer'
        self.viewer.mkdir()
        (self.viewer/'viewer.html').write_text('<html></html>')
        (self.viewer/'viewer.js').write_text('void 0;')
        self.reference = self.root/'reference.png'
        Image.new('RGBA', (32,32), (19,29,39,255)).save(self.reference)
        self.source = self.root/'scene.png'
        image = Image.new('RGBA', (32,32))
        image.putdata([(x,y,(x+y)%256,255) for y in range(32) for x in range(32)])
        image.save(self.source)
        self.archive = self.package('standard', self.reference, [32,32], [0,0])

    def package(self, name, reference, canvas, origin, source=None, role='background'):
        source = source or self.source
        with Image.open(source) as image:
            size = image.size
        composition = dict(kind='ui_layer_composition_v1', canvas=dict(width=canvas[0],height=canvas[1]),
            coordinates='top-left-pixels', order='array-back-to-front', textPolicy='remove-business-text',
            backgroundMode='scene-only', reference='reference.png', preview='preview.png',
            layers=[dict(id='scene',name='Scene',role=role,path='layers/layer-001.png',
                         x=origin[0],y=origin[1],width=size[0],height=size[1],visible=True)])
        write_package(reference, composition, dict(scene=dict(path=str(source),sha256=digest(source))),
                      self.root/name, self.viewer, ['Offline fixture'])
        return self.root/name/'ui-layers.zip'

    def freeze(self, name='job', archive=None, region=None):
        job = self.root/name
        result = exchange.freeze(archive or self.archive, 'scene', job,
            purpose='Restore visible sign in declared original coordinates.',
            edit_region=region or [4,6,20,22], owned=['scene sign'], delete=['misplaced sign'])
        self.assertEqual(result['generationCalls'], 0)
        return job, result

    def pending(self, name='job', archive=None):
        job, result = self.freeze(name, archive)
        exchange.authorize(job, result['digest'], 'Fixture user authorizes one native background edit.')
        submission = exchange.next_request(job)
        return job, submission

    def returned(self, job, submission, *, size=(32,32), alpha=255, evidence_change=None):
        raw = self.root/(job.name+'-raw.png')
        Image.new('RGBA', size, (91,81,71,alpha)).save(raw)
        r = exchange.verify_frozen(job)
        evidence = self.root/(job.name+'-evidence.json')
        value = exchange._evidence(r, read(job/'submission.json'), raw)
        if evidence_change:
            value.update(evidence_change)
        save(evidence, value)
        return raw, evidence

    def received(self, name='job', archive=None):
        job, submission = self.pending(name, archive)
        raw, evidence = self.returned(job, submission)
        exchange.receive(job, submission['submissionDigest'], raw, evidence)
        return job, raw, evidence, submission

    def rewrite(self, path, value):
        path.write_text(json.dumps(value), encoding='utf-8')

    def test_inputs_and_exact_region_exchange(self):
        job, raw, evidence, submission = self.received()
        verified = exchange.verify_received(job)
        self.assertEqual((job/'raw.png').read_bytes(), raw.read_bytes())
        self.assertEqual((job/'native-evidence.json').read_bytes(), evidence.read_bytes())
        args = exchange.frozen_arguments(job)
        self.assertEqual(args['referenced_image_paths'], [str(job/'source.png'),str(job/'reference.png'),
                                                         str(job/'reference-crop.png')])
        self.assertFalse(args['transparent_background'])
        self.assertEqual(verified['layerId'], 'scene')
        self.assertEqual(verified['editRegion'], [4,6,20,22])
        self.assertEqual(verified['binding']['candidateSha256'], digest(verified['candidatePath']))
        source, candidate = exchange._pixels(self.source), exchange._pixels(verified['candidatePath'])
        for y in range(32):
            for x in range(32):
                expected = (91,81,71,255) if 4<=x<20 and 6<=y<22 else source.getpixel((x,y))
                self.assertEqual(candidate.getpixel((x,y)), expected)
        self.assertFalse(verified['humanVisualAcceptance'])
        self.assertFalse(verified['strictBodyRegistrationPassed'])
        self.assertFalse(verified['originalDagPromoted'])
        for action in [lambda:exchange.next_request(job),
                       lambda:exchange.authorize(job, exchange.verify_frozen(job)['digest'], 'Again'),
                       lambda:exchange.receive(job, submission['submissionDigest'], raw, evidence)]:
            with self.assertRaises(FileExistsError):
                action()

    def test_wrong_dimensions_alpha_and_unknown_evidence_terminal(self):
        for name, kwargs in [('size',dict(size=(31,32))), ('alpha',dict(alpha=254)),
                             ('kind',dict(evidence_change=dict(kind='unknown'))),
                             ('sha',dict(evidence_change=dict(returnedSha256='0'*64))),
                             ('extra',dict(evidence_change=dict(unbound='receipt')))]:
            job, submission = self.pending(name)
            raw, evidence = self.returned(job, submission, **kwargs)
            with self.assertRaises(ValueError):
                exchange.receive(job, submission['submissionDigest'], raw, evidence)
            self.assertTrue((job/'receive.lock').exists())
            self.assertFalse((job/'received.json').exists())
            with self.assertRaises(FileExistsError):
                exchange.receive(job, submission['submissionDigest'], raw, evidence)
            with self.assertRaises(FileExistsError):
                exchange.next_request(job)

    def test_orientation_rejected_without_repair(self):
        job, submission = self.pending()
        raw, evidence = self.returned(job, submission)
        image = Image.new('RGBA',(32,32),(1,2,3,255))
        exif = Image.Exif(); exif[274] = 6
        image.save(raw, exif=exif)
        self.rewrite(evidence, exchange._evidence(exchange.verify_frozen(job), read(job/'submission.json'), raw))
        with self.assertRaisesRegex(ValueError, 'ORIENTED_PNG'):
            exchange.receive(job, submission['submissionDigest'], raw, evidence)

    def test_scope_role_storage_size_and_original_origin(self):
        for region in [[0,0,0,2], [-1,0,10,10], [0,0,33,32], [0,0,True,32], [0.,0,32,32]]:
            with self.assertRaisesRegex(ValueError, 'REGION_INVALID'):
                self.freeze(region=region)
            self.assertFalse((self.root/'job').exists())
        with self.assertRaisesRegex(ValueError, 'SCOPE_REQUIRED'):
            exchange.freeze(self.archive,'scene',self.root/'bad',purpose='Restore',edit_region=[0,0,3,3],
                            owned=[],delete=['sign'])
        foreground = self.package('foreground',self.reference,[32,32],[0,0],role='foreground')
        with self.assertRaisesRegex(ValueError, 'KNOWN_BACKGROUND'):
            self.freeze(archive=foreground)
        small = self.root/'small.png'; Image.new('RGBA',(16,16),(1,2,3,255)).save(small)
        smaller = self.package('small-package',self.reference,[32,32],[0,0],source=small)
        with self.assertRaisesRegex(ValueError, 'CANVAS_IDENTITY'):
            self.freeze(archive=smaller)
        shifted = self.package('shifted',self.reference,[32,32],[1,0],source=small)
        with self.assertRaisesRegex(ValueError, 'CANVAS_IDENTITY'):
            self.freeze(archive=shifted)

    def test_frozen_native_arguments_sha_and_authorization_tamper(self):
        job, frozen = self.freeze()
        with self.assertRaisesRegex(ValueError, 'DIGEST_MISMATCH'):
            exchange.authorize(job, '0'*64, 'Fixture approval')
        exchange.authorize(job, frozen['digest'], 'Fixture approval')
        for name in ['source.png','reference.png','reference-crop.png','image-gen-arguments.json','request.json']:
            path = job/name; original = path.read_bytes(); path.write_bytes(original+b' ')
            with self.assertRaises(Exception):
                exchange.next_request(job)
            path.write_bytes(original)
        auth = job/'authorization.json'; original = auth.read_bytes(); auth.write_bytes(original+b' ')
        with self.assertRaisesRegex(ValueError, 'AUTHORIZATION_CHANGED'):
            exchange.next_request(job)
        auth.write_bytes(original)
        exchange.next_request(job)
        auth.write_bytes(original+b' ')
        with self.assertRaisesRegex(ValueError, 'AUTHORIZATION_CHANGED'):
            exchange._submission(job, exchange.verify_frozen(job))

    def test_frozen_semantic_argument_rebinding_rejected(self):
        job, _ = self.freeze()
        args = read(job/'image-gen-arguments.json'); args['transparent_background'] = True
        self.rewrite(job/'image-gen-arguments.json', args)
        r = read(job/'request.json'); r['files']['image-gen-arguments.json'] = digest(job/'image-gen-arguments.json')
        r['digest'] = component._hash({k:v for k,v in r.items() if k!='digest'})
        self.rewrite(job/'request.json',r)
        self.rewrite(job/'preparation.json',dict(requestSha256=digest(job/'request.json')))
        with self.assertRaisesRegex(ValueError, 'ARGUMENTS_CHANGED'):
            exchange.verify_frozen(job)

    def test_receipt_and_replayed_pixels_proof_tamper(self):
        job, _, _, _ = self.received()
        for name in ['raw.png','native-evidence.json','received.json','region-proof.json']:
            path = job/name; original = path.read_bytes()
            if name == 'received.json':
                changed = read(path); changed['candidateSha256'] = '0'*64
                self.rewrite(path, changed)
            else:
                path.write_bytes(original+b' ')
            with self.assertRaises(Exception):
                exchange.verify_received(job)
            path.write_bytes(original)
        candidate = exchange._pixels(job/'candidate.png')
        candidate.putpixel((0,0),(99,98,97,255)); candidate.save(job/'candidate.png')
        receipt = read(job/'received.json'); receipt['candidateSha256'] = digest(job/'candidate.png')
        self.rewrite(job/'received.json',receipt)
        with self.assertRaisesRegex(ValueError, 'PIXEL_COPY_REPLAY'):
            exchange.verify_received(job)

    def test_viewport_true_original_and_shifted_background(self):
        extended = Image.new('RGBA',(40,32))
        with Image.open(self.reference) as reference:
            extended.paste(reference,(8,0))
        world_reference = self.root/'world-reference.png'; extended.save(world_reference)
        inner = self.package('world',world_reference,[40,32],[8,0])
        delivery = self.root/'world'
        (delivery/'original-reference.png').write_bytes(self.reference.read_bytes())
        composition = read(delivery/'package/composition.json')
        composite(delivery/'package',composition).crop([8,0,40,32]).save(delivery/'viewport-preview.png')
        save(delivery/'viewport.json',dict(policy=viewport.POLICY,originalSize=[32,32],worldSize=[40,32],
            worldShift=[8,0],worldViewportBox=[8,0,40,32],originalReferenceSha256=digest(self.reference)))
        viewport._wrapper(delivery)
        wrapper = delivery/'viewport-ui-layers.zip'
        loaded = component.load_archive(wrapper)
        self.assertNotEqual(loaded['referenceBytes'],loaded['files']['reference.png'])
        job, _, _, _ = self.received('wrapped', wrapper)
        r = exchange.verify_frozen(job)
        self.assertEqual(r['worldShift'], [8,0])
        self.assertEqual((job/'reference.png').read_bytes(),self.reference.read_bytes())
        self.assertEqual((job/'source.png').read_bytes(),self.source.read_bytes())
        self.assertEqual(exchange.verify_received(job)['binding']['sourceArchiveSha256'],digest(wrapper))


if __name__ == '__main__':
    unittest.main()
