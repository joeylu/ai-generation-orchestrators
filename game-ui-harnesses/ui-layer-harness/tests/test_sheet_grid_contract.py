"""Reproduce a native vertical-grid transpose and freeze unambiguous sheet directions."""
import _bootstrap
import unittest
from PIL import Image,ImageDraw
from ai_ui_layers import context_references as context
from ai_ui_layers.extract_sheets import cells
import test_context_short_v5


class SheetGridContractTests(unittest.TestCase):
    def prompt(self,grid):
        names,colors=test_context_short_v5.FIXTURES[0]
        visual,plan=test_context_short_v5.layered_fixture(names,colors)
        return context.prompt(visual,plan,list(names[:3]),
                              dict(grid=grid,outputSize=[1536,1088]),version='v7')

    def test_three_vertical_references_are_assigned_to_distinct_rows(self):
        text=self.prompt([1,3])
        self.assertIn('Grid 1 columns by 3 rows',text)
        self.assertIn('canvas width 1536 px, height 1088 px',text)
        self.assertIn('Stack cells vertically, top to bottom',text)
        for index in range(3):
            self.assertIn(f'Reference {index+1}, cell {index}: owned parts:',text)
            self.assertIn(f'Cell {index} uses zero-based column 0, row {index}',text)
        self.assertNotIn('Grid 1x3',text)

    def test_three_horizontal_references_are_assigned_to_distinct_columns(self):
        text=self.prompt([3,1])
        self.assertIn('Grid 3 columns by 1 rows',text)
        self.assertIn('Place cells horizontally, left to right',text)
        for index in range(3):
            self.assertIn(f'Cell {index} uses zero-based column {index}, row 0',text)

    def test_matrix_order_keeps_empty_final_cell(self):
        text=self.prompt([2,2])
        self.assertIn('Grid 2 columns by 2 rows',text)
        self.assertIn('unused cells empty',text)
        self.assertIn('Fill each row left to right, then proceed top to bottom',text)
        self.assertIn('Cell 2 uses zero-based column 0, row 1',text)

    @staticmethod
    def sheet(horizontal):
        image=Image.new('RGBA',(600,300));draw=ImageDraw.Draw(image)
        for index,color in enumerate(('red','yellow','green')):
            box=(index*200+20,110,index*200+180,190) if horizontal else (140,index*100+20,460,index*100+80)
            draw.rounded_rectangle(box,radius=20,fill=color)
        return image

    def test_actual_horizontal_native_layout_is_rejected_as_vertical_sheet(self):
        row=dict(grid=[1,3],materialIds=['red','yellow','green'])
        with self.assertRaisesRegex(ValueError,'SHEET_MISSING_MATERIAL'):
            cells(self.sheet(True),row,actual_gaps=True)

    def test_correct_vertical_native_layout_keeps_all_three_materials(self):
        row=dict(grid=[1,3],materialIds=['red','yellow','green'])
        image=self.sheet(False)
        boxes=cells(image,row,actual_gaps=True)
        self.assertEqual(len(boxes),3)
        for index,box in enumerate(boxes):
            self.assertEqual(image.getpixel((300,(box[1]+box[3])//2)),
                             ((255,0,0,255),(255,255,0,255),(0,128,0,255))[index])


if __name__=='__main__':unittest.main()
