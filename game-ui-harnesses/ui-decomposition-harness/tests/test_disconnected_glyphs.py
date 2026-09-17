import copy
import unittest
import tempfile
from pathlib import Path
import numpy as np
from PIL import Image
from ai_ui_decomposition.relative_board import gap_windows,validate_policy


class DisconnectedGlyphTests(unittest.TestCase):
    def case(self):
        # Same failure geometry as the Skyport four-tile glyph: 8px internal
        # whitespace in a 68px support height, exceeding the old 5px radius.
        f=np.zeros((110,240),dtype=bool)
        f[20:88,10:60]=True
        for x in (100,138):
            f[20:50,x:x+30]=True;f[58:88,x:x+30]=True
        f[20:88,208:230]=True
        slots=[dict(asset_id=k,crop=[x,0,1,1],target_size=size) for k,x,size in
               [('left',0,[54,72]),('glyph',1,[72,72]),('right',2,[26,72])]]
        policy=dict(version='1.3',mode='foreground-gap-row',target_padding=2,
            canvas_policy='content-bounds',max_internal_gap_ratio=.08,
            max_part_aspect_error=.5,separation_basis='mixed-height',
            disconnected_glyphs=[dict(asset_id='glyph',column_groups=2,row_groups=2,
                max_internal_gap_ratio=.15,evidence='Observed four tiles in two columns.')])
        return f,slots,policy

    def test_opt_in_preserves_old_rejection(self):
        f,s,p=self.case();old=copy.deepcopy(p);old['version']='1.2';old.pop('disconnected_glyphs')
        with self.assertRaisesRegex(ValueError,'BOARD_GAP_COUNT_OR_JOINED'):gap_windows(f,s,old)
        result=gap_windows(f,s,p)
        self.assertEqual(list(result),['left','glyph','right'])
        self.assertLess(result['glyph'][0],100);self.assertGreater(result['glyph'][2],168)

    def test_unknown_duplicate_and_invalid_declarations(self):
        f,s,p=self.case();p['disconnected_glyphs'][0]['asset_id']='absent'
        with self.assertRaisesRegex(ValueError,'UNKNOWN_ASSET'):gap_windows(f,s,p)
        _,_,p=self.case();p['disconnected_glyphs']*=2
        with self.assertRaisesRegex(ValueError,'GLYPH_ID'):validate_policy(p)
        _,_,p=self.case();p['disconnected_glyphs'][0]['max_internal_gap_ratio']=.3
        with self.assertRaisesRegex(ValueError,'GLYPH_RATIO'):validate_policy(p)

    def test_extra_missing_or_wrong_columns_rejected(self):
        f,s,p=self.case();p['disconnected_glyphs'][0]['column_groups']=3
        with self.assertRaisesRegex(ValueError,'GROUP_COUNT'):gap_windows(f,s,p)
        f,s,p=self.case();f[20:88,138:168]=False
        with self.assertRaisesRegex(ValueError,'GROUP_COUNT'):gap_windows(f,s,p)

    def test_internal_gap_and_clipping_not_relaxed(self):
        f,s,p=self.case();p['disconnected_glyphs'][0]['max_internal_gap_ratio']=.1
        with self.assertRaisesRegex(ValueError,'INTERNAL_GAP'):gap_windows(f,s,p)
        f,s,p=self.case();f[0,10]=True
        with self.assertRaisesRegex(ValueError,'CANVAS_CLIPPED'):gap_windows(f,s,p)

    def test_external_separation_stays_strict(self):
        f,s,p=self.case();f[20:88,208:230]=False;f[20:88,189:211]=True
        with self.assertRaisesRegex(ValueError,'AMBIGUOUS_SEPARATION'):gap_windows(f,s,p)

    def test_neighbor_fragment_cannot_impersonate_grid(self):
        f,s,p=self.case();f[:]=False
        for lo,hi in ((10,40),(62,92),(100,130),(158,188)):
            f[20:88,lo:hi]=True
        s[0]['target_size']=[34,72];s[2]['target_size']=[34,72]
        with self.assertRaisesRegex(ValueError,'GRID_STRUCTURE'):gap_windows(f,s,p)

    def test_verified_gap_accepts_safe_gap_without_changing_legacy(self):
        f,s,p=self.case();f[20:88,208:230]=False;f[20:88,189:211]=True
        with self.assertRaisesRegex(ValueError,'AMBIGUOUS_SEPARATION'):gap_windows(f,s,p)
        p.update(version='1.4',separation_basis='verified-key-gap')
        self.assertEqual(len(gap_windows(f,s,p)),3)
        f[20:88,189:211]=False;f[20:88,178:200]=True
        with self.assertRaisesRegex(ValueError,'AMBIGUOUS_SEPARATION'):gap_windows(f,s,p)

    def test_verified_gap_requires_actual_key_at_cut(self):
        from ai_ui_decomposition.relative_board import add_windows,crop_relative
        f,s,p=self.case();p.update(version='1.4',separation_basis='verified-key-gap')
        board=dict(canvas=[240,110],slots=s);add_windows(board,p)
        a=np.full((*f.shape,3),[248,8,248],dtype=np.uint8);a[f]=[40,60,80]
        windows=gap_windows(f,s,p);cut=windows['left'][2]
        a[40:45,cut]=[188,8,248] # Below foreground threshold, but not pure key.
        with self.assertRaisesRegex(ValueError,'CUT_KEY_MOAT'):
            crop_relative(Image.fromarray(a),board,'keyed_component')

    def test_revision_extracts_without_changing_source(self):
        from ai_ui_decomposition.component_boards import plan_boards
        from ai_ui_decomposition.board_extraction_revision import revise
        from ai_ui_decomposition.common import write_json,sha256
        f,slots,p=self.case()
        old=copy.deepcopy(p);old['version']='1.2';old.pop('disconnected_glyphs')
        description=dict(kind='ai_ui_material_observations_v2',strategy='component-family-board-v1',
            packing_canvas=[300,120],extraction_policy=old,assets=[dict(id=s['asset_id'],
                component_type='Image',component_group='icons',target_size=s['target_size'],
                source_reusable=False,source_evidence='Synthetic fixture') for s in slots])
        with tempfile.TemporaryDirectory() as td:
            root=Path(td);raw=root/'raw.png';strategy=root/'strategy.json'
            a=np.full((*f.shape,3),[248,8,248],dtype=np.uint8);a[f]=[40,60,80]
            Image.fromarray(a).save(raw);write_json(strategy,plan_boards(description))
            before=(sha256(raw),sha256(strategy))
            report=revise(raw,strategy,'icons',before[0],p,'Explicit fixture revision',root/'revision')
            self.assertEqual(len(report['parts']),3)
            self.assertEqual(before,(sha256(raw),sha256(strategy)))
            self.assertEqual(report['generation_calls'],0)
            self.assertFalse(report['human_visual_acceptance'])
