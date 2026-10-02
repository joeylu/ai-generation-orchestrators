"""New V4 coverage must reach repair/freeze and retain its bound protocol."""
import _bootstrap
import json
import unittest

from ai_ui_layers.compile_visual import verify_run, verify_plan_evidence
from ai_ui_layers.evaluate import read, digest
from ai_ui_layers.planning_dag import Dag
from ai_ui_layers.review_evidence import PROTOCOL_V3, PROTOCOL_V4, build_review_schema
from test_planning_dag import FakeModel
import test_planning_dag


class DefaultCoverageProtocolTests(unittest.TestCase):
    setUp=test_planning_dag.DagTests.setUp

    def test_new_run_selects_v4_and_frozen_plan_replays(self):
        self.assertEqual(read(self.root/'.dag/config.json')['reviewEvidenceProtocol'],PROTOCOL_V4)
        model=FakeModel()
        self.assertEqual(Dag(self.root,model).execute()['status'],'frozen')
        raw=read(self.root/'m2/draft.json')
        self.assertEqual(raw['planEvidenceProtocol'],PROTOCOL_V4)
        region=raw['coverageAudit'][0]
        self.assertNotIn('observedArtwork',region)
        self.assertNotIn('suggestedChange',region['coveredArtwork'][0])
        self.assertEqual(verify_run(self.root),read(self.root/'m1/normalized-plan.json'))

    def test_unresolved_coverage_reaches_existing_repair_and_rereview(self):
        model=FakeModel()
        def invoke(folder,sid,first):
            model(folder,sid,first)
            if folder.name=='m2':
                raw=read(folder/'draft.json');region=raw['coverageAudit'][0]
                entry=region['coveredArtwork'].pop()
                entry.update(disposition='uncertain',materialId='asset-panel',
                             evidence='Synthetic panel detail requires clarification in the original.',
                             suggestedChange='Clarify the observed panel detail in its label.')
                region['unresolvedArtwork'].append(entry)
                (folder/'draft.json').write_text(json.dumps(raw),encoding='utf-8')
                receipt=read(folder/'transport.json');receipt['responseSha256']=digest(folder/'draft.json')
                (folder/'transport.json').write_text(json.dumps(receipt),encoding='utf-8')
        self.assertEqual(Dag(self.root,invoke).execute()['status'],'frozen')
        self.assertEqual([name for name,_ in model.calls],['m1','m2','repair','rereview'])
        prompt=(self.root/'repair/prompt.md').read_text('utf-8')
        self.assertIn('UNASSIGNED_VISIBLE_ARTWORK',prompt)
        self.assertIn('Clarify the observed panel detail in its label.',prompt)
        self.assertIn('Synthetic panel detail requires clarification in the original.',prompt)
        self.assertEqual(read(self.root/'rereview/draft.json')['planEvidenceProtocol'],PROTOCOL_V4)
        verify_run(self.root)

    def test_offline_replay_rejects_protocol_downgrade_and_unbound_v4(self):
        Dag(self.root,FakeModel()).execute()
        folder=self.root/'m2';raw=read(folder/'draft.json');bound=read(folder/'request.json')
        plan=read(self.root/'m1/normalized-plan.json')
        catalog=read(folder/'plan-evidence-catalog.json')
        focus=read(folder/'coverage-small-materials.json')
        schema_path=folder/'schema.json';original=schema_path.read_bytes()
        schema_path.write_text(json.dumps(build_review_schema(catalog,focus,None,PROTOCOL_V3)),encoding='utf-8')
        with self.assertRaisesRegex(ValueError,'REVIEW_EVIDENCE_PROTOCOL_MISMATCH'):
            verify_plan_evidence(folder,raw,bound,plan)
        schema_path.write_bytes(original)
        config_path=self.root/'.dag/config.json';config=read(config_path)
        config.pop('reviewEvidenceProtocol')
        config_path.write_text(json.dumps(config),encoding='utf-8')
        with self.assertRaisesRegex(ValueError,'REVIEW_EVIDENCE_PROTOCOL_MISMATCH'):
            verify_plan_evidence(folder,raw,bound,plan)


if __name__=='__main__':unittest.main()
