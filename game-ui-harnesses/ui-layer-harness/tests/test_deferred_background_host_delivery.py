"""Offline regression for deferred background observations and exact planning replay."""
import _bootstrap
import unittest
from unittest.mock import patch
from ai_ui_layers import host_delivery as host, host_material_review as review
from ai_ui_layers.evaluate import read, digest
from test_host_review import save
import test_protected_background_host_delivery as protected
from test_host_material_review import HostEvidence


class DeferredBackgroundTests(unittest.TestCase):
    def setUp(self):
        protected.ProtectedHostDeliveryTests.setUp(self)
        config=read(self.config_path)
        config['backgroundVisualReviewPolicy']=review.BACKGROUND_VISUAL_POLICY
        save(self.config_path,config)
        self.run=self.base/'deferred';host.prepare(self.config_path,self.run);self.root=self.run/'planning'

    def planning(self):return protected.ProtectedHostDeliveryTests.planning(self)

    def test_full_composite_retains_original_blockers_and_body_observation(self):
        original=HostEvidence.response
        def response(fixture,folder,**kwargs):
            request=read(folder/'request.json')
            if request['requestId']=='asset-scene':
                inventory=read(folder/'review/ownership-inventory.json')
                observations=[dict(materialId=e['materialId'],
                    owned=[dict(objectId=o['objectId'],state='missing',evidence='Fixture missing scene feature.') for o in e['owned']],
                    foreign=[dict(materialId=o['materialId'],objectId=o['objectId'],state='present',evidence='Fixture foreign UI present.') for o in e['foreign']]) for e in inventory['entries']]
                kwargs['answer']=dict(materialIds=request['materialIds'],ownershipObservations=observations,
                    findings=[dict(materialId='asset-scene',category='extra-artwork',referenceState='not-applicable',
                        generatedState='not-applicable',magnitude='major',ownership='clear',
                        evidence='Fixture duplicated background crate.',suggestion='Assess visibility after full composite.')])
            else:self.assertNotIn('backgroundVisualReviewPolicy',request)
            return original(fixture,folder,**kwargs)
        with patch.object(HostEvidence,'response',response):
            protected.ProtectedHostDeliveryTests.test_complete_flow_raw_candidate_review_body_identity_package(self)
        # The reused base fixture deliberately corrupts this comparison to
        # test checkpoint rejection. Undo exactly its appended fixture suffix
        # before checking the new final-state metadata.
        comparison=self.run/'delivery/comparison/three-way-comparison.png'
        data=comparison.read_bytes();suffix=b'changed output'
        self.assertTrue(data.endswith(suffix));comparison.write_bytes(data[:-len(suffix)])
        result=read(self.run/'reviews/asset-scene/result.json')
        self.assertEqual(result['status'],review.BACKGROUND_DEFERRED_STATUS)
        self.assertTrue(result['blockers']);self.assertEqual(result['decisions'][0]['severity'],'blocking')
        self.assertFalse(result['deferredVisualFindings']['visualReviewPassed'])
        self.assertTrue(host.status(self.run)['deferredBackgroundVisualReview'])
        self.assertTrue((self.run/'body-output.json').exists())
        package_review=read(self.run/'delivery/package/review.json')
        self.assertIn('Fixture duplicated background crate.',str(package_review))
        self.assertIn('Fixture foreign UI present.',str(package_review))
        self.assertIn('"severity": "blocking"',str(package_review))

    def test_exact_prior_review_replay_new_image_scope(self):
        self.planning();snapshot=self.run/'frozen';manifest=read(snapshot/'snapshot.json')
        config=read(self.config_path);config.update(reviewedSnapshot=str(snapshot),reviewedSnapshotDigest=manifest['digest'])
        save(self.config_path,config);new=self.base/'replayed'
        before=host._files(self.run)
        result=host.prepare(self.config_path,new)
        self.assertEqual(result['stage'],'images');self.assertEqual(result['status'],'awaiting_authorization')
        self.assertEqual(result['planningMode'],'verified-prior-independent-host-review')
        self.assertFalse(result['newM2ReviewPerformed']);self.assertFalse((new/'planning').exists())
        self.assertFalse((new/'images/authorization.json').exists())
        self.assertEqual(before,host._files(self.run))
        self.assertEqual(digest(snapshot/'snapshot.json'),digest(new/'frozen/snapshot.json'))
        (snapshot/'evidence/m2-draft.json').write_bytes(b'changed')
        with self.assertRaises(ValueError):host.prepare(self.config_path,self.base/'tampered-replay')

    def test_policy_requires_protected_background_and_exact_name(self):
        config=read(self.config_path);config['backgroundVisualReviewPolicy']='unknown-policy';save(self.config_path,config)
        with self.assertRaisesRegex(ValueError,'PROTECTED_BACKGROUND_VISUAL_POLICY_REQUIRED'):
            host.prepare(self.config_path,self.base/'invalid')
        with self.assertRaisesRegex(ValueError,'PROTECTED_BACKGROUND_VISUAL_POLICY_REQUIRED'):
            review.validate_background_visual_policy(review.BACKGROUND_VISUAL_POLICY,dict(materialId='scene'),'foreground')
        with self.assertRaisesRegex(ValueError,'PROTECTED_BACKGROUND_VISUAL_POLICY_REQUIRED'):
            review.validate_background_visual_policy(review.BACKGROUND_VISUAL_POLICY,None)

    def test_incomplete_ownership_coverage_still_terminal(self):
        original=HostEvidence.response
        def response(fixture,folder,**kwargs):
            request=read(folder/'request.json')
            if request['requestId']=='asset-scene':
                kwargs['answer']=dict(materialIds=request['materialIds'],findings=[],
                    ownershipObservations=[dict(materialId='asset-scene',owned=[],foreign=[])])
            return original(fixture,folder,**kwargs)
        with patch.object(HostEvidence,'response',response),self.assertRaisesRegex(ValueError,'OWNERSHIP_OWNED_COVERAGE'):
            protected.ProtectedHostDeliveryTests.test_complete_flow_raw_candidate_review_body_identity_package(self)
        self.assertEqual(host.status(self.run)['status'],'failed_no_retry')
        self.assertFalse((self.run/'body').exists())
        self.assertFalse((self.run/'delivery').exists())

    def test_prior_replay_refuses_changed_seed_notes_or_without_policy(self):
        self.planning();snapshot=self.run/'frozen';manifest=read(snapshot/'snapshot.json')
        base=read(self.config_path);base.update(reviewedSnapshot=str(snapshot),reviewedSnapshotDigest=manifest['digest'])
        cases=[dict(planningNotes='not-allowed'),dict(backgroundVisualReviewPolicy=None)]
        changed=self.base/'changed-seed.json';save(changed,dict(changed=True));cases.append(dict(seed=str(changed)))
        for i,change in enumerate(cases):
            config=dict(base,**change);save(self.config_path,config)
            with self.assertRaises(ValueError):host.prepare(self.config_path,self.base/('invalid-replay-'+str(i)))

if __name__=='__main__':unittest.main()
