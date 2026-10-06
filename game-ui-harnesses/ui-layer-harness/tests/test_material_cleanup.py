"""Offline receipt fixtures only; no image generation or external services."""
import _bootstrap
import json
import hashlib
import unittest
from PIL import Image, ImageDraw

from ai_ui_layers import experimental_executor as ex
from ai_ui_layers import material_cleanup as cleanup
from ai_ui_layers.evaluate import digest, read, save
from ai_ui_layers.freeze_visual import freeze
from test_compile_visual import VisualCompileTests


class MaterialCleanupTests(unittest.TestCase):
    def setUp(self):
        VisualCompileTests.setUp(self)
        self.snapshot=self.root/'snapshot'
        self.frozen=freeze(self.run,self.snapshot,5)
        self.mid='asset-panel';self.source=self.root/'source-job'
        self.make_source(self.snapshot,self.frozen['digest'],self.source,self.mid)

    def make_source(self,snapshot,sha,job,request_id):
        config=ex.prepare(snapshot,sha,job,[request_id])
        ex.authorize(job,config['digest'],'offline fixture approval')
        request=ex.next_request(job)
        _,index=ex.load_job(job);row=index[request_id]
        size=row['outputSize'];image=Image.new('RGBA',size)
        draw=ImageDraw.Draw(image)
        if row.get('kind')=='sheet':
            columns,rows=row['grid'];cw,ch=size[0]//columns,size[1]//rows
            for i,mid in enumerate(row['materialIds']):
                x,y=(i%columns)*cw,(i//columns)*ch
                draw.rectangle((x+10,y+10,x+cw-11,y+ch-11),fill=(40+i,80,120,220))
        else:draw.rectangle((10,10,size[0]-11,size[1]-11),fill=(40,80,120,220))
        raw=self.root/(job.name+'-raw.png');image.save(raw)
        ex.receive(job,request['submissionDigest'],raw)

    def prepare(self,name='cleanup'):
        job=self.root/name
        config=cleanup.prepare_cleanup(self.snapshot,self.frozen['digest'],job,self.mid,self.source)
        return job,config

    def test_frozen_payload_single_use_and_old_job_unchanged(self):
        before={p.relative_to(self.source).as_posix():digest(p) for p in self.source.rglob('*') if p.is_file()}
        job,config=self.prepare()
        self.assertEqual(config['maximumCalls'],1)
        self.assertEqual(config['kind'],'ui_experimental_image_job_v1')
        arguments=ex.frozen_request_arguments(job,config,ex.load_job(job)[1][self.mid])
        self.assertEqual(len(arguments['referenced_image_paths']),2)
        self.assertTrue(arguments['referenced_image_paths'][0].endswith('cleanup-source.png'))
        self.assertIn('removeForeign:',arguments['prompt'])
        self.assertIn('aspect ratio',arguments['prompt'])
        ex.authorize(job,config['digest'],'offline edit fixture approval')
        request=ex.next_request(job)
        with self.assertRaisesRegex(ValueError,'NOT_READY_NO_RESUBMIT'):ex.next_request(job)
        ex.receive(job,request['submissionDigest'],self.source/'attempts'/self.mid/'raw.png')
        from ai_ui_layers.accepted_materials import received
        accepted_raw,accepted_request,lineage=received(job,self.mid,digest(self.snapshot/'reference.png'))
        self.assertEqual(digest(accepted_raw),digest(self.source/'attempts'/self.mid/'raw.png'))
        self.assertEqual(accepted_request['asset'],self.mid)
        self.assertEqual(lineage['jobDigest'],config['digest'])
        with self.assertRaisesRegex(ValueError,'ALREADY_STARTED'):ex.authorize(job,config['digest'],'again')
        self.assertEqual(before,{p.relative_to(self.source).as_posix():digest(p) for p in self.source.rglob('*') if p.is_file()})

    def test_changed_input_and_changed_source_block_before_authorization(self):
        job,config=self.prepare()
        (job/'cleanup/prompt.txt').write_text('changed',encoding='utf-8')
        with self.assertRaisesRegex(ValueError,'CLEANUP_INPUT_CHANGED'):ex.authorize(job,config['digest'],'approval')
        self.assertFalse((job/'authorization.json').exists())
        job2,config2=self.prepare('cleanup2')
        (self.source/'attempts'/self.mid/'raw.png').write_bytes(b'changed')
        with self.assertRaisesRegex(ValueError,'RESULT_CHANGED'):ex.load_job(job2)

    def test_same_origin_is_required(self):
        other=self.root/'other-snapshot'
        self.visual['materials'][0]['label']='different identity'
        (self.run/'m1/draft.json').write_text(json.dumps(self.visual),encoding='utf-8')
        (self.run/'result.json').write_text(json.dumps(dict(sourcePlanSha256=digest(self.run/'m1/draft.json'),
            reviewSha256=digest(self.run/'m2/draft.json'),sameSessionVerified=True,unknownIssueIds=[])),encoding='utf-8')
        request=read(self.run/'m2/request.json');request['sourcePlanSha256']=digest(self.run/'m1/draft.json')
        (self.run/'m2/request.json').write_text(json.dumps(request),encoding='utf-8')
        other_frozen=freeze(self.run,other,5)
        with self.assertRaisesRegex(ValueError,'CLEANUP_SOURCE_PLAN_OR_POLICY_CHANGED'):
            cleanup.prepare_cleanup(other,other_frozen['digest'],self.root/'bad',self.mid,self.source)
        self.assertFalse((self.root/'bad').exists())

    def test_sheet_source_cell_is_exact_and_receipt_bound(self):
        sheet_snapshot=self.root/'sheet-snapshot';sheet_frozen=freeze(self.run,sheet_snapshot,5,generation_mode='sheets')
        row=next(r for r in read(sheet_snapshot/'requests.json')['requests'] if r.get('kind')=='sheet')
        mid=row['materialIds'][0];source=self.root/'sheet-source'
        self.make_source(sheet_snapshot,sheet_frozen['digest'],source,row['asset'])
        job=self.root/'sheet-cleanup'
        config=cleanup.prepare_cleanup(self.snapshot,self.frozen['digest'],job,mid,source,row['asset'])
        lineage=read(job/'cleanup/source-lineage.json')
        self.assertIsNotNone(lineage['sheetSplit'])
        with Image.open(source/'attempts'/row['asset']/'raw.png') as raw, Image.open(job/'cleanup/cleanup-source.png') as cell:
            self.assertEqual(raw.convert('RGBA').crop(lineage['sourceBox']).tobytes(),cell.convert('RGBA').tobytes())
        self.assertEqual(lineage['files']['received.json'],digest(source/'attempts'/row['asset']/'received.json'))
        ex.load_job(job)

    def test_indeterminate_cleanup_never_resubmits(self):
        job,config=self.prepare();ex.authorize(job,config['digest'],'offline fixture approval')
        request=ex.next_request(job);ex.fail(job,request['submissionDigest'],'fixture unknown receipt')
        with self.assertRaisesRegex(ValueError,'NOT_READY_NO_RESUBMIT'):ex.next_request(job)

    def test_interrupted_preparation_cannot_authorize_or_dispatch_ordinary_job(self):
        from unittest.mock import patch
        job=self.root/'interrupted-cleanup'
        with patch.object(cleanup,'save',side_effect=OSError('fixture disk interruption')):
            with self.assertRaisesRegex(OSError,'fixture disk interruption'):
                cleanup.prepare_cleanup(self.snapshot,self.frozen['digest'],job,self.mid,self.source)
        config=read(job/'job.json')
        self.assertEqual(config['cleanupRequired'],self.mid)
        for action in (lambda:ex.load_job(job),
                       lambda:ex.authorize(job,config['digest'],'fixture approval'),
                       lambda:ex.next_request(job)):
            with self.assertRaisesRegex(ValueError,'CLEANUP_PREPARATION_INCOMPLETE'):action()
        self.assertFalse((job/'authorization.json').exists())
        self.assertEqual(list((job/'attempts').iterdir()),[])

    def test_reuse_and_background_policy_changes_are_not_same_origin(self):
        manifest=read(self.snapshot/'snapshot.json')
        for key in ('materialReusePolicy','materialReuseSha256','generatedMaterialCount',
                    'backgroundRegionPolicy','backgroundRegionDigest','backgroundRegionMaterialId'):
            changed={**manifest,key:'changed fixture policy'}
            with self.assertRaisesRegex(ValueError,'CLEANUP_SOURCE_PLAN_OR_POLICY_CHANGED'):
                cleanup._same_origin(self.snapshot,changed,self.snapshot,manifest)

    def test_public_cleanup_preparation_has_no_compute_or_authorization(self):
        import io
        from contextlib import redirect_stdout
        from unittest.mock import patch
        from ai_ui_layers.delivery_dag import main
        job=self.root/'public-cleanup';stdout=io.StringIO()
        args=['ui_layer.py','prepare-material-cleanup','--snapshot',str(self.snapshot),
            '--snapshot-digest',self.frozen['digest'],'--output',str(job),
            '--material-id',self.mid,'--received-job',str(self.source)]
        with patch('sys.argv',args),redirect_stdout(stdout):main()
        self.assertEqual(json.loads(stdout.getvalue())['maximumCalls'],1)
        self.assertFalse((job/'authorization.json').exists())
        self.assertEqual(ex.status(job)['status'],'awaiting_authorization')
        with patch('sys.argv',args+['--context-prompt-version','v7']),self.assertRaises(SystemExit):main()

    def test_direct_delete_prompt_covers_every_foreign_member_without_appearance_prose(self):
        job,config=self.prepare()
        inputs=read(job/'cleanup/inputs.json');prompt=(job/'cleanup/prompt.txt').read_text(encoding='utf-8')
        self.assertEqual(config['cleanup']['promptVersion'],cleanup.PROMPT_VERSION)
        self.assertEqual(prompt.count('- DELETE '),len(inputs['removeForeign']))
        for item in inputs['removeForeign']:
            self.assertIn('['+item['materialId']+'/'+item['objectId']+']',prompt)
        for item in inputs['ownedOnly']:
            self.assertIn('- KEEP '+item['objectId']+': '+item['appearance'],prompt)
        self.assertIn('Do not copy its foreign children',prompt)
        altered=json.loads(json.dumps(inputs))
        for item in altered['removeForeign']:
            item['appearance']='FOREIGN_APPEARANCE_MUST_NOT_BE_A_DRAWING_INSTRUCTION; preserve shiny details. '*30
        # Foreign descriptions remain complete in frozen inputs but cannot affect
        # the new drawing prompt or make it request those visual details.
        self.assertEqual(cleanup._prompt(altered,cleanup.PROMPT_VERSION),prompt)
        self.assertLess(len(prompt),len(cleanup._prompt(altered)))
        self.assertNotIn('FOREIGN_APPEARANCE_MUST_NOT',prompt)

    def test_generic_foreign_identifiers_are_word_split_and_not_sample_specific(self):
        inputs=dict(sourceSize=[80,60],contextGeometry=dict(targetBox=[1,2,79,58],referenceSize=[80,60]),
            ownershipRegion=[0,0,80,60],preserveText=[],
            ownedOnly=[dict(objectId='frame',appearance='owned wood')],
            removeForeign=[dict(materialId='controlCluster',objectId='confirmButton',appearance='foreign metal'),
                           dict(materialId='controlCluster',objectId='counter-badge_2',appearance='foreign glass')])
        prompt=cleanup._prompt(inputs,cleanup.PROMPT_VERSION)
        self.assertIn('- DELETE confirm Button [controlCluster/confirmButton].',prompt)
        self.assertIn('- DELETE counter badge 2 [controlCluster/counter-badge_2].',prompt)
        self.assertNotIn('foreign metal',prompt);self.assertNotIn('foreign glass',prompt)

    def test_historical_prompt_bytes_and_job_without_version_replay(self):
        inputs=dict(sourceSize=[80,60],contextGeometry=dict(targetBox=[1,2,79,58],referenceSize=[80,60]),
            ownershipRegion=[0,0,80,60],preserveText=[],
            ownedOnly=[dict(objectId='frame',appearance='owned wood')],
            removeForeign=[dict(materialId='child',objectId='child_card',appearance='foreign metal')])
        self.assertEqual(hashlib.sha256(cleanup._prompt(inputs).encode('utf-8')).hexdigest(),
                         '6b4edfe6257ea2525e70abe6efeffcee3804d946697b9d7b0e072095319b118a')
        job,config=self.prepare();real_inputs=read(job/'cleanup/inputs.json')
        legacy_prompt=cleanup._prompt(real_inputs)
        # Only this unapproved offline fixture is constructed in the legacy
        # format; no real frozen job is migrated or rewritten by production.
        (job/'cleanup/prompt.txt').write_text(legacy_prompt,encoding='utf-8')
        config={k:v for k,v in config.items() if k!='digest'}
        config['cleanup'].pop('promptVersion')
        config['cleanup']['files']['prompt.txt']=digest(job/'cleanup/prompt.txt')
        from ai_ui_layers.freeze_visual import body_digest
        config['digest']=body_digest(config)
        (job/'job.json').write_text(json.dumps(config),encoding='utf-8')
        loaded,index=ex.load_job(job)
        self.assertEqual(ex.frozen_request_arguments(job,loaded,index[self.mid])['prompt'],legacy_prompt.rstrip('\n'))

    def test_catalog_tamper_and_unknown_prompt_version_are_rejected(self):
        job,config=self.prepare();inputs=read(job/'cleanup/inputs.json')
        inputs['removeForeign'].pop()
        (job/'cleanup/inputs.json').write_text(json.dumps(inputs),encoding='utf-8')
        with self.assertRaisesRegex(ValueError,'CLEANUP_INPUT_CHANGED'):
            ex.authorize(job,config['digest'],'offline fixture approval')
        other,other_config=self.prepare('unknown-version')
        _,index=ex.load_job(other)
        other_config['cleanup']['promptVersion']='unknown-future-version'
        with self.assertRaisesRegex(ValueError,'CLEANUP_PROMPT_VERSION'):
            cleanup.verify_cleanup(other,other_config,index)


class ReusedMaterialCleanupTests(unittest.TestCase):
    sheet=False

    def setUp(self):
        from test_reuse_host_delivery import ReusedDeliveryTests
        ReusedDeliveryTests.setUp(self)
        ReusedDeliveryTests.planning(self)
        self.snapshot=self.run/'frozen';self.frozen=read(self.snapshot/'snapshot.json')
        self.source=self.run/'images';self.mid='asset-panel'
        config,index=ex.load_job(self.source)
        backgrounds={a['id'] for a in read(self.snapshot/'execution-plan.candidate.json')['assets']
                     if a['role']=='background'}
        ex.authorize(self.source,config['digest'],'offline source fixture approval')
        while ex.status(self.source)['status']=='ready':
            request=ex.next_request(self.source);size=index[request['asset']]['outputSize']
            background=request['asset'] in backgrounds
            image=Image.new('RGBA',size,(40,80,120,255) if background else (0,0,0,0))
            draw=ImageDraw.Draw(image);row=index[request['asset']]
            if row.get('kind')=='sheet':
                columns,rows=row['grid'];cw,ch=size[0]//columns,size[1]//rows
                for i in range(len(row['materialIds'])):
                    x,y=(i%columns)*cw,(i//columns)*ch
                    draw.rectangle((x+10,y+10,x+cw-11,y+ch-11),fill=(40,80,120,220))
            else:draw.rectangle((10,10,size[0]-11,size[1]-11),fill=(40,80,120,255 if background else 220))
            raw=self.base/'source-fixture.png';image.save(raw)
            ex.receive(self.source,request['submissionDigest'],raw)

    def test_genuine_single_cleanup_preserves_reuse_snapshot_and_source_chain(self):
        before={p.relative_to(self.source).as_posix():digest(p) for p in self.source.rglob('*') if p.is_file()}
        job=self.base/'reuse-cleanup'
        config=cleanup.prepare_cleanup(self.snapshot,self.frozen['digest'],job,self.mid,self.source)
        self.assertEqual(config['cleanupRequired'],self.mid)
        self.assertEqual(config['materialReuseSha256'],self.frozen['materialReuseSha256'])
        self.assertEqual(ex.status(job)['status'],'awaiting_authorization')
        ex.authorize(job,config['digest'],'offline edit fixture approval')
        request=ex.next_request(job)
        ex.receive(job,request['submissionDigest'],self.source/'attempts'/self.mid/'raw.png')
        self.assertEqual(ex.status(job)['status'],'raw_complete')
        self.assertEqual(before,{p.relative_to(self.source).as_posix():digest(p) for p in self.source.rglob('*') if p.is_file()})

    def test_ordinary_subset_and_incomplete_cleanup_are_both_unusable(self):
        with self.assertRaisesRegex(ValueError,'REUSE_VARIANTS_UNSUPPORTED'):
            ex.prepare(self.snapshot,self.frozen['digest'],self.base/'ordinary-subset',[self.mid])
        self.assertFalse((self.base/'ordinary-subset').exists())
        job=self.base/'incomplete-reuse-cleanup'
        config=ex.prepare(self.snapshot,self.frozen['digest'],job,[self.mid],_cleanup_material_id=self.mid)
        with self.assertRaisesRegex(ValueError,'CLEANUP_PREPARATION_INCOMPLETE'):
            ex.authorize(job,config['digest'],'fixture approval')
        # A forged subset with a newly computed record digest still cannot take
        # the ordinary acquisition path through load_job.
        body={k:v for k,v in config.items() if k not in ('digest','cleanupRequired')}
        from ai_ui_layers.freeze_visual import body_digest
        (job/'job.json').write_text(json.dumps({**body,'digest':body_digest(body)}),encoding='utf-8')
        with self.assertRaisesRegex(ValueError,'REUSE_VARIANTS_UNSUPPORTED'):ex.next_request(job)
        self.assertFalse((job/'authorization.json').exists())
        self.assertEqual(list((job/'attempts').iterdir()),[])


if __name__=='__main__':unittest.main()
