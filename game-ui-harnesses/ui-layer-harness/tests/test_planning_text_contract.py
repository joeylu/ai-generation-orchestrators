"""Offline text-contract regression against committed shared fad597a0 fixtures."""
import _bootstrap
import copy
import json
from pathlib import Path
import subprocess
import tempfile
import unittest

from jsonschema import Draft202012Validator, ValidationError
from ai_ui_layers.coverage_review import REGIONS, EXACT_TEXT_POLICY, coverage_findings
from ai_ui_layers.evaluate import digest, read, save
from ai_ui_layers.planning_normalization import (
    POLICY, provider_schema, normalize, derive, verified_plan_path, m1_plan_path)
from ai_ui_layers.review_evidence import build_catalog, build_review_schema, resolve_review, PROTOCOL_V3
from ai_ui_layers.planning_review_policy import split

REPO = Path(__file__).resolve().parents[3]
SHARED = 'game-ui-harnesses/ui-decomposition-harness/planning-harness/'


def fixed_json(name):
    result = subprocess.run(['git', '-c', 'safe.directory='+REPO.as_posix(),
        'show', 'fad597a0:'+SHARED+name], cwd=REPO, check=True,
        capture_output=True)
    return json.loads(result.stdout)


def audit(fragment='Recipes'):
    entry = dict(artwork='Recipe book title', disposition='business-text',
        materialId='asset-panel', objectId=None, planEvidenceQuote=None,
        evidence='The book heading is business copy.', suggestedChange=None,
        businessText=[fragment])
    return dict(issues=[], coverageAudit=[dict(region=name,
        observedArtwork=[entry] if index == 0 else [],
        emptyRegionEvidence=None if index == 0 else 'No artwork visible here.')
        for index, name in enumerate(REGIONS)])


class TextContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.storage = fixed_json('schemas/visual-plan.schema.json')
        cls.plan = fixed_json('examples/visual-plan-scoped.json')

    def mixed_plan(self):
        plan = copy.deepcopy(self.plan)
        plan['materials'][1]['preserveText'] = ['Happiness in Every Roll']
        return plan

    def test_separate_decorative_license_and_business_fragment(self):
        self.assertEqual(coverage_findings(audit(), self.mixed_plan(),
            coverage_text_policy=EXACT_TEXT_POLICY), [])
        # Explicit fragments, not artwork description or evidence prose, decide overlap.
        changed = audit()
        changed['coverageAudit'][0]['observedArtwork'][0]['artwork'] = 'Happiness in Every Roll'
        self.assertEqual(coverage_findings(changed, self.mixed_plan(),
            coverage_text_policy=EXACT_TEXT_POLICY), [])

    def test_same_partial_case_and_whitespace_business_license_block(self):
        for kept in ('Recipes', 'RECIPES', 'Rec ipes', 'My Recipes Today', 'Recipe'):
            with self.subTest(kept=kept):
                plan = self.mixed_plan()
                plan['materials'][1]['preserveText'] = [kept]
                with self.assertRaisesRegex(ValueError, 'COVERAGE_PRESERVED_TEXT_CONFLICT'):
                    coverage_findings(audit(), plan, coverage_text_policy=EXACT_TEXT_POLICY)

    def test_legacy_rejects_mixed_license_without_new_contract(self):
        old = audit()
        old['coverageAudit'][0]['observedArtwork'][0].pop('businessText')
        with self.assertRaisesRegex(ValueError, 'COVERAGE_PRESERVED_TEXT_CONFLICT'):
            coverage_findings(old, self.mixed_plan())

    def test_fragments_are_required_and_cannot_bypass_owner_or_policy(self):
        for fragments in (None, [], [' ']):
            with self.subTest(fragments=fragments):
                review = audit()
                review['coverageAudit'][0]['observedArtwork'][0]['businessText'] = fragments
                with self.assertRaises((ValueError, ValidationError)):
                    coverage_findings(review, self.mixed_plan(), coverage_text_policy=EXACT_TEXT_POLICY)
        for changes in (dict(materialId=None), dict(materialId='missing'),
                        dict(objectId='crest')):
            review = audit()
            review['coverageAudit'][0]['observedArtwork'][0].update(changes)
            with self.assertRaises(ValueError):
                coverage_findings(review, self.mixed_plan(), coverage_text_policy=EXACT_TEXT_POLICY)
        plan = self.mixed_plan()
        plan['textPolicy'] = 'keep-all'
        with self.assertRaisesRegex(ValueError, 'COVERAGE_BUSINESS_TEXT_POLICY_REQUIRED'):
            coverage_findings(audit(), plan, coverage_text_policy=EXACT_TEXT_POLICY)

    def test_new_policy_does_not_skip_missing_graphics(self):
        review = audit()
        review['coverageAudit'][1].update(emptyRegionEvidence=None, observedArtwork=[dict(
            artwork='Glass cover', disposition='missing', materialId=None, objectId=None,
            planEvidenceQuote=None, evidence='An independent glass cover is visible.',
            suggestedChange='Assign its artwork owner.', businessText=None)])
        findings = coverage_findings(review, self.mixed_plan(), coverage_text_policy=EXACT_TEXT_POLICY)
        self.assertEqual(findings[0]['code'], 'UNASSIGNED_VISIBLE_ARTWORK')

    def test_typed_transport_resolution_and_severity_propagate_explicit_contract(self):
        plan = self.mixed_plan()
        catalog = build_catalog(plan)
        raw = dict(issues=[], cosmeticIssues=[], planEvidenceCatalogDigest=catalog['digest'],
            planEvidenceProtocol=PROTOCOL_V3, coverageAudit=[dict(region=name,
                observedArtwork=[], businessText=[dict(artwork='Book title',
                    materialId='asset-panel', evidence='Heading above the recipe rows.',
                    textFragments=['Recipes'])] if index == 0 else [],
                emptyRegionEvidence=None if index == 0 else 'No artwork here.')
                for index, name in enumerate(REGIONS)])
        schema = build_review_schema(catalog, None, None, coverage_text_policy=EXACT_TEXT_POLICY)
        Draft202012Validator(schema).validate(raw)
        with self.assertRaises(ValidationError):
            Draft202012Validator(build_review_schema(catalog, None, None)).validate(raw)
        saved = copy.deepcopy(raw)
        resolved = resolve_review(raw, plan, EXACT_TEXT_POLICY)
        self.assertEqual(resolved['coverageAudit'][0]['observedArtwork'][0]['businessText'], ['Recipes'])
        self.assertEqual(split(raw, plan, coverage_text_policy=EXACT_TEXT_POLICY), ([], []))
        self.assertEqual(raw, saved)
        raw['coverageAudit'][0]['businessText'][0]['textFragments'] = ['Happiness in Every Roll']
        with self.assertRaisesRegex(ValueError, 'COVERAGE_PRESERVED_TEXT_CONFLICT'):
            split(raw, plan, coverage_text_policy=EXACT_TEXT_POLICY)

    def raw_plan(self):
        plan = copy.deepcopy(self.plan)
        plan['materials'][0]['preserveText'] = ['STAY', 'PEOPLE', 'STAY', 'PEOPLE', ' stay ']
        plan['materials'][1]['preserveText'] = ['ROLL', 'ROLL']
        return plan

    def test_provider_schema_changes_only_license_uniqueness(self):
        source = copy.deepcopy(self.storage)
        expected = copy.deepcopy(self.storage)
        expected['properties']['materials']['items']['properties']['preserveText'].pop('uniqueItems')
        self.assertEqual(provider_schema(source, POLICY), expected)
        self.assertEqual(source, self.storage)
        self.assertEqual(provider_schema(source), source)
        raw = self.raw_plan()
        with self.assertRaises(ValidationError):
            Draft202012Validator(source).validate(raw)
        Draft202012Validator(provider_schema(source, POLICY)).validate(raw)
        for invalid in (['STAY']*65, [''], [1]):
            bad = copy.deepcopy(raw)
            bad['materials'][0]['preserveText'] = invalid
            with self.assertRaises(ValidationError):
                Draft202012Validator(provider_schema(source, POLICY)).validate(bad)

    def test_deduplicate_identical_only_preserving_first_order(self):
        raw = self.raw_plan()
        saved = copy.deepcopy(raw)
        normalized, changes = normalize(raw, POLICY)
        self.assertEqual(raw, saved)
        self.assertEqual(normalized['materials'][0]['preserveText'], ['STAY', 'PEOPLE', ' stay '])
        self.assertEqual(changes[0]['removedIndices'], [2, 3])
        expected = copy.deepcopy(raw)
        expected['materials'][0]['preserveText'] = ['STAY', 'PEOPLE', ' stay ']
        expected['materials'][1]['preserveText'] = ['ROLL']
        self.assertEqual(normalized, expected)
        Draft202012Validator(self.storage).validate(normalized)

    def folder(self, root):
        root = Path(root)
        save(root/'draft.json', self.raw_plan())
        save(root/'transport.json', dict(responseSha256=digest(root/'draft.json'),
            exitCode=0, turnCompleted=True, unexpectedEvents=[], fixture=True))
        save(root/'storage.json', self.storage)
        return root

    def test_derived_provenance_keeps_raw_and_detects_mutations(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder = self.folder(tmp)
            original = (folder/'draft.json').read_bytes()
            receipt = (folder/'transport.json').read_bytes()
            path = derive(folder, folder/'storage.json', POLICY)
            self.assertEqual(path.name, 'normalized-plan.json')
            self.assertEqual(verified_plan_path(folder, folder/'storage.json', POLICY), path)
            self.assertEqual((folder/'draft.json').read_bytes(), original)
            self.assertEqual((folder/'transport.json').read_bytes(), receipt)
            with self.assertRaisesRegex(ValueError, 'ARTIFACT_EXISTS'):
                derive(folder, folder/'storage.json', POLICY)
            path.write_text(json.dumps(self.plan), encoding='utf-8')
            with self.assertRaisesRegex(ValueError, 'ARTIFACT_CHANGED'):
                verified_plan_path(folder, folder/'storage.json', POLICY)

    def test_raw_receipt_strict_schema_and_legacy_are_still_required(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder = self.folder(tmp)
            with self.assertRaises(ValidationError):
                derive(folder, folder/'storage.json', None)
            receipt = read(folder/'transport.json')
            receipt['responseSha256'] = '0'*64
            (folder/'transport.json').write_text(json.dumps(receipt), encoding='utf-8')
            with self.assertRaisesRegex(ValueError, 'MODEL_OUTPUT_CHANGED'):
                derive(folder, folder/'storage.json', POLICY)
            self.assertFalse((folder/'normalized-plan.json').exists())

    def test_bad_plan_fields_and_failed_transport_cannot_be_normalized(self):
        for failure in ('role', 'receipt', 'report'):
            with self.subTest(failure=failure), tempfile.TemporaryDirectory() as tmp:
                folder = self.folder(tmp)
                if failure == 'role':
                    raw = read(folder/'draft.json')
                    raw['materials'][0]['role'] = 'anything'
                    (folder/'draft.json').write_text(json.dumps(raw), encoding='utf-8')
                    receipt = read(folder/'transport.json')
                    receipt['responseSha256'] = digest(folder/'draft.json')
                    (folder/'transport.json').write_text(json.dumps(receipt), encoding='utf-8')
                    with self.assertRaises(ValidationError):
                        derive(folder, folder/'storage.json', POLICY)
                elif failure == 'receipt':
                    receipt = read(folder/'transport.json')
                    receipt['turnCompleted'] = False
                    (folder/'transport.json').write_text(json.dumps(receipt), encoding='utf-8')
                    with self.assertRaisesRegex(ValueError, 'MODEL_CALL_FAILED'):
                        derive(folder, folder/'storage.json', POLICY)
                else:
                    derive(folder, folder/'storage.json', POLICY)
                    report = read(folder/'normalization-report.json')
                    report['changes'] = []
                    (folder/'normalization-report.json').write_text(json.dumps(report), encoding='utf-8')
                    with self.assertRaisesRegex(ValueError, 'ARTIFACT_CHANGED'):
                        verified_plan_path(folder, folder/'storage.json', POLICY)

    def test_archived_source_resolver_does_not_require_new_job_artifacts(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.assertEqual(m1_plan_path(root), root/'m1/draft.json')
            (root/'.dag').mkdir()
            save(root/'.dag/config.json', dict(kind='ui_planning_dag_v1'))
            self.assertEqual(m1_plan_path(root), root/'m1/draft.json')

    def test_new_job_freezes_derived_plan_and_separate_decorative_business_text(self):
        # The fixture runner binds every shared import to committed fad597a0.
        from PIL import Image
        from ai_ui_layers.planning_dag import init, Dag
        from ai_ui_layers.compile_visual import verify_run
        from ai_ui_layers.execution_preflight import preflight
        from test_planning_dag import FakeModel
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            Image.new('RGB', (1000, 1000)).save(root/'input.png')
            job = init(root/'input.png', root/'job', 8)
            base = FakeModel(repair=False)
            raw_sha = []
            calls = []
            def model(folder, sid, first):
                calls.append(folder.name)
                base(folder, sid, first)
                answer = read(folder/'draft.json')
                if first:
                    answer['materials'][0]['preserveText'] = ['STAY', 'PEOPLE', 'STAY', 'PEOPLE']
                    answer['materials'][1]['preserveText'] = ['Happiness in Every Roll']
                else:
                    answer['coverageAudit'][0]['businessText'].append(dict(artwork='Recipe title',
                        materialId='asset-panel', evidence='Business heading on the panel.',
                        textFragments=['Recipes']))
                (folder/'draft.json').write_text(json.dumps(answer), encoding='utf-8')
                receipt = read(folder/'transport.json')
                receipt['responseSha256'] = digest(folder/'draft.json')
                (folder/'transport.json').write_text(json.dumps(receipt), encoding='utf-8')
                if first:raw_sha.append(receipt['responseSha256'])
            result = Dag(job, model).execute()
            self.assertEqual(result['status'], 'frozen')
            self.assertEqual(calls, ['m1', 'm2'])
            self.assertEqual(digest(job/'m1/draft.json'), raw_sha[0])
            self.assertEqual(read(job/'m1/draft.json')['materials'][0]['preserveText'],
                             ['STAY', 'PEOPLE', 'STAY', 'PEOPLE'])
            self.assertEqual(verify_run(job)['materials'][0]['preserveText'], ['STAY', 'PEOPLE'])
            snapshot = read(job/'frozen/snapshot.json')
            self.assertEqual(preflight(job/'frozen', snapshot['digest'])['inputChecks'], 'passed')


if __name__ == '__main__':
    unittest.main()
