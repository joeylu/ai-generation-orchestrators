import copy
import unittest
import numpy as np
from PIL import Image,ImageDraw
from ai_ui_decomposition.component_boards import plan_boards,crop_board,validate_canvas_size
from ai_ui_decomposition.common import ContractError
from ai_ui_decomposition.relative_board import validate_policy


def policy():
    return dict(version='1.1',mode='foreground-gap-row',target_padding=2,
                canvas_policy='content-bounds',max_internal_gap_ratio=.04,max_part_aspect_error=.35)


def board():
    return plan_boards(dict(kind='ai_ui_material_observations_v2',strategy='component-family-board-v1',
        packing_canvas=[240,240],extraction_policy=policy(),assets=[dict(id=k,component_type='Tabs',component_group='tabs',
        target_size=s,source_reusable=False,source_evidence='') for k,s in [('tab',[84,44]),('icon',[44,44])]]))['boards'][0]


def picture():
    im=Image.new('RGB',(190,80),'#F808F8');d=ImageDraw.Draw(im)
    d.rectangle((10,20,89,59),fill='#236060')
    d.rectangle((120,20,155,59),fill='#EEEACC')
    d.rectangle((157,20,159,59),fill='#EEEACC')  # one-pixel internal gap, not a third part
    return im


class ContentGapTests(unittest.TestCase):
    def test_short_detached_stroke_and_two_pixel_vertical_gap(self):
        b=board();b['extraction_policy']['max_internal_gap_ratio']=.05
        im=picture();d=ImageDraw.Draw(im)
        d.rectangle((157,20,159,59),fill='#F808F8');d.rectangle((157,35,159,44),fill='#EEEACC')
        d.rectangle((120,30,155,31),fill='#F808F8')
        parts,_=crop_board(im,b,'keyed_component')
        self.assertEqual(len(parts),2)

    def test_ingestion_checks_content_before_next_dispatch(self):
        from pathlib import Path
        import tempfile
        from ai_ui_decomposition.common import write_json
        from ai_ui_decomposition.material_preflight import check_material
        b=board()
        strategy=plan_boards(dict(kind='ai_ui_material_observations_v2',strategy='component-family-board-v1',packing_canvas=b['canvas'],extraction_policy=policy(),assets=[dict(id=s['asset_id'],component_type='Tabs',component_group='tabs',target_size=s['target_size'],source_reusable=False,source_evidence='') for s in b['slots']]))
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp)
            write_json(root/'s.json',strategy)
            write_json(root/'material-catalog.json',dict(strategies={'tabs':dict(path='s.json',digest=strategy['digest'])}))
            write_json(root/'plan.json',dict(assets=[dict(id='board-tabs',prompt=f"component-family-board-v1:{strategy['digest']}:tabs")]))
            picture().save(root/'raw.png');check_material(root,'board-tabs',root/'raw.png')
            Image.new('RGB',(190,80),'#F808F8').save(root/'missing.png')
            with self.assertRaisesRegex(ContractError,'COUNT'):check_material(root,'board-tabs',root/'missing.png')

    def test_non_square_and_internal_gap_preserve_pixels_and_geometry(self):
        im=picture();before=im.tobytes();parts,rows=crop_board(im,board(),'keyed_component')
        self.assertEqual(im.tobytes(),before);self.assertEqual(len(parts),2)
        self.assertEqual(parts['icon'].size,(44,44));self.assertEqual(rows[1]['grouping_policy'],policy())
        # A separated right-hand sliver is retained, not erased to repair counts.
        self.assertGreater(parts['icon'].getpixel((40,22))[3],0)
        for p in parts.values():
            a=np.asarray(p);self.assertEqual(p.getchannel('A').getextrema(),(0,255))
            self.assertTrue((a[a[:,:,3]==0,:3]==0).all())

    def test_missing_extra_joined_clipped_wrong_key_and_wrong_shape_fail(self):
        cases=[]
        im=picture();ImageDraw.Draw(im).rectangle((120,0,189,79),fill='#F808F8');cases.append((im,'COUNT'))
        im=picture();ImageDraw.Draw(im).rectangle((174,20,180,59),fill='white');cases.append((im,'COUNT'))
        im=picture();ImageDraw.Draw(im).rectangle((90,30,119,35),fill='white');cases.append((im,'COUNT'))
        im=picture();im.putpixel((0,40),(255,255,255));cases.append((im,'CLIPPED'))
        cases.append((Image.new('RGB',(190,80),'white'),'KEY_BACKGROUND'))
        im=picture();ImageDraw.Draw(im).rectangle((10,20,75,59),fill='#F808F8');cases.append((im,'PART_ASPECT'))
        for im,code in cases:
            with self.subTest(code=code),self.assertRaisesRegex(ContractError,code):crop_board(im,board(),'keyed_component')

    def test_close_independent_parts_are_not_merged_to_match_count(self):
        im=picture();d=ImageDraw.Draw(im);d.rectangle((0,0,189,79),fill='#F808F8')
        d.rectangle((10,20,89,59),fill='white');d.rectangle((93,20,132,59),fill='white')
        with self.assertRaisesRegex(ContractError,'AMBIGUOUS_SEPARATION'):crop_board(im,board(),'keyed_component')

    def test_legacy_still_rejects_aspect_and_split_icon(self):
        b=board();b['extraction_policy']=dict(version='1.0',mode='foreground-gap-row',target_padding=2,max_canvas_aspect_error=.15)
        with self.assertRaisesRegex(ContractError,'CANVAS_ASPECT'):crop_board(picture(),b,'keyed_component')
        im=Image.new('RGB',(240,240),'#F808F8');im.paste(picture(),(10,50))
        with self.assertRaisesRegex(ContractError,'COUNT'):crop_board(im,b,'keyed_component')

    def test_policy_rejects_implicit_upgrade_nonfinite_and_unbounded_tolerances(self):
        for patch in [dict(version='1.2'),dict(mode='relative-cell'),dict(canvas_policy='anything'),
                      dict(max_internal_gap_ratio=.1),dict(max_internal_gap_ratio=float('nan')),
                      dict(max_part_aspect_error=.6),dict(max_canvas_aspect_error=.15),dict(target_padding=True)]:
            p=policy();p.update(patch)
            with self.subTest(patch=patch),self.assertRaisesRegex(ContractError,'POLICY'):validate_policy(p)
        with self.assertRaises(ContractError):validate_canvas_size([10000,10000],board())

    def test_multirow_is_rejected(self):
        im=picture();d=ImageDraw.Draw(im);d.rectangle((10,30,89,44),fill='#F808F8')
        with self.assertRaisesRegex(ContractError,'MULTIPLE_ROWS'):crop_board(im,board(),'keyed_component')
