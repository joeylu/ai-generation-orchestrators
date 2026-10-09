"""Reproduce faint unused-cell contamination without weakening alpha gates."""
import _bootstrap
import unittest
from PIL import Image, ImageDraw
from ai_ui_layers.extract_sheets import partition_cells
from ai_ui_layers.generation_groups import (
    build_groups, CONTEXT_GROUP_POLICY, LEGACY_CONTEXT_GROUP_POLICY,
    DEFAULT_GROUP_POLICY,
)
from ai_ui_layers.sheet_pixels import NEAREST_SEAM


class FullContextGridTests(unittest.TestCase):
    def groups(self, count, size=(100, 100), policy=CONTEXT_GROUP_POLICY):
        ids=['item-'+str(i) for i in range(count)]
        visual=dict(objects=[dict(materialId=mid,kind='badge') for mid in ids])
        plan=dict(assets=[dict(id=mid,role='foreground',output_size=list(size)) for mid in ids])
        return build_groups(visual,plan,policy)['groups']

    def test_three_square_materials_no_longer_allocate_an_empty_cell(self):
        group=self.groups(3)[0]
        self.assertEqual(group['grid'],[3,1])
        self.assertEqual(group['outputSize'],[1536,512])
        self.assertEqual(len(group['materialIds']),3)
        for policy in (LEGACY_CONTEXT_GROUP_POLICY,DEFAULT_GROUP_POLICY):
            self.assertEqual(self.groups(3,policy=policy)[0]['grid'],[2,2])

    def test_all_group_sizes_and_orientations_are_fully_occupied(self):
        for count in range(1,13):
            for size in ((100,100),(300,100),(100,300),(191,196)):
                with self.subTest(count=count,size=size):
                    groups=self.groups(count,size)
                    self.assertEqual([mid for g in groups for mid in g['materialIds']],
                                     ['item-'+str(i) for i in range(count)])
                    for group in groups:
                        self.assertLessEqual(len(group['materialIds']),4)
                        if group['mode']=='sheet':
                            columns,rows=group['grid']
                            self.assertEqual(columns*rows,len(group['materialIds']))
                            self.assertEqual(max(group['outputSize']),1536)
                            self.assertTrue(all(n%8==0 for n in group['outputSize']))
        self.assertEqual(self.groups(3,(300,100))[0]['grid'],[1,3])
        self.assertEqual(self.groups(3,(100,300))[0]['grid'],[3,1])
        self.assertEqual(self.groups(4)[0]['grid'],[2,2])

    def test_context_cap_and_legacy_six_member_cap_are_preserved(self):
        for policy in (CONTEXT_GROUP_POLICY,LEGACY_CONTEXT_GROUP_POLICY):
            self.assertEqual([len(g['materialIds']) for g in self.groups(6,policy=policy)],[4,2])
        self.assertEqual([len(g['materialIds']) for g in self.groups(6,policy=DEFAULT_GROUP_POLICY)],[6])

    def test_faint_unused_cell_is_still_rejected_and_occupied_noise_is_retained(self):
        old=Image.new('RGBA',(200,200))
        draw=ImageDraw.Draw(old)
        for x,y in ((0,0),(100,0),(0,100)):
            draw.rectangle((x+20,y+20,x+79,y+79),fill=(30,60,90,255))
        for x in range(10):old.putpixel((145+x,155),(91,83,42,2))
        with self.assertRaisesRegex(ValueError,'SHEET_UNUSED_CELL_NOT_EMPTY'):
            partition_cells(old,dict(grid=[2,2],materialIds=['a','b','c']),NEAREST_SEAM)
        new=Image.new('RGBA',(300,100))
        draw=ImageDraw.Draw(new)
        for x in (0,100,200):
            draw.rectangle((x+20,20,x+79,79),fill=(30,60,90,255))
        for x in range(10):new.putpixel((245+x,85),(91,83,42,2))
        before=new.tobytes()
        boxes,proof=partition_cells(new,dict(grid=[3,1],materialIds=['a','b','c']),NEAREST_SEAM)
        self.assertEqual(new.tobytes(),before)
        self.assertEqual(new.crop(boxes[2]).getpixel((45,85)),(91,83,42,2))
        self.assertTrue(proof['allPreparedPixelsRetained'])
        self.assertEqual(proof['sourceRgbaPixelsSha256'],proof['reconstructedRgbaPixelsSha256'])
        new.putpixel((100,50),(30,60,90,255))
        # A full bridge between cells remains unsafe under the same seam rule.
        draw.rectangle((70,20,130,79),fill=(30,60,90,255))
        with self.assertRaisesRegex(ValueError,'SHEET_CONTOUR_TOUCHES_CELL_BOUNDARY'):
            partition_cells(new,dict(grid=[3,1],materialIds=['a','b','c']),NEAREST_SEAM)


if __name__=='__main__':unittest.main()
