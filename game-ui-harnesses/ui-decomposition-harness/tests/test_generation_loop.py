"""Run the dependency-free host loop's offline Node regressions."""
from pathlib import Path
import shutil
import subprocess
import unittest
import sys
import io
from contextlib import redirect_stdout
from unittest.mock import patch
from test_workflow_bridge import WorkflowBridgeTests as Fixture
from ai_ui_decomposition.common import read_json


class GenerationLoopTests(unittest.TestCase):
    def test_exchange_cli_exit_status_uses_nested_workflow_status(self):
        from ai_ui_decomposition.cli import main
        for status, code in [('ready',0),('awaiting_external',0),('failed',2),('indeterminate',2)]:
            with self.subTest(status=status), patch('ai_ui_decomposition.workflow_exchange.exchange',
                    return_value={'status':{'status':status},'nextRequest':None}), redirect_stdout(io.StringIO()):
                self.assertEqual(main(['workflow-exchange-generation','--job','fixture']),code)

    @unittest.skipUnless(shutil.which('node'), 'Node required for host loop tests')
    def test_offline_host_loop(self):
        result=subprocess.run([shutil.which('node'),'--test',str(Path(__file__).with_name('generation-loop.test.mjs')),
                              str(Path(__file__).with_name('generation-loop-node.test.mjs')),
                              str(Path(__file__).with_name('generation-loop-batching.test.mjs'))],
                              capture_output=True,text=True,timeout=30)
        self.assertEqual(result.returncode,0,result.stdout+result.stderr)


@unittest.skipUnless(shutil.which('node'), 'Node required for host loop integration')
class GenerationLoopIntegrationTests(unittest.TestCase):
    preflight_mode='after-generation-v1'
    setUp=Fixture.setUp
    tearDown=Fixture.tearDown
    authorize=Fixture.authorize

    @unittest.skipUnless(shutil.which('powershell'), 'Windows PowerShell tool host required')
    def test_exported_entry_runs_official_cli_without_handwritten_host_binding(self):
        from ai_ui_decomposition.loop_entry import export_loop
        output=self.base/'entry'
        with self.assertRaisesRegex(ValueError,'LOOP_EXPORT_NOT_AUTHORIZED_FRESH'):
            export_loop(self.job,output/'run.js',self.base)
        self.authorize()
        from ai_ui_decomposition.cli import main
        with redirect_stdout(io.StringIO()):
            self.assertEqual(main(['workflow-export-loop','--job',str(self.job),
                '--output',str(output/'run.js'),'--output-root',str(self.base)]),0)
        self.assertFalse((self.job/'nodes/generate').exists())
        result=subprocess.run([shutil.which('node'),str(Path(__file__).with_name('generation-loop-entry-fixture.mjs')),
            str(output/'run.js'),str(self.raw),str(output)],capture_output=True,text=True,timeout=120)
        self.assertEqual(result.returncode,0,result.stdout+result.stderr)
        summary=read_json(output/'entry-result.json')
        self.assertEqual(summary['simulatedCalls'],3)
        self.assertEqual(summary['providerCalls'],0)
        self.assertEqual(summary['result']['result']['status']['nextNode'],'process')
        self.assertEqual(len(list((self.job/'nodes/generate/output/requests').glob('*/accepted.json'))),3)
        journals=[read_json(p) for p in sorted((output/'journal').glob('*.json'))]
        self.assertEqual(journals[-1]['events'][-1]['event'],'execution-summary')
        self.assertEqual(sum(e['event']=='tool-returned' for b in journals for e in b['events']),3)
        with self.assertRaisesRegex(ValueError,'LOOP_EXPORT_NOT_AUTHORIZED_FRESH'):
            export_loop(self.job,output/'again.js',self.base)

    def test_continuous_loop_uses_official_cli_receipts_without_provider(self):
        self.authorize()
        output=self.base/'loop-journal'
        result=subprocess.run([shutil.which('node'),
            str(Path(__file__).with_name('generation-loop-fixture.mjs')),
            sys.executable,str(self.job),str(self.raw),str(output)],
            capture_output=True,text=True,timeout=60)
        self.assertEqual(result.returncode,0,result.stdout+result.stderr)
        summary=read_json(output/'result.json')
        self.assertEqual(summary['calls'],3)
        self.assertEqual(summary['status']['nextNode'],'process')
        self.assertEqual(summary['providerCalls'],0)
        self.assertEqual(len(list((self.job/'nodes/generate/output/requests').glob('*/accepted.json'))),3)
        self.assertFalse((self.job/'nodes/process').exists())


del Fixture
