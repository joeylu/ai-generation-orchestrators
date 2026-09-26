import _bootstrap
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from PIL import Image

from ai_ui_layers import collect_session


class CollectSessionTests(unittest.TestCase):
    def test_literal_prompt_accepts_static_string_raw_with_unicode(self):
        prompt='深蓝半透明底板\n保留细边与透明度'
        code='tools.image_gen__imagegen({prompt: String.raw`'+prompt+'`, num_last_images_to_include: 1})'
        self.assertEqual(collect_session.literal_prompt(code),prompt)

    def test_literal_prompt_rejects_interpolated_string_raw(self):
        code='tools.image_gen__imagegen({prompt: String.raw`panel ${detail}`})'
        with self.assertRaisesRegex(ValueError,'UNSUPPORTED_TEMPLATE'):
            collect_session.literal_prompt(code)

    def test_literal_prompt_accepts_only_static_escaped_quotes(self):
        prompt='Entries: {"material": "带彩色点的调色板"}'
        code='tools.image_gen__imagegen({prompt: `'+prompt.replace('"','\\"')+'`, num_last_images_to_include: 1})'
        self.assertEqual(collect_session.literal_prompt(code),prompt)
        for bad in ('panel ${detail}',r'panel \n',r'panel \\'):
            with self.subTest(bad=bad),self.assertRaisesRegex(ValueError,'UNSUPPORTED_TEMPLATE'):
                collect_session.literal_prompt('tools.image_gen__imagegen({prompt: `'+bad+'`})')

    def test_received_sheet_skips_single_material_postprocess(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);job=root/'job';home=root/'codex-home'
            asset='sheet-fixture';submission='submission-fixture';sid='session-fixture'
            folder=job/'generation-sessions'/submission;folder.mkdir(parents=True)
            (folder/'session-result.json').write_text(json.dumps(dict(
                exitCode=0,sessionIds=[sid],submissionDigest=submission,elapsedSeconds=12)),encoding='utf-8')
            (folder/'tool-request.json').write_text(json.dumps(dict(
                asset=asset,submissionDigest=submission,materialIds=['a','b'],
                arguments=dict(prompt='Exact prompt',referenced_image_paths=['reference.png']))),encoding='utf-8')
            log=home/'sessions'/f'{sid}.jsonl';log.parent.mkdir(parents=True)
            log.write_text(json.dumps(dict(payload=dict(type='custom_tool_call',input=(
                'tools.image_gen__imagegen({prompt: "Exact prompt", num_last_images_to_include: 1})'))))+'\n',encoding='utf-8')
            generated=home/'generated_images'/sid/'output.png';generated.parent.mkdir(parents=True)
            Image.new('RGBA',(64,64),(0,0,0,0)).save(generated)
            pending=dict(status='awaiting_result',requests={asset:'awaiting_result_no_resubmit'})
            with patch.object(collect_session,'status',return_value=pending), \
                 patch.object(collect_session,'verified',return_value={'digest':submission}), \
                 patch.object(collect_session,'receive',return_value={'digest':'receipt-fixture'}), \
                 patch.object(collect_session,'process') as process:
                result=collect_session.collect(job,home)
            process.assert_not_called()
            self.assertEqual(result['asset'],asset)
            self.assertEqual(result['postprocess'],'deferred_to_sheet_extraction')
            self.assertEqual(result['issues'],[])

    def test_received_sheet_with_static_string_raw_uses_existing_receipt_path(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);job=root/'job';home=root/'codex-home'
            asset='sheet-fixture';submission='submission-fixture';sid='session-fixture'
            prompt='深蓝半透明底板\n保留细边与透明度'
            folder=job/'generation-sessions'/submission;folder.mkdir(parents=True)
            (folder/'session-result.json').write_text(json.dumps(dict(
                exitCode=0,sessionIds=[sid],submissionDigest=submission,elapsedSeconds=12)),encoding='utf-8')
            (folder/'tool-request.json').write_text(json.dumps(dict(
                asset=asset,submissionDigest=submission,materialIds=['a','b'],
                arguments=dict(prompt=prompt,referenced_image_paths=['reference.png'])),ensure_ascii=False),encoding='utf-8')
            log=home/'sessions'/f'{sid}.jsonl';log.parent.mkdir(parents=True)
            code='tools.image_gen__imagegen({prompt: String.raw`'+prompt+'`, num_last_images_to_include: 1})'
            log.write_text(json.dumps(dict(payload=dict(type='custom_tool_call',input=code)),ensure_ascii=False)+'\n',encoding='utf-8')
            generated=home/'generated_images'/sid/'output.png';generated.parent.mkdir(parents=True)
            Image.new('RGBA',(64,64),(0,0,0,0)).save(generated)
            pending=dict(status='awaiting_result',requests={asset:'awaiting_result_no_resubmit'})
            with patch.object(collect_session,'status',return_value=pending), \
                 patch.object(collect_session,'verified',return_value={'digest':submission}), \
                 patch.object(collect_session,'receive',return_value={'digest':'receipt-fixture'}):
                result=collect_session.collect(job,home)
            self.assertEqual(result['postprocess'],'deferred_to_sheet_extraction')
            self.assertTrue(json.loads((folder/'image-call-audit.json').read_text())['exactPromptMatch'])


if __name__=='__main__':unittest.main()
