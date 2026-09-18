"""No media calls: receive all fixtures before a quality failure blocks processing."""
import unittest
from pathlib import Path
from unittest.mock import patch
from PIL import Image
from ai_ui_decomposition import workflow as w, batch
from ai_ui_decomposition.cached import verified_result
from ai_ui_decomposition.common import read_json, ContractError
from ai_ui_decomposition.material_preflight import check_batch
from ai_ui_decomposition.workflow_bridge import export_generation
from test_workflow_bridge import WorkflowBridgeTests as _Fixture, receive_generation


class DeferredPreflightTests(unittest.TestCase):
    preflight_mode = 'after-generation-v1'
    setUp = _Fixture.setUp
    tearDown = _Fixture.tearDown
    authorize = _Fixture.authorize

    def collect(self, valid=False):
        self.authorize()
        result = w.inspect_job(self.job)
        keys = []
        while result.get('nextNode') != 'process':
            assigned = export_generation(self.job)
            # Deliberately opaque, non-keyed component images: quality must wait.
            raw = self.square if valid and assigned['request'].startswith('board-') else self.raw
            result = receive_generation(self.job, assigned['requestDigest'], raw)
            keys.append(assigned['request'])
        return keys

    def paths(self):
        return (self.job/'nodes/compile/output/prepared',
                self.job/'nodes/freeze/output/workspace/runs/generation')

    def test_collect_all_then_report_all_failures_without_preview(self):
        keys = self.collect()
        self.assertGreater(len(keys), 1)
        compiled, run = self.paths()
        with self.assertRaisesRegex(ValueError, 'MATERIAL_QUALITY_PENDING'):
            verified_result(run, keys[0])
        # Background fixture is valid; keyed board canvas fixture is wrong.
        result = w.advance(self.job)
        self.assertEqual(result['status'], 'failed')
        report = read_json(self.job/'nodes/process/output/material-preflight.json')
        self.assertEqual(report['checked'], len(keys))
        self.assertGreater(report['failed'], 0)
        self.assertIn('material-preflight', read_json(self.job/'nodes/process/receipt.json')['artifacts'])
        self.assertFalse((self.job/'nodes/process/output/preview').exists())
        self.assertFalse((self.job/'nodes/acceptance').exists())
        self.assertFalse((self.job/'nodes/deliver').exists())
        bad = next(r['asset'] for r in report['materials'] if r['status']=='failed')
        with self.assertRaisesRegex(ValueError, 'MATERIAL_QUALITY_FAILED'):
            verified_result(run, bad)
        with self.assertRaisesRegex(ValueError, 'NOT_READY'):
            export_generation(self.job)

    def test_source_tamper_stops_even_before_quality(self):
        keys = self.collect()
        compiled, run = self.paths()
        frozen,_ = batch.load(run)
        raw = run/'requests'/frozen['requests'][keys[0]]['id']/'raw.png'
        Image.new('RGB',(200,160),'#123456').save(raw)
        with self.assertRaisesRegex(ValueError, 'SOURCE_CHANGED'):
            check_batch(compiled,run,self.base/'quality.json')

    def test_all_quality_errors_are_aggregated(self):
        keys = self.collect()
        compiled,run = self.paths()
        with patch('ai_ui_decomposition.material_preflight.check_material',
                   side_effect=ContractError('BOARD_GAP_AMBIGUOUS_SEPARATION')) as check:
            report=check_batch(compiled,run,self.base/'quality.json')
        self.assertEqual(check.call_count,len(keys))
        self.assertEqual(report['failed'],len(keys))
        self.assertTrue(all(r['elapsedSeconds']>=0 for r in report['materials']))

    def test_incomplete_batch_cannot_be_quality_approved(self):
        self.authorize()
        compiled,run=self.paths()
        with self.assertRaisesRegex(ValueError,'BATCH_INCOMPLETE'):
            check_batch(compiled,run,self.base/'quality.json')

    def test_passed_quality_unlocks_verified_sources_and_detects_report_tamper(self):
        keys=self.collect(valid=True)
        compiled,run=self.paths()
        report=check_batch(compiled,run,self.base/'quality.json')
        self.assertEqual(report['status'],'passed')
        for key in keys:
            verified_result(run,key)
        frozen,_=batch.load(run)
        q=run/'requests'/frozen['requests'][keys[0]]['id']/'quality.json'
        q.write_text('{}')
        with self.assertRaisesRegex(ValueError,'MATERIAL_QUALITY_CHANGED'):
            verified_result(run,keys[0])

    def test_provider_transport_collects_before_quality(self):
        from ai_ui_decomposition.repository_workflow import RepositoryWorkflow
        self.authorize()
        spec=read_json(self.job/'job.json')
        options={**spec['options'],'generationMode':'provider','providerConfig':'offline-fixture'}
        out=self.job/'provider-fixture';out.mkdir()
        context=dict(job=str(self.job),output=str(out),node='generate',spec=spec,
                     receipts=w._receipts(self.job,spec),timeoutSeconds=60)
        with patch('ai_ui_decomposition.headless.load_provider') as provider:
            provider.return_value.generate.return_value=self.raw
            result=RepositoryWorkflow(options).run(context)
            calls=provider.return_value.generate.call_count
        compiled,run=self.paths()
        frozen,_=batch.load(run)
        self.assertEqual(calls,len(frozen['dispatch_order']))
        self.assertEqual(result['status'],'ok')
        report=check_batch(compiled,run,self.base/'quality.json')
        self.assertGreater(report['failed'],0)

    def test_new_repository_job_defaults_to_deferred_preflight(self):
        spec=read_json(self.job/'job.json')
        options=dict(spec['options']);options.pop('materialPreflight')
        target=self.base/'default-job'
        w.create_job(self.base/'reference.png',target,factory=spec['factory'],options=options)
        self.assertEqual(read_json(target/'job.json')['options']['materialPreflight'],'after-generation-v1')


del _Fixture  # Avoid rediscovering the fixture's legacy TestCase in this module.
