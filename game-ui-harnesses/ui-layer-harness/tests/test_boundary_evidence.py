"""Offline checks for source-pixel evidence in new small-material reviews."""
import _bootstrap
import copy
import json
import unittest

from jsonschema import Draft202012Validator, ValidationError

from ai_ui_layers.boundary_evidence import (
    guidance, schema, uses_bound_schema, validate_boundaries,
)
from ai_ui_layers.evaluate import digest, read
from ai_ui_layers.compile_visual import verify_run
from ai_ui_layers.freeze_visual import freeze
from ai_ui_layers.planning_dag import Dag
from ai_ui_layers.planning_review_policy import split
from test_planning_dag import FakeModel, boundary_for
import test_planning_dag


def focus_item(material_id='mark', box=None, context=None):
    return dict(materialId=material_id, sourceBox=box or [17, 23, 39, 47],
                contextBox=context or [7, 13, 49, 57],
                contextDisplayBox=[300, 400, 600, 700])


def review_for(item, status='complete', point=None):
    return dict(smallMaterialAudit={item['materialId']:dict(
        boundary=boundary_for(item, status, 'Source contour checked.', point), parts=[])})


def replace_answer(folder, answer):
    (folder/'draft.json').write_text(json.dumps(answer), encoding='utf-8')
    receipt=read(folder/'transport.json')
    receipt['responseSha256']=digest(folder/'draft.json')
    (folder/'transport.json').write_text(json.dumps(receipt), encoding='utf-8')


class BoundaryEvidenceUnitTests(unittest.TestCase):
    def setUp(self):
        self.item=focus_item()
        self.focus=dict(items=[self.item],boundaryOnlyItems=[])

    def test_transport_schema_requires_exact_box_and_nullable_integer_pixel(self):
        boundary=schema()
        self.assertEqual(boundary['required'],
                         ['status','evidence','sourceBox','omittedSourcePixel'])
        self.assertEqual(boundary['properties']['omittedSourcePixel']['type'],['array','null'])
        self.assertFalse({'allOf','if','then','else'} & set(boundary))
        valid=boundary_for(self.item)
        Draft202012Validator(boundary).validate(valid)
        for missing in ('sourceBox','omittedSourcePixel'):
            with self.subTest(missing=missing):
                changed=copy.deepcopy(valid);del changed[missing]
                with self.assertRaises(ValidationError):
                    Draft202012Validator(boundary).validate(changed)
        for field,value in [('sourceBox',[17,23,39,True]),
                            ('sourceBox',[17,23,39,'47']),
                            ('omittedSourcePixel',[17,'23']),
                            ('omittedSourcePixel',[True,23])]:
            with self.subTest(field=field,value=value):
                changed=copy.deepcopy(valid);changed[field]=value
                with self.assertRaises(ValidationError):
                    Draft202012Validator(boundary).validate(changed)

        # JSON Schema integer includes integral floats; the pixel validator
        # additionally requires the actual JSON integer representation.
        review=review_for(self.item)
        review['smallMaterialAudit']['mark']['boundary']['sourceBox']=[17,23,39,47.0]
        with self.assertRaises(ValueError):
            validate_boundaries(review,self.focus)

    def test_prompt_guidance_names_original_coordinates_and_half_open_boxes(self):
        note=guidance(self.focus)
        self.assertIn('"sourceBox":[17,23,39,47]',note)
        self.assertIn('"contextBox":[7,13,49,57]',note)
        self.assertIn('原图像素',note)
        self.assertIn('右下不包含',note)

    def test_echo_must_equal_actual_focus_box_even_when_shift_is_one_pixel(self):
        for box in ([17,23,40,47],[16,23,39,47],[17,24,39,47],
                    self.item['contextBox'],self.item['contextDisplayBox']):
            with self.subTest(box=box):
                review=review_for(self.item)
                review['smallMaterialAudit']['mark']['boundary']['sourceBox']=box
                with self.assertRaisesRegex(ValueError,'SMALL_BOUNDARY_SOURCE_BOX_MISMATCH:mark'):
                    validate_boundaries(review,self.focus)

    def test_clipped_pixel_is_in_context_and_outside_half_open_crop(self):
        for point in ([16,23],[17,22],[39,23],[17,47]):
            with self.subTest(point=point):
                validate_boundaries(review_for(self.item,'clipped',point),self.focus)
        for point in ([17,23],[38,46]):
            with self.subTest(point=point):
                with self.assertRaisesRegex(ValueError,'SMALL_BOUNDARY_OMITTED_PIXEL_INSIDE_CROP:mark'):
                    validate_boundaries(review_for(self.item,'clipped',point),self.focus)
        for point in ([6,23],[17,57],[300,400]):
            with self.subTest(point=point):
                with self.assertRaisesRegex(ValueError,'SMALL_BOUNDARY_OMITTED_PIXEL_OUTSIDE_CONTEXT:mark'):
                    validate_boundaries(review_for(self.item,'clipped',point),self.focus)

    def test_canvas_origin_has_no_negative_pixel_and_right_bottom_are_excluded(self):
        item=focus_item(box=[0,0,11,13],context=[0,0,21,23])
        focus=dict(items=[item],boundaryOnlyItems=[])
        for point in ([11,0],[0,13]):
            validate_boundaries(review_for(item,'clipped',point),focus)
        for point in ([0,0],[10,12]):
            with self.assertRaisesRegex(ValueError,'SMALL_BOUNDARY_OMITTED_PIXEL_INSIDE_CROP'):
                validate_boundaries(review_for(item,'clipped',point),focus)

    def test_status_controls_point_presence_and_integer_types(self):
        for status in ('complete','uncertain'):
            validate_boundaries(review_for(self.item,status),self.focus)
            with self.assertRaisesRegex(ValueError,'UNEXPECTED_SMALL_BOUNDARY_OMITTED_PIXEL'):
                validate_boundaries(review_for(self.item,status,[16,23]),self.focus)
        for point in (None,[17,23.0],[True,23],[17],['17',23]):
            with self.subTest(point=point):
                with self.assertRaisesRegex(ValueError,'SMALL_BOUNDARY_OMITTED_PIXEL_REQUIRED'):
                    validate_boundaries(review_for(self.item,'clipped',point),self.focus)

    def test_overflow_ids_are_bound_to_their_page_and_crop(self):
        later=focus_item('later',[81,91,105,111],[71,81,115,121])
        focus=dict(items=[self.item],boundaryOnlyItems=[later])
        review=review_for(self.item)
        review['smallBoundaryAudit']={'later':dict(boundary=boundary_for(later))}
        validate_boundaries(review,focus)
        wrong=copy.deepcopy(review)
        wrong['smallBoundaryAudit']={'mark':wrong['smallBoundaryAudit'].pop('later')}
        with self.assertRaisesRegex(ValueError,'DUPLICATE_SMALL_BOUNDARY_AUDIT|SMALL_BOUNDARY_AUDIT_IDS_REQUIRED'):
            validate_boundaries(wrong,focus)
        wrong=copy.deepcopy(review)
        wrong['smallBoundaryAudit']['later']['boundary']['sourceBox']=self.item['sourceBox']
        with self.assertRaisesRegex(ValueError,'SMALL_BOUNDARY_SOURCE_BOX_MISMATCH:later'):
            validate_boundaries(wrong,focus)

    def test_only_new_schema_activates_binding_for_stored_reviews(self):
        new={'$defs':{'smallMaterialAuditEntry':{'properties':{'boundary':schema()}}}}
        self.assertTrue(uses_bound_schema(new))
        old=copy.deepcopy(new)
        old['$defs']['smallMaterialAuditEntry']['properties']['boundary']={
            'type':'object','required':['status','evidence'],
            'properties':{'status':{'type':'string'},'evidence':{'type':'string'}}}
        self.assertFalse(uses_bound_schema(old))
        partial=copy.deepcopy(new)
        partial['$defs']['smallBoundaryAuditEntry']={'properties':{'boundary':old['$defs']['smallMaterialAuditEntry']['properties']['boundary']}}
        with self.assertRaisesRegex(ValueError,'PARTIAL_BOUND_SMALL_REVIEW_SCHEMA'):
            uses_bound_schema(partial)


class BoundaryEvidenceDagTests(unittest.TestCase):
    def setUp(self):
        test_planning_dag.DagTests.setUp(self)

    def test_wrong_echo_fails_before_assessment_repair_or_freeze(self):
        base=FakeModel()
        def model(folder,sid,first):
            base(folder,sid,first)
            if folder.name=='m2':
                answer=read(folder/'draft.json')
                boundary=next(iter(answer['smallMaterialAudit'].values()))['boundary']
                boundary['sourceBox'][2]+=1
                replace_answer(folder,answer)
        with self.assertRaisesRegex(ValueError,'SMALL_BOUNDARY_SOURCE_BOX_MISMATCH'):
            Dag(self.root,model).execute()
        self.assertEqual([name for name,_ in base.calls],['m1','m2'])
        self.assertFalse((self.root/'m2/assessment.json').exists())
        self.assertFalse((self.root/'repair').exists())
        self.assertFalse((self.root/'frozen').exists())

    def test_inside_pixel_claim_fails_before_automatic_repair(self):
        base=FakeModel()
        def model(folder,sid,first):
            base(folder,sid,first)
            if folder.name=='m2':
                answer=read(folder/'draft.json')
                boundary=next(iter(answer['smallMaterialAudit'].values()))['boundary']
                boundary['status']='clipped'
                boundary['omittedSourcePixel']=boundary['sourceBox'][:2]
                replace_answer(folder,answer)
        with self.assertRaisesRegex(ValueError,'SMALL_BOUNDARY_OMITTED_PIXEL_INSIDE_CROP'):
            Dag(self.root,model).execute()
        self.assertEqual([name for name,_ in base.calls],['m1','m2'])
        self.assertFalse((self.root/'m2/assessment.json').exists())
        self.assertFalse((self.root/'repair').exists())
        self.assertFalse((self.root/'frozen').exists())

    def test_generated_schema_requires_coordinates_while_legacy_split_is_readable(self):
        Dag(self.root,FakeModel()).execute()
        generated=read(self.root/'m2/schema.json')
        self.assertTrue(uses_bound_schema(generated))
        valid=read(self.root/'m2/draft.json')
        Draft202012Validator(generated).validate(valid)
        owner=next(iter(valid['smallMaterialAudit']))
        for missing in ('sourceBox','omittedSourcePixel'):
            with self.subTest(missing=missing):
                changed=copy.deepcopy(valid)
                del changed['smallMaterialAudit'][owner]['boundary'][missing]
                with self.assertRaises(ValidationError):
                    Draft202012Validator(generated).validate(changed)
        legacy=copy.deepcopy(valid)
        for entry in legacy['smallMaterialAudit'].values():
            entry['boundary'].pop('sourceBox')
            entry['boundary'].pop('omittedSourcePixel')
        self.assertEqual(split(legacy,read(self.root/'m1/draft.json'))[0],[])

    def test_offline_verify_and_freeze_reject_tampered_echo_after_hash_updates(self):
        Dag(self.root,FakeModel()).execute()
        review_path=self.root/'m2/draft.json'
        answer=read(review_path)
        boundary=next(iter(answer['smallMaterialAudit'].values()))['boundary']
        boundary['sourceBox'][2]+=1
        review_path.write_text(json.dumps(answer),encoding='utf-8')
        for path,key in ((self.root/'m2/transport.json','responseSha256'),
                         (self.root/'result.json','reviewSha256'),
                         (self.root/'m2/assessment.json','reviewSha256')):
            record=read(path);record[key]=digest(review_path)
            path.write_text(json.dumps(record),encoding='utf-8')
        with self.assertRaisesRegex(ValueError,'SMALL_BOUNDARY_SOURCE_BOX_MISMATCH'):
            verify_run(self.root)
        destination=self.root.parent/'tampered-frozen'
        with self.assertRaisesRegex(ValueError,'SMALL_BOUNDARY_SOURCE_BOX_MISMATCH'):
            freeze(self.root,destination,8)
        self.assertFalse(destination.exists())

    def test_rereview_must_echo_repaired_crop_not_prior_crop(self):
        base=FakeModel(repair=True)
        prior={}
        def model(folder,sid,first):
            base(folder,sid,first)
            if folder.name=='m2':
                focus=read(folder/'coverage-small-materials.json')
                prior['coin']=next(item['sourceBox'] for item in focus['items']
                                   if item['materialId']=='asset-coin-a')
            elif folder.name=='repair':
                answer=read(folder/'draft.json')
                source=read(self.root/'m1/draft.json')
                coin=copy.deepcopy(next(m for m in source['materials'] if m['id']=='asset-coin-a'))
                coin['bboxNorm'][2]+=.001
                answer['materials']['upsert'].append(coin)
                replace_answer(folder,answer)
            elif folder.name=='rereview':
                focus=read(folder/'coverage-small-materials.json')
                actual=next(item['sourceBox'] for item in focus['items']
                            if item['materialId']=='asset-coin-a')
                self.assertNotEqual(actual,prior['coin'])
                answer=read(folder/'draft.json')
                answer['smallMaterialAudit']['asset-coin-a']['boundary']['sourceBox']=prior['coin']
                replace_answer(folder,answer)
        with self.assertRaisesRegex(ValueError,'SMALL_BOUNDARY_SOURCE_BOX_MISMATCH:asset-coin-a'):
            Dag(self.root,model).execute()
        self.assertEqual([name for name,_ in base.calls],['m1','m2','repair','rereview'])
        self.assertFalse((self.root/'rereview/assessment.json').exists())
        self.assertFalse((self.root/'frozen').exists())


if __name__=='__main__':unittest.main()
