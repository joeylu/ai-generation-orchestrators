"""Offline receipt fixtures only; no image generation or external services."""
import _bootstrap
import json
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


if __name__=='__main__':unittest.main()
