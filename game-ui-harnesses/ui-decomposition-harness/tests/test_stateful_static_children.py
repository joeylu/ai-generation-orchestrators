import base64
import copy
import hashlib
import io
import unittest
import json
import os
import shutil
import subprocess
import tempfile
from pathlib import Path
from PIL import Image, ImageDraw
from ai_ui_decomposition.common import ContractError
from ai_ui_decomposition.stateful_static_children import button_image_children, select_image_overlays


class StaticImageMetadataTests(unittest.TestCase):
    def fixture(self):
        image=Image.new('RGBA',(20,18)); ImageDraw.Draw(image).ellipse((2,2,17,15),fill=(220,210,90,255))
        stream=io.BytesIO();image.save(stream,format='PNG');payload=stream.getvalue()
        child={'id':'icon','type':'Image','layout':{'x':7,'y':9,'width':20,'height':18},
               'props':{'source':'icon.png','fit':'contain','drawBackground':False,'style':{'opacity':1}}}
        node={'id':'button','type':'Button','props':{'style':{'opacity':1}},'children':[child]}
        resources={'icon.png':{'base64':base64.b64encode(payload).decode(),'sha256':hashlib.sha256(payload).hexdigest()}}
        return node,resources

    def test_binding_native_geometry_clip_and_no_invented_public_role(self):
        n,r=self.fixture();before=copy.deepcopy((n,r));clip=[15,25,40,40]
        record=button_image_children(n,r,(10,20),clip)[0]
        self.assertEqual(record['rect'],[17,29,20,18]);self.assertEqual(record['clip'],clip)
        self.assertNotIn('role',record);self.assertNotIn('layer',record)
        self.assertEqual(record['sha256'],r['icon.png']['sha256'])
        self.assertTrue(record['staticChild']);self.assertEqual((n,r),before)

    def test_select_later_field_image_sibling_uses_exact_alpha_and_geometry(self):
        n, resources = self.fixture()
        select = {'id':'select','type':'Select','layout':{'x':10,'y':20,'width':80,'height':50},'props':{'style':{'opacity':1}}}
        icon = n['children'][0]
        icon['layout'].update(x=17,y=29)
        root = {'id':'root','children':[select,icon]}
        before=copy.deepcopy(root)
        result=select_image_overlays(root,select,resources,(100,200))[0]
        self.assertEqual(result['rect'],[107,209,20,18])
        self.assertEqual(result['resourceBinding'],'consumed-semantic-select-field-sibling')
        self.assertEqual(root,before)
        root['children']=[icon,select]
        self.assertEqual(select_image_overlays(root,select,resources,(100,200)),[])
        root['children']=[select,icon];icon['layout']['x']=5
        with self.assertRaisesRegex(ContractError,'PARTIAL_SELECT_OVERLAY'):
            select_image_overlays(root,select,resources,(100,200))

    def test_wrong_hash_fails_even_if_base64_is_a_valid_png(self):
        n,r=self.fixture();r['icon.png']['sha256']='0'*64
        with self.assertRaisesRegex(ContractError,'STATE_RESOURCE_MISMATCH'):button_image_children(n,r,(0,0))

    def test_missing_resource_bad_base64_and_non_native_size_fail(self):
        for mutation in ('missing','base64','size'):
            n,r=self.fixture()
            if mutation=='missing':r.clear()
            elif mutation=='base64':r['icon.png']['base64']='!invalid!'
            else:n['children'][0]['layout']['width']=21
            with self.subTest(mutation=mutation), self.assertRaises(ContractError):button_image_children(n,r,(0,0))

    def test_background_region_opacity_and_nested_controls_not_silently_skipped(self):
        for mutation in ('background','region','opacity','container'):
            n,r=self.fixture();child=n['children'][0]
            if mutation=='background':child['props']['drawBackground']=True
            elif mutation=='region':child['props']['region']={'x':0,'y':0,'width':10,'height':10}
            elif mutation=='opacity':child['props']['style']['opacity']=.5
            else:child['type']='Container'
            with self.subTest(mutation=mutation), self.assertRaisesRegex(ContractError,'STATE_STATIC_CHILD_UNSUPPORTED'):button_image_children(n,r,(0,0))


class StaticImageIntegrationTests(unittest.TestCase):
    def test_browser_geometry_helper_rejects_hidden_or_misplaced_child(self):
        if not shutil.which('node'): self.skipTest('Existing Node runtime required')
        module=(Path(__file__).resolve().parents[1]/'src/ai_ui_decomposition/stateful-static-children-browser.mjs').as_uri()
        code=f"""import {{staticChildChecks}} from {json.dumps(module)};
const child={{slot:'child-image/icon',nodeId:'icon',rect:[16,26,20,18],clip:null}};
const parent={{x:10,y:20,width:80,height:30}};
const expected={{x:17.02,y:26.27,width:19.4,height:17.46}};
const check=async (visible,bounds)=>(await staticChildChecks({{evaluate:async()=>[{{id:'icon',visible,bounds}}]}},[child],.97,parent))[0].pass;
console.log(JSON.stringify([await check(true,expected),await check(false,expected),await check(true,{{...expected,x:expected.x+2}})]));"""
        result=subprocess.run(['node','--input-type=module','-e',code],check=True,capture_output=True,text=True)
        self.assertEqual(json.loads(result.stdout),[True,False,False])

    @unittest.skipUnless(os.environ.get('STATEFUL_BROWSER_TESTS')=='1','Opt-in actual local PixiJS browser')
    def test_real_button_child_pixels_and_press_geometry(self):
        from ai_ui_decomposition.stateful import accept
        component=Path(os.environ.get('STATEFUL_COMPONENT_ROOT',Path(__file__).resolve().parents[2]/'ui-component-harness')).resolve()
        if not shutil.which('node') or not (component/'node_modules').exists():self.skipTest('Existing local component dependencies required')
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary)/'fixtures'
            subprocess.run(['node',str(Path(__file__).with_name('stateful-dialog-fixtures.mjs')),str(component),str(root),'--with-images'],check=True,capture_output=True)
            d=root/'Dialog';out=d/'acceptance'
            report=accept(d/'ui.component-handoff.draft.zip',d/'evidence.json',component,out,True)
            self.assertEqual(report['status'],'technical_passed')
            matrix=json.loads((out/'state-matrix.json').read_text());receipt=json.loads((out/'browser.json').read_text())
            buttons=[c for c in matrix['components'] if c['componentType']=='Button']
            self.assertEqual(len(buttons),4)
            for component in buttons:
                for state in component['states']:
                    self.assertEqual(len(state['staticChildren']),1)
                    self.assertNotIn('role',state['staticChildren'][0])
                    row=next(r for r in receipt['results'] if r['componentId']==component['componentId'] and r['state']==state['name'])
                    child=[c for c in row['checks'] if c['slot'].startswith('child-image/')]
                    self.assertEqual(len(child),2)
                    self.assertTrue(all(c['pass'] for c in child))
                    self.assertGreater(child[0]['checkedPixels'],0)
            self.assertFalse(receipt['human_visual_acceptance'])


if __name__=='__main__':unittest.main()
