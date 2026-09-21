import copy,unittest
from pathlib import Path
from PIL import Image,ImageDraw
from ai_ui_decomposition import batch
from ai_ui_decomposition.common import ContractError,write_json
from ai_ui_decomposition.board_observations import analyze,extract
from ai_ui_decomposition.component_boards import plan_boards
from test_board_gutters import fixture


class ObservedBoardTests(unittest.TestCase):
    def setUp(self):
        import test_harness
        self.f=test_harness.HarnessTests();self.f.setUp();self.addCleanup(self.f.tearDown)
        s,im=fixture();p=copy.deepcopy(self.f.plan);p['assets'][1].update(output_mode='keyed_component',
            prompt=f"component-family-board-v1:{s['digest']}:tabs component-family-relative-cell-v1")
        pp=self.f.root/'observed-plan.json';self.sp=self.f.root/'strategy.json';write_json(pp,p);write_json(self.sp,s)
        batch.freeze(pp,self.f.workspace,'observed');self.run=self.f.workspace/'runs/observed'
        raw=self.f.root/'raw.png';im.save(raw);batch.reserve(self.run,'button');batch.receive(self.run,'button',raw)
        a,_,_=analyze(self.run,'button',self.sp,'tabs')
        self.obs={'kind':'ai_ui_board_part_observations_v1','version':'1.0','asset':'button','board':'tabs','candidate_digest':a['digest'],
                  'parts':[{'asset_id':k,'candidate_indices':[i],'evidence':'Explicit local fixture identity.'} for i,k in enumerate(['off','on'])]}

    def test_explicit_mapping_keeps_original_failure_and_all_parts(self):
        op=self.f.root/'obs.json';write_json(op,self.obs)
        r=extract(self.run,self.sp,op,self.f.root/'parts')
        self.assertEqual(len(r['parts']),2);self.assertIn('EDGE_CLIPPED',r['original_extraction_error'])
        self.assertFalse(r['human_visual_acceptance']);self.assertEqual(r['generation_calls'],0)

    def test_invalid_observations_fail_without_output(self):
        for i,(mutate,code) in enumerate([
            (lambda o:o.update(candidate_digest='0'*64),'SOURCE_CHANGED'),
            (lambda o:o['parts'][0].update(evidence=''),'SEMANTIC_EVIDENCE'),
            (lambda o:o['parts'][0].update(asset_id='invented'),'PART_ID'),
            (lambda o:o['parts'][0].update(candidate_indices=[99]),'CANDIDATE_REF'),
            (lambda o:o['parts'][0].update(candidate_indices=[0,0]),'CANDIDATE_COVERAGE'),
            (lambda o:o['parts'].pop(),'PART_COVERAGE')]):
            o=copy.deepcopy(self.obs);mutate(o);op=self.f.root/f'bad-{i}.json';write_json(op,o)
            out=self.f.root/f'bad-output-{i}'
            with self.subTest(code=code),self.assertRaisesRegex(ContractError,code):extract(self.run,self.sp,op,out)
            self.assertFalse(out.exists())


class ObservedBoardResizeTests(unittest.TestCase):
    def _fixture(self, resize=True):
        import test_harness
        f=test_harness.HarnessTests();f.setUp();self.addCleanup(f.tearDown)
        description={'kind':'ai_ui_material_observations_v2','strategy':'component-family-board-v1',
                     'packing_canvas':[200,100],
                     'assets':[{'id':'viewport','component_type':'ScrollView','component_group':'scroll',
                                'target_size':[40,40],'source_reusable':False,'source_evidence':''},
                               {'id':'rail','component_type':'ScrollView','component_group':'scroll',
                                'target_size':[12,80],'source_reusable':False,'source_evidence':''}]}
        strategy=plan_boards(description);sp=f.root/'strategy.json';write_json(sp,strategy)
        plan=copy.deepcopy(f.plan);plan['assets'][1].update(output_mode='keyed_component',
            prompt=f"component-family-board-v1:{strategy['digest']}:scroll")
        pp=f.root/'resize-plan.json';write_json(pp,plan)
        batch.freeze(pp,f.workspace,'resize-observed');run=f.workspace/'runs/resize-observed'
        f.run=run
        board=strategy['boards'][0];raw=Image.new('RGB',tuple(board['canvas']),'#F808F8');draw=ImageDraw.Draw(raw)
        # The viewport intentionally reaches its old cell edge, preserving the
        # original grid failure while the explicit recipe handles its fitting.
        draw.rounded_rectangle((8,8,48,48),radius=5,outline='#E0B85A',width=4)
        # A long rail with endpoint diamonds and a dark channel whose aspect
        # differs from the native target enough to fail legacy fitting.
        draw.rectangle((64,12,75,88),fill='#3C321F',outline='#D0A13D',width=2)
        draw.polygon([(69,8),(75,14),(69,20),(64,14)],fill='#D0A13D')
        draw.polygon([(69,80),(75,86),(69,92),(64,86)],fill='#D0A13D')
        raw_path=f.root/'raw.png';raw.save(raw_path)
        batch.reserve(run,'button');batch.receive(run,'button',raw_path)
        a,_,_=analyze(run,'button',sp,'scroll')
        parts=[{'asset_id':'viewport','candidate_indices':[0],'evidence':'Observed empty inset rim in the returned board.'},
               {'asset_id':'rail','candidate_indices':[1],'evidence':'Observed long dark rail with distinct endpoint diamonds.'}]
        if resize:
            parts[0]['resize']={'mode':'nine_slice','insets':[6,6,6,6],'fitSize':[24,24]}
            parts[1]['resize']={'mode':'nine_slice','insets':[3,3,3,3]}
        obs={'kind':'ai_ui_board_part_observations_v1','version':'1.0','asset':'button','board':'scroll',
             'candidate_digest':a['digest'],'parts':parts}
        op=f.root/'observations.json';write_json(op,obs)
        return f,sp,op,obs

    def test_explicit_nine_slice_fits_mismatched_long_rail_and_preserves_evidence(self):
        f,sp,op,_=self._fixture()
        report=extract(f.run,sp,op,f.root/'parts')
        self.assertEqual(report['original_extraction_error'],'BOARD_CELL_EDGE_CLIPPED:viewport')
        self.assertEqual(report['generation_calls'],0)
        rows={row['asset_id']:row for row in report['parts']}
        self.assertEqual(rows['viewport']['resize']['fitSize'],[24,24])
        self.assertEqual(rows['rail']['resize']['fitSize'],[12,80])
        for row in rows.values():
            self.assertEqual(row['original_extraction_error'],report['original_extraction_error'])
            self.assertEqual(row['resize_before']['alpha_extrema'],[0,255])
            self.assertEqual(row['resize_after']['size'],row['target_size'])
            self.assertEqual(row['resize_after']['alpha_extrema'],[0,255])
        viewport=Image.open(f.root/'parts/viewport.png').convert('RGBA')
        rail=Image.open(f.root/'parts/rail.png').convert('RGBA')
        self.assertEqual(viewport.size,(40,40));self.assertEqual(rail.size,(12,80))
        # The fitted viewport keeps nonempty corner material through the
        # nine-slice operation rather than stretching the entire rim.
        self.assertGreater(viewport.getpixel((3,3))[3],0)
        self.assertGreater(viewport.getpixel((36,36))[3],0)
        self.assertGreater(rail.getchannel('A').getbbox()[3],60)

    def test_legacy_observed_extraction_without_resize_still_rejects_long_support(self):
        f,sp,op,_=self._fixture(resize=False)
        with self.assertRaisesRegex(ContractError,'VISIBLE_SUPPORT_SIZE_MISMATCH'):
            extract(f.run,sp,op,f.root/'parts')
        self.assertFalse((f.root/'parts').exists())

    def test_resize_recipe_rejects_bad_insets_mode_and_fields(self):
        cases=[({'mode':'nine_slice','insets':[0,3,3,3]},'OBSERVED_BOARD_RESIZE_INSETS'),
               ({'mode':'stretch','insets':[3,3,3,3]},'OBSERVED_BOARD_RESIZE_MODE'),
               ({'mode':'nine_slice','insets':[3,3,3,3],'unknown':1},'OBSERVED_BOARD_RESIZE_FIELDS')]
        for index,(resize,code) in enumerate(cases):
            with self.subTest(code=code):
                f,sp,op,obs=self._fixture()
                obs['parts'][1]['resize']=resize
                bad=f.root/f'bad-{index}.json';write_json(bad,obs)
                with self.assertRaisesRegex(ContractError,code):
                    extract(f.run,sp,bad,f.root/f'parts-bad-{index}')
