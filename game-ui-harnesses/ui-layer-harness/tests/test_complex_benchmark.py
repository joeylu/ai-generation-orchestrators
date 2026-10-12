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
                baseline=case['baseline']['totalCallCounts'][stage],actual=actual['totalCallCounts'][stage])])

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
        suite=self.root/'suite.json';save(suite,dict(cases=[case]))
        evidence=self.root/'selection.json';save(evidence,dict(cases=[dict(id=case['id'],attempts=[str(self.run)])]))
        after=dict(before,observedInventorySha256='changed-current-media-inventory')
        with patch.object(benchmark,'inspect_run',side_effect=[before,after]):
            with self.assertRaisesRegex(ValueError,'SOURCE_CHANGED'):
                benchmark.run_suite(suite,evidence,self.root/'result',replay_received=True)


if __name__=='__main__':unittest.main()
