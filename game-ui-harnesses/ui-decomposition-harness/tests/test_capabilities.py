import contextlib
import copy
import io
import json
from pathlib import Path
import tempfile
import unittest

from ai_ui_decomposition.capabilities import audit,PROFILES,GAPS
from ai_ui_decomposition.common import ContractError,digest,write_json
from ai_ui_decomposition import batch
from ai_ui_decomposition.cli import main


class CapabilityTests(unittest.TestCase):
    def request(self):
        return {'kind':'ui-decomposition-capability-request','version':'1.0','planDigest':'a'*64,
                'components':[{'id':k.lower(),'type':k,'profiles':sorted(v)} for k,v in PROFILES.items()]}

    def test_all_sixteen_bounded_profiles(self):
        self.assertEqual(len(PROFILES),16)
        r=audit(self.request());self.assertEqual(r['status'],'capability_supported')
        self.assertFalse(r['sample_acceptance']);self.assertFalse(r['human_visual_acceptance']);self.assertEqual(r['media_calls'],0)

    def test_known_and_unknown_gaps_collect_before_generation(self):
        request=self.request()
        for row in request['components']: row['profiles']=list(GAPS[row['type']])+['never-implemented']
        r=audit(request);self.assertEqual(r['status'],'capability_blocked')
        self.assertTrue(all(not q['supported'] for q in r['checks']))
        self.assertEqual({q['componentType'] for q in r['checks']},set(PROFILES))

    def test_strict_request_unknowns_not_silently_dropped(self):
        for mutate in [lambda r:r.update(version='2'),lambda r:r.update(extra=True),lambda r:r.update(planDigest='wrong'),
                       lambda r:r['components'][0].update(profiles=[]),lambda r:r['components'].append(copy.deepcopy(r['components'][0]))]:
            r=self.request();mutate(r)
            with self.assertRaises(ContractError):audit(r)
        r=self.request();r['components'][0]['type']='Imaginary';self.assertEqual(audit(r)['status'],'capability_blocked')

    def test_cli_reports_failure_and_preserves_output(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);r=self.request();r['components'][0]['profiles']=['unknown'];write_json(root/'request.json',r)
            args=['capability-check','--request',str(root/'request.json'),'--output',str(root/'report.json')]
            with contextlib.redirect_stdout(io.StringIO()):self.assertEqual(main(args),2)
            before=(root/'report.json').read_bytes()
            with contextlib.redirect_stdout(io.StringIO()):self.assertEqual(main(args),2)
            self.assertEqual((root/'report.json').read_bytes(),before)

    def test_freeze_binds_request_rejects_gaps_and_tampering(self):
        import test_harness
        f=test_harness.HarnessTests();f.setUp()
        try:
            request=self.request();request['planDigest']=digest(f.plan)
            # Raster-only freeze binding; Panel/ScrollView spacing has a separate
            # integration regression that supplies an actual semantic document.
            request['components']=request['components'][:1]
            path=f.root/'capabilities.json';write_json(path,request)
            result=batch.freeze(f.plan_path,f.workspace,'capability-valid',capability_request=path)
            run=f.workspace/'runs/capability-valid';self.assertIn('capability_preflight',result);batch.load(run)
            snapshot=json.loads((run/'capability-request.json').read_text())
            self.assertEqual(snapshot,request)
            self.assertEqual(audit(snapshot)['planDigest'],digest(f.plan))
            with (run/'capability-request.json').open('a') as out:out.write(' ')
            with self.assertRaisesRegex(ContractError,'CAPABILITY_SNAPSHOT_CHANGED'):batch.load(run)
            path=f.root/'unsupported.json';request['components'][0]['profiles']=['not-supported'];write_json(path,request)
            with self.assertRaisesRegex(ContractError,'CAPABILITY_UNSUPPORTED_BEFORE_FREEZE'):batch.freeze(f.plan_path,f.workspace,'blocked',capability_request=path)
            self.assertFalse((f.workspace/'runs/blocked').exists())
            path=f.root/'stale.json';request=self.request();write_json(path,request)
            with self.assertRaisesRegex(ContractError,'CAPABILITY_PLAN_MISMATCH'):batch.freeze(f.plan_path,f.workspace,'stale',capability_request=path)
            self.assertFalse((f.workspace/'runs/stale').exists())
        finally:f.tearDown()
