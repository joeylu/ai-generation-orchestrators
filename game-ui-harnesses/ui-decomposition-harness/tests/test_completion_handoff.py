"""Offline proof: official processing can start before the executor's final reply."""
import contextlib
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import time
import unittest

from PIL import Image
from ai_ui_decomposition import planning, assets_generation
from ai_ui_decomposition.assets_cli import main
from ai_ui_decomposition.common import digest, read_json, sha256, write_json
from test_assets_cli import FixtureProvider, fixture_coverage


@unittest.skipUnless(shutil.which('powershell') and shutil.which('node'), 'Windows offline host fixture')
class CompletionHandoffTests(unittest.TestCase):
    def test_package_finishes_while_executor_reply_is_still_pending(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory).resolve()
            Image.new('RGB',(64,48),'#17314a').save(root/'reference.png')
            description=json.loads(FixtureProvider().plan())
            description['assets']=description['assets'][:1]
            description['nodes']=description['nodes'][:1]
            description['groups']=description['groups'][:1]
            planning.materialize(json.dumps(description),root,[64,48],1,output_format='png_zip')
            plan=read_json(root/'plan.json')
            plan['reference_coverage']=fixture_coverage(sha256(root/'reference.png'),['scene'],[64,48])
            write_json(root/'covered-plan.json',plan)
            def cli(*args):
                with contextlib.redirect_stdout(io.StringIO()) as output:
                    code=main([str(a) for a in args])
                self.assertEqual(code,0,output.getvalue())
                return json.loads(output.getvalue())
            cli('freeze','--plan',root/'covered-plan.json','--workspace',root/'workspace','--run','test','--material-preflight','after-generation-v1')
            run=root/'workspace/runs/test'
            cli('authorize-generation','--run-dir',run,'--plan-digest',digest(plan),'--approval','offline fixture only; no provider')
            entry=root/'entry'
            cli('export-loop','--run-dir',run,'--output',entry/'run.js','--output-root',root)
            gate=root/'allow-fixture-reply'
            environment=dict(os.environ,LOOP_FIXTURE_HANDOFF_GATE=str(gate))
            started=time.perf_counter()
            child=subprocess.Popen([shutil.which('node'),str(Path(__file__).with_name('generation-loop-entry-fixture.mjs')),
                                    str(entry/'run.js'),str(root/'reference.png'),str(entry)],
                                   stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,env=environment)
            try:
                deadline=time.monotonic()+90
                while True:
                    try:
                        completion=json.loads((entry/'completion.json').read_text(encoding='utf-8'))
                        break
                    except (FileNotFoundError,json.JSONDecodeError):
                        # File discovery may race the writer; never act on partial JSON.
                        self.assertIsNone(child.poll(),'Executor exited before durable completion')
                        self.assertLess(time.monotonic(),deadline,'Completion timeout')
                        time.sleep(.025)
                self.assertEqual(sha256(entry/'journal'/completion['journal']),completion['journalSha256'])
                official=assets_generation.status(run)
                self.assertEqual(official['status'],'generation_complete')
                self.assertEqual(completion['planDigest'],official['planDigest'])
                self.assertEqual(completion['jobDigest'],official['jobDigest'])
                self.assertFalse((entry/'entry-result.json').exists())
                ready=time.perf_counter()-started
                self.assertEqual(cli('material-preflight','--run-dir',run,'--output',root/'quality.json')['status'],'passed')
                cli('process','--run-dir',run)
                cli('finalize','--run-dir',run,'--output',root/'delivery','--draft')
                archive=cli('export','--delivery',root/'delivery')
                self.assertEqual(archive['status'],'archive_roundtrip_passed')
                self.assertFalse((entry/'entry-result.json').exists())
                self.assertIsNone(child.poll())
                packaged=time.perf_counter()-started
                gate.touch()
                stdout,stderr=child.communicate(timeout=15)
                self.assertEqual(child.returncode,0,stdout+stderr)
                result=read_json(entry/'entry-result.json')
                self.assertEqual(result['providerCalls'],0)
                self.assertEqual(result['simulatedCalls'],1)
                print(json.dumps(dict(completionReadySeconds=round(ready,3),packageReadySeconds=round(packaged,3),
                    packagedBeforeExecutorReply=True,providerCalls=0,simulatedCalls=1,
                    timingScope='offline synthetic fixture; not a real-generation speed comparison')))
            finally:
                if child.poll() is None:
                    gate.touch(exist_ok=True)
                    child.communicate(timeout=35)


if __name__=='__main__': unittest.main()
