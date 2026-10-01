"""Offline regression for explicit overlay removal in opt-in context prompts (v6)."""
import _bootstrap
from contextlib import redirect_stdout
import hashlib
import io
import json
import sys
import unittest
from unittest.mock import patch

from ai_ui_layers import context_references as context
from ai_ui_layers.delivery_dag import main as delivery_main
from ai_ui_layers.evaluate import read
from ai_ui_layers.execution_preflight import preflight
from ai_ui_layers.freeze_visual import freeze
from ai_ui_layers.refreeze import freeze_reviewed

import test_context_references
import test_context_short_v5
import test_refreeze


class ExplicitOverlayPromptTests(unittest.TestCase):
    def test_v6_removes_overlays_then_continues_only_hidden_owned_surface(self):
        for names, colors in test_context_short_v5.FIXTURES:
            with self.subTest(base=names[0]):
                visual, plan = test_context_short_v5.layered_fixture(names, colors)
                old = context.prompt(visual, plan, [names[0]], version='v5')
                new = context.prompt(visual, plan, [names[0]], version='v6')
                overlay = old.split(
                    'Continue only existing owned surface actually hidden by these overlays: ', 1
                )[1].split('. Removal must', 1)[0]
                old_action = (
                    'Continue only existing owned surface actually hidden by these overlays: '
                    + overlay + '. Removal must leave no artificial holes, recesses or ghosts. '
                )
                new_action = (
                    'Remove these foreign overlays: ' + overlay
                    + '. Continue only existing owned surface actually hidden by these overlays; '
                    'leave no artificial holes, recesses or ghosts. '
                )
                self.assertEqual(new, old.replace(old_action, new_action, 1))
                self.assertIn(colors[1] + ' raised dial face', overlay)
                self.assertIn(colors[1] + ' attached scalloped rim', overlay)
                self.assertNotIn(colors[2], overlay)
                self.assertNotIn(colors[3], overlay)
                self.assertLess(new.index('Remove these foreign overlays: '),
                                new.index('Continue only existing owned surface'))
                self.assertIn('genuine crescent opening', new)
                self.assertIn('Retain genuine owned holes/translucency', new)
                self.assertIn('Exclude foreign underlays: ', new)
                self.assertIn('Exclude same-depth foreign parts: ', new)
                self.assertEqual(new.count(colors[0] + ' silver pin in its lowered state'), 2)
                self.assertIn('READY', new)
                self.assertIn('0.15625', new)
                self.assertIn('0.78125', new)

    def test_historical_v5_bytes_and_no_overlay_case(self):
        names, colors = test_context_short_v5.FIXTURES[0]
        visual, plan = test_context_short_v5.layered_fixture(names, colors)
        old = context.prompt(visual, plan, [names[0]], version='v5')
        self.assertEqual(
            hashlib.sha256(old.encode('utf-8')).hexdigest(),
            '18c98952cd6c654e74899ff66bcf43110f0a13bfe36f2124ce572d174d47f769',
        )
        # With no foreign object above this owner, v6 adds no removal instruction.
        next(item for item in visual['materials'] if item['id'] == names[1])['zOrder'] = 1
        old = context.prompt(visual, plan, [names[0]], version='v5')
        new = context.prompt(visual, plan, [names[0]], version='v6')
        self.assertEqual(new, old)
        self.assertNotIn('Remove these foreign overlays:', new)
        self.assertIn('Exclude foreign underlays:', new)


class ExplicitOverlayFreezeTests(unittest.TestCase):
    bind = test_context_references.ContextReferencesTests.bind
    resign = test_context_references.ContextReferencesTests.resign

    def setUp(self):
        test_context_references.ContextReferencesTests.setUp(self)

    def frozen(self, name, version='v6'):
        folder = self.root / name
        manifest = freeze(self.run, folder, 16, 'sheets', 'context-crops',
                          context_prompt_version=version)
        return folder, manifest

    def test_freeze_and_preflight_bind_exact_v6_prompt(self):
        folder, manifest = self.frozen('v6')
        self.assertEqual(manifest['contextPromptVersion'], 'v6')
        self.assertEqual(read(folder / 'compile-report.json')['contextPromptVersion'], 'v6')
        plan = read(folder / 'execution-plan.candidate.json')
        self.assertTrue(all(asset['prompt'].startswith(context.PROMPT_PREFIX_V6)
                            for asset in plan['assets']))
        sheet = next(row for row in read(folder / 'requests.json')['requests']
                     if row.get('kind') == 'sheet')
        sheet_text = (folder / sheet['prompt']).read_text(encoding='utf-8')
        self.assertEqual(sheet_text, context.prompt(
            read(folder / 'evidence/m1-draft.json'), plan, sheet['materialIds'],
            dict(grid=sheet['grid'], outputSize=sheet['outputSize']), version='v6') + '\n')
        self.assertEqual(preflight(folder, manifest['digest'])['inputChecks'], 'passed')

        old_folder, _ = self.frozen('v5', version='v5')
        old_plan = read(old_folder / 'execution-plan.candidate.json')
        for old_asset, new_asset in zip(old_plan['assets'], plan['assets']):
            self.assertEqual({k: v for k, v in old_asset.items() if k != 'prompt'},
                             {k: v for k, v in new_asset.items() if k != 'prompt'})
        self.assertEqual(read(old_folder / 'placements.json'), read(folder / 'placements.json'))
        self.assertEqual(read(old_folder / 'generation-references.json'),
                         read(folder / 'generation-references.json'))

    def test_rehashed_prompt_plan_and_version_changes_are_rejected(self):
        folder, _ = self.frozen('prompt-change')
        sheet = next(row for row in read(folder / 'requests.json')['requests']
                     if row.get('kind') == 'sheet')
        prompt = folder / sheet['prompt']
        prompt.write_text(prompt.read_text(encoding='utf-8') +
                          'Keep any foreign overlay in the owned layer.\n', encoding='utf-8')
        with self.assertRaisesRegex(ValueError, 'PROMPT_COMPILER_MISMATCH'):
            preflight(folder, self.resign(folder))

        folder, _ = self.frozen('plan-change')
        plan = read(folder / 'execution-plan.candidate.json')
        plan['assets'][1]['prompt'] = plan['assets'][1]['prompt'].replace(
            context.PROMPT_PREFIX_V6, context.PROMPT_PREFIX_V5, 1)
        (folder / 'execution-plan.candidate.json').write_text(
            json.dumps(plan, ensure_ascii=False), encoding='utf-8')
        with self.assertRaisesRegex(ValueError, 'CONTEXT_PLAN_COMPILER_MISMATCH'):
            preflight(folder, self.resign(folder))

        folder, _ = self.frozen('version-change')
        snapshot = read(folder / 'snapshot.json')
        report = read(folder / 'compile-report.json')
        snapshot['contextPromptVersion'] = 'v5'
        report['contextPromptVersion'] = 'v5'
        (folder / 'snapshot.json').write_text(json.dumps(snapshot, ensure_ascii=False),
                                               encoding='utf-8')
        (folder / 'compile-report.json').write_text(json.dumps(report, ensure_ascii=False),
                                                     encoding='utf-8')
        with self.assertRaisesRegex(ValueError, 'CONTEXT_PLAN_COMPILER_MISMATCH'):
            preflight(folder, self.resign(folder))


class ExplicitOverlayRefreezeTests(unittest.TestCase):
    def setUp(self):
        test_refreeze.RefreezeTests.setUp(self)

    def test_explicit_cli_freeze_and_inheritance(self):
        folder = self.root / 'cli-v6'
        output = io.StringIO()
        with patch.object(sys, 'argv', ['ui_layer', 'freeze-reviewed',
                          '--planning-run', str(self.run), '--output', str(folder),
                          '--max-calls', '16', '--generation-reference', 'context-crops',
                          '--context-prompt-version', 'v6']), redirect_stdout(output):
            delivery_main()
        self.assertEqual(json.loads(output.getvalue())['modelCalls'], 0)
        self.assertEqual(read(folder / 'snapshot.json')['contextPromptVersion'], 'v6')
        self.assertEqual(preflight(folder, read(folder / 'snapshot.json')['digest'])['inputChecks'],
                         'passed')

        parent = self.run / 'frozen'
        freeze(self.run, parent, 16, 'sheets', 'context-crops', context_prompt_version='v6')
        inherited = self.root / 'inherited-v6'
        result = freeze_reviewed(self.run, inherited, 16,
                                 generation_reference='context-crops')
        self.assertEqual(result['modelCalls'], 0)
        self.assertEqual(read(inherited / 'snapshot.json')['contextPromptVersion'], 'v6')
        self.assertEqual(preflight(inherited, result['digest'])['inputChecks'], 'passed')


if __name__ == '__main__':
    unittest.main()
