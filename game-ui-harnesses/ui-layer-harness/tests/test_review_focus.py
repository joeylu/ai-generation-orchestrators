import _bootstrap  # Enable source-layout imports for unittest discovery.
from pathlib import Path
import tempfile
import unittest
from PIL import Image, ImageDraw, ImageColor
from ai_ui_layers.review_focus import make_focus,make_small_material_focus
from ai_ui_layers.session_review import resume_command
from ai_ui_layers.planning_review_policy import split


def displayed_pixel(context_box, display_box, source_xy):
    """Sample the center of one source pixel in an equally scaled context viewport."""
    left,top,right,bottom=context_box
    x,y,xx,yy=display_box
    source_x,source_y=source_xy
    return (x+int((source_x+.5-left)*(xx-x)/(right-left)),
            y+int((source_y+.5-top)*(yy-y)/(bottom-top)))


class ReviewFocusTests(unittest.TestCase):
    def test_small_focus_shows_all_four_excluded_edges_without_painting_source(self):
        import copy
        from ai_ui_layers.evaluate import digest
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);source=root/'source.png'
            image=Image.new('RGB',(200,200),(80,90,100));draw=ImageDraw.Draw(image)
            # A 20x20 candidate on a larger canvas qualifies for small focus.
            draw.rectangle((60,60,79,79),fill=(22,110,170))
            excluded={(59,70):(230,20,30),(70,59):(20,220,40),
                      (80,70):(20,40,230),(70,80):(230,210,20),
                      (59,59):(210,30,210),(80,80):(30,210,210)}
            for xy,color in excluded.items():draw.point(xy,fill=color)
            included=((60,70),(70,60),(79,70),(70,79),(70,70))
            image.save(source);source_sha=digest(source)
            plan={'materials':[{'id':'mark','role':'foreground',
                                'bboxNorm':[60/200,60/200,80/200,80/200]}]}
            before=copy.deepcopy(plan)
            focus=make_small_material_focus(source,plan,root)
            item=focus['items'][0]
            self.assertEqual(item['sourceBox'],[60,60,80,80])
            self.assertEqual(item['displaySourceBox'],item['contextBox'])
            left=item['contextDisplayBox'];right=item['candidateViewportDisplayBox']
            self.assertEqual((left[2]-left[0],left[3]-left[1]),
                             (right[2]-right[0],right[3]-right[1]))
            with Image.open(root/focus['file']) as board:
                for xy,color in excluded.items():
                    self.assertEqual(board.getpixel(displayed_pixel(item['contextBox'],left,xy)),color)
                    self.assertEqual(board.getpixel(displayed_pixel(item['contextBox'],right,xy)),
                                     (31,38,47))
                for xy in included:
                    a=displayed_pixel(item['contextBox'],left,xy)
                    b=displayed_pixel(item['contextBox'],right,xy)
                    self.assertEqual((b[0]-right[0],b[1]-right[1]),
                                     (a[0]-left[0],a[1]-left[1]))
                    self.assertEqual(board.getpixel(a),image.getpixel(xy))
                    self.assertEqual(board.getpixel(b),image.getpixel(xy))
            self.assertEqual(plan,before)
            self.assertEqual(digest(source),source_sha)

    def test_overflow_second_page_keeps_non_detail_one_column_edge(self):
        import copy
        from ai_ui_layers.evaluate import digest
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);source=root/'source.png'
            image=Image.new('RGB',(200,200),(65,75,85));draw=ImageDraw.Draw(image)
            materials=[]
            for index in range(13):
                x=20+(index%4)*40;y=20+(index//4)*40
                draw.rectangle((x,y,x+9,y+9),fill=(25,95,175))
                materials.append(dict(id=f'icon-{index}',role='foreground',
                    bboxNorm=[x/200,y/200,(x+10)/200,(y+10)/200]))
            outside=(19,145);draw.point(outside,fill=(245,215,15))
            image.save(source);source_sha=digest(source)
            plan={'materials':materials};before=copy.deepcopy(plan)
            focus=make_small_material_focus(source,plan,root)
            self.assertEqual(len(focus['pages']),2)
            self.assertEqual(focus['pages'][1]['materialIds'],['icon-12'])
            self.assertNotEqual(focus['detail']['materialId'],'icon-12')
            item=focus['boundaryOnlyItems'][0]
            self.assertEqual(item['materialId'],'icon-12')
            self.assertEqual(item['sourceBox'],[20,140,30,150])
            self.assertEqual(item['displaySourceBox'],item['contextBox'])
            with Image.open(root/focus['pages'][1]['file']) as board:
                self.assertEqual(board.getpixel(displayed_pixel(
                    item['contextBox'],item['contextDisplayBox'],outside)),(245,215,15))
                self.assertEqual(board.getpixel(displayed_pixel(
                    item['contextBox'],item['candidateViewportDisplayBox'],outside)),(31,38,47))
                inside=(20,145)
                self.assertEqual(board.getpixel(displayed_pixel(
                    item['contextBox'],item['candidateViewportDisplayBox'],inside)),
                    image.getpixel(inside))
            self.assertEqual(plan,before)
            self.assertEqual(digest(source),source_sha)

    def test_larger_early_slot_faces_cannot_displace_smaller_late_symbols(self):
        import copy
        from ai_ui_layers.evaluate import digest
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);source=root/'source.png'
            Image.new('RGB',(1000,1000),(40,40,40)).save(source);source_sha=digest(source)
            faces=[dict(id=f'face-{i}',role='foreground',bboxNorm=[.1,.1,.18,.18]) for i in range(12)]
            symbols=[dict(id=f'symbol-{i}',role='foreground',bboxNorm=[.2,.2,.22+i/1000,.22]) for i in range(13)]
            plan=dict(materials=faces+list(reversed(symbols)));before=copy.deepcopy(plan)
            first=root/'first';first.mkdir();focus=make_small_material_focus(source,plan,first)
            self.assertEqual([row['materialId'] for row in focus['items']],
                             [f'symbol-{i}' for i in range(12)])
            self.assertEqual({row['materialId'] for row in focus['boundaryOnlyItems']},
                             {'symbol-12'}|{f'face-{i}' for i in range(12)})
            self.assertEqual(sum(len(page['materialIds']) for page in focus['pages']),25)
            self.assertEqual(plan,before);self.assertEqual(digest(source),source_sha)
            second=root/'second';second.mkdir()
            reordered=make_small_material_focus(source,dict(materials=symbols+faces),second)
            self.assertEqual(focus['items'],reordered['items'])

    def test_small_crop_context_exposes_omitted_contour_without_changing_plan(self):
        import copy
        from ai_ui_layers.evaluate import digest
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);source=root/'source.png'
            image=Image.new('RGB',(400,600),(20,30,40))
            # An upper colored segment is outside an incorrectly lowered crop.
            ImageDraw.Draw(image).rectangle((350,8,365,20),fill=(250,220,10))
            ImageDraw.Draw(image).rectangle((350,21,365,44),fill=(80,170,90))
            image.save(source);before=digest(source)
            plan=dict(materials=[dict(id='symbol',role='foreground',bboxNorm=[.85,.04,.95,.10])])
            original=copy.deepcopy(plan)
            focus=make_small_material_focus(source,plan,root)
            self.assertEqual(plan,original);self.assertEqual(digest(source),before)
            item=focus['items'][0]
            self.assertLessEqual(item['contextBox'][1],8)
            self.assertGreater(item['sourceBox'][1],20)
            with Image.open(root/focus['file']) as board:
                left=board.crop((0,0,board.width//2,board.height))
                right=board.crop((board.width//2,0,board.width,board.height))
                self.assertIn((250,220,10),[color for _,color in left.getcolors(left.width*left.height)])
                self.assertNotIn((250,220,10),[color for _,color in right.getcolors(right.width*right.height)])
            self.assertEqual(focus['imageSha256'],digest(root/focus['file']))

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
                expected={(255,255,255)} | {ImageColor.getrgb(color) for color in
                    ('#e02020','#e0a020','#20c030','#20b0d0','#3040c0','#d020b0')}
                self.assertTrue({color for _,color in detail.getcolors(detail.width*detail.height)} <= expected)

    def test_tiniest_gray_icon_keeps_one_pixel_highlight_in_bound_detail(self):
        from ai_ui_layers.evaluate import digest
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);source=root/'source.png'
            image=Image.new('RGB',(400,400),(18,18,18));draw=ImageDraw.Draw(image)
            for index,color in enumerate(('#e02020','#e0a020','#20c030')):
                draw.rectangle((100+index*8,100,107+index*8,149),fill=color)
            draw.rectangle((200,200,215,215),fill=(70,70,70))
            draw.point((204,203),fill=(245,243,230))
            image.save(source)
            plan={'materials':[
                {'id':'large-colorful','role':'foreground','bboxNorm':[.25,.25,.375,.375]},
                {'id':'tiny-gray','role':'foreground','bboxNorm':[.5,.5,.54,.54]}]}
            focus=make_small_material_focus(source,plan,root)
            self.assertEqual(focus['detail']['materialId'],'tiny-gray')
            detail_path=root/focus['detail']['file']
            self.assertEqual(focus['detail']['imageSha256'],digest(detail_path))
            context_box=focus['detail']['sourceBox']
            self.assertEqual(focus['detail']['candidateBox'],[200,200,216,216])
            with Image.open(detail_path) as detail:
                self.assertEqual(detail.size,(512,512))
                sx=detail.width/(context_box[2]-context_box[0])
                sy=detail.height/(context_box[3]-context_box[1])
                sample=(int((204.5-context_box[0])*sx),int((203.5-context_box[1])*sy))
                self.assertEqual(detail.getpixel(sample),(245,243,230))
                self.assertEqual({color for _,color in detail.getcolors(detail.width*detail.height)},
                                 {(18,18,18),(70,70,70),(245,243,230)})

    def test_small_detail_exposes_unmarked_highlight_above_candidate_crop(self):
        import copy
        from ai_ui_layers.evaluate import digest
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);source=root/'source.png'
            image=Image.new('RGB',(160,160),(18,18,18));draw=ImageDraw.Draw(image)
            draw.rectangle((60,60,80,80),fill=(45,105,65))
            # Two pale rows lie outside the candidate; its diagnostic line
            # would overwrite one of them in the marked context sheet.
            draw.rectangle((68,59,72,63),fill=(245,245,240))
            image.save(source);source_sha=digest(source)
            plan={'materials':[{'id':'small-icon','role':'foreground',
                                'bboxNorm':[60/160,61/160,81/160,81/160]}]}
            original=copy.deepcopy(plan)
            focus=make_small_material_focus(source,plan,root)
            context_box=focus['detail']['sourceBox']
            self.assertLessEqual(context_box[1],59)
            self.assertEqual(focus['detail']['candidateBox'],[60,61,81,81])
            detail_path=root/focus['detail']['file']
            self.assertEqual(focus['detail']['imageSha256'],digest(detail_path))
            with Image.open(detail_path) as detail:
                sx=detail.width/(context_box[2]-context_box[0])
                sy=detail.height/(context_box[3]-context_box[1])
                for y in (59,60,61):
                    sample=(int((70.5-context_box[0])*sx),int((y+.5-context_box[1])*sy))
                    self.assertEqual(detail.getpixel(sample),(245,245,240))
                colors={color for _,color in detail.getcolors(detail.width*detail.height)}
                self.assertNotIn((255,70,210),colors)
            self.assertEqual(plan,original)
            self.assertEqual(digest(source),source_sha)

    def test_overflow_small_materials_keep_boundary_evidence_and_block_clipped_crop(self):
        from ai_ui_layers.evaluate import digest
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);m1=root/'m1';m2=root/'m2';m1.mkdir();m2.mkdir()
            # Binary-exact normalized bounds keep equal-area crops equal after
            # outward pixel rounding, so this fixture tests the overflow page.
            source=m1/'reference.png';image=Image.new('RGB',(512,256),(25,25,25))
            materials=[]
            for index in range(13):
                x=20+(index%7)*60;y=30+(index//7)*70
                materials.append(dict(id=f'icon-{index}',role='foreground',
                                      bboxNorm=[x/512,y/256,(x+20)/512,(y+20)/256]))
            ImageDraw.Draw(image).rectangle((320,96,339,101),fill=(250,220,10))
            image.save(source)
            focus=make_small_material_focus(source,dict(materials=materials),m2)
            self.assertEqual(len(focus['items']),12)
            self.assertEqual([row['materialId'] for row in focus['boundaryOnlyItems']],['icon-12'])
            self.assertEqual(len(focus['pages']),2)
            for page in focus['pages']:
                self.assertEqual(page['imageSha256'],digest(m2/page['file']))
            with Image.open(m2/focus['pages'][1]['file']) as board:
                self.assertIn((250,220,10),[color for _,color in board.getcolors(board.width*board.height)])
            for name in ('review-overlay.png',):Image.new('RGB',(2,2)).save(m2/name)
            args=resume_command('codex',m2,root,'12345678-1234-1234-1234-123456789abc')
            images=args[args.index('--image')+1].split(',')
            self.assertIn(str(m2/focus['pages'][1]['file']),images)
            self.assertLess(images.index(str(m2/focus['pages'][0]['file'])),
                            images.index(str(m2/focus['pages'][1]['file'])))
            review=dict(issues=[],smallBoundaryAudit=[dict(materialId='icon-12',
                boundary=dict(status='clipped',evidence='The yellow contour extends above the crop.'))])
            self.assertEqual(split(review)[0][0]['ids'],['icon-12'])

    def test_small_narrow_icon_is_audited_without_consuming_a_strip_slot(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);source=root/'source.png'
            Image.new('RGB',(400,300),(25,25,25)).save(source)
            plan=dict(materials=[
                dict(id='tabs',role='foreground',bboxNorm=[.1,.1,.4,.1667]),
                dict(id='torch',role='foreground',bboxNorm=[.2,.3,.23,.41])])
            focus=make_small_material_focus(source,plan,root)
            self.assertEqual([item['materialId'] for item in focus['items']],['torch'])

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
