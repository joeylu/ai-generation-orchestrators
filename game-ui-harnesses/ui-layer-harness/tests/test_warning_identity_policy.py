"""Identity uncertainty is visual evidence; malformed inputs remain hard errors."""
import _bootstrap
import tempfile
import unittest
from pathlib import Path

from ai_ui_layers import host_material_review as host, ownership_observation as ownership
from ai_ui_layers.evaluate import save, read
from ai_ui_layers.sheet_review_policy import classify, classify_findings, schema_for
from ai_ui_layers.visual_policy import warning_policy


class WarningIdentityTests(unittest.TestCase):
    def test_only_ordered_unique_known_subset_is_unresolved(self):
        expected=['a','b','c']
        for observed in ([],['a'],['b','c']):self.assertTrue(host.observed_subset(observed,expected))
        self.assertFalse(host.observed_subset(expected,expected))
        for observed in (['b','a'],['a','a'],['unknown'],None,[1]):
            with self.subTest(observed=observed),self.assertRaisesRegex(ValueError,'IDENTITY_MISMATCH'):
                host.observed_subset(observed,expected)
        with self.assertRaisesRegex(ValueError,'IDENTITY_MISMATCH'):
            classify(dict(materialIds=[],findings=[]),expected,warning_policy())
        with self.assertRaisesRegex(ValueError,'BOUND_WARNING_IDENTITY'):
            host.validate_identity_policy(host.IDENTITY_POLICY,None)

    def test_uncertain_findings_still_validate_states_and_ids(self):
        finding=dict(materialId='a',category='uncertain',referenceState='not-applicable',
            generatedState='not-applicable',magnitude='uncertain',ownership='ambiguous',
            evidence='Identity unclear.',suggestion='Compare final output.',styleAspect='other')
        self.assertEqual(len(classify_findings([finding],['a'],warning_policy())['warnings']),1)
        for change in (dict(materialId='foreign'),dict(generatedState='full'),dict(styleAspect='shadow')):
            with self.subTest(change=change),self.assertRaises(ValueError):
                classify_findings([{**finding,**change}],['a'],warning_policy())

    def test_unresolved_answer_retains_real_ids_and_requires_full_ownership(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);folder=root/'review';folder.mkdir();policy=warning_policy()
            inventory=dict(materialIds=['a','b'],entries=[dict(materialId=mid,
                owned=[dict(objectId=mid+'-body')],foreign=[]) for mid in ('a','b')])
            save(folder/'ownership-inventory.json',inventory)
            save(folder/'schema.json',ownership.extend_schema(schema_for(policy),inventory))
            answer=dict(materialIds=['b'],findings=[],ownershipObservations=[dict(materialId=mid,
                owned=[dict(objectId=mid+'-body',state='uncertain',evidence='Blank instance.')],foreign=[]) for mid in ('a','b')])
            save(folder/'draft.json',answer)
            request=dict(kind='ui_host_output_review_request_v2',requestId='sheet-fixture',materialIds=['a','b'],
                identityObservationPolicy=host.IDENTITY_POLICY,rawSha256='a'*64,ownershipInventorySha256='b'*64)
            before=(folder/'draft.json').read_bytes()
            result=host.assess(root,request,policy)
            self.assertEqual(result['status'],host.IDENTITY_UNRESOLVED_STATUS)
            self.assertEqual(result['observedMaterialIds'],['b'])
            self.assertEqual(before,(folder/'draft.json').read_bytes())
            self.assertEqual(read(folder/'draft.json'),answer)
            request.pop('identityObservationPolicy')
            with self.assertRaisesRegex(ValueError,'IDENTITY_MISMATCH'):host.assess(root,request,policy)
            request['identityObservationPolicy']=host.IDENTITY_POLICY
            answer['ownershipObservations'][0]['owned']=[]
            (folder/'draft.json').unlink();save(folder/'draft.json',answer)
            with self.assertRaisesRegex(ValueError,'OWNERSHIP_OWNED_COVERAGE'):host.assess(root,request,policy)


if __name__=='__main__':unittest.main()
