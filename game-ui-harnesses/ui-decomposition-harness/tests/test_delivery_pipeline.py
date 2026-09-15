import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch
import zipfile
import subprocess

from ai_ui_decomposition.common import sha256, write_json
from ai_ui_decomposition.delivery_pipeline import run_delivery
from ai_ui_decomposition.cli import main


class DeliveryPipelineTests(unittest.TestCase):
    def fixture(self, root):
        source=root/'source.zip'
        with zipfile.ZipFile(source,'w') as z:
            z.writestr('handoff.json',json.dumps(dict(kind='ai_ui_component_handoff_v2',human_visual_acceptance=False)))
        write_json(root/'evidence.json',dict(handoffSha256=sha256(source)))
        ref=lambda p:dict(path=p.name,sha256=sha256(p))
        write_json(root/'plan.json',dict(kind='ui_delivery_run_plan_v1',source=ref(source),stateEvidence=ref(root/'evidence.json')))
        return source

    def mocks(self, reference_status='blocked', state_kind='ui_state_acceptance_v1'):
        def state(source,evidence,component_root,out,**kwargs):
            self.assertTrue(kwargs['require_visual_layout'])
            out.mkdir()
            r=dict(kind=state_kind,status='technical_passed',handoffSha256=sha256(source),scope=dict(mode='full'),
                   layoutCoverage='required_checked',visualObservationCoverage='checked',visualObservationSha256='test-double-only')
            write_json(out/'acceptance.json',r)
            write_json(out/'default-inspection.json',dict(nodes=[]))
            write_json(out/'consumed.json',dict(document=dict(canvas=dict(width=100,height=100))))
            (out/'default.png').write_bytes(b'test-double-screenshot')
            write_json(out/'default-capture.json',dict(kind='ui_runtime_capture_v1',handoffSha256=sha256(source),bundleSha256=sha256(out/'consumed.json'),
                screenshot=dict(path='default.png',sha256=sha256(out/'default.png')),
                inspection=dict(path='default-inspection.json',sha256=sha256(out/'default-inspection.json'))))
            return r
        def studio(source,component_root,out,timeout):
            out.mkdir();r=dict(status='technical_passed',referenceEvidence=dict(status='byte_identical'))
            write_json(out/'receipt.json',r);return r
        def reference(command,**kwargs):
            out=Path(command[-1]);out.mkdir()
            write_json(out/'report.json',dict(kind='ui-reference-acceptance-report',status=reference_status,inputSha256=sha256(Path(command[3])),unknownFields=['field.focused'] if reference_status=='blocked' else [],
                comparison=dict(counts=dict(passed=1,failed=0,unverified=0),scopes=[dict(status='passed',pixels=1)])))
            return SimpleNamespace(returncode=0 if reference_status=='technical_passed' else 2)
        return state,studio,reference

    def test_stage_receipts_control_publication_and_unknown_is_not_success(self):
        for status in ('blocked','visual_failed','technical_passed'):
            with self.subTest(status=status),tempfile.TemporaryDirectory() as d:
                root=Path(d);source=self.fixture(root);state,studio,reference=self.mocks(status)
                with patch('ai_ui_decomposition.stateful.accept',side_effect=state),patch('ai_ui_decomposition.studio_acceptance.run_studio',side_effect=studio),patch('ai_ui_decomposition.delivery_pipeline.subprocess.run',side_effect=reference):
                    r=run_delivery(root/'plan.json',root,root/'out',60)
                self.assertEqual((root/'out/ui.component-handoff.draft.zip').exists(),status=='technical_passed')
                self.assertFalse(r['human_visual_acceptance']);self.assertEqual(r['mediaCalls'],0)
                self.assertEqual(r['execution']['automaticRetries'],0)
                if status=='blocked':self.assertEqual(r['referenceComparison']['unknownFields'],['field.focused'])

    def test_reference_receipt_cannot_impersonate_stateful(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);self.fixture(root);state,_,_=self.mocks(state_kind='ui-reference-acceptance-report')
            with patch('ai_ui_decomposition.stateful.accept',side_effect=state),patch('ai_ui_decomposition.studio_acceptance.run_studio') as studio:
                r=run_delivery(root/'plan.json',root,root/'out',60)
            studio.assert_not_called();self.assertEqual(r['error'],'DELIVERY_RUN_STATEFUL_RECEIPT_REQUIRED')

    def test_changed_source_rejected_before_any_browser(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);source=self.fixture(root);source.write_bytes(b'changed')
            with patch('ai_ui_decomposition.stateful.accept') as state:
                r=run_delivery(root/'plan.json',root,root/'out',60)
            state.assert_not_called();self.assertEqual(r['error'],'DELIVERY_RUN_INPUT_CHANGED')

    def test_timeout_keeps_failure_and_no_accepted_zip(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);self.fixture(root)
            with patch('ai_ui_decomposition.stateful.accept',side_effect=subprocess.TimeoutExpired('fixture',1)) as state:
                r=run_delivery(root/'plan.json',root,root/'out',60)
            self.assertEqual(state.call_count,1);self.assertEqual(r['error'],'DELIVERY_RUN_TIMEOUT')
            self.assertFalse((root/'out/ui.component-handoff.draft.zip').exists())

    def test_cli_failed_or_blocked_run_has_failure_exit(self):
        for status in ('failed','blocked_reference','failed_visual_qa'):
            with patch('ai_ui_decomposition.cli.execute',return_value=dict(status=status)):
                self.assertEqual(main(['delivery-run','--plan','p','--component-root','c','--output','o']),2)

    def test_empty_comparison_and_changed_capture_cannot_publish(self):
        for changed in ('comparison','capture'):
            with self.subTest(changed=changed),tempfile.TemporaryDirectory() as d:
                root=Path(d);self.fixture(root);state,studio,reference=self.mocks('technical_passed')
                def tampered_state(*args,**kwargs):
                    result=state(*args,**kwargs)
                    if changed=='capture':(args[3]/'default.png').write_bytes(b'changed')
                    return result
                def empty_reference(command,**kwargs):
                    result=reference(command,**kwargs)
                    if changed=='comparison':
                        from ai_ui_decomposition.common import read_json
                        path=Path(command[-1])/'report.json';r=read_json(path);r['comparison']['scopes']=[];write_json(path,r)
                    return result
                with patch('ai_ui_decomposition.stateful.accept',side_effect=tampered_state),patch('ai_ui_decomposition.studio_acceptance.run_studio',side_effect=studio),patch('ai_ui_decomposition.delivery_pipeline.subprocess.run',side_effect=empty_reference):
                    r=run_delivery(root/'plan.json',root,root/'out',60)
                self.assertEqual(r['status'],'failed');self.assertNotIn('delivery',r)
                self.assertFalse((root/'out/ui.component-handoff.draft.zip').exists())
