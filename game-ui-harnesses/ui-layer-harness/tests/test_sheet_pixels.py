import _bootstrap
import tempfile
import unittest
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw
from ai_ui_layers.sheet_pixels import prepare, axis_cuts
from ai_ui_layers.extract_sheets import cells
from ai_ui_layers.evaluate import digest


class SheetPixelTests(unittest.TestCase):
    def test_cleanup_preserves_all_channels_above_floor_and_raw(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);raw=root/'raw.png';out=root/'clean.png'
            a=np.zeros((40,40,4),dtype=np.uint8)
            a[:]=[110,65,99,0]
            for i,alpha in enumerate((1,2,6,127,254,255)):
                a[10,i+10]=[123,87,231,alpha]
            Image.fromarray(a).save(raw);before=digest(raw)
            evidence=prepare(raw,out);b=np.array(Image.open(out))
            self.assertEqual(before,digest(raw))
            self.assertTrue(np.array_equal(b[a[:,:,3]>1],a[a[:,:,3]>1]))
            self.assertFalse(b[a[:,:,3]<=1].any())
            self.assertEqual(evidence['preparedSha256'],digest(out))

    def test_actual_gap_avoids_cutting_solid_card_without_losing_pixels(self):
        im=Image.new('RGBA',(120,200));d=ImageDraw.Draw(im)
        d.rectangle((10,10,109,110),fill=(50,80,110,255))
        d.rectangle((10,135,109,189),fill=(50,80,110,128))
        row=dict(grid=[1,2],materialIds=['a','b'])
        with self.assertRaisesRegex(ValueError,'CONTOUR_TOUCHES'):cells(im,row)
        boxes=cells(im,row,actual_gaps=True)
        self.assertGreater(boxes[0][3],110)
        self.assertEqual(boxes[0][3],boxes[1][1])
        rebuilt=Image.new('RGBA',im.size)
        for box in boxes: rebuilt.paste(im.crop(box),(box[0],box[1]))
        self.assertEqual(rebuilt.tobytes(),im.tobytes())

    def test_bridge_and_multiple_candidate_gaps_fail(self):
        im=Image.new('RGBA',(120,200));d=ImageDraw.Draw(im)
        d.rectangle((10,10,109,189),fill='white')
        with self.assertRaisesRegex(ValueError,'CONTOUR_TOUCHES'):
            axis_cuts(np.array(im)[:,:,3],2,0)
        d.rectangle((0,80,119,89),fill=(0,0,0,0))
        d.rectangle((0,110,119,119),fill=(0,0,0,0))
        with self.assertRaisesRegex(ValueError,'AMBIGUOUS'):
            axis_cuts(np.array(im)[:,:,3],2,0)

    def test_outer_edge_and_nonempty_unused_cell_still_fail(self):
        im=Image.new('RGBA',(200,200));d=ImageDraw.Draw(im)
        for x,y in ((0,0),(100,0),(0,100)):
            d.rectangle((x+20,y+20,x+79,y+79),fill='white')
        row=dict(grid=[2,2],materialIds=['a','b','c'])
        self.assertEqual(len(cells(im,row,True)),3)
        im.putpixel((150,150),(1,2,3,255))
        with self.assertRaisesRegex(ValueError,'UNUSED'):cells(im,row,True)
        im.putpixel((150,150),(0,0,0,0));im.putpixel((0,50),(1,2,3,255))
        with self.assertRaisesRegex(ValueError,'CONTOUR_TOUCHES'):cells(im,row,True)
