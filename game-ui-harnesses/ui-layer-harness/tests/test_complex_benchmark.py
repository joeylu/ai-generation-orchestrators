"""Fixed complex inventory and geometry regressions need no private media."""
import _bootstrap
from copy import deepcopy
from pathlib import Path
import unittest
import tempfile
from unittest.mock import patch

from ai_ui_layers import benchmark
from ai_ui_layers.evaluate import read, save
from ai_ui_layers.experimental_executor import record
from ai_ui_layers import host_delivery as host
import test_package_baseline_audit as packages

SUITE=Path(__file__).resolve().parents[1]/'benchmarks/complex-v1.json'


class ComplexBenchmarkTests(unittest.TestCase):
    def setUp(self):
        self.cases=read(SUITE)['cases']

    def actual(self, case):
        result=deepcopy(case['baseline'])
        result['selected']['executionCompleted']=True
        for stage in benchmark.STAGES:result['totalCallCounts'].setdefault(stage,0)
        return result

    def test_fixed_landscape_and_portrait_samples_keep_known_deficits_visible(self):
        self.assertEqual([len(c['baseline']['selected']['inventory']['plannedMaterialIds']) for c in self.cases],
                         [49,41,45,26,32])
        self.assertEqual(sum(c['baseline']['firstAttemptCompleted'] for c in self.cases),2)
        self.assertEqual(sum(c['baseline']['selected']['inventory']['complete'] for c in self.cases),4)
        for case in self.cases:
            self.assertEqual(benchmark.compare(case['baseline'],self.actual(case)),[])
            self.assertFalse(case['baseline']['selected']['geometry']['semanticGeometryAccepted'])
        self.assertEqual(len(self.cases[-1]['baseline']['selected']['inventory']['missingMaterialIds']),14)

    def test_v2_preserves_v1_and_freezes_ocean_partial_delivery_and_repair_counts(self):
        suite=read(SUITE.with_name('complex-v2.json'))
        self.assertEqual(suite['cases'][:5],self.cases)
        ocean=suite['cases'][5]
        self.assertEqual(ocean['id'],'ocean-expedition')
        baseline=ocean['baseline'];selected=baseline['selected']
        self.assertFalse(baseline['firstAttemptCompleted'])
        self.assertFalse(selected['executionCompleted'])
        self.assertTrue(selected['diagnosticDeliveryEvidenceUsable'])
        self.assertEqual(len(selected['inventory']['plannedMaterialIds']),64)
        self.assertEqual(len(selected['inventory']['deliveredMaterialIds']),60)
        self.assertEqual(set(selected['inventory']['missingMaterialIds']),
                         set(selected['inventory']['excludedMaterialIds']))
        self.assertEqual(baseline['totalCallCounts']['planning_repair'],1)
        self.assertEqual(baseline['totalCallCounts']['planning_rereview'],1)
        self.assertEqual(baseline['totalCallCounts']['images'],26)
        self.assertEqual(benchmark.compare(baseline,deepcopy(baseline)),[])

    def test_ocean_known_missing_cards_do_not_hide_additional_loss_or_repair_calls(self):
        baseline=read(SUITE.with_name('complex-v2.json'))['cases'][5]['baseline']
        actual=deepcopy(baseline)
        actual['selected']['inventory']['deliveredMaterialIds'].remove('scene')
        actual['totalCallCounts']['planning_repair']+=1
        codes={r['code'] for r in benchmark.compare(baseline,actual)}
        self.assertIn('MATERIAL_IDS_LOST',codes)
        self.assertIn('CALL_COUNT_INCREASED',codes)
        self.assertNotIn('NO_COMPLETED_ATTEMPT',codes)

    def test_later_success_cannot_hide_first_attempt_regression(self):
        for case in self.cases:
            if not case['baseline']['firstAttemptCompleted']:continue
            actual=self.actual(case);actual['firstAttemptCompleted']=False
            self.assertIn('FIRST_ATTEMPT_STOPPED',[r['code'] for r in benchmark.compare(case['baseline'],actual)])

    def test_missing_owner_and_planning_omission_detected_for_every_complex_case(self):
        for case in self.cases:
            actual=self.actual(case)
            mid=actual['selected']['inventory']['deliveredMaterialIds'][0]
            for field in ('plannedMaterialIds','deliveredMaterialIds'):
                actual['selected']['inventory'][field].remove(mid)
            regressions=benchmark.compare(case['baseline'],actual)
            self.assertEqual(sum(r['code']=='MATERIAL_IDS_LOST' for r in regressions),2)

    def test_new_exclusion_is_reported_even_when_capacity_crop_remains(self):
        case=self.cases[0];actual=self.actual(case)
        actual['selected']['inventory']['excludedMaterialIds'].append('owner-with-uncertain-partition')
        self.assertIn('NEW_UNCERTAIN_EXCLUSIONS',[r['code'] for r in benchmark.compare(case['baseline'],actual)])

    def test_geometry_drift_and_new_failed_constraint_detected_for_all_cases(self):
        for case in self.cases:
            actual=self.actual(case);geometry=actual['selected']['geometry']
            mid=next(iter(geometry['storageRegions']));geometry['storageRegions'][mid][0]+=3
            cid=next(k for k,v in geometry['constraints'].items() if v['passed'])
            geometry['constraints'][cid].update(passed=False,residualPixels=10)
            codes={r['code'] for r in benchmark.compare(case['baseline'],actual)}
            self.assertIn('STORAGE_REGION_DRIFT',codes);self.assertIn('GEOMETRY_CHECK_LOST_OR_FAILED',codes)

    def test_call_increases_are_separate_from_inventory_and_geometry(self):
        for stage in benchmark.STAGES:
            case=self.cases[2];actual=self.actual(case);actual['totalCallCounts'][stage]+=1
            result=benchmark.compare(case['baseline'],actual)
            self.assertEqual(result,[dict(metric='calls',code='CALL_COUNT_INCREASED',stage=stage,
                baseline=case['baseline']['totalCallCounts'].get(stage,0),actual=actual['totalCallCounts'][stage])])

    def test_failed_execution_still_reports_optional_repair_call_increases(self):
        case=self.cases[0];actual=self.actual(case)
        actual['selected'].update(executionCompleted=False,inventory=None,geometry=None)
        actual['totalCallCounts'].update(planning_repair=1,planning_rereview=1)
        regressions=benchmark.compare(case['baseline'],actual)
        self.assertEqual({r['stage'] for r in regressions if r['metric']=='calls'},
                         {'planning_repair','planning_rereview'})
        self.assertIn('NO_COMPLETED_ATTEMPT',{r['code'] for r in regressions})

    def test_failed_diagnostic_baseline_compares_geometry_without_claiming_completion(self):
        baseline=deepcopy(self.cases[0]['baseline'])
        baseline['firstAttemptCompleted']=False
        baseline['selected'].update(executionCompleted=False,diagnosticDeliveryEvidenceUsable=True)
        actual=deepcopy(baseline)
        self.assertEqual(benchmark.compare(baseline,actual),[])
        mid=next(iter(actual['selected']['geometry']['storageRegions']))
        actual['selected']['geometry']['storageRegions'][mid][0]+=5
        self.assertIn('STORAGE_REGION_DRIFT',{r['code'] for r in benchmark.compare(baseline,actual)})
        self.assertFalse(actual['selected']['executionCompleted'])

    def test_a_previously_completed_run_still_regresses_with_verified_failed_diagnostics(self):
        case=self.cases[0];actual=self.actual(case)
        actual['selected'].update(executionCompleted=False,diagnosticDeliveryEvidenceUsable=True)
        self.assertIn('NO_COMPLETED_ATTEMPT',{r['code'] for r in benchmark.compare(case['baseline'],actual)})

    def test_known_failed_geometry_cannot_become_unmeasured_silently(self):
        case=self.cases[0];actual=self.actual(case)
        cid=next(k for k,v in actual['selected']['geometry']['constraints'].items() if v['residualPixels'] is not None)
        actual['selected']['geometry']['constraints'][cid]['residualPixels']=None
        self.assertIn('GEOMETRY_MEASUREMENT_LOST',[r['code'] for r in benchmark.compare(case['baseline'],actual)])

    def test_different_reference_stops(self):
        case=self.cases[0];actual=self.actual(case);actual['selected']['referenceSha256']='0'*64
        with self.assertRaisesRegex(ValueError,'REFERENCE_CHANGED'):benchmark.compare(case['baseline'],actual)

    def test_pixel_artifact_change_is_visible_even_with_unchanged_geometry(self):
        original=dict(archiveSha256='archive',layerSha256=dict(owner='png'),previewSha256='preview')
        replayed=deepcopy(original);replayed['layerSha256']['owner']='changed-png'
        identity=benchmark.replay_identity(original,replayed)
        self.assertFalse(identity['layerBytesIdentical'])
        self.assertTrue(identity['archiveBytesIdentical'])
        self.assertTrue(identity['previewBytesIdentical'])


class DeliveryMeasurementTests(unittest.TestCase):
    setUp=packages.BaselineAuditTests.setUp
    package=packages.BaselineAuditTests.package

    def test_actual_archive_inventory_and_normalized_geometry_are_measured(self):
        ids=read(SUITE)['cases'][0]['baseline']['selected']['inventory']['plannedMaterialIds']
        self.package('complex-fixture',ids,shift=(7,9))
        frozen=self.root/'frozen';(frozen/'evidence').mkdir(parents=True)
        save(frozen/'evidence/m1-draft.json',dict(materials=[dict(id=mid) for mid in ids]))
        measured=benchmark.measure_delivery(frozen,self.root/'complex-fixture/delivery',self.root/'layout')
        self.assertTrue(measured['inventory']['complete'])
        self.assertEqual(len(measured['inventory']['deliveredMaterialIds']),49)
        self.assertEqual(set(tuple(box) for box in measured['geometry']['storageRegions'].values()),{(2,2,3,3)})
        self.assertFalse(measured['geometry']['semanticGeometryAccepted'])

    def test_bad_archive_is_a_technical_stop(self):
        archive=self.package('bad',['fixture-owner']);archive.write_bytes(b'Invalid offline archive')
        with self.assertRaises(Exception):benchmark.measure_delivery(self.root/'frozen',archive.parent,self.root/'layout')


class EvidenceBoundaryTests(unittest.TestCase):
    def setUp(self):
        temporary=tempfile.TemporaryDirectory();self.addCleanup(temporary.cleanup)
        self.root=Path(temporary.name).resolve()
        self.run=self.root/'run';self.run.mkdir();(self.run/'scopes/planning_generate').mkdir(parents=True)
        (self.run/'planning/.dag').mkdir(parents=True)
        (self.run/'planning/.dag/lock').write_bytes(b'original failure lock')
        original=self.run/'reference.png';original.write_bytes(b'offline identity fixture')
        self.config=record(self.run/'config.json',dict(runtime={},original=str(original)))
        record(self.run/'scopes/planning_generate/scope.json',dict(stage='planning_generate'))
        self.submission=self.run/'scopes/planning_generate/planning-submission.json'
        record(self.submission,dict(kind='offline-reservation'))
        host._state(self.run,self.config,'failed',reason='CALL_LIMIT_EXCEEDED')
        host._checkpoint(self.run)

    def test_failed_state_remains_first_attempt_evidence_but_cannot_replay_changed_media(self):
        (self.run/'planning/.dag/lock').write_bytes(b'changed failure lock')
        result=benchmark.inspect_run(self.run)
        self.assertFalse(result['executionCompleted'])
        self.assertFalse(result['checkpointIntegrityPassed'])
        self.assertFalse(result['deliveryEvidenceUsable'])
        self.assertEqual(result['callCounts']['planning_generate'],1)
        self.assertEqual(result['failureCode'],'CALL_LIMIT_EXCEEDED')
        with self.assertRaisesRegex(ValueError,'COMPLETED_VERIFIED_RUN_REQUIRED'):
            benchmark.replay(self.run,self.root/'replay')
        self.assertFalse((self.root/'replay').exists())

    def test_changed_reservation_or_completed_checkpoint_is_a_technical_stop(self):
        self.submission.write_bytes(b'changed reservation')
        with self.assertRaisesRegex(ValueError,'CALL_EVIDENCE_CHANGED'):benchmark.inspect_run(self.run)
        host._state(self.run,self.config,'diagnostic_complete')
        with self.assertRaisesRegex(ValueError,'CHECKPOINT_FILES_CHANGED'):benchmark.inspect_run(self.run)

    def test_failed_reference_change_still_stops(self):
        (self.run/'reference.png').write_bytes(b'changed original')
        with self.assertRaisesRegex(ValueError,'REFERENCE_CHANGED'):benchmark.inspect_run(self.run)

    def test_optional_repair_and_rereview_scopes_are_counted_without_model_calls(self):
        for stage in ('planning_repair','planning_rereview'):
            folder=self.run/'scopes'/stage;folder.mkdir()
            record(folder/'scope.json',dict(stage=stage))
            record(folder/'planning-submission.json',dict(kind='offline-reservation'))
        host._checkpoint(self.run)
        result=benchmark.inspect_run(self.run)
        self.assertEqual(result['callCounts']['planning_repair'],1)
        self.assertEqual(result['callCounts']['planning_rereview'],1)
        self.assertFalse(result['executionCompleted'])

    def test_unknown_scope_stage_cannot_hide_new_model_calls(self):
        folder=self.run/'scopes/unknown';folder.mkdir()
        record(folder/'scope.json',dict(stage='unknown-new-model-stage'))
        host._checkpoint(self.run)
        with self.assertRaisesRegex(ValueError,'UNKNOWN_SCOPE_STAGE'):benchmark.inspect_run(self.run)

    def test_exact_case_set_and_output_overlap_are_rejected_without_output(self):
        case=read(SUITE)['cases'][0]
        suite=self.root/'suite.json';save(suite,dict(cases=[case]))
        evidence=self.root/'selection.json';save(evidence,dict(cases=[]))
        with self.assertRaisesRegex(ValueError,'EXACT_BENCHMARK_CASE_SET_REQUIRED'):
            benchmark.run_suite(suite,evidence,self.root/'result')
        evidence2=self.root/'selection2.json';save(evidence2,dict(cases=[dict(id=case['id'],attempts=[str(self.run)])]))
        with self.assertRaisesRegex(ValueError,'OVERLAPS_EVIDENCE'):
            benchmark.run_suite(suite,evidence2,self.run/'result')
        self.assertFalse((self.root/'result').exists())
        self.assertFalse((self.run/'result').exists())

    def test_failed_media_changes_during_benchmark_are_detected_without_repair(self):
        before=benchmark.inspect_run(self.run)
        case=deepcopy(read(SUITE)['cases'][1]);case['reference']['sha256']=before['referenceSha256']
        case['baseline']['selected']['referenceSha256']=before['referenceSha256']
        suite=self.root/'suite.json';save(suite,dict(cases=[case]))
        evidence=self.root/'selection.json';save(evidence,dict(cases=[dict(id=case['id'],attempts=[str(self.run)])]))
        after=dict(before,observedInventorySha256='changed-current-media-inventory')
        with patch.object(benchmark,'inspect_run',side_effect=[before,after]):
            with self.assertRaisesRegex(ValueError,'SOURCE_CHANGED'):
                benchmark.run_suite(suite,evidence,self.root/'result',replay_received=True)


class FailedCompositeBenchmarkTests(unittest.TestCase):
    def setUp(self):
        import test_image_dispatch as fixtures
        fixtures.HostImageDispatchTests.setUp(self)

    def packaged_failure(self):
        import asyncio
        import test_image_dispatch as fixtures
        from ai_ui_layers import host_image_dispatch
        fixtures.HostImageDispatchTests.prepare(self,maximumConcurrentImageCalls=3,
            materialReviewPolicy='final-composite-once-v1',maximumMaterialReviews=1)
        host.authorize(self.run,host.status(self.run)['scopeDigest'],'Offline fixture images only')
        async def invoke(row):return fixtures.HostImageDispatchTests.raw(self,row)
        asyncio.run(host_image_dispatch.run_images(self.run,invoke))
        self.assertEqual(host.status(self.run)['stage'],'composite_review')
        host.authorize(self.run,host.status(self.run)['scopeDigest'],'Offline failure fixture only')
        reservation=host.next_request(self.run)
        host.fail(self.run,reservation['submissionDigest'],'OFFLINE_TRANSPORT_FAILURE_NO_RETRY')

    def test_failed_review_retains_measurable_bound_artifacts_but_replay_stays_forbidden(self):
        self.packaged_failure();before=host._files(self.run)
        measured=benchmark.inspect_run(self.run)
        self.assertFalse(measured['executionCompleted'])
        self.assertTrue(measured['checkpointIntegrityPassed'])
        self.assertTrue(measured['diagnosticDeliveryEvidenceUsable'])
        self.assertFalse(measured['deliveryEvidenceUsable'])
        self.assertTrue(measured['inventory']['deliveredMaterialIds'])
        self.assertEqual(measured['callCounts']['composite_review'],1)
        with self.assertRaisesRegex(ValueError,'COMPLETED_VERIFIED_RUN_REQUIRED'):
            benchmark.replay(self.run,self.base/'forbidden-replay')
        self.assertEqual(before,host._files(self.run))
        self.assertEqual(host.status(self.run)['status'],'failed_no_retry')

    def test_failed_diagnostics_suite_is_read_only_even_when_replay_is_requested(self):
        self.packaged_failure();before=host._files(self.run)
        measured=benchmark.inspect_run(self.run)
        case=dict(id='failed-after-package',reference=dict(sha256=measured['referenceSha256']),
            baseline=dict(firstAttemptCompleted=False,selected=measured,totalCallCounts=measured['callCounts']))
        suite=self.base/'failed-suite.json';save(suite,dict(cases=[case]))
        evidence=self.base/'failed-evidence.json';save(evidence,dict(cases=[dict(id=case['id'],attempts=[str(self.run)])]))
        with patch.object(benchmark,'replay',side_effect=AssertionError('Failed run must never replay')):
            report=benchmark.run_suite(suite,evidence,self.base/'measured-failure',replay_received=True)
        self.assertEqual(report['regressionCount'],0)
        self.assertEqual(report['firstAttemptCompletedCount'],0)
        self.assertFalse(report['cases'][0]['selected']['executionCompleted'])
        self.assertTrue(report['cases'][0]['selected']['diagnosticDeliveryEvidenceUsable'])
        self.assertNotIn('replay',report['cases'][0])
        self.assertEqual(before,host._files(self.run))

    def test_changed_media_is_unusable_and_rebound_packet_tampering_is_rejected(self):
        self.packaged_failure()
        image=self.run/'final-review/recomposition.png';image.write_bytes(b'changed pixels')
        measured=benchmark.inspect_run(self.run)
        self.assertFalse(measured['diagnosticDeliveryEvidenceUsable'])
        self.assertIsNone(measured['inventory'])
        host._checkpoint(self.run)
        with self.assertRaises(ValueError):benchmark.inspect_run(self.run)


if __name__=='__main__':unittest.main()
