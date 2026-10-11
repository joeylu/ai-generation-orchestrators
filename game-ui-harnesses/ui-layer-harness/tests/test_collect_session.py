import _bootstrap
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from PIL import Image

from ai_ui_layers import collect_session


class CollectSessionTests(unittest.TestCase):
    def test_rgba_inspection_verifies_before_alpha_and_preserves_soft_pixels(self):
        with tempfile.TemporaryDirectory() as tmp:
            source=Path(tmp)/'soft-fixture.png'
            image=Image.new('RGBA',(4,1))
            image.putdata([(10,20,30,0),(40,50,60,1),(70,80,90,128),(100,110,120,255)])
            image.save(source)
            before=source.read_bytes()
            # Reproduce the failed adapter sequence with this same PNG.
            with Image.open(source) as reader:
                reader.getchannel('A').getextrema()
                with self.assertRaisesRegex(RuntimeError,'verify must be called directly after open'):
                    reader.verify()
            self.assertEqual(collect_session.inspect_png(source),dict(
                size=[4,1],mode='RGBA',alphaRange=[0,255]))
            self.assertEqual(source.read_bytes(),before)
            with Image.open(source) as reader:
                self.assertEqual(reader.tobytes(),image.tobytes())

    def test_png_inspection_handles_opaque_and_palette_alpha_without_reencoding(self):
        with tempfile.TemporaryDirectory() as tmp:
            for mode in ('RGB','P'):
                with self.subTest(mode=mode):
                    source=Path(tmp)/(mode+'.png')
                    image=Image.new(mode,(3,2))
                    if mode=='P':
                        image.putpalette([0,0,0,255,255,255]+[0]*762)
                        image.putpixel((1,1),1)
                        image.save(source,transparency=0)
                    else:image.save(source)
                    before=source.read_bytes()
                    self.assertEqual(collect_session.inspect_png(source),dict(
                        size=[3,2],mode=mode,alphaRange=[0,255] if mode=='P' else [255,255]))
                    self.assertEqual(source.read_bytes(),before)

    def test_png_inspection_rejects_corrupt_crc_and_other_formats(self):
        with tempfile.TemporaryDirectory() as tmp:
            source=Path(tmp)/'bad.png'
            Image.new('RGBA',(4,4),(10,20,30,128)).save(source)
            data=bytearray(source.read_bytes())
            index=data.index(b'IDAT')+4
            data[index]^=1  # Keep the original CRC: structural verification must reject.
            source.write_bytes(data)
            with self.assertRaises((OSError,ValueError,SyntaxError)):
                collect_session.inspect_png(source)
            source=Path(tmp)/'not-png.jpg'
            Image.new('RGB',(4,4)).save(source)
            with self.assertRaisesRegex(ValueError,'PNG_REQUIRED'):
                collect_session.inspect_png(source)

    def test_literal_tool_background_mode_must_be_explicit_and_unique(self):
        self.assertTrue(collect_session.literal_transparency(
            'tools.image_gen__imagegen({transparent_background: true})'))
        self.assertFalse(collect_session.literal_transparency(
            'tools.image_gen__imagegen({"transparent_background": false})'))
        for code in ('tools.image_gen__imagegen({prompt: "x"})',
                     'tools.image_gen__imagegen({transparent_background: true, transparent_background: false})'):
            with self.subTest(code=code),self.assertRaisesRegex(ValueError,'TRANSPARENCY_MODE_UNVERIFIED'):
                collect_session.literal_transparency(code)

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
            (folder/'dispatch.json').write_text(json.dumps(dict(transparentBackground=True)),encoding='utf-8')
            log=home/'sessions'/f'{sid}.jsonl';log.parent.mkdir(parents=True)
            log.write_text(json.dumps(dict(payload=dict(type='custom_tool_call',input=(
                'tools.image_gen__imagegen({prompt: "Exact prompt", num_last_images_to_include: 1, transparent_background: true})'))))+'\n',encoding='utf-8')
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
            self.assertTrue(json.loads((folder/'image-call-audit.json').read_text())['transparentBackgroundVerified'])
            self.assertEqual(json.loads((folder/'image-call-audit.json').read_text())['image'],
                             dict(size=[64,64],mode='RGBA',alphaRange=[0,0]))
            log.write_text(json.dumps(dict(payload=dict(type='custom_tool_call',input=(
                'tools.image_gen__imagegen({prompt: "Exact prompt", num_last_images_to_include: 1, transparent_background: false})'))))+'\n',encoding='utf-8')
            with patch.object(collect_session,'status',return_value=pending), \
                 patch.object(collect_session,'verified',return_value={'digest':submission}), \
                 patch.object(collect_session,'receive') as receive:
                with self.assertRaisesRegex(ValueError,'TRANSPARENCY_MODE_CHANGED'):
                    collect_session.collect(job,home)
            receive.assert_not_called()

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
