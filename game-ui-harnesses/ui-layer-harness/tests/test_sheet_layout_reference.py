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


if __name__ == '__main__':
    unittest.main()
