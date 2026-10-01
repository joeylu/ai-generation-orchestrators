"""Offline regression for opt-in short context prompts (v5)."""
import _bootstrap
import json
import unittest

from ai_ui_layers import context_references as context
from ai_ui_layers.evaluate import digest, read
from ai_ui_layers.execution_preflight import preflight
from ai_ui_layers.freeze_visual import freeze
from ai_ui_layers.refreeze import freeze_reviewed

import test_context_references
import test_refreeze


def layered_fixture(names, colors):
    """Four overlapping owners with repeated owned parts and independent depth."""
    base, overlay, underlay, peer = names
    base_color, overlay_color, underlay_color, peer_color = colors
    bounds = {
        base: [.10, .20, .90, .60],
        overlay: [.40, .25, .65, .45],
        underlay: [.05, .15, .95, .70],
        peer: [.77, .24, .95, .50],
    }
    materials = [
        dict(id=underlay, role='foreground', zOrder=2,
             label=f'{underlay_color} independent fabric underlay',
             bboxNorm=bounds[underlay], preserveText=[]),
        dict(id=peer, role='foreground', zOrder=5,
             label=f'{peer_color} independent same-depth medallion',
             bboxNorm=bounds[peer], preserveText=[]),
        dict(id=overlay, role='foreground', zOrder=9,
             label=f'{overlay_color} independent raised control',
             bboxNorm=bounds[overlay], preserveText=[]),
        dict(id=base, role='foreground', zOrder=5,
             label=f'{base_color} translucent band with a genuine crescent opening',
             bboxNorm=bounds[base], preserveText=['READY']),
    ]
    objects = [
        dict(id=f'{base}-face', materialId=base, kind='panel',
             label=f'{base_color} translucent owned surface with a genuine crescent opening',
             bboxNorm=bounds[base]),
        dict(id=f'{base}-pin-left', materialId=base, kind='decoration',
             label=f'{base_color} silver pin in its lowered state',
             bboxNorm=[.20, .26, .25, .34]),
        dict(id=f'{base}-pin-right', materialId=base, kind='decoration',
             label=f'{base_color} silver pin in its lowered state',
             bboxNorm=[.70, .26, .75, .34]),
        dict(id=f'{base}-info', materialId=base, kind='icon',
             label='Single-character i pictogram', bboxNorm=[.30, .27, .34, .35]),
        dict(id=f'{overlay}-body', materialId=overlay, kind='control',
             label=f'{overlay_color} raised dial face', bboxNorm=bounds[overlay]),
        dict(id=f'{overlay}-rim', materialId=overlay, kind='decoration',
             label=f'{overlay_color} attached scalloped rim', bboxNorm=bounds[overlay]),
        dict(id=f'{underlay}-cloth', materialId=underlay, kind='panel',
             label=f'{underlay_color} fabric backing', bboxNorm=bounds[underlay]),
        dict(id=f'{peer}-mark', materialId=peer, kind='decoration',
             label=f'{peer_color} stamped sun mark', bboxNorm=bounds[peer]),
    ]
    visual = dict(backgroundMode='scene-only', textPolicy='remove-business-text',
                  materials=materials, objects=objects)
    assets = [dict(id=material['id'], role='important_component',
                   source_region=[round(x * 1000) for x in material['bboxNorm']],
                   output_size=[round((material['bboxNorm'][2] - material['bboxNorm'][0]) * 1000),
                                round((material['bboxNorm'][3] - material['bboxNorm'][1]) * 1000)])
              for material in materials]
    return visual, dict(canvas=[1000, 1000], assets=assets)


FIXTURES = (
    (('harbor-band', 'turn-knob', 'map-cloth', 'sun-stamp'),
     ('jade', 'apricot', 'umber', 'plum')),
    (('night-ribbon', 'tide-dial', 'stage-veil', 'moon-seal'),
     ('indigo', 'lime', 'sand', 'rose')),
)


class ShortContextPromptTests(unittest.TestCase):
    def test_v5_prose_rebuilds_each_owner_without_foreign_art_or_new_holes(self):
        for names, colors in FIXTURES:
            with self.subTest(base=names[0]):
                visual, plan = layered_fixture(names, colors)
                text = context.prompt(visual, plan, [names[0]], version='v5')
                self.assertLess(len(text), 3500)
                self.assertNotIn('Entries: ', text)
                self.assertNotIn('keepOnly', text)
                self.assertNotIn('excludeArtwork', text)
                self.assertNotIn('"materialId":', text)
                for color in colors:
                    self.assertIn(color, text)
                self.assertIn('READY', text)
                self.assertEqual(text.count(f'{colors[0]} silver pin in its lowered state'), 2)
                self.assertIn('Single-character i pictogram', text)
                self.assertIn('genuine crescent opening', text)
                self.assertIn('translucent', text)
                # Both instances must retain distinct local placement, not collapse
                # into a single generic decoration summary.
                self.assertIn('0.15625', text)
                self.assertIn('0.78125', text)
                self.assertTrue(text.startswith(
                    'Reconstruct one complete independent owned material from this UI reference.'))
                overlay_text = text.split(
                    'Continue only existing owned surface actually hidden by these overlays: ', 1
                )[1].split('. Removal must', 1)[0]
                underlay_text = text.split('Exclude foreign underlays: ', 1)[1].split('. ', 1)[0]
                same_depth_text = text.split('Exclude same-depth foreign parts: ', 1)[1].split(
                    '; do not invent', 1)[0]
                self.assertIn(f'{colors[1]} raised dial face', overlay_text)
                self.assertIn(f'{colors[1]} attached scalloped rim', overlay_text)
                self.assertNotIn(colors[2], overlay_text)
                self.assertNotIn(colors[3], overlay_text)
                self.assertIn(f'{colors[2]} fabric backing', underlay_text)
                self.assertIn(f'{colors[3]} stamped sun mark', same_depth_text)
                self.assertIn('no artificial holes, recesses or ghosts', text)
                self.assertIn('Retain genuine owned holes/translucency', text)
                self.assertIn('Keep all owned parts, original state/count', text)

    def test_v5_group_preserves_row_major_cells_and_common_scale(self):
        names, colors = FIXTURES[1]
        visual, plan = layered_fixture(names, colors)
        text = context.prompt(visual, plan, names,
                              group=dict(grid=[2, 2], outputSize=[1024, 1024]),
                              version='v5')
        self.assertLess(len(text), 9000)
        self.assertIn('row-major', text)
        self.assertIn('common uniform scale', text)
        for index, color in enumerate(colors):
            section = text.split(f'Reference {index + 1}, cell {index}: owned parts: ', 1)[1]
            section = section.split('Reference ', 1)[0]
            self.assertIn(color, section)
        self.assertIn('one material per cell', text.lower())


class ShortContextFreezeTests(unittest.TestCase):
    bind = test_context_references.ContextReferencesTests.bind
    resign = test_context_references.ContextReferencesTests.resign

    def setUp(self):
        test_context_references.ContextReferencesTests.setUp(self)

    def frozen(self, name, version='v5'):
        folder = self.root / name
        manifest = freeze(self.run, folder, 16, 'sheets', 'context-crops',
                          context_prompt_version=version)
        return folder, manifest

    def test_freeze_binds_v5_and_preflight_compiles_the_original_template(self):
        folder, manifest = self.frozen('v5')
        self.assertEqual(manifest['contextPromptVersion'], 'v5')
        self.assertEqual(read(folder / 'compile-report.json')['contextPromptVersion'], 'v5')
        plan = read(folder / 'execution-plan.candidate.json')
        self.assertTrue(all(asset['prompt'].startswith(context.PROMPT_PREFIX_V5)
                            for asset in plan['assets']))
        sheet = next(row for row in read(folder / 'requests.json')['requests']
                     if row.get('kind') == 'sheet')
        sheet_text = (folder / sheet['prompt']).read_text(encoding='utf-8')
        self.assertIn('complete independent owned material', sheet_text)
        self.assertNotIn('Entries: ', sheet_text)
        self.assertEqual(preflight(folder, manifest['digest'])['inputChecks'], 'passed')

    def test_rehashed_prompt_plan_and_version_tampering_fail(self):
        folder, _ = self.frozen('prompt-change')
        sheet = next(row for row in read(folder / 'requests.json')['requests']
                     if row.get('kind') == 'sheet')
        prompt = folder / sheet['prompt']
        prompt.write_text(prompt.read_text(encoding='utf-8') +
                          'Copy the independent overlay into this layer.\n', encoding='utf-8')
        with self.assertRaisesRegex(ValueError, 'PROMPT_COMPILER_MISMATCH'):
            preflight(folder, self.resign(folder))

        folder, _ = self.frozen('plan-change')
        plan = read(folder / 'execution-plan.candidate.json')
        plan['assets'][1]['prompt'] = plan['assets'][1]['prompt'].replace(
            context.PROMPT_PREFIX_V5, context.PROMPT_PREFIX_V4, 1)
        (folder / 'execution-plan.candidate.json').write_text(
            json.dumps(plan, ensure_ascii=False), encoding='utf-8')
        with self.assertRaisesRegex(ValueError, 'CONTEXT_PLAN_COMPILER_MISMATCH'):
            preflight(folder, self.resign(folder))

        folder, _ = self.frozen('version-change')
        snapshot = read(folder / 'snapshot.json')
        report = read(folder / 'compile-report.json')
        snapshot['contextPromptVersion'] = 'v4'
        report['contextPromptVersion'] = 'v4'
        (folder / 'snapshot.json').write_text(json.dumps(snapshot, ensure_ascii=False),
                                               encoding='utf-8')
        (folder / 'compile-report.json').write_text(json.dumps(report, ensure_ascii=False),
                                                     encoding='utf-8')
        with self.assertRaisesRegex(ValueError, 'CONTEXT_PLAN_COMPILER_MISMATCH'):
            preflight(folder, self.resign(folder))

class ShortContextRefreezeTests(unittest.TestCase):
    def setUp(self):
        test_refreeze.RefreezeTests.setUp(self)

    def test_default_v3_and_inherited_v4_stay_stable(self):
        default = self.root / 'default-v3'
        result = freeze_reviewed(self.run, default, 16,
                                 generation_reference='context-crops')
        self.assertEqual(result['modelCalls'], 0)
        self.assertEqual(read(default / 'snapshot.json')['contextPromptVersion'], 'v3')
        self.assertEqual(preflight(default, result['digest'])['inputChecks'], 'passed')

        parent = self.run / 'frozen'
        manifest = freeze(self.run, parent, 16, 'sheets', 'context-crops',
                          context_prompt_version='v4')
        self.assertEqual(preflight(parent, manifest['digest'])['inputChecks'], 'passed')
        inherited = self.root / 'inherited-v4'
        result = freeze_reviewed(self.run, inherited, 16,
                                 generation_reference='context-crops')
        self.assertEqual(result['modelCalls'], 0)
        self.assertEqual(read(inherited / 'snapshot.json')['contextPromptVersion'], 'v4')
        self.assertEqual(preflight(inherited, result['digest'])['inputChecks'], 'passed')


if __name__ == '__main__':
    unittest.main()
