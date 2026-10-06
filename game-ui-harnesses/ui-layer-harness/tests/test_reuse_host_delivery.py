"""Complete prototype fixture workflows; no provider/model/CLI is invoked."""
import _bootstrap
import copy
from pathlib import Path
import unittest
from ai_ui_layers import host_delivery as host, host_review, experimental_executor as exchange
from ai_ui_layers import material_reuse as reuse
from ai_ui_layers.evaluate import read,save,digest
from ai_ui_layers.execution_preflight import preflight
from ai_ui_layers.host_material_review import verify_prepared
from test_host_delivery import HostDeliveryTests
import test_host_review as review_fixtures


class ReusedDeliveryTests(unittest.TestCase):
    sheet=False
    def setUp(self):
        HostDeliveryTests.setUp(self)
        for obj in self.plan['objects']:
            if obj['materialId'] in ('asset-coin-a','asset-coin-b'):
                obj['kind']='badge';obj['bboxNorm']=None
        if self.sheet:
            mat=copy.deepcopy(next(m for m in self.plan['materials'] if m['id']=='asset-coin-a'))
            mat.update(id='asset-coin-c',bboxNorm=[.7,.55,.75,.6]);self.plan['materials'].append(mat)
            self.plan['objects'].append(dict(id='coin-c',kind='badge',bboxNorm=None,materialId='asset-coin-c',label='Third independent fixture badge'))
        review_fixtures.save(self.candidate,self.plan)
        self.reuse_doc=dict(kind=reuse.KIND,referenceSha256=digest(self.reference),sourcePlanSha256=digest(self.candidate),
            groups=[dict(prototypeMaterialId='asset-coin-a',instanceMaterialIds=['asset-coin-b'],
                evidence='Explicit same-state fixture badge at a separate original position.')])
        reuse_path=self.base/'reuse.json';save(reuse_path,self.reuse_doc)
        config=read(self.config_path);config['materialReuse']=str(reuse_path)
        review_fixtures.save(self.config_path,config);self.run=self.base/'reused-integrated'
        host.prepare(self.config_path,self.run);self.root=self.run/'planning'

    def planning(self,equivalent=True):
        current=host.status(self.run);host.authorize(self.run,current['scopeDigest'],'Offline fixture review only')
        request=host.next_request(self.run)
        answer=review_fixtures.HostReviewTests.response_doc(self)
        answer['reuseAudit']=[dict(prototypeMaterialId='asset-coin-a',instanceMaterialIds=['asset-coin-b'],
            equivalent=equivalent,evidence='Offline independent same-state fixture observation.')]
        save(self.response,answer);self.prepared={'requestSha256':request['requestSha256']}
        review_fixtures.HostReviewTests.write_attestation(self)
        return host.receive(self.run,request['submissionDigest'],self.response,host_attestation=self.attestation,
            dispatch_evidence=self.dispatch,return_evidence=self.response)

    def test_complete_reused_workflow_all_layers_body_and_portable_lineage(self):
        HostDeliveryTests.test_complete_sheet_workflow_separate_scopes_and_delivered_comparison(self)
        snapshot=self.run/'frozen';manifest=read(snapshot/'snapshot.json')
        self.assertEqual(manifest['materialCount'],len(self.plan['materials']))
        self.assertEqual(manifest['generatedMaterialCount'],len(self.plan['materials'])-1)
        preflight(snapshot,manifest['digest'])
        acquired=read(self.run/'images/job.json')
        self.assertEqual(acquired['materialCount'],len(self.plan['materials']))
        self.assertEqual(acquired['generatedMaterialCount'],len(self.plan['materials'])-1)
        self.assertNotIn('asset-coin-b',acquired['assets'])
        extraction=read(self.run/'extraction/result.json')
        self.assertEqual(digest(Path(extraction['materials']['asset-coin-a'])),digest(Path(extraction['materials']['asset-coin-b'])))
        proof=read(self.run/'delivery/body-provenance.json')
        by_id={r['materialId']:r for r in proof['records']}
        self.assertIn('materialReuse',by_id['asset-coin-b'])
        self.assertEqual(by_id['asset-coin-b']['materialReuse']['prototypeMaterialId'],'asset-coin-a')
        self.assertNotIn('jobDigest',by_id['asset-coin-b']['materialReuse'])
        self.assertNotIn('submissionDigest',by_id['asset-coin-b']['materialReuse'])
        self.assertNotEqual(by_id['asset-coin-a']['bodyContract']['targetBodyBox'],by_id['asset-coin-b']['bodyContract']['targetBodyBox'])
        self.assertEqual(read(self.run/'body/job.json')['maximumCalls'],len(self.plan['materials'])-1)
        self.assertEqual(len(read(self.run/'delivery/package/composition.json')['layers']),len(self.plan['materials']))
        key=next(k for k in acquired['assets'] if 'asset-coin-b' in read(self.run/'reviews'/k/'request.json')['materialIds'])
        folder=self.run/'reviews'/key;alias=Path(read(folder/'extraction-candidate.json')['materials']['asset-coin-b'])
        data=alias.read_bytes();alias.write_bytes(data+b'changed instance')
        with self.assertRaisesRegex(ValueError,'CHANGED'):verify_prepared(folder)
        alias.write_bytes(data)

    def test_equivalence_rejection_is_terminal_before_image_scope(self):
        with self.assertRaisesRegex(ValueError,'REUSE_EQUIVALENCE_NOT_CONFIRMED'):self.planning(False)
        self.assertEqual(host.status(self.run)['status'],'failed_no_retry')
        self.assertFalse((self.run/'images').exists())


class ReusedSheetDeliveryTests(ReusedDeliveryTests):
    sheet=True


if __name__=='__main__':unittest.main()
