"""Offline capacity and same-run delivery regressions; no external compute."""
import _bootstrap
import unittest
from pathlib import Path
from unittest.mock import patch

from ai_ui_layers import host_delivery as host, host_m1, host_review, host_layout_registration as layout
from ai_ui_layers import planning_capacity as capacity
from ai_ui_layers.coverage_review import TEXT_OCCURRENCES_POLICY
from ai_ui_layers.generation_groups import COMPACT_CONTROL_V2, COMPACT_CONTROL_V3, COMPACT_CONTROL_V5
from ai_ui_layers.evaluate import read, save, digest, pixel_box
from ai_ui_layers.execution_preflight import preflight
from ai_ui_layers.viewport_geometry_revision import validate_viewport_archive
import test_host_delivery as fixtures
import test_host_m1 as m1_fixtures
import test_host_sheet_fallback as sheet_fixtures
import test_fast_warning_delivery as fast_fixtures


class CapacityEstimateTests(unittest.TestCase):
    def estimate(self, rows, policy):
        # Neutral geometry fixture: thirteen complete illustrated cards and six
        # independent large panels reproduced nineteen old requests at budget 16.
        visual=dict(materials=[],objects=[])
        for i,(kinds,w,h) in enumerate(rows):
            key='unit-'+str(i)
            visual['materials'].append(dict(id=key,zOrder=i,
                role='background' if i==0 else 'foreground',bboxNorm=[0,0,w/2048,h/2048]))
            visual['objects'] += [dict(materialId=key,kind=kind) for kind in kinds]
        config=dict(generationMode='sheets',generationGroupingPolicy=policy,maximumImageCalls=16,
            maximumMaterialReviews=16,maximumBodyCalls=1,visualReviewMode='warning',
            sheetFailurePolicy='continue-reviewed-materials-on-sheet-warning-v2',bodyReviewPolicy='final-composite-first-v1')
        return capacity.estimate(visual,(2048,2048),config)

    def test_nineteen_request_failure_fits_original_budget_without_dropping_materials(self):
        rows=[(('background',),2048,2048)]+[(('panel',),1024,1024)]*5+[(('card','illustration'),206,176)]*13
        before=self.estimate(rows,COMPACT_CONTROL_V2)
        after=self.estimate(rows,COMPACT_CONTROL_V3)
        self.assertEqual((before['plannedCalls'],before['status']),(19,'capacity_exceeded'))
        self.assertEqual((after['plannedCalls'],after['status']),(9,'within_capacity'))
        self.assertEqual(after['requiredCalls']['bodyObservations'],0)
        self.assertEqual(after['materialCount'],before['materialCount'])
        self.assertEqual({mid for g in after['groups'] for mid in g['materialIds']},
            {mid for g in before['groups'] for mid in g['materialIds']})

    def test_seventeen_request_failure_becomes_fifteen_with_three_complete_order_cards(self):
        rows=[(('background',),2048,2048)]+[(('panel',),1024,1024)]*13+[(('card','illustration','badge'),377,162)]*3
        self.assertEqual(self.estimate(rows,COMPACT_CONTROL_V2)['plannedCalls'],17)
        self.assertEqual(self.estimate(rows,COMPACT_CONTROL_V3)['plannedCalls'],15)


class FreshCapacityHostTests(unittest.TestCase):
    setUp=fixtures.HostDeliveryTests.setUp
    generate=m1_fixtures.FreshHostM1Tests.generate

    def start(self, **changes):
        config=read(self.config_path);config.pop('seed')
        config.update(planningMode=host_m1.MODE,m1Planner='fixture-author',visualReviewMode='warning')
        config.update(changes)
        path=self.base/'fresh-capacity-config.json';save(path,config)
        self.run=self.base/'fresh-capacity';host.prepare(path,self.run);self.root=self.run/'planning'
        self.plan['layoutRegistration']=dict(kind=layout.KIND,referenceSha256=digest(self.reference),
            materials=[dict(materialId=m['id'],mode='frame',measurementAlphaThreshold=128)
                for m in self.plan['materials'] if m['role']=='foreground'],constraints=[],knownDifferences=[])

    def test_capacity_is_reported_before_m2_and_matches_frozen_requests(self):
        self.start();state=self.generate()
        self.assertEqual(state['stage'],'planning_review')
        config=read(self.run/'config.json')
        self.assertEqual(config['generationGroupingPolicy'],COMPACT_CONTROL_V5)
        self.assertEqual(config['planningCapacityPolicy'],capacity.POLICY)
        self.assertEqual(state['planningCapacity']['materialCount'],len(self.plan['materials']))
        self.assertEqual(state['planningCapacity']['status'],'within_capacity')
        self.assertFalse((self.run/'planning/m2/draft.json').exists())
        prompt=(self.run/'planning-m1/prompt.md').read_text('utf-8')
        self.assertIn('生图最多 16 次',prompt)
        self.assertIn(COMPACT_CONTROL_V5,prompt)
        self.assertIn('keep every helper script',prompt)
        review_prompt=(self.root/'m2/prompt.md').read_text('utf-8')
        self.assertIn('helper script or scratch file outside the host run',review_prompt)
        self.assertIn('Repeated identical textFragments',review_prompt)
        self.assertEqual(read(self.root/'.dag/config.json')['coverageTextPolicy'],TEXT_OCCURRENCES_POLICY)
        self.assertEqual(list((self.run/'scopes/planning_review').glob('*-submission.json')),[])

    def test_overflow_is_terminal_before_any_m2_or_image_reservation(self):
        self.start(maximumImageCalls=1)
        with self.assertRaisesRegex(ValueError,'CAPACITY_EXCEEDED_BEFORE_M2'):self.generate()
        state=host.status(self.run)
        self.assertEqual(state['status'],'failed_no_retry')
        self.assertIn('images',state['planningCapacity']['exceeded'])
        self.assertFalse((self.run/'planning').exists())
        self.assertFalse((self.run/'images').exists())
        self.assertFalse((self.run/'scopes/planning_review').exists())
        self.assertEqual((self.run/'planning-m1/draft.json').read_bytes(),self.response.read_bytes())
        before=host._files(self.run);host.resume(self.run)
        self.assertEqual(host._files(self.run),before)

    def test_material_review_budget_is_checked_before_m2_as_well(self):
        self.start(maximumMaterialReviews=1,materialReviewPolicy='per-request-v1')
        with self.assertRaisesRegex(ValueError,'CAPACITY_EXCEEDED_BEFORE_M2'):self.generate()
        self.assertIn('materialReviews',host.status(self.run)['planningCapacity']['exceeded'])
        self.assertFalse((self.run/'planning').exists())

    def test_one_composite_review_budget_does_not_limit_image_groups(self):
        self.start(maximumMaterialReviews=1)
        state=self.generate()
        self.assertEqual(state['stage'],'planning_review')
        self.assertGreater(state['planningCapacity']['plannedCalls'],1)
        self.assertEqual(state['planningCapacity']['requiredCalls']['materialReviews'],1)
        self.assertIn('只做一次整图独立复审',(self.run/'planning-m1/prompt.md').read_text('utf-8'))

    def test_invalid_layout_target_stops_before_m2_without_rewriting_original_answer(self):
        self.start()
        self.plan['layoutRegistration']['materials'][0]['horizontalDividerTargets']=[1]
        with self.assertRaisesRegex(ValueError,'DIVIDER_OUTSIDE_TARGET'):self.generate()
        self.assertEqual(host.status(self.run)['status'],'failed_no_retry')
        self.assertFalse((self.run/'planning').exists())
        self.assertFalse((self.run/'images').exists())
        self.assertEqual((self.run/'planning-m1/draft.json').read_bytes(),self.response.read_bytes())

    def test_one_m1_one_m2_text_conflict_keeps_same_run_through_final_zip(self):
        self.plan['materials'][0]['preserveText']=['KOI','JOURNAL']
        # A complete card remains one delivery identity, including its illustration.
        for key in ('asset-coin-a','asset-coin-b'):
            next(o for o in self.plan['objects'] if o['materialId']==key)['kind']='card'
            self.plan['objects'].append(dict(id='fixture-illustration-'+key,kind='illustration',
                materialId=key,label='A small fixture illustration owned by this card.',bboxNorm=None))
        self.start()
        material=next(m for m in self.plan['materials'] if m['id']=='asset-coin-a')
        from PIL import Image
        with Image.open(self.reference) as image:box=pixel_box(material['bboxNorm'],*image.size)
        declaration=next(r for r in self.plan['layoutRegistration']['materials'] if r['materialId']==material['id'])
        declaration.update(mode='uniform',horizontalDividerTargets=[(box[1]+box[3])//2])
        state=self.generate();before=read(self.run/capacity.NAME)
        response=fixtures.review_fixtures.HostReviewTests.response_doc
        def with_conflict(owner):
            answer=response(owner)
            answer['coverageAudit'][0]['businessText'].append(dict(artwork='Floating title',
                materialId=self.plan['materials'][0]['id'],evidence='Title above the controls, separate from the physical sign.',
                textFragments=['Koi Journal','Koi Journal']))
            for entry in answer['smallMaterialAudit'].values():
                for part in entry['parts']:part['deferredAppearance']=None
            return answer
        self.response=self.base/'m2-response.json'
        with patch.object(fixtures.review_fixtures.HostReviewTests,'response_doc',with_conflict):
            fixtures.HostDeliveryTests.planning(self)
        self.assertEqual(host.status(self.run)['stage'],'images')
        capacity.verify_frozen(self.run,read(self.run/'config.json'))
        frozen=self.run/'frozen';preflight(frozen,read(frozen/'snapshot.json')['digest'])
        self.assertEqual(len(read(frozen/'requests.json')['requests']),before['plannedCalls'])
        self.assertTrue(any(set(g['materialIds'])=={'asset-coin-a','asset-coin-b'} and g['mode']=='sheet'
            for g in read(frozen/'generation-groups.json')['groups']))
        self.assertEqual((self.root/'m2/draft.json').read_bytes(),self.response.read_bytes())
        for stage in ('planning_generate','planning_review'):
            self.assertEqual(len(list((self.run/'scopes'/stage).glob('*-submission.json'))),1)
        sheet_fixtures.HostSheetFallbackTests.acquire(self,False)
        from test_composite_review import finish_composite
        finish_composite(self)
        result=host.status(self.run)
        self.assertEqual(result['stage'],'diagnostic_complete')
        self.assertFalse(result['humanVisualAcceptance'])
        self.assertFalse(result['strictVisualReviewPassed'])
        report=read(self.run/'visual-warning-report.json')
        self.assertTrue(any(w['code']=='COVERAGE_PRESERVED_TEXT_CONFLICT' for w in report['planning']))
        folder=Path(result['diagnosticDelivery'])
        validate_viewport_archive(folder/'viewport-ui-layers.zip')
        self.assertTrue((folder/'viewport-preview.png').is_file())
        self.assertFalse((self.run/'body').exists())
        self.assertEqual(read(self.run/capacity.NAME),before)
        (self.run/capacity.NAME).write_bytes(b'{}')
        with self.assertRaisesRegex(ValueError,'CHANGED'):host.status(self.run)


if __name__=='__main__':unittest.main()
