"""Regression: real declared constraint IDs must not masquerade as unknown owners."""
import _bootstrap
import copy
import unittest
from jsonschema import ValidationError
from ai_ui_layers import host_review
from ai_ui_layers.evaluate import read, digest
from ai_ui_layers.visual_policy import warning_policy
import test_host_review as fixtures
save=fixtures.save


class LayoutReviewIdTests(unittest.TestCase):
    def setUp(self):
        fixtures.HostReviewTests.setUp(self)
        self.constraint='header_board_top_inset'
        self.plan['layoutRegistration']=dict(kind='ui_host_layout_contract_v1',
            referenceSha256=digest(self.reference),materials=[dict(materialId=m['id'],
                mode='frame',measurementAlphaThreshold=128) for m in self.plan['materials']
                if m['role']=='foreground'],constraints=[dict(id=self.constraint,
                a=dict(materialId='asset-buy-button',edge='top'),
                b=dict(materialId='asset-panel',edge='top'),expectedDelta=700,tolerancePixels=2)],
            knownDifferences=[])

    def prepare(self, warning=True):
        self.warning=warning
        save(self.candidate,self.plan)
        policy=self.base/'warning-policy.json'
        if warning:save(policy,warning_policy())
        self.prepared=host_review.prepare(self.candidate,self.reference,self.root,self.contract,
            seed_author='fixture-author',visual_policy=policy if warning else None,max_calls=16)

    def response_doc(self):
        review=fixtures.HostReviewTests.response_doc(self)
        if self.warning:
            for entry in review['smallMaterialAudit'].values():
                for part in entry['parts']:part['deferredAppearance']=None
        return review
    def write_attestation(self):return fixtures.HostReviewTests.write_attestation(self)
    def receive(self, review):return fixtures.HostReviewTests.receive(self,review)
    def freeze(self):return fixtures.HostReviewTests.freeze(self)

    def finding(self, identifier=None):
        review=self.response_doc()
        review['issues']=[dict(code='FRAME_CONSTRAINT_USES_SHADOW_BOUNDS',category='geometry',
            ids=['asset-panel',identifier or self.constraint],
            description='Rigid frame and shadow crop have different top edges.',
            suggestedChange='Measure the rigid frame separately while retaining the shadow.')]
        return review

    def test_warning_keeps_constraint_finding_original_bytes_and_frozen_schema(self):
        self.prepare();review=self.finding();result=self.receive(review)
        self.assertEqual(result['blockers'],[])
        self.assertIn(self.constraint,result['warnings'][0]['ids'])
        self.assertEqual((self.root/'m2/draft.json').read_bytes(),self.response.read_bytes())
        self.assertEqual(host_review.status(self.root)['status'],'ready_to_freeze')
        self.freeze()
        from ai_ui_layers.freeze_visual import inspect
        self.assertTrue(inspect(self.base/'frozen')['notProviderReceipt'])
        request=read(self.root/'m2/request.json')
        self.assertEqual(request['inputs']['reference.png'],digest(self.reference))
        self.assertEqual((self.root/'m2/reference.png').read_bytes(),self.reference.read_bytes())
        self.assertIn('Inspect reference.png',(self.root/'m2/prompt.md').read_text('utf-8'))

    def test_strict_geometry_finding_still_blocks(self):
        self.prepare(warning=False);result=self.receive(self.finding())
        self.assertTrue(result['blockers'])
        self.assertEqual(host_review.status(self.root)['status'],'review_blocked')
        with self.assertRaisesRegex(ValueError,'M2_UNRESOLVED'):self.freeze()

    def test_invented_constraint_is_rejected_and_original_failure_is_terminal(self):
        self.prepare();review=self.finding('invented-layout-constraint')
        with self.assertRaises(ValidationError):self.receive(review)
        self.assertEqual((self.root/'m2/draft.json').read_bytes(),self.response.read_bytes())
        self.assertEqual(host_review.status(self.root)['status'],'review_receive_failed')
        with self.assertRaisesRegex(ValueError,'ALREADY_RECEIVED'):self.receive(review)

    def test_legacy_schema_and_identifier_scope_are_unchanged(self):
        self.prepare();schema=read(self.root/'m2/schema.json')
        legacy=copy.deepcopy(schema)
        for field in ('issues','cosmeticIssues'):
            legacy['properties'][field]['items']['properties']['ids']['items'].pop('enum')
        self.assertEqual(host_review._bind_issue_ids(copy.deepcopy(legacy),self.plan,{}),legacy)
        self.assertNotIn(self.constraint,host_review._review_issue_ids(self.plan,{}))
        allowed=host_review._review_issue_ids(self.plan,dict(reviewIssueIdPolicy=host_review.LAYOUT_ISSUE_IDS))
        self.assertIn(self.constraint,allowed)
        self.assertNotIn('invented-layout-constraint',allowed)


if __name__=='__main__':unittest.main()
