"""Opt-in local consumer fixture; never contacts an image/model provider."""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest


@unittest.skipUnless(os.environ.get('LINKAGE_BROWSER')=='1','Set LINKAGE_BROWSER=1 for real local browser regression')
class LinkageBrowserTests(unittest.TestCase):
    def test_composite_real_input_receipt(self):
        consumer=Path(__file__).resolve().parents[2]/'ui-component-harness'
        driver=Path(__file__).resolve().parents[1]/'src/ai_ui_decomposition/linkage-browser.mjs'
        with tempfile.TemporaryDirectory() as tmp:
            out=Path(tmp)/'fixture'
            subprocess.run(['node',str(Path(__file__).with_name('linkage-fixture.mjs')),str(consumer),str(out)],check=True,capture_output=True,timeout=60)
            completed=subprocess.run(['node',str(driver),str(consumer),str(out)],capture_output=True,text=True,timeout=180)
            report=json.loads((out/'linkage-browser.json').read_text())
            self.assertEqual(completed.returncode,0,report.get('error'))
            self.assertEqual(report['status'],'passed')
            self.assertTrue(report['checks'] and all(c['pass'] for c in report['checks']))
            self.assertEqual(len(report['coveredComponentIds']),7)
            self.assertTrue(any('/opaque image samples/row/' in c['name'] for c in report['checks']))
            self.assertFalse(report['human_visual_acceptance'])
