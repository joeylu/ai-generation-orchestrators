"""Real host intake/receipt replay, using fixture responses only."""
import _bootstrap
import json
import unittest
from jsonschema import ValidationError
from ai_ui_layers import host_material_review as host
from ai_ui_layers.evaluate import read,digest
from test_host_material_review import HostEvidence
import test_single_material_review
from test_ownership_observation import complete


class HostOwnershipTests(HostEvidence,unittest.TestCase):
    setUp=test_single_material_review.SingleMaterialReviewTests.setUp

    def test_new_request_binds_complete_catalog_schema_and_prompt(self):
        folder=self.prepare('asset-coin-a');request=read(folder/'request.json')
        self.assertEqual(request['kind'],'ui_host_output_review_request_v2')
        self.assertIn('review/ownership-inventory.json',request['inputs'])
        self.assertIn('ownershipObservations',read(folder/'review/schema.json')['required'])
        self.assertIn('empty findings list cannot replace',(folder/'review/prompt.md').read_text('utf-8'))
        result=host.receive(**self.response(folder))
        self.assertEqual(result['ownershipObservationCoverage'],'complete')
        self.assertTrue(result['ownershipDeclarationsOnly']);host.verify_run(folder)

    def test_empty_findings_without_object_observations_cannot_pass(self):
        folder=self.prepare('asset-coin-a')
        raw=json.dumps(dict(materialIds=['asset-coin-a'],findings=[])).encode()
        with self.assertRaises(ValidationError):host.receive(**self.response(folder,raw=raw))
        self.assertEqual(read(folder/'result.json')['status'],'indeterminate_review_no_retry')

    def test_foreign_artwork_presence_blocks_even_with_empty_findings(self):
        folder=self.prepare('asset-coin-a');inventory=read(folder/'review/ownership-inventory.json')
        observations=complete(inventory);self.assertTrue(observations[0]['foreign'])
        observations[0]['foreign'][0]['state']='present'
        observations[0]['foreign'][0]['evidence']='Fixture backing still includes a foreign panel edge.'
        result=host.receive(**self.response(folder,dict(materialIds=['asset-coin-a'],findings=[],ownershipObservations=observations)))
        self.assertEqual(result['status'],'blocked_no_retry')
        self.assertEqual(result['blockers'][0]['scope'],'foreign')
        with self.assertRaisesRegex(ValueError,'OUTPUT_REVIEW_NOT_PASSED'):host.verify_run(folder)

    def test_missing_foreign_object_answer_is_not_a_complete_observation(self):
        folder=self.prepare('asset-coin-a');observations=complete(read(folder/'review/ownership-inventory.json'))
        observations[0]['foreign'].pop()
        with self.assertRaisesRegex(ValueError,'OWNERSHIP_FOREIGN_COVERAGE'):
            host.receive(**self.response(folder,dict(materialIds=['asset-coin-a'],findings=[],ownershipObservations=observations)))
        self.assertEqual(read(folder/'result.json')['status'],'indeterminate_review_no_retry')

    def test_frozen_v1_fixture_keeps_its_original_schema_and_replays(self):
        # Construct a legacy frozen request using fixture output only, before
        # any response is received. Real historical requests are never edited.
        from ai_ui_layers.sheet_review_policy import schema_for
        folder=self.prepare('asset-coin-a');request,policy=host.verify_prepared(folder)
        (folder/'review/ownership-inventory.json').unlink()
        schema=folder/'review/schema.json';schema.write_text(json.dumps(schema_for(policy)),encoding='utf-8')
        prompt=folder/'review/prompt.md'
        prompt.write_text(prompt.read_text('utf-8').split('Return required ownershipObservations')[0],encoding='utf-8')
        request['kind']='ui_host_output_review_request_v1';request.pop('ownershipInventorySha256')
        request['inputs']=host.files(folder)
        request['inputs'].pop('request.json');request['inputs'].pop('preparation.json')
        (folder/'request.json').write_text(json.dumps(request),encoding='utf-8')
        (folder/'preparation.json').write_text(json.dumps(dict(requestSha256=digest(folder/'request.json'))),encoding='utf-8')
        checked,_=host.verify_prepared(folder);self.assertEqual(checked['kind'],'ui_host_output_review_request_v1')
        arguments=self.response(folder);self.assertNotIn('ownershipObservations',read(arguments['response']))
        result=host.receive(**arguments);host.verify_run(folder)
        self.assertEqual(result['status'],'reviewed_pending_visual_acceptance')
        self.assertNotIn('ownershipObservationCoverage',result)
        self.assertFalse(result['humanVisualAcceptance'])


if __name__=='__main__':unittest.main()
