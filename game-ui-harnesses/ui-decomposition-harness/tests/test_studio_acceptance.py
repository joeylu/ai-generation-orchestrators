import os
import subprocess
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch
from ai_ui_decomposition.common import ContractError
from ai_ui_decomposition.studio_acceptance import verify_reference_roundtrip, run_studio
from ai_ui_decomposition.cli import parser

class StudioReceiptTests(unittest.TestCase):
    def test_cli_exposes_both_offline_entries(self):
        self.assertEqual(parser().parse_args(['studio-acceptance','--source','s','--component-root','c','--output','o']).timeout_seconds,600)
        self.assertEqual(parser().parse_args(['composition-check','--bundle','b','--screenshot','s','--plan','p','--output','o']).command,'composition-check')
    def test_reference_bytes_and_legacy_distinguished(self):
        with tempfile.TemporaryDirectory() as d:
            a,b=Path(d)/'a.zip',Path(d)/'b.zip'
            for path in [a,b]:
                with zipfile.ZipFile(path,'w') as z:z.writestr('reference/original.png',b'original')
            self.assertEqual(verify_reference_roundtrip(a,b)['status'],'byte_identical')
            with zipfile.ZipFile(b,'w') as z:z.writestr('reference/original.png',b'changed')
            with self.assertRaisesRegex(ContractError,'REFERENCE_CHANGED'):verify_reference_roundtrip(a,b)
            for path in [a,b]:
                with zipfile.ZipFile(path,'w') as z:z.writestr('old',b'x')
            self.assertEqual(verify_reference_roundtrip(a,b)['status'],'legacy_missing_reference_evidence')
            for path,value in [(a,1),(b,2)]:
                with zipfile.ZipFile(path,'w') as z:z.writestr('handoff.json','{"reference":{"mapping":'+str(value)+'}}')
            with self.assertRaisesRegex(ContractError,'MAPPING_CHANGED'):verify_reference_roundtrip(a,b)
    def test_failure_and_timeout_never_leave_success_receipt(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);(root/'dist').mkdir();(root/'dist/index.html').write_text('fixture');source=root/'s.zip';source.write_bytes(b'x')
            for index,effect in enumerate([subprocess.CompletedProcess([],1,'','failure'),subprocess.TimeoutExpired([],1)]):
                kwargs={'side_effect':effect} if isinstance(effect,Exception) else {'return_value':effect}
                with patch('ai_ui_decomposition.studio_acceptance.subprocess.run',**kwargs),self.assertRaises(ContractError):run_studio(source,root,root/str(index),1)
                self.assertIn('"status": "failed"',(root/str(index)/'receipt.json').read_text())

@unittest.skipUnless(os.environ.get('UI_STUDIO_BROWSER_TESTS')=='1','Opt-in local Studio browser; no downloads or services')
class StudioBrowserTests(unittest.TestCase):
    def test_zero_and_positive_scroll_roundtrip(self):
        root=Path(__file__).resolve().parents[2]/'ui-component-harness'
        with tempfile.TemporaryDirectory() as d:
            for value in (0,24):
                fixture=Path(d)/str(value)
                subprocess.run(['node',str(Path(__file__).with_name('studio-fixture.mjs')),str(root),str(fixture),str(value)],check=True,capture_output=True)
                receipt=run_studio(fixture/'fixture.zip',root,fixture/'acceptance',120)
                self.assertEqual(receipt['status'],'technical_passed');self.assertEqual(receipt['referenceEvidence']['status'],'byte_identical')
