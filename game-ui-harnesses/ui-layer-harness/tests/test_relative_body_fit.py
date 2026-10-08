"""Scale-aware whole-body tolerance; offline geometry and host fixture exchanges."""
import _bootstrap
import json
import math
import unittest
from pathlib import Path
from unittest.mock import patch

from ai_ui_layers import body_registration as registration, host_delivery as host
from ai_ui_layers.evaluate import read, save, digest
from test_formal_body_profile import appearance_policy
import test_host_delivery as delivery_fixtures


def relative_policy(**changes):
    result=dict(kind=registration.RELATIVE_FIT_POLICY,maximumResidualPixels=64,
        minimumResidualPixels=4,maximumResidualFraction=.04,denseBoundaryMarginPixels=4)
    result.update(changes)
    return result


class RelativeFitTests(unittest.TestCase):
    def fit(self,source,target,policy=None):
        return registration.fit_body(source,target,appearance_policy(),policy or relative_policy())

    def test_measured_panel_case_records_scale_relative_limit_without_stretch(self):
        # Geometry only from the real failed case; no archived pixels or success assertion.
        scale,result=self.fit([918,1127],[713,986])
        self.assertAlmostEqual(result['maximumCornerResidualPixels'],34.94751075634268)
        self.assertAlmostEqual(result['effectiveMaximumResidualPixels'],math.hypot(713,986)*.04)
        self.assertLess(result['maximumCornerResidualPixels'],result['effectiveMaximumResidualPixels'])
        self.assertEqual(result['fittedBodySize'],[918*scale,1127*scale])
        self.assertFalse(result['axisStretch']);self.assertFalse(result['humanVisualAcceptance'])
        self.assertEqual(result['kind'],'ui_approximate_body_fit_v3')
        with self.assertRaisesRegex(ValueError,'UNIFORM_FIT_RESIDUAL_EXCEEDED'):
            registration.fit_body([918,1127],[713,986],appearance_policy(),
                dict(kind=registration.FIT_POLICY,maximumResidualPixels=32,denseBoundaryMarginPixels=4))

    def test_unclamped_relative_error_and_decision_are_invariant_under_scale(self):
        _,small=self.fit([200,270],[100,150])
        _,large=self.fit([400,540],[200,300])
        self.assertAlmostEqual(small['cornerResidualFraction'],large['cornerResidualFraction'])
        self.assertAlmostEqual(small['effectiveMaximumResidualPixels']*2,large['effectiveMaximumResidualPixels'])
        self.assertAlmostEqual(small['maximumCornerResidualPixels']*2,large['maximumCornerResidualPixels'])

    def test_small_controls_do_not_inherit_large_panel_absolute_allowance(self):
        _,tiny=self.fit([20,30],[10,17])
        self.assertEqual(tiny['effectiveMaximumResidualPixels'],4)
        with self.assertRaisesRegex(ValueError,'UNIFORM_FIT_RESIDUAL_EXCEEDED'):
            self.fit([100,100],[100,80])

    def test_absolute_cap_still_stops_large_reference(self):
        with self.assertRaisesRegex(ValueError,'UNIFORM_FIT_RESIDUAL_EXCEEDED'):
            self.fit([918,1127],[1426,1972])

    def test_gross_proportion_guard_still_stops_deformation(self):
        with self.assertRaisesRegex(ValueError,'BODY_PROPORTIONS_GROSSLY_DIFFER'):
            self.fit([100,100],[100,40])

    def test_exact_relative_ceiling_and_below_boundary(self):
        _,measured=self.fit([100,100],[100,90])
        policy=relative_policy();policy['minimumResidualPixels']=0
        policy['maximumResidualFraction']=measured['cornerResidualFraction']
        self.fit([100,100],[100,90],policy)
        policy['maximumResidualFraction']-=1e-6
        with self.assertRaisesRegex(ValueError,'UNIFORM_FIT_RESIDUAL_EXCEEDED'):
            self.fit([100,100],[100,90],policy)

    def test_policy_is_explicit_finite_and_requires_recorded_minor_geometry(self):
        values=[('maximumResidualFraction',v) for v in (0,-1,.051,True,float('nan'),float('inf'))]
        values += [('minimumResidualPixels',v) for v in (-1,9,True,float('nan'),float('inf'))]
        values += [('maximumResidualPixels',v) for v in (3,129,True,float('nan'),float('inf'))]
        for key,value in values:
            policy=relative_policy();policy[key]=value
            with self.subTest(key=key,value=value),self.assertRaisesRegex(ValueError,'EXPLICIT_FINITE_BODY_FIT_POLICY'):
                registration.validate_fit_policy(policy,appearance_policy())
        for policy in ({**relative_policy(),'unknown':0},
                {k:v for k,v in relative_policy().items() if k!='maximumResidualFraction'}):
            with self.assertRaisesRegex(ValueError,'EXPLICIT_FINITE_BODY_FIT_POLICY'):
                registration.validate_fit_policy(policy,appearance_policy())
        for visual in (None,{**appearance_policy(),'minorGeometry':'strict'}):
            with self.assertRaisesRegex(ValueError,'APPROXIMATE_VISUAL_POLICY_REQUIRED'):
                registration.validate_fit_policy(relative_policy(),visual)


class RelativeHostTests(unittest.TestCase):
    def test_explicit_policy_survives_independent_exchanges_and_viewport_package(self):
        fixture=delivery_fixtures.HostDeliveryTests();fixture.setUp();self.addCleanup(fixture.doCleanups)
        visual=fixture.base/'relative-visual-policy.json';save(visual,appearance_policy())
        config=read(fixture.config_path);config.update(visualPolicy=str(visual),bodyFitPolicy=relative_policy())
        config_path=fixture.base/'relative-config.json';save(config_path,config)
        fixture.run=fixture.base/'relative-integrated';host.prepare(config_path,fixture.run)
        fixture.root=fixture.run/'planning'
        original_planning=delivery_fixtures.review_fixtures.HostReviewTests.response_doc
        original_receive=host.receive
        def planning_answer(owner):
            answer=original_planning(owner)
            for entry in answer['smallMaterialAudit'].values():
                for part in entry['parts']:part['deferredAppearance']=None
            return answer
        def receive(run,submission_digest,response,**kwargs):
            if host.status(run)['stage']=='body_observation':
                answer=read(response);box=answer['referenceCropBodyBox']
                box[3]=box[1]+max(1,round((box[3]-box[1])*.9))
                answer['geometryDifferences']=['Offline complete-body fixture differs in height by ten percent.']
                Path(response).write_text(json.dumps(answer),encoding='utf-8')
                evidence=read(kwargs['host_attestation']);evidence['responseSha256']=digest(Path(response))
                Path(kwargs['host_attestation']).write_text(json.dumps(evidence),encoding='utf-8')
            return original_receive(run,submission_digest,response,**kwargs)
        with patch.object(delivery_fixtures.review_fixtures.HostReviewTests,'response_doc',planning_answer), \
                patch.object(host,'receive',receive):
            fixture.test_complete_sheet_workflow_separate_scopes_and_delivered_comparison()
        for path in ('config.json','body/job.json','body-output.json'):
            self.assertEqual(read(fixture.run/path)['bodyFitPolicy'],relative_policy())
        proof=read(fixture.run/'delivery/body-provenance.json')
        for record in proof['records']:
            if record['role']!='foreground':continue
            geometry=record['geometry'];tolerance=geometry['appearanceTolerance']
            self.assertEqual(tolerance['kind'],'ui_approximate_body_fit_v3')
            self.assertEqual(tolerance['fitPolicy'],relative_policy())
            self.assertLessEqual(tolerance['maximumCornerResidualPixels'],tolerance['effectiveMaximumResidualPixels'])
            self.assertFalse(geometry['alphaSupportClipped'])
            self.assertEqual(geometry['denseBoundaryCheck']['alphaPixelsRemoved'],0)
        self.assertFalse(read(fixture.run/'delivery/package-result.json')['humanVisualAcceptance'])


if __name__=='__main__':unittest.main()
