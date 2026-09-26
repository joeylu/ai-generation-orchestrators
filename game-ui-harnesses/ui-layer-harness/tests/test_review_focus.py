import _bootstrap  # Enable source-layout imports for unittest discovery.
from pathlib import Path
import tempfile
import unittest
from PIL import Image, ImageDraw
from ai_ui_layers.review_focus import make_focus,make_small_material_focus
from ai_ui_layers.session_review import resume_command


class ReviewFocusTests(unittest.TestCase):
    def test_multicolor_small_material_gets_bound_original_detail(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);source=root/'source.png';image=Image.new('RGB',(400,400),'white')
            draw=ImageDraw.Draw(image)
            for index,color in enumerate(('#e02020','#e0a020','#20c030','#20b0d0','#3040c0','#d020b0')):
                draw.rectangle((100+index*8,100,107+index*8,149),fill=color)
            image.save(source)
            plan={'materials':[{'id':'multicolor-icon','role':'foreground',
                                'bboxNorm':[.25,.25,.375,.375]}]}
            focus=make_small_material_focus(source,plan,root)
            self.assertEqual(focus['detail']['materialId'],'multicolor-icon')
            self.assertTrue((root/focus['detail']['file']).is_file())
            with Image.open(root/focus['detail']['file']) as detail:
                self.assertGreaterEqual(detail.width,480)

    def test_near_edge_decoration_exposes_pixels_outside_parent_crop(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);source=root/'source.png';overlay=root/'overlay.png'
            clean=Image.new('RGB',(400,300),(20,40,20))
            ImageDraw.Draw(clean).rectangle((60,30,70,40),fill=(255,0,0))
            clean.save(source)
            marked=clean.copy();ImageDraw.Draw(marked).line((40,45,360,45),fill=(0,255,255),width=1)
            marked.save(overlay)
            plan={'materials':[{'id':'panel','role':'foreground','bboxNorm':[.1,.15,.9,.9]}],
                  'objects':[{'id':'sprig','kind':'decoration','materialId':'panel',
                              'bboxNorm':[.14,.16,.32,.5]}]}
            focus=make_focus(source,overlay,plan,root)
            self.assertEqual(len(focus),1)
            self.assertEqual((focus[0]['materialId'],focus[0]['edge'],focus[0]['distancePixels']),('panel','top',3))
            x0,y0,x1,y1=focus[0]['sourceBox']
            self.assertLessEqual(y0,30);self.assertGreater(y1,45)
            with Image.open(root/focus[0]['file']) as comparison:
                self.assertEqual(comparison.getpixel(((65-x0)*2,(35-y0)*2)),(255,0,0))
                self.assertEqual(comparison.getpixel(((x1-x0)*2+(65-x0)*2,(45-y0)*2)),(0,255,255))

    def test_resumed_review_attaches_bound_focus_after_original_and_overlay(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);m1=root/'m1';m2=root/'m2';m1.mkdir();m2.mkdir()
            for path in (m1/'reference.png',m2/'review-overlay.png',m2/'focus-01.png',
                         m2/'coverage-color-detail.png'):
                Image.new('RGB',(2,2)).save(path)
            args=resume_command('codex',m2,root,'12345678-1234-1234-1234-123456789abc')
            images=args[args.index('--image')+1].split(',')
            self.assertEqual(images,[str(m1/'reference.png'),str(m2/'review-overlay.png'),
                                     str(m2/'focus-01.png'),str(m2/'coverage-color-detail.png')])

    def test_full_owner_decoration_does_not_displace_local_edge_evidence(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);source=root/'source.png';overlay=root/'overlay.png'
            Image.new('RGB',(400,300)).save(source)
            Image.new('RGB',(400,300)).save(overlay)
            plan={'materials':[{'id':'panel','role':'foreground','bboxNorm':[.1,.15,.9,.9]}],
                  'objects':[{'id':'frame_foliage','kind':'decoration','materialId':'panel','bboxNorm':[.1,.15,.9,.9]},
                             {'id':'top_sprig','kind':'decoration','materialId':'panel','bboxNorm':[.2,.15,.4,.4]}]}
            focus=make_focus(source,overlay,plan,root,limit=1)
            self.assertEqual([(f['objectId'],f['edge']) for f in focus],[('top_sprig','top')])

    def test_corner_decoration_keeps_both_near_edges_before_other_marks(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);source=root/'source.png';overlay=root/'overlay.png'
            Image.new('RGB',(400,300)).save(source)
            Image.new('RGB',(400,300)).save(overlay)
            plan={'materials':[{'id':'panel','role':'foreground','bboxNorm':[.1,.15,.9,.9]}],
                  'objects':[{'id':'small_bottom','kind':'decoration','materialId':'panel','bboxNorm':[.7,.85,.8,.9]},
                             {'id':'small_left','kind':'decoration','materialId':'panel','bboxNorm':[.1,.5,.15,.6]},
                             {'id':'large_top','kind':'decoration','materialId':'panel','bboxNorm':[.1,.15,.5,.6]}]}
            focus=make_focus(source,overlay,plan,root,limit=3)
            self.assertEqual((focus[0]['objectId'],focus[0]['edge']),('large_top','top'))
            self.assertEqual((focus[1]['objectId'],focus[1]['edge']),('large_top','left'))
            self.assertNotEqual(focus[2]['objectId'],'large_top')

    def test_left_touch_does_not_hide_nearby_top_crop(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);source=root/'source.png';overlay=root/'overlay.png'
            Image.new('RGB',(400,300)).save(source)
            Image.new('RGB',(400,300)).save(overlay)
            plan={'materials':[{'id':'board','role':'foreground','bboxNorm':[.5,.15,.95,.9]}],
                  'objects':[{'id':'compass','kind':'decoration','materialId':'board',
                              'bboxNorm':[.5,.16,.65,.4]},
                             {'id':'tag','kind':'decoration','materialId':'board',
                              'bboxNorm':[.85,.5,.92,.7]}]}
            focus=make_focus(source,overlay,plan,root)
            self.assertEqual([(f['objectId'],f['edge']) for f in focus[:2]],
                             [('compass','left'),('compass','top')])

    def test_aligned_card_height_outlier_gets_source_and_overlay_closeup(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);source=root/'source.png';overlay=root/'overlay.png'
            clean=Image.new('RGB',(500,500),(10,20,30))
            ImageDraw.Draw(clean).line((100,102,400,102),fill=(40,80,100),width=1)
            for top,bottom in ((130,230),(250,350),(370,470)):
                ImageDraw.Draw(clean).rectangle((100,top,400,bottom),outline=(80,140,180))
            clean.save(source)
            marked=clean.copy();ImageDraw.Draw(marked).rectangle((100,100,400,230),outline=(255,0,0))
            marked.save(overlay)
            boxes=((.2,.2,.8,.46),(.2,.5,.8,.7),(.2,.74,.8,.94))
            plan={'materials':[{'id':f'card-{i}','role':'foreground','bboxNorm':list(box)}
                               for i,box in enumerate(boxes)],
                  'objects':[{'id':f'frame-{i}','kind':'card','materialId':f'card-{i}','bboxNorm':None}
                             for i in range(3)]}
            focus=make_focus(source,overlay,plan,root)
            self.assertEqual(len(focus),1)
            self.assertEqual(focus[0]['kind'],'repeated-card-height-outlier')
            self.assertEqual(focus[0]['suspectedOutlierId'],'card-0')
            self.assertEqual(focus[0]['medianHeightPixels'],100)
            self.assertEqual(focus[0]['peerHeightEdgeAlternativesPixels'],
                             {'topIfBottomCorrect':130,'bottomIfTopCorrect':200})
            self.assertEqual(focus[0]['materialIds'],['card-0','card-1','card-2'])
            self.assertTrue((root/focus[0]['file']).is_file())

    def test_equal_aligned_cards_receive_comparison_without_outlier_verdict(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);source=root/'source.png';overlay=root/'overlay.png'
            clean=Image.new('RGB',(500,500))
            ImageDraw.Draw(clean).line((100,70,400,70),fill=(30,90,120))
            clean.save(source)
            Image.new('RGB',(500,500)).save(overlay)
            boxes=((.2,.2,.8,.4),(.2,.45,.8,.65),(.2,.7,.8,.9))
            plan={'materials':[{'id':f'card-{i}','role':'foreground','bboxNorm':list(box)}
                               for i,box in enumerate(boxes)],
                  'objects':[{'id':f'frame-{i}','kind':'card','materialId':f'card-{i}','bboxNorm':None}
                             for i in range(3)]}
            focus=make_focus(source,overlay,plan,root)
            self.assertEqual(len(focus),1)
            self.assertEqual(focus[0]['kind'],'repeated-card-alignment-comparison')
            self.assertNotIn('suspectedOutlierId',focus[0])
            self.assertEqual(focus[0]['materialIds'],['card-0','card-1','card-2'])
            self.assertLessEqual(focus[0]['sourceBoxes'][0][1],70)


if __name__=='__main__':unittest.main()
