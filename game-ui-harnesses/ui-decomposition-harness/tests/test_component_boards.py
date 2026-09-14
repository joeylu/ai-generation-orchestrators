import copy
import unittest
from PIL import Image
from ai_ui_decomposition.component_boards import plan_boards,verify_strategy,crop_board,extract
from ai_ui_decomposition.material_strategy import plan_material_strategy
from ai_ui_decomposition.common import ContractError,write_json,read_json


def observations():
    return {'kind':'ai_ui_material_observations_v2','strategy':'component-family-board-v1','assets':[
        {'id':key,'component_type':'Switch','component_group':'switch-blue','target_size':size,
         'source_reusable':False,'source_evidence':''}
        for key,size in [('track-off',[40,20]),('track-on',[40,20]),('thumb',[12,12])]]}


def paint(board,keyed=False):
    im=Image.new('RGBA',board['canvas'],(248,8,248,255) if keyed else (0,0,0,0))
    for i,s in enumerate(board['slots']):
        x,y,w,h=s['crop'];im.paste((30+70*i,70,90,255),(x+3,y+3,x+w-3,y+h-3))
    return im


class BoardTests(unittest.TestCase):
    def test_component_parts_share_board_and_other_groups_stay_separate(self):
        d=observations();d['assets'].append({**d['assets'][0],'id':'button','component_type':'Button','component_group':'button-blue'})
        r=plan_material_strategy(d);self.assertEqual(r['generation_request_count'],2)
        self.assertEqual(len(r['boards'][0]['slots']),3);verify_strategy(r)
        self.assertFalse(r['human_visual_acceptance']);self.assertEqual(r['generation_calls'],0)

    def test_reuse_requires_evidence_and_does_not_generate(self):
        d=observations();d['assets'][0]['source_reusable']=True
        with self.assertRaisesRegex(ContractError,'REUSE_EVIDENCE'):plan_boards(d)
        d['assets'][0]['source_evidence']='Observed clean track in original reference; source binding required at import.'
        r=plan_boards(d);self.assertEqual(len(r['source_reuse']),1);self.assertEqual(len(r['boards'][0]['slots']),2)

    def test_invalid_groups_size_and_duplicates(self):
        for change,code in [(lambda d:d['assets'][1].update(component_type='Button'),'MIXED_COMPONENT'),
            (lambda d:d['assets'][1].update(id='track-off'),'DUPLICATE'),
            (lambda d:d['assets'][1].update(target_size=[True,20]),'TARGET_SIZE'),
            (lambda d:d['assets'][1].update(target_size=[4096,4096]),'CANVAS_LIMIT'),
            (lambda d:d.update(strategy='guess'),'OBSERVATIONS_KIND')]:
            d=observations();change(d)
            with self.subTest(code=code),self.assertRaisesRegex(ContractError,code):plan_boards(d)

    def test_changed_recipe_cannot_be_resigned_as_valid(self):
        from ai_ui_decomposition.common import digest
        r=plan_boards(observations());r['boards'][0]['slots'][0]['crop'][0]=9
        r['digest']=digest({k:v for k,v in r.items() if k!='digest'})
        with self.assertRaisesRegex(ContractError,'STRATEGY_CHANGED'):verify_strategy(r)

    def test_native_crop_keeps_alpha_holes_and_exact_registration(self):
        b=plan_boards(observations())['boards'][0];im=paint(b);x,y,w,h=b['slots'][0]['crop']
        im.putpixel((x+6,y+6),(255,255,255,0));im.putpixel((x+7,y+6),(30,70,90,128))
        parts,rows=crop_board(im,b,'transparent_component');p=parts['track-off']
        self.assertEqual(p.size,(40,20));self.assertEqual(p.getpixel((6,6)),(0,0,0,0));self.assertEqual(p.getpixel((7,6))[3],128)
        self.assertEqual(rows[0]['crop'],[x,y,w,h])

    def test_keyed_crop_is_explicit_and_empty_or_straddled_cells_fail(self):
        b=plan_boards(observations())['boards'][0]
        parts,_=crop_board(paint(b,True),b,'keyed_component')
        self.assertTrue(all(p.getchannel('A').getextrema()==(0,255) for p in parts.values()))
        for change,code in [(lambda im:im.putpixel((0,0),(255,255,255,255)),'UNASSIGNED'),
            (lambda im:im.putpixel((8,8),(255,255,255,255)),'EDGE_CLIPPED'),
            (lambda im:im.paste((0,0,0,0),(8,8,48,28)),'EMPTY_PART')]:
            im=paint(b);change(im)
            with self.subTest(code=code),self.assertRaisesRegex(ContractError,code):crop_board(im,b,'transparent_component')

    def test_wrong_canvas_and_opaque_native_fail(self):
        b=plan_boards(observations())['boards'][0]
        with self.assertRaisesRegex(ContractError,'CANVAS_MISMATCH'):crop_board(Image.new('RGBA',(5,5)),b,'transparent_component')
        with self.assertRaisesRegex(ContractError,'NATIVE_ALPHA'):crop_board(paint(b).convert('RGB'),b,'transparent_component')

    def test_thin_part_cannot_hide_short_support_inside_correct_canvas(self):
        d=observations();d['assets']=d['assets'][:1];d['assets'][0]['target_size']=[12,200]
        b=plan_boards(d)['boards'][0];im=Image.new('RGBA',b['canvas']);im.paste('white',(11,90,17,110))
        with self.assertRaisesRegex(ContractError,'LONG_CONTROL_SUPPORT'):crop_board(im,b,'transparent_component')

    def test_receipt_bound_extraction_preserves_history_and_rejects_tamper(self):
        import test_harness
        from ai_ui_decomposition import batch
        f=test_harness.HarnessTests();f.setUp();self.addCleanup(f.tearDown)
        s=plan_boards(observations());b=s['boards'][0];p=copy.deepcopy(f.plan)
        p['assets'][1].update(output_mode='transparent_component',
            prompt=f"Separate Switch tracks and thumb. component-family-board-v1:{s['digest']}:{b['id']}")
        plan=f.root/'board-plan.json';strategy=f.root/'strategy.json';write_json(plan,p);write_json(strategy,s)
        batch.freeze(plan,f.workspace,'boards');run=f.workspace/'runs/boards'
        raw=f.root/'board.png';paint(b).save(raw);before=raw.read_bytes()
        batch.reserve(run,'button');batch.receive(run,'button',raw)
        out=f.root/'parts';r=extract(run,'button',strategy,b['id'],out)
        self.assertEqual(len(r['parts']),3);self.assertEqual(raw.read_bytes(),before)
        self.assertFalse(r['human_visual_acceptance']);self.assertEqual(r['generation_calls'],0)
        with self.assertRaisesRegex(ContractError,'OUTPUT_EXISTS'):extract(run,'button',strategy,b['id'],out)
        bad=copy.deepcopy(s['observations']);bad['assets'][0]['target_size']=[41,20]
        changed=f.root/'changed.json';write_json(changed,plan_boards(bad))
        with self.assertRaisesRegex(ContractError,'PLAN_BINDING'):extract(run,'button',changed,b['id'],f.root/'bad')
        frozen=read_json(run/'batch.json') if (run/'batch.json').exists() else batch.load(run)[0]
        (run/'requests'/frozen['requests']['button']['id']/'raw.png').write_bytes(before+b'tamper')
        with self.assertRaises(ContractError):extract(run,'button',strategy,b['id'],f.root/'tampered')
