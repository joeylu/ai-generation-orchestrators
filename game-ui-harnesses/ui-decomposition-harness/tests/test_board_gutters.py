import copy,unittest
from PIL import Image,ImageDraw
from ai_ui_decomposition.common import ContractError,write_json,read_json
from ai_ui_decomposition.component_boards import plan_boards,crop_board
from ai_ui_decomposition.board_gutters import adjusted_windows,make_recipe,extract


def fixture():
    d={'kind':'ai_ui_material_observations_v2','strategy':'component-family-board-v1','packing_canvas':[200,120],
       'extraction_policy':{'version':'1.0','mode':'relative-cell','target_padding':2,'max_canvas_aspect_error':.15},
       'assets':[{'id':k,'component_type':'Tabs','component_group':'tabs','target_size':[80,40],
                  'source_reusable':False,'source_evidence':''} for k in ['off','on']]}
    s=plan_boards(d);im=Image.new('RGB',(200,120),'#F808F8');draw=ImageDraw.Draw(im)
    # Match the declared 76x36 visible target after matte edge removal.
    draw.rectangle((35,40,100,72),fill='#123456');draw.rectangle((125,40,190,72),fill='#ABCDEF')
    return s,im


class GutterTests(unittest.TestCase):
    def test_bounded_gaps_preserve_old_failure_and_alpha(self):
        s,im=fixture();b=s['boards'][0];before=copy.deepcopy(b)
        with self.assertRaisesRegex(ContractError,'EDGE_CLIPPED'):crop_board(im,b,'keyed_component')
        adjusted,changes=adjusted_windows(im,b,32);parts,_=crop_board(im,adjusted,'keyed_component')
        self.assertEqual(b,before);self.assertEqual(changes[0]['shift'],17)
        self.assertEqual(list(parts),['off','on']);self.assertTrue(all(p.getchannel('A').getextrema()==(0,255) for p in parts.values()))

    def test_shift_count_and_key_ambiguities_fail(self):
        s,im=fixture();b=s['boards'][0]
        with self.assertRaisesRegex(ContractError,'SHIFT_EXCEEDED'):adjusted_windows(im,b,8)
        extra=im.copy();extra.putpixel((10,20),(0,0,0))
        with self.assertRaisesRegex(ContractError,'PART_COUNT'):adjusted_windows(extra,b,32)
        dirty=im.copy();dirty.putpixel((112,2),(190,8,248))
        with self.assertRaisesRegex(ContractError,'NOT_PURE_KEY'):adjusted_windows(dirty,b,32)
        for shift in [True,0,33]:
            with self.assertRaisesRegex(ContractError,'SHIFT_POLICY'):adjusted_windows(im,b,shift)

    def test_recipe_is_bound_to_unchanged_receipt_and_not_automatic(self):
        import test_harness
        from ai_ui_decomposition import batch
        f=test_harness.HarnessTests();f.setUp();self.addCleanup(f.tearDown)
        s,im=fixture();p=copy.deepcopy(f.plan);p['assets'][1].update(output_mode='keyed_component',
            prompt=f"component-family-board-v1:{s['digest']}:tabs component-family-relative-cell-v1")
        pp=f.root/'plan-gutter.json';sp=f.root/'strategy.json';write_json(pp,p);write_json(sp,s)
        batch.freeze(pp,f.workspace,'gutters');run=f.workspace/'runs/gutters';raw=f.root/'raw.png';im.save(raw)
        batch.reserve(run,'button');batch.receive(run,'button',raw)
        recipe=make_recipe(run,'button',sp,'tabs',32);rp=f.root/'recipe.json';write_json(rp,recipe)
        report=extract(run,sp,rp,f.root/'parts');self.assertEqual(report['generation_calls'],0)
        self.assertIn('EDGE_CLIPPED',report['original_extraction_error']);self.assertFalse(report['human_visual_acceptance'])
        recipe['adjusted_board']['slots'][0]['search_window'][2]+=1;write_json(f.root/'tamper.json',recipe)
        with self.assertRaisesRegex(ContractError,'RECIPE_CHANGED'):extract(run,sp,f.root/'tamper.json',f.root/'bad')
