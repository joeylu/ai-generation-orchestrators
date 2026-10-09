"""Offline regressions for exterior warnings and required reliable solid cores."""
import _bootstrap
import copy
import json
from pathlib import Path
import unittest
from unittest.mock import patch

from PIL import Image, ImageDraw
from jsonschema import ValidationError

from ai_ui_layers import body_coverage as coverage, body_registration as registration
from ai_ui_layers import host_body_profile as profile, host_body_observation as host
from ai_ui_layers import visual_policy
from ai_ui_layers.body_viewport_delivery import validate_contract
from ai_ui_layers.evaluate import digest, read, save
import test_body_registration as body_fixtures
import test_body_soft_effects as soft_fixtures


def faint_residue():
    image = Image.new('RGBA', (100, 100))
    ImageDraw.Draw(image).rectangle((20, 15, 79, 84), fill=(80, 180, 100, 255))
    image.putpixel((1, 1), (80, 180, 100, 1))
    image.putpixel((97, 98), (80, 180, 100, 2))
    return image


class CoverageWarningTests(unittest.TestCase):
    def check(self, image, state='owned-artwork', body=(20, 15, 80, 85), policy=None):
        return coverage.check(image, body, 4, soft_fixtures.declarations(state),
                              visual_policy=visual_policy.warning_policy() if policy is None else policy)

    def test_faint_owned_or_uncertain_residue_records_honest_evidence_and_keeps_pixels(self):
        for state in ('owned-artwork', 'uncertain'):
            image = faint_residue(); before = image.tobytes()
            report = self.check(image, state)
            self.assertEqual(report['outsideBodySupport'], soft_fixtures.declarations(state))
            self.assertEqual(len(report['visualCoverageWarnings']), 4)
            self.assertEqual(report['externalNonzeroAlphaPixels'], 2)
            self.assertEqual(report['externalAlphaMaximum'], 2)
            self.assertEqual(report['externalDensePixels'], 0)
            self.assertEqual(report['alphaPixelsRemoved'], 0)
            self.assertFalse(report['semanticClassificationProven'])
            self.assertEqual(image.tobytes(), before)

    def test_default_and_every_older_policy_still_reject_the_same_semantic_answer(self):
        policies = [None, dict(kind=visual_policy.KIND, appearanceEvidence='bound-reference',
                               minorColor='record', shadow='optional')]
        for kind, extra in ((visual_policy.KIND_V2, dict(minorStyle='record')),
                (visual_policy.KIND_V3, dict(minorStyle='record', minorGeometry='record')),
                (visual_policy.KIND_V4, dict(minorStyle='record', minorGeometry='record', minorLayout='record'))):
            policies.append(dict(policies[1], kind=kind, **extra))
        for policy in policies:
            with self.subTest(policy=policy), self.assertRaisesRegex(ValueError, 'OUTSIDE_BODY_OBSERVATION_UNRESOLVED'):
                coverage.check(faint_residue(), [20, 15, 80, 85], 4,
                               soft_fixtures.declarations('owned-artwork'), visual_policy=policy)

    def test_nonopaque_density_and_detached_components_are_reported_without_shadow_claims(self):
        image = soft_fixtures.panel(); image.putpixel((3, 3), (50, 40, 30, 200))
        before = image.tobytes()
        report = self.check(image, 'uncertain')
        codes = [row['code'] for row in report['visualCoverageWarnings']]
        self.assertIn('OUTSIDE_BODY_OBSERVATION_UNRESOLVED', codes)
        self.assertIn('UNREVIEWED_DENSE_EXTERNAL_EFFECT', codes)
        self.assertIn('DETACHED_DENSE_EXTERNAL_EFFECT', codes)
        self.assertEqual(report['detachedDensePixels'], 1)
        self.assertEqual(report['externalAlphaMaximum'], 200)
        self.assertEqual(image.tobytes(), before)
        self.assertTrue(all(row['classification'] == 'uncertain' for row in report['outsideBodySupport']))

    def test_high_opacity_coverage_mismatch_is_warning_without_relabeling_or_pixel_changes(self):
        for state in ('none', 'external-soft-effect', 'owned-artwork', 'uncertain'):
            image = faint_residue(); image.putpixel((3, 3), (50, 40, 30, 240))
            before = image.tobytes()
            with self.subTest(state=state):
                report = self.check(image, state)
                warning = next(w for w in report['visualCoverageWarnings']
                               if w['code'] == 'SOURCE_BODY_OMITS_SOLID_ARTWORK')
                self.assertEqual(warning['solidPixels'], 1)
                self.assertEqual(report['externalSolidPixels'], 1)
                self.assertEqual(report['outsideBodySupport'], soft_fixtures.declarations(state))
                self.assertEqual(image.tobytes(), before)
                self.assertEqual(report['alphaPixelsRemoved'], 0)
        report = self.check(faint_residue(), body=[35, 35, 65, 65])
        self.assertGreater(report['externalSolidPixels'], 0)
        self.assertFalse(report['semanticClassificationProven'])

    def test_near_opaque_bottom_fringe_reproduces_small_native_margin_conflict(self):
        image = faint_residue()
        for x in range(30, 64): image.putpixel((x, 89), (173, 150, 248, 241))
        for x in range(30, 63): image.putpixel((x, 90), (173, 150, 248, 240))
        before = image.tobytes()
        report = self.check(image, 'external-soft-effect')
        self.assertEqual(report['externalSolidPixels'], 67)
        self.assertEqual(report['externalSolidPixelsBySide'], dict(left=0, top=0, right=0, bottom=67))
        self.assertEqual(image.tobytes(), before)
        with self.assertRaisesRegex(ValueError, 'SOURCE_BODY_OMITS_SOLID_ARTWORK'):
            coverage.check(image, [20, 15, 80, 85], 4, soft_fixtures.declarations())

    def test_unobservable_core_still_stops(self):
        image = faint_residue(); image.putalpha(200)
        with self.assertRaisesRegex(ValueError, 'BODY_SOLID_CORE_NOT_OBSERVABLE'):
            self.check(image)

    def test_incomplete_sides_and_invalid_visual_policy_still_stop(self):
        sides = soft_fixtures.declarations('uncertain')
        duplicate = copy.deepcopy(sides); duplicate[-1] = duplicate[0]
        for rows in ([], sides[:3], duplicate):
            with self.subTest(rows=rows), self.assertRaisesRegex(ValueError, 'COMPLETE_OUTSIDE_BODY_OBSERVATIONS_REQUIRED'):
                coverage.check(faint_residue(), [20, 15, 80, 85], 4, rows,
                               visual_policy=visual_policy.warning_policy())
        bad = visual_policy.warning_policy(); bad['minorGeometry'] = 'strict'
        with self.assertRaisesRegex(ValueError, 'INVALID_VISUAL_POLICY'):
            self.check(faint_residue(), policy=bad)

    def test_prompt_disposition_matches_the_frozen_policy_without_relabeling(self):
        old = profile.soft_effect_guidance(soft_fixtures.appearance_policy())
        self.assertEqual(old, profile.SOFT_EFFECT_GUIDANCE)
        self.assertIn('requires issues and uncertain/not-whole', old)
        new = profile.soft_effect_guidance(visual_policy.warning_policy())
        self.assertNotIn('Any unresolved classification', new)
        self.assertIn('They alone do not require issues', new)
        self.assertIn('do not relabel', new)
        self.assertIn('records the actual count and sides as warnings', new)


class HostCoverageWarningTests(unittest.TestCase):
    def fixture(self):
        fixture = soft_fixtures.SoftEffectsHostTests(); fixture.setUp()
        self.addCleanup(fixture.doCleanups); fixture.enable()
        return fixture

    def test_host_consumes_original_owned_answer_then_finishes_with_bound_evidence(self):
        fixture = self.fixture()
        fixture.answer[coverage.FIELD] = soft_fixtures.declarations('owned-artwork')
        with patch('ai_ui_layers.visual_policy.snapshot_policy', return_value=visual_policy.warning_policy()):
            request = fixture.start()
            prompt = (fixture.job/'requests'/request['materialId']/'prompt.md').read_text('utf-8')
            self.assertIn('They alone do not require issues', prompt)
            self.assertNotIn('Any unresolved classification', prompt)
            while request is not None:
                returned = fixture.evidence(request); fixture.receive(request, returned)
                folder = fixture.job/'attempts'/request['materialId']
                self.assertEqual((folder/'response.json').read_bytes(), (returned/'response.json').read_bytes())
                checked = read(folder/'registration-check/report.json')
                self.assertTrue(checked['fitting']['denseBoundaryCheck']['visualCoverageWarnings'])
                self.assertTrue(any('OUTSIDE_BODY_OBSERVATION_UNRESOLVED' in row for row in checked['warnings']))
                request = host.next_request(fixture.job)
            host.finish(fixture.job, fixture.output_config)
            self.assertEqual(host.status(fixture.job)['status'], 'completed')
        output = read(fixture.output_config)
        self.assertTrue(all(row[coverage.FIELD] == fixture.answer[coverage.FIELD]
                            for row in output['bodyObservationWarnings']))

    def test_warning_does_not_convert_unreliable_geometry_or_invalid_schema_to_success(self):
        for invalid_schema in (False, True):
            fixture = self.fixture()
            with patch('ai_ui_layers.visual_policy.snapshot_policy', return_value=visual_policy.warning_policy()):
                request = fixture.start()
                answer = copy.deepcopy(fixture.answer)
                if invalid_schema:
                    del answer[coverage.FIELD]
                else:
                    answer.update(boundaryStatus='uncertain', sourceBodyBox=None,
                                  referenceCropBodyBox=None, issues=['Complete body cannot be measured.'])
                returned = fixture.evidence(request, answer=answer)
                with self.assertRaises(ValidationError if invalid_schema else ValueError):
                    fixture.receive(request, returned)
                self.assertEqual(host.status(fixture.job)['status'], 'blocked_no_retry')
                with self.assertRaisesRegex(ValueError, 'NO_RESUBMIT'):
                    host.next_request(fixture.job)


class CoverageWarningReplayTests(unittest.TestCase):
    setUp = body_fixtures.BodyRegistrationTests.setUp
    make_source = body_fixtures.BodyRegistrationTests.make_source

    def test_processors_and_replay_preserve_warning_evidence_pixels_and_source_identity(self):
        faint_residue().save(self.source)
        self.region = [0, 0, 180, 120]; self.body = [20, 15, 80, 85]; self.target = [40, 25, 100, 95]
        rows = soft_fixtures.declarations('owned-artwork')
        observation = dict(kind=coverage.OBSERVATION_KIND, snapshotDigest=self.snapshot_digest,
            materialId=self.material_id, sourceSha256=digest(self.source), referenceSha256=digest(self.reference),
            sourceBodyBox=self.body, targetBodyBox=self.target, boundaryStatus='complete', issues=[], outsideBodySupport=rows)
        save(self.evidence, observation)
        contract = {k: v for k, v in observation.items() if k != 'boundaryStatus'}
        contract.update(kind=coverage.CONTRACT_KIND, evidence=dict(path=str(self.evidence),
            sha256=digest(self.evidence), basis='Offline regression fixture, never a model receipt.'))
        path = self.root/'contract.json'; save(path, contract); entry = dict(path=str(path), sha256=digest(path))
        common = dict(visual_policy=visual_policy.warning_policy(), coverage_policy=coverage.POLICY,
                      fit_policy=dict(kind=registration.FIT_POLICY, maximumResidualPixels=32, denseBoundaryMarginPixels=4))
        checked = validate_contract(self.source, self.reference, entry, self.region, self.material_id, self.snapshot_digest, **common)
        result = registration.process(self.source, self.reference, entry, self.region, self.material_id, self.snapshot_digest,
                                      self.root/'processed', policy=registration.POLICY_SUPPORT, **common)
        self.assertEqual(checked['geometry']['denseBoundaryCheck'], result['fitting']['denseBoundaryCheck'])
        with Image.open(self.root/'processed/material.png') as placed:
            self.assertEqual(placed.getpixel((21, 11))[3], 1)
            self.assertEqual(placed.getpixel((117, 108))[3], 2)
        from ai_ui_layers.accepted_materials import replay
        job = self.root/'replay-job'; (job/'snapshot').mkdir(parents=True)
        (job/'snapshot/reference.png').write_bytes(self.reference.read_bytes())
        selection = dict(job=str(job), requestId=self.material_id, sourceMaterialId=self.material_id)
        with patch('ai_ui_layers.accepted_materials.received', return_value=(self.source, {}, {})), \
                patch('ai_ui_layers.visual_policy.snapshot_policy', return_value=visual_policy.warning_policy()):
            output, lineage = replay(selection, dict(id=self.material_id, sourceSha256=digest(self.source), report=result),
                dict(sourceRegion=self.region, outputSize=[180, 120]), 'foreground', digest(self.reference), self.root/'replay')
        self.assertEqual(digest(output), result['materialSha256'])
        self.assertEqual(lineage['processing']['fitting'], result['fitting'])
        self.assertEqual(digest(self.source), observation['sourceSha256'])
        self.source.write_bytes(self.source.read_bytes() + b'changed')
        with self.assertRaisesRegex(ValueError, 'BODY_INPUT_CHANGED'):
            validate_contract(self.source, self.reference, entry, self.region, self.material_id, self.snapshot_digest, **common)


if __name__ == '__main__':
    unittest.main()
