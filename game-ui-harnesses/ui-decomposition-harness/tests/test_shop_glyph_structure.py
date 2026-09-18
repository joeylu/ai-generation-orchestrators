"""Observed disconnected glyphs survive the facts-to-board compiler."""
import copy
import json
from pathlib import Path
import tempfile
import unittest

import numpy as np
from PIL import Image

from ai_ui_decomposition.common import sha256
from ai_ui_decomposition.delivery_adapter import compile_delivery
from ai_ui_decomposition.relative_board import gap_windows
from ai_ui_decomposition.shop_facts import expand_shop_facts, synthetic_facts
from ai_ui_decomposition.shop_facts_contracts import glyph_policy


class ShopGlyphStructureTests(unittest.TestCase):
    def case(self, root):
        ref = root / 'reference.png'
        Image.new('RGB', (640, 480), '#203040').save(ref)
        facts = synthetic_facts(sha256(ref), [640, 480])
        facts['tabs']['items'][0]['glyphStructure'] = dict(
            columnGroups=2, rowGroups=2, maxInternalGapRatio=.15,
            evidence='Source glyph contains two columns and two rows of separate square strokes.')
        return ref, facts

    def test_native_strategy_and_prompt_preserve_observation(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            ref, facts = self.case(root)
            native = expand_shop_facts(ref, facts)
            policy = native['boardPolicies']['shop-tabs']
            self.assertEqual(policy['version'], '1.3')
            self.assertEqual(policy['disconnected_glyphs'][0]['asset_id'], 'tab-icon-all-active')
            self.assertTrue(all(p['version'] == '1.2' for k,p in native['boardPolicies'].items() if k != 'shop-tabs'))
            out = root / 'compiled'
            consumer = Path(__file__).resolve().parents[2] / 'ui-component-harness'
            compile_delivery(ref, native, out, consumer, 9)
            strategy = json.loads((out / 'strategy-shop-tabs.json').read_text(encoding='utf-8'))
            self.assertEqual(strategy['boards'][0]['extraction_policy']['disconnected_glyphs'], policy['disconnected_glyphs'])
            self.assertIn('2 columns by 2 rows', (out / 'plan.json').read_text(encoding='utf-8'))
            self.assertIn('External gutters between adjacent assets must be at least',
                          (out / 'plan.json').read_text(encoding='utf-8'))

    def test_absent_observation_preserves_legacy_policy(self):
        with tempfile.TemporaryDirectory() as tmp:
            ref, facts = self.case(Path(tmp))
            del facts['tabs']['items'][0]['glyphStructure']
            policy = expand_shop_facts(ref, facts)['boardPolicies']['shop-tabs']
            self.assertEqual(policy['version'], '1.2')
            self.assertNotIn('disconnected_glyphs', policy)

    def test_unselected_glyph_uses_normal_canonical(self):
        with tempfile.TemporaryDirectory() as tmp:
            ref, facts = self.case(Path(tmp))
            tabs = facts['tabs']['items']
            tabs[1]['glyphStructure'] = tabs[0].pop('glyphStructure')
            policy = expand_shop_facts(ref, facts)['boardPolicies']['shop-tabs']
            self.assertEqual(policy['disconnected_glyphs'][0]['asset_id'], 'tab-icon-gear')

    def test_invalid_observations_fail_closed(self):
        with tempfile.TemporaryDirectory() as tmp:
            ref, base = self.case(Path(tmp))
            for key, value in [('columnGroups', True), ('rowGroups', 1),
                               ('maxInternalGapRatio', .26), ('maxInternalGapRatio', True),
                               ('evidence', ''), ('extra', 2)]:
                with self.subTest(key=key, value=value):
                    facts = copy.deepcopy(base)
                    facts['tabs']['items'][0]['glyphStructure'][key] = value
                    with self.assertRaises(ValueError):
                        expand_shop_facts(ref, facts)

    def test_real_grid_geometry_requires_explicit_structure(self):
        # Returned grid: 26/27 px columns, 7 px gap, 58 px height.
        mask = np.zeros((100, 100), dtype=bool)
        for left, right in [(20,46), (53,80)]:
            mask[20:45,left:right] = True
            mask[52:78,left:right] = True
        tab = dict(id='all', selected=True, glyphStructure=dict(columnGroups=2,
            rowGroups=2, maxInternalGapRatio=.15, evidence='Measured 2 by 2 source grid.'))
        policy = glyph_policy([tab])
        slots = [dict(asset_id='tab-icon-all-active', crop=[0,0,60,58], target_size=[60,58])]
        legacy = {k:v for k,v in policy.items() if k != 'disconnected_glyphs'}
        legacy['version'] = '1.2'
        with self.assertRaisesRegex(ValueError, 'BOARD_GAP_COUNT_OR_JOINED'):
            gap_windows(mask, slots, legacy)
        self.assertEqual(len(gap_windows(mask, slots, policy)), 1)
        mask[45:52,20:46] = True
        with self.assertRaisesRegex(ValueError, 'BOARD_GLYPH_GRID_STRUCTURE'):
            gap_windows(mask, slots, policy)
