import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from types import SimpleNamespace
import zipfile
from ai_ui_decomposition.scroll_visibility_handoff import rebind
from ai_ui_decomposition.common import ContractError


class ScrollVisibilityHandoffTests(unittest.TestCase):
    def fixture(self, root):
        encode=lambda v:json.dumps(v).encode()
        members={'component.json':encode({'document':{'root':{'id':'scroll','type':'ScrollView','props':{'scrollbarVisibility':'auto','contentHeight':649,'scrollY':0},'layout':{'height':649}}}}),'binding.json':encode({'documentSha256':'old','bindings':[]}),'art.zip':b'fixture','reference/original.png':b'original bytes','reference/reference-state.json':encode({'scrollY':{'status':'unknown'}}),'acceptance-scope.json':b'unchanged'}
        manifest={'human_visual_acceptance':False,'kind':'ai_ui_component_handoff_v2'}
        for field,name in [('component_bundle','component.json'),('appearance_binding','binding.json'),('decomposition','art.zip')]:manifest[field]={'path':name,'sha256':hashlib.sha256(members[name]).hexdigest()}
        members['handoff.json']=encode(manifest);source=root/'source.zip'
        with zipfile.ZipFile(source,'w') as z:
            for k,v in members.items():z.writestr(k,v)
        return source,members

    def test_visibility_only_preserves_evidence_and_content(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);source,members=self.fixture(root)
            with patch('ai_ui_decomposition.scroll_visibility_handoff.subprocess.run',return_value=SimpleNamespace(returncode=0,stdout='new-digest',stderr='')) as calls:
                report=rebind(source,root,root/'out','scroll','always')
            self.assertEqual(calls.call_count,3) # two official imports plus canonical document hash
            self.assertFalse(report['human_visual_acceptance'])
            with zipfile.ZipFile(root/'out/ui.component-handoff.draft.zip') as z:
                for name in report['preservedMembers']:self.assertEqual(z.read(name),members[name])
                node=json.loads(z.read('component.json'))['document']['root']
                self.assertEqual(node['props'],dict(scrollbarVisibility='always',contentHeight=649,scrollY=0))
            with self.assertRaisesRegex(ContractError,'OUTPUT_EXISTS'):rebind(source,root,root/'out','scroll','always')

    def test_unknown_component_and_invalid_visibility_fail(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);source,_=self.fixture(root)
            with self.assertRaisesRegex(ContractError,'VISIBILITY_INVALID'):rebind(source,root,root/'bad','scroll','visible')
            with patch('ai_ui_decomposition.scroll_visibility_handoff.subprocess.run',return_value=SimpleNamespace(returncode=0,stdout='',stderr='')):
                with self.assertRaisesRegex(ContractError,'COMPONENT'):rebind(source,root,root/'missing','absent','always')
