"""Offline image concurrency, exact receipts and single-use reservations."""
import _bootstrap
import io
import json
from contextlib import redirect_stdout
from unittest.mock import patch
import unittest

from PIL import Image, ImageDraw
from ai_ui_layers import experimental_executor as exchange, host_delivery as host
from ai_ui_layers.evaluate import read, save, digest
from ai_ui_layers.freeze_visual import freeze
import test_compile_visual as visual_fixtures
import test_host_sheet_fallback as host_fixtures


class ImageDispatchTests(unittest.TestCase):
    def setUp(self):
        visual_fixtures.VisualCompileTests.setUp(self)
        self.snapshot=self.root/'snapshot'
        self.frozen=freeze(self.run,self.snapshot,5)
        self.assets=['asset-panel','asset-buy-button','asset-coin-a','asset-coin-b']
        self.job=self.root/'parallel-job'
        self.config=exchange.prepare(self.snapshot,self.frozen['digest'],self.job,self.assets,
            maximum_concurrent_calls=3)
        self.raw=self.root/'raw.png';Image.new('RGBA',(60,60),(50,100,150,255)).save(self.raw)

    def approve(self):
        exchange.authorize(self.job,self.config['digest'],'Offline PNG fixtures only')

    def test_no_authorization_or_excess_slots_never_reserves(self):
        with self.assertRaisesRegex(ValueError,'NO_RESUBMIT'):
            exchange.next_request(self.job,count=3)
        self.approve()
        for count in (0,True,5,4):
            with self.assertRaises(ValueError):exchange.next_request(self.job,count=count)
            self.assertEqual(list((self.job/'attempts').iterdir()),[])
        batch=exchange.next_request(self.job,count=3)['reservations']
        self.assertEqual(len({r['submissionDigest'] for r in batch}),3)
        before={p: p.read_bytes() for p in (self.job/'attempts').rglob('submission.json')}
        with self.assertRaisesRegex(ValueError,'NO_RESUBMIT'):exchange.next_request(self.job)
        self.assertEqual(before,{p:p.read_bytes() for p in (self.job/'attempts').rglob('submission.json')})

    def test_out_of_order_receipts_free_only_the_matching_slot(self):
        self.approve();batch=exchange.next_request(self.job,count=3)['reservations']
        keys={r['asset'] for r in batch};later=batch.pop(1)
        before=exchange.status(self.job)
        with self.assertRaisesRegex(ValueError,'WRONG_SUBMISSION'):
            exchange.receive(self.job,'0'*64,self.raw)
        self.assertEqual(exchange.status(self.job),before)
        exchange.receive(self.job,later['submissionDigest'],self.raw)
        self.assertEqual(digest(self.job/'attempts'/later['asset']/'raw.png'),digest(self.raw))
        current=exchange.status(self.job)
        self.assertEqual(current['status'],'ready');self.assertEqual(current['availableImageSlots'],1)
        self.assertEqual(set(current['outstandingRequestIds']),{r['asset'] for r in batch})
        with self.assertRaisesRegex(ValueError,'CONCURRENCY_LIMIT'):
            exchange.next_request(self.job,count=2)
        extra=exchange.next_request(self.job);self.assertNotIn(extra['asset'],keys);batch.append(extra)
        with self.assertRaisesRegex(ValueError,'WRONG_SUBMISSION'):
            exchange.receive(self.job,later['submissionDigest'],self.raw)
        for row in reversed(batch):exchange.receive(self.job,row['submissionDigest'],self.raw)
        self.assertEqual(exchange.status(self.job)['status'],'raw_complete')
        self.assertEqual(exchange.status(self.job)['assignedCalls'],4)
        self.assertEqual(exchange.status(self.job)['outstandingRequestIds'],[])
        with self.assertRaisesRegex(ValueError,'NO_RESUBMIT'):exchange.next_request(self.job)

    def test_unknown_result_stops_new_dispatch_but_retains_other_actual_receipts(self):
        self.approve();batch=exchange.next_request(self.job,count=3)['reservations']
        failed=batch.pop(1);exchange.fail(self.job,failed['submissionDigest'],'Unknown tool acceptance')
        self.assertEqual(exchange.status(self.job)['status'],'blocked_no_resubmit')
        self.assertEqual(exchange.status(self.job)['availableImageSlots'],0)
        with self.assertRaisesRegex(ValueError,'NO_RESUBMIT'):exchange.next_request(self.job)
        for row in reversed(batch):exchange.receive(self.job,row['submissionDigest'],self.raw)
        current=exchange.status(self.job)
        self.assertEqual(current['status'],'blocked_no_resubmit');self.assertEqual(current['assignedCalls'],3)
        self.assertEqual(current['requests'][failed['asset']],'failed_no_resubmit')
        self.assertEqual(sum(v=='raw_received' for v in current['requests'].values()),2)
        with self.assertRaisesRegex(ValueError,'NO_PENDING'):
            exchange.receive(self.job,failed['submissionDigest'],self.raw)

    def test_missing_bound_preserves_serial_jobs(self):
        job=self.root/'legacy-job'
        config=exchange.prepare(self.snapshot,self.frozen['digest'],job,self.assets)
        self.assertNotIn('maximumConcurrentCalls',config)
        exchange.authorize(job,config['digest'],'Offline serial fixtures only')
        with self.assertRaisesRegex(ValueError,'CONCURRENCY_LIMIT'):exchange.next_request(job,count=2)
        first=exchange.next_request(job)
        self.assertNotIn('reservations',first)
        self.assertEqual(exchange.status(job)['maximumConcurrentCalls'],1)
        with self.assertRaisesRegex(ValueError,'NO_RESUBMIT'):exchange.next_request(job)

    def test_invalid_bound_rejected_before_output_and_short_final_batch(self):
        for index,limit in enumerate((0,True,5,1.5)):
            output=self.root/('invalid-'+str(index))
            with self.assertRaisesRegex(ValueError,'FINITE_IMAGE_CONCURRENCY'):
                exchange.prepare(self.snapshot,self.frozen['digest'],output,self.assets,
                    maximum_concurrent_calls=limit)
            self.assertFalse(output.exists())
        self.approve()
        first=exchange.next_request(self.job,count=3)['reservations']
        for row in first:exchange.receive(self.job,row['submissionDigest'],self.raw)
        final=exchange.next_request(self.job,count=3)['reservations']
        self.assertEqual(len(final),1)
        exchange.receive(self.job,final[0]['submissionDigest'],self.raw)
        self.assertEqual(exchange.status(self.job)['status'],'raw_complete')


class HostImageDispatchTests(unittest.TestCase):
    setUp=host_fixtures.HostSheetFallbackTests.setUp
    prepare=host_fixtures.HostSheetFallbackTests.prepare

    def raw(self, row):
        if 'materialIds' in row:
            columns,rows=row['grid'];image=Image.new('RGBA',(columns*160,rows*160))
            draw=ImageDraw.Draw(image)
            for index in range(len(row['materialIds'])):
                x=index%columns*160;y=index//columns*160
                draw.rectangle((x+25,y+25,x+135,y+135),fill=(60,90,100,255))
        elif row['asset']=='asset-scene':image=Image.new('RGB',(320,320),(40,50,60))
        else:
            image=Image.new('RGBA',(160,160))
            ImageDraw.Draw(image).rectangle((25,25,135,135),fill=(80,90,100,255))
        path=self.base/(row['asset']+'-fixture.png');image.save(path);return path

    def test_batch_cli_receives_reverse_order_and_prepares_all_independent_reviews(self):
        self.prepare()
        current=host.status(self.run)
        self.assertEqual(read(self.run/'config.json')['maximumConcurrentImageCalls'],3)
        self.assertEqual(current['maximumConcurrentCalls'],3)
        with self.assertRaisesRegex(ValueError,'NO_RESUBMIT'):host.next_request(self.run,count=3)
        host.authorize(self.run,current['scopeDigest'],'Offline image fixtures only')
        before=host._files(self.run)
        with self.assertRaisesRegex(ValueError,'CONCURRENCY_LIMIT'):host.next_request(self.run,count=4)
        self.assertEqual(host._files(self.run),before)
        output=io.StringIO()
        with patch('sys.argv',['ui_layer.py','host-next','--run',str(self.run),'--count','3']),redirect_stdout(output):
            host.main()
        batch=json.loads(output.getvalue())['reservations'];keys=set()
        self.assertEqual(len(batch),3)
        with self.assertRaisesRegex(ValueError,'NO_RESUBMIT'):host.next_request(self.run)
        for entry in reversed(batch):
            row=entry['currentRequest'];keys.add(row['asset'])
            self.assertEqual(row['submissionDigest'],entry['submissionDigest'])
            source=self.raw(row);sha=digest(source)
            host.receive(self.run,entry['submissionDigest'],source)
            self.assertEqual(digest(self.run/'images/attempts'/row['asset']/'raw.png'),sha)
        while host.status(self.run)['stage']=='images':
            current=host.status(self.run)
            batch=host.next_request(self.run,count=min(3,current['availableImageSlots']))
            entries=batch.get('reservations',[dict(currentRequest=batch,submissionDigest=batch.get('submissionDigest'))])
            for entry in reversed(entries):
                row=entry['currentRequest'];self.assertNotIn(row['asset'],keys);keys.add(row['asset'])
                host.receive(self.run,entry['submissionDigest'],self.raw(row))
        self.assertEqual(host.status(self.run)['stage'],'material_review')
        self.assertEqual(keys,set(read(self.run/'images/job.json')['assets']))
        scope=read(self.run/'scopes/material_review/scope.json')
        self.assertEqual(scope['maximumCalls'],len(keys))
        self.assertEqual({r['requestId'] for r in scope['requests']},keys)
        self.assertFalse(host.status(self.run)['humanVisualAcceptance'])

    def test_failed_parallel_image_remains_terminal_without_reservation_replay(self):
        self.prepare();host.authorize(self.run,host.status(self.run)['scopeDigest'],'Offline fixtures only')
        batch=host.next_request(self.run,count=3)['reservations']
        before={p:p.read_bytes() for p in (self.run/'images/attempts').rglob('submission.json')}
        host.fail(self.run,batch[1]['submissionDigest'],'Unknown tool acceptance')
        self.assertEqual(host.status(self.run)['status'],'failed_no_retry')
        with self.assertRaisesRegex(ValueError,'NO_NEXT'):host.next_request(self.run,count=3)
        self.assertEqual(before,{p:p.read_bytes() for p in (self.run/'images/attempts').rglob('submission.json')})

    def test_explicit_serial_and_invalid_host_limit(self):
        self.prepare(maximumConcurrentImageCalls=1)
        self.assertEqual(host.status(self.run)['maximumConcurrentCalls'],1)
        host.authorize(self.run,host.status(self.run)['scopeDigest'],'Offline serial fixtures only')
        first=host.next_request(self.run)
        self.assertNotIn('reservations',first)
        with self.assertRaisesRegex(ValueError,'NO_RESUBMIT'):host.next_request(self.run)
        for index,limit in enumerate((0,True,5)):
            config=read(self.config_path);config['maximumConcurrentImageCalls']=limit
            path=self.base/('invalid-limit-'+str(index)+'.json');save(path,config)
            output=self.base/('invalid-limit-'+str(index))
            with self.assertRaisesRegex(ValueError,'FINITE_IMAGE_CONCURRENCY'):host.prepare(path,output)
            self.assertFalse(output.exists())


if __name__=='__main__':unittest.main()
