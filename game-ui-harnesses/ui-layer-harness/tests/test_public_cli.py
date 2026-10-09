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
    def test_new_run_defaults_to_sheets_and_explicit_modes_are_honored(self):
        import tempfile
        from PIL import Image
        from ai_ui_layers.evaluate import read
        from test_planning_dag import FakeModel
        real_dag=delivery_dag.DeliveryDag
        for mode,expected,reference in ((None,'sheets',None),('sheets','sheets',None),('single','single',None),(None,'sheets','full')):
            with self.subTest(mode=mode,reference=reference),tempfile.TemporaryDirectory() as tmp:
                root=Path(tmp);run=root/'run'
                Image.new('RGB',(1000,1000)).save(root/'reference.png')
                argv=['ui_layer.py','run','--image',str(root/'reference.png'),
                      '--output',str(run),'--target','frozen','--max-calls','5']
                if mode is not None:argv+=['--generation-mode',mode]
                if reference is not None:argv+=['--generation-reference',reference]
                model=FakeModel();out,err=io.StringIO(),io.StringIO()
                with patch.object(sys,'argv',argv), \
                     patch.object(delivery_dag,'DeliveryDag',side_effect=lambda output:real_dag(output,model)), \
                     contextlib.redirect_stdout(out),contextlib.redirect_stderr(err):
                    delivery_dag.main()
                result=json.loads(out.getvalue())
                self.assertEqual(result['status'],'frozen')
                self.assertEqual(read(run/'.dag/config.json')['generationMode'],expected)
                self.assertEqual(read(run/'.dag/config.json')['generationReference'],reference or 'context-crops')
                self.assertEqual(read(run/'planning/.dag/config.json')['generationMode'],expected)
                requests=read(run/'planning/frozen/requests.json')
                snapshot=read(run/'planning/frozen/snapshot.json')
                self.assertEqual(snapshot.get('generationReference','full'),reference or 'context-crops')
                if expected=='sheets':
                    self.assertEqual(requests['kind'],'ui_visual_requests_preview_v2')
                    self.assertLess(len(requests['requests']),snapshot['materialCount'])
                else:
                    self.assertEqual(requests['kind'],'ui_visual_requests_preview_v1')
                    self.assertEqual(len(requests['requests']),snapshot['materialCount'])
                self.assertEqual(result['planning']['mediaGenerationCalls'],0)
                self.assertFalse((run/'generation').exists())
                real_dag(run,model).execute()
                self.assertEqual(len(model.calls),2)

    def test_existing_single_and_legacy_configs_keep_single_requests(self):
        import tempfile
        from PIL import Image
        from ai_ui_layers.evaluate import read,digest
        from test_planning_dag import FakeModel
        for legacy in (False,True):
            with self.subTest(legacy=legacy),tempfile.TemporaryDirectory() as tmp:
                root=Path(tmp);Image.new('RGB',(1000,1000)).save(root/'reference.png')
                run=delivery_dag.init(root/'reference.png',root/'run',target='frozen',generation_mode='single',generation_reference='full')
                if legacy:
                    config=run/'.dag/config.json';body=read(config);del body['generationMode']
                    del body['generationReference']
                    config.write_text(json.dumps(body),encoding='utf-8')
                    (run/'.dag/config-digest.json').write_text(json.dumps(dict(sha256=digest(config))),encoding='utf-8')
                before=digest(run/'.dag/config.json')
                result=delivery_dag.DeliveryDag(run,FakeModel()).execute()
                self.assertEqual(result['status'],'frozen')
                self.assertEqual(digest(run/'.dag/config.json'),before)
                self.assertEqual(read(run/'planning/.dag/config.json')['generationMode'],'single')
                self.assertEqual(read(run/'planning/.dag/config.json')['generationReference'],'full')
                requests=read(run/'planning/frozen/requests.json')
                self.assertEqual(requests['kind'],'ui_visual_requests_preview_v1')
                self.assertEqual(len(requests['requests']),5)

    def test_new_planning_init_defaults_to_grouped_requests(self):
        import tempfile
        from PIL import Image
        from ai_ui_layers import planning_dag
        from ai_ui_layers.evaluate import read
        from test_planning_dag import FakeModel
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);Image.new('RGB',(1000,1000)).save(root/'reference.png')
            run=planning_dag.init(root/'reference.png',root/'run')
            result=planning_dag.Dag(run,FakeModel()).execute()
            self.assertEqual(result['status'],'frozen')
            self.assertEqual(read(run/'.dag/config.json')['generationMode'],'sheets')
            self.assertEqual(read(run/'.dag/config.json')['generationReference'],'context-crops')
            self.assertEqual(read(run/'frozen/requests.json')['kind'],'ui_visual_requests_preview_v2')

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
        self.assertEqual(result.stdout.strip(),'0.1.0a3')
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
            # Propagate the suite's fixed shared source to the child interpreter;
            # importing its dirty checkout would test a different runtime fingerprint.
            from ai_ui_layers import planning_dag, compile_visual
            script=("import sys,runpy;from pathlib import Path;"
                f"sys.path.insert(0,{str(entry.parent/'src')!r});"
                "from ai_ui_layers import compile_visual,planning_dag;"
                f"compile_visual.HARNESS=Path({str(compile_visual.HARNESS)!r});"
                f"planning_dag.HARNESS=Path({str(planning_dag.HARNESS)!r});"
                f"planning_dag.BASE=Path({str(planning_dag.BASE)!r});"
                f"sys.argv=[{str(entry)!r}]+sys.argv[1:];runpy.run_path({str(entry)!r},run_name='__main__')")
            result=subprocess.run([sys.executable,'-c',script,'status','--output',str(root/'run')],
                                  cwd=root,capture_output=True,text=True,encoding='utf-8')
            self.assertEqual(result.returncode,0,result.stderr+result.stdout)
            self.assertEqual(json.loads(result.stdout)['status'],'incomplete')
