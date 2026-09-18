import unittest

from ai_ui_decomposition.layout_gate import require_planning_coverage


class PlanningCoverageTests(unittest.TestCase):
    def fixture(self):
        document = {'root': {'id': 'root', 'type': 'Container', 'children': [
            {'id': 'panel', 'type': 'Panel', 'props': {}},
            {'id': 'tabs', 'type': 'Tabs', 'props': {}},
            {'id': 'label', 'type': 'Text', 'props': {'text': 'Title'}},
        ]}}
        requirements = {'kind': 'ui_layout_requirements_v1',
                        'panels': [{'componentId': 'panel'}], 'selects': [],
                        'buttons': [], 'textBackgrounds': [{'componentId': 'label'}]}
        observations = {'texts': [{'componentId': 'tabs'}, {'componentId': 'label'}]}
        return document, requirements, observations

    def test_missing_panel_declaration_fails_before_materials_exist(self):
        document, requirements, observations = self.fixture()
        requirements['panels'] = []
        with self.assertRaisesRegex(ValueError, 'LAYOUT_REQUIREMENTS_COVERAGE:panels'):
            require_planning_coverage(document, requirements, observations)

    def test_non_text_control_labels_require_observation(self):
        document, requirements, observations = self.fixture()
        observations['texts'] = [{'componentId': 'label'}]
        with self.assertRaisesRegex(ValueError, 'VISUAL_TEXT_COVERAGE_MISSING'):
            require_planning_coverage(document, requirements, observations)

    def test_complete_inventory_is_accepted(self):
        require_planning_coverage(*self.fixture())
