"""Offline gate checks; fixture statuses do not establish visual or semantic truth."""
import _bootstrap
import copy
import json
import unittest

from jsonschema import Draft202012Validator, ValidationError

from ai_ui_layers.compile_visual import verify_run
from ai_ui_layers.evaluate import digest, read
from ai_ui_layers.freeze_visual import freeze
from ai_ui_layers.planning_dag import Dag
from ai_ui_layers.planning_review_policy import signatures, split
from test_planning_dag import FakeModel, SID
import test_planning_dag


def review_part(quote, status=None, visible='Linked two-ended mark'):
    part = dict(visiblePart=visible,
                observedAppearance='Two dark ends joined by a bar with a visible opening',
                planEvidenceQuote=quote,
                suggestedChange='Clarify the observed connection and opening.')
    if status is not None:
        part['descriptionStatus'] = status
    return part


def review_for(parts):
    return dict(issues=[], smallMaterialAudit={'mark': dict(
        boundary=dict(status='complete', evidence='All four visible contour sides are inside.'),
        parts=parts)})


PLAN = dict(materials=[dict(id='mark', label='Two dark ends joined by a straight bar with an open center.')],
            objects=[])
QUOTE = 'Two dark ends joined by a straight bar'


class SmallDescriptionPolicyTests(unittest.TestCase):
    def test_valid_literal_quote_with_nonconsistent_status_blocks(self):
        for status in ('missing', 'conflicting', 'uncertain'):
            with self.subTest(status=status):
                blockers, warnings = split(review_for([review_part(QUOTE, status)]), PLAN)
                self.assertEqual(warnings, [])
                self.assertEqual([issue['code'] for issue in blockers],
                                 ['SMALL_MATERIAL_DESCRIPTION_REVIEW'])
                self.assertEqual(blockers[0]['category'], 'semantic')
                self.assertEqual(blockers[0]['ids'], ['mark'])

    def test_missing_or_foreign_quote_keeps_legacy_undescribed_precedence(self):
        for quote in ('', 'A phrase absent from this owner and its objects'):
            for status in ('consistent', 'conflicting', 'uncertain'):
                with self.subTest(quote=quote, status=status):
                    blockers, _ = split(review_for([review_part(quote, status)]), PLAN)
                    self.assertEqual([issue['code'] for issue in blockers],
                                     ['UNDESCRIBED_SMALL_MATERIAL_PART'])

    def test_historical_part_without_status_retains_literal_quote_behavior(self):
        self.assertEqual(split(review_for([review_part(QUOTE)]), PLAN)[0], [])
        blockers, _ = split(review_for([review_part('not in the plan')]), PLAN)
        self.assertEqual([issue['code'] for issue in blockers],
                         ['UNDESCRIBED_SMALL_MATERIAL_PART'])

    def test_equivalent_wording_with_consistent_status_is_not_keyword_blocked(self):
        # The reviewer status is fixture data; the gate checks ownership and the
        # literal quote, not lexical similarity to observedAppearance.
        part = review_part(QUOTE, 'consistent')
        part['observedAppearance'] = 'A bridge joins both tips; daylight remains in the middle.'
        self.assertEqual(split(review_for([part]), PLAN)[0], [])

    def test_cosmetic_wording_issue_cannot_demote_conflicting_description(self):
        review = review_for([review_part(QUOTE, 'conflicting')])
        review['issues'] = [dict(code='DESCRIPTION_WORDING', category='cosmetic',
                                 ids=['mark'], description='Minor wording preference.',
                                 suggestedChange='Polish wording if needed.')]
        blockers, warnings = split(review, PLAN)
        self.assertEqual([issue['code'] for issue in blockers],
                         ['SMALL_MATERIAL_DESCRIPTION_REVIEW'])
        self.assertEqual([issue['code'] for issue in warnings], ['DESCRIPTION_WORDING'])

    def test_two_distinct_parts_retain_distinct_issue_signatures(self):
        parts = [review_part(QUOTE, 'conflicting', 'Connected outer contour'),
                 review_part(QUOTE, 'conflicting', 'Small central opening')]
        blockers, _ = split(review_for(parts), PLAN)
        self.assertEqual(len(blockers), 2)
        self.assertEqual({issue['code'] for issue in blockers},
                         {'SMALL_MATERIAL_DESCRIPTION_REVIEW'})
        self.assertEqual(len(signatures(blockers)), 2)


class SmallDescriptionDagTests(unittest.TestCase):
    def setUp(self):
        test_planning_dag.DagTests.setUp(self)

    def model(self, statuses=None, malformed=None):
        base = FakeModel()
        statuses = statuses or {}

        def call(folder, sid, first):
            base(folder, sid, first)
            if folder.name not in ('m2', 'rereview', 'rereview2'):
                return
            answer = read(folder/'draft.json')
            for row in answer['smallMaterialAudit'].values():
                for part in row['parts']:
                    part['descriptionStatus'] = 'consistent'
            chosen = next(iter(answer['smallMaterialAudit'].values()))['parts'][0]
            if folder.name in statuses:
                chosen['descriptionStatus'] = statuses[folder.name]
            if folder.name == 'm2' and malformed == 'missing':
                del chosen['descriptionStatus']
            elif folder.name == 'm2' and malformed == 'invalid':
                chosen['descriptionStatus'] = 'approved-by-keyword'
            (folder/'draft.json').write_text(json.dumps(answer, ensure_ascii=False), encoding='utf-8')
            receipt = read(folder/'transport.json')
            receipt['responseSha256'] = digest(folder/'draft.json')
            (folder/'transport.json').write_text(json.dumps(receipt, ensure_ascii=False), encoding='utf-8')

        return base, call

    def test_new_schema_requires_bounded_description_status(self):
        base, call = self.model()
        result = Dag(self.root, call).execute()
        self.assertEqual(result['status'], 'frozen')
        self.assertEqual([name for name, _ in base.calls], ['m1', 'm2'])
        schema = read(self.root/'m2/schema.json')
        part_schema = schema['$defs']['smallMaterialAuditEntry']['properties']['parts']['items']
        self.assertIn('descriptionStatus', part_schema['required'])
        self.assertEqual(set(part_schema['properties']['descriptionStatus']['enum']),
                         {'consistent', 'missing', 'conflicting', 'uncertain'})
        validator = Draft202012Validator(schema)
        answer = read(self.root/'m2/draft.json')
        validator.validate(answer)
        for bad in ('missing', 'invalid'):
            with self.subTest(bad=bad):
                changed = copy.deepcopy(answer)
                part = next(iter(changed['smallMaterialAudit'].values()))['parts'][0]
                if bad == 'missing':
                    del part['descriptionStatus']
                else:
                    part['descriptionStatus'] = 'approved-by-keyword'
                with self.assertRaises(ValidationError):
                    validator.validate(changed)

    def test_missing_or_invalid_status_fails_closed_before_repair(self):
        for malformed in ('missing', 'invalid'):
            with self.subTest(malformed=malformed):
                # Each fixture has its own run; a failed node is never replayed.
                if malformed == 'invalid':
                    test_planning_dag.DagTests.setUp(self)
                base, call = self.model(malformed=malformed)
                dag = Dag(self.root, call)
                with self.assertRaises(ValidationError):
                    dag.execute()
                self.assertEqual([name for name, _ in base.calls], ['m1', 'm2'])
                self.assertFalse((self.root/'repair').exists())
                self.assertFalse((self.root/'frozen').exists())
                with self.assertRaisesRegex(ValueError, 'NO_RESUBMIT'):
                    dag.execute()
                self.assertEqual(len(base.calls), 2)

    def test_conflicting_quote_cannot_freeze_with_empty_model_issues(self):
        _, call = self.model(statuses={'m2': 'conflicting'})
        dag = Dag(self.root, call)
        dag.node('m1', dag.m1)
        dag.node('check', dag.check)
        dag.node('m2', lambda: dag.review('m2', self.root/'m1/draft.json',
                                        self.root/'m1/preview/materials-overlay.png'))
        self.assertEqual(read(self.root/'m2/draft.json')['issues'], [])
        self.assertIn('SMALL_MATERIAL_DESCRIPTION_REVIEW',
                      [item['code'] for item in read(self.root/'m2/assessment.json')['blockers']])
        with self.assertRaisesRegex(ValueError, 'M2_UNRESOLVED'):
            verify_run(self.root)
        with self.assertRaisesRegex(ValueError, 'M2_UNRESOLVED'):
            freeze(self.root, self.root/'direct-freeze', 8)
        self.assertFalse((self.root/'direct-freeze').exists())

    def test_repeated_description_conflict_stops_after_one_repair_and_four_calls(self):
        base, call = self.model(statuses={'m2': 'conflicting', 'rereview': 'conflicting'})
        dag = Dag(self.root, call)
        with self.assertRaisesRegex(ValueError, 'REREVIEW_UNRESOLVED'):
            dag.execute()
        self.assertEqual(base.calls, [('m1', None), ('m2', SID),
                                      ('repair', SID), ('rereview', SID)])
        self.assertFalse((self.root/'frozen').exists())
        with self.assertRaisesRegex(ValueError, 'NO_RESUBMIT'):
            dag.execute()
        self.assertEqual(len(base.calls), 4)

    def test_consistent_rereview_freezes_in_same_session_after_four_calls(self):
        base, call = self.model(statuses={'m2': 'uncertain'})
        result = Dag(self.root, call).execute()
        self.assertEqual(result['status'], 'frozen')
        self.assertEqual(base.calls, [('m1', None), ('m2', SID),
                                      ('repair', SID), ('rereview', SID)])
        self.assertEqual(read(self.root/'rereview/draft.json')['issues'], [])
        self.assertEqual(read(self.root/'rereview/assessment.json')['blockers'], [])
        self.assertTrue((self.root/'frozen').is_dir())


if __name__ == '__main__':
    unittest.main()
