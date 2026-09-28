import _bootstrap
from contextlib import ExitStack
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from PIL import Image
from ai_ui_layers import collect_session as collector
from ai_ui_layers import frozen_image_arguments as relay
from ai_ui_layers.evaluate import digest


class FrozenRelayCollectionTests(unittest.TestCase):
    def fixture(self, root, sheet=True, transparency=True):
        job=root/'job';home=root/'home';asset='synthetic-sheet' if sheet else 'synthetic-material'
        submission='synthetic-submission';sid='synthetic-session'
        snapshot=job/'snapshot';snapshot.mkdir(parents=True)
        prompt=('图标 "引用" `刻度` ${原样} \\路径\n'*220)+'[{"edge":"浅色"}]'
        (snapshot/'prompt.txt').write_text(prompt,encoding='utf-8')
        row=dict(asset=asset,prompt='prompt.txt',reference='reference.png')
        if sheet:row.update(kind='sheet',materialIds=['a','b'])
        (snapshot/'execution-plan.candidate.json').write_text(json.dumps(dict(assets=[
            dict(id=asset,output_mode='keyed_component' if transparency else 'opaque_canvas',
                 role='foreground' if transparency else 'background',output_size=[64,64])])),encoding='utf-8')
        (snapshot/'placements.json').write_text(json.dumps(dict(materials=[dict(id=asset)])),encoding='utf-8')
        folder=job/'generation-sessions'/submission;folder.mkdir(parents=True)
        request=dict(asset=asset,submissionDigest=submission,arguments=dict(prompt=prompt,
            referenced_image_paths=[str(snapshot/'reference.png')]))
        if sheet:request['materialIds']=row['materialIds']
        def write(path,value):path.write_text(json.dumps(value,ensure_ascii=False),encoding='utf-8')
        write(folder/'tool-request.json',request)
        write(folder/'session-result.json',dict(exitCode=0,sessionIds=[sid],submissionDigest=submission,elapsedSeconds=1))
        sha=relay.prepare(folder,request,transparency)
        server=relay.ArgumentServer(folder/'frozen-image-arguments.json',sha);server.initialized=True
        server.handle(dict(method='tools/call',params={'name':relay.TOOL,'arguments':{}}))
        dispatch=dict(argumentTransport=relay.TRANSPORT,transparentBackground=transparency,
            imageArgumentsSha256=sha,toolRequestSha256=digest(folder/'tool-request.json'),
            argumentServerSha256=digest(Path(relay.__file__)))
        write(folder/'dispatch.json',dispatch)
        log=home/'sessions'/f'{sid}.jsonl';log.parent.mkdir(parents=True)
        event=dict(payload=dict(type='custom_tool_call',name='exec',input=relay.RELAY_CODE))
        write(log,event)
        image=home/'generated_images'/sid/'output.png';image.parent.mkdir(parents=True)
        Image.new('RGBA',(64,64),(10,20,30,128)).save(image)
        stack=ExitStack();self.addCleanup(stack.close)
        stack.enter_context(patch.object(collector,'status',return_value=dict(status='awaiting_result',
            requests={asset:'awaiting_result_no_resubmit'})))
        stack.enter_context(patch.object(collector,'verified',return_value={'digest':submission}))
        stack.enter_context(patch.object(collector,'load_job',return_value=({'referenceMode':'full-only'},{asset:row})))
        receive=stack.enter_context(patch.object(collector,'receive',return_value={'digest':'synthetic-receipt'}))
        process=stack.enter_context(patch.object(collector,'process',return_value={'status':'passed','issues':[]}))
        return dict(job=job,home=home,folder=folder,log=log,event=event,request=request,
                    dispatch=dispatch,write=write,receive=receive,process=process,image=image)

    def test_bound_relay_receives_exact_unicode_and_defers_sheet_extraction(self):
        with tempfile.TemporaryDirectory() as tmp:
            f=self.fixture(Path(tmp));result=collector.collect(f['job'],f['home'])
            self.assertEqual(result['postprocess'],'deferred_to_sheet_extraction')
            f['process'].assert_not_called()
            f['receive'].assert_called_once_with(f['job'],'synthetic-submission',f['image'])
            audit=json.loads((f['folder']/'image-call-audit.json').read_text(encoding='utf-8'))
            self.assertTrue(audit['exactPromptMatch'])
            self.assertTrue(audit['transparentBackgroundVerified'])
            self.assertEqual(audit['argumentsSha256'],relay.fingerprint(relay.tool_arguments(f['request'],True)))

    def test_single_materials_keep_existing_postprocess_and_background_modes(self):
        for transparency in (True,False):
            with self.subTest(transparency=transparency),tempfile.TemporaryDirectory() as tmp:
                f=self.fixture(Path(tmp),sheet=False,transparency=transparency)
                result=collector.collect(f['job'],f['home'])
                self.assertEqual(result['postprocess'],'passed')
                self.assertEqual(f['process'].call_args.kwargs['background'],not transparency)
                audit=json.loads((f['folder']/'image-call-audit.json').read_text(encoding='utf-8'))
                self.assertEqual(audit['transparentBackgroundVerified'],transparency)

    def test_changed_or_unproven_relay_never_receives_png(self):
        cases=('code-mutation','extra-exec','missing-read','changed-read','changed-server',
               'changed-payload','changed-request','changed-reference','changed-count',
               'changed-transparency','unknown-transport','removed-transport')
        for case in cases:
            with self.subTest(case=case),tempfile.TemporaryDirectory() as tmp:
                f=self.fixture(Path(tmp));folder=f['folder'];write=f['write']
                if case=='code-mutation':
                    f['event']['payload']['input']=relay.RELAY_CODE.replace(
                        'const result','frozen.structuredContent.prompt += "extra";\nconst result')
                    write(f['log'],f['event'])
                elif case=='extra-exec':
                    extra=dict(payload=dict(type='custom_tool_call',name='exec',input='tools["image_gen__imagegen"]({});'))
                    f['log'].write_text(json.dumps(f['event'])+'\n'+json.dumps(extra),encoding='utf-8')
                elif case=='missing-read':(folder/'frozen-arguments-read.json').unlink()
                elif case=='changed-read':write(folder/'frozen-arguments-read.json',{'submissionDigest':'other'})
                elif case=='changed-server':f['dispatch']['argumentServerSha256']='0'*64
                elif case in ('changed-payload','changed-count'):
                    payload=json.loads((folder/'frozen-image-arguments.json').read_text(encoding='utf-8'))
                    if case=='changed-payload':payload['arguments']['prompt']=payload['arguments']['prompt'][:-1]
                    else:payload['arguments']['num_last_images_to_include']=2
                    write(folder/'frozen-image-arguments.json',payload)
                    # Even repinning changed data cannot override the frozen source.
                    f['dispatch']['imageArgumentsSha256']=digest(folder/'frozen-image-arguments.json')
                elif case in ('changed-request','changed-reference'):
                    if case=='changed-request':f['request']['arguments']['prompt']=f['request']['arguments']['prompt'][:-1]
                    else:f['request']['arguments']['referenced_image_paths']=['other.png']
                    write(folder/'tool-request.json',f['request'])
                    f['dispatch']['toolRequestSha256']=digest(folder/'tool-request.json')
                elif case=='changed-transparency':f['dispatch']['transparentBackground']=False
                elif case=='unknown-transport':f['dispatch']['argumentTransport']='unknown'
                elif case=='removed-transport':del f['dispatch']['argumentTransport']
                write(folder/'dispatch.json',f['dispatch'])
                with self.assertRaises((ValueError,OSError)):
                    collector.collect(f['job'],f['home'])
                f['receive'].assert_not_called();f['process'].assert_not_called()
                self.assertFalse((folder/'image-call-audit.json').exists())

    def test_legacy_missing_final_bracket_still_rejects_prompt_changed(self):
        with tempfile.TemporaryDirectory() as tmp:
            f=self.fixture(Path(tmp))
            (f['folder']/'frozen-image-arguments.json').unlink()
            (f['folder']/'frozen-arguments-read.json').unlink()
            f['write'](f['folder']/'dispatch.json',dict(transparentBackground=True))
            f['event']['payload']['input']='tools.image_gen__imagegen({prompt: '+json.dumps(
                f['request']['arguments']['prompt'][:-1])+', num_last_images_to_include: 1, transparent_background: true})'
            f['write'](f['log'],f['event'])
            with self.assertRaisesRegex(ValueError,'PROMPT_CHANGED'):
                collector.collect(f['job'],f['home'])
            f['receive'].assert_not_called()


if __name__=='__main__':unittest.main()
