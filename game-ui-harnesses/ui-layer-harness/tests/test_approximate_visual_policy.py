"""Offline regressions for basic visual reconstruction with recorded minor shape changes."""
import _bootstrap
import json
import unittest
from pathlib import Path
from unittest.mock import patch

from PIL import Image

from ai_ui_layers import host_delivery as host
from ai_ui_layers.body_registration import fit_body, process
from ai_ui_layers.body_viewport_delivery import validate_contract
from ai_ui_layers.evaluate import read, save, digest
from ai_ui_layers.accepted_materials import replay
from ai_ui_layers.visual_policy import validate, planning_guidance, generation_guidance, output_review_guidance
from ai_ui_layers.sheet_review_policy import classify
import test_visual_policy as visual_fixtures
import test_minor_style_policy as style_fixtures
import test_body_registration as body_fixtures
import test_host_delivery as delivery_fixtures
from test_host_material_review import HostEvidence


def policy(**changes):
    value = style_fixtures.policy(kind='ui_visual_policy_v3', minorGeometry='record')
    value.update(changes)
    return value


def observation(**changes):
    return visual_fixtures.observation(category='geometry', styleAspect='other',
        evidence='The complete owned button is slightly taller; identity, count, state and attached artwork remain intact.',
        suggestion='Record this minor contour difference and inspect the final recomposition.', **changes)


class ApproximatePolicyTests(unittest.TestCase):
    def test_only_explicit_v3_minor_geometry_is_advisory(self):
        for strict in (None, visual_fixtures.policy(), style_fixtures.policy(), policy(minorGeometry='strict')):
            with self.subTest(policy=strict):
                answer = observation()
                if strict is None:
                    del answer['findings'][0]['styleAspect']
                self.assertTrue(classify(answer, ['asset-coin-a'], strict)['blockers'])
        result = classify(observation(), ['asset-coin-a'], policy())
        self.assertFalse(result['blockers'])
        self.assertEqual(result['warnings'][0]['category'], 'minor-geometry-deviation')
        self.assertEqual(result['decisions'][0]['evidence'], observation()['findings'][0]['evidence'])

    def test_major_uncertain_and_ambiguous_shapes_and_structural_errors_still_block(self):
        for changes in (dict(magnitude='major'), dict(magnitude='uncertain'), dict(ownership='ambiguous')):
            with self.subTest(changes=changes):
                self.assertTrue(classify(observation(**changes), ['asset-coin-a'], policy())['blockers'])
        for category in ('layout', 'missing-artwork', 'extra-artwork', 'clipping', 'ownership', 'identity', 'text-policy', 'uncertain'):
            answer = observation()
            answer['findings'][0]['category'] = category
            with self.subTest(category=category):
                self.assertTrue(classify(answer, ['asset-coin-a'], policy())['blockers'])
        wrong_state = visual_fixtures.observation(category='progress', styleAspect='other',
            referenceState='empty', generatedState='full')
        self.assertTrue(classify(wrong_state, ['asset-coin-a'], policy())['blockers'])

    def test_exact_v3_shape_and_explicit_old_style_options(self):
        self.assertEqual(validate(policy()), policy())
        invalid = [policy(), policy(), style_fixtures.policy(minorGeometry='record')]
        invalid[0].pop('minorGeometry')
        invalid[1]['minorGeometry'] = 'ignore'
        for value in invalid:
            with self.subTest(value=value), self.assertRaises(ValueError):
                validate(value)
        for aspect, overrides in (('other', dict(minorStyle='strict')),
                                  ('color-tone', dict(minorColor='strict')),
                                  ('shadow', dict(shadow='preserve'))):
            answer = visual_fixtures.observation(styleAspect=aspect)
            self.assertTrue(classify(answer, ['asset-coin-a'], policy(**overrides))['blockers'])
        self.assertIn('整体基本还原', planning_guidance(policy()))
        self.assertIn('整体基本还原', generation_guidance(policy()))
        self.assertIn('不以肉眼估计像素或2%/5%阈值', output_review_guidance(policy()))

    def test_fit_has_coarse_guard_and_no_implicit_relaxation(self):
        for strict in (None, visual_fixtures.policy(), style_fixtures.policy(), policy(minorGeometry='strict')):
            with self.subTest(policy=strict), self.assertRaisesRegex(ValueError, 'BODY_PROPORTIONS_DIFFER'):
                fit_body([100, 24], [100, 20], strict)
        scale, recorded = fit_body([100, 24], [100, 20], policy())
        self.assertEqual(scale, 20 / 24)
        self.assertAlmostEqual(recorded['symmetricAspectDifference'], .2)
        self.assertFalse(recorded['axisStretch'])
        self.assertFalse(recorded['humanVisualAcceptance'])
        fit_body([100, 25], [100, 20], policy())
        with self.assertRaisesRegex(ValueError, 'BODY_PROPORTIONS_GROSSLY_DIFFER'):
            fit_body([100, 26], [100, 20], policy())

    def test_whole_body_tolerates_minor_aspect_and_remains_centered_uniform_and_transparent(self):
        fixture = body_fixtures.BodyRegistrationTests()
        fixture.setUp(); self.addCleanup(fixture.doCleanups)
        entry = fixture.bound_entry(target_body=[70, 45, 150, 83])
        output = fixture.root / 'approximate'
        result = process(fixture.source, fixture.reference, entry, fixture.region,
            fixture.material_id, fixture.snapshot_digest, output, visual_policy=policy())
        geometry = result['fitting']; scale = geometry['uniformScale']
        self.assertEqual(geometry['rasterScaleXY'], [1.9, 1.9])
        for axis in (0, 1):
            center = (fixture.body[axis] + fixture.body[axis + 2]) / 2 * scale
            center += geometry['offsetInRegion'][axis] + fixture.region[axis]
            self.assertAlmostEqual(center, ([110, 64][axis]))
        self.assertIn('APPROXIMATE_BODY_PROPORTIONS_RECORDED', result['warnings'])
        self.assertEqual(geometry['appearanceTolerance']['visualPolicy'], policy())
        with Image.open(output / 'material.png') as image:
            self.assertEqual(image.mode, 'RGBA')
            self.assertGreater(image.getchannel('A').getbbox()[2], image.getchannel('A').getbbox()[0])
            self.assertEqual(image.getpixel((80, 40))[3], 0)  # Genuine owned hole survives.

    def test_expanded_validate_keeps_dense_whole_body_and_evidence_gates(self):
        fixture = body_fixtures.BodyRegistrationTests()
        fixture.setUp(); self.addCleanup(fixture.doCleanups)
        entry = fixture.bound_entry(target_body=[70, 45, 150, 83])
        checked = validate_contract(fixture.source, fixture.reference, entry, fixture.region,
            fixture.material_id, fixture.snapshot_digest, visual_policy=policy())
        self.assertEqual(checked['geometry']['uniformScale'], 1.9)
        self.assertIn('appearanceTolerance', checked['geometry'])
        bad = fixture.bound_entry(source_body=[25, 22, 45, 32])
        with self.assertRaisesRegex(ValueError, 'SOURCE_BODY_OMITS_DENSE_ARTWORK'):
            validate_contract(fixture.source, fixture.reference, bad, fixture.region,
                fixture.material_id, fixture.snapshot_digest, visual_policy=policy())
        unknown = fixture.bound_entry(observation_changes=dict(boundaryStatus='uncertain'))
        with self.assertRaisesRegex(ValueError, 'BODY_OBSERVATION_UNRESOLVED'):
            validate_contract(fixture.source, fixture.reference, unknown, fixture.region,
                fixture.material_id, fixture.snapshot_digest, visual_policy=policy())

    def test_approximate_policy_does_not_clip_faint_alpha_or_accept_opaque_source(self):
        fixture = body_fixtures.BodyRegistrationTests()
        fixture.setUp(); self.addCleanup(fixture.doCleanups)
        with Image.open(fixture.source) as source:
            image = source.convert('RGBA')
        image.putpixel((1, 20), (20, 20, 20, 1)); image.save(fixture.source)
        entry = fixture.bound_entry(target_body=[21, 45, 61, 65])
        with self.assertRaisesRegex(ValueError, 'BODY_TRANSFORM_WOULD_CLIP_ALPHA'):
            process(fixture.source, fixture.reference, entry, fixture.region,
                fixture.material_id, fixture.snapshot_digest, fixture.root / 'clipped', visual_policy=policy())
        Image.new('RGB', (80, 60), 'red').save(fixture.source)
        entry = fixture.bound_entry()
        with self.assertRaisesRegex(ValueError, 'BODY_REGISTRATION_REQUIRES_NATIVE_ALPHA|BODY_RAW_GATE_FAILED'):
            process(fixture.source, fixture.reference, entry, fixture.region,
                fixture.material_id, fixture.snapshot_digest, fixture.root / 'opaque', visual_policy=policy())

    def test_approximate_source_replay_preserves_exact_policy_and_pixels(self):
        fixture = body_fixtures.BodyRegistrationTests()
        fixture.setUp(); self.addCleanup(fixture.doCleanups)
        entry = fixture.bound_entry()
        report = process(fixture.source, fixture.reference, entry, fixture.region,
            fixture.material_id, fixture.snapshot_digest, fixture.root / 'original', visual_policy=policy())
        job = fixture.root / 'received-job'; snapshot = job / 'snapshot'; snapshot.mkdir(parents=True)
        (snapshot / 'reference.png').write_bytes(fixture.reference.read_bytes())
        policy_path = snapshot / 'visual-policy.json'; save(policy_path, policy())
        manifest = dict(files={'visual-policy.json':digest(policy_path)}, visualPolicySha256=digest(policy_path))
        save(snapshot / 'snapshot.json', manifest)
        row = dict(id=fixture.material_id, sourceSha256=digest(fixture.source), report=report)
        selection = dict(job=str(job), requestId=fixture.material_id, sourceMaterialId=fixture.material_id)
        placement = dict(sourceRegion=fixture.region, outputSize=[160, 80])
        # The receipt boundary is a test double; all pixel and fitting replay is real.
        with patch('ai_ui_layers.accepted_materials.received', return_value=(fixture.source, {}, {'sourceReceipt':'fixture'})):
            output, lineage = replay(selection, row, placement, 'foreground', digest(fixture.reference), fixture.root / 'replay')
            self.assertEqual(digest(output), report['materialSha256'])
            self.assertEqual(lineage['processing']['fitting']['appearanceTolerance'], report['fitting']['appearanceTolerance'])
            # A differently frozen policy cannot be substituted just because
            # its exact-aspect pixels happen to match.
            policy_path.write_text(json.dumps(policy(minorStyle='strict')), encoding='utf-8')
            manifest = dict(files={'visual-policy.json':digest(policy_path)}, visualPolicySha256=digest(policy_path))
            (snapshot / 'snapshot.json').write_text(json.dumps(manifest), encoding='utf-8')
            with self.assertRaisesRegex(ValueError, 'BODY_APPEARANCE_POLICY_REPLAY_MISMATCH'):
                replay(selection, row, placement, 'foreground', digest(fixture.reference), fixture.root / 'wrong-policy')

    def test_bound_host_workflow_reaches_package_with_shape_warnings_and_residuals(self):
        fixture = delivery_fixtures.HostDeliveryTests()
        fixture.setUp(); self.addCleanup(fixture.doCleanups)
        source = fixture.base / 'approximate-policy.json'; save(source, policy())
        config = read(fixture.config_path); config['visualPolicy'] = str(source)
        fresh = fixture.base / 'approximate-host-config.json'; save(fresh, config)
        fixture.run = fixture.base / 'approximate-integrated'
        host.prepare(fresh, fixture.run); fixture.root = fixture.run / 'planning'
        frozen_fit = read(fixture.run/'config.json')['bodyFitPolicy']
        self.assertEqual(frozen_fit,dict(kind='uniform-observed-body-residual-v2',
            maximumResidualPixels=32,denseBoundaryMarginPixels=4))
        original_material = HostEvidence.response
        original_planning = delivery_fixtures.review_fixtures.HostReviewTests.response_doc
        original_receive = host.receive
        body_calls = []

        def planning_answer(owner):
            answer = original_planning(owner)
            for entry in answer['smallMaterialAudit'].values():
                for part in entry['parts']:
                    part['deferredAppearance'] = None
            return answer

        def material_answer(owner, folder, answer=None, raw=None, reviewer='fixture-independent-reviewer'):
            request = read(folder / 'request.json')
            finding = observation()['findings'][0]; finding['materialId'] = request['materialIds'][0]
            answer = dict(materialIds=request['materialIds'], findings=[finding])
            return original_material(owner, folder, answer=answer, raw=raw, reviewer=reviewer)

        def receive(run, submission_digest, response, **kwargs):
            if host.status(run)['stage'] == 'body_observation':
                answer = read(response)
                answer['geometryDifferences'] = ['Fixture body is measurably ten percent shorter.']
                answer['materialIssues'] = ['Fixture minor highlight difference under explicit approximate policy.']
                box = answer['referenceCropBodyBox']
                box[3] = box[1] + max(1, round((box[3] - box[1]) * .9))
                Path(response).write_text(json.dumps(answer), encoding='utf-8')
                attestation = read(kwargs['host_attestation'])
                from ai_ui_layers.evaluate import digest
                attestation['responseSha256'] = digest(Path(response))
                Path(kwargs['host_attestation']).write_text(json.dumps(attestation), encoding='utf-8')
                body_calls.append(submission_digest)
            return original_receive(run, submission_digest, response, **kwargs)

        with patch.object(HostEvidence, 'response', material_answer), patch.object(
                delivery_fixtures.review_fixtures.HostReviewTests, 'response_doc', planning_answer), \
                patch.object(host, 'receive', receive):
            fixture.test_complete_sheet_workflow_separate_scopes_and_delivered_comparison()
        self.assertTrue(body_calls)
        self.assertEqual(read(fixture.run/'body/job.json')['bodyFitPolicy'],frozen_fit)
        self.assertEqual(read(fixture.run/'body-output.json')['bodyFitPolicy'],frozen_fit)
        self.assertTrue(read(fixture.run/'body-output.json')['bodyObservationWarnings'])
        warnings = read(fixture.run / 'extraction/result.json')['warnings']
        self.assertTrue(any(w['category'] == 'minor-geometry-deviation' for w in warnings))
        proof = read(fixture.run / 'delivery/body-provenance.json')
        for record in proof['records']:
            if record['role'] != 'foreground': continue
            geometry = record['geometry']
            self.assertEqual(geometry['appearanceTolerance']['kind'],'ui_approximate_body_fit_v2')
            self.assertEqual(geometry['appearanceTolerance']['fitPolicy'],frozen_fit)
            self.assertFalse(geometry['appearanceTolerance']['axisStretch'])
            self.assertGreater(max(geometry['appearanceTolerance']['sizeDifferencePixels']), 1)
            self.assertFalse(geometry['alphaSupportClipped'])
        review = read(fixture.run / 'delivery/package/review.json')
        self.assertTrue(any('minor-geometry-deviation' in issue for issue in review['issues']))
        self.assertTrue(any('approximate body proportions' in issue for issue in review['issues']))
        self.assertFalse(read(fixture.run / 'delivery/package-result.json')['humanVisualAcceptance'])
        pinned = fixture.run / 'frozen/visual-policy.json'
        self.assertEqual(pinned.read_bytes(), source.read_bytes())
        pinned.write_bytes(pinned.read_bytes() + b'changed')
        with self.assertRaisesRegex(ValueError, 'CHANGED|MISMATCH'):
            host.status(fixture.run)


if __name__ == '__main__': unittest.main()
