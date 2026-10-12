"""Timing journals use offline callers and monotonic clocks; never paid tools."""
import _bootstrap
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from ai_ui_layers import host_delivery as host, host_timing as timing
from ai_ui_layers.evaluate import read, digest
from ai_ui_layers.experimental_executor import record
import test_host_m1 as fresh
import test_host_sheet_fallback as sheets
import test_host_delivery as delivery
import test_composite_review as composite


class PhaseTimingTests(unittest.TestCase):
    def setUp(self):
        temporary=tempfile.TemporaryDirectory();self.addCleanup(temporary.cleanup)
        self.root=Path(temporary.name).resolve()

    def test_nested_phases_are_exclusive_and_counted_once(self):
        with patch.object(timing.time,'perf_counter',side_effect=range(6)):
            with timing.capture() as seconds:
                with timing.phase('registration'):
                    with timing.phase('packaging'):pass
        self.assertEqual(seconds,dict(orchestration=2,registration=2,packaging=1))
        self.assertEqual(sum(seconds.values()),5)

    def journal(self, intervals):
        record(self.root/'config.json',dict(timingPolicy=timing.POLICY))
        host._control(self.root,timing.NAME,dict(action='initialized'))
        for index,(start,stop) in enumerate(intervals):
            host._control(self.root,timing.NAME,dict(endedUnixSeconds=start,
                reservations=[dict(submissionDigest=str(index),stage='images')]))
        for index,(start,stop) in enumerate(intervals):
            host._control(self.root,timing.NAME,dict(consumed=str(index),receiveStartedUnixSeconds=stop,
                localSeconds=dict(receipt_processing=1)))

    def test_parallel_waits_use_union_including_contained_intervals(self):
        self.journal([(100,110),(101,105),(102,108)])
        report=timing.report(self.root);row=report['stages']['image_wait']
        self.assertEqual(row['reservationWaitUnionSeconds'],10)
        self.assertEqual(row['reservationWaitSumSeconds'],20)
        self.assertEqual(row['completedWaits'],3)
        self.assertEqual(report['localSeconds'],3)
        self.assertEqual(report['outstandingReservations'],0)

    def test_wall_clock_reversal_is_reported_without_negative_duration(self):
        self.journal([(110,100)])
        report=timing.report(self.root)
        self.assertEqual(report['invalidClockIntervals'],1)
        self.assertEqual(report['stages']['image_wait']['reservationWaitUnionSeconds'],0)

    def test_tampered_timing_record_is_rejected(self):
        self.journal([(100,110)])
        path=next(p for p in (self.root/'.journal'/timing.NAME).glob('*.json') if read(p).get('action')=='initialized')
        path.write_bytes(path.read_bytes().replace(b'initialized',b'manipulated'))
        with self.assertRaisesRegex(ValueError,'RECORD_CHANGED'):timing.report(self.root)

    def test_historical_timing_is_unavailable_and_read_only(self):
        record(self.root/'config.json',dict(kind=host.KIND))
        before=digest(self.root/'config.json')
        report=timing.report(self.root)
        self.assertEqual(report['status'],'unavailable-historical-run')
        self.assertEqual(before,digest(self.root/'config.json'))
        self.assertFalse((self.root/timing.NAME).exists())
        self.assertFalse((self.root/'.journal').exists())

    def test_timing_pointer_is_not_an_inventory_exception_for_historical_runs(self):
        record(self.root/'config.json',dict(kind=host.KIND))
        (self.root/timing.NAME).write_text('unbound historical file',encoding='utf-8')
        self.assertIn(timing.NAME,host._files(self.root))

    def test_operation_wrapper_preserves_keyword_arguments(self):
        @timing.track('prepare')
        def prepare(config_path, output):return output
        @timing.track('resume')
        def resume(run):return run
        self.assertEqual(prepare(config_path='offline-unused',output=self.root),self.root)
        self.assertEqual(resume(run=self.root),self.root)


class FreshHostTimingTests(unittest.TestCase):
    setUp=fresh.FreshHostM1Tests.setUp
    generate=fresh.FreshHostM1Tests.generate
    review=fresh.FreshHostM1Tests.review

    def test_current_formal_chain_records_all_phases_with_no_extra_calls(self):
        config=read(self.fresh_config)
        config.update(visualReviewMode='warning',materialReviewPolicy='final-composite-once-v1',
            bodyReviewPolicy='final-composite-first-v1',maximumMaterialReviews=1,maximumBodyCalls=1)
        from ai_ui_layers.evaluate import save
        path=self.base/'timed-config.json';save(path,config)
        self.run=self.base/'timed-run';host.prepare(path,self.run);self.root=self.run/'planning'
        self.plan['layoutRegistration']=dict(kind='ui_host_layout_contract_v1',
            referenceSha256=digest(self.reference),materials=[dict(materialId=m['id'],mode='frame',
                measurementAlphaThreshold=128) for m in self.plan['materials'] if m['role']=='foreground'],
            constraints=[],knownDifferences=[])
        original=delivery.review_fixtures.HostReviewTests.response_doc
        def answer(owner):
            result=original(owner)
            for entry in result['smallMaterialAudit'].values():
                for part in entry['parts']:part['deferredAppearance']=None
            return result
        self.generate()
        with patch.object(delivery.review_fixtures.HostReviewTests,'response_doc',answer):self.review()
        with (patch.object(host.host_material_review,'prepare',side_effect=AssertionError('No per-material call')),
              patch.object(host.host_body_observation,'prepare',side_effect=AssertionError('No body call'))):
            sheets.HostSheetFallbackTests.acquire(self,False)
        composite.finish_composite(self)
        current=host.status(self.run)
        self.assertEqual(current['stage'],'diagnostic_complete')
        self.assertEqual(current['compositeReviewCalls'],1)
        self.assertEqual(current['perRequestMaterialReviewCalls'],0)
        report=timing.report(self.run)
        for stage in ('planning','planning_review','receipt_processing','registration','composite_review','packaging'):
            self.assertGreater(report['stages'][stage]['localSeconds'],0,stage)
        self.assertEqual(report['stages']['planning']['completedWaits'],1)
        self.assertEqual(report['stages']['planning_review']['completedWaits'],1)
        self.assertEqual(report['stages']['composite_review']['completedWaits'],1)
        self.assertEqual(report['outstandingReservations'],0)
        # Status, report and terminal resume preserve the full journal as well.
        def inventory():return {p.relative_to(self.run).as_posix():digest(p) for p in self.run.rglob('*') if p.is_file()}
        before=inventory();host.status(self.run);timing.report(self.run);host.resume(self.run)
        self.assertEqual(before,inventory())

    def test_indeterminate_failure_consumes_wait_without_resubmission(self):
        current=host.status(self.run)
        host.authorize(self.run,current['scopeDigest'],'Offline failure fixture')
        request=host.next_request(self.run)
        host.fail(self.run,request['submissionDigest'],'Indeterminate offline fixture')
        report=timing.report(self.run)
        self.assertEqual(report['stages']['planning']['completedWaits'],1)
        self.assertEqual(report['outstandingReservations'],0)
        self.assertEqual(host.status(self.run)['status'],'failed_no_retry')
        with self.assertRaisesRegex(ValueError,'NO_NEXT'):host.next_request(self.run)


if __name__=='__main__':unittest.main()
