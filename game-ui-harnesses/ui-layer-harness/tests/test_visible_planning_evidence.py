import _bootstrap
import json
import unittest
from PIL import Image, ImageDraw
from jsonschema import Draft202012Validator

from ai_ui_layers.compile_visual import HARNESS, compile_plan
from ai_ui_layers.evaluate import read, digest, check_relations
from ai_ui_layers.planning_dag import Dag
from ai_ui_layers.planning_review_policy import split
from test_planning_dag import FakeModel
import test_planning_dag


class VisiblePlanningEvidenceTests(unittest.TestCase):
    def setUp(self):
        test_planning_dag.DagTests.setUp(self)

    def response(self, folder, answer):
        (folder/'draft.json').write_text(json.dumps(answer), encoding='utf-8')
        receipt = read(folder/'transport.json')
        receipt['responseSha256'] = digest(folder/'draft.json')
        (folder/'transport.json').write_text(json.dumps(receipt), encoding='utf-8')

    def edge_model(self, status):
        # Synthetic source pixels extend to the canvas edge. A smaller right
        # bound still loses visible pixels even though the left bound is zero.
        source = self.root.parent/'source.png'
        image = Image.new('RGB', (1000, 1000))
        ImageDraw.Draw(image).rectangle((0, 200, 39, 239), fill='green')
        image.save(source)
        # init already snapshotted the input. Recreate via a fresh fixture run.
        from ai_ui_layers.planning_dag import init
        self.root = init(source, self.root.parent/'edge-run', 8)
        base = FakeModel()
        def model(folder, sid, first):
            base(folder, sid, first)
            answer = read(folder/'draft.json')
            if first:
                right = .04 if status == 'complete' else .02
                answer['materials'].append(dict(id='edge-glyph', label='Green square at the left canvas edge.',
                    role='foreground', zOrder=8, bboxNorm=[0, .2, right, .24],
                    preserveText=[], adaptationPolicy='preserve'))
                answer['objects'].append(dict(id='edge-glyph-object', label='Green square at the left canvas edge.',
                    kind='icon', materialId='edge-glyph', bboxNorm=None))
            elif folder.name in ('m2', 'rereview'):
                evidence = ('The source is cut by its left canvas edge; the crop retains all visible green pixels.'
                    if status == 'complete' else
                    'The crop starts at the source left edge but loses the visible right half of the green square.')
                answer['smallMaterialAudit']['edge-glyph']['boundary'] = dict(status=status, evidence=evidence)
            else:
                return
            self.response(folder, answer)
        return base, model

    def test_source_canvas_clipping_can_retain_all_visible_pixels(self):
        base, model = self.edge_model('complete')
        result = Dag(self.root, model).execute()
        self.assertEqual(result['status'], 'frozen')
        self.assertEqual([name for name, _ in base.calls], ['m1', 'm2'])
        self.assertEqual(result['mediaGenerationCalls'], 0)
        assessment = read(self.root/'m2/assessment.json')
        self.assertFalse(assessment['blockers'])
        evidence = read(self.root/'frozen/evidence/m2-draft.json')
        self.assertIn('source is cut', evidence['smallMaterialAudit']['edge-glyph']['boundary']['evidence'])
        prompt = (self.root/'m2/prompt.md').read_text(encoding='utf-8')
        self.assertIn('候选框是否额外丢失原图可见自有轮廓', prompt)
        self.assertIn('原图边缘与裁片边缘', prompt)

    def test_canvas_contact_does_not_exempt_repeated_actual_crop_loss(self):
        base, model = self.edge_model('clipped')
        with self.assertRaisesRegex(ValueError, 'REREVIEW_UNRESOLVED'):
            Dag(self.root, model).execute()
        self.assertEqual([name for name, _ in base.calls], ['m1', 'm2', 'repair', 'rereview'])
        self.assertTrue(any(row['code'] == 'SMALL_MATERIAL_BOUNDARY_REVIEW'
                            for row in read(self.root/'rereview/assessment.json')['blockers']))
        self.assertFalse((self.root/'frozen').exists())
        with self.assertRaisesRegex(ValueError, 'NO_RESUBMIT'):
            Dag(self.root, model).execute()
        self.assertEqual(len(base.calls), 4)

    def test_uncertain_source_edge_still_blocks(self):
        plan = read(HARNESS/'planning-harness/examples/visual-plan-scoped.json')
        blockers, warnings = split(dict(issues=[], smallBoundaryAudit={
            'asset-panel': dict(boundary=dict(status='uncertain',
                evidence='Source-edge ownership remains uncertain.'))}), plan)
        self.assertEqual(blockers[0]['code'], 'SMALL_MATERIAL_BOUNDARY_REVIEW')
        self.assertFalse(warnings)

    def test_omitted_end_instance_stops_even_with_full_backing_and_empty_issues(self):
        base = FakeModel()
        def model(folder, sid, first):
            base(folder, sid, first)
            if folder.name not in ('m2', 'rereview'):
                return
            answer = read(folder/'draft.json')
            answer['issues'] = []
            answer['coverageAudit'][8]['missingFromPlan'] = [dict(
                artwork='A separate green glyph at the lower end of the list has no owned object; the backing alone is not its owner.',
                suggestedOwnerId='asset-panel', suggestedChange='Add the missing visible instance with its own content ownership.')]
            self.response(folder, answer)
        with self.assertRaisesRegex(ValueError, 'REREVIEW_UNRESOLVED'):
            Dag(self.root, model).execute()
        self.assertFalse(read(self.root/'repair/report.json')['programIssues'])
        self.assertTrue(any(row['code'] == 'UNASSIGNED_VISIBLE_ARTWORK'
                            for row in read(self.root/'rereview/assessment.json')['blockers']))
        self.assertEqual([name for name, _ in base.calls], ['m1', 'm2', 'repair', 'rereview'])
        self.assertFalse((self.root/'frozen').exists())

    def test_existing_short_object_labels_carry_background_details_without_more_assets(self):
        plan = read(HARNESS/'planning-harness/examples/visual-plan-scoped.json')
        plan['unknowns'] = []
        plan['backgroundMode'] = 'scene-only'
        scene = plan['materials'][0]
        scene['label'] = 'Stone arena with visible furnishings and scattered particle rings.'
        plan['objects'][0]['label'] = 'Stone walls, ceiling and tiled floor.'
        labels = [
            'Faint blue-violet outlined particle rings scattered over the stone walls and tiled floor.',
            'Tall blue cloth banner on a narrow metal pole with angular fittings near its base.',
            'Planter with upright leaves below a wall-mounted signboard; ordinary lettering is removed.'
        ]
        for index, label in enumerate(labels):
            plan['objects'].append(dict(id=f'scene-detail-{index}', label=label, kind='decoration',
                materialId=scene['id'], bboxNorm=None))
        schema = read(HARNESS/'planning-harness/schemas/visual-plan.schema.json')
        Draft202012Validator(schema).validate(plan)
        self.assertGreater(sum(map(len, labels)), 200)
        self.assertTrue(all(len(item['label']) <= 200 for key in ('materials', 'objects') for item in plan[key]))
        self.assertFalse(check_relations(plan))
        compiled, _ = compile_plan(plan, (1000, 1000), '0'*64)
        self.assertEqual(len(compiled['assets']), len(plan['materials']))
        self.assertEqual(sum(item['kind'] == 'background' for item in plan['objects']), 1)
        prompt = next(item['prompt'] for item in compiled['assets'] if item['id'] == scene['id'])
        for label in labels:
            self.assertIn(label, prompt)
        # A background detail cannot justify a foreground owner's missing part.
        audit = dict(issues=[], smallMaterialAudit={'asset-panel': dict(
            boundary=dict(status='complete', evidence='The visible panel contour is contained.'),
            parts=[dict(visiblePart='cloth banner', observedAppearance='Blue cloth on a metal pole.',
                planEvidenceQuote=labels[1], suggestedChange='Resolve this ownership mismatch.')])})
        self.assertEqual(split(audit, plan)[0][0]['code'], 'UNDESCRIBED_SMALL_MATERIAL_PART')


if __name__ == '__main__':
    unittest.main()
