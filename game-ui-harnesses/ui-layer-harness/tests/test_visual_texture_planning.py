"""Offline texture planning regressions against committed fad597a0 shared fixtures.

The isolated test runner supplies layer sources and committed shared fixtures.
No provider, CLI model, or media-generation process is invoked.
"""
import _bootstrap  # Enable source-layout imports supplied by the isolated runner.
import copy
import json
from pathlib import Path
import tempfile
import unittest

from PIL import Image

from ai_ui_layers import delivery_dag as delivery
from ai_ui_layers import planning_dag as planning
from ai_ui_layers import visual_textures as textures
from ai_ui_layers.evaluate import digest, read
from ai_ui_layers.planning_review_policy import REGIONS, split
from ai_ui_layers.review_evidence import build_catalog, PROTOCOL_V3
from test_planning_dag import FakeModel


def overwrite(path, value):
    Path(path).write_text(json.dumps(value, ensure_ascii=False), encoding='utf-8')


def audit(status='confirmed', material='asset-panel', object_id='panel'):
    return dict(status=status, materialId=material, objectId=object_id,
                sourceEvidence='The source contains three short dark strokes on the label.',
                preservationEvidence='Keep their visible positions and the surrounding label surface.')


class VisualTexturePlanningTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.base = Path(temporary.name)
        self.source = self.base / 'source.png'
        Image.new('RGB', (1000, 1000), (20, 30, 40)).save(self.source)
        self.doc = dict(kind=textures.KIND, referenceSha256=digest(self.source),
                        canvas=[1000, 1000], regions=[dict(
                            id='label-strokes', sourceBox=[200, 200, 230, 210],
                            appearance='Three short dark strokes; no readable transcription.',
                            protectedArtwork='Keep the pale label base and nearby rust marks.')])
        self.input = self.base / 'texture-input.json'
        self.write_input(self.doc)
        self.plan = read(planning.BASE / 'examples/visual-plan-scoped.json')
        next(row for row in self.plan['objects'] if row['id'] == 'panel')['bboxNorm'] = [.1, .05, .9, .9]

    def write_input(self, doc):
        # Noncanonical formatting verifies the input is pinned by bytes.
        self.input.write_text(json.dumps(doc, ensure_ascii=False, indent=3) + '\n', encoding='utf-8')

    def new_run(self, name='run', bound=True):
        return planning.init(self.source, self.base / name, 16,
                             visual_textures=self.input if bound else None)

    def model(self, repair=False):
        fixture = FakeModel(repair=repair)

        def call(folder, sid, first):
            fixture(folder, sid, first)
            answer = read(folder / 'draft.json')
            if first:
                next(row for row in answer['objects'] if row['id'] == 'panel')['bboxNorm'] = [.1, .05, .9, .9]
            elif folder.name in ('m2', 'rereview', 'rereview2'):
                answer['visualTextureAudit'] = {'label-strokes': audit()}
                schema = read(folder / 'schema.json')
                part_schema = schema['$defs']['smallMaterialAuditEntry']['properties']['parts']['items']['properties']
                for row in answer['smallMaterialAudit'].values():
                    for part in row['parts']:
                        if 'deferredAppearance' in part_schema:
                            part['deferredAppearance'] = None
            overwrite(folder / 'draft.json', answer)
            receipt = read(folder / 'transport.json')
            receipt['responseSha256'] = digest(folder / 'draft.json')
            overwrite(folder / 'transport.json', receipt)

        call.fixture = fixture
        return call

    def test_delivery_root_and_nested_bind_exact_input_bytes(self):
        root = delivery.init(self.source, self.base / 'delivery', target='frozen',
                             visual_textures=self.input)
        nested = planning.init(root / '.dag/inputs/reference.png', root / 'planning', 12,
                               visual_textures=root / '.dag/inputs/visual-textures.json')
        expected = digest(self.input)
        for run in (root, nested):
            config = read(run / '.dag/config.json')
            self.assertEqual(config['visualTexturePolicy'], textures.POLICY)
            self.assertEqual(config['inputs'][textures.INPUT_NAME], expected)
            self.assertEqual((run / '.dag/inputs' / textures.INPUT_NAME).read_bytes(), self.input.read_bytes())
        delivery.DeliveryDag(root, self.model()).verify()
        # Individually valid child inputs still cannot diverge from the root.
        changed = copy.deepcopy(self.doc)
        changed['regions'][0]['appearance'] += ' Additional visible fleck.'
        overwrite(nested / '.dag/inputs' / textures.INPUT_NAME, changed)
        config = read(nested / '.dag/config.json')
        config['inputs'][textures.INPUT_NAME] = digest(nested / '.dag/inputs' / textures.INPUT_NAME)
        overwrite(nested / '.dag/config.json', config)
        overwrite(nested / '.dag/config-digest.json', {'sha256': digest(nested / '.dag/config.json')})
        with self.assertRaisesRegex(ValueError, 'VISUAL_TEXTURE_NESTED_RUN_MISMATCH'):
            delivery.DeliveryDag(root, self.model()).verify()

    def test_source_sha_and_canvas_errors_reject_before_run_creation(self):
        for field, value, error in (
                ('referenceSha256', '0' * 64, 'VISUAL_TEXTURE_REFERENCE_CHANGED'),
                ('canvas', [1001, 1000], 'VISUAL_TEXTURE_REFERENCE_COORDINATES')):
            changed = copy.deepcopy(self.doc)
            changed[field] = value
            self.write_input(changed)
            for kind in ('planning', 'delivery'):
                with self.subTest(field=field, kind=kind):
                    root = self.base / (field + kind)
                    with self.assertRaisesRegex(ValueError, error):
                        if kind == 'planning':
                            planning.init(self.source, root, 12, visual_textures=self.input)
                        else:
                            delivery.init(self.source, root, target='frozen', visual_textures=self.input)
                    self.assertFalse(root.exists())

    def test_legacy_no_input_adds_no_texture_metadata_or_audit_lane(self):
        roots = [self.new_run('legacy', bound=False),
                 delivery.init(self.source, self.base / 'legacy-delivery', target='frozen')]
        for root in roots:
            config = read(root / '.dag/config.json')
            self.assertNotIn('visualTexturePolicy', config)
            self.assertNotIn(textures.INPUT_NAME, config['inputs'])
            self.assertFalse((root / '.dag/inputs' / textures.INPUT_NAME).exists())
        schema = dict(type='object', properties={}, required=[])
        self.assertEqual(textures.bind_review_schema(schema, None, self.plan), schema)
        self.assertEqual(textures.assess(None, self.plan, {'issues': []}), ([], None))
        with self.assertRaisesRegex(ValueError, 'VISUAL_TEXTURE_UNEXPECTED_AUDIT'):
            textures.assess(None, self.plan, {'visualTextureAudit': {}})

    def test_missing_or_changed_request_pin_rejects_each_existing_stage(self):
        root = self.new_run()
        planning.Dag(root, self.model()).m1()
        expected = digest(self.input)
        self.assertEqual(read(root / 'request.json')['visualTexturesSha256'], expected)
        for name in ('request.json', 'm1/request.json', 'm2/request.json',
                     'repair/request.json', 'rereview/request.json'):
            path = root / name
            original = path.read_bytes() if path.exists() else None
            path.parent.mkdir(exist_ok=True)
            for pin in (None, 'f' * 64):
                with self.subTest(request=name, pin=pin):
                    value = {} if pin is None else {'visualTexturesSha256': pin}
                    overwrite(path, value)
                    with self.assertRaisesRegex(ValueError, 'VISUAL_TEXTURE_REQUEST_MISMATCH'):
                        textures.planning_input(root)
            if original is None:
                path.unlink()
            else:
                path.write_bytes(original)

    def test_region_schema_and_uncertain_audit_block_without_inventing_mapping(self):
        schema = textures.bind_review_schema(dict(type='object', properties={}, required=[]), self.doc, self.plan)
        self.assertIn('visualTextureAudit', schema['required'])
        self.assertEqual(schema['properties']['visualTextureAudit']['required'], ['label-strokes'])
        for value in ({}, {'wrong-region': audit()}):
            with self.assertRaisesRegex(ValueError, 'VISUAL_TEXTURE_AUDIT_IDS_REQUIRED'):
                textures.assess(self.doc, self.plan, {'visualTextureAudit': value})
        blockers, bindings = textures.assess(self.doc, self.plan,
            {'visualTextureAudit': {'label-strokes': audit('uncertain', None, None)}})
        self.assertEqual([row['code'] for row in blockers], ['VISUAL_TEXTURE_REVIEW_UNRESOLVED'])
        self.assertEqual(bindings['regions'], [])

    def test_confirmed_owner_mapping_requires_matching_owner_and_full_bounds(self):
        review = {'visualTextureAudit': {'label-strokes': audit()}}
        blockers, bindings = textures.assess(self.doc, self.plan, review)
        self.assertEqual(blockers, [])
        self.assertEqual(bindings['regions'][0]['materialId'], 'asset-panel')
        self.assertEqual(bindings['regions'][0]['objectId'], 'panel')
        self.assertEqual(bindings['regions'][0]['sourceBox'], self.doc['regions'][0]['sourceBox'])
        for mid, oid in [('asset-scene', 'panel'), ('asset-panel', 'crest'), ('missing', 'panel')]:
            with self.subTest(material=mid, object=oid):
                blockers, binding = textures.assess(self.doc, self.plan,
                    {'visualTextureAudit': {'label-strokes': audit(material=mid, object_id=oid)}})
                self.assertEqual(blockers[0]['code'], 'VISUAL_TEXTURE_REVIEW_UNRESOLVED')
                self.assertEqual(binding['regions'], [])

    def test_confirmation_preserves_real_unknowns_and_other_structural_blockers(self):
        before = copy.deepcopy(self.plan)
        review = dict(issues=[dict(code='visible_boundary_unknown', category='semantic',
            ids=['asset-panel'], description='The visible connector endpoint remains unclear.',
            suggestedChange='Inspect the source connector boundary.')],
            visualTextureAudit={'label-strokes': audit()})
        blockers, _ = split(review, self.plan, None, 'exact-fragments-v1', self.doc)
        self.assertIn('visible_boundary_unknown', [row['code'] for row in blockers])
        self.assertEqual(self.plan, before)
        self.assertTrue(self.plan['unknowns'])

    def test_texture_confirmation_does_not_exempt_exact_business_text_conflicts(self):
        plan = copy.deepcopy(self.plan)
        plan['materials'][1]['preserveText'] = ['Decorative Motto']
        entry = dict(artwork='Book heading', materialId='asset-panel',
                     evidence='The readable heading is business copy.', textFragments=['Recipes'])
        review = dict(issues=[], cosmeticIssues=[], planEvidenceProtocol=PROTOCOL_V3,
                      planEvidenceCatalogDigest=build_catalog(plan)['digest'],
                      visualTextureAudit={'label-strokes': audit()},
                      coverageAudit=[dict(region=name, observedArtwork=[], businessText=[entry] if index == 0 else [],
                          emptyRegionEvidence=None if index == 0 else 'No artwork here.')
                          for index, name in enumerate(REGIONS)])
        legacy = copy.deepcopy(review)
        legacy.pop('visualTextureAudit')
        self.assertEqual(split(legacy, plan, None, 'exact-fragments-v1'), ([], []))
        self.assertEqual(split(review, plan, None, 'exact-fragments-v1', self.doc), ([], []))
        plan['materials'][1]['preserveText'] = ['Recipes']
        for candidate in (legacy, review):
            candidate['planEvidenceCatalogDigest'] = build_catalog(plan)['digest']
        for candidate, doc in ((legacy, None), (review, self.doc)):
            with self.assertRaisesRegex(ValueError, 'COVERAGE_PRESERVED_TEXT_CONFLICT'):
                split(candidate, plan, None, 'exact-fragments-v1', doc)

    def test_offline_planning_repair_chain_pins_every_turn_and_freezes(self):
        root = self.new_run()
        model = self.model(repair=True)
        result = planning.Dag(root, model).execute()
        self.assertEqual(result['status'], 'frozen')
        self.assertEqual([name for name, _ in model.fixture.calls], ['m1', 'm2', 'repair', 'rereview'])
        expected = digest(self.input)
        for name in ('m1', 'm2', 'repair', 'rereview'):
            request = root / name / 'request.json'
            if name == 'm1':
                request = root / 'request.json'
            self.assertEqual(read(request)['visualTexturesSha256'], expected)
            self.assertIn('label-strokes', (root / name / 'prompt.md').read_text(encoding='utf-8'))
        self.assertIn('visualTextureAudit', read(root / 'm2/schema.json')['required'])
        self.assertIn('visualTextureAudit', read(root / 'rereview/schema.json')['required'])


if __name__ == '__main__':
    unittest.main()
