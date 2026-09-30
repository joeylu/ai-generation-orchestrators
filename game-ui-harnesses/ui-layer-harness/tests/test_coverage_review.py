"""Synthetic contracts for itemized, owner-bound planning coverage."""
import _bootstrap
import copy
import unittest

from jsonschema import Draft202012Validator
from ai_ui_layers.codex_call import transport_schema
from ai_ui_layers.coverage_review import REGIONS, coverage_findings, coverage_schema
from ai_ui_layers.planning_review_policy import split


def plan():
    return dict(textPolicy='remove-business-text',materials=[
        dict(id='scene',label='Stone scene with blue arch',preserveText=[]),
        dict(id='panel',label='Panel with a brass handle',preserveText=[])],objects=[
        dict(id='arch',materialId='scene',label='Blue arch with white trim',kind='decoration'),
        dict(id='handle',materialId='panel',label='Brass handle with dark stem',kind='decoration'),
        dict(id='price',materialId='panel',label='Price text',kind='text')])


def entry(**changes):
    row=dict(artwork='A blue arch',disposition='covered',materialId='scene',objectId='arch',
             planEvidenceQuote='Blue arch',evidence='The source shows the blue arch.',suggestedChange=None)
    row.update(changes)
    return row


def review():
    return dict(issues=[],coverageAudit=[dict(region=name,observedArtwork=[entry()] if index==0 else [],
        emptyRegionEvidence=None if index==0 else 'The clean source has no artwork in this region.')
        for index,name in enumerate(REGIONS)])


class CoverageReviewTests(unittest.TestCase):
    def test_transport_subset_has_no_conditionals(self):
        schema=coverage_schema()
        text=str(schema)
        for unsupported in ('allOf','anyOf','oneOf','if','then','else'):
            self.assertNotIn("'"+unsupported+"'",text)
        transported=transport_schema(schema)
        Draft202012Validator(transported).validate(review()['coverageAudit'][0])

    def test_missing_unknown_owner_blocks_without_fabricated_id(self):
        audit=review()
        audit['coverageAudit'][1]['observedArtwork']=[entry(artwork='A separate silver bell',
            disposition='missing',materialId=None,objectId=None,planEvidenceQuote=None,
            evidence='A bell is visible in the source.',suggestedChange='Add an owner for the bell.')]
        audit['coverageAudit'][1]['emptyRegionEvidence']=None
        blockers,warnings=split(audit,plan())
        self.assertEqual(len(blockers),1)
        self.assertEqual(blockers[0]['code'],'UNASSIGNED_VISIBLE_ARTWORK')
        self.assertEqual(blockers[0]['ids'],[])
        self.assertFalse(warnings)

    def test_uncertain_existing_owner_blocks(self):
        audit=review()
        audit['coverageAudit'][0]['observedArtwork']=[entry(
            artwork='The panel handle',disposition='uncertain',materialId='panel',objectId='handle',
            planEvidenceQuote=None,evidence='Handle detail may be incomplete.',
            suggestedChange='Compare its silhouette with the source.')]
        self.assertEqual(split(audit,plan())[0][0]['ids'],['panel'])

    def test_covered_requires_exact_owner_and_literal_label_quote(self):
        for change in (dict(planEvidenceQuote='brass handle'),
                       dict(materialId='panel',objectId='arch'),
                       dict(objectId=None,planEvidenceQuote='Blue arch'),
                       dict(materialId=None)):
            with self.subTest(change=change):
                audit=review();audit['coverageAudit'][0]['observedArtwork'][0].update(change)
                with self.assertRaises(ValueError):coverage_findings(audit,plan())

    def test_missing_cannot_claim_unknown_or_cross_owner_ids_or_quote(self):
        for change,code in ((dict(materialId='panel',objectId='arch'),'COVERAGE_OBJECT_OWNER_MISMATCH'),
                            (dict(materialId='panel',objectId='new-object'),'COVERAGE_OBJECT_ID_UNKNOWN'),
                            (dict(materialId='new-material',objectId=None),'COVERAGE_MATERIAL_ID_UNKNOWN'),
                            (dict(materialId='panel',objectId=None,planEvidenceQuote='Panel'),'COVERAGE_NONCOVERED_QUOTE')):
            with self.subTest(change=change):
                audit=review();item=audit['coverageAudit'][0]['observedArtwork'][0]
                item.update(disposition='missing',suggestedChange='Describe this part.',planEvidenceQuote=None)
                item.update(change)
                with self.assertRaisesRegex(ValueError,code):coverage_findings(audit,plan())

    def test_business_text_exclusion_requires_policy_and_text_owner(self):
        audit=review();item=audit['coverageAudit'][0]['observedArtwork'][0]
        item.update(artwork='SALE 20%',disposition='business-text',materialId='panel',
                    objectId='price',planEvidenceQuote=None,evidence='These exact digits are business copy.')
        mixed=plan();mixed['materials'][1]['preserveText']=['LOGO']
        with self.assertRaisesRegex(ValueError,'COVERAGE_PRESERVED_TEXT_CONFLICT'):
            coverage_findings(audit,mixed)
        bad=copy.deepcopy(audit);bad['coverageAudit'][0]['observedArtwork'][0]['objectId']='handle'
        with self.assertRaisesRegex(ValueError,'COVERAGE_BUSINESS_TEXT_OWNED_GRAPHIC'):
            coverage_findings(bad,plan())
        bad=copy.deepcopy(audit);badplan=plan();badplan['textPolicy']='preserve-all-text'
        with self.assertRaisesRegex(ValueError,'COVERAGE_BUSINESS_TEXT_POLICY_REQUIRED'):
            coverage_findings(bad,badplan)
        for kept in ('SALE 20%','SALE','FLASH SALE 20% TODAY'):
            with self.subTest(kept=kept):
                badplan=plan();badplan['materials'][1]['preserveText']=[kept]
                with self.assertRaisesRegex(ValueError,'COVERAGE_PRESERVED_TEXT_CONFLICT'):
                    coverage_findings(audit,badplan)
        # Unknown ownership cannot be used to bypass a retained-text license.
        item.update(materialId=None,objectId=None)
        with self.assertRaisesRegex(ValueError,'COVERAGE_BUSINESS_TEXT_OWNER_REQUIRED'):
            coverage_findings(audit,plan())

    def test_optional_shadow_requires_explicit_policy_and_real_owner(self):
        audit=review();item=audit['coverageAudit'][0]['observedArtwork'][0]
        item.update(artwork='Soft isolated shadow',disposition='optional-shadow',
                    materialId='panel',objectId=None,planEvidenceQuote=None,
                    evidence='Only an isolated soft shadow is visible.')
        optional=dict(kind='ui_visual_policy_v1',appearanceEvidence='text-complete',
                      minorColor='strict',shadow='optional')
        with self.assertRaisesRegex(ValueError,'COVERAGE_OPTIONAL_SHADOW_UNSUPPORTED'):
            coverage_findings(audit,plan())
        self.assertEqual(coverage_findings(audit,plan(),optional),[])
        item['objectId']='handle'
        with self.assertRaisesRegex(ValueError,'COVERAGE_OPTIONAL_SHADOW_UNSUPPORTED'):
            coverage_findings(audit,plan(),optional)

    def test_empty_and_mixed_formats_fail_closed(self):
        audit=review()
        for row in audit['coverageAudit']:
            row['observedArtwork']=[]
            row['emptyRegionEvidence']='No artwork visible in this region.'
        with self.assertRaisesRegex(ValueError,'ALL_EMPTY_COVERAGE_AUDIT'):
            coverage_findings(audit,plan())
        audit=review();audit['coverageAudit'][1]['emptyRegionEvidence']=None
        with self.assertRaisesRegex(ValueError,'COVERAGE_EMPTY_REGION_EVIDENCE_REQUIRED'):
            coverage_findings(audit,plan())
        audit=review();audit['coverageAudit'][0]['observedArtwork']='Scene artwork'
        audit['coverageAudit'][0]['missingFromPlan']=[]
        with self.assertRaisesRegex(ValueError,'MIXED_COVERAGE_FORMAT'):
            coverage_findings(audit,plan())

    def test_legacy_string_review_remains_compatible(self):
        audit=dict(issues=[],coverageAudit=[dict(region=name,observedArtwork='Source image',
            missingFromPlan=[dict(artwork='A missing bell',suggestedOwnerId='old-owner',
            suggestedChange='Describe the bell.')] if index==0 else [])
            for index,name in enumerate(REGIONS)])
        blockers,_=split(audit)
        self.assertEqual(blockers[0]['ids'],['old-owner'])
        self.assertEqual(len(blockers),1)
        with self.assertRaisesRegex(ValueError,'COVERAGE_PLAN_REQUIRED'):
            coverage_findings(review())


if __name__=='__main__':unittest.main()
