import copy
import json
from pathlib import Path
import unittest
import re
from ai_ui_decomposition.component_handoff import _validate_state_text_colors
from ai_ui_decomposition.common import ContractError


class StateTextColorTests(unittest.TestCase):
    def test_published_schema_colors_and_optional_fields(self):
        schema = json.loads((Path(__file__).parents[1] / 'references/select-tabs-states.schema.json').read_text())
        pattern = schema['$defs']['color']['pattern']
        for color in ['#fff', '#FFF8DF']:
            self.assertIsNotNone(re.search(pattern, color))
        for color in ['#fff\n', '#12345678', 'white', None]:
            if isinstance(color, str): self.assertIsNone(re.search(pattern, color))
        self.assertNotIn('activeTextColor', schema['$defs']['tabs']['required'])
        self.assertNotIn('fieldTextColor', schema['$defs']['select']['required'])

    def fixture(self):
        return json.loads((Path(__file__).parent / 'fixtures/quest-journal-state-colors.json').read_text())

    def test_confirmed_fixture_preserved_and_scroll_is_semantic(self):
        value = self.fixture(); before = copy.deepcopy(value)
        _validate_state_text_colors(value)
        self.assertEqual(value, before)
        for row in value['bindings']:
            self.assertIn('#FFF8DF', next(iter(row['states'].values())).values())
        scroll = value['scroll']
        self.assertEqual(scroll['viewport']['height'], 596)
        self.assertEqual(scroll['contentHeight'], 600)
        self.assertAlmostEqual(scroll['thumbPositions']['max']['y'] - 37, 524 * (1 - 596 / 600))

    def test_optional_legacy_and_rgb_colors(self):
        for index, state, field in [(0, 'tabs', 'activeTextColor'), (1, 'select', 'fieldTextColor')]:
            for color in ['#fff', '#AbC', '#123456', '#aBcDeF', 'absent']:
                value = self.fixture()
                if color == 'absent': del value['bindings'][index]['states'][state][field]
                else: value['bindings'][index]['states'][state][field] = color
                _validate_state_text_colors(value)

    def test_native_tabs_items_preserved_for_official_consumer_validation(self):
        value = self.fixture()
        value['bindings'][0]['states']['tabs']['items'] = [{
            'tabId': 'active',
            'layout': {'coordinateSpace': 'target-component-local', 'x': 0, 'y': 0, 'width': 238, 'height': 65},
            'labelLayout': {'coordinateSpace': 'target-item-local', 'x': 80, 'y': 14, 'width': 150, 'height': 39},
            'hitArea': {'coordinateSpace': 'target-item-local', 'x': 0, 'y': 0, 'width': 238, 'height': 65}}]
        before = copy.deepcopy(value)
        _validate_state_text_colors(value)
        self.assertEqual(value, before)
        schema = json.loads((Path(__file__).parents[1] / 'references/select-tabs-states.schema.json').read_text())
        self.assertIn('items', schema['$defs']['tabs']['properties'])

    def test_invalid_colors_and_typos_rejected(self):
        for index, state, field in [(0, 'tabs', 'activeTextColor'), (1, 'select', 'fieldTextColor')]:
            for color in [None, 123, True, '', 'white', '#12', '#1234', '#12345678', '#GGG', '#fff\n', ' #fff']:
                with self.subTest(field=field, color=color):
                    value = self.fixture(); value['bindings'][index]['states'][state][field] = color
                    with self.assertRaisesRegex(ContractError, 'STATE_COLOR_INVALID'): _validate_state_text_colors(value)
            value = self.fixture(); value['bindings'][index]['states'][state]['textColour'] = '#fff'
            with self.assertRaisesRegex(ContractError, 'UNKNOWN_STATE_FIELD'): _validate_state_text_colors(value)
