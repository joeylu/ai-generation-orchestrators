"""Offline contract checks for catalog-bound planning review evidence."""
import _bootstrap
import copy
import hashlib
import json
import unittest

from jsonschema import Draft202012Validator, ValidationError

from ai_ui_layers.compile_visual import verify_run
from ai_ui_layers.evaluate import digest, read
from ai_ui_layers.freeze_visual import freeze
from ai_ui_layers.planning_dag import Dag
from ai_ui_layers.planning_review_policy import split
from ai_ui_layers.review_evidence import build_catalog, bind_schema, resolve_review
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
        bound=bind_schema(original,self.catalog)
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
        self.assertIn('planEvidenceId',raw['coverageAudit'][0]['observedArtwork'][0])
        self.assertNotIn('planEvidenceQuote',raw['coverageAudit'][0]['observedArtwork'][0])
        self.assertIn('planEvidenceId',next(iter(raw['smallMaterialAudit'].values()))['parts'][0])
        validator=Draft202012Validator(read(folder/'schema.json'))
        validator.validate(raw)
        for omitted in ('planEvidenceCatalogDigest','planEvidenceId'):
            changed=copy.deepcopy(raw)
            if omitted=='planEvidenceId':
                changed['coverageAudit'][0]['observedArtwork'][0].pop(omitted)
            else:
                changed.pop(omitted)
            with self.subTest(omitted=omitted),self.assertRaises(ValidationError):
                validator.validate(changed)
        before=copy.deepcopy(raw)
        self.assertEqual(split(raw,plan)[0],[])
        self.assertEqual(raw,before)
        self.assertEqual(read(folder/'draft.json'),before)
        self.assertEqual(verify_run(self.root),plan)

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

    def test_repair_rereview_catalog_tracks_current_candidate(self):
        Dag(self.root,FakeModel(repair=True)).execute()
        first=read(self.root/'m2/plan-evidence-catalog.json')
        second=read(self.root/'rereview/plan-evidence-catalog.json')
        self.assertEqual(first,build_catalog(read(self.root/'m1/draft.json')))
        self.assertEqual(second,build_catalog(read(self.root/'repair/candidate.json')))
        self.assertNotEqual(first['digest'],second['digest'])
        self.assertEqual(read(self.root/'m2/draft.json')['planEvidenceCatalogDigest'],first['digest'])
        self.assertEqual(read(self.root/'rereview/draft.json')['planEvidenceCatalogDigest'],second['digest'])
        self.assertEqual(read(self.root/'rereview/request.json')['inputs']['plan-evidence-catalog.json'],
                         digest(self.root/'rereview/plan-evidence-catalog.json'))
        self.assertEqual(verify_run(self.root),read(self.root/'repair/candidate.json'))

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
