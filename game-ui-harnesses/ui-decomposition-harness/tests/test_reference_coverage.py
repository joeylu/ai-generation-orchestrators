from copy import deepcopy
import unittest
from ai_ui_decomposition.reference_coverage import check,require_coverage,remap
from ai_ui_decomposition.common import ContractError
from test_assets_cli import fixture_coverage


class CoverageTests(unittest.TestCase):
    def setUp(self):
        self.plan=dict(source=dict(sha256='a'*64),canvas=[100,100],assets=[dict(id='panel'),dict(id='paper')])
        self.coverage=fixture_coverage('a'*64,['panel','paper'],[100,100])
        self.leather=dict(id='leather',label='Leather leaf and clasp',region=[80,20,18,30],
            disposition='unresolved',ownerAssets=[],removedBy=['panel'],reason='Missing from old plan')

    def test_missing_decoration_and_removal_are_reported_together(self):
        self.coverage['elements'].append(self.leather)
        result=check(self.plan,self.coverage)
        self.assertEqual(result['status'],'blocked')
        self.assertIn('COVERAGE_ELEMENT_UNRESOLVED:leather',result['issues'])
        self.assertIn('COVERAGE_REMOVED_WITHOUT_OWNER:leather',result['issues'])
        with self.assertRaisesRegex(ContractError,'REFERENCE_COVERAGE_BLOCKED'):
            require_coverage(dict(self.plan,reference_coverage=self.coverage))

    def test_explicit_owner_repairs_declaration_without_claiming_image_recognition(self):
        self.plan['assets'].append(dict(id='leather-art'))
        self.leather.update(disposition='material',ownerAssets=['leather-art'])
        self.coverage['elements'].append(self.leather)
        result=check(self.plan,self.coverage)
        self.assertEqual(result['status'],'passed')
        self.assertFalse(result['automaticSemanticInference'])
        self.assertFalse(result['humanVisualAcceptance'])
        mapped=remap(self.coverage,{'paper':'board-small','leather-art':'board-small'})
        plan=dict(self.plan,assets=[dict(id='panel'),dict(id='board-small')])
        self.assertEqual(check(plan,mapped)['status'],'passed')

    def test_conflicts_review_pending_and_reference_changes_fail(self):
        self.coverage['review']['inventoryReviewed']=False
        self.coverage['elements'][0]['removedBy']=['panel']
        result=check(self.plan,self.coverage)
        self.assertIn('COVERAGE_REVIEW_PENDING',result['issues'])
        self.assertIn('COVERAGE_OWNER_REMOVES_ELEMENT:panel',result['issues'])
        self.coverage['sourceSha256']='b'*64
        with self.assertRaisesRegex(ContractError,'REFERENCE_CHANGED'):check(self.plan,self.coverage)

    def test_exclusions_are_explicit_and_unaccounted_assets_still_block(self):
        self.leather.update(disposition='excluded',reason='Explicitly excluded from this bounded task')
        self.coverage['elements'].append(self.leather)
        self.assertEqual(len(check(self.plan,self.coverage)['exclusions']),1)
        self.coverage['elements'].pop(1)
        self.assertIn('COVERAGE_ASSET_UNACCOUNTED:paper',check(self.plan,self.coverage)['issues'])

if __name__=='__main__':unittest.main()
