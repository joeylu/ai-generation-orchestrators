import _bootstrap
import tempfile
import unittest
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw
from ai_ui_layers.sheet_pixels import prepare, prepared_image, axis_cuts, partition_observations, NEAREST_SEAM
from ai_ui_layers.extract_sheets import cells, partition_cells
from ai_ui_layers.evaluate import digest


class SheetPixelTests(unittest.TestCase):
    def test_connected_faint_glow_has_no_safe_seams_even_with_transparent_outer_edges(self):
        image=Image.new('RGBA',(128,512));draw=ImageDraw.Draw(image)
        for y in range(4):draw.rectangle((20,y*128+20,108,y*128+108),fill=(40,80,100,255))
        draw.line((64,20,64,492),fill=(40,80,100,2))
        row=dict(grid=[1,4],materialIds=['a','b','c','d'])
        prepared,_=prepared_image(image);before=prepared.tobytes()
        observations=partition_observations(prepared,row,NEAREST_SEAM)
        self.assertEqual(observations['axes']['y']['failureCode'],'SHEET_CONTOUR_TOUCHES_CELL_BOUNDARY')
        self.assertTrue(all(s['longestFullSpanEmptyBand']==0 for s in observations['axes']['y']['seams']))
        self.assertTrue(all(e['nonzeroAlphaPixels']==0 for e in observations['outerBoundary'].values()))
        self.assertEqual(before,prepared.tobytes())
        self.assertFalse(observations['transparentPartitionProven'])
        self.assertFalse(observations['sourceCompletenessAccepted'])
        with self.assertRaisesRegex(ValueError,'CONTOUR_TOUCHES'):partition_cells(prepared,row,NEAREST_SEAM)

    def test_diagnostics_do_not_raise_the_existing_alpha_floor_to_cut_glow(self):
        row=dict(grid=[1,2],materialIds=['a','b'])
        for alpha,failed in ((1,False),(2,True)):
            image=Image.new('RGBA',(128,256));draw=ImageDraw.Draw(image)
            for y in (0,128):draw.rectangle((20,y+20,108,y+108),fill='white')
            draw.line((64,20,64,236),fill=(40,80,100,alpha))
            prepared,_=prepared_image(image)
            observed=partition_observations(prepared,row,NEAREST_SEAM)
            self.assertEqual(observed['axes']['y']['failureCode'] is not None,failed)
            self.assertEqual(prepared.getpixel((64,128))[3],alpha if alpha>1 else 0)

    def test_clipped_outer_edge_is_distinct_from_missing_internal_seams(self):
        image=Image.new('RGBA',(128,256));draw=ImageDraw.Draw(image)
        for y in (0,128):draw.rectangle((20,y+20,127,y+108),fill='white')
        row=dict(grid=[1,2],materialIds=['a','b'])
        observations=partition_observations(image,row,NEAREST_SEAM)
        self.assertIsNone(observations['axes']['y']['failureCode'])
        self.assertGreater(observations['outerBoundary']['right']['nonzeroAlphaPixels'],0)
        with self.assertRaisesRegex(ValueError,'CONTOUR_TOUCHES'):partition_cells(image,row,NEAREST_SEAM)

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

    def test_nearest_seam_keeps_intervening_noise_and_all_rgba_pixels(self):
        im=Image.new('RGBA',(120,200));d=ImageDraw.Draw(im)
        d.rectangle((10,10,109,80),fill=(30,60,90,255))
        d.rectangle((10,125,109,189),fill=(70,50,20,128))
        im.putpixel((37,90),(91,83,42,2))
        row=dict(grid=[1,2],materialIds=['a','b'])
        before=im.tobytes()
        with self.assertRaisesRegex(ValueError,'AMBIGUOUS'):cells(im,row,True)
        boxes,proof=partition_cells(im,row,NEAREST_SEAM)
        self.assertEqual(boxes[0][3],100)
        self.assertEqual(im.tobytes(),before)
        self.assertEqual(im.crop(boxes[0]).getpixel((37,90)),(91,83,42,2))
        self.assertTrue(proof['allPreparedPixelsRetained'])
        self.assertEqual(proof['sourceRgbaPixelsSha256'],proof['reconstructedRgbaPixelsSha256'])
        self.assertFalse(proof['sourceBoundaryRelaxed'])

    def test_nearest_seam_tie_bridge_outer_and_unused_remain_blocking(self):
        a=np.ones((200,120),dtype=np.uint8)*255
        a[85:90]=0;a[110:115]=0
        with self.assertRaisesRegex(ValueError,'SEAM_TIE'):axis_cuts(a,2,0,NEAREST_SEAM)
        with self.assertRaisesRegex(ValueError,'CONTOUR_TOUCHES'):axis_cuts(np.ones_like(a),2,0,NEAREST_SEAM)
        im=Image.new('RGBA',(200,200));d=ImageDraw.Draw(im)
        for x,y in ((0,0),(100,0),(0,100)):d.rectangle((x+20,y+20,x+79,y+79),fill='white')
        row=dict(grid=[2,2],materialIds=['a','b','c'])
        im.putpixel((150,150),(1,2,3,2))
        with self.assertRaisesRegex(ValueError,'UNUSED'):partition_cells(im,row,NEAREST_SEAM)
        im.putpixel((150,150),(0,0,0,0));im.putpixel((0,50),(1,2,3,2))
        with self.assertRaisesRegex(ValueError,'CONTOUR_TOUCHES'):partition_cells(im,row,NEAREST_SEAM)
        with self.assertRaisesRegex(ValueError,'SEAM_POLICY'):cells(im,row,True,'unknown')
