import copy,unittest
import numpy as np
from PIL import Image,ImageDraw
from ai_ui_decomposition.component_boards import plan_boards,crop_board,verify_strategy,extract
from ai_ui_decomposition.common import ContractError,write_json
from ai_ui_decomposition.media import matte_key


def description():
    return {'kind':'ai_ui_material_observations_v2','strategy':'component-family-board-v1','packing_canvas':[160,160],
            'extraction_policy':{'version':'1.0','mode':'relative-cell','target_padding':2,'max_canvas_aspect_error':.15},
            'assets':[{'id':k,'component_type':'Switch','component_group':'switch-board','target_size':s,'source_reusable':False,'source_evidence':''}
                      for k,s in [('off',[80,40]),('on',[80,40]),('thumb',[20,20])]]}


def image(board,size=(172,152)):
    im=Image.new('RGB',size,'#F808F8');draw=ImageDraw.Draw(im)
    for i,slot in enumerate(board['slots']):
        l,t,r,b=slot['search_window'];l=round(l*size[0]/160);r=round(r*size[0]/160);t=round(t*size[1]/160);b=round(b*size[1]/160)
        w,h=slot['target_size'];scale=min((r-l-12)/w,(b-t-12)/h);w=round(w*scale);h=round(h*scale)
        x=(l+r-w)//2;y=(t+b-h)//2
        draw.rectangle((x,y,x+w-1,y+h-1),fill=(30+i*60,90,80))
        if i==0:draw.rectangle((x+w//2-2,y+h//2-2,x+w//2+2,y+h//2+2),fill='#F808F8')
    return im


class RelativeBoardTests(unittest.TestCase):
    def test_receipt_bound_relative_extraction_and_key_rejection(self):
        import test_harness
        from ai_ui_decomposition import batch
        f=test_harness.HarnessTests();f.setUp();self.addCleanup(f.tearDown)
        s=plan_boards(description());b=s['boards'][0];p=copy.deepcopy(f.plan)
        p['assets'][1].update(output_mode='keyed_component',prompt=
            f"component-family-board-v1:{s['digest']}:{b['id']} component-family-relative-cell-v1")
        plan=f.root/'relative-plan.json';strategy=f.root/'strategy.json';write_json(plan,p);write_json(strategy,s)
        batch.freeze(plan,f.workspace,'relative');run=f.workspace/'runs/relative'
        raw=f.root/'relative.png';image(b).save(raw);before=raw.read_bytes()
        batch.reserve(run,'button');batch.receive(run,'button',raw)
        report=extract(run,'button',strategy,b['id'],f.root/'parts')
        self.assertEqual(report['source_size'],[172,152]);self.assertEqual(len(report['parts']),3)
        self.assertFalse(report['human_visual_acceptance']);self.assertEqual(raw.read_bytes(),before)
        changed=description();changed['extraction_policy']['target_padding']=3
        write_json(f.root/'changed.json',plan_boards(changed))
        with self.assertRaisesRegex(ContractError,'PLAN_BINDING'):
            extract(run,'button',f.root/'changed.json',b['id'],f.root/'bad')
        batch.freeze(plan,f.workspace,'wrong-key');bad=f.workspace/'runs/wrong-key'
        Image.new('RGB',(160,160),'white').save(raw);batch.reserve(bad,'button')
        with self.assertRaisesRegex(ContractError,'KEY_BACKGROUND_REQUIRED'):batch.receive(bad,'button',raw)
        frozen,_=batch.load(bad);self.assertEqual(batch.state(bad,frozen['requests']['button']),'rejected')

    def test_canvas_drift_and_off_center_parts_fit_without_stretching(self):
        strategy=plan_boards(description());verify_strategy(strategy);board=strategy['boards'][0]
        parts,rows=crop_board(image(board),board,'keyed_component')
        self.assertEqual([p.size for p in parts.values()],[(80,40),(80,40),(20,20)])
        for p,row in zip(parts.values(),rows):
            self.assertEqual(p.getchannel('A').getextrema(),(0,255))
            a=np.asarray(p);self.assertTrue((a[a[:,:,3]==0,:3]==0).all())
            l,t,r,b=row['matte_bbox_in_window'];w,h=row['resampled_size']
            self.assertLessEqual(abs(w-(r-l)*row['uniform_scale']),.51)
            self.assertLessEqual(abs(h-(b-t)*row['uniform_scale']),.51)
        self.assertEqual(parts['off'].getpixel((40,20))[3],0)

    def test_checkerboard_missing_key_clipped_and_empty_fail(self):
        board=plan_boards(description())['boards'][0]
        checker=Image.new('RGB',(172,152),'#B0B0B0');draw=ImageDraw.Draw(checker)
        for y in range(0,152,8):
            for x in range(0,172,8):
                if (x//8+y//8)%2:draw.rectangle((x,y,x+7,y+7),fill='#EEEEEE')
        for operation in [lambda:crop_board(checker,board,'keyed_component'),lambda:matte_key(checker,[80,40])]:
            with self.assertRaisesRegex(ContractError,'KEY_BACKGROUND_REQUIRED'):operation()
        with self.assertRaisesRegex(ContractError,'EMPTY_PART'):crop_board(Image.new('RGB',(172,152),'#F808F8'),board,'keyed_component')
        bad=image(board);l,t,r,b=board['slots'][0]['search_window'];bad.putpixel((round((l+r)/2*172/160),round(b*152/160)-1),(255,255,255))
        with self.assertRaisesRegex(ContractError,'EDGE_CLIPPED'):crop_board(bad,board,'keyed_component')

    def test_policy_and_legacy_are_not_silently_upgraded(self):
        d=description();board=plan_boards(d)['boards'][0]
        with self.assertRaisesRegex(ContractError,'KEY_REQUIRED'):crop_board(image(board),board,'transparent_component')
        with self.assertRaisesRegex(ContractError,'CANVAS_ASPECT'):crop_board(image(board,(320,100)),board,'keyed_component')
        del d['extraction_policy'];old=plan_boards(d)['boards'][0]
        with self.assertRaisesRegex(ContractError,'CANVAS_MISMATCH'):crop_board(image(board),old,'keyed_component')
        for change in [lambda p:p.update(version='2'),lambda p:p.update(target_padding=50),lambda p:p.update(max_canvas_aspect_error=.5)]:
            d=description();change(d['extraction_policy'])
            with self.assertRaisesRegex(ContractError,'RELATIVE_POLICY'):plan_boards(d)
        for asset in d['assets']:asset.update(source_reusable=True,source_evidence='Explicit local fixture reuse.')
        with self.assertRaisesRegex(ContractError,'RELATIVE_POLICY'):plan_boards(d)
