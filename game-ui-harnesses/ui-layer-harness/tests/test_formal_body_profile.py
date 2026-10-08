"""Actual-alpha/measurement regressions; all model returns are explicit fixtures."""
import _bootstrap
import unittest
from pathlib import Path
from unittest.mock import patch
from PIL import Image

import test_host_body_observation as fixtures
from ai_ui_layers import host_body_observation as host, host_body_profile as profile
from ai_ui_layers import body_registration as registration
from ai_ui_layers.evaluate import read, save, digest
from ai_ui_layers.experimental_executor import record


def appearance_policy():
    return dict(kind='ui_visual_policy_v4',appearanceEvidence='bound-reference',minorColor='record',
        shadow='optional',minorStyle='record',minorGeometry='record',minorLayout='record')


class FormalBodyProfileTests(unittest.TestCase):
    setUp = fixtures.HostBodyObservationTests.setUp
    start = fixtures.HostBodyObservationTests.start
    evidence = fixtures.HostBodyObservationTests.evidence
    receive = fixtures.HostBodyObservationTests.receive

    def enable(self):
        config = read(self.inputs); config['bodyObservationPolicy'] = profile.POLICY
        self.inputs.unlink(); save(self.inputs,config)
        self.answer.update(geometryDifferences=[], materialIssues=[])

    def test_actual_alpha_previews_hide_invisible_rgb_and_preserve_weak_alpha(self):
        self.enable()
        config=read(self.inputs)
        mid=next(m['id'] for m in self.visual['materials'] if m['role']=='foreground')
        source=Path(config['materials'][mid])
        with Image.open(source) as image: raw=image.convert('RGBA')
        raw.putpixel((0,0),(0,0,0,0));raw.putpixel((1,0),(255,0,0,1));raw.save(source)
        before=source.read_bytes();request=self.start();folder=self.job/'requests'/mid
        self.assertEqual(len(request['attachments']),6)
        self.assertEqual(len(request['inputs']),10)
        with Image.open(folder/'generated-light.png') as image:
            self.assertEqual(image.mode,'RGB');self.assertEqual(image.getpixel((0,0)),(240,240,240))
            self.assertNotEqual(image.getpixel((1,0)),(255,0,0))
        with Image.open(folder/'generated-dark.png') as image:
            self.assertEqual(image.getpixel((0,0)),(32,32,32))
        with Image.open(folder/'generated-alpha.png') as image:
            self.assertEqual(image.getpixel((1,0)),(1,1,1))
        self.assertEqual(source.read_bytes(),before)

    def test_resealed_wrong_composite_is_rejected_by_pixel_replay(self):
        self.enable();self.start()
        config=read(self.job/'job.json');mid=next(iter(config['requests']))
        path=self.job/'requests'/mid/'generated-light.png'
        with Image.open(path) as image: raw=image.copy()
        raw.putpixel((0,0),(1,2,3));raw.save(path)
        config['requests'][mid]['inputs'][path.name]=digest(path)
        del config['digest'];(self.job/'job.json').unlink();record(self.job/'job.json',config)
        with self.assertRaisesRegex(ValueError,'BODY_ACTUAL_ALPHA_DISPLAY_CHANGED'):host.load(self.job)

    def test_measurable_differences_survive_finish(self):
        self.enable();request=self.start()
        self.answer.update(geometryDifferences=['Complete body has a measurable size difference.'],
            materialIssues=[])
        while request is not None:
            self.receive(request,self.evidence(request));request=host.next_request(self.job)
        host.finish(self.job,self.output_config)
        output=read(self.output_config)
        self.assertEqual(output['bodyObservationPolicy'],profile.POLICY)
        self.assertTrue(all(w['geometryDifferences'] and not w['materialIssues'] and w['responseSha256']
                            for w in output['bodyObservationWarnings']))

    def test_strict_appearance_findings_cannot_be_recorded_as_tolerated(self):
        self.enable();request=self.start()
        answer=dict(self.answer,materialIssues=['Visible rim appearance difference.'])
        with self.assertRaisesRegex(ValueError,'BODY_APPEARANCE_FINDING_REQUIRES_EXPLICIT_TOLERANCE'):
            self.receive(request,self.evidence(request,answer=answer))
        self.assertEqual(host.status(self.job)['status'],'blocked_no_retry')

    def test_measurement_blocker_stays_terminal_despite_difference_fields(self):
        self.enable();request=self.start()
        answer=dict(self.answer,boundaryStatus='uncertain',sourceBodyBox=None,referenceCropBodyBox=None,
                    issues=['Occluded perimeter cannot be measured.'],geometryDifferences=['Source is taller.'])
        with self.assertRaisesRegex(ValueError,'BODY_OBSERVATION_UNRESOLVED'):
            self.receive(request,self.evidence(request,answer=answer))
        self.assertEqual(host.status(self.job)['status'],'blocked_no_retry')


class UniformBodyFitTests(unittest.TestCase):
    def setUp(self):
        self.policy=appearance_policy()
        self.fit=dict(kind=registration.FIT_POLICY,maximumResidualPixels=32,denseBoundaryMarginPixels=4)

    def test_complete_panel_uniform_fit_matches_observed_four_corner_solution(self):
        scale,report=registration.fit_body([816,1191],[713,986],self.policy,self.fit)
        self.assertAlmostEqual(scale,.8425384186914112)
        self.assertAlmostEqual(report['maximumCornerResidualPixels'],15.44859726461634)
        self.assertFalse(report['axisStretch'])
        old,_=registration.fit_body([816,1191],[713,986],self.policy)
        self.assertLess(old,scale)  # contain fitting caused the undersized panel

    def test_error_ceiling_and_strict_opt_in_cannot_be_weakened(self):
        with self.assertRaisesRegex(ValueError,'UNIFORM_FIT_RESIDUAL_EXCEEDED'):
            registration.fit_body([816,1191],[713,986],self.policy,dict(self.fit,maximumResidualPixels=10))
        with self.assertRaisesRegex(ValueError,'APPROXIMATE_VISUAL_POLICY_REQUIRED'):
            registration.fit_body([816,1191],[713,986],None,self.fit)
        with self.assertRaisesRegex(ValueError,'BODY_PROPORTIONS_DIFFER'):
            registration.fit_body([816,1191],[713,986])
        for value in (float('nan'),float('inf'),True,129,-1):
            with self.subTest(value=value),self.assertRaisesRegex(ValueError,'EXPLICIT_FINITE_BODY_FIT_POLICY'):
                registration.validate_fit_policy(dict(self.fit,maximumResidualPixels=value),self.policy)

    def test_dense_boundary_margin_is_bounded_and_does_not_trim_pixels(self):
        raw=Image.new('RGBA',(100,100));raw.paste((10,20,30,255),(10,10,90,90))
        before=raw.tobytes()
        report=registration.dense_body_margin(raw,[13,10,88,89],self.fit)
        self.assertEqual(report['outsideBodyPixels'],[3,0,2,1]);self.assertEqual(report['alphaPixelsRemoved'],0)
        self.assertEqual(raw.tobytes(),before)
        with self.assertRaisesRegex(ValueError,'SOURCE_BODY_OMITS_DENSE_ARTWORK'):
            registration.dense_body_margin(raw,[13,10,88,89])
        with self.assertRaisesRegex(ValueError,'SOURCE_BODY_OMITS_DENSE_ARTWORK'):
            registration.dense_body_margin(raw,[30,30,70,70],self.fit)

    def test_v2_source_replay_keeps_frozen_fit_and_legacy_receipt_shape(self):
        import test_body_registration as body_fixtures
        from ai_ui_layers.accepted_materials import replay
        fixture=body_fixtures.BodyRegistrationTests();fixture.setUp();self.addCleanup(fixture.doCleanups)
        entry=fixture.bound_entry(target_body=[70,45,150,83])
        legacy=registration.process(fixture.source,fixture.reference,entry,fixture.region,fixture.material_id,
            fixture.snapshot_digest,fixture.root/'legacy',policy=registration.POLICY_SUPPORT,visual_policy=self.policy)
        self.assertNotIn('denseBoundaryCheck',legacy['fitting'])
        result=registration.process(fixture.source,fixture.reference,entry,fixture.region,fixture.material_id,
            fixture.snapshot_digest,fixture.root/'v2',policy=registration.POLICY_SUPPORT,
            visual_policy=self.policy,fit_policy=self.fit)
        job=fixture.root/'received-job';(job/'snapshot').mkdir(parents=True)
        (job/'snapshot/reference.png').write_bytes(fixture.reference.read_bytes())
        selection=dict(job=str(job),requestId=fixture.material_id,sourceMaterialId=fixture.material_id)
        row=dict(id=fixture.material_id,sourceSha256=digest(fixture.source),report=result)
        placement=dict(sourceRegion=fixture.region,outputSize=[160,80])
        with patch('ai_ui_layers.accepted_materials.received',return_value=(fixture.source,{},{})), \
                patch('ai_ui_layers.visual_policy.snapshot_policy',return_value=self.policy):
            output,lineage=replay(selection,row,placement,'foreground',digest(fixture.reference),fixture.root/'replay')
        self.assertEqual(digest(output),result['materialSha256'])
        self.assertEqual(lineage['processing']['fitting'],result['fitting'])


if __name__=='__main__':unittest.main()
