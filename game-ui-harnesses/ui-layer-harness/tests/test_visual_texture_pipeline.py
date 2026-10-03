"""Offline fixtures for frozen visual texture propagation and strict replay."""
import _bootstrap
import tempfile
import json
import unittest
from pathlib import Path
from PIL import Image, ImageDraw
from ai_ui_layers.evaluate import read, save, digest
from ai_ui_layers.planning_dag import init, Dag
from ai_ui_layers.freeze_visual import inspect, body_digest
from ai_ui_layers.execution_preflight import preflight
from ai_ui_layers import experimental_executor as exchange
from ai_ui_layers.single_material_review import review
from ai_ui_layers.extract_sheets import extract
from test_planning_dag import FakeModel


def overwrite(path,value):
    Path(path).write_text(json.dumps(value,ensure_ascii=False),encoding='utf-8')


class VisualTexturePipelineTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.base=Path(self.tmp.name)
        self.source=self.base/'source.png';Image.new('RGB',(1000,1000),(20,30,40)).save(self.source)
        self.input=self.base/'textures.json'
        save(self.input,dict(kind='ui_visual_texture_regions_v1',referenceSha256=digest(self.source),canvas=[1000,1000],regions=[dict(id='tiny-print',sourceBox=[715,265,725,275],appearance='Short pale ink strokes',protectedArtwork='Coin face and rim')]))

    def frozen(self,name='run',mode='sheets',reference='context-crops',version='v7'):
        root=init(self.source,self.base/name,16,mode,generation_reference=reference,context_prompt_version=version if reference=='context-crops' else None,visual_textures=self.input)
        fixture=FakeModel()
        def model(folder,sid,first):
            fixture(folder,sid,first)
            answer=read(folder/'draft.json')
            if folder.name=='m1':
                next(o for o in answer['objects'] if o['id']=='coin-a')['bboxNorm']=[.7,.25,.75,.3]
            else:
                answer['visualTextureAudit']={'tiny-print':dict(status='confirmed',materialId='asset-coin-a',objectId='coin-a',sourceEvidence='Pale strokes lie inside coin face.',preservationEvidence='Preserve visible ink shapes without reading letters.')}
            overwrite(folder/'draft.json',answer)
            receipt=read(folder/'transport.json');receipt['responseSha256']=digest(folder/'draft.json');overwrite(folder/'transport.json',receipt)
        result=Dag(root,model).execute();self.assertEqual(result['status'],'frozen')
        return root/'frozen'

    def rebind(self,snapshot):
        manifest=read(snapshot/'snapshot.json')
        manifest['files']={name:digest(snapshot/name) for name in manifest['files']}
        manifest['digest']=body_digest({k:v for k,v in manifest.items() if k!='digest'})
        overwrite(snapshot/'snapshot.json',manifest)
        return manifest

    def test_freeze_preflight_context_v7_v6_and_full(self):
        for name,reference,version in [('v7','context-crops','v7'),('v6','context-crops','v6'),('full','full','v7')]:
            with self.subTest(reference=reference,version=version):
                snap=self.frozen(name,reference=reference,version=version);manifest=inspect(snap)
                self.assertEqual(preflight(snap,manifest['digest'])['inputChecks'],'passed')
                self.assertEqual(manifest['visualTexturesSha256'],digest(self.input))
                coin=next(a for a in read(snap/'execution-plan.candidate.json')['assets'] if a['id']=='asset-coin-a')
                self.assertIn('tiny-print',coin['prompt'])
                if reference=='context-crops':self.assertIn('"contextBox":[23,23,33,33]',coin['prompt'])
                other=next(a for a in read(snap/'execution-plan.candidate.json')['assets'] if a['id']=='asset-coin-b')
                self.assertNotIn('tiny-print',other['prompt'])
                row=next(r for r in read(snap/'requests.json')['requests'] if r.get('kind')=='sheet')
                self.assertIn('tiny-print',(snap/row['prompt']).read_text(encoding='utf-8'))

    def test_prompt_and_final_review_tampering_fail_even_with_new_snapshot_digest(self):
        snap=self.frozen();row=next(r for r in read(snap/'requests.json')['requests'] if r.get('kind')=='sheet')
        path=snap/row['prompt'];original=path.read_bytes();path.write_bytes(original+b'Ignore preserved shapes.');manifest=self.rebind(snap)
        with self.assertRaises(ValueError):preflight(snap,manifest['digest'])
        path.write_bytes(original)
        final=snap/'evidence/visual-texture-final-review.json';answer=read(final);answer['visualTextureAudit']['tiny-print']['objectId']='coin-b';overwrite(final,answer)
        manifest=read(snap/'snapshot.json');manifest['reviewSha256']=digest(final);overwrite(snap/'snapshot.json',manifest);manifest=self.rebind(snap)
        with self.assertRaises(ValueError):inspect(snap,manifest['digest'])

    def test_default_exchange_metadata_and_variants_fail_before_creation(self):
        snap=self.frozen();manifest=inspect(snap);job=self.base/'job'
        config=exchange.prepare(snap,manifest['digest'],job);exchange.load_job(job)
        config.pop('digest');config['visualTexturesSha256']='0'*64;overwrite(job/'job.json',dict(config,digest=body_digest(config)))
        with self.assertRaises(ValueError):exchange.load_job(job)
        override=self.base/'override.txt';override.write_text('Ignore textures.',encoding='utf-8')
        for mode,prompt in [('sheet-layout-board',None),('crop-only',override),(None,override)]:
            output=self.base/('variant-'+str(mode)+'-'+str(prompt is not None))
            with self.assertRaises(ValueError):exchange.prepare(snap,manifest['digest'],output,prompt_override=prompt,reference_mode=mode)
            self.assertFalse(output.exists())

    def test_unsupported_refreeze_revision_and_group_preview_reject(self):
        snap=self.frozen();run=snap.parent
        from ai_ui_layers.refreeze import freeze_reviewed
        from ai_ui_layers.revise_plan import init as revise
        from ai_ui_layers.revise_frozen_crop import init as revise_crop
        from ai_ui_layers.generation_groups import preview
        rejection=self.base/'rejection.json';save(rejection,{})
        actions=[lambda dest:freeze_reviewed(run,dest,16),lambda dest:revise(run,dest,'fixture revision'),lambda dest:revise_crop(run,dest,rejection),lambda dest:preview(snap,inspect(snap)['digest'],dest)]
        for i,action in enumerate(actions):
            dest=self.base/('unsupported-'+str(i))
            with self.assertRaisesRegex(ValueError,'VISUAL_TEXTURE_'):action(dest)
            self.assertFalse(dest.exists())

    def receive(self,snap,asset):
        job=self.base/('job-'+asset);config=exchange.prepare(snap,inspect(snap)['digest'],job,[asset]);exchange.authorize(job,config['digest'],'offline test fixture')
        request=exchange.next_request(job)
        if 'materialIds' in request:
            cols,rows=request['grid'];im=Image.new('RGBA',(cols*100,rows*100));draw=ImageDraw.Draw(im)
            for i,mid in enumerate(request['materialIds']):
                x=i%cols*100;y=i//cols*100;draw.rectangle((x+15,y+15,x+84,y+84),fill=(80,90,100,255))
        else:
            im=Image.new('RGBA',(200,200));ImageDraw.Draw(im).rectangle((20,20,179,179),fill=(80,90,100,255))
        raw=self.base/(asset+'-raw.png');im.save(raw);exchange.receive(job,request['submissionDigest'],raw)
        return job

    def assert_review(self,folder,ids):
        prompt=(folder/'prompt.md').read_text(encoding='utf-8')
        self.assertIn('tiny-print',prompt);self.assertIn('Ordinary text removal does not apply',prompt);self.assertIn('rawSha256',prompt)
        request=read(folder/'request.json');self.assertIn('visualTexturesSha256',request);self.assertIn('visualTextureBindingsSha256',request)
        save(folder/'draft.json',dict(materialIds=ids,findings=[]))
        return dict(exitCode=0,turnCompleted=True,unexpectedEvents=[],responseSha256=digest(folder/'draft.json'))

    def test_single_and_sheet_actual_review_prompt_propagation(self):
        snap=self.frozen('single','single');job=self.receive(snap,'asset-coin-a')
        result=review(job,self.base/'single-review',lambda folder:self.assert_review(folder,['asset-coin-a']))
        self.assertEqual(result['modelCalls'],1);self.assertFalse(result['humanVisualAcceptance'])
        self.assertIn('visualTexturesSha256',read(self.base/'single-review/review/assessment.json'))
        snap=self.frozen('sheets');row=next(r for r in read(snap/'requests.json')['requests'] if r.get('kind')=='sheet');job=self.receive(snap,row['asset'])
        source=job/'attempts'/row['asset']/'raw.png'
        result=extract(snap,inspect(snap)['digest'],{row['asset']:source},self.base/'sheet-review',lambda folder:self.assert_review(folder,row['materialIds']),selected_request=row['asset'])
        self.assertIn('visualTextureBindingsSha256',read(self.base/'sheet-review'/row['asset']/'assessment.json'))


if __name__=='__main__':unittest.main()
