"""Fresh M1 host regressions. All responses and media are offline fixtures."""
import _bootstrap
import unittest
from jsonschema import Draft202012Validator, ValidationError
from ai_ui_layers import host_delivery as host, host_m1, host_review
from ai_ui_layers.evaluate import read, save, digest
from ai_ui_layers.freeze_visual import inspect
from ai_ui_layers.review_evidence import build_catalog, build_review_schema, PROTOCOL_V4
import test_host_delivery as delivery_fixtures


class FreshHostM1Tests(unittest.TestCase):
    def setUp(self):
        delivery_fixtures.HostDeliveryTests.setUp(self)
        config=read(self.config_path);config.pop('seed')
        config.update(planningMode=host_m1.MODE,m1Planner='fixture-author')
        self.fresh_config=self.base/'fresh-config.json';save(self.fresh_config,config)
        self.run=self.base/'fresh-integrated';host.prepare(self.fresh_config,self.run)
        self.root=self.run/'planning'

    def generate(self, invalid=False, wrong_actor=False):
        current=host.status(self.run)
        host.authorize(self.run,current['scopeDigest'],'Offline M1 fixture only')
        request=host.next_request(self.run)
        save(self.response,{'invalid':'Original invalid fixture'} if invalid else self.plan)
        save(self.attestation,dict(kind='ui_host_m1_attestation_v1',
            requestSha256=request['requestSha256'],responseSha256=digest(self.response),
            plannerId='wrong-planner' if wrong_actor else 'fixture-author',
            model=request['model'],effort=request['effort'],hostAssertedModelResponse=True,
            notProviderReceipt=True,notCryptographicallyPlatformVerified=True,
            dispatchEvidenceSha256=digest(self.dispatch),returnEvidenceSha256=digest(self.response)))
        return host.receive(self.run,request['submissionDigest'],self.response,
            host_attestation=self.attestation,dispatch_evidence=self.dispatch,return_evidence=self.response)

    def planning(self):
        self.generate()
        self.review()

    def review(self):
        self.response=self.base/'m2-response.json'
        delivery_fixtures.HostDeliveryTests.planning(self)

    def test_prepare_is_from_original_and_does_not_execute_m1(self):
        current=host.status(self.run)
        self.assertEqual(current['stage'],'planning_generate')
        self.assertFalse(current['m1ModelExecuted'])
        self.assertFalse(current['FullReferenceToDeliveryExecutionCompleted'])
        self.assertFalse((self.run/'planning').exists())
        request=read(self.run/'planning-m1/request.json')
        self.assertEqual(set(request['inputs']),{'reference.png','prompt.md','schema.json'})
        self.assertFalse(request['oldPlanInputReused']);self.assertFalse(request['oldImageReused'])
        scope=read(self.run/'scopes/planning_generate/scope.json')
        self.assertEqual(scope['plannerId'],'fixture-author');self.assertNotIn('reviewerId',scope)
        with self.assertRaisesRegex(ValueError,'AUTHORIZATION_REQUIRED'):host.next_request(self.run)
        for key in ('seed','reviewedSnapshot','materialReuse','visualTextures','backgroundRegion'):
            config=read(self.fresh_config);config[key]=str(self.candidate)
            path=self.base/(key+'-config.json');save(path,config)
            with self.assertRaisesRegex(ValueError,'FORBIDS_PREPLANNED'):
                host.prepare(path,self.base/(key+'-run'))
            self.assertFalse((self.base/(key+'-run')).exists())

    def test_reserved_m1_cannot_be_resubmitted_or_replaced_by_seed(self):
        current=host.status(self.run);host.authorize(self.run,current['scopeDigest'],'Fixture only')
        request=host.next_request(self.run)
        with self.assertRaisesRegex(ValueError,'NO_RESUBMIT'):host.next_request(self.run)
        self.assertFalse(host.resume(self.run)['m1ModelExecuted'])
        host.fail(self.run,request['submissionDigest'],'Unknown fixture dispatch')
        self.assertEqual(host.status(self.run)['status'],'failed_no_retry')
        self.assertFalse(host.status(self.run)['m1ModelExecuted'])

    def test_actual_m1_bytes_are_bound_to_new_independent_m2_and_freeze(self):
        before=host.status(self.run)['scopeDigest'];current=self.generate()
        self.assertEqual(current['stage'],'planning_review');self.assertTrue(current['m1ModelExecuted'])
        self.assertNotEqual(before,current['scopeDigest'])
        self.assertEqual((self.run/'planning-m1/draft.json').read_bytes(),self.response.read_bytes())
        self.assertEqual((self.root/'m1/draft.json').read_bytes(),self.response.read_bytes())
        seed=read(self.root/'m1/seed.json')
        self.assertEqual(seed['kind'],'ui_host_generated_candidate_v1');self.assertTrue(seed['m1ModelExecuted'])
        self.assertNotIn('offlineCandidateSeed',read(self.root/'.dag/config.json'))
        with self.assertRaisesRegex(ValueError,'AUTHORIZATION_REQUIRED'):host.next_request(self.run)
        changed=self.base/'changed-candidate.json';changed.write_bytes(self.response.read_bytes()+b' ')
        with self.assertRaisesRegex(ValueError,'CANDIDATE_BINDING'):
            host_m1.bind_candidate(self.run/'planning-m1',changed,['fixture-author'],digest(self.reference))
        self.review()
        frozen=self.run/'frozen';snapshot=read(frozen/'snapshot.json')
        self.assertFalse(snapshot['offlineCandidateSeed']);self.assertTrue(snapshot['m1ModelExecuted'])
        host_review.verify_frozen(frozen,snapshot,self.plan)
        proof=frozen/'evidence/prepared/m1/source/draft.json'
        proof.write_bytes(proof.read_bytes()+b' ')
        with self.assertRaisesRegex(ValueError,'CHANGED'):inspect(frozen,snapshot['digest'])

    def test_invalid_real_m1_preserves_origin_and_terminal_answer(self):
        with self.assertRaises(ValidationError):self.generate(invalid=True)
        current=host.status(self.run)
        self.assertEqual(current['status'],'failed_no_retry');self.assertTrue(current['m1ModelExecuted'])
        self.assertFalse(current['FullReferenceToDeliveryExecutionCompleted'])
        self.assertEqual((self.run/'planning-m1/draft.json').read_bytes(),self.response.read_bytes())
        self.assertFalse((self.run/'planning-m1/accepted.json').exists())
        self.assertFalse(self.root.exists())

    def test_wrong_planner_retains_rejected_original_without_claiming_m1(self):
        with self.assertRaisesRegex(ValueError,'FROZEN_HOST_REVIEWER'):self.generate(wrong_actor=True)
        self.assertFalse(host.status(self.run)['m1ModelExecuted'])
        rejected=list((self.run/'rejected').glob('*/response'))
        self.assertEqual(len(rejected),1);self.assertEqual(rejected[0].read_bytes(),self.response.read_bytes())

    def test_complete_from_original_to_delivery_offline_fixture(self):
        delivery_fixtures.HostDeliveryTests.test_complete_sheet_workflow_separate_scopes_and_delivered_comparison(self)
        # The shared workflow intentionally mutates its final comparison last;
        # read the last program checkpoint, without declaring changed outputs valid.
        last=read(self.run/'state.json')
        self.assertEqual(last['stage'],'complete')
        self.assertTrue(read(self.run/'frozen/snapshot.json')['m1ModelExecuted'])


class DeferredAppearanceSchemaTests(unittest.TestCase):
    def test_v4_schema_disallows_previous_conflicting_p06_fields(self):
        plan=dict(materials=[dict(id='badge',label='Small silver badge',bboxNorm=[.1,.1,.2,.2])],objects=[])
        focus=dict(items=[dict(materialId='badge')],boundaryOnlyItems=[])
        policy=dict(kind='ui_visual_policy_v4',appearanceEvidence='bound-reference',minorColor='record',
                    shadow='optional',minorStyle='record',minorGeometry='record',minorLayout='record')
        catalog=build_catalog(plan)
        schema=build_review_schema(catalog,focus,policy,PROTOCOL_V4)
        part=schema['$defs']['smallMaterialAuditEntry']['properties']['parts']['items']
        validator=Draft202012Validator(part)
        value=dict(visiblePart='Badge',observedAppearance='Silver surface',planEvidenceId=catalog['entries'][0]['id'],
                   descriptionStatus='consistent',suggestedChange='None',deferredAppearance=None)
        validator.validate(value)
        for status in ('consistent','missing','conflicting','uncertain'):
            invalid={**value,'descriptionStatus':status,'deferredAppearance':'Minor gray variation is reference-bound.'}
            with self.assertRaises(ValidationError):validator.validate(invalid)
        validator.validate({**value,'descriptionStatus':'reference-bound','deferredAppearance':'Silver surface in reference.'})
        for deferred in (None,'','   '):
            with self.assertRaises(ValidationError):
                validator.validate({**value,'descriptionStatus':'reference-bound','deferredAppearance':deferred})


if __name__=='__main__':unittest.main()
