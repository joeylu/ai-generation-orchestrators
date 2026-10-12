"""Rolling scheduling with controlled async completions and a real host receipt."""
import _bootstrap
import asyncio
from contextlib import redirect_stdout
import io
import json
from pathlib import Path
import threading
import unittest
from unittest.mock import patch

from ai_ui_layers import host_image_dispatch as dispatch, host_delivery as host
from ai_ui_layers.evaluate import digest
import test_image_dispatch as fixtures
import test_composite_review as composite_fixtures


class FakeHost:
    def __init__(self):
        self.assigned=[];self.received=[];self.failed=[];self.pending=[]

    def status(self,run):
        return dict(stage='failed' if self.failed else 'images',status='ready',
                    outstandingRequestIds=list(self.pending),availableImageSlots=3-len(self.pending))

    def next_request(self,run,*,count=1):
        rows=[]
        for _ in range(min(count,5-len(self.assigned))):
            key=str(len(self.assigned));self.assigned.append(key);self.pending.append(key)
            rows.append(dict(asset=key,submissionDigest=key,arguments={'prompt':'unchanged-'+key}))
        if count==1:return rows[0]
        return {'reservations':[dict(currentRequest=r,submissionDigest=r['submissionDigest']) for r in rows]}

    def receive(self,run,digest,source,*,refill_images=False):
        self.pending.remove(digest);self.received.append(digest)
        state=self.status(run)
        if refill_images and len(self.assigned)<5:state['nextImageRequest']=self.next_request(run)
        if len(self.received)==5:state.update(stage='composite_review',status='awaiting_authorization')
        return state

    def fail(self,run,digest,reason):
        self.failed.append(digest);return self.status(run)


class RollingImageDispatchTests(unittest.IsolatedAsyncioTestCase):
    async def test_refills_before_slow_calls_finish_and_preserves_arguments(self):
        fake=FakeHost();slow=asyncio.Event();started=[]
        async def invoke(row):
            key=row['asset'];started.append(key)
            self.assertEqual(row['arguments'],{'prompt':'unchanged-'+key})
            if key in ('0','1'):await slow.wait()
            if key=='4':slow.set()
            return Path('original-'+key+'.png')
        with patch.object(dispatch,'host',fake):result=await dispatch.run_images('fixture',invoke)
        self.assertEqual(started,['0','1','2','3','4'])
        self.assertEqual(fake.received[:2],['2','3'])
        self.assertEqual(len(set(fake.assigned)),5)
        self.assertEqual(result['maximumObservedConcurrentCalls'],3)
        self.assertEqual(result['automaticRetries'],0)
        self.assertEqual(result['state']['stage'],'composite_review')
        self.assertNotIn('dispatchTimings',result)

    async def test_opt_in_timings_expose_returned_results_waiting_for_serial_receipts(self):
        fake=FakeHost();committing=asyncio.Event();release=threading.Event()
        loop=asyncio.get_running_loop();original=fake.receive
        def receive(*args,**kwargs):
            if args[1]=='2':
                loop.call_soon_threadsafe(committing.set)
                if not release.wait(5):raise AssertionError('fixture completion timeout')
            return original(*args,**kwargs)
        fake.receive=receive
        async def invoke(row):
            if row['asset'] in ('0','1'):await committing.wait()
            if row['asset']=='1':release.set()
            return Path('original-'+row['asset']+'.png')
        with patch.object(dispatch,'host',fake):
            result=await dispatch.run_images('fixture',invoke,capture_timings=True)
        report=result['dispatchTimings'];rows={r['submissionDigest']:r for r in report['records']}
        self.assertEqual(set(rows),{'0','1','2','3','4'})
        for key in ('0','1'):
            self.assertLessEqual(rows[key]['adapterFinishedAtSeconds'],rows['2']['receiptFinishedAtSeconds'])
            self.assertGreaterEqual(rows[key]['receiptStartedAtSeconds'],rows['2']['receiptFinishedAtSeconds'])
            self.assertGreater(rows[key]['receiptQueueSeconds'],0)
        for row in rows.values():
            self.assertGreaterEqual(row['adapterWaitSeconds'],0)
            self.assertEqual(row['receiptOutcome'],'committed')
            if 'refillStartDelaySeconds' in row:self.assertGreaterEqual(row['refillStartDelaySeconds'],0)
        self.assertEqual(report['maximumAdapterCallsAwaitingReturn'],3)
        self.assertLessEqual(report['adapterWaitUnionSeconds'],report['adapterWaitSumSeconds'])
        self.assertFalse(report['overlappingCategoriesAddToWallTime'])
        self.assertFalse(report['persistedInHostRun'])

    async def test_timing_capture_does_not_retry_failed_adapters_or_add_refills(self):
        fake=FakeHost();released=asyncio.Event()
        async def invoke(row):
            if row['asset']=='2':released.set();raise RuntimeError('unknown acceptance')
            await released.wait();return Path('original-'+row['asset']+'.png')
        with patch.object(dispatch,'host',fake):
            result=await dispatch.run_images('fixture',invoke,capture_timings=True)
        self.assertEqual(fake.assigned,['0','1','2'])
        report=result['dispatchTimings']
        self.assertEqual(len(report['records']),3)
        self.assertEqual(next(r for r in report['records'] if r['submissionDigest']=='2')['adapterOutcome'],
                         'failed_or_cancelled')
        self.assertEqual(report['automaticRetries'],0)

    async def test_non_boolean_timing_option_stops_before_reservation(self):
        fake=FakeHost()
        with patch.object(dispatch,'host',fake):
            with self.assertRaisesRegex(ValueError,'TIMING_BOOLEAN'):
                await dispatch.run_images('fixture',None,capture_timings=1)
        self.assertFalse(fake.assigned)

    async def test_failure_stops_refill_and_drains_original_inflight_results(self):
        fake=FakeHost();released=asyncio.Event()
        async def invoke(row):
            if row['asset']=='2':released.set();raise RuntimeError('unknown acceptance')
            await released.wait();return Path('original-'+row['asset']+'.png')
        with patch.object(dispatch,'host',fake):result=await dispatch.run_images('fixture',invoke)
        self.assertEqual(fake.assigned,['0','1','2']);self.assertEqual(fake.failed,['2'])
        self.assertEqual(set(fake.received),{'0','1'})
        self.assertEqual(result['failedSubmissionDigests'],['2'])

    async def test_existing_reservation_cannot_be_reinvoked(self):
        fake=FakeHost();fake.pending=['old']
        with patch.object(dispatch,'host',fake):
            with self.assertRaisesRegex(ValueError,'OUTSTANDING_IMAGES'):
                await dispatch.run_images('fixture',None)
        self.assertFalse(fake.assigned)

    async def test_failure_during_receipt_verification_prevents_refill_invocation(self):
        fake=FakeHost();committing=asyncio.Event();release=threading.Event();started=[]
        loop=asyncio.get_running_loop();original=fake.receive
        def receive(*args,**kwargs):
            if args[1]=='2':
                loop.call_soon_threadsafe(committing.set)
                if not release.wait(5):raise AssertionError('fixture completion timeout')
            return original(*args,**kwargs)
        fake.receive=receive
        async def invoke(row):
            key=row['asset'];started.append(key)
            if key in ('0','1'):await committing.wait()
            if key=='0':release.set();raise RuntimeError('unknown acceptance')
            return Path('original-'+key+'.png')
        with patch.object(dispatch,'host',fake):result=await dispatch.run_images('fixture',invoke)
        self.assertEqual(started,['0','1','2'])
        self.assertEqual(result['uninvokedReservationDigests'],['3'])
        self.assertEqual(fake.failed,['0'])


class HostRefillTests(unittest.TestCase):
    setUp=fixtures.HostImageDispatchTests.setUp
    prepare=fixtures.HostImageDispatchTests.prepare
    raw=fixtures.HostImageDispatchTests.raw

    def test_receipt_returns_one_next_reservation_while_other_two_are_pending(self):
        self.prepare(maximumConcurrentImageCalls=3)
        host.authorize(self.run,host.status(self.run)['scopeDigest'],'Offline fixtures only')
        batch=host.next_request(self.run,count=3)['reservations']
        completed=batch.pop(1);raw=self.raw(completed['currentRequest'])
        output=io.StringIO()
        with patch('sys.argv',['ui_layer.py','host-receive','--run',str(self.run),
                   '--digest',completed['submissionDigest'],'--response',str(raw),'--refill-images']),redirect_stdout(output):
            host.main()
        result=json.loads(output.getvalue())
        following=result['nextImageRequest']
        self.assertEqual(digest(self.run/'images/attempts'/completed['currentRequest']['asset']/'raw.png'),digest(raw))
        current=host.status(self.run)
        self.assertEqual(len(current['outstandingRequestIds']),3)
        self.assertNotIn(following['asset'],{r['currentRequest']['asset'] for r in batch})
        # No second receipt or retry is required to obtain the refill.
        with self.assertRaisesRegex(ValueError,'RESERVED_SUBMISSION_REQUIRED'):
            host.receive(self.run,completed['submissionDigest'],raw,refill_images=True)

    def test_real_rolling_host_reaches_one_composite_review_and_final_package(self):
        self.prepare(maximumConcurrentImageCalls=3,materialReviewPolicy='final-composite-once-v1',
                     maximumMaterialReviews=1)
        current=host.status(self.run);total=current['maximumCalls']
        host.authorize(self.run,current['scopeDigest'],'Offline image fixtures only')
        sources={}
        async def invoke(row):
            sources[row['asset']]=self.raw(row)
            return sources[row['asset']]
        result=asyncio.run(dispatch.run_images(self.run,invoke))
        self.assertEqual(len(result['receivedSubmissionDigests']),total)
        self.assertFalse(result['failedSubmissionDigests'])
        self.assertLessEqual(result['maximumObservedConcurrentCalls'],3)
        self.assertEqual(result['state']['stage'],'composite_review')
        for key,path in sources.items():
            self.assertEqual(digest(self.run/'images/attempts'/key/'raw.png'),digest(path))
        final=composite_fixtures.finish_composite(self)
        self.assertEqual(final['stage'],'diagnostic_complete')
        self.assertEqual(final['completedCompositeReviewCalls'],1)
        self.assertEqual(final['perRequestMaterialReviewCalls'],0)
        self.assertEqual(final['automaticRetries'],0)
        self.assertTrue((self.run/'diagnostic-output/delivery/viewport-ui-layers.zip').is_file())


if __name__=='__main__':unittest.main()
