import copy
import unittest
import hashlib
import json
import tempfile
import zipfile
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
from ai_ui_decomposition.common import ContractError
from ai_ui_decomposition.scroll_bottom_space import apply_bottom_space
from ai_ui_decomposition.scroll_visibility_handoff import rebind


class BottomSpaceTests(unittest.TestCase):
    def setUp(self):
        self.node = {'id':'scroll', 'type':'ScrollView', 'layout':{'height':596},
                     'props':{'contentHeight':594, 'scrollY':0, 'scrollbarVisibility':'always'}, 'children':[
                         {'id':'list', 'type':'List', 'layout':{'y':0}, 'props':{'items':list(range(6)), 'itemHeight':100, 'rowGap':6}}]}
        self.plan = dict(kind='ui-scroll-bottom-space-plan', version='1.0', sourceSha256='a'*64,
                         componentId='scroll', previousContentHeight=594, viewportHeight=596,
                         bottomWhitespace=22, authorization='Explicit fixture authorization')
        self.scope = {'human_visual_acceptance':False, 'components':[{'componentId':'scroll','mode':'compare'}],
                      'derivedTestStates':[{'componentId':'scroll','description':'old zero range'}, {'componentId':'other'}]}

    def test_explicit_space_preserves_content_and_compare_scope(self):
        children = copy.deepcopy(self.node['children']); compared = copy.deepcopy(self.scope['components'])
        result = apply_bottom_space(self.node, self.scope, self.plan)
        self.assertEqual((result['contentHeight'], result['scrollRange']), (616,20))
        self.assertEqual(self.node['children'], children); self.assertEqual(self.scope['components'], compared)
        self.assertEqual(self.node['layout']['height'],596); self.assertEqual(self.node['props']['scrollY'],0)
        self.assertIn('remain unknown', self.scope['derivedTestStates'][-1]['description'])

    def test_no_default_twenty_pixel_scroll(self):
        self.plan['bottomWhitespace']=0
        self.assertEqual(apply_bottom_space(self.node,self.scope,self.plan)['scrollRange'],0)

    def test_bad_numbers(self):
        for value in (-1, float('nan'), float('inf'), True):
            with self.subTest(value=value), self.assertRaisesRegex(ContractError,'NUMBER'):
                apply_bottom_space(self.node,self.scope,{**self.plan,'bottomWhitespace':value})

    def test_missing_authorization(self):
        with self.assertRaisesRegex(ContractError,'AUTHORIZATION'):
            apply_bottom_space(self.node,self.scope,{**self.plan,'authorization':''})

    def test_stale_geometry(self):
        with self.assertRaisesRegex(ContractError,'STALE_GEOMETRY'):
            apply_bottom_space(self.node,self.scope,{**self.plan,'previousContentHeight':600})

    def test_invented_content_extent(self):
        self.node['children'][0]['props']['items'].append(6)
        with self.assertRaisesRegex(ContractError,'CONTENT_EXTENT'):
            apply_bottom_space(self.node,self.scope,self.plan)

    def test_unknown_version_and_consumer_padding_rejected(self):
        for change in ({'version':'2.0'}, {'padding':22}):
            with self.assertRaises(ContractError): apply_bottom_space(self.node,self.scope,{**self.plan,**change})

    def test_rebind_rehashes_scope_preserves_original_and_unknown_state(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp); source=root/'source.zip'
            encode=lambda v:(json.dumps(v)+'\n').encode()
            members={'component.json':encode({'document':{'root':self.node}}),
                     'binding.json':encode({'documentSha256':'old'}), 'art.zip':b'art',
                     'original.png':b'original image bytes', 'state.json':encode({'scrollY':{'status':'unknown'}}),
                     'scope.json':encode(self.scope)}
            entry=lambda name:dict(path=name,sha256=hashlib.sha256(members[name]).hexdigest())
            manifest=dict(human_visual_acceptance=False,component_bundle=entry('component.json'),
                          appearance_binding=entry('binding.json'),decomposition=entry('art.zip'),
                          reference=dict(scope=entry('scope.json'),state=entry('state.json'),original=entry('original.png'),mapping={'scale':[1,1]}))
            members['handoff.json']=encode(manifest)
            with zipfile.ZipFile(source,'x') as z:
                for k,v in members.items():z.writestr(k,v)
            self.plan['sourceSha256']=hashlib.sha256(source.read_bytes()).hexdigest()
            with patch('ai_ui_decomposition.scroll_visibility_handoff.subprocess.run',return_value=SimpleNamespace(returncode=0,stdout='canonical-hash',stderr='')):
                report=rebind(source,root,root/'out','scroll','always',bottom_space_plan=self.plan)
                with self.assertRaisesRegex(ContractError,'SOURCE_MISMATCH'):
                    rebind(source,root,root/'bad','scroll','always',bottom_space_plan={**self.plan,'sourceSha256':'b'*64})
            with zipfile.ZipFile(root/'out/ui.component-handoff.draft.zip') as z:
                m=json.loads(z.read('handoff.json'))
                self.assertEqual(m['reference']['mapping'],manifest['reference']['mapping'])
                for name in ('art.zip','original.png','state.json'):self.assertEqual(z.read(name),members[name])
                for field in ('component_bundle','appearance_binding'):
                    self.assertEqual(m[field]['sha256'],hashlib.sha256(z.read(m[field]['path'])).hexdigest())
                self.assertEqual(m['reference']['scope']['sha256'],hashlib.sha256(z.read('scope.json')).hexdigest())
                self.assertEqual(json.loads(z.read('component.json'))['document']['root']['props']['contentHeight'],616)
            self.assertEqual(report['derivedLayout']['scrollRange'],20)
