"""Real local archives, public importer, and opt-in real PixiJS browser regression."""
import base64
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
from unittest.mock import patch
import zipfile

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
        for kind in ['Button','Switch','Select','CheckBox','RadioGroup','List','ScrollView','Tabs']:
            d=cls.root/kind
            accept(d/'ui.component-handoff.draft.zip',d/'evidence.json',cls.component,d/'qa',False)
            binding,assets=archive_inputs(d/'ui.component-handoff.draft.zip')
            cls.loaded[kind]=(json.loads((d/'qa/consumed.json').read_text()),binding,json.loads((d/'evidence.json').read_text()),assets)

    @classmethod
    def tearDownClass(cls):
        if hasattr(cls,'temp'):cls.temp.cleanup()

    def fixture(self,kind='Tabs'):
        return copy.deepcopy(self.loaded[kind])

    def test_scroll_thumb_slices_preserve_source_units_in_matrix(self):
        bundle,binding,evidence,assets=self.fixture('ScrollView')
        node=next(n for n in bundle['document']['root']['children'] if n['type']=='ScrollView')
        a=node['props']['appearance'];state=binding['bindings'][0]['states']['scrollView']
        value={'version':'1.0','coordinateSpace':'thumb-source-pixels','top':2,'bottom':3}
        for target in (a,state):
            target['scrollbarInsets']={'version':'1.0','top':0,'bottom':0}
            target['scrollbarThumbSlices']=copy.deepcopy(value)
        matrix=compile_matrix(bundle,binding,evidence,assets)
        for state in matrix['components'][0]['states']:
            thumb=next(p for p in state['parts'] if p['slot']=='thumb')
            self.assertEqual(thumb['scrollbarThumbSlices'],value)
        a['scrollbarThumbSlices']['top']=1
        with self.assertRaisesRegex(ContractError,'SLICES_MISMATCH'):compile_matrix(bundle,binding,evidence,assets)

    def test_targeted_deterministic_scope_and_timings(self):
        d=self.root/'List'
        component_id=compile_matrix(*self.fixture('List'))['components'][0]['componentId']
        out=d/'targeted-qa'
        report=accept(d/'ui.component-handoff.draft.zip',d/'evidence.json',self.component,out,False,components=[component_id])
        self.assertEqual(report['status'],'deterministic_passed')
        self.assertEqual(report['scope']['mode'],'targeted')
        self.assertEqual(report['scope']['testedComponentIds'],[component_id])
        self.assertEqual([s['name'] for s in report['execution']['stages']],['evidence','official-import','deterministic-matrix'])
        self.assertTrue(all(s['status']=='passed' for s in report['execution']['stages']))
        self.assertFalse((out/'ui.component-handoff.draft.zip').exists())

    def test_unknown_target_fails_before_browser(self):
        d=self.root/'List';out=d/'targeted-unknown'
        with self.assertRaisesRegex(ContractError,'STATE_COMPONENT_SCOPE_UNKNOWN'):
            accept(d/'ui.component-handoff.draft.zip',d/'evidence.json',self.component,out,components=['nonexistent'])
        report=json.loads((out/'acceptance.json').read_text())
        self.assertEqual(report['status'],'failed')
        self.assertEqual(report['execution']['stages'][-1]['name'],'deterministic-matrix')
        self.assertFalse((out/'browser.json').exists())

    def test_timeout_preserves_failure_without_retry_or_zip(self):
        d=self.root/'List';out=d/'timed-out'
        with patch('ai_ui_decomposition.stateful.subprocess.run',side_effect=subprocess.TimeoutExpired('node',1)) as run:
            with self.assertRaisesRegex(ContractError,'STATE_ACCEPTANCE_TIMEOUT'):
                accept(d/'ui.component-handoff.draft.zip',d/'evidence.json',self.component,out,timeout_seconds=1)
        self.assertEqual(run.call_count,1)
        self.assertLessEqual(run.call_args.kwargs['timeout'],1)
        report=json.loads((out/'acceptance.json').read_text())
        self.assertEqual(report['execution']['stages'][-1]['status'],'failed')
        self.assertEqual(report['execution']['stages'][-1]['name'],'official-import')
        self.assertFalse((out/'ui.component-handoff.draft.zip').exists())

    def test_invalid_target_scope_does_not_create_output(self):
        d=self.root/'List';out=d/'invalid-scope'
        for selection in [[],['same','same'],'list',[1]]:
            with self.subTest(selection=selection), self.assertRaisesRegex(ContractError,'STATE_COMPONENT_SCOPE_INVALID'):
                accept(d/'ui.component-handoff.draft.zip',d/'evidence.json',self.component,out,components=selection)
        self.assertFalse(out.exists())

    @unittest.skipUnless(os.environ.get('STATEFUL_BROWSER_TESTS')=='1','Opt-in real PixiJS acceptance')
    def test_targeted_real_browser_never_publishes_zip(self):
        d=self.root/'List';out=d/'targeted-browser'
        component_id=compile_matrix(*self.fixture('List'))['components'][0]['componentId']
        report=accept(d/'ui.component-handoff.draft.zip',d/'evidence.json',self.component,out,components=[component_id])
        self.assertEqual(report['status'],'targeted_passed')
        browser=json.loads((out/'browser.json').read_text())
        self.assertEqual(browser['status'],'targeted_passed')
        self.assertEqual(browser['acceptanceScope']['testedComponentIds'],[component_id])
        self.assertTrue(browser['results'])
        self.assertFalse((out/'ui.component-handoff.draft.zip').exists())

    def test_seven_public_component_state_matrices(self):
        for kind,parts in self.loaded.items():
            with self.subTest(kind=kind):
                matrix=compile_matrix(*parts)
                self.assertEqual(matrix['components'][0]['componentType'],kind)
                self.assertGreaterEqual(len(matrix['components'][0]['states']),2)
                self.assertIs(matrix['human_visual_acceptance'],False)

    def test_list_selected_state_retains_normal_row_under_overlay(self):
        bundle,binding,evidence,assets=self.fixture('List')
        node=next(n for n in bundle['document']['root']['children'] if n['type']=='List')
        selected_source=node['props']['appearance']['selectedRowImage']
        selected_resource=next(r for r in bundle['resources'] if r['path']==selected_source)
        with Image.open(io.BytesIO(base64.b64decode(selected_resource['base64']))) as original:
            overlay_fixture=original.convert('RGBA')
        # Keep the normal row opaque while making the selected overlay's first
        # eight rows transparent, reproducing the source-over edge case.
        for y in range(min(8,overlay_fixture.height)):
            for x in range(overlay_fixture.width):
                red,green,blue,_=overlay_fixture.getpixel((x,y))
                overlay_fixture.putpixel((x,y),(red,green,blue,0))
        encoded=io.BytesIO();overlay_fixture.save(encoded,format='PNG');overlay_payload=encoded.getvalue()
        overlay_layer=next(q['layerId'] for q in binding['bindings'] if q['componentId']==node['id']
                            for q in q['parts'] if q['role']=='selected-row')
        assets[overlay_layer]=overlay_payload
        selected_resource['base64']=base64.b64encode(overlay_payload).decode()
        selected_resource['sha256']=hashlib.sha256(overlay_payload).hexdigest()
        matrix=compile_matrix(bundle,binding,evidence,assets)
        selected=next(s for s in matrix['components'][0]['states'] if s['name']=='first')
        first=[p for p in selected['parts'] if p['slot']=='row/first']
        self.assertEqual([p['role'] for p in first],['row','selected-row'])
        self.assertEqual(first[0]['rect'],first[1]['rect'])
        self.assertNotEqual(first[0]['pixelSha256'],first[1]['pixelSha256'])
        # The selected texture has a transparent top edge; the normal layer
        # must remain present there for source-over compositing.
        normal=Image.open(io.BytesIO(assets[first[0]['layer']])).convert('RGBA')
        overlay=Image.open(io.BytesIO(assets[first[1]['layer']])).convert('RGBA')
        self.assertEqual(overlay.getpixel((normal.width//2,1))[3],0)
        self.assertEqual(normal.getpixel((normal.width//2,1))[3],255)

    def test_button_empty_label_keeps_background_and_image_child_checks(self):
        bundle,binding,evidence,assets=self.fixture('Button')
        node=next(n for n in bundle['document']['root']['children'] if n['type']=='Button')
        source=node['props']['appearance']['backgroundImage']
        # Reuse the authenticated button background as a native-size image child.
        resource=next(r for r in bundle['resources'] if r['path']==source)
        payload=base64.b64decode(resource['base64'])
        with Image.open(io.BytesIO(payload)) as decoded:
            width,height=decoded.size
        node['children']=[{'id':'button-image-child','type':'Image',
                           'layout':{'x':0,'y':0,'width':width,'height':height},
                           'props':{'source':source,'fit':'contain','drawBackground':False,
                                    'style':{'opacity':1}},'children':[]}]
        node['props']['label']=''
        empty=compile_matrix(bundle,binding,evidence,assets)['components'][0]['states'][0]
        self.assertEqual(empty['exclude'],[])
        self.assertEqual([p['slot'] for p in empty['staticChildren']],['child-image/button-image-child'])
        node['props']['label']='Action'
        labeled=compile_matrix(bundle,binding,evidence,assets)['components'][0]['states'][0]
        self.assertEqual(len(labeled['exclude']),1)
        self.assertEqual([p['slot'] for p in labeled['staticChildren']],['child-image/button-image-child'])

    def test_vertical_tabs_export_isolation_and_state_geometry(self):
        from test_select_option_icons import export_fixture
        d=self.root/'Tabs-vertical'
        state=[{'componentId':'vertical-tabs','componentType':'Tabs','fields':{'activeId':{'status':'unknown','reason':'Synthetic regression, not observed artwork.'}}}]
        result=export_fixture(d/'ui.component-handoff.draft.zip', d/'exported', state)
        isolated=d/'isolated'; isolated.mkdir()
        shutil.copyfile(d/'exported'/result['file'],isolated/'only.zip')
        subprocess.run(['node',str(self.component/'scripts/cli.mjs'),'component-handoff','only.zip','--output','bundle.json','--reference-output','reference.json'],cwd=isolated,check=True,capture_output=True)
        bundle=json.loads((isolated/'bundle.json').read_text())
        binding,assets=archive_inputs(isolated/'only.zip')
        evidence=json.loads((d/'evidence.json').read_text())
        matrix=compile_matrix(bundle,binding,evidence,assets)
        node=bundle['document']['root']['children'][0]
        self.assertEqual(node['props']['appearance']['layoutPolicy'],{'version':'1.0','orientation':'vertical'})
        self.assertEqual([s['name'] for s in matrix['components'][0]['states']],['combat','audio','accessibility'])
        self.assertFalse(result['visual_comparison_ready'])
        node['props']['appearance']['layoutPolicy']['orientation']='horizontal'
        with self.assertRaises(ContractError):compile_matrix(bundle,binding,evidence,assets)

    @unittest.skipUnless(os.environ.get('STATEFUL_BROWSER_TESTS')=='1','Opt-in real PixiJS acceptance')
    def test_vertical_tabs_browser(self):
        d=self.root/'Tabs-vertical'
        accept(d/'ui.component-handoff.draft.zip', d/'evidence.json', self.component, d/'vertical-browser', True)
        report=json.loads((d/'vertical-browser/browser.json').read_text())
        self.assertEqual(report['status'],'technical_passed')

    def test_switch_images_authenticated_export_and_state_matrix(self):
        from ai_ui_decomposition.switch_handoff import rebind
        d=self.root/'Switch-images'
        with zipfile.ZipFile(d/'ui.component-handoff.draft.zip') as z:
            binding=json.loads(z.read('appearance-binding.json'))
        path=d/'binding.json';path.write_text(json.dumps(binding),encoding='utf8')
        rebind(d/'ui.component-handoff.draft.zip',path,self.component,d/'rebound')
        report=accept(d/'ui.component-handoff.draft.zip',d/'evidence.json',self.component,d/'images-qa',False)
        matrix=json.loads((d/'images-qa/state-matrix.json').read_text())
        component=matrix['components'][0]
        self.assertEqual(component['stateAppearanceCoverage'],'explicit_state_images')
        for slot in ('track','thumb'):
            self.assertEqual(len({p['pixelSha256'] for state in component['states'] for p in state['parts'] if p['slot']==slot}),2)
        legacy=compile_matrix(*self.fixture('Switch'))
        self.assertEqual(legacy['components'][0]['stateAppearanceCoverage'],'legacy_single_pair_not_full_state_appearance')

    def test_select_icons_producer_export_isolated_official_import(self):
        from test_select_option_icons import export_fixture
        from ai_ui_decomposition.delivery_check import select_default_parts
        d=self.root/'Select-icons'
        result=export_fixture(d/'ui.component-handoff.draft.zip',d/'exported')
        self.assertEqual(result['reference_evidence'],'complete')
        self.assertFalse(result['visual_comparison_ready'])
        isolated=d/'isolated';isolated.mkdir()
        shutil.copyfile(d/'exported'/result['file'],isolated/'only.zip')
        subprocess.run(['node',str(self.component/'scripts/cli.mjs'),'component-handoff','only.zip','--output','bundle.json','--reference-output','reference.json'],cwd=isolated,check=True,capture_output=True)
        bundle=json.loads((isolated/'bundle.json').read_text())
        binding,assets=archive_inputs(isolated/'only.zip')
        defaults=select_default_parts(bundle['document'],binding)
        self.assertFalse(any(p['role']=='option-icon' for p in defaults['selected']))
        self.assertEqual(len([p for p in defaults['standby'] if p['role']=='option-icon']),3)
        evidence=json.loads((d/'evidence.json').read_text())
        matrix=compile_matrix(bundle,binding,evidence,assets)
        states=matrix['components'][0]['states']
        for state in states:
            icons=[p for p in state['parts'] if p['role']=='option-icon']
            self.assertEqual([p['slot'] for p in icons],['option-icon/red','option-icon/green','option-icon/blue'])
            self.assertEqual(icons[1]['canvas'],[20,32])
            self.assertEqual(icons[1]['rect'][2:],[17.5,28])
        with zipfile.ZipFile(isolated/'only.zip') as archive:
            self.assertEqual(archive.read('reference/original.png'),(d/'exported/preview.png').read_bytes())
        broken=copy.deepcopy(bundle)
        broken['document']['root']['children'][0]['props']['appearance']['optionIcons']['items'][0]['icon']['layout']['x']+=1
        with self.assertRaisesRegex(ContractError,'STATE_SELECT_ICONS_MISMATCH'):compile_matrix(broken,binding,evidence,assets)

    @unittest.skipUnless(os.environ.get('STATEFUL_BROWSER_TESTS')=='1','Opt-in real PixiJS acceptance')
    def test_select_icons_mouse_keyboard_pixels_and_close(self):
        d=self.root/'Select-icons'
        accept(d/'ui.component-handoff.draft.zip',d/'evidence.json',self.component,d/'icons-browser',True)
        report=json.loads((d/'icons-browser/browser.json').read_text())
        self.assertEqual(len(report['results']),6)
        self.assertEqual({r['inputProtocol'] for r in report['results']},{'mouse','keyboard'})
        for row in report['results']:
            for slot in ['option-icon/red','option-icon/green','option-icon/blue','select-input-events','select-popup-destroyed']:
                self.assertTrue(next(c for c in row['checks'] if c['slot']==slot)['pass'])

    @unittest.skipUnless(os.environ.get('STATEFUL_BROWSER_TESTS')=='1','Opt-in real PixiJS acceptance')
    def test_switch_images_mouse_keyboard_actual_textures_and_events(self):
        d=self.root/'Switch-images';accept(d/'ui.component-handoff.draft.zip',d/'evidence.json',self.component,d/'images-browser',True)
        report=json.loads((d/'images-browser/browser.json').read_text())
        self.assertEqual(len(report['results']),4)
        self.assertEqual({(r['state'],r['inputProtocol']) for r in report['results']},{(s,i) for s in ('off','on') for i in ('mouse','keyboard')})
        for row in report['results']:
            for slot in ('track','thumb','input-event','runtime-text/'+row['state'].upper()):
                self.assertTrue(next(c for c in row['checks'] if c['slot']==slot)['pass'])

    def test_r006_identical_distinct_is_rejected_after_official_import(self):
        d=self.root/'Tabs-identical'
        with self.assertRaisesRegex(ContractError,'STATE_DISTINCT_DUPLICATE'):
            accept(d/'ui.component-handoff.draft.zip',d/'evidence.json',self.component,d/'rejected',False)
        self.assertTrue((d/'rejected/consumed.json').exists())
        self.assertEqual(json.loads((d/'rejected/acceptance.json').read_text())['status'],'failed')
        self.assertFalse((d/'rejected/ui.component-handoff.draft.zip').exists())

    def test_no_overflow_scroll_explicitly_has_no_chrome(self):
        data=self.fixture('ScrollView')
        node=next(n for n in data[0]['document']['root']['children'] if n['type']=='ScrollView')
        node['props'].update(contentHeight=node['layout']['height'],scrollY=0,drawBackground=False,scrollbarVisibility='auto')
        matrix=compile_matrix(*data)
        for state in matrix['components'][0]['states']:
            self.assertEqual(state['value'],{'x':0,'y':0})
            self.assertFalse(state['scroll']['chromeVisible'])
            self.assertTrue(all(not p['visible'] for p in state['parts']))

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
        for kind in ['Input']:
            data=self.fixture();data[0]['document']['root']['children'][0]['type']=kind;data[0]['document']['root']['children'][0]['props']['inputType']='password'
            with self.assertRaisesRegex(ContractError,'STATE_CAPABILITY_MISSING'):compile_matrix(*data)

    def test_native_tab_geometry_after_official_import(self):
        d=self.root/'Tabs-native'
        accept(d/'ui.component-handoff.draft.zip',d/'evidence.json',self.component,d/'qa',False)
        matrix=json.loads((d/'qa/state-matrix.json').read_text())
        first=matrix['components'][0]['states'][0]
        bases=[p for p in first['parts'] if p['slot'].startswith('background/')]
        self.assertEqual([p['rect'][2] for p in bases],[368,276,275])
        self.assertEqual([p['rect'][0] for p in bases],[20,397,682])
        self.assertEqual([p['canvas'][0] for p in bases],[368,276,275])

    @unittest.skipUnless(os.environ.get('STATEFUL_BROWSER_TESTS')=='1','Opt-in real PixiJS acceptance')
    def test_native_tabs_real_browser(self):
        d=self.root/'Tabs-native'
        report=accept(d/'ui.component-handoff.draft.zip',d/'evidence.json',self.component,d/'browser',True)
        self.assertEqual(report['status'],'technical_passed')

    @unittest.skipUnless(os.environ.get('STATEFUL_BROWSER_TESTS')=='1','Opt-in real PixiJS acceptance')
    def test_select_field_sibling_real_browser(self):
        d=self.root/'Select-overlay'
        report=accept(d/'ui.component-handoff.draft.zip',d/'evidence.json',self.component,d/'browser',True)
        self.assertEqual(report['status'],'technical_passed')
        browser=json.loads((d/'browser/browser.json').read_text())
        self.assertTrue(any(c['slot']=='child-image/select-field-icon' and c['pass'] for r in browser['results'] for c in r['checks']))

    @unittest.skipUnless(os.environ.get('STATEFUL_BROWSER_TESTS')=='1','Opt-in real PixiJS acceptance')
    def test_full_scroll_content_occlusion_is_not_a_pixel_pass(self):
        d=self.root/'ScrollView-covered'
        report=accept(d/'ui.component-handoff.draft.zip',d/'evidence.json',self.component,d/'browser',True)
        self.assertEqual(report['status'],'technical_passed')
        browser=json.loads((d/'browser/browser.json').read_text())
        viewport=next(c for c in browser['results'][0]['checks'] if c['slot']=='viewport')
        self.assertEqual(viewport['checkedPixels'],0)
        self.assertTrue(viewport['occluded'])
        self.assertIsNone(viewport['pass'])

    @unittest.skipUnless(os.environ.get('STATEFUL_BROWSER_TESTS')=='1','Set STATEFUL_BROWSER_TESTS=1 after npm run build for real PixiJS acceptance')
    def test_real_browser_all_supported_components(self):
        for kind in self.loaded:
            with self.subTest(kind=kind):
                d=self.root/kind;report=accept(d/'ui.component-handoff.draft.zip',d/'evidence.json',self.component,d/'browser',True)
                self.assertEqual(report['status'],'technical_passed')
                self.assertFalse(report['human_visual_acceptance'])
                self.assertEqual((d/'ui.component-handoff.draft.zip').read_bytes(),(d/'browser/ui.component-handoff.draft.zip').read_bytes())


if __name__=='__main__':unittest.main()
