"""Offline contract checks for catalog-bound planning review evidence."""
import _bootstrap
import copy
import hashlib
import json
import unittest

from jsonschema import Draft202012Validator, ValidationError

from ai_ui_layers.compile_visual import verify_run
from ai_ui_layers.coverage_review import REGIONS
from ai_ui_layers.evaluate import digest, read
from ai_ui_layers.freeze_visual import freeze
from ai_ui_layers.planning_dag import Dag
from ai_ui_layers.planning_review_policy import split
from ai_ui_layers.review_evidence import (PROTOCOL_V1, PROTOCOL_V2, PROTOCOL_V3,
                                          build_catalog, bind_schema,
                                          build_review_schema, resolve_review)
from test_planning_dag import FakeModel
import test_planning_dag


def fixture_plan():
    return dict(materials=[
        dict(id='panel',label='Blue frame with silver inset',bboxNorm=[.1,.1,.4,.4]),
        dict(id='badge',label='Small silver badge',bboxNorm=[.6,.1,.7,.2])],
        objects=[
            dict(id='trim',materialId='panel',label='Silver trim beside the frame'),
            dict(id='dot',materialId='badge',label='Dark dot in the badge')])


def fixture_review(plan=None):
    plan=plan or fixture_plan()
    return dict(planEvidenceCatalogDigest=build_catalog(plan)['digest'],issues=[],
        coverageAudit=[dict(observedArtwork=[dict(
            disposition='covered',materialId='panel',objectId='trim',
            planEvidenceId='o:trim')])],
        smallMaterialAudit={'panel':dict(boundary=dict(status='complete',
            evidence='Fixture contour is contained.'),parts=[dict(
            visiblePart='silver inset',observedAppearance='Silver inset on blue frame',
            planEvidenceId='m:panel',descriptionStatus='consistent',
            suggestedChange='No change.')])})


def fixture_review_v2(plan=None):
    review=fixture_review(plan)
    review['planEvidenceProtocol']='coverage-owner-v2'
    review['coverageAudit'][0]['observedArtwork'][0].pop('planEvidenceId')
    return review


def fixture_review_v3(plan=None):
    review=fixture_review_v2(plan)
    review['planEvidenceProtocol']=PROTOCOL_V3
    review['cosmeticIssues']=[]
    artwork=review['coverageAudit'][0]['observedArtwork'][0]
    artwork.update(artwork='Fixture visible trim',evidence='Observed on source.',
                   suggestedChange=None)
    review['coverageAudit']=[dict(region=region,
        observedArtwork=[copy.deepcopy(artwork)],businessText=[],emptyRegionEvidence=None)
        for region in REGIONS]
    return review


def overwrite_response(folder, answer):
    (folder/'draft.json').write_text(json.dumps(answer),encoding='utf-8')
    transport=read(folder/'transport.json')
    transport['responseSha256']=digest(folder/'draft.json')
    (folder/'transport.json').write_text(json.dumps(transport),encoding='utf-8')


def canonical_sha(value):
    encoded=json.dumps(value,ensure_ascii=False,sort_keys=True,separators=(',',':'),
                       allow_nan=False).encode('utf-8')
    return hashlib.sha256(encoded).hexdigest()


class ReviewEvidenceUnitTests(unittest.TestCase):
    def setUp(self):
        self.plan=fixture_plan()
        self.catalog=build_catalog(self.plan)

    def test_catalog_ids_are_exact_owner_labels_and_digest_covers_entire_plan(self):
        before=copy.deepcopy(self.plan)
        self.assertEqual([row['id'] for row in self.catalog['entries']],
                         ['m:badge','m:panel','o:dot','o:trim'])
        self.assertEqual(next(row['label'] for row in self.catalog['entries']
                              if row['id']=='o:trim'),'Silver trim beside the frame')
        self.assertEqual(self.plan,before)
        altered=copy.deepcopy(self.plan)
        altered['materials'][0]['bboxNorm'][2]=.41
        self.assertNotEqual(build_catalog(altered)['digest'],self.catalog['digest'])
        self.assertNotEqual(build_catalog(altered)['planSha256'],self.catalog['planSha256'])

    def test_binding_schema_uses_nullable_catalog_ids_without_transport_conditionals(self):
        quoted={'type':'object','additionalProperties':False,
                'required':['planEvidenceQuote'],
                'properties':{'planEvidenceQuote':{'type':['string','null']}}}
        original=dict(type='object',required=['coverageAudit'],properties={
            'coverageAudit':{'type':'array','items':quoted}})
        before=copy.deepcopy(original)
        bound=bind_schema(original,self.catalog,PROTOCOL_V1)
        self.assertEqual(original,before)
        self.assertIn('planEvidenceCatalogDigest',bound['required'])
        entry=bound['properties']['coverageAudit']['items']
        self.assertEqual(entry['required'],['planEvidenceId'])
        self.assertNotIn('planEvidenceQuote',entry['properties'])
        self.assertEqual(set(entry['properties']['planEvidenceId']['enum']),
                         {None,'m:badge','m:panel','o:dot','o:trim'})
        self.assertFalse({'allOf','if','then','else'} & set(str(bound).split()))
        Draft202012Validator(bound).validate(dict(coverageAudit=[dict(planEvidenceId='o:trim')],
                                               planEvidenceCatalogDigest=self.catalog['digest']))
        with self.assertRaises(ValidationError):
            Draft202012Validator(bound).validate(dict(coverageAudit=[dict(planEvidenceId='o:unknown')],
                                                   planEvidenceCatalogDigest=self.catalog['digest']))

    def test_valid_ids_resolve_to_exact_labels_without_mutating_raw_review(self):
        raw=fixture_review(self.plan)
        before=copy.deepcopy(raw)
        resolved=resolve_review(raw,self.plan)
        self.assertEqual(raw,before)
        self.assertNotIn('planEvidenceCatalogDigest',resolved)
        self.assertEqual(resolved['coverageAudit'][0]['observedArtwork'][0]['planEvidenceQuote'],
                         'Silver trim beside the frame')
        self.assertEqual(resolved['smallMaterialAudit']['panel']['parts'][0]['planEvidenceQuote'],
                         'Blue frame with silver inset')
        self.assertNotIn('planEvidenceId',str(resolved))

    def test_owner_protocol_derives_covered_label_without_model_evidence_id(self):
        raw=fixture_review_v2(self.plan)
        raw['coverageAudit'][0]['observedArtwork'].append(dict(
            disposition='business-text',materialId='panel',objectId=None))
        before=copy.deepcopy(raw)
        resolved=resolve_review(raw,self.plan)
        self.assertEqual(raw,before)
        self.assertNotIn('planEvidenceProtocol',resolved)
        self.assertEqual(resolved['coverageAudit'][0]['observedArtwork'][0]['planEvidenceQuote'],
                         'Silver trim beside the frame')
        self.assertIsNone(resolved['coverageAudit'][0]['observedArtwork'][1]['planEvidenceQuote'])
        self.assertEqual(resolved['smallMaterialAudit']['panel']['parts'][0]['planEvidenceQuote'],
                         'Blue frame with silver inset')

    def test_owner_protocol_rejects_unknown_or_cross_material_coverage_owner(self):
        variants=[
            ('unknown material',dict(materialId='absent',objectId=None)),
            ('unknown object',dict(materialId='panel',objectId='absent')),
            ('object in another material',dict(materialId='badge',objectId='trim')),
        ]
        for name,change in variants:
            with self.subTest(name=name):
                raw=fixture_review_v2(self.plan)
                raw['coverageAudit'][0]['observedArtwork'][0].update(change)
                with self.assertRaisesRegex(ValueError,'PLAN_EVIDENCE'):
                    resolve_review(raw,self.plan)

    def test_owner_protocol_rejects_mixed_fields_marker_and_stale_catalog(self):
        changes=[
            ('coverage ID',lambda r:r['coverageAudit'][0]['observedArtwork'][0].update(
                planEvidenceId='o:trim')),
            ('coverage quote',lambda r:r['coverageAudit'][0]['observedArtwork'][0].update(
                planEvidenceQuote='Silver trim beside the frame')),
            ('missing protocol',lambda r:r.pop('planEvidenceProtocol')),
            ('wrong protocol',lambda r:r.update(planEvidenceProtocol='unrecognized')),
            ('old digest',lambda r:r.update(planEvidenceCatalogDigest='0'*64)),
        ]
        for name,change in changes:
            with self.subTest(name=name):
                raw=fixture_review_v2(self.plan);change(raw)
                with self.assertRaisesRegex(ValueError,'PLAN_EVIDENCE'):
                    resolve_review(raw,self.plan)

    def test_owner_protocol_does_not_clear_description_or_boundary_blockers(self):
        for status,boundary_status,code in (
            ('missing','complete','SMALL_MATERIAL_DESCRIPTION_REVIEW'),
            ('conflicting','complete','SMALL_MATERIAL_DESCRIPTION_REVIEW'),
            ('consistent','clipped','SMALL_MATERIAL_BOUNDARY_REVIEW')):
            with self.subTest(status=status,boundary=boundary_status):
                raw=fixture_review_v2(self.plan)
                artwork=raw['coverageAudit'][0]['observedArtwork'][0]
                artwork.update(artwork='Fixture visible trim',
                               evidence='Observed on source.',suggestedChange=None)
                raw['coverageAudit']=[dict(region=region,
                    observedArtwork=[copy.deepcopy(artwork)],emptyRegionEvidence=None)
                    for region in REGIONS]
                raw['smallMaterialAudit']['panel']['parts'][0]['descriptionStatus']=status
                raw['smallMaterialAudit']['panel']['boundary']['status']=boundary_status
                blockers,_=split(raw,self.plan)
                self.assertIn(code,[finding['code'] for finding in blockers])

    def test_typed_business_lane_resolves_without_mutating_raw(self):
        plan=copy.deepcopy(self.plan);plan['textPolicy']='remove-business-text'
        raw=fixture_review_v3(plan)
        business=dict(artwork='SALE 20%',materialId='panel',
                      evidence='Original source shows removable lettering.')
        raw['coverageAudit'][0]['businessText'].append(business)
        before=copy.deepcopy(raw)
        resolved=resolve_review(raw,plan)
        self.assertEqual(raw,before)
        self.assertNotIn('cosmeticIssues',resolved)
        self.assertNotIn('businessText',resolved['coverageAudit'][0])
        converted=resolved['coverageAudit'][0]['observedArtwork'][-1]
        self.assertEqual(converted['disposition'],'business-text')
        self.assertEqual((converted['objectId'],converted['planEvidenceQuote'],
                          converted['suggestedChange']),(None,None,None))
        self.assertEqual(split(raw,plan)[0],[])

    def test_typed_business_lane_rejects_malformed_unknown_and_wrong_policy(self):
        plan=copy.deepcopy(self.plan);plan['textPolicy']='remove-business-text'
        cases=[
            ('object field',dict(artwork='SALE',materialId='panel',evidence='Visible.',
                                 objectId='trim'),'PLAN_EVIDENCE_BUSINESS_TEXT_FORMAT'),
            ('missing owner',dict(artwork='SALE',evidence='Visible.'),
             'PLAN_EVIDENCE_BUSINESS_TEXT_FORMAT'),
            ('unknown owner',dict(artwork='SALE',materialId='absent',evidence='Visible.'),
             'PLAN_EVIDENCE_OWNER_MISMATCH'),
        ]
        for name,business,code in cases:
            with self.subTest(name=name):
                raw=fixture_review_v3(plan)
                raw['coverageAudit'][0]['businessText'].append(business)
                with self.assertRaisesRegex(ValueError,code):resolve_review(raw,plan)
        for change,code in ((lambda p:p.update(textPolicy='preserve-business-text'),
                             'COVERAGE_BUSINESS_TEXT_POLICY_REQUIRED'),
                            (lambda p:p['materials'][0].update(preserveText=['SALE']),
                             'COVERAGE_PRESERVED_TEXT_CONFLICT')):
            with self.subTest(code=code):
                altered=copy.deepcopy(plan);change(altered)
                raw=fixture_review_v3(altered)
                raw['coverageAudit'][0]['businessText'].append(dict(
                    artwork='SALE',materialId='panel',evidence='Visible.'))
                with self.assertRaisesRegex(ValueError,code):split(raw,altered)

    def test_typed_graphics_cannot_hide_business_text_or_small_material_findings(self):
        plan=copy.deepcopy(self.plan);plan['textPolicy']='remove-business-text'
        raw=fixture_review_v3(plan)
        raw['coverageAudit'][0]['observedArtwork'][0]['disposition']='business-text'
        with self.assertRaisesRegex(ValueError,'PLAN_EVIDENCE_MIXED_FORMAT'):
            resolve_review(raw,plan)
        for status,boundary,code in (
            ('missing','complete','SMALL_MATERIAL_DESCRIPTION_REVIEW'),
            ('conflicting','complete','SMALL_MATERIAL_DESCRIPTION_REVIEW'),
            ('uncertain','complete','SMALL_MATERIAL_DESCRIPTION_REVIEW'),
            ('consistent','clipped','SMALL_MATERIAL_BOUNDARY_REVIEW'),
            ('consistent','uncertain','SMALL_MATERIAL_BOUNDARY_REVIEW')):
            with self.subTest(status=status,boundary=boundary):
                raw=fixture_review_v3(plan)
                raw['smallMaterialAudit']['panel']['parts'][0]['descriptionStatus']=status
                raw['smallMaterialAudit']['panel']['boundary']['status']=boundary
                self.assertIn(code,[item['code'] for item in split(raw,plan)[0]])

    def test_typed_cosmetic_lane_keeps_minor_color_strict_blocker(self):
        plan=copy.deepcopy(self.plan);plan['textPolicy']='remove-business-text'
        raw=fixture_review_v3(plan)
        raw['cosmeticIssues']=[dict(code='MINOR_COLOR_TONE',ids=['panel'],
                                    description='Slight color difference.',
                                    suggestedChange='Adjust color tone.')]
        policy=dict(kind='ui_visual_policy_v1',appearanceEvidence='bound-reference',
                    minorColor='strict',shadow='optional')
        blockers,warnings=split(raw,plan,policy)
        self.assertEqual([item['code'] for item in blockers],['MINOR_COLOR_TONE'])
        self.assertEqual(warnings,[])

    def test_typed_schema_rejects_unknown_cosmetic_code_and_wrong_issue_lane(self):
        schema=build_review_schema(self.catalog,None,None)
        raw=fixture_review_v3(self.plan);raw.pop('smallMaterialAudit')
        Draft202012Validator(schema).validate(raw)
        unknown=copy.deepcopy(raw)
        unknown['cosmeticIssues']=[dict(code='FORGED_WARNING',ids=['panel'],
                                        description='Fixture observation.',
                                        suggestedChange='Review color.')]
        with self.assertRaises(ValidationError):
            Draft202012Validator(schema).validate(unknown)
        wrong_lane=copy.deepcopy(raw)
        wrong_lane['issues']=[dict(code='MINOR_COLOR_TONE',category='cosmetic',
                                   ids=['panel'],description='Fixture observation.',
                                   suggestedChange='Review color.')]
        with self.assertRaises(ValidationError):
            Draft202012Validator(schema).validate(wrong_lane)
        with self.assertRaisesRegex(ValueError,'PLAN_EVIDENCE_COSMETIC_LANE_FORMAT'):
            resolve_review(unknown,self.plan)
        with self.assertRaisesRegex(ValueError,'PLAN_EVIDENCE_ISSUE_LANE_MISMATCH'):
            resolve_review(wrong_lane,self.plan)

    def test_historical_v2_business_graphic_keeps_old_rejection(self):
        plan=copy.deepcopy(self.plan);plan['textPolicy']='remove-business-text'
        plan['objects'][0]['kind']='decoration'
        raw=fixture_review_v3(plan)
        raw.pop('cosmeticIssues');raw['planEvidenceProtocol']=PROTOCOL_V2
        for region in raw['coverageAudit']:region.pop('businessText')
        raw['coverageAudit'][0]['observedArtwork'][0]['disposition']='business-text'
        with self.assertRaisesRegex(ValueError,'COVERAGE_BUSINESS_TEXT_OWNED_GRAPHIC'):
            split(raw,plan)

    def test_wrong_owner_unknown_and_spliced_ids_fail_closed(self):
        variants=[
            ('coverage object from another material',lambda r:r['coverageAudit'][0]['observedArtwork'][0].update(
                materialId='badge'),'PLAN_EVIDENCE_OWNER_MISMATCH'),
            ('material id instead of owned object',lambda r:r['coverageAudit'][0]['observedArtwork'][0].update(
                planEvidenceId='m:panel'),'PLAN_EVIDENCE_OWNER_MISMATCH'),
            ('part from another material',lambda r:r['smallMaterialAudit']['panel']['parts'][0].update(
                planEvidenceId='o:dot'),'PLAN_EVIDENCE_OWNER_MISMATCH'),
            ('unknown id',lambda r:r['smallMaterialAudit']['panel']['parts'][0].update(
                planEvidenceId='o:unlisted'),'PLAN_EVIDENCE_ID_UNKNOWN'),
            ('spliced ids',lambda r:r['smallMaterialAudit']['panel']['parts'][0].update(
                planEvidenceId='m:panel'+'o:trim'),'PLAN_EVIDENCE_ID_UNKNOWN'),
        ]
        for name,change,code in variants:
            with self.subTest(name=name):
                raw=fixture_review(self.plan);change(raw)
                with self.assertRaisesRegex(ValueError,code):resolve_review(raw,self.plan)

    def test_status_and_missing_artwork_cannot_claim_a_supporting_id(self):
        raw=fixture_review(self.plan)
        raw['coverageAudit'][0]['observedArtwork'][0].update(
            disposition='missing',planEvidenceId='o:trim')
        with self.assertRaisesRegex(ValueError,'PLAN_EVIDENCE_NONCOVERED_ID'):
            resolve_review(raw,self.plan)
        raw['coverageAudit'][0]['observedArtwork'][0]['planEvidenceId']=None
        self.assertIsNone(resolve_review(raw,self.plan)['coverageAudit'][0]['observedArtwork'][0]['planEvidenceQuote'])

    def test_valid_source_id_does_not_clear_description_or_boundary_blockers(self):
        for status,boundary_status,code in (
            ('missing','complete','SMALL_MATERIAL_DESCRIPTION_REVIEW'),
            ('conflicting','complete','SMALL_MATERIAL_DESCRIPTION_REVIEW'),
            ('consistent','clipped','SMALL_MATERIAL_BOUNDARY_REVIEW')):
            with self.subTest(status=status,boundary=boundary_status):
                raw=fixture_review(self.plan)
                raw.pop('coverageAudit')
                raw['smallMaterialAudit']['panel']['parts'][0]['descriptionStatus']=status
                raw['smallMaterialAudit']['panel']['boundary']['status']=boundary_status
                blockers,_=split(raw,self.plan)
                self.assertIn(code,[finding['code'] for finding in blockers])

    def test_null_part_id_keeps_undescribed_blocker(self):
        raw=fixture_review(self.plan);raw.pop('coverageAudit')
        raw['smallMaterialAudit']['panel']['parts'][0]['planEvidenceId']=None
        self.assertEqual(resolve_review(raw,self.plan)['smallMaterialAudit']['panel']['parts'][0]['planEvidenceQuote'],'')
        self.assertEqual(split(raw,self.plan)[0][0]['code'],'UNDESCRIBED_SMALL_MATERIAL_PART')

    def test_old_quote_only_review_remains_readable_but_partial_upgrade_is_rejected(self):
        old=dict(issues=[],smallMaterialAudit={'panel':dict(boundary=dict(
            status='complete',evidence='Contained.'),parts=[dict(
            visiblePart='blue frame',observedAppearance='Blue frame',
            planEvidenceQuote='Blue frame',descriptionStatus='consistent',
            suggestedChange='No change.')])})
        self.assertEqual(resolve_review(old,self.plan),old)
        self.assertEqual(split(old,self.plan)[0],[])
        mixed=copy.deepcopy(fixture_review(self.plan))
        mixed['smallMaterialAudit']['panel']['parts'][0]['planEvidenceQuote']='Blue frame'
        with self.assertRaisesRegex(ValueError,'PLAN_EVIDENCE_MIXED_FORMAT'):
            resolve_review(mixed,self.plan)
        unmarked=fixture_review(self.plan);unmarked.pop('planEvidenceCatalogDigest')
        with self.assertRaisesRegex(ValueError,'PLAN_EVIDENCE_MARKER_REQUIRED'):
            resolve_review(unmarked,self.plan)

    def test_digest_rejects_any_changed_plan_even_when_id_and_label_still_exist(self):
        raw=fixture_review(self.plan)
        altered=copy.deepcopy(self.plan);altered['materials'][0]['bboxNorm'][2]=.41
        with self.assertRaisesRegex(ValueError,'PLAN_EVIDENCE_DIGEST_MISMATCH'):
            resolve_review(raw,altered)
        self.assertEqual(raw,fixture_review(self.plan))


class ReviewEvidenceDagTests(unittest.TestCase):
    def setUp(self):
        test_planning_dag.DagTests.setUp(self)
        # This suite covers historical review protocols; new relation/text contracts have separate fixtures.
        config=read(self.root/'.dag/config.json')
        for field in ('relationReviewPolicy','normalizationPolicy','coverageTextPolicy'):config.pop(field,None)
        (self.root/'.dag/config.json').write_text(json.dumps(config),encoding='utf-8')
        (self.root/'.dag/config-digest.json').write_text(json.dumps({'sha256':digest(self.root/'.dag/config.json')}),encoding='utf-8')

    def _rewrite_m2_review_contract(self, schema, raw, *, omit_focus_input=False):
        """Keep receipt hashes coherent so only the weakened contract can reject."""
        folder=self.root/'m2';schema_path=folder/'schema.json';review_path=folder/'draft.json'
        schema_path.write_text(json.dumps(schema),encoding='utf-8')
        overwrite_response(folder,raw)
        request=read(folder/'request.json')
        request['inputs']['schema.json']=digest(schema_path)
        if omit_focus_input:
            request['inputs'].pop('coverage-small-materials.json')
            (folder/'coverage-small-materials.json').unlink()
        (folder/'request.json').write_text(json.dumps(request),encoding='utf-8')
        for status_path in (self.root/'result.json',folder/'assessment.json'):
            status=read(status_path);status['reviewSha256']=digest(review_path)
            status_path.write_text(json.dumps(status),encoding='utf-8')

    def _assert_offline_review_contract_rejected(self, label):
        with self.assertRaisesRegex(ValueError,'PLAN_EVIDENCE|SMALL_BOUNDARY'):
            verify_run(self.root)
        destination=self.root.parent/('weakened-'+label+'-freeze')
        with self.assertRaisesRegex(ValueError,'PLAN_EVIDENCE|SMALL_BOUNDARY'):
            freeze(self.root,destination,8)
        self.assertFalse(destination.exists())

    def _assert_invalid_protocol_raw_rejected(self, label):
        def rejected(action):
            try:action()
            except ValidationError:return
            except ValueError as error:
                self.assertRegex(str(error),r'^PLAN_EVIDENCE_')
            else:self.fail('Malformed bound review was accepted')
        rejected(lambda:verify_run(self.root))
        destination=self.root.parent/('invalid-bound-'+label+'-freeze')
        rejected(lambda:freeze(self.root,destination,8))
        self.assertFalse(destination.exists())

    def test_generated_review_binds_catalog_request_and_preserves_raw_ids(self):
        result=Dag(self.root,FakeModel()).execute()
        self.assertEqual(result['status'],'frozen')
        folder=self.root/'m2'
        plan=read(self.root/'m1/draft.json')
        catalog=read(folder/'plan-evidence-catalog.json')
        self.assertEqual(catalog,build_catalog(plan))
        request=read(folder/'request.json')
        self.assertEqual(request['inputs']['plan-evidence-catalog.json'],digest(folder/'plan-evidence-catalog.json'))
        frozen_catalog=self.root/'frozen/evidence/m2-plan-evidence-catalog.json'
        self.assertEqual(read(frozen_catalog),catalog)
        snapshot=read(self.root/'frozen/snapshot.json')
        self.assertEqual(snapshot['files']['evidence/m2-plan-evidence-catalog.json'],digest(frozen_catalog))
        raw=read(folder/'draft.json')
        self.assertEqual(raw['planEvidenceCatalogDigest'],catalog['digest'])
        self.assertEqual(raw['planEvidenceProtocol'],PROTOCOL_V3)
        self.assertEqual(raw['cosmeticIssues'],[])
        self.assertTrue(all(row['businessText']==[] for row in raw['coverageAudit']))
        self.assertNotIn('planEvidenceId',raw['coverageAudit'][0]['observedArtwork'][0])
        self.assertNotIn('planEvidenceQuote',raw['coverageAudit'][0]['observedArtwork'][0])
        self.assertIn('planEvidenceId',next(iter(raw['smallMaterialAudit'].values()))['parts'][0])
        schema=read(folder/'schema.json')
        self.assertEqual(schema,build_review_schema(catalog,
                         read(folder/'coverage-small-materials.json'),None))
        coverage_entry=schema['properties']['coverageAudit']['items']['properties']['observedArtwork']['items']
        self.assertNotIn('planEvidenceId',coverage_entry['properties'])
        self.assertNotIn('planEvidenceQuote',coverage_entry['properties'])
        self.assertNotIn('business-text',coverage_entry['properties']['disposition']['enum'])
        validator=Draft202012Validator(schema)
        validator.validate(raw)
        for omitted in ('planEvidenceCatalogDigest','planEvidenceProtocol','planEvidenceId',
                        'cosmeticIssues','businessText'):
            changed=copy.deepcopy(raw)
            if omitted=='planEvidenceId':
                next(iter(changed['smallMaterialAudit'].values()))['parts'][0].pop(omitted)
            elif omitted=='businessText':
                changed['coverageAudit'][0].pop(omitted)
            else:
                changed.pop(omitted)
            with self.subTest(omitted=omitted),self.assertRaises(ValidationError):
                validator.validate(changed)
        before=copy.deepcopy(raw)
        self.assertEqual(split(raw,plan)[0],[])
        self.assertEqual(raw,before)
        self.assertEqual(read(folder/'draft.json'),before)
        self.assertEqual(verify_run(self.root),plan)

    def test_business_text_lane_without_object_or_evidence_id_can_freeze(self):
        base=FakeModel()
        def model(folder,sid,first):
            base(folder,sid,first)
            if folder.name=='m2':
                raw=read(folder/'draft.json')
                business=dict(artwork='Fixture business lettering',materialId='asset-panel',
                              evidence='Visible business lettering in the source.')
                raw['coverageAudit'][0]['businessText'].append(business)
                self.assertEqual(set(business),{'artwork','materialId','evidence'})
                overwrite_response(folder,raw)
        result=Dag(self.root,model).execute()
        self.assertEqual(result['status'],'frozen')
        raw=read(self.root/'m2/draft.json')
        self.assertEqual(len(raw['coverageAudit'][0]['businessText']),1)
        self.assertNotIn('objectId',raw['coverageAudit'][0]['businessText'][0])
        self.assertEqual(verify_run(self.root),read(self.root/'m1/draft.json'))

    def test_wrong_owner_id_stops_before_assessment_repair_or_freeze(self):
        base=FakeModel()
        def model(folder,sid,first):
            base(folder,sid,first)
            if folder.name=='m2':
                raw=read(folder/'draft.json')
                owner=next(iter(raw['smallMaterialAudit']))
                other=next(mid for mid in raw['smallMaterialAudit'] if mid!=owner)
                raw['smallMaterialAudit'][owner]['parts'][0]['planEvidenceId']='m:'+other
                overwrite_response(folder,raw)
        with self.assertRaisesRegex(ValueError,'PLAN_EVIDENCE_OWNER_MISMATCH'):
            Dag(self.root,model).execute()
        self.assertEqual([name for name,_ in base.calls],['m1','m2'])
        self.assertFalse((self.root/'m2/assessment.json').exists())
        self.assertFalse((self.root/'repair').exists())
        self.assertFalse((self.root/'frozen').exists())

    def test_covered_object_from_another_material_stops_before_assessment(self):
        base=FakeModel()
        def model(folder,sid,first):
            base(folder,sid,first)
            if folder.name=='m2':
                raw=read(folder/'draft.json')
                artwork=raw['coverageAudit'][0]['observedArtwork'][0]
                artwork.update(materialId='asset-panel',objectId='scene')
                self.assertNotIn('planEvidenceId',artwork)
                overwrite_response(folder,raw)
        with self.assertRaisesRegex(ValueError,'PLAN_EVIDENCE_OWNER_MISMATCH'):
            Dag(self.root,model).execute()
        self.assertEqual([name for name,_ in base.calls],['m1','m2'])
        self.assertFalse((self.root/'m2/assessment.json').exists())
        self.assertFalse((self.root/'repair').exists())
        self.assertFalse((self.root/'frozen').exists())

    def test_repair_rereview_catalog_tracks_current_candidate(self):
        Dag(self.root,FakeModel(repair=True)).execute()
        first=read(self.root/'m2/plan-evidence-catalog.json')
        second=read(self.root/'rereview/plan-evidence-catalog.json')
        self.assertEqual(first,build_catalog(read(self.root/'m1/draft.json')))
        self.assertEqual(second,build_catalog(read(self.root/'repair/candidate.json')))
        self.assertNotEqual(first['digest'],second['digest'])
        self.assertEqual(read(self.root/'m2/draft.json')['planEvidenceCatalogDigest'],first['digest'])
        self.assertEqual(read(self.root/'rereview/draft.json')['planEvidenceCatalogDigest'],second['digest'])
        self.assertEqual(read(self.root/'m2/draft.json')['planEvidenceProtocol'],PROTOCOL_V3)
        self.assertEqual(read(self.root/'rereview/draft.json')['planEvidenceProtocol'],PROTOCOL_V3)
        self.assertEqual(read(self.root/'rereview/request.json')['inputs']['plan-evidence-catalog.json'],
                         digest(self.root/'rereview/plan-evidence-catalog.json'))
        self.assertEqual(verify_run(self.root),read(self.root/'repair/candidate.json'))

    def test_historical_v1_and_v2_reviews_still_verify_and_freeze(self):
        Dag(self.root,FakeModel()).execute()
        folder=self.root/'m2';plan=read(self.root/'m1/draft.json')
        catalog=read(folder/'plan-evidence-catalog.json')
        focus=read(folder/'coverage-small-materials.json')
        paths=[folder/name for name in ('schema.json','draft.json','transport.json',
                                       'request.json','assessment.json')]+[self.root/'result.json']
        baseline={path:path.read_bytes() for path in paths}
        for protocol in (PROTOCOL_V1,PROTOCOL_V2):
            with self.subTest(protocol=protocol):
                for path,content in baseline.items():path.write_bytes(content)
                legacy_schema=build_review_schema(catalog,focus,None,protocol)
                entry=legacy_schema['properties']['coverageAudit']['items']['properties']['observedArtwork']['items']
                self.assertEqual('planEvidenceId' in entry['required'],protocol==PROTOCOL_V1)
                raw=read(folder/'draft.json');raw.pop('cosmeticIssues')
                if protocol==PROTOCOL_V1:raw.pop('planEvidenceProtocol')
                else:raw['planEvidenceProtocol']=PROTOCOL_V2
                for region in raw['coverageAudit']:
                    self.assertEqual(region.pop('businessText'),[])
                    if protocol==PROTOCOL_V1:
                        for artwork in region['observedArtwork']:
                            artwork['planEvidenceId']=(
                                ('o:'+artwork['objectId'] if artwork['objectId'] is not None
                                 else 'm:'+artwork['materialId'])
                                if artwork['disposition']=='covered' else None)
                Draft202012Validator(legacy_schema).validate(raw)
                self._rewrite_m2_review_contract(legacy_schema,raw)
                self.assertEqual(verify_run(self.root),plan)
                destination=self.root.parent/('historical-'+protocol+'-freeze')
                freeze(self.root,destination,8)
                self.assertTrue((destination/'snapshot.json').is_file())
                self.assertEqual(read(destination/'evidence/m2-draft.json'),raw)

    def test_offline_verify_rejects_v3_protocol_and_coverage_field_mixture(self):
        Dag(self.root,FakeModel()).execute()
        folder=self.root/'m2'
        paths=[folder/name for name in ('schema.json','draft.json','transport.json',
                                       'request.json','assessment.json')]+[self.root/'result.json']
        baseline={path:path.read_bytes() for path in paths}
        for label in ('missing-protocol','coverage-id','coverage-quote','stale-digest'):
            with self.subTest(label=label):
                for path,content in baseline.items():path.write_bytes(content)
                schema=read(folder/'schema.json');raw=read(folder/'draft.json')
                artwork=raw['coverageAudit'][0]['observedArtwork'][0]
                if label=='missing-protocol':raw.pop('planEvidenceProtocol')
                elif label=='coverage-id':artwork['planEvidenceId']='m:'+artwork['materialId']
                elif label=='coverage-quote':artwork['planEvidenceQuote']='forged copied label'
                else:raw['planEvidenceCatalogDigest']='0'*64
                self._rewrite_m2_review_contract(schema,raw)
                self._assert_invalid_protocol_raw_rejected(label)

    def test_offline_verify_rejects_catalog_tamper_even_with_updated_request_hash(self):
        Dag(self.root,FakeModel()).execute()
        folder=self.root/'m2'
        path=folder/'plan-evidence-catalog.json'
        catalog=read(path)
        catalog['entries'][0]['label']+=' forged'
        catalog['digest']=canonical_sha({key:catalog[key] for key in ('kind','planSha256','entries')})
        path.write_text(json.dumps(catalog),encoding='utf-8')
        schema_path=folder/'schema.json';schema=read(schema_path)
        schema['properties']['planEvidenceCatalogDigest']['enum']=[catalog['digest']]
        schema_path.write_text(json.dumps(schema),encoding='utf-8')
        review_path=folder/'draft.json';raw=read(review_path)
        raw['planEvidenceCatalogDigest']=catalog['digest']
        overwrite_response(folder,raw)
        for status_path in (self.root/'result.json',folder/'assessment.json'):
            status=read(status_path);status['reviewSha256']=digest(review_path)
            status_path.write_text(json.dumps(status),encoding='utf-8')
        request=read(folder/'request.json')
        request['inputs']['plan-evidence-catalog.json']=digest(path)
        request['inputs']['schema.json']=digest(schema_path)
        (folder/'request.json').write_text(json.dumps(request),encoding='utf-8')
        with self.assertRaisesRegex(ValueError,'PLAN_EVIDENCE'):
            verify_run(self.root)
        destination=self.root.parent/'forged-freeze'
        with self.assertRaisesRegex(ValueError,'PLAN_EVIDENCE'):
            freeze(self.root,destination,8)
        self.assertFalse(destination.exists())

    def test_offline_verify_rejects_wrong_owner_after_response_hash_updates(self):
        Dag(self.root,FakeModel()).execute()
        folder=self.root/'m2';path=folder/'draft.json'
        raw=read(path)
        owner=next(iter(raw['smallMaterialAudit']))
        other=next(mid for mid in raw['smallMaterialAudit'] if mid!=owner)
        raw['smallMaterialAudit'][owner]['parts'][0]['planEvidenceId']='m:'+other
        overwrite_response(folder,raw)
        for status_path in (self.root/'result.json',folder/'assessment.json'):
            status=read(status_path);status['reviewSha256']=digest(path)
            status_path.write_text(json.dumps(status),encoding='utf-8')
        with self.assertRaisesRegex(ValueError,'PLAN_EVIDENCE_OWNER_MISMATCH'):
            verify_run(self.root)
        destination=self.root.parent/'wrong-owner-freeze'
        with self.assertRaisesRegex(ValueError,'PLAN_EVIDENCE_OWNER_MISMATCH'):
            freeze(self.root,destination,8)
        self.assertFalse(destination.exists())

    def test_offline_verify_rejects_coverage_audit_deleted_from_schema_and_review(self):
        Dag(self.root,FakeModel()).execute()
        folder=self.root/'m2';schema=read(folder/'schema.json');raw=read(folder/'draft.json')
        self.assertIn('coverageAudit',schema['required'])
        self.assertIn('coverageAudit',raw)
        schema['required'].remove('coverageAudit')
        schema['properties'].pop('coverageAudit')
        raw.pop('coverageAudit')
        self._rewrite_m2_review_contract(schema,raw)
        self._assert_offline_review_contract_rejected('coverage')

    def test_offline_verify_rejects_rehashed_weakened_typed_lanes_and_enums(self):
        Dag(self.root,FakeModel()).execute()
        folder=self.root/'m2'
        paths=[folder/name for name in ('schema.json','draft.json','transport.json',
                                       'request.json','assessment.json')]+[self.root/'result.json']
        baseline={path:path.read_bytes() for path in paths}
        for label in ('business-required','cosmetic-required',
                      'graphic-business-enum','cosmetic-code-enum'):
            with self.subTest(label=label):
                for path,content in baseline.items():path.write_bytes(content)
                schema=read(folder/'schema.json');raw=read(folder/'draft.json')
                if label=='business-required':
                    region_schema=schema['properties']['coverageAudit']['items']
                    region_schema['required'].remove('businessText')
                    region_schema['properties'].pop('businessText')
                    for region in raw['coverageAudit']:region.pop('businessText')
                elif label=='cosmetic-required':
                    schema['required'].remove('cosmeticIssues')
                    schema['properties'].pop('cosmeticIssues')
                    raw.pop('cosmeticIssues')
                elif label=='graphic-business-enum':
                    graphic=(schema['properties']['coverageAudit']['items']
                             ['properties']['observedArtwork']['items'])
                    graphic['properties']['disposition']['enum'].append('business-text')
                else:
                    cosmetic=schema['properties']['cosmeticIssues']['items']
                    cosmetic['properties']['code']['enum'].append('FORGED_WARNING')
                self._rewrite_m2_review_contract(schema,raw)
                self._assert_offline_review_contract_rejected(label)

    def test_offline_verify_rebuilds_focus_when_metadata_and_small_audit_are_removed(self):
        Dag(self.root,FakeModel()).execute()
        folder=self.root/'m2';schema=read(folder/'schema.json');raw=read(folder/'draft.json')
        self.assertTrue(read(folder/'coverage-small-materials.json')['items'])
        self.assertIn('smallMaterialAudit',raw)
        for name,definition in (('smallMaterialAudit','smallMaterialAuditEntry'),
                                ('smallBoundaryAudit','smallBoundaryAuditEntry')):
            if name in schema['properties']:
                schema['required'].remove(name)
                schema['properties'].pop(name)
                schema['$defs'].pop(definition)
                raw.pop(name)
        if not schema.get('$defs'):schema.pop('$defs',None)
        self._rewrite_m2_review_contract(schema,raw,omit_focus_input=True)
        self._assert_offline_review_contract_rejected('focus')

    def test_offline_verify_rejects_deleted_nested_semantic_and_boundary_evidence(self):
        Dag(self.root,FakeModel()).execute()
        folder=self.root/'m2'
        paths=[folder/name for name in ('schema.json','draft.json','transport.json',
                                       'request.json','assessment.json')]+[self.root/'result.json']
        baseline={path:path.read_bytes() for path in paths}
        cases=(('description-status','descriptionStatus'),
               ('observed-appearance','observedAppearance'),
               ('boundary-evidence','evidence'))
        for label,field in cases:
            with self.subTest(field=field):
                for path,content in baseline.items():path.write_bytes(content)
                schema=read(folder/'schema.json');raw=read(folder/'draft.json')
                if label=='boundary-evidence':
                    for definition in schema['$defs'].values():
                        boundary=definition['properties']['boundary']
                        boundary['required'].remove(field)
                        boundary['properties'].pop(field)
                    for audit in ('smallMaterialAudit','smallBoundaryAudit'):
                        for row in raw.get(audit,{}).values():row['boundary'].pop(field)
                else:
                    part=(schema['$defs']['smallMaterialAuditEntry']
                          ['properties']['parts']['items'])
                    part['required'].remove(field)
                    part['properties'].pop(field)
                    for row in raw['smallMaterialAudit'].values():
                        for item in row['parts']:item.pop(field)
                self._rewrite_m2_review_contract(schema,raw)
                self._assert_offline_review_contract_rejected(label)


if __name__=='__main__':unittest.main()
