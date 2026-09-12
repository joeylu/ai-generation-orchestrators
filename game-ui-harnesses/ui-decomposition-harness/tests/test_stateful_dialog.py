"""Local Dialog metadata regressions; no provider or media generation."""
import unittest
import os
import json
import shutil
import tempfile
import subprocess
from pathlib import Path
from ai_ui_decomposition.common import ContractError
from ai_ui_decomposition.stateful_dialog import dialog_state, dialog_ancestors


class DialogMetadataTests(unittest.TestCase):
    def fixture(self, overlay=True):
        a = {role: {'image': role, 'layout': {'x': 0, 'y': 0, 'width': 100, 'height': 80}}
             for role in ('background', 'body', 'header')}
        if overlay: a.update(overlayImage='overlay', overlayCanvas={'width': 200, 'height': 160})
        return {'id': 'dialog', 'type': 'Dialog', 'props': {'modal': True, 'appearance': a},
                'children': [{'id': 'close', 'type': 'Button', 'children': []}]}

    def state(self, node, name):
        return dialog_state(node, name, {'width': 200, 'height': 160},
            lambda slot, role, data, visible: dict(slot=slot, visible=visible),
            lambda slot, role, image, rect, visible: dict(slot=slot, visible=visible, rect=rect))

    def test_closed_retains_resources_and_hides_every_part(self):
        state = self.state(self.fixture(), 'closed')
        self.assertFalse(state['value'])
        self.assertEqual([p['slot'] for p in state['parts']], ['overlay', 'background', 'body', 'header'])
        self.assertTrue(all(not p['visible'] for p in state['parts']))
        self.assertEqual(state['dialog']['children'], ['close'])

    def test_open_and_reopened_share_resource_semantics(self):
        n = self.fixture()
        self.assertEqual(self.state(n, 'open'), self.state(n, 'reopened'))
        self.assertEqual(self.state(n, 'open')['dialog']['businessActions'], 'not-bound-by-public-contract')

    def test_overlay_canvas_and_modality_cannot_be_faked(self):
        for key, value in [('overlayCanvas', {'width': 100, 'height': 80})]:
            n = self.fixture(); n['props']['appearance'][key] = value
            with self.assertRaisesRegex(ContractError, 'STATE_DIALOG_OVERLAY_INVALID'): self.state(n, 'open')
        n = self.fixture(); n['props']['modal'] = False
        with self.assertRaisesRegex(ContractError, 'STATE_DIALOG_OVERLAY_INVALID'): self.state(n, 'open')

    def test_native_overlay_is_explicit_and_no_business_binding_invented(self):
        state = self.state(self.fixture(False), 'open')
        self.assertEqual(state['dialog']['overlay'], 'runtime-default')
        self.assertEqual(len(state['parts']), 3)

    def test_dialog_ancestor_chain(self):
        root = self.fixture(); root['children'].append({'id': 'inner', 'type': 'Dialog', 'children': [{'id': 'ok', 'type': 'Button'}]})
        self.assertEqual(dialog_ancestors(root), {'dialog': [], 'close': ['dialog'], 'inner': ['dialog'], 'ok': ['dialog', 'inner']})


class DialogIntegrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.component = Path(os.environ.get('STATEFUL_COMPONENT_ROOT', Path(__file__).resolve().parents[2] / 'ui-component-harness')).resolve()
        if not shutil.which('node') or not (cls.component / 'node_modules').exists():
            raise unittest.SkipTest('Existing local component dependencies required; no network setup')
        cls.temp = tempfile.TemporaryDirectory(); cls.root = Path(cls.temp.name) / 'fixtures'
        subprocess.run(['node', str(Path(__file__).with_name('stateful-dialog-fixtures.mjs')), str(cls.component), str(cls.root)], check=True, capture_output=True)

    @classmethod
    def tearDownClass(cls):
        if hasattr(cls, 'temp'): cls.temp.cleanup()

    def test_official_import_closed_dialog_and_semitransparent_overlay(self):
        from ai_ui_decomposition.stateful import accept
        for kind in ('Dialog', 'Dialog-native-overlay', 'Dialog-single-frame'):
            d = self.root / kind
            report = accept(d/'ui.component-handoff.draft.zip', d/'evidence.json', self.component, d/'qa', False)
            self.assertEqual(report['status'], 'deterministic_passed')
            matrix = json.loads((d/'qa/state-matrix.json').read_text())
            dialog = next(c for c in matrix['components'] if c['componentType'] == 'Dialog')
            self.assertEqual([s['value'] for s in dialog['states']], [True, False, True])
            self.assertFalse((d/'qa/ui.component-handoff.draft.zip').exists())

    @unittest.skipUnless(os.environ.get('STATEFUL_BROWSER_TESTS') == '1', 'Opt-in actual local PixiJS browser')
    def test_real_browser_dialog_state_and_modal_isolation(self):
        from ai_ui_decomposition.stateful import accept
        for kind in ('Dialog', 'Dialog-native-overlay', 'Dialog-single-frame'):
            d = self.root / kind
            report = accept(d/'ui.component-handoff.draft.zip', d/'evidence.json', self.component, d/'browser', True)
            self.assertEqual(report['status'], 'technical_passed')
            receipt = json.loads((d/'browser/browser.json').read_text())
            dialog = [r for r in receipt['results'] if r['componentId'] == 'dialog']
            self.assertEqual(len(dialog), 3)
            self.assertTrue(all(c['pass'] for r in dialog for c in r['checks']))
            self.assertFalse(receipt['human_visual_acceptance'])


if __name__ == '__main__': unittest.main()
