import _bootstrap  # Enable source-layout imports for unittest discovery.
import unittest
import json
import os
import subprocess
import sys
from pathlib import Path
from PIL import Image
import test_compile_visual
from ai_ui_layers import experimental_executor
from ai_ui_layers.freeze_visual import freeze
from ai_ui_layers.experimental_executor import prepare,authorize,next_request,receive,fail,status


class ExecutorTests(unittest.TestCase):
    def setUp(self):
        test_compile_visual.VisualCompileTests.setUp(self)
        self.snapshot=self.root/'snapshot'
        frozen=freeze(self.run,self.snapshot,5)
        self.job=self.root/'job'
        self.config=prepare(self.snapshot,frozen['digest'],self.job,['asset-coin-a'])

    def test_authorization_required_and_raw_exchange_once(self):
        self.assertEqual(status(self.job)['status'],'awaiting_authorization')
        with self.assertRaises(ValueError):next_request(self.job)
        with self.assertRaises(ValueError):authorize(self.job,'wrong','fixture-only')
        authorize(self.job,self.config['digest'],'fixture-only approval')
        request=next_request(self.job)
        self.assertEqual(len(request['arguments']['referenced_image_paths']),2)
        with self.assertRaises(ValueError):next_request(self.job)
        raw=self.root/'fixture.png';Image.new('RGB',(50,50),'magenta').save(raw)
        with self.assertRaises(ValueError):receive(self.job,'wrong',raw)
        result=receive(self.job,request['submissionDigest'],raw)
        self.assertFalse(result['alphaQualityAccepted'])
        self.assertEqual(status(self.job)['status'],'raw_complete')
        with self.assertRaises(ValueError):receive(self.job,request['submissionDigest'],raw)
        with self.assertRaises(ValueError):next_request(self.job)

    def test_indeterminate_result_is_terminal(self):
        authorize(self.job,self.config['digest'],'fixture-only')
        request=next_request(self.job);fail(self.job,request['submissionDigest'],'fixture timeout')
        self.assertEqual(status(self.job)['status'],'blocked_no_resubmit')
        with self.assertRaises(ValueError):next_request(self.job)

    def test_foreground_canvas_aspect_deferred_to_support_check(self):
        authorize(self.job,self.config['digest'],'fixture-only');request=next_request(self.job)
        raw=self.root/'bad.png';Image.new('RGB',(100,20)).save(raw)
        receive(self.job,request['submissionDigest'],raw)
        self.assertEqual(status(self.job)['status'],'raw_complete')

    def test_changed_input_blocks_dispatch(self):
        authorize(self.job,self.config['digest'],'fixture-only')
        (self.job/'snapshot/materials/asset-coin-a/prompt.txt').write_text('changed',encoding='utf-8')
        with self.assertRaisesRegex(ValueError,'ARTIFACT_CHANGED'):next_request(self.job)

    def test_prompt_variant_bound_to_new_job(self):
        prompt=self.root/'variant.txt';prompt.write_text('Short variant',encoding='utf-8')
        job=self.root/'variant-job'
        config=prepare(self.snapshot,self.config['snapshotDigest'],job,['asset-coin-a'],prompt)
        authorize(job,config['digest'],'fixture-only')
        self.assertEqual(next_request(job)['arguments']['prompt'],'Short variant')
        (job/'prompt-variant.txt').write_text('changed',encoding='utf-8')
        with self.assertRaisesRegex(ValueError,'PROMPT_VARIANT_CHANGED'):status(job)

    def test_non_ascii_prompt_survives_ascii_cli_exchange(self):
        prompt=self.root/'unicode-variant.txt';prompt.write_text('Remove 领取 only.',encoding='utf-8')
        job=self.root/'unicode-job'
        config=prepare(self.snapshot,self.config['snapshotDigest'],job,['asset-coin-a'],prompt)
        authorize(job,config['digest'],'offline fixture')
        env={**os.environ,'PYTHONPATH':str(Path(experimental_executor.__file__).resolve().parents[1])}
        run=subprocess.run([sys.executable,'-m','ai_ui_layers.experimental_executor','next','--job',str(job)],
                           capture_output=True,text=True,encoding='ascii',env=env)
        self.assertEqual(run.returncode,0,run.stderr)
        self.assertTrue(run.stdout.isascii())
        self.assertEqual(json.loads(run.stdout)['arguments']['prompt'],'Remove 领取 only.')
