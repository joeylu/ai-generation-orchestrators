import _bootstrap
import copy
import hashlib
import json
from pathlib import Path
from unittest import mock
import unittest

from PIL import Image, ImageDraw

from ai_ui_layers import sheet_layout_reference as board
from ai_ui_layers import context_references as context
from ai_ui_layers.compile_visual import HARNESS
from ai_ui_layers.evaluate import digest, read
from ai_ui_layers.freeze_visual import freeze
import test_compile_visual


def save(path, value):
    Path(path).write_text(json.dumps(value, ensure_ascii=False), encoding='utf-8')


class SheetLayoutReferenceTests(unittest.TestCase):
    def setUp(self):
        test_compile_visual.VisualCompileTests.setUp(self)
        self.visual = read(HARNESS / 'planning-harness/examples/visual-plan-scoped.json')
        self.visual['unknowns'] = []
        # Distinct, translucent pixels reveal order, alpha masking and resampling.
        image = Image.new('RGBA', (1000, 1000), (8, 16, 24, 255))
        draw = ImageDraw.Draw(image)
        draw.rectangle((650, 200, 760, 320), fill=(255, 100, 20, 180))
        draw.rectangle((650, 350, 760, 470), fill=(30, 70, 240, 90))
        image.save(self.run / 'm1/reference.png')
        save(self.run / 'm1/draft.json', self.visual)
        request = read(self.run / 'request.json')
        request['inputs']['reference.png'] = digest(self.run / 'm1/reference.png')
        save(self.run / 'request.json', request)
        review = read(self.run / 'm2/request.json')
        review['sourcePlanSha256'] = digest(self.run / 'm1/draft.json')
        save(self.run / 'm2/request.json', review)
        result = read(self.run / 'result.json')
        result['sourcePlanSha256'] = digest(self.run / 'm1/draft.json')
        save(self.run / 'result.json', result)
        self.snapshot = self.root / 'frozen'
        freeze(self.run, self.snapshot, 16, 'sheets', 'context-crops')
        self.row = next(r for r in read(self.snapshot / 'requests.json')['requests']
                        if r.get('kind') == 'sheet')

    def test_board_is_deterministic_ordered_and_pixel_exact(self):
        metadata, png, prompt = board.build(self.snapshot, self.row)
        self.assertEqual(metadata['materialIds'], self.row['materialIds'])
        self.assertEqual([c['materialId'] for c in metadata['cells']], self.row['materialIds'])
        self.assertEqual([c['cellIndex'] for c in metadata['cells']], list(range(len(self.row['materialIds']))))
        self.assertEqual(len({c['integerScale'] for c in metadata['cells']}), 1)
        self.assertGreaterEqual(metadata['integerScale'], 1)
        with Image.open(__import__('io').BytesIO(png)) as image:
            actual = image.convert('RGBA')
            self.assertEqual(actual.size, tuple(self.row['outputSize']))
            for cell, ref in zip(metadata['cells'], self.row['references']):
                with Image.open(self.snapshot / ref['reference']) as source:
                    expected = source.convert('RGBA').resize(
                        (ref['referenceSize'][0] * metadata['integerScale'],
                         ref['referenceSize'][1] * metadata['integerScale']), Image.Resampling.NEAREST)
                self.assertEqual(actual.crop(cell['boardCropBox']).tobytes(), expected.tobytes())
                left, top, right, bottom = cell['cellBox']
                x, y, xx, yy = cell['boardCropBox']
                self.assertGreaterEqual(x - left, cell['padding'])
                self.assertGreaterEqual(y - top, cell['padding'])
                self.assertGreaterEqual(right - xx, cell['padding'])
                self.assertGreaterEqual(bottom - yy, cell['padding'])
            self.assertEqual(actual.getpixel((0, 0)), board.NEUTRAL_GRAY)
        self.assertEqual(board.build(self.snapshot, self.row), (metadata, png, prompt))

    def test_prompt_preserves_ownership_text_exclusions_and_board_coordinates(self):
        part = next(o for o in self.visual['objects'] if o['materialId'] == 'asset-coin-a')
        part['label'] = 'Detailed observed state'
        part['bboxNorm'] = [.7, .25, .75, .30]
        # Rebuild a fresh frozen snapshot with a bounded, specific part label.
        save(self.run / 'm1/draft.json', self.visual)
        review = read(self.run / 'm2/request.json')
        review['sourcePlanSha256'] = digest(self.run / 'm1/draft.json')
        save(self.run / 'm2/request.json', review)
        result = read(self.run / 'result.json')
        result['sourcePlanSha256'] = digest(self.run / 'm1/draft.json')
        save(self.run / 'result.json', result)
        second = self.root / 'second'
        freeze(self.run, second, 16, 'sheets', 'context-crops')
        row = next(r for r in read(second / 'requests.json')['requests'] if r.get('kind') == 'sheet')
        metadata, _, prompt = board.build(second, row)
        entries = json.loads(prompt.split('Entries: ', 1)[1])
        self.assertEqual([e['materialId'] for e in entries], row['materialIds'])
        self.assertEqual([e['referenceIndex'] for e in entries], [1] * len(entries))
        self.assertEqual([e['cropIndex'] for e in entries], list(range(1, len(entries) + 1)))
        self.assertIn('preserveText', prompt)
        self.assertIn('exclude', prompt)
        self.assertIn('observed state', prompt)
        self.assertIn('Remove ordinary business letters and numbers', prompt)
        self.assertIn('true continuous alpha', prompt)
        self.assertIn('Do not stretch, recenter, restyle', prompt)
        self.assertIn('Each entry and its exclusions apply only inside its boardCropBox', prompt)
        self.assertIn("never authorizes deleting another cell's assigned material", prompt)
        plan = read(second / 'execution-plan.candidate.json')
        assets = {a['id']: a for a in plan['assets']}
        materials = {m['id']: m for m in self.visual['materials']}
        self.assertGreater(sum(len(e['exclude']) for e in entries), 0)
        self.assertTrue(any(
            excluded['referenceBox'][0] < entry['boardCropBox'][0] or
            excluded['referenceBox'][1] < entry['boardCropBox'][1] or
            excluded['referenceBox'][2] > entry['boardCropBox'][2] or
            excluded['referenceBox'][3] > entry['boardCropBox'][3]
            for entry in entries for excluded in entry['exclude']))

        def on_board(box, cell, ref):
            placement = cell['boardCropBox']
            crop_width, crop_height = ref['referenceSize']
            scale = metadata['integerScale']
            w, h = row['outputSize']
            return [round((placement[0] + box[0] * crop_width * scale) / w, 8),
                    round((placement[1] + box[1] * crop_height * scale) / h, 8),
                    round((placement[0] + box[2] * crop_width * scale) / w, 8),
                    round((placement[1] + box[3] * crop_height * scale) / h, 8)]

        for i, (entry, ref, cell) in enumerate(zip(entries, row['references'], metadata['cells'])):
            original = context.entry(self.visual, materials[ref['materialId']],
                                     assets[ref['materialId']], ref, plan['canvas'], i)
            self.assertEqual(entry['preserveText'], original['preserveText'])
            self.assertEqual(entry['surface'], original['surface'])
            self.assertEqual(entry['boardCropBox'], cell['boardCropBoxNorm'])
            self.assertEqual(entry['targetBox'], on_board(original['targetBox'], cell, ref))
            self.assertEqual(len(entry['parts']), len(original['parts']))
            for actual, source in zip(entry['parts'], original['parts']):
                for key in ('id', 'kind', 'appearance'):
                    self.assertEqual(actual[key], source[key])
                self.assertEqual(actual.get('withinMaterial'), source.get('withinMaterial'))
                if 'referenceBox' in source:
                    self.assertEqual(actual['referenceBox'], on_board(source['referenceBox'], cell, ref))
            self.assertEqual(len(entry['exclude']), len(original['exclude']))
            for actual, source in zip(entry['exclude'], original['exclude']):
                self.assertEqual(actual['material'], source['material'])
                self.assertEqual(actual['referenceBox'], on_board(source['referenceBox'], cell, ref))

    def test_materialize_and_verify_reject_rehashed_tampering(self):
        job = self.root / 'job'
        job.mkdir()
        descriptor = board.materialize(job, self.snapshot, self.row)
        self.assertEqual(set(descriptor['sha256']), {board.BOARD, board.METADATA, board.PROMPT})
        self.assertIsNone(board.verify(job, self.snapshot, self.row, descriptor))
        changed = copy.deepcopy(descriptor)
        image_path = job / board.BOARD
        with Image.open(image_path) as source:
            image = source.copy()
        image.putpixel((0, 0), (1, 2, 3, 255))
        image.save(image_path)
        changed['sha256'][board.BOARD] = hashlib.sha256(image_path.read_bytes()).hexdigest()
        with self.assertRaisesRegex(ValueError, 'SHEET_LAYOUT_DESCRIPTOR_CHANGED'):
            board.verify(job, self.snapshot, self.row, changed)
        with self.assertRaisesRegex(ValueError, 'SHEET_LAYOUT_ARTIFACT_CHANGED'):
            board.verify(job, self.snapshot, self.row, descriptor)
        image_path.write_bytes(board.build(self.snapshot, self.row)[1])
        prompt_path = job / board.PROMPT
        prompt_path.write_text('restyle', encoding='utf-8')
        changed = copy.deepcopy(descriptor)
        changed['sha256'][board.PROMPT] = hashlib.sha256(prompt_path.read_bytes()).hexdigest()
        with self.assertRaisesRegex(ValueError, 'SHEET_LAYOUT_DESCRIPTOR_CHANGED'):
            board.verify(job, self.snapshot, self.row, changed)
        prompt_path.write_bytes(board.build(self.snapshot, self.row)[2].encode('utf-8'))
        metadata_path = job / board.METADATA
        altered = read(metadata_path)
        altered['cells'][0]['integerScale'] += 1
        metadata_path.write_text(json.dumps(altered), encoding='utf-8')
        changed = copy.deepcopy(descriptor)
        changed['sha256'][board.METADATA] = hashlib.sha256(metadata_path.read_bytes()).hexdigest()
        with self.assertRaisesRegex(ValueError, 'SHEET_LAYOUT_DESCRIPTOR_CHANGED'):
            board.verify(job, self.snapshot, self.row, changed)
        changed = copy.deepcopy(descriptor)
        changed['board'] = board.PROMPT
        with self.assertRaisesRegex(ValueError, 'SHEET_LAYOUT_DESCRIPTOR_CHANGED'):
            board.verify(job, self.snapshot, self.row, changed)

    def test_singleton_and_unfit_grid_are_rejected(self):
        singleton = copy.deepcopy(self.row)
        singleton['materialIds'] = singleton['materialIds'][:1]
        singleton['references'] = singleton['references'][:1]
        with self.assertRaisesRegex(ValueError, 'SHEET_LAYOUT_CONTEXT_REQUIRED'):
            board.build(self.snapshot, singleton)
        tiny = copy.deepcopy(self.row)
        tiny['outputSize'] = [16, 16]
        with mock.patch.object(board, '_frozen', return_value=(
                read(self.snapshot / 'snapshot.json'), self.visual,
                read(self.snapshot / 'execution-plan.candidate.json'))):
            with self.assertRaisesRegex(ValueError, 'SHEET_LAYOUT_NO_INTEGER_FIT'):
                board.build(self.snapshot, tiny)


class CandidateTextureBoardTests(unittest.TestCase):
    """Fixture-only source binding and exchange; no external model or image tool."""
    def setUp(self):
        import test_visual_texture_pipeline as fixture
        from ai_ui_layers.host_material_review import freeze_candidate_plan
        fixture.VisualTexturePipelineTests.setUp(self)
        self.strict=fixture.VisualTexturePipelineTests.frozen(self,'strict-textures')
        visual=self.strict/'evidence/revised-visual-plan.json'
        if not visual.exists():visual=self.strict/'evidence/m1-draft.json'
        self.snapshot=self.base/'candidate-textures'
        self.manifest=freeze_candidate_plan(visual,self.source,digest(self.source),HARNESS/'planning-harness',
            self.snapshot,16,visual_textures=self.input,
            prior_texture_review=self.strict/'evidence/visual-texture-final-review.json')
        self.row=next(r for r in read(self.snapshot/'requests.json')['requests'] if r.get('kind')=='sheet')

    def test_candidate_texture_mapping_is_integer_owned_and_uses_board_coordinates(self):
        metadata,png,prompt=board.build(self.snapshot,self.row,prompt_version='v2')
        self.assertFalse(metadata['newTextureReviewPerformed']);self.assertTrue(metadata['planningReviewDeferred'])
        self.assertEqual(metadata['originalReferenceSha256'],digest(self.source))
        for key in ('visualTexturesSha256','visualTextureBindingsSha256'):
            self.assertEqual(metadata[key],self.manifest[key])
        region=metadata['textureRegions'][0]
        self.assertEqual(region['regionId'],'tiny-print');self.assertEqual(region['materialId'],'asset-coin-a')
        self.assertEqual(region['objectId'],'coin-a');self.assertEqual(region['sourceBox'],[715,265,725,275])
        cell=next(c for c in metadata['cells'] if c['materialId']==region['materialId'])
        mapped=[cell['boardCropBox'][i%2]+(region['sourceBox'][i]-cell['cropRegion'][i%2])*cell['integerScale'] for i in range(4)]
        self.assertEqual(region['boardBox'],mapped)
        self.assertEqual(region['boardBoxNorm'],board._norm(mapped,self.row['outputSize']))
        with Image.open(__import__('io').BytesIO(png)) as image,Image.open(self.source) as original:
            expected=original.convert('RGBA').crop(region['sourceBox']).resize(
                (10*cell['integerScale'],10*cell['integerScale']),Image.Resampling.NEAREST)
            self.assertEqual(image.crop(mapped).tobytes(),expected.tobytes())
        appended=prompt.split('Texture regions: ',1)[1]
        self.assertNotIn('sourceBox',appended);self.assertNotIn('contextBox',appended)
        self.assertIn('preserveText',prompt);self.assertIn('Do not infer or guess',prompt)
        self.assertEqual(board.build(self.snapshot,self.row,prompt_version='v2'),(metadata,png,prompt))

    def test_strict_texture_snapshot_still_rejects_layout_board(self):
        from ai_ui_layers import experimental_executor as exchange
        strict_row=next(r for r in read(self.strict/'requests.json')['requests'] if r.get('kind')=='sheet')
        with self.assertRaisesRegex(ValueError,'VISUAL_TEXTURE_VARIANTS_UNSUPPORTED'):
            board.build(self.strict,strict_row,prompt_version='v2')
        with self.assertRaisesRegex(ValueError,'VISUAL_TEXTURE_VARIANTS_UNSUPPORTED'):
            exchange.prepare(self.strict,read(self.strict/'snapshot.json')['digest'],self.base/'strict-board',
                             [strict_row['asset']],reference_mode='sheet-layout-board')
        self.assertFalse((self.base/'strict-board').exists())

    def test_candidate_board_real_fixture_receipt_needs_its_own_authorization(self):
        from ai_ui_layers import experimental_executor as exchange
        job=self.base/'new-board-job'
        config=exchange.prepare(self.snapshot,self.manifest['digest'],job,[self.row['asset']],reference_mode='sheet-layout-board')
        self.assertEqual(config['maximumCalls'],1);self.assertEqual(config['automaticRetries'],0)
        self.assertFalse((job/'authorization.json').exists())
        self.assertEqual(exchange.load_job(job)[0],config)
        with self.assertRaisesRegex(ValueError,'NOT_READY_NO_RESUBMIT'):exchange.next_request(job)
        exchange.authorize(job,config['digest'],'offline fixture independent authorization')
        request=exchange.next_request(job)
        self.assertEqual(len(request['arguments']['referenced_image_paths']),1)
        columns,rows=request['grid'];image=Image.new('RGBA',(columns*100,rows*100))
        draw=ImageDraw.Draw(image)
        for i in range(len(request['materialIds'])):
            x=i%columns*100;y=i//columns*100;draw.rectangle((x+20,y+20,x+79,y+79),fill=(50,60,70,255))
        raw=self.base/'fixture-return.png';image.save(raw)
        receipt=exchange.receive(job,request['submissionDigest'],raw)
        self.assertEqual(exchange.status(job)['status'],'raw_complete')
        self.assertFalse(receipt['alphaQualityAccepted']);self.assertFalse(receipt['humanVisualAcceptance'])
        self.assertFalse(self.manifest['newM2ReviewPerformed'])
        with self.assertRaisesRegex(ValueError,'NOT_READY_NO_RESUBMIT'):exchange.next_request(job)

    def test_rehashed_board_texture_mapping_is_not_a_canonical_mapping(self):
        job=self.base/'map-job';job.mkdir();descriptor=board.materialize(job,self.snapshot,self.row)
        value=read(job/board.METADATA);value['textureRegions'][0]['boardBoxNorm'][0]+=.01
        (job/board.METADATA).write_bytes(board._bytes(value))
        forged=copy.deepcopy(descriptor);forged['sha256'][board.METADATA]=digest(job/board.METADATA)
        with self.assertRaisesRegex(ValueError,'SHEET_LAYOUT_DESCRIPTOR_CHANGED'):board.verify(job,self.snapshot,self.row,forged)
        with self.assertRaisesRegex(ValueError,'SHEET_LAYOUT_ARTIFACT_CHANGED'):board.verify(job,self.snapshot,self.row,descriptor)

    def test_texture_region_outside_context_is_rejected_before_mapping(self):
        from ai_ui_layers import visual_textures
        visual=read(self.snapshot/'evidence/revised-visual-plan.json')
        bindings=visual_textures.snapshot_bindings(self.snapshot,self.manifest,visual)
        bad=copy.deepcopy(bindings);bad['regions'][0]['sourceBox']=[0,0,10,10]
        with mock.patch.object(board,'snapshot_bindings',return_value=bad):
            with self.assertRaisesRegex(ValueError,'SHEET_LAYOUT_TEXTURE_OUTSIDE_CONTEXT'):
                board.build(self.snapshot,self.row,prompt_version='v2')

    def test_rehashed_texture_binding_cannot_override_the_frozen_source_region(self):
        from ai_ui_layers.freeze_visual import body_digest
        path=self.snapshot/'visual-texture-bindings.json';bindings=read(path)
        bindings['regions'][0]['sourceBox'][0]+=1;save(path,bindings)
        manifest=read(self.snapshot/'snapshot.json');manifest['files']['visual-texture-bindings.json']=digest(path)
        manifest['visualTextureBindingsSha256']=digest(path)
        manifest['digest']=body_digest({k:v for k,v in manifest.items() if k!='digest'})
        save(self.snapshot/'snapshot.json',manifest)
        with self.assertRaisesRegex(ValueError,'VISUAL_TEXTURE_BINDINGS_CHANGED'):
            board.build(self.snapshot,self.row,prompt_version='v2')

    def test_rehashed_context_crop_cannot_override_original_reference_pixels(self):
        from ai_ui_layers.freeze_visual import body_digest
        path=self.snapshot/self.row['references'][0]['reference']
        with Image.open(path) as original:image=original.convert('RGBA')
        image.putpixel((0,0),(151,152,153,255));image.save(path)
        manifest=read(self.snapshot/'snapshot.json')
        manifest['files'][path.relative_to(self.snapshot).as_posix()]=digest(path)
        manifest['digest']=body_digest({k:v for k,v in manifest.items() if k!='digest'})
        save(self.snapshot/'snapshot.json',manifest)
        with self.assertRaisesRegex(ValueError,'CONTEXT_REFERENCE_MISMATCH'):
            board.build(self.snapshot,self.row,prompt_version='v2')


if __name__ == '__main__':
    unittest.main()
