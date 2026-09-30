"""Offline contract checks for a fresh, bounded crop revision of a frozen plan.

The model and observed edge are fixtures; these tests do not establish visual
acceptance or authorize any image generation.
"""
import _bootstrap
from contextlib import redirect_stderr, redirect_stdout
import copy
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch as mock_patch

from PIL import Image, ImageDraw
from jsonschema import ValidationError

from ai_ui_layers.compile_visual import verify_run
from ai_ui_layers import delivery_dag, planning_dag, revise_frozen_crop
from ai_ui_layers.evaluate import digest, read, save
from ai_ui_layers.execution_preflight import preflight
from ai_ui_layers.freeze_visual import freeze
from ai_ui_layers.planning_dag import Dag, init as planning_init
from ai_ui_layers.revise_frozen_crop import (
    FrozenCropDag, check_inputs, init as revise_crop, verify_revision,
)
from test_planning_dag import FakeModel, SID as PARENT_SID, coverage, small_audit, small_boundary_audit


CHILD_SID = 'abcdef01-1234-1234-1234-123456789abc'
OWNER = 'asset-coin-a'
OTHER = 'asset-coin-b'


def fingerprints(folder):
    return {path.relative_to(folder).as_posix(): digest(path)
            for path in folder.rglob('*') if path.is_file()}


class FrozenCropRevisionTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.base = Path(temporary.name)
        source = self.base/'source.png'
        image = Image.new('RGB', (1000, 1000), (175, 190, 205))
        # The parent fixture plan ends coin-a at x=750; x=750 is visible source
        # evidence for the one-column outward crop requested below.
        ImageDraw.Draw(image).point((750, 275), fill=(30, 50, 90))
        image.save(source)
        self.parent = planning_init(source, self.base/'parent', 12,
                                    generation_mode='sheets',
                                    generation_reference='context-crops')
        self.parent_result = Dag(self.parent, FakeModel()).execute()
        self.assertEqual(self.parent_result['status'], 'frozen')
        self.parent_files = fingerprints(self.parent)
        self.assertIn('.dag/lock', self.parent_files)
        self.rejection = self.base/'rejection.json'
        self.write_rejection([dict(materialId=OWNER,
                                   sourceEvidence='Fixture pixel at x=750 lies beyond the half-open crop.')])
        self.calls = []

    def write_rejection(self, findings, *, path=None, snapshot_digest=None, reference_sha=None):
        path = path or self.rejection
        path.write_text(json.dumps(dict(kind='ui_frozen_crop_rejection_v1',
            parentSnapshotDigest=snapshot_digest or self.parent_result['snapshotDigest'],
            referenceSha256=reference_sha or digest(self.parent/'m1/reference.png'),
            findings=findings), ensure_ascii=False), encoding='utf-8')
        return path

    def child(self, name='child', rejection=None):
        return revise_crop(self.parent, self.base/name, rejection or self.rejection)

    @staticmethod
    def patch(root):
        source = root/'source-plan.json'
        material = copy.deepcopy(next(row for row in read(source)['materials'] if row['id'] == OWNER))
        material['bboxNorm'][2] = .751
        return dict(sourcePlanSha256=digest(source),
                    materials=dict(upsert=[material], remove=[]),
                    objects=dict(upsert=[], remove=[]),
                    unknowns=None, backgroundMode=None, textPolicy=None,
                    unresolvedIssues=[])

    def model(self, *, mutate_patch=None, review_status=None, unresolved=False,
              fail_at=None):
        def call(folder, sid, first):
            self.calls.append((folder.name, sid, first))
            if folder.name == 'repair':
                self.assertTrue(first)
                self.assertIsNone(sid)
                answer = self.patch(folder.parent)
                if mutate_patch is not None:
                    mutate_patch(answer, read(folder.parent/'source-plan.json'))
            else:
                self.assertEqual(folder.name, 'rereview')
                self.assertFalse(first)
                self.assertEqual(sid, CHILD_SID)
                answer = dict(issues=[], coverageAudit=coverage(),
                              smallMaterialAudit=small_audit(folder))
                boundary = small_boundary_audit(folder)
                if boundary:
                    answer['smallBoundaryAudit'] = boundary
                if review_status is not None:
                    answer['smallMaterialAudit'][OWNER]['parts'][0]['descriptionStatus'] = review_status
                if unresolved:
                    answer['issues'] = [dict(code='CROP_STILL_CLIPPED', category='geometry',
                        ids=[OWNER], description='The same source pixel remains outside.',
                        suggestedChange='Inspect the visible right edge.')]
            save(folder/'draft.json', answer)
            (folder/'events.jsonl').write_text(json.dumps(dict(
                type='thread.started', thread_id=CHILD_SID)), encoding='utf-8')
            receipt = dict(exitCode=0, turnCompleted=True, unexpectedEvents=[],
                           responseSha256=digest(folder/'draft.json'), elapsedSeconds=.01)
            if folder.name == fail_at:
                receipt.update(exitCode=1, turnCompleted=False,
                               failure='indeterminate provider outcome')
            save(folder/'transport.json', receipt)
        return call

    def test_fresh_child_freezes_with_parent_bytes_unchanged_and_new_session(self):
        root = self.child()
        self.assertNotEqual(CHILD_SID, read(self.parent/'session.json')['sessionId'])
        self.assertEqual(read(root/'source-plan.json'), read(self.parent/'m1/draft.json'))
        check_inputs(root)
        result = FrozenCropDag(root, self.model()).execute()
        self.assertEqual(result['status'], 'frozen')
        self.assertEqual(self.calls, [('repair', None, True),
                                      ('rereview', CHILD_SID, False)])
        self.assertEqual(verify_revision(root), read(root/'repair/candidate.json'))
        self.assertEqual(verify_run(root), read(root/'repair/candidate.json'))
        self.assertEqual(read(root/'repair/candidate.json')['materials'][3]['bboxNorm'][2], .751)
        snapshot = read(root/'frozen/snapshot.json')
        self.assertEqual(snapshot['generationReference'], 'context-crops')
        self.assertEqual(preflight(root/'frozen', result['snapshotDigest'])['inputChecks'], 'passed')
        self.assertEqual(fingerprints(self.parent), self.parent_files)
        self.assertFalse(result.get('humanVisualAcceptance', False))

    def test_rejection_requires_unique_existing_foreground_with_evidence(self):
        cases = dict(empty=[], foreign=[dict(materialId='not-in-plan', sourceEvidence='Visible edge.')],
                     background=[dict(materialId='asset-scene', sourceEvidence='Visible edge.')],
                     duplicate=[dict(materialId=OWNER, sourceEvidence='First observation.'),
                                dict(materialId=OWNER, sourceEvidence='Second observation.')],
                     no_evidence=[dict(materialId=OWNER, sourceEvidence='')])
        for name, findings in cases.items():
            with self.subTest(name=name):
                rejection = self.write_rejection(findings, path=self.base/(name+'.json'))
                with self.assertRaises((ValueError, ValidationError)):
                    self.child(name+'-child', rejection)
                self.assertFalse((self.base/(name+'-child')).exists())
        self.assertEqual(self.calls, [])
        self.assertEqual(fingerprints(self.parent), self.parent_files)

    def test_rejection_digest_and_source_fingerprint_must_match_parent(self):
        for name, kw in [('snapshot', dict(snapshot_digest='0'*64)),
                         ('reference', dict(reference_sha='1'*64))]:
            with self.subTest(name=name):
                rejection = self.write_rejection(
                    [dict(materialId=OWNER, sourceEvidence='One excluded source pixel.')],
                    path=self.base/(name+'.json'), **kw)
                with self.assertRaises(ValueError):
                    self.child(name+'-child', rejection)

    def test_bound_parent_tampering_stops_before_a_child_model_call(self):
        root = self.child()
        prompt = self.parent/'frozen/materials'/OWNER/'prompt.txt'
        prompt.write_text('tampered after child init', encoding='utf-8')
        with self.assertRaises(ValueError):
            check_inputs(root)
        with self.assertRaises(ValueError):
            FrozenCropDag(root, self.model()).execute()
        self.assertEqual(self.calls, [])
        self.assertFalse((root/'repair').exists())

    def test_bound_rejection_tampering_stops_before_a_child_model_call(self):
        root = self.child()
        candidates = [root/'rejection.json', root/'rejection-input.json', self.rejection]
        bound = next((path for path in candidates if path.exists() and
                      path.is_relative_to(root)), self.rejection)
        bound.write_text('{"kind":"changed"}', encoding='utf-8')
        with self.assertRaises(ValueError):
            check_inputs(root)
        with self.assertRaises(ValueError):
            FrozenCropDag(root, self.model()).execute()
        self.assertEqual(self.calls, [])

    def test_patch_cannot_change_anything_except_selected_material_bbox(self):
        def variant(name):
            def change(patch, source):
                selected = patch['materials']['upsert'][0]
                if name == 'other-material':
                    other = copy.deepcopy(next(row for row in source['materials'] if row['id'] == OTHER))
                    other['bboxNorm'][2] += .001
                    patch['materials']['upsert'].append(other)
                elif name == 'label':
                    selected['label'] += ' altered'
                elif name == 'object':
                    obj = copy.deepcopy(next(row for row in source['objects'] if row['materialId'] == OWNER))
                    obj['label'] += ' altered'
                    patch['objects']['upsert'].append(obj)
                elif name == 'add-material':
                    added = copy.deepcopy(selected);added['id'] = 'new-material'
                    patch['materials']['upsert'].append(added)
                elif name == 'remove-material':
                    patch['materials'] = dict(upsert=[], remove=[OWNER])
                elif name == 'background-mode':
                    patch['backgroundMode'] = 'scene-only'
                elif name == 'unknowns':
                    patch['unknowns'] = ['Fixture introduced a new unresolved question.']
            return change
        for name in ('other-material', 'label', 'object', 'add-material',
                     'remove-material', 'background-mode', 'unknowns'):
            with self.subTest(name=name):
                self.calls = []
                root = self.child(name)
                with self.assertRaises(ValueError):
                    FrozenCropDag(root, self.model(mutate_patch=variant(name))).execute()
                self.assertEqual(self.calls, [('repair', None, True)])
                self.assertFalse((root/'rereview').exists())
                self.assertFalse((root/'frozen').exists())
        self.assertEqual(fingerprints(self.parent), self.parent_files)

    def test_identical_pixel_box_does_not_count_as_crop_revision(self):
        def unchanged(patch, source):
            patch['materials']['upsert'][0]['bboxNorm'] = copy.deepcopy(next(
                row['bboxNorm'] for row in source['materials'] if row['id'] == OWNER))
        root = self.child()
        with self.assertRaises(ValueError):
            FrozenCropDag(root, self.model(mutate_patch=unchanged)).execute()
        self.assertEqual(self.calls, [('repair', None, True)])
        self.assertFalse((root/'frozen').exists())

    def test_indeterminate_first_call_is_terminal_without_resubmission(self):
        root = self.child()
        dag = FrozenCropDag(root, self.model(fail_at='repair'))
        with self.assertRaises(ValueError):
            dag.execute()
        self.assertEqual(self.calls, [('repair', None, True)])
        self.assertFalse((root/'frozen').exists())
        with self.assertRaisesRegex(ValueError, 'NO_RESUBMIT'):
            dag.execute()
        self.assertEqual(len(self.calls), 1)

    def test_parent_session_returned_by_first_receipt_stops_before_resume(self):
        root = self.child()
        normal = self.model()
        def returned_parent(folder, sid, first):
            normal(folder, sid, first)
            (folder/'events.jsonl').write_text(json.dumps(dict(
                type='thread.started', thread_id=PARENT_SID)), encoding='utf-8')
        with self.assertRaisesRegex(ValueError, 'PARENT_SESSION_REUSED'):
            FrozenCropDag(root, returned_parent).execute()
        self.assertEqual(self.calls, [('repair', None, True)])
        self.assertFalse((root/'rereview').exists())
        self.assertEqual(fingerprints(self.parent), self.parent_files)

    def test_legacy_context_prompt_version_is_inherited_and_cannot_be_overridden(self):
        actual_freeze = planning_dag.freeze
        for version in ('v1', 'v2'):
            with self.subTest(version=version):
                parent = planning_init(self.base/'source.png', self.base/('parent-'+version),
                    12, generation_mode='sheets', generation_reference='context-crops')
                def legacy_freeze(*args, **kwargs):
                    return actual_freeze(*args, **kwargs, context_prompt_version=version)
                with mock_patch.object(planning_dag, 'freeze', legacy_freeze):
                    result = Dag(parent, FakeModel()).execute()
                self.parent, self.parent_result = parent, result
                self.parent_files = fingerprints(parent)
                self.write_rejection([dict(materialId=OWNER, sourceEvidence='Excluded fixture pixel.')])
                self.calls = []
                root = self.child('child-'+version)
                self.assertEqual(read(root/'revision.json')['contextPromptVersion'], version)
                FrozenCropDag(root, self.model()).execute()
                self.assertEqual(read(root/'frozen/snapshot.json').get('contextPromptVersion', 'v1'), version)
                with self.assertRaisesRegex(ValueError, 'FROZEN_CROP_GENERATION_POLICY_CHANGED'):
                    freeze(root, self.base/('override-'+version), 12, 'sheets', 'context-crops',
                           context_prompt_version='v3')
                self.assertFalse((self.base/('override-'+version)).exists())
                self.assertEqual(fingerprints(parent), self.parent_files)
                self.assertEqual(len(self.calls), 2)

    def test_unresolved_new_review_is_terminal_after_two_calls(self):
        root = self.child()
        dag = FrozenCropDag(root, self.model(unresolved=True))
        with self.assertRaisesRegex(ValueError, 'REREVIEW_UNRESOLVED'):
            dag.execute()
        self.assertEqual(self.calls, [('repair', None, True),
                                      ('rereview', CHILD_SID, False)])
        self.assertFalse((root/'frozen').exists())
        with self.assertRaisesRegex(ValueError, 'NO_RESUBMIT'):
            dag.execute()
        self.assertEqual(len(self.calls), 2)

    def test_empty_top_level_issues_cannot_bypass_derived_description_blocker(self):
        root = self.child()
        dag = FrozenCropDag(root, self.model(review_status='conflicting'))
        with self.assertRaisesRegex(ValueError, 'REREVIEW_UNRESOLVED'):
            dag.execute()
        self.assertEqual(read(root/'rereview/draft.json')['issues'], [])
        self.assertIn('SMALL_MATERIAL_DESCRIPTION_REVIEW',
                      [row['code'] for row in read(root/'rereview/assessment.json')['blockers']])
        # A rejected review never completes its DAG node. Direct verification
        # must reject that incomplete stage before it can consider freezing.
        with self.assertRaisesRegex(ValueError, 'REVISION_STAGES_INCOMPLETE'):
            verify_revision(root)
        with self.assertRaisesRegex(ValueError, 'REVISION_STAGES_INCOMPLETE'):
            freeze(root, self.base/'direct-freeze', 12, 'sheets', 'context-crops')
        self.assertFalse((self.base/'direct-freeze').exists())
        self.assertEqual(len(self.calls), 2)

    def test_direct_verification_rechecks_scope_and_receipts(self):
        root = self.child()
        FrozenCropDag(root, self.model()).execute()
        original_patch = read(root/'repair/draft.json')
        changed = copy.deepcopy(original_patch)
        changed['materials']['upsert'][0]['label'] += ' tampered'
        (root/'repair/draft.json').write_text(json.dumps(changed), encoding='utf-8')
        receipt = read(root/'repair/transport.json')
        receipt['responseSha256'] = digest(root/'repair/draft.json')
        (root/'repair/transport.json').write_text(json.dumps(receipt), encoding='utf-8')
        with self.assertRaises(ValueError):
            verify_revision(root)
        with self.assertRaises(ValueError):
            freeze(root, self.base/'scope-direct-freeze', 12, 'sheets', 'context-crops')
        (root/'repair/draft.json').write_text(json.dumps(original_patch), encoding='utf-8')
        receipt['responseSha256'] = '0'*64
        (root/'repair/transport.json').write_text(json.dumps(receipt), encoding='utf-8')
        with self.assertRaises(ValueError):
            verify_revision(root)
        with self.assertRaises(ValueError):
            freeze(root, self.base/'receipt-direct-freeze', 12, 'sheets', 'context-crops')
        self.assertEqual(len(self.calls), 2)


class FrozenCropRevisionCliTests(unittest.TestCase):
    def test_frontend_passes_bound_arguments_and_emits_one_result_json(self):
        result = dict(kind='ui_rejected_frozen_crop_status_v1', status='frozen',
                      snapshotDigest='a'*64, mediaGenerationCalls=0)
        calls = []

        class StubDag:
            def __init__(self, root):
                calls.append(('construct', root))

            def execute(self):
                print('repair completed')
                print('rereview completed')
                return result

        stdout, stderr = io.StringIO(), io.StringIO()
        argv = ['ui_layer', 'revise-frozen-crops', '--planning-run', 'parent',
                '--rejection', 'finding.json', '--output', 'new']
        with mock_patch.object(sys, 'argv', argv), \
                mock_patch.object(revise_frozen_crop, 'init', return_value=Path('new')) as init, \
                mock_patch.object(revise_frozen_crop, 'FrozenCropDag', StubDag), \
                redirect_stdout(stdout), redirect_stderr(stderr):
            delivery_dag.main()
        init.assert_called_once_with('parent', 'new', 'finding.json')
        self.assertEqual(calls, [('construct', Path('new'))])
        self.assertEqual(json.loads(stdout.getvalue()), result)
        self.assertEqual(stdout.getvalue().count('"kind"'), 1)
        self.assertNotIn('repair completed', stdout.getvalue())
        self.assertEqual(stderr.getvalue().splitlines(),
                         ['repair completed', 'rereview completed'])

    def test_frontend_requires_rejection_before_any_revision_call(self):
        stdout, stderr = io.StringIO(), io.StringIO()
        argv = ['ui_layer', 'revise-frozen-crops', '--planning-run', 'parent',
                '--output', 'new']
        with mock_patch.object(sys, 'argv', argv), \
                mock_patch.object(revise_frozen_crop, 'init') as init, \
                mock_patch.object(revise_frozen_crop, 'FrozenCropDag') as dag, \
                redirect_stdout(stdout), redirect_stderr(stderr):
            with self.assertRaises(SystemExit) as exit_info:
                delivery_dag.main()
        self.assertEqual(exit_info.exception.code, 2)
        init.assert_not_called()
        dag.assert_not_called()
        self.assertEqual(stdout.getvalue(), '')
        self.assertIn('--rejection required', stderr.getvalue())


if __name__ == '__main__':
    unittest.main()
