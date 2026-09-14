"""Panel is a static surface, including when nested in a closed Dialog."""
import unittest
from ai_ui_decomposition.delivery_check import select_default_parts


class PanelDeliveryTests(unittest.TestCase):
    def test_panel_selects_all_bound_surfaces_without_invented_states(self):
        for roles in [('background', 'header'), ('background', 'header', 'body')]:
            panel = dict(id='panel', type='Panel', props={'title': 'CHARACTER'})
            binding = {'bindings': [dict(componentId='panel', parts=[
                dict(role=role, layerId=role) for role in roles])]}
            result = select_default_parts({'root': panel}, binding)
            self.assertEqual(result['issues'], [])
            self.assertEqual([p['layerId'] for p in result['selected']], list(roles))
            self.assertEqual(result['standby'], [])

    def test_closed_dialog_hides_nested_panel_surfaces(self):
        panel = dict(id='panel', type='Panel', props={'title': 'CHARACTER'})
        root = dict(id='modal', type='Dialog', props={'open': False}, children=[panel])
        binding = {'bindings': [dict(componentId='panel', parts=[
            dict(role='background', layerId='frame'), dict(role='header', layerId='header')])]}
        result = select_default_parts({'root': root}, binding)
        self.assertEqual(result['issues'], [])
        self.assertEqual(result['selected'], [])
        self.assertEqual([p['layerId'] for p in result['standby']], ['frame', 'header'])
