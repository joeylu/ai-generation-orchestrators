import _bootstrap
import io
import json
import unittest
import zipfile
from unittest.mock import patch

from PIL import Image, ImageDraw

import test_layer_package
from ai_ui_layers import experimental_executor as exchange
from ai_ui_layers.automatic_registration import run as register
from ai_ui_layers.body_registration import KIND, POLICY_SUPPORT
from ai_ui_layers.delivery_dag import main
from ai_ui_layers.evaluate import digest, read, save
from ai_ui_layers.layer_package import build, validate_archive
from ai_ui_layers.package_revision import KIND as REVISION_KIND, revise


class PackageRevisionTests(unittest.TestCase):
    def setUp(self):
        test_layer_package.LayerPackageTests.setUp(self)
        evidence = read(self.evidence)
        placements = read(self.snapshot / 'placements.json')['materials']
        for index, placement in enumerate(placements):
            source = self.root / (str(index) + '.png')
            w, h = placement['outputSize']
            image = Image.new('RGBA', (w, h))
            if index == 0:
                image.paste((30, 60, 90, 255), (0, 0, w, h))
            else:
                ImageDraw.Draw(image).rectangle((8, 8, w - 9, h - 9), fill=(60 + index * 20, 80, 120, 255))
            image.save(source)
            evidence['sources'][placement['id']] = dict(path=str(source), sha256=digest(source))
        self.evidence.write_text(json.dumps(evidence), encoding='utf-8')
        self.original = self.root / 'original'
        build(self.snapshot, self.evidence, self.original, self.viewer)
        self.key = 'asset-buy-button'
        self.job = self.root / 'replacement-job'
        frozen = read(self.snapshot / 'snapshot.json')
        job = exchange.prepare(self.snapshot, frozen['digest'], self.job, assets=[self.key])
        exchange.authorize(self.job, job['digest'], 'offline fixture only')
        request = exchange.next_request(self.job)
        source = self.root / 'replacement.png'
        image = Image.new('RGBA', (120, 80))
        ImageDraw.Draw(image).rectangle((20, 20, 99, 59), fill=(210, 60, 30, 255))
        image.putpixel((1, 1), (80, 30, 20, 3))
        image.save(source)
        exchange.receive(self.job, request['submissionDigest'], source)
        raw = self.job / 'attempts' / self.key / 'raw.png'
        observation = self.root / 'observation.json'
        save(observation, dict(kind='ui_body_observation_v1', snapshotDigest=frozen['digest'],
            materialId=self.key, sourceSha256=digest(raw), referenceSha256=digest(self.snapshot / 'reference.png'),
            sourceBodyBox=[20, 20, 100, 60], targetBodyBox=[510, 760, 590, 800], boundaryStatus='complete', issues=[]))
        contract = self.root / 'body.json'
        value = read(observation)
        value.pop('boundaryStatus')
        value['kind'] = KIND
        value['evidence'] = dict(path=str(observation), sha256=digest(observation), basis='Fixture whole body and retained faint support')
        save(contract, value)
        config = self.root / 'registration.json'
        save(config, dict(snapshot=str(self.snapshot), snapshotDigest=frozen['digest'],
            materials={self.key: str(raw)}, registrationPolicy=POLICY_SUPPORT,
            wholePlacements={self.key: dict(path=str(contract), sha256=digest(contract))}))
        register(config, self.root / 'registered', selected=[])
        preview = self.root / 'registered/preview'
        self.selection = self.root / 'revision.json'
        save(self.selection, dict(kind=REVISION_KIND, sourceArchive=str(self.original / 'ui-layers.zip'),
            sourceArchiveSha256=digest(self.original / 'ui-layers.zip'), knownDifferences=['Fixture inherited visual limitations'],
            replacements=[dict(materialId=self.key, snapshot=str(self.snapshot), snapshotDigest=frozen['digest'],
                preview=str(preview), previewReportSha256=digest(preview / 'report.json'), job=str(self.job),
                requestId=self.key, sourceMaterialId=self.key, adaptationPolicy='preserve')]))

    def test_public_cli_preserves_old_layers_and_replays_support_with_honest_scope(self):
        out = self.root / 'revision'
        with patch('sys.argv', ['ui-layer', 'revise-package', '--selection', str(self.selection),
                '--output', str(out), '--viewer', str(self.viewer)]), patch('sys.stdout', io.StringIO()) as stdout:
            main()
        result = json.loads(stdout.getvalue())
        self.assertEqual(result['status'], 'candidate_revision_pending_visual_review')
        self.assertTrue(result['replacementReceiptReplayPassed'])
        self.assertFalse(result['sourceReceiptReplayPassed'])
        self.assertFalse(result['originalDagPromoted'])
        self.assertEqual(result['modelCalls'], 0)
        self.assertEqual(result['generationCalls'], 0)
        validate_archive(out / 'delivery/ui-layers.zip')
        old = read(self.original / 'package/composition.json')
        new = read(out / 'delivery/package/composition.json')
        for before, after in zip(old['layers'], new['layers']):
            if before['id'] != self.key:
                self.assertEqual(before, after)
                self.assertEqual((self.original / 'package' / before['path']).read_bytes(),
                                 (out / 'delivery/package' / after['path']).read_bytes())
        replaced = next(layer for layer in new['layers'] if layer['id'] == self.key)
        self.assertLess(replaced['x'], 500)  # Faint support extends beyond owner.
        self.assertLess(replaced['y'], 750)
        review = read(out / 'delivery/package/review.json')
        self.assertIn('Unreviewed fixture', review['issues'])
        self.assertFalse(review['humanVisualAcceptance'])
        self.assertNotIn(str(self.root), (out / 'delivery/package/review.json').read_text('utf-8'))
        with self.assertRaises(FileExistsError):
            revise(self.selection, out, self.viewer)

    def test_changed_raw_receipt_or_body_observation_cannot_be_replaced(self):
        path = self.job / 'attempts' / self.key / 'raw.png'
        path.write_bytes(path.read_bytes() + b'changed')
        with self.assertRaisesRegex(ValueError, 'RECEIPT_MISMATCH|MATERIAL_CHANGED'):
            revise(self.selection, self.root / 'changed', self.viewer)
        self.assertFalse((self.root / 'changed/delivery/ui-layers.zip').exists())

    def test_changed_body_observation_cannot_be_replaced(self):
        path = self.root / 'observation.json'
        value = read(path)
        value['sourceBodyBox'][0] += 1
        path.write_text(json.dumps(value), encoding='utf-8')
        with self.assertRaises(ValueError):
            revise(self.selection, self.root / 'changed-body', self.viewer)

    def test_output_in_source_tree_is_rejected_without_writing(self):
        for source in (self.job, self.snapshot, self.root / 'registered/preview', self.original):
            before = {str(p.relative_to(source)): digest(p) for p in source.rglob('*') if p.is_file()}
            output = source / 'forbidden-output'
            with self.assertRaisesRegex(ValueError, 'OUTPUT_INPUT_OVERLAP'):
                revise(self.selection, output, self.viewer)
            self.assertFalse(output.exists())
            self.assertEqual(before, {str(p.relative_to(source)): digest(p) for p in source.rglob('*') if p.is_file()})

    def test_different_source_identity_is_rejected(self):
        value = read(self.selection)
        value['replacements'][0]['sourceMaterialId'] = 'another-material'
        self.selection.write_text(json.dumps(value), encoding='utf-8')
        with self.assertRaisesRegex(ValueError, 'SOURCE_AUTHORIZATION_MISMATCH'):
            revise(self.selection, self.root / 'different-identity', self.viewer)

    def test_rehashed_wrong_authorization_binding_is_rejected(self):
        path = self.job / 'authorization.json'
        value = exchange.verified(path)
        value.pop('digest')
        value['jobDigest'] = '0' * 64
        path.unlink()
        exchange.record(path, value)
        with self.assertRaisesRegex(ValueError, 'SOURCE_AUTHORIZATION_MISMATCH'):
            revise(self.selection, self.root / 'wrong-binding', self.viewer)

    def test_changed_support_report_is_rejected_even_with_new_selection_hash(self):
        path = self.root / 'registered/preview/report.json'
        value = read(path)
        value['records'][0]['xy'][0] += 1
        path.write_text(json.dumps(value), encoding='utf-8')
        selection = read(self.selection)
        selection['replacements'][0]['previewReportSha256'] = digest(path)
        self.selection.write_text(json.dumps(selection), encoding='utf-8')
        with self.assertRaisesRegex(ValueError, 'SUPPORT_PREVIEW_SCOPE'):
            revise(self.selection, self.root / 'changed-support', self.viewer)

    def test_new_files_in_source_during_write_are_detected(self):
        from ai_ui_layers.package_revision import write_package
        def mutate(*args, **kwargs):
            (self.job / 'added-file').write_text('unexpected', encoding='utf-8')
            return write_package(*args, **kwargs)
        with patch('ai_ui_layers.package_revision.write_package', side_effect=mutate):
            with self.assertRaisesRegex(ValueError, 'INPUT_INVENTORY_CHANGED'):
                revise(self.selection, self.root / 'inventory-change', self.viewer)
        self.assertEqual(read(self.root / 'inventory-change/result.json')['status'], 'candidate_revision_blocked_no_retry')
        self.assertFalse((self.root / 'inventory-change/delivery/ui-layers.zip').exists())

    def test_cli_does_not_silently_ignore_extra_inputs(self):
        with patch('sys.argv', ['ui-layer', 'revise-package', '--selection', str(self.selection),
                '--output', str(self.root / 'extra-input'), '--viewer', str(self.viewer), '--reason', 'unused']), \
                patch('sys.stderr', io.StringIO()):
            with self.assertRaises(SystemExit):
                main()
        self.assertFalse((self.root / 'extra-input').exists())

    def test_background_replacement_and_duplicate_identity_are_rejected(self):
        value = read(self.selection)
        value['replacements'][0]['materialId'] = next(row['id'] for row in
            read(self.original / 'package/composition.json')['layers'] if row['role'] == 'background')
        self.selection.write_text(json.dumps(value), encoding='utf-8')
        with self.assertRaisesRegex(ValueError, 'FOREGROUND_SUPPORT_ONLY'):
            revise(self.selection, self.root / 'background', self.viewer)
        value = read(self.selection)
        value['replacements'].append(value['replacements'][0])
        self.selection.write_text(json.dumps(value), encoding='utf-8')
        with self.assertRaisesRegex(ValueError, 'DUPLICATE_MATERIAL'):
            revise(self.selection, self.root / 'duplicate', self.viewer)

    def _rebuild_source(self, change):
        with zipfile.ZipFile(self.original / 'ui-layers.zip') as source:
            files = {name: source.read(name) for name in source.namelist()}
        change(files)
        manifest = json.loads(files['manifest.json'])
        import hashlib
        for name in manifest['files']:
            manifest['files'][name] = dict(bytes=len(files[name]), sha256=hashlib.sha256(files[name]).hexdigest())
        files['manifest.json'] = json.dumps(manifest).encode()
        archive = self.original / 'invalid-source.zip'
        with zipfile.ZipFile(archive, 'w', compression=zipfile.ZIP_STORED) as output:
            for name in sorted(files):
                output.writestr(name, files[name])
        value = read(self.selection)
        value.update(sourceArchive=str(archive), sourceArchiveSha256=digest(archive))
        self.selection.write_text(json.dumps(value), encoding='utf-8')
        validate_archive(archive)  # Hash validity alone is deliberately insufficient.

    def test_valid_hashes_cannot_hide_a_false_source_preview(self):
        def change(files):
            buffer = io.BytesIO()
            Image.new('RGBA', (1000, 1000), 'red').save(buffer, format='PNG')
            files['preview.png'] = buffer.getvalue()
        self._rebuild_source(change)
        with self.assertRaisesRegex(ValueError, 'SOURCE_PREVIEW_MISMATCH'):
            revise(self.selection, self.root / 'false-preview', self.viewer)

    def test_valid_hashes_cannot_hide_zero_alpha_rgb(self):
        def change(files):
            composition = json.loads(files['composition.json'])
            layer = next(row for row in composition['layers'] if row['role'] == 'foreground')
            with Image.open(io.BytesIO(files[layer['path']])) as image:
                image = image.copy()
            image.putpixel((0, 0), (255, 255, 255, 0))
            buffer = io.BytesIO()
            image.save(buffer, format='PNG')
            files[layer['path']] = buffer.getvalue()
        self._rebuild_source(change)
        with self.assertRaisesRegex(ValueError, 'HIDDEN_RGB'):
            revise(self.selection, self.root / 'hidden-rgb', self.viewer)

    def test_valid_hashes_cannot_hide_bad_alpha_roles(self):
        for role, expected in (('foreground', 'FOREGROUND_ALPHA'), ('background', 'BACKGROUND_ALPHA')):
            def change(files):
                composition = json.loads(files['composition.json'])
                layer = next(row for row in composition['layers'] if row['role'] == role)
                alpha = 255 if role == 'foreground' else 128
                image = Image.new('RGBA', (layer['width'], layer['height']), (40, 60, 80, alpha))
                buffer = io.BytesIO(); image.save(buffer, format='PNG'); files[layer['path']] = buffer.getvalue()
            self._rebuild_source(change)
            with self.assertRaisesRegex(ValueError, expected):
                revise(self.selection, self.root / ('invalid-' + role), self.viewer)
