"""Offline reference-only repair inputs; no image tools or external services."""
import _bootstrap
from copy import deepcopy
import io
import json
import unittest
from contextlib import redirect_stdout
from unittest.mock import patch

from ai_ui_layers import experimental_executor as ex, material_cleanup as cleanup
from ai_ui_layers.evaluate import read, digest
from ai_ui_layers.freeze_visual import body_digest
import test_layout_generation as fixtures
import test_material_cleanup as cleanup_fixtures


class ReferenceStructureCleanupTests(unittest.TestCase):
    bind=fixtures.LayoutGenerationTests.bind
    setUp=fixtures.LayoutGenerationTests.setUp

    def prepare(self,name='reference-repair'):
        source=self.root/('source-'+name)
        cleanup_fixtures.MaterialCleanupTests.make_source(
            self,self.snapshot,self.frozen['digest'],source,self.mid)
        job=self.root/name
        config=cleanup.prepare_cleanup(self.snapshot,self.frozen['digest'],job,self.mid,source,
            layout_contract=self.contract,input_policy=cleanup.REFERENCE_INPUT_POLICY)
        return job,config,source

    def test_original_reference_scope_owns_geometry_and_old_png_is_provenance_only(self):
        job,config,source=self.prepare()
        _,rows=ex.load_job(job)
        arguments=ex.frozen_request_arguments(job,config,rows[self.mid])
        self.assertEqual(arguments['referenced_image_paths'],[
            str(job/'cleanup/reference-context.png'),str(job/'snapshot/reference.png')])
        self.assertEqual(config['cleanup']['inputPolicy'],cleanup.REFERENCE_INPUT_POLICY)
        self.assertEqual(config['cleanup']['promptVersion'],cleanup.REFERENCE_PROMPT_VERSION)
        self.assertEqual(config['generationMode'],'sheets')
        self.assertEqual(config['maximumCalls'],1)
        self.assertEqual(config['automaticRetries'],0)
        self.assertIn('exactly 3 independent thin horizontal divider lines',arguments['prompt'])
        self.assertIn('sole geometry target',arguments['prompt'])
        self.assertNotIn('CLEAN-PLATE EDIT',arguments['prompt'])
        self.assertNotIn('Use the same ',arguments['prompt'])
        self.assertNotIn('Do not move decorations independently',arguments['prompt'])
        inputs=read(job/'cleanup/inputs.json')
        self.assertEqual(arguments['prompt'].count('- DELETE '),len(inputs['removeForeign']))
        # Native request has no old image, while full original source identity stays sealed.
        self.assertTrue((job/'cleanup/cleanup-source.png').exists())
        self.assertEqual(config['cleanup']['sourceCellSha256'],digest(job/'cleanup/cleanup-source.png'))
        ex.authorize(job,config['digest'],'offline reference-only fixture approval')
        request=ex.next_request(job)
        self.assertEqual(request['arguments'],arguments)
        ex.fail(job,request['submissionDigest'],'offline indeterminate return')
        with self.assertRaisesRegex(ValueError,'NOT_READY_NO_RESUBMIT'):ex.next_request(job)

    def test_rehashed_policy_or_prompt_version_change_cannot_reuse_frozen_inputs(self):
        job,config,_=self.prepare()
        for policy,version in ((None,cleanup.REFERENCE_PROMPT_VERSION),
                               (cleanup.REFERENCE_INPUT_POLICY,cleanup.PROMPT_VERSION),
                               ('unknown-policy',cleanup.REFERENCE_PROMPT_VERSION)):
            changed=deepcopy(config);changed.pop('digest')
            changed['cleanup']['inputPolicy']=policy
            changed['cleanup']['promptVersion']=version
            changed['digest']=body_digest(changed)
            (job/'job.json').write_text(json.dumps(changed),encoding='utf-8')
            with self.assertRaisesRegex(ValueError,'CLEANUP_INPUT_POLICY_BINDING'):
                ex.authorize(job,changed['digest'],'offline forged fixture approval')
            self.assertFalse((job/'authorization.json').exists())

    def test_source_provenance_is_required_even_when_not_in_native_input_list(self):
        job,config,_=self.prepare()
        with (job/'cleanup/cleanup-source.png').open('ab') as stream:stream.write(b'changed')
        with self.assertRaisesRegex(ValueError,'CLEANUP_INPUT_CHANGED'):
            ex.authorize(job,config['digest'],'offline fixture approval')
        self.assertFalse((job/'authorization.json').exists())

    def test_reference_structure_requires_declared_layout_before_creating_job(self):
        source=self.root/'source'
        cleanup_fixtures.MaterialCleanupTests.make_source(
            self,self.snapshot,self.frozen['digest'],source,self.mid)
        for policy,error in ((cleanup.REFERENCE_INPUT_POLICY,'REQUIRES_LAYOUT'),('unknown','INPUT_POLICY')):
            output=self.root/('bad-'+policy)
            with self.assertRaisesRegex(ValueError,error):
                cleanup.prepare_cleanup(self.snapshot,self.frozen['digest'],output,self.mid,source,
                                        input_policy=policy)
            self.assertFalse(output.exists())

    def test_public_preparation_uses_original_references_without_compute_or_authorization(self):
        from ai_ui_layers.delivery_dag import main
        source=self.root/'source'
        cleanup_fixtures.MaterialCleanupTests.make_source(
            self,self.snapshot,self.frozen['digest'],source,self.mid)
        job=self.root/'public-reference-repair';stdout=io.StringIO()
        args=['ui_layer.py','prepare-material-cleanup','--snapshot',str(self.snapshot),
              '--snapshot-digest',self.frozen['digest'],'--output',str(job),
              '--material-id',self.mid,'--received-job',str(source),
              '--layout-contract',str(self.contract),
              '--cleanup-input-policy',cleanup.REFERENCE_INPUT_POLICY]
        with patch('sys.argv',args),redirect_stdout(stdout):main()
        config=json.loads(stdout.getvalue());_,rows=ex.load_job(job)
        self.assertEqual(config['maximumCalls'],1)
        self.assertFalse((job/'authorization.json').exists())
        self.assertEqual(list((job/'attempts').iterdir()),[])
        self.assertEqual(ex.status(job)['status'],'awaiting_authorization')
        self.assertEqual(len(ex.frozen_request_arguments(job,config,rows[self.mid])['referenced_image_paths']),2)
        with patch('sys.argv',['ui_layer.py','status','--output',str(job),
                               '--cleanup-input-policy',cleanup.REFERENCE_INPUT_POLICY]),self.assertRaises(SystemExit):
            main()


if __name__=='__main__':unittest.main()
