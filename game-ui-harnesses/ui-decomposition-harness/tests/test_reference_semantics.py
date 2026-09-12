import copy
import unittest

from ai_ui_decomposition.common import ContractError
from ai_ui_decomposition.reference_semantics import visible_only


class VisibleContentPolicyTests(unittest.TestCase):
    def facts(self):
        return {'kind': 'ui_visible_content_facts_v1',
                'scrollViews': [{'id': 'inventory', 'viewport': [463, 649],
                                 'knownItemBounds': [[0, i*109, 463, 104] for i in range(6)]}],
                'selects': [{'id': 'category', 'selectedId': 'all',
                             'observedOptions': [{'id': 'all', 'label': 'ALL ITEMS'}]}]}

    def test_six_visible_rows_do_not_invent_short_thumb_overflow(self):
        facts = self.facts()
        before = copy.deepcopy(facts)
        result = visible_only(facts)
        scroll = result['scrollViews'][0]
        self.assertEqual((scroll['contentHeight'], scroll['scrollRangeY'], scroll['thumbRatioY']),
                         (649, 0, 1))
        self.assertEqual(result['selects'][0]['options'], facts['selects'][0]['observedOptions'])
        self.assertFalse(result['human_visual_acceptance'])
        self.assertEqual(facts, before)

    def test_known_partial_item_establishes_only_its_actual_extent(self):
        facts = self.facts()
        facts['scrollViews'][0]['viewport'][1] = 600
        scroll = visible_only(facts)['scrollViews'][0]
        self.assertEqual(scroll['contentHeight'], 649)
        self.assertEqual(scroll['scrollRangeY'], 49)

    def test_unknown_options_cannot_be_fabricated(self):
        facts = self.facts()
        facts['selects'][0]['observedOptions'] = []
        with self.assertRaisesRegex(ContractError, 'VISIBLE_OPTIONS_REQUIRED'):
            visible_only(facts)

    def test_nonfinite_extent_and_horizontal_overflow_fail(self):
        for width, code in [(float('nan'), 'VISIBLE_ITEM_BOUNDS'),
                            (464, 'HORIZONTAL_SCROLL')]:
            with self.subTest(width=width):
                facts = self.facts()
                facts['scrollViews'][0]['knownItemBounds'][0][2] = width
                with self.assertRaisesRegex(ContractError, code):
                    visible_only(facts)

    def test_missing_selected_value_is_not_silently_defaulted(self):
        facts = self.facts()
        facts['selects'][0]['selectedId'] = 'weapons'
        with self.assertRaisesRegex(ContractError, 'VISIBLE_SELECTION_REQUIRED'):
            visible_only(facts)
