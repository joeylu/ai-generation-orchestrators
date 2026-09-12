import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch
import zipfile
from ai_ui_decomposition.appearance_revision import revise
from ai_ui_decomposition.common import ContractError

class AppearanceRevisionTests(unittest.TestCase):
    def fixture(self,root):
        bundle={'document':{'root':{'id':'dialog','type':'Dialog','props':{'open':True}}},'resources':[]}
        binding=dict(documentSha256='old',deliveryDigest='d',sceneSha256='s',archiveSha256='a',registration={},bindings=[])
        manifest=dict(kind='ai_ui_component_handoff_v2',human_visual_acceptance=False,component_bundle={'path':'bundle.json'},appearance_binding={'path':'binding.json'})
        source=root/'source.zip'
        with zipfile.ZipFile(source,'w') as z:
            for name,data in [('handoff.json',manifest),('bundle.json',bundle),('binding.json',binding)]:z.writestr(name,json.dumps(data))
            z.writestr('reference/original.png',b'original fixture bytes')
        for name,data in [('bundle.json',bundle),('binding.json',binding)]: (root/name).write_text(json.dumps(data),encoding='utf8')
        return source,bundle

    def test_layout_revision_preserves_original(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);source,bundle=self.fixture(root);bundle['document']['root']['props']['style']={'fontFamily':'Arial'};(root/'bundle.json').write_text(json.dumps(bundle),encoding='utf8')
            with patch('ai_ui_decomposition.appearance_revision.subprocess.run',return_value=SimpleNamespace(returncode=0,stdout='canonical-hash',stderr='')) as calls:
                r=revise(source,root/'bundle.json',root/'binding.json',root,root/'out')
            self.assertEqual(calls.call_count,3);self.assertFalse(r['human_visual_acceptance'])
            with zipfile.ZipFile(root/'out/ui.component-handoff.draft.zip') as z:self.assertEqual(z.read('reference/original.png'),b'original fixture bytes')

    def test_art_and_topology_changes_fail(self):
        for mutation in ('art','topology'):
            with tempfile.TemporaryDirectory() as d:
                root=Path(d);source,bundle=self.fixture(root)
                if mutation=='art':bundle['resources']=[{'path':'new.png'}]
                else:bundle['document']['root']['id']='changed'
                (root/'bundle.json').write_text(json.dumps(bundle),encoding='utf8')
                with patch('ai_ui_decomposition.appearance_revision.subprocess.run',return_value=SimpleNamespace(returncode=0,stdout='',stderr='')):
                    with self.assertRaisesRegex(ContractError,'ART_CHANGED|TOPOLOGY_CHANGED'):revise(source,root/'bundle.json',root/'binding.json',root,root/'out')
