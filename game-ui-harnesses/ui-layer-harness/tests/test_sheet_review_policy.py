import _bootstrap
import unittest
from jsonschema import ValidationError
from ai_ui_layers.sheet_review_policy import classify


def observation(**changes):
    finding=dict(materialId='card',category='progress',referenceState='full',
                 generatedState='near-full',magnitude='minor',ownership='clear',
                 evidence='Generated bar leaves a small gap.',suggestion='Optional correction.')
    finding.update(changes)
    return dict(materialIds=['card'],findings=[finding])


class SeverityTests(unittest.TestCase):
    def test_full_near_full_cannot_be_promoted_by_model_magnitude(self):
        for magnitude in ('minor','major','uncertain'):
            for a,b in [('full','near-full'),('near-full','full')]:
                result=classify(observation(referenceState=a,generatedState=b,magnitude=magnitude),['card'])
                self.assertFalse(result['blockers']);self.assertEqual(len(result['warnings']),1)

    def test_major_or_unknown_progress_still_blocks(self):
        for changes in [dict(generatedState='empty'),dict(generatedState='partial'),
                        dict(generatedState='unknown'),dict(referenceState='partial',generatedState='partial',magnitude='major')]:
            result=classify(observation(**changes),['card'])
            self.assertTrue(result['blockers']);self.assertFalse(result['warnings'])

    def test_ambiguous_contour_is_not_attributed_to_generation(self):
        result=classify(observation(category='geometry',referenceState='not-applicable',
            generatedState='not-applicable',ownership='ambiguous'),['card'])
        self.assertEqual(result['blockers'][0]['attribution'],'planning-or-localization-unresolved')

    def test_damage_cannot_be_softened_by_minor_magnitude(self):
        for category in ('identity','missing-artwork','extra-artwork','clipping','text-policy','geometry','layout'):
            self.assertTrue(classify(observation(category=category,referenceState='not-applicable',
                generatedState='not-applicable'),['card'])['blockers'])

    def test_invalid_or_injected_severity_fails_closed(self):
        for changes in (dict(category='other'),dict(severity='warning')):
            with self.assertRaises(ValidationError):classify(observation(**changes),['card'])
        with self.assertRaisesRegex(ValueError,'STATE_CATEGORY'):
            classify(observation(category='geometry'),['card'])
        with self.assertRaisesRegex(ValueError,'MATERIAL_MISMATCH'):
            classify(observation(materialId='foreign'),['card'])
        with self.assertRaisesRegex(ValueError,'IDENTITY_MISMATCH'):
            classify(observation(),['other'])
