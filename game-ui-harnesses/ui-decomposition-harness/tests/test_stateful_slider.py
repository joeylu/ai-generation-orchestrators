import copy
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from ai_ui_decomposition.common import ContractError
from ai_ui_decomposition.stateful_slider import slider_geometry, progress_geometry


def fixture():
    return {'layout': {'width': 240, 'height': 50}, 'props': {
        'min': 0, 'max': 100, 'step': 10, 'appearance': {
            'sourceCanvas': {'width': 240, 'height': 50},
            'thumbPositions': {'min': {'x': 10, 'y': 10}, 'max': {'x': 210, 'y': 10}},
            'thumbCanvas': {'width': 20, 'height': 30},
            'fillClip': {'x': 10, 'y': 20, 'width': 220, 'height': 10}}}}


class SliderStateTests(unittest.TestCase):
    def test_progress_initial_visible_ratios_and_zero_full_clipping(self):
        for value in [78, 42, 65]:
            node = fixture(); node['props']['value'] = value
            for name, expected in [('initial', value), ('empty', 0), ('middle', 50), ('full', 100)]:
                geometry = progress_geometry(node, name)
                self.assertEqual(geometry['value'], expected)
                self.assertAlmostEqual(geometry['fillClip'][2], 220 * expected / 100)

    def test_progress_invalid_max_fails(self):
        node = fixture(); node['props'].update(value=40, max=0)
        with self.assertRaisesRegex(ContractError, 'STATE_PROGRESS_SEMANTICS_INVALID'):
            progress_geometry(node, 'initial')

    def test_endpoint_middle_and_clip_are_independent_of_thumb_size(self):
        node = fixture(); original = copy.deepcopy(node)
        for name, ratio in [('min', 0), ('middle', .5), ('max', 1)]:
            result = slider_geometry(node, name)
            self.assertEqual(result['value'], ratio * 100)
            self.assertEqual(result['thumb'], [10 + ratio * 200, 10, 20, 30])
            self.assertEqual(result['fillClip'], [10, 20, ratio * 220, 10])
        self.assertEqual(node, original)

    def test_midpoint_snaps_up_on_half_step(self):
        node = fixture(); node['props'].update(min=0, max=90, step=10)
        self.assertEqual(slider_geometry(node, 'middle')['value'], 50)

    def test_decimal_step_and_nonzero_min(self):
        node = fixture(); node['props'].update(min=-.2, max=.8, step=.1)
        self.assertEqual(slider_geometry(node, 'middle')['value'], .3)

    def test_scientific_python_notation_matches_consumer_fixed_notation(self):
        node = fixture(); node['props'].update(min=0, max=.00002, step=.00001)
        self.assertEqual(slider_geometry(node, 'middle')['value'], .00001)
        # Current public snapSlider derives precision from the exponent string.
        node['props'].update(min=0, max=.00000024, step=.00000012)
        self.assertEqual(slider_geometry(node, 'middle')['value'], 0)

    def test_to_fixed_binary_half_tie_matches_consumer(self):
        node = fixture(); node['props'].update(min=.125, max=1.125, step=.01)
        self.assertEqual(slider_geometry(node, 'min')['value'], .13)

    def test_invalid_ranges_fail(self):
        for value in [None, True, 0, -1, float('nan')]:
            node = fixture(); node['props']['step'] = value
            with self.assertRaisesRegex(ContractError, 'STATE_SLIDER_SEMANTICS_INVALID'):
                slider_geometry(node, 'min')

    def test_off_canvas_or_vertical_thumb_fail(self):
        for axis, value in [('x', 230), ('y', 11)]:
            node = fixture(); node['props']['appearance']['thumbPositions']['max'][axis] = value
            with self.assertRaisesRegex(ContractError, 'STATE_SLIDER_GEOMETRY_INVALID'):
                slider_geometry(node, 'max')

    def test_fill_clip_outside_canvas_fails(self):
        node = fixture(); node['props']['appearance']['fillClip']['width'] = 500
        with self.assertRaisesRegex(ContractError, 'STATE_SLIDER_GEOMETRY_INVALID'):
            slider_geometry(node, 'max')

    @unittest.skipUnless(os.environ.get('STATEFUL_BROWSER_TESTS') == '1', 'opt-in real PixiJS acceptance')
    def test_official_import_and_pointer_drag_render_clipped_fill(self):
        from ai_ui_decomposition.stateful import accept
        component = Path(os.environ.get('STATEFUL_COMPONENT_ROOT', Path(__file__).resolve().parents[2] / 'ui-component-harness')).resolve()
        with tempfile.TemporaryDirectory() as temporary:
            fixtures = Path(temporary) / 'fixtures'
            subprocess.run(['node', str(Path(__file__).with_name('stateful-fixtures.mjs')),
                            str(component), str(fixtures)], check=True, capture_output=True)
            source = fixtures / 'Slider'; output = Path(temporary) / 'acceptance'
            report = accept(source/'ui.component-handoff.draft.zip', source/'evidence.json', component, output)
            self.assertEqual(report['status'], 'technical_passed')
            receipt = json.loads((output/'browser.json').read_text())
            self.assertEqual([state['actualValue'] for state in receipt['results']], [0, 50, 100])
            self.assertTrue(all(state['checks'] for state in receipt['results']))
            self.assertIs(receipt['human_visual_acceptance'], False)


if __name__ == '__main__': unittest.main()
