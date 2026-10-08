"""Explicit offline fixtures for the solid-anchor/exterior-shadow conflict."""
import _bootstrap
import json
import unittest
from pathlib import Path
from unittest.mock import patch

from PIL import Image, ImageDraw
from jsonschema import ValidationError

import test_host_body_observation as host_fixtures
import test_body_registration as body_fixtures
from test_formal_body_profile import appearance_policy
from ai_ui_layers import body_coverage as coverage, body_registration as registration
from ai_ui_layers import host_body_profile as profile, host_body_observation as host
from ai_ui_layers.body_viewport_delivery import validate_contract
from ai_ui_layers.evaluate import read, save, digest


def declarations(state='external-soft-effect'):
    return [dict(side=side,classification=state,evidence='Offline fixture: inspected exterior support.')
            for side in coverage.SIDES]


def panel():
    raw=Image.new('RGBA',(100,100))
    draw=ImageDraw.Draw(raw)
    # Eight-pixel connected, nonopaque exterior; no alpha processing occurs.
    for distance in range(8,0,-1):
        draw.rectangle((20-distance,15-distance,79+distance,84+distance),
                       fill=(230,150,100,220-10*distance))
    draw.rectangle((20,15,79,84),fill=(250,245,235,255))
    raw.putpixel((1,1),(240,120,60,1))
    return raw


class BodyCoverageTests(unittest.TestCase):
    def setUp(self):
        self.raw=panel();self.body=[20,15,80,85]
        self.fit=dict(kind=registration.FIT_POLICY,maximumResidualPixels=32,denseBoundaryMarginPixels=4)

    def check(self,body=None,observations=None):
        return registration.dense_body_margin(self.raw,body or self.body,self.fit,
            coverage_policy=coverage.POLICY,outside_support=declarations() if observations is None else observations)

    def test_reviewed_connected_shadow_keeps_original_pixels_and_frozen_margin(self):
        before=self.raw.tobytes()
        with self.assertRaisesRegex(ValueError,'SOURCE_BODY_OMITS_DENSE_ARTWORK'):
            registration.dense_body_margin(self.raw,self.body,self.fit)
        checked=self.check()
        self.assertEqual(checked['outsideBodyPixels'],[8,8,8,8])
        self.assertEqual(checked['maximumNativeBoundaryMarginPixels'],4)
        self.assertGreater(checked['externalDensePixels'],0)
        self.assertFalse(checked['semanticClassificationProven'])
        self.assertEqual(checked['alphaPixelsRemoved'],0)
        self.assertEqual(self.raw.tobytes(),before)
        self.assertEqual(self.raw.getpixel((1,1))[3],1)

    def test_inner_icon_cannot_hide_opaque_backing_even_with_shadow_claim(self):
        with self.assertRaisesRegex(ValueError,'SOURCE_BODY_OMITS_SOLID_ARTWORK'):
            self.check([35,35,65,65])

    def test_near_opaque_external_art_is_never_shadow_exception(self):
        self.raw.putpixel((12,50),(200,100,80,240))
        with self.assertRaisesRegex(ValueError,'SOURCE_BODY_OMITS_SOLID_ARTWORK'):self.check()

    def test_disconnected_dense_island_is_rejected(self):
        self.raw.putpixel((3,3),(200,100,80,200))
        with self.assertRaisesRegex(ValueError,'DETACHED_DENSE_EXTERNAL_EFFECT'):self.check()

    def test_none_owned_and_uncertain_do_not_authorize_dense_exterior(self):
        for state,reason in [('none','UNREVIEWED_DENSE_EXTERNAL_EFFECT'),
                ('owned-artwork','OUTSIDE_BODY_OBSERVATION_UNRESOLVED'),
                ('uncertain','OUTSIDE_BODY_OBSERVATION_UNRESOLVED')]:
            with self.subTest(state=state),self.assertRaisesRegex(ValueError,reason):
                self.check(observations=declarations(state))

    def test_complete_unique_observations_and_explicit_policy_are_required(self):
        invalid=declarations();invalid[3]=invalid[0]
        for rows in ([],invalid,declarations()[:3]):
            with self.subTest(rows=rows),self.assertRaisesRegex(ValueError,'COMPLETE_OUTSIDE_BODY_OBSERVATIONS'):
                self.check(observations=rows)
        with self.assertRaisesRegex(ValueError,'EXTERNAL_EFFECTS_REQUIRE_EXPLICIT_COVERAGE_POLICY'):
            registration.dense_body_margin(self.raw,self.body,self.fit,outside_support=declarations())
        with self.assertRaisesRegex(ValueError,'EXTERNAL_EFFECTS_REQUIRE_EXPLICIT_BODY_FIT'):
            registration.dense_body_margin(self.raw,self.body,coverage_policy=coverage.POLICY,outside_support=declarations())

    def test_wholly_translucent_anchor_requires_another_reviewed_method(self):
        self.raw.putalpha(200)
        with self.assertRaisesRegex(ValueError,'BODY_SOLID_CORE_NOT_OBSERVABLE'):self.check()


class SoftEffectsHostTests(unittest.TestCase):
    setUp=host_fixtures.HostBodyObservationTests.setUp
    start=host_fixtures.HostBodyObservationTests.start
    evidence=host_fixtures.HostBodyObservationTests.evidence
    receive=host_fixtures.HostBodyObservationTests.receive

    def enable(self):
        # Snapshot policy is a fixture double; no actual run is altered.
        self.policy_patch=patch('ai_ui_layers.visual_policy.snapshot_policy',return_value=appearance_policy())
        self.policy_patch.start();self.addCleanup(self.policy_patch.stop)
        config=read(self.inputs)
        config.update(bodyObservationPolicy=profile.SOFT_EFFECTS,bodyCoveragePolicy=coverage.POLICY,
            bodyFitPolicy=dict(kind=registration.FIT_POLICY,maximumResidualPixels=32,denseBoundaryMarginPixels=4))
        self.inputs.unlink();save(self.inputs,config)
        for material in self.visual['materials']:
            if material['role']!='foreground':continue
            path=Path(config['materials'][material['id']]);image=Image.new('RGBA',(30,30));draw=ImageDraw.Draw(image)
            for distance in range(8,0,-1):
                draw.rectangle((10-distance,10-distance,19+distance,19+distance),fill=(180,120,80,220-10*distance))
            draw.rectangle((10,10,19,19),fill=(100,80,60,255));image.putpixel((1,10),(50,30,20,1));image.save(path)
        self.answer.update(geometryDifferences=[],materialIssues=[],outsideBodySupport=declarations())

    def test_v3_original_responses_bind_typed_contracts_and_finish(self):
        self.enable();request=self.start()
        while request is not None:
            self.receive(request,self.evidence(request))
            contract=read(self.job/'attempts'/request['materialId']/'body-contract.json')
            self.assertEqual(contract['kind'],coverage.CONTRACT_KIND)
            self.assertEqual(contract[coverage.FIELD],self.answer[coverage.FIELD])
            self.assertEqual(read(self.job/'requests'/request['materialId']/'schema.json'),profile.schema(profile.SOFT_EFFECTS))
            request=host.next_request(self.job)
        host.finish(self.job,self.output_config)
        config=read(self.output_config)
        self.assertEqual(config['bodyCoveragePolicy'],coverage.POLICY)
        self.assertTrue(all(coverage.FIELD in row for row in config['bodyObservationWarnings']))
        self.assertFalse(host.status(self.job)['humanVisualAcceptance'])

    def test_v2_answer_cannot_be_silently_promoted_and_failure_is_terminal(self):
        self.enable();request=self.start();del self.answer[coverage.FIELD]
        with self.assertRaises(ValidationError):self.receive(request,self.evidence(request))
        self.assertEqual(host.status(self.job)['status'],'blocked_no_retry')
        with self.assertRaisesRegex(ValueError,'NO_RESUBMIT'):host.next_request(self.job)

    def test_unknown_exterior_is_terminal(self):
        self.enable();request=self.start();self.answer[coverage.FIELD]=declarations('uncertain')
        with self.assertRaisesRegex(ValueError,'OUTSIDE_BODY_OBSERVATION_UNRESOLVED'):
            self.receive(request,self.evidence(request))
        self.assertEqual(host.status(self.job)['status'],'blocked_no_retry')

    def test_profile_policy_fit_binding_is_explicit(self):
        for policy,fit,cover in ((profile.POLICY,{},coverage.POLICY),
                (profile.SOFT_EFFECTS,None,coverage.POLICY),(profile.SOFT_EFFECTS,{},None)):
            with self.subTest(policy=policy),self.assertRaises(ValueError):profile.validate_binding(policy,fit,cover)


class SoftEffectsContractTests(unittest.TestCase):
    setUp=body_fixtures.BodyRegistrationTests.setUp
    make_source=body_fixtures.BodyRegistrationTests.make_source

    def test_both_processors_recheck_coverage_identity_and_source_replay(self):
        raw=panel();raw.save(self.source)
        self.region=[0,0,180,120];self.body=[20,15,80,85];self.target=[40,25,100,95]
        observation=dict(kind=coverage.OBSERVATION_KIND,snapshotDigest=self.snapshot_digest,materialId=self.material_id,
            sourceSha256=digest(self.source),referenceSha256=digest(self.reference),sourceBodyBox=self.body,
            targetBodyBox=self.target,boundaryStatus='complete',issues=[],outsideBodySupport=declarations())
        save(self.evidence,observation)
        contract={k:v for k,v in observation.items() if k!='boundaryStatus'}
        contract.update(kind=coverage.CONTRACT_KIND,evidence=dict(path=str(self.evidence),sha256=digest(self.evidence),basis='Offline fixture only.'))
        path=self.root/'contract.json';save(path,contract);entry=dict(path=str(path),sha256=digest(path))
        fit=dict(kind=registration.FIT_POLICY,maximumResidualPixels=32,denseBoundaryMarginPixels=4)
        common=dict(visual_policy=appearance_policy(),fit_policy=fit,coverage_policy=coverage.POLICY)
        checked=validate_contract(self.source,self.reference,entry,self.region,self.material_id,self.snapshot_digest,**common)
        result=registration.process(self.source,self.reference,entry,self.region,self.material_id,self.snapshot_digest,
            self.root/'processed',policy=registration.POLICY_SUPPORT,**common)
        self.assertEqual(checked['geometry']['denseBoundaryCheck'],result['fitting']['denseBoundaryCheck'])
        self.assertEqual(result['fitting']['bodyCoveragePolicy'],coverage.POLICY)
        self.assertEqual(digest(self.source),observation['sourceSha256'])
        from ai_ui_layers.accepted_materials import replay
        job=self.root/'replay-job';(job/'snapshot').mkdir(parents=True)
        (job/'snapshot/reference.png').write_bytes(self.reference.read_bytes())
        selection=dict(job=str(job),requestId=self.material_id,sourceMaterialId=self.material_id)
        with patch('ai_ui_layers.accepted_materials.received',return_value=(self.source,{},{})), \
                patch('ai_ui_layers.visual_policy.snapshot_policy',return_value=appearance_policy()):
            output,lineage=replay(selection,dict(id=self.material_id,sourceSha256=digest(self.source),report=result),
                dict(sourceRegion=self.region,outputSize=[180,120]),'foreground',digest(self.reference),self.root/'replay')
        self.assertEqual(digest(output),result['materialSha256'])
        self.assertEqual(lineage['processing']['fitting'],result['fitting'])
        with self.assertRaisesRegex(ValueError,'BODY_CONTRACT_KIND_OR_FIELDS'):
            validate_contract(self.source,self.reference,entry,self.region,self.material_id,self.snapshot_digest,
                visual_policy=appearance_policy(),fit_policy=fit)
        observation[coverage.FIELD]=[dict(row) for row in observation[coverage.FIELD]]
        observation[coverage.FIELD][0]['classification']='none';self.evidence.write_text(json.dumps(observation),encoding='utf-8')
        contract['evidence']['sha256']=digest(self.evidence);path.write_text(json.dumps(contract),encoding='utf-8');entry['sha256']=digest(path)
        with self.assertRaisesRegex(ValueError,'BODY_OBSERVATION_SCOPE_MISMATCH'):
            validate_contract(self.source,self.reference,entry,self.region,self.material_id,self.snapshot_digest,**common)


if __name__=='__main__':unittest.main()
