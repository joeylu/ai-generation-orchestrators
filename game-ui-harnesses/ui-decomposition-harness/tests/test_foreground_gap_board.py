import copy
import tempfile
import unittest
from pathlib import Path
from PIL import Image,ImageDraw
from ai_ui_decomposition.component_boards import plan_boards,crop_board
from ai_ui_decomposition.common import write_json,sha256
from ai_ui_decomposition.board_extraction_revision import revise


class GapBoardTests(unittest.TestCase):
    def setUp(self):
        self.policy={'version':'1.0','mode':'foreground-gap-row','target_padding':2,'max_canvas_aspect_error':.15}
        self.strategy=plan_boards({'kind':'ai_ui_material_observations_v2','strategy':'component-family-board-v1',
            'packing_canvas':[256,256],'extraction_policy':self.policy,
            'assets':[{'id':'icon-'+str(i),'component_type':'Image','component_group':'icons','target_size':[32,32],
                       'source_reusable':False,'source_evidence':''} for i in range(3)]})
        self.board=self.strategy['boards'][0]
        self.raw=Image.new('RGB',(256,256),(255,0,255))
        d=ImageDraw.Draw(self.raw)
        for x in (10,100,200):d.ellipse((x,105,x+30,135),fill=(0,120,220))

    def test_shifted_icons_preserve_padding_and_legacy_failure(self):
        parts,records=crop_board(self.raw,self.board,'keyed_component')
        self.assertEqual(len(parts),3)
        for part in parts.values():
            self.assertEqual(part.size,(32,32));self.assertEqual(part.getchannel('A').getextrema(),(0,255))
            l,t,r,b=part.getchannel('A').getbbox();self.assertGreaterEqual(l,2);self.assertLessEqual(r,30)
        self.assertTrue(all(r['semantic_identity']=='requires_review' for r in records))
        old=copy.deepcopy(self.board);old['extraction_policy']['mode']='relative-cell'
        with self.assertRaises(Exception):crop_board(self.raw,old,'keyed_component')

    def test_joined_and_missing_fail(self):
        for rectangle in ((20,115,220,120),(200,100,235,140)):
            raw=self.raw.copy();ImageDraw.Draw(raw).rectangle(rectangle,fill=(0,120,220) if rectangle[0]==20 else (255,0,255))
            with self.assertRaisesRegex(Exception,'BOARD_GAP_COUNT_OR_JOINED'):crop_board(raw,self.board,'keyed_component')

    def test_edge_noise_and_multiple_rows_fail(self):
        raw=self.raw.copy();ImageDraw.Draw(raw).rectangle((0,110,15,120),fill=(0,120,220))
        with self.assertRaisesRegex(Exception,'BOARD_GAP_CANVAS_CLIPPED'):crop_board(raw,self.board,'keyed_component')
        raw=self.raw.copy();raw.putpixel((70,70),(0,0,0))
        with self.assertRaisesRegex(Exception,'BOARD_GAP_COUNT_OR_JOINED'):crop_board(raw,self.board,'keyed_component')
        raw=self.raw.copy();ImageDraw.Draw(raw).rectangle((15,180,25,190),fill=(0,120,220))
        with self.assertRaisesRegex(Exception,'BOARD_GAP_MULTIPLE_ROWS'):crop_board(raw,self.board,'keyed_component')

    def test_revision_hash_and_no_overwrite(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);raw=root/'raw.png';self.raw.save(raw);strategy=root/'strategy.json';write_json(strategy,self.strategy)
            original=strategy.read_bytes();output=root/'revision'
            with self.assertRaisesRegex(Exception,'BOARD_RAW_CHANGED'):
                revise(raw,strategy,'icons','0'*64,self.policy,'authorized extraction change',output)
            report=revise(raw,strategy,'icons',sha256(raw),self.policy,'authorized extraction change',output)
            self.assertEqual(strategy.read_bytes(),original);self.assertFalse(report['human_visual_acceptance'])
            with self.assertRaisesRegex(Exception,'OUTPUT_EXISTS'):
                revise(raw,strategy,'icons',sha256(raw),self.policy,'authorized extraction change',output)
