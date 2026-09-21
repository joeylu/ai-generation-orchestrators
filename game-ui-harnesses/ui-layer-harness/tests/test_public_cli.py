import _bootstrap  # Enable source-layout imports for unittest discovery.
import contextlib
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import unittest
from unittest.mock import patch
from ai_ui_layers import delivery_dag
class PublicCliTests(unittest.TestCase):
    def test_progress_is_stderr_and_stdout_is_one_json(self):
        class FakeDag:
            def __init__(self, _): pass
            def verify(self): pass
            root=Path('fixture')
            def execute(self):
                print('{"node":"planning","status":"running"}')
                return {'status':'awaiting_authorization'}
        out,err=io.StringIO(),io.StringIO()
        with patch.object(sys,'argv',['ui_layer.py','resume','--output','fixture']), \
             patch.object(delivery_dag,'DeliveryDag',FakeDag), \
             contextlib.redirect_stdout(out),contextlib.redirect_stderr(err):
            delivery_dag.main()
        self.assertEqual(json.loads(out.getvalue()),{'status':'awaiting_authorization'})
        self.assertIn('planning',err.getvalue())

    def test_version_and_failed_status_are_machine_readable(self):
        entry=Path(__file__).resolve().parents[1]/'ui_layer.py'
        result=subprocess.run([sys.executable,str(entry),'--version'],capture_output=True,text=True,encoding='utf-8')
        self.assertEqual(result.returncode,0)
        self.assertEqual(result.stdout.strip(),'0.1.0a2')
        import tempfile
        with tempfile.TemporaryDirectory() as tmp:
            result=subprocess.run([sys.executable,str(entry),'status','--output',str(Path(tmp)/'missing-图层')],
                env={**os.environ,'PYTHONIOENCODING':'gbk'},capture_output=True,text=True,encoding='utf-8')
        self.assertEqual(result.returncode,1)
        self.assertEqual(json.loads(result.stdout)['status'],'stopped')

    def test_entry_reads_initialized_run_outside_repository_cwd(self):
        import tempfile
        from PIL import Image
        entry=Path(__file__).resolve().parents[1]/'ui_layer.py'
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)
            Image.new('RGBA',(40,40),'navy').save(root/'reference.png')
            delivery_dag.init(root/'reference.png',root/'run',target='frozen')
            result=subprocess.run([sys.executable,str(entry),'status','--output',str(root/'run')],
                                  cwd=root,capture_output=True,text=True,encoding='utf-8')
            self.assertEqual(result.returncode,0,result.stderr+result.stdout)
            self.assertEqual(json.loads(result.stdout)['status'],'incomplete')
