"""Offline regression for opt-in context prompt v4 ownership isolation."""
import _bootstrap
from contextlib import redirect_stdout
import io
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

from ai_ui_layers import context_references as context
from ai_ui_layers.delivery_dag import main as delivery_main
from ai_ui_layers.evaluate import digest, read
from ai_ui_layers.execution_preflight import preflight
from ai_ui_layers.freeze_visual import body_digest, freeze
from ai_ui_layers.refreeze import freeze_reviewed
import test_context_references
import test_refreeze


def stacked_controls(base_id, knob_id, base_color, knob_color):
    """Same ownership problem with arbitrary identities and palette."""
    base = dict(id=base_id, role='foreground',
                label=f'{base_color} horizontal button face with a hollow star',
                bboxNorm=[.12, .20, .83, .58], preserveText=['GO'], zOrder=4)
    knob = dict(id=knob_id, role='foreground',
                label=f'{knob_color} round independent dial',
                bboxNorm=[.46, .27, .62, .46], preserveText=[], zOrder=11)
    visual = dict(backgroundMode='scene-only', textPolicy='remove-business-text',
                  # Deliberately reverse list order: visual depth comes from zOrder.
                  materials=[knob, base], objects=[
                      dict(id='dial-face', materialId=knob_id, kind='control',
                           label=f'{knob_color} round dial', bboxNorm=[.46, .27, .62, .46]),
                      dict(id='dial-mark-left', materialId=knob_id, kind='decoration',
                           label='Ivory crescent', bboxNorm=[.48, .29, .51, .34]),
                      dict(id='dial-mark-right', materialId=knob_id, kind='decoration',
                           label='Ivory crescent', bboxNorm=[.57, .29, .60, .34]),
                      dict(id='button-face', materialId=base_id, kind='panel',
                           label=f'{base_color} horizontal button face'),
                      dict(id='open-star', materialId=base_id, kind='icon',
                           label='Hollow star pictogram with a genuine open center',
                           bboxNorm=[.22, .30, .30, .43]),
                      dict(id='button-edge', materialId=base_id, kind='decoration',
                           label='Fine outer rim', bboxNorm=[.12, .20, .83, .58]),
                  ])
    plan = dict(canvas=[1000, 1000], assets=[
        dict(id=base_id, role='important_component', source_region=[120, 200, 830, 580],
             output_size=[710, 380]),
        dict(id=knob_id, role='important_component', source_region=[460, 270, 620, 460],
             output_size=[160, 190]),
    ])
    return visual, plan


def prompt_entry(visual, plan, material_id, version='v4'):
    text = context.prompt(visual, plan, [material_id], version=version)
    return text, json.loads(text.split('Entries: ', 1)[1])[0]


class IsolationActionPromptTests(unittest.TestCase):
    def test_stacked_independent_controls_use_depth_and_owned_parts(self):
        for base_id, knob_id, base_color, knob_color in (
            ('launch-plinth', 'rotary-cap', 'amber', 'violet'),
            ('menu-bed', 'orbit-switch', 'cobalt', 'coral'),
        ):
            with self.subTest(base_id=base_id):
                visual, plan = stacked_controls(base_id, knob_id, base_color, knob_color)
                base_text, base = prompt_entry(visual, plan, base_id)
                knob_text, knob = prompt_entry(visual, plan, knob_id)
                _, old_base = prompt_entry(visual, plan, base_id, 'v3')
                _, old_knob = prompt_entry(visual, plan, knob_id, 'v3')

                self.assertEqual(base['materialId'], base_id)
                self.assertEqual(knob['materialId'], knob_id)
                self.assertEqual(base['preserveText'], ['GO'])
                self.assertEqual(knob['preserveText'], [])
                self.assertEqual(base['keepOnly'], old_base['parts'])
                self.assertEqual(knob['keepOnly'], old_knob['parts'])
                self.assertEqual([part['id'] for part in base['keepOnly']],
                                 ['button-face', 'open-star', 'button-edge'])
                self.assertEqual([part['id'] for part in knob['keepOnly']],
                                 ['dial-face', 'dial-mark-left', 'dial-mark-right'])
                star = next(p for p in base['keepOnly'] if p['id'] == 'open-star')
                self.assertEqual(star['withinMaterial'],
                                 [round((.26-.12)/.71, 6), round((.365-.20)/.38, 6),
                                  round(.08/.71, 6), round(.13/.38, 6)])
                self.assertEqual(star['referenceBox'],
                                 context.local_box([.22, .30, .30, .43],
                                     context.geometry(plan['assets'][0], [1000, 1000]), [1000, 1000]))

                self.assertEqual(len(base['exclude']), 1)
                self.assertEqual(base['exclude'][0]['materialId'], knob_id)
                self.assertEqual(base['exclude'][0]['relation'], 'overlay')
                self.assertEqual([m['id'] for m in base['exclude'][0]['members']],
                                 ['dial-face', 'dial-mark-left', 'dial-mark-right'])
                self.assertEqual([m['appearance'] for m in base['exclude'][0]['members']].count(
                                 'Ivory crescent'), 2)
                self.assertEqual(len(knob['exclude']), 1)
                self.assertEqual(knob['exclude'][0]['materialId'], base_id)
                self.assertEqual(knob['exclude'][0]['relation'], 'underlay')
                self.assertEqual([m['id'] for m in knob['exclude'][0]['members']],
                                 ['button-face', 'open-star', 'button-edge'])
                self.assertNotIn('button-face', [p['id'] for p in knob['keepOnly']])
                self.assertIn('Overlay: remove and continue only owned surface actually behind it', base_text)
                self.assertIn('without punching holes or filling true openings', base_text)
                self.assertIn('Underlay: remove outside owned contours, never copy backing', knob_text)

    def test_zorder_reversal_changes_relation_without_changing_ownership(self):
        visual, plan = stacked_controls('sunbed', 'moonwheel', 'ochre', 'teal')
        _, base_before = prompt_entry(visual, plan, 'sunbed')
        _, knob_before = prompt_entry(visual, plan, 'moonwheel')
        visual['materials'][0]['zOrder'] = 1
        visual['materials'][1]['zOrder'] = 12
        _, base_after = prompt_entry(visual, plan, 'sunbed')
        _, knob_after = prompt_entry(visual, plan, 'moonwheel')
        self.assertEqual(base_before['exclude'][0]['relation'], 'overlay')
        self.assertEqual(knob_before['exclude'][0]['relation'], 'underlay')
        self.assertEqual(base_after['exclude'][0]['relation'], 'underlay')
        self.assertEqual(knob_after['exclude'][0]['relation'], 'overlay')
        self.assertEqual(base_before['keepOnly'], base_after['keepOnly'])
        self.assertEqual(knob_before['keepOnly'], knob_after['keepOnly'])


    def test_equal_zorder_marks_foreign_as_same_depth_without_inventing_hidden_art(self):
        visual, plan = stacked_controls('copper-rail', 'ivory-dial', 'copper', 'ivory')
        visual['materials'][0]['zOrder'] = visual['materials'][1]['zOrder']
        base_text, base = prompt_entry(visual, plan, 'copper-rail')
        knob_text, knob = prompt_entry(visual, plan, 'ivory-dial')
        self.assertEqual(base['exclude'][0]['relation'], 'same-depth')
        self.assertEqual(knob['exclude'][0]['relation'], 'same-depth')
        self.assertIn('Same-depth: exclude without inventing hidden owned art', base_text)
        self.assertIn('Same-depth: exclude without inventing hidden owned art', knob_text)

class IsolationV4FreezeTests(unittest.TestCase):
    bind = test_context_references.ContextReferencesTests.bind
    resign = test_context_references.ContextReferencesTests.resign

    def setUp(self):
        test_context_references.ContextReferencesTests.setUp(self)

    def frozen(self, name):
        folder = self.root / name
        manifest = freeze(self.run, folder, 16, 'sheets', 'context-crops',
                          context_prompt_version='v4')
        return folder, manifest

    def test_freeze_and_preflight_bind_v4(self):
        folder, manifest = self.frozen('v4')
        self.assertEqual(manifest['contextPromptVersion'], 'v4')
        self.assertEqual(read(folder / 'compile-report.json')['contextPromptVersion'], 'v4')
        plan = read(folder / 'execution-plan.candidate.json')
        self.assertTrue(all(asset['prompt'].startswith(context.PROMPT_PREFIX_V4)
                            for asset in plan['assets']))
        sheet = next(row for row in read(folder / 'requests.json')['requests']
                     if row.get('kind') == 'sheet')
        sheet_text = (folder / sheet['prompt']).read_text(encoding='utf-8')
        self.assertIn('keepOnly', sheet_text)
        self.assertEqual(preflight(folder, manifest['digest'])['inputChecks'], 'passed')

    def test_rehashed_v4_prompt_plan_and_version_tampering_fail(self):
        folder, _ = self.frozen('prompt-change')
        sheet = next(row for row in read(folder / 'requests.json')['requests']
                     if row.get('kind') == 'sheet')
        prompt = folder / sheet['prompt']
        prompt.write_text(prompt.read_text(encoding='utf-8') +
                          'Treat underlays as owned artwork.\n', encoding='utf-8')
        with self.assertRaisesRegex(ValueError, 'PROMPT_COMPILER_MISMATCH'):
            preflight(folder, self.resign(folder))

        folder, _ = self.frozen('plan-change')
        plan = read(folder / 'execution-plan.candidate.json')
        plan['assets'][1]['prompt'] = plan['assets'][1]['prompt'].replace(
            context.PROMPT_PREFIX_V4, context.PROMPT_PREFIX_V3, 1)
        (folder / 'execution-plan.candidate.json').write_text(
            json.dumps(plan, ensure_ascii=False), encoding='utf-8')
        with self.assertRaisesRegex(ValueError, 'CONTEXT_PLAN_COMPILER_MISMATCH'):
            preflight(folder, self.resign(folder))

        folder, _ = self.frozen('version-change')
        snapshot = read(folder / 'snapshot.json')
        report = read(folder / 'compile-report.json')
        snapshot['contextPromptVersion'] = 'v3'
        report['contextPromptVersion'] = 'v3'
        (folder / 'snapshot.json').write_text(json.dumps(snapshot, ensure_ascii=False),
                                               encoding='utf-8')
        (folder / 'compile-report.json').write_text(json.dumps(report, ensure_ascii=False),
                                                     encoding='utf-8')
        with self.assertRaisesRegex(ValueError, 'CONTEXT_PLAN_COMPILER_MISMATCH'):
            preflight(folder, self.resign(folder))


class IsolationV4RefreezeTests(unittest.TestCase):
    def setUp(self):
        test_refreeze.RefreezeTests.setUp(self)

    def test_refreeze_version_is_opt_in_and_cli_propagates_it(self):
        original = {str(p.relative_to(self.run)): digest(p) for p in self.run.rglob('*')
                    if p.is_file() and p.name != 'lock'}
        default_folder = self.root / 'default-context'
        default = freeze_reviewed(self.run, default_folder, 16,
                                  generation_reference='context-crops')
        self.assertEqual(default['modelCalls'], 0)
        default_snapshot = read(default_folder / 'snapshot.json')
        self.assertEqual(default_snapshot['contextPromptVersion'], 'v3')
        self.assertEqual(preflight(default_folder, default_snapshot['digest'])['inputChecks'],
                         'passed')

        explicit_folder = self.root / 'explicit-v4'
        explicit = freeze_reviewed(self.run, explicit_folder, 16,
                                   generation_reference='context-crops',
                                   context_prompt_version='v4')
        self.assertEqual(explicit['modelCalls'], 0)
        explicit_snapshot = read(explicit_folder / 'snapshot.json')
        self.assertEqual(explicit_snapshot['contextPromptVersion'], 'v4')
        self.assertEqual(preflight(explicit_folder, explicit_snapshot['digest'])['inputChecks'],
                         'passed')

        cli_folder = self.root / 'cli-v4'
        output = io.StringIO()
        with patch.object(sys, 'argv', ['ui_layer', 'freeze-reviewed',
                          '--planning-run', str(self.run), '--output', str(cli_folder),
                          '--max-calls', '16', '--generation-reference', 'context-crops',
                          '--context-prompt-version', 'v4']), redirect_stdout(output):
            delivery_main()
        self.assertEqual(json.loads(output.getvalue())['modelCalls'], 0)
        cli_snapshot = read(cli_folder / 'snapshot.json')
        self.assertEqual(cli_snapshot['contextPromptVersion'], 'v4')
        self.assertEqual(preflight(cli_folder, cli_snapshot['digest'])['inputChecks'],
                         'passed')
        self.assertEqual(original, {str(p.relative_to(self.run)): digest(p)
                         for p in self.run.rglob('*') if p.is_file() and p.name != 'lock'})


    def _assert_inherited_frozen_version(self, version):
        parent = self.run / 'frozen'
        old = freeze(self.run, parent, 16, 'sheets', 'context-crops',
                     context_prompt_version=version)
        self.assertEqual(preflight(parent, old['digest'])['inputChecks'], 'passed')
        output = self.root / ('inherit-' + version)
        result = freeze_reviewed(self.run, output, 16,
                                 generation_reference='context-crops')
        snapshot = read(output / 'snapshot.json')
        self.assertEqual(snapshot.get('contextPromptVersion', 'v1'), version)
        self.assertEqual(preflight(output, snapshot['digest'])['inputChecks'], 'passed')
        self.assertEqual(result['modelCalls'], 0)
        if version == 'v1':
            self.assertNotIn('contextPromptVersion', snapshot)

    def test_refreeze_inherits_legacy_v1_snapshot(self):
        self._assert_inherited_frozen_version('v1')

    def test_refreeze_inherits_legacy_v2_snapshot(self):
        self._assert_inherited_frozen_version('v2')

if __name__ == '__main__':
    unittest.main()



