"""Offline warning-mode regressions: honest findings continue, technical failures stop."""
import _bootstrap
import copy
import json
from pathlib import Path
import unittest
from unittest.mock import patch

from jsonschema import ValidationError
from ai_ui_layers import visual_policy, sheet_review_policy, relation_review, host_delivery as host
from ai_ui_layers import host_body_profile
from ai_ui_layers.body_registration import fit_body, FIT_POLICY
from ai_ui_layers.evaluate import read, save
from test_host_material_review import HostEvidence
import test_host_m1 as fresh_fixtures
import test_host_delivery as delivery_fixtures
import test_visual_policy as visual_fixtures
import test_body_registration as body_fixtures
from ai_ui_layers.body_viewport_delivery import validate_contract


def rewrite(path, value):
    Path(path).write_text(json.dumps(value,ensure_ascii=False),encoding='utf-8')


def finding(category='style', **changes):
    return visual_fixtures.observation(category=category, magnitude='major', styleAspect='other', **changes)


class VisualWarningTests(unittest.TestCase):
    def test_every_visual_category_preserves_severity_and_evidence_as_warning(self):
        policy=visual_policy.warning_policy()
        for category in sheet_review_policy.CATEGORIES:
            for magnitude in ('minor','major','uncertain'):
                answer=finding(category)
                item=answer['findings'][0];item['magnitude']=magnitude;item['ownership']='ambiguous'
                if category=='progress':
                    item.update(referenceState='empty', generatedState='full')
                result=sheet_review_policy.classify(answer,['asset-coin-a'],policy)
                with self.subTest(category=category,magnitude=magnitude):
                    self.assertFalse(result['blockers'])
                    self.assertEqual(result['decisions'][0],dict(item,severity='warning',attribution='planning-or-localization-unresolved'))
                    self.assertEqual(result['warnings'][0]['magnitude'],magnitude)

    def test_p05_major_surface_and_p10_minor_glint_no_longer_stop_new_policy(self):
        for category,magnitude in (('style','major'),('extra-artwork','minor')):
            answer=finding(category);answer['findings'][0]['magnitude']=magnitude
            old=visual_policy.warning_policy();old.pop('findingDisposition');old['kind']='ui_visual_policy_v4'
            self.assertTrue(sheet_review_policy.classify(answer,['asset-coin-a'],old)['blockers'])
            self.assertFalse(sheet_review_policy.classify(answer,['asset-coin-a'],visual_policy.warning_policy())['blockers'])

    def test_warning_does_not_accept_invalid_identity_schema_or_states(self):
        policy=visual_policy.warning_policy()
        for mutate in (lambda a:a.update(materialIds=['other']),
                       lambda a:a['findings'][0].update(materialId='other'),
                       lambda a:a['findings'][0].update(referenceState='full'),
                       lambda a:a['findings'][0].update(styleAspect='invalid')):
            answer=finding();mutate(answer)
            with self.assertRaises((ValueError,ValidationError)):
                sheet_review_policy.classify(answer,['asset-coin-a'],policy)
        bad=visual_policy.warning_policy();bad['minorGeometry']='strict'
        with self.assertRaises(ValueError):visual_policy.validate(bad)

    def test_uniform_residual_and_aspect_are_recorded_without_stretch(self):
        policy=visual_policy.warning_policy()
        fit=dict(kind=FIT_POLICY,maximumResidualPixels=1,denseBoundaryMarginPixels=4)
        scale,report=fit_body([100,100],[200,50],policy,fit)
        self.assertEqual(scale,1.25)
        self.assertEqual(report['visualFitWarnings'],['BODY_PROPORTIONS_GROSSLY_DIFFER','UNIFORM_FIT_RESIDUAL_EXCEEDED'])
        self.assertFalse(report['axisStretch']);self.assertFalse(report['humanVisualAcceptance'])
        old=copy.deepcopy(policy);old.pop('findingDisposition');old['kind']='ui_visual_policy_v4'
        with self.assertRaisesRegex(ValueError,'BODY_PROPORTIONS_GROSSLY_DIFFER'):
            fit_body([100,100],[200,50],old,fit)

    def test_body_correspondence_and_dense_alpha_remain_required(self):
        fixture=body_fixtures.BodyRegistrationTests();fixture.setUp();self.addCleanup(fixture.doCleanups)
        for changes,code in ((dict(source_body=[25,22,45,32]),'SOURCE_BODY_OMITS_DENSE_ARTWORK'),
                            (dict(observation_changes=dict(boundaryStatus='uncertain')),'BODY_OBSERVATION_UNRESOLVED')):
            entry=fixture.bound_entry(**changes)
            with self.assertRaisesRegex(ValueError,code):
                validate_contract(fixture.source,fixture.reference,entry,fixture.region,
                    fixture.material_id,fixture.snapshot_digest,visual_policy=visual_policy.warning_policy())

    def test_shared_prompt_contract_does_not_minimize_findings(self):
        policy=visual_policy.warning_policy()
        for text in (visual_policy.planning_guidance(policy),visual_policy.generation_guidance(policy),
                     visual_policy.output_review_guidance(policy)):
            self.assertIn('ui-visual-prompt-contract-v1',text)
            self.assertIn('唯一归属',text)
        review=visual_policy.output_review_guidance(policy)
        self.assertIn('不为通过而降级或省略',review)
        self.assertIn('独立轮廓与归属依据',review)
        self.assertNotIn('主要、无法判断或归属不清的外观变化仍阻断',review)
        body=host_body_profile.guidance(policy)
        self.assertIn('无法可靠完成主体对应和测量',body)
        self.assertNotIn('major or uncertain',body)
        generated=visual_policy.generation_guidance(policy)
        self.assertIn('合板请求按冻结格位',generated)

    def test_warning_config_is_frozen_and_conflicting_policy_is_rejected_before_creation(self):
        fixture=fresh_fixtures.FreshHostM1Tests();fixture.setUp();self.addCleanup(fixture.doCleanups)
        config=read(fixture.fresh_config);config['visualReviewMode']='warning'
        source=fixture.base/'mode.json';save(source,config)
        run=fixture.base/'warning';current=host.prepare(source,run)
        self.assertEqual(current['visualReviewMode'],'warning')
        self.assertFalse(current['strictVisualReviewPassed'])
        frozen=Path(read(run/'config.json')['visualPolicy'])
        self.assertEqual(read(frozen),visual_policy.warning_policy())
        prompt=(run/'planning-m1/prompt.md').read_text('utf-8')
        self.assertEqual(prompt.count('ui-visual-prompt-contract-v1'),1)
        for change,code in ((dict(visualReviewMode='unknown'),'VISUAL_REVIEW_MODE_UNSUPPORTED'),
                            (dict(bodyObservationPolicy='host-body-observation-v1'),'REQUIRES_ALPHA_BODY_PROFILE')):
            bad=dict(config,**change);path=fixture.base/(code+'.json');save(path,bad)
            output=fixture.base/code
            with self.assertRaisesRegex(ValueError,code):host.prepare(path,output)
            self.assertFalse(output.exists())
        policy=visual_policy.warning_policy();policy.pop('findingDisposition');policy['kind']='ui_visual_policy_v4'
        path=fixture.base/'old-policy.json';save(path,policy)
        config['visualPolicy']=str(path);source=fixture.base/'conflicting.json';save(source,config)
        output=fixture.base/'conflicting'
        with self.assertRaisesRegex(ValueError,'WARNING_MODE_REQUIRES_V5_POLICY_NEW_RUN'):host.prepare(source,output)
        self.assertFalse(output.exists())

    def test_relation_observations_are_warnings_but_invalid_plan_structure_blocks(self):
        from ai_ui_layers.compile_visual import HARNESS
        plan=read(HARNESS/'planning-harness/examples/visual-plan-scoped.json')
        for material in plan['materials']:
            if material['role']=='foreground':
                material.update(zOrder=1,bboxNorm=[0,0,1,1])
        bound=relation_review.catalog(plan,'a'*64)
        self.assertTrue(bound['pairs'])
        review=dict(relationReview=dict(catalogDigest=bound['digest'],candidateDigest=bound['candidateDigest'],
            referenceSha256=bound['referenceSha256'],pairs={row['pairId']:dict(disposition='uncertain',
                sourceEvidence='Visible contours may overlap.',ownershipEvidence='Independent owners are declared.')
                for row in bound['pairs']}))
        strict=relation_review.assess(plan,'a'*64,review)
        warning=relation_review.assess(plan,'a'*64,review,visual_policy.warning_policy())
        self.assertTrue(strict['blockers']);self.assertFalse(warning['blockers']);self.assertTrue(warning['warnings'])
        relation_review.validate_assessment(plan,'a'*64,warning,visual_policy.warning_policy())
        with self.assertRaisesRegex(ValueError,'RELATION_ASSESSMENT_CHANGED'):
            relation_review.validate_assessment(plan,'a'*64,warning)
        plan['materials'][0]['zOrder']=9
        bound=relation_review.catalog(plan,'a'*64)
        review['relationReview'].update(catalogDigest=bound['digest'],candidateDigest=bound['candidateDigest'])
        self.assertTrue(relation_review.assess(plan,'a'*64,review,visual_policy.warning_policy())['blockers'])

    def test_real_m1_fixture_runs_to_package_with_m2_material_ownership_and_body_warnings(self):
        fixture=fresh_fixtures.FreshHostM1Tests();fixture.setUp();self.addCleanup(fixture.doCleanups)
        config=read(fixture.fresh_config);config.update(visualReviewMode='warning',generationMode='single')
        path=fixture.base/'warning-config.json';save(path,config)
        fixture.run=fixture.base/'warning-run';host.prepare(path,fixture.run);fixture.root=fixture.run/'planning'
        fixture.plan['unknowns']=['Surface interpretation needs final human review.']
        original_material=HostEvidence.response
        original_planning=delivery_fixtures.review_fixtures.HostReviewTests.response_doc
        original_receive=host.receive

        def planning_answer(owner):
            answer=original_planning(owner)
            answer['issues'].append(dict(code='VISUAL_DESCRIPTION_VARIATION',category='semantic',
                ids=['asset-panel'],description='Surface wording may omit a gradient.',suggestedChange='Review the final image.'))
            for entry in answer['smallMaterialAudit'].values():
                for part in entry['parts']:part['deferredAppearance']=None
            return answer

        def material_answer(owner,folder,answer=None,raw=None,reviewer='fixture-independent-reviewer'):
            request=read(folder/'request.json');answer=finding()
            answer['materialIds']=request['materialIds'];answer['findings'][0]['materialId']=request['materialIds'][0]
            evidence=original_material(owner,folder,answer=answer,raw=raw,reviewer=reviewer)
            doc=read(evidence['response'])
            for row in doc['ownershipObservations']:
                if row['foreign']:
                    row['foreign'][0].update(state='present',evidence='Fixture duplicate foreign object observed.')
            rewrite(evidence['response'],doc)
            from ai_ui_layers.evaluate import digest
            att=read(evidence['host_attestation']);att['responseSha256']=digest(evidence['response'])
            rewrite(evidence['host_attestation'],att);evidence['response_sha256']=digest(evidence['response'])
            return evidence

        def receive(run,submission,response,**kwargs):
            if host.status(run)['stage']=='body_observation':
                doc=read(response);doc['materialIssues']=['Major surface gloss difference, with measurable complete body.']
                rewrite(response,doc)
                from ai_ui_layers.evaluate import digest
                att=read(kwargs['host_attestation']);att['responseSha256']=digest(Path(response))
                rewrite(kwargs['host_attestation'],att)
            return original_receive(run,submission,response,**kwargs)

        with patch.object(HostEvidence,'response',material_answer),patch.object(
                delivery_fixtures.review_fixtures.HostReviewTests,'response_doc',planning_answer),patch.object(host,'receive',receive):
            fixture.test_complete_from_original_to_delivery_offline_fixture()
        report=read(fixture.run/'visual-warning-report.json')
        self.assertGreater(report['warningCount'],0)
        self.assertFalse(report['strictVisualReviewPassed']);self.assertFalse(report['humanVisualAcceptance'])
        self.assertTrue(any(row['code']=='PLANNING_UNKNOWN' for row in report['planning']))
        self.assertTrue(any(row['category']=='visual-ownership' for row in report['material']))
        issues=read(fixture.run/'delivery/package/review.json')['issues']
        self.assertTrue(any('Major surface gloss' in row for row in issues))
        self.assertTrue(any('visual-style' in row for row in issues))
        self.assertTrue(any('VISUAL_DESCRIPTION_VARIATION' in row for row in issues))
        self.assertTrue((fixture.run/'delivery/viewport-ui-layers.zip').is_file())


if __name__=='__main__':unittest.main()
