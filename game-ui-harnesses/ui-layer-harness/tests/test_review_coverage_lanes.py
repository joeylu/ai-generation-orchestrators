"""Offline V4 coverage transport regressions; no provider or private artifacts."""
import _bootstrap
import copy
import json
import unittest

from jsonschema import Draft202012Validator, ValidationError

from ai_ui_layers.coverage_review import REGIONS
from ai_ui_layers.planning_review_policy import split
from ai_ui_layers.review_evidence import (
    PROTOCOL_V1, PROTOCOL_V2, PROTOCOL_V3, PROTOCOL_V4, build_catalog,
    build_review_schema, configured_protocol, resolve_review)


def fixture():
    plan=dict(textPolicy='remove-business-text', materials=[
        dict(id='figure',label='Synthetic figure with linked head, body, hands and feet'),
        dict(id='panel',label='Synthetic panel',preserveText=['KEEP'])],objects=[
        dict(id='head',materialId='figure',label='Synthetic head',kind='artwork'),
        dict(id='shadow',materialId='figure',label='Synthetic shadow',kind='shadow')])
    entry=dict(artwork='Head linked to the figure',materialId='figure',objectId='head',
               evidence='Head visible in the original top-center region.')
    raw=dict(planEvidenceProtocol=PROTOCOL_V4,
        planEvidenceCatalogDigest=build_catalog(plan)['digest'],issues=[],cosmeticIssues=[],
        coverageAudit=[dict(region=region,coveredArtwork=[],unresolvedArtwork=[],
            optionalShadowArtwork=[],businessText=[],
            emptyRegionEvidence='No artwork visible in this original region.') for region in REGIONS])
    raw['coverageAudit'][1].update(coveredArtwork=[entry],emptyRegionEvidence=None)
    return plan,raw


class CoverageLaneTests(unittest.TestCase):
    def setUp(self):
        self.plan,self.raw=fixture()
        self.schema=build_review_schema(build_catalog(self.plan),None,None,PROTOCOL_V4)
        self.validator=Draft202012Validator(self.schema)

    def test_v4_is_explicit_and_historical_schema_is_unchanged(self):
        self.assertEqual(configured_protocol({}),PROTOCOL_V3)
        self.assertEqual(configured_protocol({'reviewEvidenceProtocol':PROTOCOL_V4}),PROTOCOL_V4)
        for protocol in (None,PROTOCOL_V1,PROTOCOL_V2,'unknown'):
            with self.assertRaisesRegex(ValueError,'REVIEW_EVIDENCE_PROTOCOL_UNKNOWN'):
                configured_protocol({'reviewEvidenceProtocol':protocol})
        catalog=build_catalog(self.plan)
        self.assertEqual(build_review_schema(catalog,None,None),
                         build_review_schema(catalog,None,None,PROTOCOL_V3))
        for protocol in (PROTOCOL_V1,PROTOCOL_V2,PROTOCOL_V3):
            properties=build_review_schema(catalog,None,None,protocol)['properties']['coverageAudit']['items']['properties']
            self.assertIn('observedArtwork',properties)
            self.assertNotIn('coveredArtwork',properties)
            changed=copy.deepcopy(self.raw);changed['planEvidenceProtocol']=protocol
            with self.assertRaisesRegex(ValueError,'PLAN_EVIDENCE'):
                resolve_review(changed,self.plan)

    def test_transport_has_no_conditionals_and_covered_claims_cannot_carry_suggestions(self):
        def walk(value):
            if isinstance(value,dict):
                self.assertFalse(set(value)&{'allOf','anyOf','oneOf','if','then','else'})
                for child in value.values():walk(child)
            elif isinstance(value,list):
                for child in value:walk(child)
        walk(self.schema)
        self.validator.validate(self.raw)
        for lane in ('coveredArtwork','optionalShadowArtwork'):
            for field,value in (('suggestedChange','Add missing hands and feet linkage.'),
                                ('disposition','covered')):
                changed=copy.deepcopy(self.raw)
                region=changed['coverageAudit'][1]
                entry=region['coveredArtwork'][0]
                region[lane]=[entry];entry[field]=value
                with self.subTest(lane=lane,field=field),self.assertRaises(ValidationError):
                    self.validator.validate(changed)
                with self.assertRaises(ValidationError):resolve_review(changed,self.plan)

    def test_decode_preserves_raw_bytes_and_resolves_exact_owner_label(self):
        before=json.dumps(self.raw,sort_keys=True).encode()
        resolved=resolve_review(self.raw,self.plan)
        entry=resolved['coverageAudit'][1]['observedArtwork'][0]
        self.assertEqual(entry['disposition'],'covered')
        self.assertIsNone(entry['suggestedChange'])
        self.assertEqual(entry['planEvidenceQuote'],'Synthetic head')
        self.assertEqual(entry['evidence'],self.raw['coverageAudit'][1]['coveredArtwork'][0]['evidence'])
        self.assertEqual(json.dumps(self.raw,sort_keys=True).encode(),before)
        self.assertEqual(split(self.raw,self.plan),([],[]))

    def test_unresolved_linkage_preserves_suggestion_and_remains_repair_blocker(self):
        for state in ('missing','uncertain'):
            changed=copy.deepcopy(self.raw);region=changed['coverageAudit'][1]
            entry=region['coveredArtwork'].pop()
            entry.update(disposition=state,suggestedChange='Describe head/body/hands/feet linkage explicitly.')
            region['unresolvedArtwork'].append(entry)
            self.validator.validate(changed)
            blockers,warnings=split(changed,self.plan)
            self.assertEqual(warnings,[])
            self.assertEqual(len(blockers),1)
            self.assertEqual(blockers[0]['code'],'UNASSIGNED_VISIBLE_ARTWORK')
            self.assertEqual(blockers[0]['suggestedChange'],entry['suggestedChange'])
            self.assertEqual(blockers[0]['sourceEvidence'],entry['evidence'])
            for suggestion in (None,'','   '):
                entry['suggestedChange']=suggestion
                with self.assertRaises((ValueError,ValidationError)):split(changed,self.plan)

    def test_unknown_cross_owner_and_unbound_covered_ids_cannot_pass(self):
        for lane in ('coveredArtwork','unresolvedArtwork','optionalShadowArtwork'):
            for mid,oid in (('absent',None),('figure','absent'),('panel','head'),(None,None)):
                if lane!='coveredArtwork' and mid is None:continue
                changed=copy.deepcopy(self.raw);region=changed['coverageAudit'][1]
                entry=region['coveredArtwork'].pop();entry.update(materialId=mid,objectId=oid)
                if lane=='unresolvedArtwork':entry.update(disposition='missing',suggestedChange='Bind owner.')
                region[lane].append(entry)
                with self.subTest(lane=lane,mid=mid,oid=oid),self.assertRaises((ValueError,ValidationError)):
                    split(changed,self.plan)

    def test_region_catalog_and_empty_claims_remain_strict(self):
        changes=[lambda r:r.update(planEvidenceCatalogDigest='0'*64),
                 lambda r:r['coverageAudit'].pop(),
                 lambda r:r['coverageAudit'][0].update(region=REGIONS[1]),
                 lambda r:r['coverageAudit'][1].update(emptyRegionEvidence='Empty.'),
                 lambda r:r['coverageAudit'][0].update(emptyRegionEvidence=None),
                 lambda r:r['coverageAudit'][1].update(observedArtwork=[])]
        for change in changes:
            changed=copy.deepcopy(self.raw);change(changed)
            with self.assertRaises((ValueError,ValidationError)):split(changed,self.plan)

    def test_shadow_and_business_lanes_keep_existing_policy_gates(self):
        changed=copy.deepcopy(self.raw);region=changed['coverageAudit'][1]
        entry=region['coveredArtwork'].pop();entry['objectId']=None
        region['optionalShadowArtwork'].append(entry)
        with self.assertRaisesRegex(ValueError,'COVERAGE_OPTIONAL_SHADOW_UNSUPPORTED'):
            split(changed,self.plan)
        changed=copy.deepcopy(self.raw);region=changed['coverageAudit'][1]
        region['businessText'].append(dict(artwork='Business letters',materialId='panel',
            evidence='Letters visible in original panel.',textFragments=['KEEP']))
        with self.assertRaisesRegex(ValueError,'COVERAGE_PRESERVED_TEXT_CONFLICT'):
            split(changed,self.plan,coverage_text_policy='exact-fragments-v1')
        region['businessText'][0]['textFragments']=['SALE']
        self.assertEqual(split(changed,self.plan,coverage_text_policy='exact-fragments-v1'),([],[]))

    def test_optional_shadow_is_material_scoped_and_cannot_reference_main_object(self):
        from ai_ui_layers.visual_policy import validate as validate_policy
        policy={'kind':'ui_visual_policy_v1','appearanceEvidence':'bound-reference',
                'minorColor':'record','shadow':'optional'}
        validate_policy(policy)
        changed=copy.deepcopy(self.raw);region=changed['coverageAudit'][1]
        entry=region['coveredArtwork'].pop()
        entry.update(artwork='Separate soft shadow outside the figure contour',objectId=None,
                     evidence='A diffuse isolated shadow fades outside the synthetic figure; the solid contour is covered separately.')
        region['optionalShadowArtwork'].append(entry)
        self.validator.validate(changed)
        self.assertEqual(split(changed,self.plan,visual_policy=policy),([],[]))
        for oid in ('head','shadow'):
            entry['objectId']=oid
            with self.assertRaises(ValidationError):self.validator.validate(changed)
            with self.assertRaises(ValidationError):split(changed,self.plan,visual_policy=policy)


if __name__=='__main__':unittest.main()
