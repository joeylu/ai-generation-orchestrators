import _bootstrap
import json
import unittest
from PIL import Image

import test_compile_visual
from ai_ui_layers.evaluate import digest, read, save
from ai_ui_layers.freeze_visual import freeze
from ai_ui_layers.experimental_executor import prepare, authorize, next_request, receive
from ai_ui_layers.received_bundle import inspect_sources, materialize


class ReceivedBundleTests(unittest.TestCase):
    def setUp(self):
        test_compile_visual.VisualCompileTests.setUp(self)
        self.snapshot=self.root/'snapshot'
        self.frozen=freeze(self.run,self.snapshot,5)
        self.asset='asset-coin-a'
        self.job=self.root/'received-job'
        config=prepare(self.snapshot,self.frozen['digest'],self.job,[self.asset],reference_mode='full-only')
        authorize(self.job,config['digest'],'offline fixture approval')
        request=next_request(self.job)
        raw=self.root/'fixture.png'
        Image.new('RGBA',(100,100),(70,80,90,200)).save(raw)
        receive(self.job,request['submissionDigest'],raw)

    def test_received_request_matches_exact_inputs_and_requires_complete_bundle(self):
        checked=inspect_sources(self.snapshot,self.frozen['digest'],{self.asset:self.job})
        self.assertEqual(checked['status'],'incomplete')
        self.assertEqual(checked['records'][0]['rawSha256'],digest(self.job/'attempts'/self.asset/'raw.png'))
        self.assertEqual(len(checked['missing']),4)
        with self.assertRaisesRegex(ValueError,'INCOMPLETE_RECEIVED_BUNDLE'):
            materialize(self.snapshot,self.frozen['digest'],{self.asset:self.job},self.root/'bundle')
        self.assertFalse((self.root/'bundle').exists())

    def test_prompt_variant_cannot_masquerade_as_default_receipt(self):
        variant=self.root/'variant.txt';variant.write_text('Different image prompt',encoding='utf-8')
        job=self.root/'variant-job'
        config=prepare(self.snapshot,self.frozen['digest'],job,[self.asset],variant,reference_mode='full-only')
        authorize(job,config['digest'],'offline fixture approval')
        request=next_request(job)
        raw=self.root/'other.png';Image.new('RGBA',(100,100),(30,40,50,200)).save(raw)
        receive(job,request['submissionDigest'],raw)
        with self.assertRaisesRegex(ValueError,'PROMPT_MISMATCH'):
            inspect_sources(self.snapshot,self.frozen['digest'],{self.asset:job})
        allowed={self.asset:config['promptVariant']['sha256']}
        with self.assertRaisesRegex(ValueError,'VARIANT_CALL_AUDIT_MISSING'):
            inspect_sources(self.snapshot,self.frozen['digest'],{self.asset:job},allowed_variants=allowed)
        audit=job/'generation-sessions'/request['submissionDigest']/'image-call-audit.json'
        audit.parent.mkdir(parents=True)
        save(audit,dict(observedImageCalls=1,exactPromptMatch=True,
                        sourceSha256=digest(job/'attempts'/self.asset/'raw.png')))
        checked=inspect_sources(self.snapshot,self.frozen['digest'],{self.asset:job},
                                allowed_variants=allowed)
        self.assertEqual(checked['records'][0]['promptMode'],'approved_variant')
        self.assertEqual(checked['records'][0]['promptVariantSha256'],allowed[self.asset])
        with self.assertRaisesRegex(ValueError,'PROMPT_MISMATCH'):
            inspect_sources(self.snapshot,self.frozen['digest'],{self.asset:job},
                            allowed_variants={self.asset:'0'*64})

    def test_changed_raw_is_rejected_by_original_receipt(self):
        (self.job/'attempts'/self.asset/'raw.png').write_bytes(b'changed')
        with self.assertRaisesRegex(ValueError,'RESULT_CHANGED'):
            inspect_sources(self.snapshot,self.frozen['digest'],{self.asset:self.job})

    def test_crop_only_variant_requires_exact_source_crop_and_image_call_audit(self):
        variant=self.root/'crop-prompt.txt'
        variant.write_text('Extract the icon and remove its background.',encoding='utf-8')
        job=self.root/'crop-job'
        config=prepare(self.snapshot,self.frozen['digest'],job,[self.asset],variant,
                       reference_mode='crop-only')
        authorize(job,config['digest'],'offline fixture approval')
        request=next_request(job)
        raw=self.root/'crop-result.png'
        Image.new('RGBA',(100,100),(30,40,50,200)).save(raw)
        receive(job,request['submissionDigest'],raw)
        selection={self.asset:job}
        allowed={self.asset:config['promptVariant']['sha256']}
        with self.assertRaisesRegex(ValueError,'PROMPT_MISMATCH'):
            inspect_sources(self.snapshot,self.frozen['digest'],selection)
        session=job/'generation-sessions'/request['submissionDigest']
        session.mkdir(parents=True)
        save(session/'image-call-audit.json',dict(observedImageCalls=1,exactPromptMatch=True,
             sourceSha256=digest(job/'attempts'/self.asset/'raw.png')))
        with self.assertRaisesRegex(ValueError,'CROP_REFERENCE_AUDIT_MISSING'):
            inspect_sources(self.snapshot,self.frozen['digest'],selection,allowed_variants=allowed)
        save(session/'tool-request.json',request)
        checked=inspect_sources(self.snapshot,self.frozen['digest'],selection,allowed_variants=allowed)
        self.assertEqual(checked['records'][0]['referenceMode'],'crop-only')
        self.assertEqual(checked['records'][0]['cropSha256'],
                         digest(self.snapshot/'materials'/self.asset/'reference-crop.png'))
        request['arguments']['referenced_image_paths']=[str(job/'snapshot/reference.png')]
        (session/'tool-request.json').write_text(json.dumps(request),encoding='utf-8')
        with self.assertRaisesRegex(ValueError,'CROP_REFERENCE_AUDIT_MISMATCH'):
            inspect_sources(self.snapshot,self.frozen['digest'],selection,allowed_variants=allowed)
