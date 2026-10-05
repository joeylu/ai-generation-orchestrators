"""Offline regressions for explicitly accepted minor appearance deviations."""
import _bootstrap
import json
import unittest
from unittest.mock import patch

from ai_ui_layers.evaluate import read, save, digest
from ai_ui_layers.planning_dag import Dag
from ai_ui_layers.execution_preflight import preflight
from ai_ui_layers.sheet_review_policy import classify
from ai_ui_layers.visual_policy import validate, generation_guidance, output_review_guidance
from ai_ui_layers import host_delivery as host
import test_visual_policy as visual_fixtures
import test_host_delivery as delivery_fixtures
from test_host_material_review import HostEvidence


def policy(**changes):
    value=visual_fixtures.policy(kind='ui_visual_policy_v2',minorStyle='record')
    value.update(changes)
    return value


def observed(**changes):
    return visual_fixtures.observation(styleAspect='other',
        evidence='The surface grain is slightly smoother; the artwork and contour remain complete.',
        suggestion='Record this minor rendering difference.',**changes)


class MinorStyleTests(unittest.TestCase):
    def test_minor_texture_rendering_warns_only_with_explicit_v2_record(self):
        answer=observed()
        self.assertTrue(classify(answer,['asset-coin-a'],visual_fixtures.policy())['blockers'])
        self.assertTrue(classify(answer,['asset-coin-a'],policy(minorStyle='strict'))['blockers'])
        result=classify(answer,['asset-coin-a'],policy())
        self.assertFalse(result['blockers'])
        self.assertEqual(result['decisions'][0]['severity'],'warning')
        self.assertEqual(result['decisions'][0]['evidence'],answer['findings'][0]['evidence'])
        self.assertEqual(result['warnings'][0]['category'],'minor-style-deviation')

    def test_major_uncertain_or_ambiguous_style_is_never_advisory(self):
        for changes in (dict(magnitude='major'),dict(magnitude='uncertain'),dict(ownership='ambiguous')):
            with self.subTest(changes=changes):
                result=classify(observed(**changes),['asset-coin-a'],policy())
                self.assertTrue(result['blockers'])
                self.assertFalse(result['warnings'])

    def test_missing_duplicate_clipped_moved_or_wrong_state_artwork_still_blocks(self):
        for category in ('identity','ownership','missing-artwork','extra-artwork','clipping',
                         'text-policy','geometry','layout','uncertain'):
            with self.subTest(category=category):
                result=classify(observed(category=category),['asset-coin-a'],policy())
                self.assertTrue(result['blockers'])
        progress=visual_fixtures.observation(category='progress',styleAspect='other',
            referenceState='empty',generatedState='full')
        self.assertTrue(classify(progress,['asset-coin-a'],policy())['blockers'])

    def test_v2_cannot_override_explicit_color_and_shadow_options(self):
        strict=policy(minorColor='strict',shadow='preserve')
        for aspect in ('color-tone','shadow'):
            with self.subTest(aspect=aspect):
                answer=visual_fixtures.observation(styleAspect=aspect)
                self.assertTrue(classify(answer,['asset-coin-a'],strict)['blockers'])
                self.assertFalse(classify(answer,['asset-coin-a'],policy())['blockers'])

    def test_policy_shape_is_explicit_and_v1_guidance_is_unchanged(self):
        valid=policy()
        self.assertEqual(validate(valid),valid)
        invalid=[dict(valid),dict(valid),dict(valid),dict(valid),visual_fixtures.policy(minorStyle='record')]
        invalid[0].pop('minorStyle')
        invalid[1]['minorStyle']='ignore'
        invalid[2]['kind']='ui_visual_policy_v3'
        invalid[3]['extra']='record'
        for value in invalid:
            with self.subTest(value=value),self.assertRaises(ValueError):validate(value)
        self.assertIn('轻微表面渲染差异可记录',generation_guidance(valid))
        self.assertIn('记录为非阻断',output_review_guidance(valid))
        self.assertNotIn('轻微表面渲染差异可记录',generation_guidance(visual_fixtures.policy()))

    def test_v2_bytes_and_guidance_survive_planning_freeze_and_tamper_is_rejected(self):
        fixture=visual_fixtures.VisualPolicyTests()
        fixture.setUp();self.addCleanup(fixture.doCleanups)
        fixture.write_policy(policy())
        root=fixture.new_run()
        _,model=fixture.model_with_policy_review(reference_bound=True)
        result=Dag(root,model).execute()
        snapshot=root/'frozen'
        self.assertEqual((snapshot/'visual-policy.json').read_bytes(),fixture.policy_file.read_bytes())
        self.assertEqual(preflight(snapshot,result['snapshotDigest'])['inputChecks'],'passed')
        for row in read(snapshot/'requests.json')['requests']:
            self.assertIn(generation_guidance(policy()).strip(),(snapshot/row['prompt']).read_text('utf-8'))
        pinned=root/'.dag/inputs/visual-policy.json'
        changed=read(pinned);changed['minorStyle']='strict'
        pinned.write_text(json.dumps(changed),encoding='utf-8')
        with self.assertRaises(ValueError):Dag(root,model).verify()

    def test_host_workflow_preserves_minor_findings_through_delivery(self):
        fixture=delivery_fixtures.HostDeliveryTests()
        fixture.setUp();self.addCleanup(fixture.doCleanups)
        source=fixture.base/'accepted-minor-style.json';save(source,policy())
        config=read(fixture.config_path);config['visualPolicy']=str(source)
        fresh=fixture.base/'policy-host-config.json';save(fresh,config)
        fixture.run=fixture.base/'policy-integrated'
        host.prepare(fresh,fixture.run);fixture.root=fixture.run/'planning'
        original=HostEvidence.response
        planning_original=delivery_fixtures.review_fixtures.HostReviewTests.response_doc

        def planning_observation(owner):
            answer=planning_original(owner)
            for entry in answer['smallMaterialAudit'].values():
                for part in entry['parts']:
                    part['deferredAppearance']=None
            return answer

        def with_observation(owner,folder,answer=None,raw=None,reviewer='fixture-independent-reviewer'):
            request=read(folder/'request.json')
            finding=observed()['findings'][0]
            finding['materialId']=request['materialIds'][0]
            observed_answer=dict(materialIds=request['materialIds'],findings=[finding])
            return original(owner,folder,answer=observed_answer,raw=raw,reviewer=reviewer)

        with patch.object(HostEvidence,'response',with_observation), patch.object(
                delivery_fixtures.review_fixtures.HostReviewTests,'response_doc',planning_observation):
            fixture.test_complete_sheet_workflow_separate_scopes_and_delivered_comparison()
        # The fixture's final step deliberately tampers with its comparison;
        # extraction and review warnings remain exact saved artifacts.
        extraction=read(fixture.run/'extraction/result.json')
        self.assertTrue(extraction['warnings'])
        for warning in extraction['warnings']:
            self.assertEqual(warning['category'],'minor-style-deviation')
        review=read(fixture.run/'delivery/package/review.json')
        self.assertTrue(any('minor-style-deviation' in issue for issue in review['issues']))
        result=read(fixture.run/'delivery/package-result.json')
        self.assertFalse(result['humanVisualAcceptance'])


if __name__=='__main__':unittest.main()
