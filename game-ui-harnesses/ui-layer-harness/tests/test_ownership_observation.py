import _bootstrap
import copy
import unittest

from jsonschema import Draft202012Validator

from ai_ui_layers import ownership_observation as ownership
from ai_ui_layers.context_references import action_entry, geometry


def fixture():
    materials = []
    objects = []
    assets = []
    for mid, kind, z, box in (
            ('parent', 'panel', 2, [.2, .2, .8, .8]),
            ('under', 'panel', 1, [.1, .1, .9, .9]),
            ('child', 'card', 3, [.3, .3, .5, .5]),
            ('peer', 'icon', 2, [.6, .6, .7, .7]),
            ('rim', 'icon', 3, [.805, .4, .82, .45]),
            ('far', 'icon', 3, [.95, .4, .98, .45])):
        materials.append(dict(id=mid, role='foreground', label=mid,
                              bboxNorm=box, zOrder=z, preserveText=[]))
        objects.append(dict(id=mid+'-art', materialId=mid, kind=kind,
                            label='same pictogram' if kind == 'icon' else mid, bboxNorm=box))
        l, t, r, b = [round(value*1000) for value in box]
        assets.append(dict(id=mid, role='important_component', source_region=[l, t, r, b],
                           output_size=[r-l, b-t]))
    return dict(materials=materials, objects=objects), dict(canvas=[1000, 1000], assets=assets)


def complete(document):
    return [dict(materialId=entry['materialId'],
        owned=[dict(objectId=row['objectId'], state='complete', evidence='Owned contour observed.')
               for row in entry['owned']],
        foreign=[dict(materialId=row['materialId'], objectId=row['objectId'], state='absent',
                      evidence='Foreign artwork absent in output.') for row in entry['foreign']])
        for entry in document['entries']]


class OwnershipObservationTests(unittest.TestCase):
    def setUp(self):
        self.visual, self.plan = fixture()
        self.document = ownership.inventory(self.visual, self.plan, ['parent'])

    def test_legacy_missing_text_exception_does_not_mutate_ownership_plan(self):
        visual=copy.deepcopy(self.visual)
        for row in visual['materials']:row.pop('preserveText')
        before=copy.deepcopy(visual)
        self.assertEqual(ownership.inventory(visual,self.plan,['parent']),self.document)
        self.assertEqual(visual,before)

    def test_catalog_matches_real_context_compiler_including_rim_and_depth(self):
        asset = self.plan['assets'][0]
        source = action_entry(self.visual, self.visual['materials'][0], asset,
                              geometry(asset, self.plan['canvas']), self.plan['canvas'], 0)
        entry = self.document['entries'][0]
        self.assertEqual(entry['targetKind'], 'clean-plate')
        self.assertEqual({row['objectId'] for row in entry['owned']},
                         {row['id'] for row in source['keepOnly']})
        self.assertEqual({(row['materialId'], row['objectId']) for row in entry['foreign']},
                         {(owner['materialId'], member['id']) for owner in source['exclude']
                          for member in owner['members']})
        self.assertEqual({row['materialId']: row['relation'] for row in entry['foreign']},
                         dict(under='underlay', child='overlay', peer='same-depth', rim='overlay'))
        self.assertNotIn('far-art', [row['objectId'] for row in entry['foreign']])

    def test_foreign_presence_and_uncertainty_block_clean_plate(self):
        for state in ('present', 'uncertain'):
            with self.subTest(state=state):
                observations = complete(self.document)
                observations[0]['foreign'][0]['state'] = state
                result = ownership.assess(self.document, observations)
                self.assertTrue(result['declarationsOnly'])
                self.assertEqual(len(result['blockers']), 1)
                self.assertEqual(result['blockers'][0]['state'], state)
                self.assertEqual(result['blockers'][0]['scope'], 'foreign')

    def test_missing_or_uncertain_owned_blocks(self):
        for state in ('missing', 'uncertain'):
            observations = complete(self.document)
            observations[0]['owned'][0]['state'] = state
            self.assertEqual(ownership.assess(self.document, observations)['blockers'][0]['scope'], 'owned')

    def test_empty_observations_and_empty_findings_cannot_claim_coverage(self):
        with self.assertRaises(ValueError):
            ownership.assess(self.document, [])
        schema = ownership.extend_schema(dict(type='object', additionalProperties=False,
            required=['findings'], properties=dict(findings=dict(type='array'))), self.document)
        self.assertFalse(Draft202012Validator(schema).is_valid(dict(findings=[])))
        self.assertTrue(Draft202012Validator(schema).is_valid(
            dict(findings=[], ownershipObservations=complete(self.document))))

    def test_missing_duplicate_and_cross_owner_declarations_rejected(self):
        for scope in ('owned', 'foreign'):
            observations = complete(self.document)
            observations[0][scope].pop()
            with self.assertRaises(ValueError):
                ownership.assess(self.document, observations)
            observations = complete(self.document)
            observations[0][scope].append(copy.deepcopy(observations[0][scope][0]))
            with self.assertRaises(ValueError):
                ownership.assess(self.document, observations)
        observations = complete(self.document)
        observations[0]['foreign'][0]['materialId'] = 'child'
        with self.assertRaises(ValueError):
            ownership.assess(self.document, observations)
        observations = complete(self.document)
        observations[0]['owned'][0]['objectId'] = 'child-art'
        with self.assertRaises(ValueError):
            ownership.assess(self.document, observations)

    def test_identical_instances_kept_separate(self):
        foreign = self.document['entries'][0]['foreign']
        same = [row for row in foreign if row['appearance'] == 'same pictogram']
        self.assertEqual({row['objectId'] for row in same}, {'peer-art', 'rim-art'})
        observations = complete(self.document)
        observations[0]['foreign'] = [row for row in observations[0]['foreign'] if row['objectId'] != 'rim-art']
        with self.assertRaises(ValueError):
            ownership.assess(self.document, observations)

    def test_multi_material_coverage_and_duplicate_entry(self):
        document = ownership.inventory(self.visual, self.plan, ['parent', 'child'])
        observations = complete(document)
        self.assertEqual(ownership.assess(document, observations)['blockers'], [])
        observations[1] = copy.deepcopy(observations[0])
        with self.assertRaises(ValueError):
            ownership.assess(document, observations)
        with self.assertRaises(ValueError):
            ownership.inventory(self.visual, self.plan, ['parent', 'parent'])
        with self.assertRaises(ValueError):
            ownership.inventory(self.visual, self.plan, ['unknown'])

    def test_schema_is_copied_and_evidence_cannot_be_blank(self):
        base = dict(type='object', required=['findings'], properties=dict(findings=dict(type='array')))
        before = copy.deepcopy(base)
        ownership.extend_schema(base, self.document)
        self.assertEqual(base, before)
        for evidence in ('', '  \n'):
            observations = complete(self.document)
            observations[0]['owned'][0]['evidence'] = evidence
            with self.assertRaises(ValueError):
                ownership.assess(self.document, observations)

    def test_prompt_preserves_true_holes_without_inventing_masks(self):
        prompt = ownership.review_prompt(self.document)
        self.assertIn('Preserve genuine owned holes and translucency', prompt)
        self.assertIn('never infer a hole or erase mask from reference boxes', prompt)
        self.assertIn('significant glow', prompt)
        self.assertIn('rim-art', prompt)
        self.assertFalse(any('mask' in key or 'hole' in key for key in self.document['entries'][0]))

    def test_bad_source_ownership_rejected(self):
        visual = copy.deepcopy(self.visual)
        visual['objects'].append(copy.deepcopy(visual['objects'][0]))
        with self.assertRaises(ValueError):
            ownership.inventory(visual, self.plan, ['parent'])
        visual = copy.deepcopy(self.visual)
        visual['objects'][0]['materialId'] = 'unregistered'
        with self.assertRaises(ValueError):
            ownership.inventory(visual, self.plan, ['parent'])


if __name__ == '__main__':
    unittest.main()
