"""Offline regressions for an explicit minor internal layout tolerance."""
import _bootstrap
import copy
import hashlib
import unittest
from unittest.mock import patch

from ai_ui_layers import host_delivery as host
from ai_ui_layers.evaluate import digest, read, save
from ai_ui_layers.execution_preflight import preflight
from ai_ui_layers.planning_dag import Dag
from ai_ui_layers.sheet_review_policy import classify
from ai_ui_layers import visual_policy as vp
import test_visual_policy as visual_fixtures
import test_minor_style_policy as style_fixtures
import test_approximate_visual_policy as shape_fixtures
import test_host_delivery as delivery_fixtures
from test_host_material_review import HostEvidence


def policy(**changes):
    value = shape_fixtures.policy(kind='ui_visual_policy_v4', minorLayout='record')
    value.update(changes)
    return value


def arrow_observation(**changes):
    return visual_fixtures.observation(category='layout', styleAspect='other',
        evidence='The complete gray arrow is slightly farther right and larger within the '
                 'complete owned strip. The red sword stays at the left. Both rounded strip '
                 'boundaries are visible; identity, count, state, connections and ordering remain intact.',
        suggestion='Record the minor arrow placement and scale difference in the final comparison.',
        **changes)


class MinorLayoutPolicyTests(unittest.TestCase):
    def test_minor_internal_arrow_requires_explicit_v4_record(self):
        for strict in (None, visual_fixtures.policy(), style_fixtures.policy(),
                       shape_fixtures.policy(), policy(minorLayout='strict')):
            answer = arrow_observation()
            if strict is None:
                del answer['findings'][0]['styleAspect']
            with self.subTest(policy=strict):
                self.assertTrue(classify(answer, ['asset-coin-a'], strict)['blockers'])
        answer = arrow_observation()
        before = copy.deepcopy(answer)
        result = classify(answer, ['asset-coin-a'], policy())
        self.assertEqual(answer, before)
        self.assertFalse(result['blockers'])
        self.assertEqual(result['warnings'][0]['category'], 'minor-layout-deviation')
        self.assertEqual(result['decisions'][0]['evidence'], before['findings'][0]['evidence'])
        self.assertEqual(result['decisions'][0]['suggestion'], before['findings'][0]['suggestion'])

    def test_layout_tolerance_keeps_other_blockers_and_independent_options(self):
        for changes in (dict(magnitude='major'), dict(magnitude='uncertain'), dict(ownership='ambiguous')):
            with self.subTest(changes=changes):
                self.assertTrue(classify(arrow_observation(**changes), ['asset-coin-a'], policy())['blockers'])
        for category in ('missing-artwork', 'extra-artwork', 'clipping', 'ownership',
                         'identity', 'text-policy', 'uncertain'):
            answer = arrow_observation()
            answer['findings'][0]['category'] = category
            with self.subTest(category=category):
                self.assertTrue(classify(answer, ['asset-coin-a'], policy())['blockers'])
        wrong_state = visual_fixtures.observation(category='progress', styleAspect='other',
            referenceState='empty', generatedState='full')
        self.assertTrue(classify(wrong_state, ['asset-coin-a'], policy())['blockers'])
        shape = shape_fixtures.observation()
        self.assertTrue(classify(shape, ['asset-coin-a'], policy(minorGeometry='strict'))['blockers'])
        self.assertTrue(classify(visual_fixtures.observation(styleAspect='other'), ['asset-coin-a'],
                                 policy(minorStyle='strict'))['blockers'])

    def test_v4_requires_exact_fields_and_rejects_implicit_legacy_upgrade(self):
        self.assertEqual(vp.validate(policy()), policy())
        invalid = [policy(), policy(minorLayout='ignore'), policy(extra=True),
                   shape_fixtures.policy(minorLayout='record')]
        invalid[0].pop('minorLayout')
        for value in invalid:
            with self.subTest(value=value), self.assertRaises(ValueError):
                vp.validate(value)
        self.assertIn('轻微间距、位置或相对尺度', vp.planning_guidance(policy()))
        self.assertIn('仍尽量贴近参考', vp.generation_guidance(policy()))
        self.assertIn('填layout/other、magnitude=minor', vp.output_review_guidance(policy()))
        self.assertIn('多锚点对应不清填uncertain', vp.output_review_guidance(policy()))

    def test_v1_v2_v3_guidance_bytes_are_unchanged(self):
        expected = [
            ('99f5310850591eacfe9199807682bcf055729f9f3a838da09ecdb2abf5a4d9ad',
             'f4309d94b3076ba36deff284638f714815ee281070fba1e8475ae9be1d12ac50',
             '5e45011bef7d0ada11adee76ccdd33935a0f3a3b740aa6adb190c88fccb18f65'),
            ('882b6e86e361244846c0fbe479d9228fea74f50fac10da822fb380d74a7f8655',
             'cdb8688d47a0feaf2254d0540776e1c41545e62eec138aa82a6f4edfc365e5f4',
             '2383e2685e76b055c2103b700286e40ace4d047b3e89987bcd0d9c03d06e4a91'),
            ('e9d32686b267bafdef937d198b2a4e685f8ec07ffe83677470b1ad941763369a',
             'c22eae2cacdd7727447f83f11166152b59f720c86e9d5f333ca6f28ca245c177',
             'f7de253e0fb3e4940400c2c17750a24f99dddf6576b960f41f972216c689eb45')]
        functions = (vp.planning_guidance, vp.generation_guidance, vp.output_review_guidance)
        for value, row in zip((visual_fixtures.policy(), style_fixtures.policy(), shape_fixtures.policy()), expected):
            self.assertEqual(tuple(hashlib.sha256(fn(value).encode()).hexdigest() for fn in functions), row)

    def test_v4_bytes_snapshot_and_compiled_guidance_are_bound(self):
        fixture = visual_fixtures.VisualPolicyTests()
        fixture.setUp(); self.addCleanup(fixture.doCleanups)
        fixture.write_policy(policy())
        run = fixture.new_run()
        _, model = fixture.model_with_policy_review()
        result = Dag(run, model).execute()
        snapshot = run/'frozen'
        self.assertEqual((snapshot/'visual-policy.json').read_bytes(), fixture.policy_file.read_bytes())
        self.assertEqual(preflight(snapshot, result['snapshotDigest'])['inputChecks'], 'passed')
        request = next(row for row in read(snapshot/'requests.json')['requests'] if row.get('kind') == 'sheet')
        self.assertIn(vp.generation_guidance(policy()).strip(), (snapshot/request['prompt']).read_text('utf-8'))
        pinned = run/'.dag/inputs/visual-policy.json'
        changed = read(pinned); changed['minorLayout'] = 'strict'
        visual_fixtures.overwrite(pinned, changed)
        with self.assertRaisesRegex(ValueError, '^INPUT_CHANGED$'):
            Dag(run, model).verify()

    def test_fresh_host_keeps_layout_warning_in_delivery_and_rejects_policy_tamper(self):
        fixture = delivery_fixtures.HostDeliveryTests()
        fixture.setUp(); self.addCleanup(fixture.doCleanups)
        source = fixture.base/'layout-policy.json'; save(source, policy())
        config = read(fixture.config_path); config['visualPolicy'] = str(source)
        fresh = fixture.base/'layout-config.json'; save(fresh, config)
        fixture.run = fixture.base/'layout-integrated'
        host.prepare(fresh, fixture.run); fixture.root = fixture.run/'planning'
        original_material = HostEvidence.response
        original_planning = delivery_fixtures.review_fixtures.HostReviewTests.response_doc

        def planning_answer(owner):
            answer = original_planning(owner)
            for entry in answer['smallMaterialAudit'].values():
                for part in entry['parts']:
                    part['deferredAppearance'] = None
            return answer

        def material_answer(owner, folder, answer=None, raw=None, reviewer='fixture-independent-reviewer'):
            request = read(folder/'request.json')
            finding = arrow_observation()['findings'][0]
            finding['materialId'] = request['materialIds'][0]
            answer = dict(materialIds=request['materialIds'], findings=[finding])
            return original_material(owner, folder, answer=answer, raw=raw, reviewer=reviewer)

        with patch.object(HostEvidence, 'response', material_answer), patch.object(
                delivery_fixtures.review_fixtures.HostReviewTests, 'response_doc', planning_answer):
            fixture.test_complete_sheet_workflow_separate_scopes_and_delivered_comparison()
        # The reused fixture deliberately corrupts its comparison at the end.
        # Restore only that temporary fixture to isolate the policy tamper below.
        comparison = fixture.run/'delivery/comparison/three-way-comparison.png'
        data = comparison.read_bytes()
        self.assertTrue(data.endswith(b'changed output'))
        comparison.write_bytes(data[:-len(b'changed output')])
        self.assertTrue(host.status(fixture.run)['FullAutomationExecutionCompleted'])
        self.assertTrue(any(row['category'] == 'minor-layout-deviation'
                            for row in read(fixture.run/'extraction/result.json')['warnings']))
        review = read(fixture.run/'delivery/package/review.json')
        self.assertTrue(any('minor-layout-deviation' in issue for issue in review['issues']))
        self.assertFalse(read(fixture.run/'delivery/package-result.json')['humanVisualAcceptance'])
        pinned = fixture.run/'frozen/visual-policy.json'
        self.assertEqual(pinned.read_bytes(), source.read_bytes())
        changed = read(pinned); changed['minorLayout'] = 'strict'
        visual_fixtures.overwrite(pinned, changed)
        with self.assertRaisesRegex(ValueError, 'CHANGED:.*visual-policy[.]json'):
            host.status(fixture.run)


if __name__ == '__main__': unittest.main()
