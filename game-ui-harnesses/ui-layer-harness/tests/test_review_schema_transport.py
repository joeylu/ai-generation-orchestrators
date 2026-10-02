"""Inspect real M1/M2 schemas at the injected model boundary, without a CLI call."""
import _bootstrap
import copy
import json
from pathlib import Path
import tempfile
import unittest

from jsonschema import Draft202012Validator
from PIL import Image

from ai_ui_layers.codex_call import transport_schema
from ai_ui_layers.evaluate import digest, read
from ai_ui_layers.planning_dag import Dag, init
from ai_ui_layers.planning_review_policy import split
from test_planning_dag import FakeModel


FORBIDDEN = {'allOf', 'if', 'then', 'else'}


def unsupported_keys(value):
    if isinstance(value, dict):
        return (set(value) & FORBIDDEN).union(*(
            unsupported_keys(child) for child in value.values()))
    if isinstance(value, list):
        return set().union(*(unsupported_keys(child) for child in value))
    return set()


def overwrite(path, value):
    Path(path).write_text(json.dumps(value, ensure_ascii=False), encoding='utf-8')


class ReviewSchemaTransportTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name)
        self.source = self.base / 'source.png'
        Image.new('RGB', (1000, 1000), (20, 30, 40)).save(self.source)

    def run_fixture(self, with_policy):
        policy = dict(kind='ui_visual_policy_v1', appearanceEvidence='bound-reference',
                      minorColor='record', shadow='optional') if with_policy else None
        path = self.base / 'visual-policy.json'
        if policy is not None:
            path.write_text(json.dumps(policy), encoding='utf-8')
        root = init(self.source, self.base / ('policy-run' if with_policy else 'legacy-run'),
                    16, 'sheets', generation_reference='context-crops' if with_policy else 'full',
                    visual_policy=path if with_policy else None)
        fixture = FakeModel()
        seen = []

        def model(folder, sid, first):
            schema = read(folder / 'schema.json')
            checked=transport_schema(schema)
            if with_policy or first:self.assertEqual(checked, schema)
            self.assertEqual(unsupported_keys(schema), set())
            seen.append(folder.name)
            if folder.name == 'm2':
                part_schema = schema['$defs']['smallMaterialAuditEntry']['properties']['parts']['items']
                if with_policy:
                    self.assertIn('deferredAppearance', part_schema['required'])
                    self.assertIn('deferredAppearance', part_schema['properties'])
                    self.assertEqual(part_schema['properties']['deferredAppearance']['type'], ['string','null'])
                    self.assertIn('reference-bound', part_schema['properties']['descriptionStatus']['enum'])
                else:
                    self.assertNotIn('deferredAppearance', part_schema['properties'])
                    self.assertNotIn('reference-bound', part_schema['properties']['descriptionStatus']['enum'])
            fixture(folder, sid, first)
            if with_policy and folder.name == 'm2':
                answer = read(folder / 'draft.json')
                for row in answer['smallMaterialAudit'].values():
                    for part in row['parts']:
                        part['deferredAppearance'] = None
                first_part = next(iter(answer['smallMaterialAudit'].values()))['parts'][0]
                first_part['descriptionStatus'] = 'reference-bound'
                first_part['deferredAppearance'] = 'Fine source-pixel surface flecks.'
                Draft202012Validator(schema).validate(answer)
                overwrite(folder / 'draft.json', answer)
                receipt = read(folder / 'transport.json')
                receipt['responseSha256'] = digest(folder / 'draft.json')
                overwrite(folder / 'transport.json', receipt)

        result = Dag(root, model).execute()
        self.assertEqual(result['status'], 'frozen')
        self.assertEqual(seen, ['m1', 'm2'])
        self.assertEqual([name for name, _ in fixture.calls], ['m1', 'm2'])
        return root, policy

    def test_bound_reference_schema_is_transport_safe_and_semantics_stay_strict(self):
        root, policy = self.run_fixture(True)
        schema = read(root / 'm2/schema.json')
        answer = read(root / 'm2/draft.json')
        plan = read(root / 'm1/draft.json')
        blockers, warnings = split(answer, plan, policy)
        self.assertFalse(blockers)
        self.assertEqual([finding['code'] for finding in warnings],
                         ['REFERENCE_BOUND_APPEARANCE'])
        first_part = next(iter(answer['smallMaterialAudit'].values()))['parts'][0]
        self.assertEqual(first_part['descriptionStatus'], 'reference-bound')
        for missing in (None, ''):
            with self.subTest(deferredAppearance=missing):
                changed = copy.deepcopy(answer)
                next(iter(changed['smallMaterialAudit'].values()))['parts'][0]['deferredAppearance'] = missing
                with self.assertRaises(ValueError):
                    split(changed, plan, policy)
        changed = copy.deepcopy(answer)
        first = next(iter(changed['smallMaterialAudit'].values()))['parts'][0]
        first['descriptionStatus'] = 'consistent'
        first['deferredAppearance'] = 'A non-null surface claim.'
        with self.assertRaises(ValueError):
            split(changed, plan, policy)
        self.assertEqual(transport_schema(schema), schema)

    def test_no_policy_m2_schema_retains_original_part_fields(self):
        root, _ = self.run_fixture(False)
        schema = read(root / 'm2/schema.json')
        part = schema['$defs']['smallMaterialAuditEntry']['properties']['parts']['items']
        self.assertNotIn('deferredAppearance', part['properties'])
        self.assertNotIn('deferredAppearance', part['required'])
        self.assertEqual(set(schema['$defs']['smallMaterialAuditEntry']['required']), {'parts','boundary'})


if __name__ == '__main__':
    unittest.main()
