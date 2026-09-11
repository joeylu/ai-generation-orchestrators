"""Real local archives, public importer, and opt-in real PixiJS browser regression."""
import copy
import hashlib
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

from PIL import Image, ImageDraw
from PIL.PngImagePlugin import PngInfo
from ai_ui_decomposition.common import ContractError
from ai_ui_decomposition.stateful import accept, archive_inputs, compile_matrix, baked_icon


class StatefulTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.component = Path(os.environ.get('STATEFUL_COMPONENT_ROOT',Path(__file__).resolve().parents[2] / 'ui-component-harness')).resolve()
        if not shutil.which('node') or not (cls.component/'node_modules').exists():
            raise unittest.SkipTest('Local component checkout and npm ci required; no network setup in tests')
        cls.temp = tempfile.TemporaryDirectory()
        cls.root = Path(cls.temp.name)/'fixtures'
        subprocess.run(['node',str(Path(__file__).with_name('stateful-fixtures.mjs')),str(cls.component),str(cls.root)],check=True,capture_output=True)
        cls.loaded = {}
        for kind in ['Button','Switch','Select','CheckBox','RadioGroup','List','Tabs']:
            d=cls.root/kind
            accept(d/'ui.component-handoff.draft.zip',d/'evidence.json',cls.component,d/'qa',False)
            binding,assets=archive_inputs(d/'ui.component-handoff.draft.zip')
            cls.loaded[kind]=(json.loads((d/'qa/consumed.json').read_text()),binding,json.loads((d/'evidence.json').read_text()),assets)

    @classmethod
    def tearDownClass(cls):
        if hasattr(cls,'temp'):cls.temp.cleanup()

    def fixture(self,kind='Tabs'):
        return copy.deepcopy(self.loaded[kind])

    def test_seven_public_component_state_matrices(self):
        for kind,parts in self.loaded.items():
            with self.subTest(kind=kind):
                matrix=compile_matrix(*parts)
                self.assertEqual(matrix['components'][0]['componentType'],kind)
                self.assertGreaterEqual(len(matrix['components'][0]['states']),2)
                self.assertIs(matrix['human_visual_acceptance'],False)

    def test_r006_identical_distinct_is_rejected_after_official_import(self):
        d=self.root/'Tabs-identical'
        with self.assertRaisesRegex(ContractError,'STATE_DISTINCT_DUPLICATE'):
            accept(d/'ui.component-handoff.draft.zip',d/'evidence.json',self.component,d/'rejected',False)
        self.assertTrue((d/'rejected/consumed.json').exists())
        self.assertEqual(json.loads((d/'rejected/acceptance.json').read_text())['status'],'failed')
        self.assertFalse((d/'rejected/ui.component-handoff.draft.zip').exists())

    def test_r007_distinct_geometry_and_explicit_per_tab_roles(self):
        matrix=compile_matrix(*self.fixture())
        states=matrix['components'][0]['states']
        self.assertEqual([s['name'] for s in states],['tab-a','tab-b','tab-c'])
        for tab in ['tab-a','tab-b','tab-c']:
            icons=[p for s in states for p in s['parts'] if p['slot']=='icon/'+tab]
            self.assertEqual({p['role'] for p in icons},{'icon','active-icon'})
            self.assertEqual(len({p['sha256'] for p in icons}),2)
            self.assertEqual(len({tuple(p['rect']) for p in icons}),1)

    def test_missing_state_relation_evidence_role_and_alpha(self):
        for mutation,code in [('state','STATE_MISSING'),('relation','STATE_RELATION_MISSING'),('proof','STATE_REFERENCE_EVIDENCE_MISSING'),('role','STATE_ROLE_UNSUPPORTED'),('alpha','STATE_ALPHA_INVALID')]:
            with self.subTest(mutation=mutation):
                bundle,binding,evidence,assets=self.fixture()
                policy=evidence['components']['apply-tabs']
                if mutation=='state':del policy['states']['tab-a']
                if mutation=='relation':del policy['relations']['icon/tab-a']
                if mutation=='proof':policy['states']['tab-a']['note']=''
                if mutation=='role':binding['bindings'][0]['parts'][0]['role']='invented-pressed-icon'
                if mutation=='alpha':
                    layer='tab-a-icon';im=Image.open(io.BytesIO(assets[layer]));im.putalpha(255);stream=io.BytesIO();im.save(stream,format='PNG');old=hashlib.sha256(assets[layer]).hexdigest();assets[layer]=stream.getvalue()
                    for r in bundle['resources']:
                        if r['sha256']==old:r['sha256']=hashlib.sha256(assets[layer]).hexdigest()
                    for key,payload in list(assets.items()):
                        if hashlib.sha256(payload).hexdigest()==old:assets[key]=assets[layer]
                with self.assertRaisesRegex(ContractError,code):compile_matrix(bundle,binding,evidence,assets)

    def test_alpha_contour_and_local_layout_mismatch(self):
        bundle,binding,evidence,assets=self.fixture()
        bundle['document']['root']['children'][0]['props']['appearance']['icons'][0]['activeIcon']['layout']['x']+=1
        with self.assertRaisesRegex(ContractError,'STATE_GEOMETRY_MISMATCH'):compile_matrix(bundle,binding,evidence,assets)

    def test_changed_alpha_contour_is_rejected(self):
        data=self.fixture();bundle,binding,evidence,assets=data
        old=hashlib.sha256(assets['tab-a-active-icon']).hexdigest()
        im=Image.open(io.BytesIO(assets['tab-a-active-icon'])).convert('RGBA');im.putpixel((9,9),(0,0,0,0))
        stream=io.BytesIO();im.save(stream,format='PNG');payload=stream.getvalue()
        for key,value in list(assets.items()):
            if hashlib.sha256(value).hexdigest()==old:assets[key]=payload
        for r in bundle['resources']:
            if r['sha256']==old:r['sha256']=hashlib.sha256(payload).hexdigest()
        with self.assertRaisesRegex(ContractError,'STATE_GEOMETRY_MISMATCH'):compile_matrix(*data)

    def test_png_metadata_cannot_fake_distinct_visuals(self):
        data=self.fixture();bundle,binding,evidence,assets=data
        old=hashlib.sha256(assets['tab-a-active-icon']).hexdigest()
        im=Image.open(io.BytesIO(assets['tab-a-icon'])).convert('RGBA')
        metadata=PngInfo();metadata.add_text('fixture','different file, identical visible pixels')
        stream=io.BytesIO();im.save(stream,format='PNG',pnginfo=metadata);payload=stream.getvalue()
        self.assertNotEqual(hashlib.sha256(payload).hexdigest(),hashlib.sha256(assets['tab-a-icon']).hexdigest())
        for key,value in list(assets.items()):
            if hashlib.sha256(value).hexdigest()==old:assets[key]=payload
        for r in bundle['resources']:
            if r['sha256']==old:r['sha256']=hashlib.sha256(payload).hexdigest()
        with self.assertRaisesRegex(ContractError,'STATE_DISTINCT_DUPLICATE'):compile_matrix(*data)

    def test_explicit_shared_visual_is_permitted_but_not_silent(self):
        bundle,binding,evidence,assets=self.fixture()
        node=bundle['document']['root']['children'][0]
        for icon in node['props']['appearance']['icons']:
            active=icon['activeIcon']['image'];normal=icon['icon']['image']
            r=next(r for r in bundle['resources'] if r['path']==normal)
            next(r for r in bundle['resources'] if r['path']==active)['sha256']=r['sha256']
            assets[f"{icon['tabId']}-active-icon"]=assets[f"{icon['tabId']}-icon"]
            evidence['components']['apply-tabs']['relations']['icon/'+icon['tabId']]={'mode':'shared','note':'Explicit fixture evidence: both states intentionally share the same icon pixels.'}
        compile_matrix(bundle,binding,evidence,assets)
        evidence['components']['apply-tabs']['relations']['icon/tab-a']['note']=''
        with self.assertRaisesRegex(ContractError,'STATE_REFERENCE_EVIDENCE_MISSING'):compile_matrix(bundle,binding,evidence,assets)

    def test_baked_icon_template_detection(self):
        bg=Image.new('RGBA',(70,40),(30,60,40,255));icon=Image.new('RGBA',(12,12));ImageDraw.Draw(icon).ellipse((2,2,9,9),fill=(250,240,220,255))
        self.assertFalse(baked_icon(bg,icon))
        bg.alpha_composite(icon,(23,9))
        self.assertTrue(baked_icon(bg,icon))

    def test_baked_icon_rejected_by_full_matrix(self):
        bundle,binding,evidence,assets=self.fixture()
        key='tab-inactive';im=Image.open(io.BytesIO(assets[key])).convert('RGBA')
        im.alpha_composite(Image.open(io.BytesIO(assets['tab-a-icon'])).convert('RGBA'),(60,10))
        old=hashlib.sha256(assets[key]).hexdigest();stream=io.BytesIO();im.save(stream,format='PNG');assets[key]=stream.getvalue()
        for r in bundle['resources']:
            if r['sha256']==old:r['sha256']=hashlib.sha256(assets[key]).hexdigest()
        with self.assertRaisesRegex(ContractError,'STATE_BACKGROUND_BAKED_CONFLICT'):compile_matrix(bundle,binding,evidence,assets)

    def test_extra_requested_state_fails_capability_instead_of_downgrading(self):
        data=self.fixture('Button');policy=data[2]['components']['apply-button']
        policy['states']['error']=copy.deepcopy(policy['states']['default'])
        with self.assertRaisesRegex(ContractError,'STATE_CAPABILITY_MISSING'):compile_matrix(*data)

    def test_output_is_immutable(self):
        d=self.root/'Tabs'
        before=(d/'qa/acceptance.json').read_bytes()
        with self.assertRaisesRegex(ContractError,'OUTPUT_EXISTS'):
            accept(d/'ui.component-handoff.draft.zip',d/'evidence.json',self.component,d/'qa',False)
        self.assertEqual(before,(d/'qa/acceptance.json').read_bytes())

    def test_unsupported_component_does_not_silently_pass(self):
        for kind in ['Input','Dialog','Slider','ScrollView']:
            data=self.fixture();data[0]['document']['root']['children'][0]['type']=kind
            with self.assertRaisesRegex(ContractError,'STATE_CAPABILITY_MISSING'):compile_matrix(*data)

    @unittest.skipUnless(os.environ.get('STATEFUL_BROWSER_TESTS')=='1','Set STATEFUL_BROWSER_TESTS=1 after npm run build for real PixiJS acceptance')
    def test_real_browser_all_supported_components(self):
        for kind in self.loaded:
            with self.subTest(kind=kind):
                d=self.root/kind;report=accept(d/'ui.component-handoff.draft.zip',d/'evidence.json',self.component,d/'browser',True)
                self.assertEqual(report['status'],'technical_passed')
                self.assertFalse(report['human_visual_acceptance'])
                self.assertEqual((d/'ui.component-handoff.draft.zip').read_bytes(),(d/'browser/ui.component-handoff.draft.zip').read_bytes())


if __name__=='__main__':unittest.main()
