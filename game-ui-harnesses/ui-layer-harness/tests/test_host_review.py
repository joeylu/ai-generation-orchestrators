"""Offline host exchange regressions; runner supplies committed shared fixtures."""
import _bootstrap
import copy
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from contextlib import redirect_stderr
import io
from PIL import Image
from ai_ui_layers import host_review, visual_textures as textures
from ai_ui_layers.compile_visual import HARNESS, verify_run
from ai_ui_layers.evaluate import read, digest
from ai_ui_layers.refreeze import freeze_reviewed
from ai_ui_layers.freeze_visual import inspect
from test_planning_dag import coverage, small_audit, small_boundary_audit, bound_review


def save(path, value):
    path.write_text(json.dumps(value,ensure_ascii=False,allow_nan=False),encoding='utf-8')


class HostReviewTests(unittest.TestCase):
    def setUp(self):
        temp=tempfile.TemporaryDirectory();self.addCleanup(temp.cleanup)
        self.base=Path(temp.name);self.reference=self.base/'source.png'
        Image.new('RGB',(1000,1000),(30,40,50)).save(self.reference)
        self.contract=HARNESS/'planning-harness'
        self.plan=read(self.contract/'examples/visual-plan-scoped.json')
        self.plan['unknowns']=[]
        self.candidate=self.base/'candidate.json';save(self.candidate,self.plan)
        self.root=self.base/'run';self.response=self.base/'response.json'
        self.dispatch=self.base/'dispatch.txt';self.dispatch.write_text('Offline fixture review dispatch',encoding='utf-8')
        self.attestation=self.base/'attestation.json'

    def prepare(self, textures_path=None):
        save(self.candidate,self.plan)
        self.prepared=host_review.prepare(self.candidate,self.reference,self.root,self.contract,
                                         seed_author='fixture-author',visual_textures=textures_path,max_calls=16)
        return self.root

    def response_doc(self):
        folder=self.root/'m2'
        review=dict(issues=[],cosmeticIssues=[],coverageAudit=coverage(self.plan),
                    smallMaterialAudit=small_audit(folder))
        boundary=small_boundary_audit(folder)
        if boundary:review['smallBoundaryAudit']=boundary
        review=bound_review(folder,review)
        schema=read(folder/'schema.json')
        if 'visualTextureAudit' in schema['required']:
            review['visualTextureAudit']={'speckles':dict(status='confirmed',materialId='asset-panel',
                objectId='panel',sourceEvidence='Three dark speckles on the panel surface.',
                preservationEvidence='Keep their visible positions and pale surface.')}
        return review

    def receive(self, review=None):
        save(self.response,review or self.response_doc())
        self.write_attestation()
        return host_review.receive(self.root,self.response,self.prepared['requestSha256'],
            response_sha256=digest(self.response),host_attestation=self.attestation,
            dispatch_evidence=self.dispatch,return_evidence=self.response)

    def write_attestation(self):
        save(self.attestation,dict(kind='ui_host_review_attestation_v1',
            requestSha256=self.prepared['requestSha256'],responseSha256=digest(self.response),
            seedSha256=digest(self.root/'m1/draft.json'),candidateAuthors=['fixture-author'],
            reviewerId='fixture-reviewer',hostAssertedModelResponse=True,
            notCryptographicallyPlatformVerified=True,
            dispatchEvidenceSha256=digest(self.dispatch),returnEvidenceSha256=digest(self.response)))

    def freeze(self):
        return freeze_reviewed(self.root,self.base/'frozen',16)

    def test_external_review_freezes_and_inspects_without_provider_receipts(self):
        self.prepare();self.receive();result=self.freeze()
        self.assertEqual(host_review.status(self.root)['status'],'ready_to_freeze')
        snapshot=inspect(self.base/'frozen',result['digest'])
        self.assertEqual(snapshot['planningDriver'],host_review.DRIVER)
        self.assertTrue(snapshot['notProviderReceipt']);self.assertFalse(snapshot['cliSessionAsserted'])
        self.assertFalse(any('transport' in p.name or p.name=='events.jsonl' for p in self.root.rglob('*')))
        self.assertEqual(result['generationCalls'],0)
        self.assertTrue(read(self.root/'m1/seed.json')['originalM1SuccessAsserted'] is False)

    def test_mutated_prepared_sources_reference_request_schema_or_prompt_are_rejected(self):
        self.prepare()
        for name in ('m1/draft.json','m1/reference.png','m2/request.json','m2/schema.json',
                     'm2/prompt.md','.dag/inputs/source-plan.json'):
            with self.subTest(name=name):
                path=self.root/name;original=path.read_bytes();path.write_bytes(original+b' ')
                with self.assertRaises(ValueError):host_review.verify_prepared(self.root)
                path.write_bytes(original)

    def test_wrong_digest_does_not_consume_review_and_duplicate_receive_is_rejected(self):
        self.prepare();save(self.response,self.response_doc())
        self.write_attestation()
        with self.assertRaisesRegex(ValueError,'DIGEST_MISMATCH'):
            host_review.receive(self.root,self.response,'0'*64,host_attestation=self.attestation,
                dispatch_evidence=self.dispatch,return_evidence=self.response)
        self.receive()
        with self.assertRaisesRegex(ValueError,'ALREADY_RECEIVED'):self.receive()
        # A valid draft alone cannot establish model origin or independent review.
        for field,value in [('reviewerId','fixture-author'),('dispatchEvidenceSha256','0'*64),
                            ('hostAssertedModelResponse',False)]:
            with self.subTest(field=field):
                self.root=self.base/field;self.prepare();save(self.response,self.response_doc());self.write_attestation()
                attestation=read(self.attestation);attestation[field]=value;save(self.attestation,attestation)
                with self.assertRaises(ValueError):
                    host_review.receive(self.root,self.response,self.prepared['requestSha256'],
                        host_attestation=self.attestation,dispatch_evidence=self.dispatch,return_evidence=self.response)
                self.assertTrue((self.root/'.dag/receive-failed.json').exists())

    def test_response_change_after_receive_blocks_freeze(self):
        self.prepare();self.receive()
        for name in ('draft.json','host-dispatch-evidence.bin','host-return-evidence.bin'):
            path=self.root/'m2'/name;original=path.read_bytes();path.write_bytes(original+b' ')
            with self.assertRaises(ValueError):self.freeze()
            path.write_bytes(original)

    def test_invalid_coverage_response_is_archived_without_retry(self):
        self.prepare();review=self.response_doc();review['coverageAudit']=review['coverageAudit'][:-1]
        with self.assertRaises(Exception):self.receive(review)
        self.assertTrue((self.root/'.dag/receive-failed.json').exists())
        self.assertTrue((self.root/'m2/draft.json').exists())
        self.assertEqual(host_review.status(self.root)['status'],'review_receive_failed')
        with self.assertRaisesRegex(ValueError,'ALREADY_RECEIVED'):self.receive()
        self.root=self.base/'invalid-json-run';self.prepare()
        self.response.write_text('{"issues":[],"issues":[]}',encoding='utf-8');self.write_attestation()
        with self.assertRaisesRegex(ValueError,'DUPLICATE_JSON_KEY'):
            host_review.receive(self.root,self.response,self.prepared['requestSha256'],
                host_attestation=self.attestation,dispatch_evidence=self.dispatch,return_evidence=self.response)
        self.assertEqual(host_review.status(self.root)['status'],'review_receive_failed')

    def test_unknown_issue_id_is_rejected(self):
        self.prepare();review=self.response_doc()
        review['issues']=[dict(code='missing_detail',category='semantic',ids=['nonexistent'],
            description='Unknown owner',suggestedChange='Identify the real owner.')]
        with self.assertRaises(Exception):self.receive(review)

    def test_unknowns_are_reviewable_but_block_freeze(self):
        self.plan['unknowns']=['Uncertain visible panel ownership.'];self.prepare();self.receive()
        self.assertEqual(host_review.status(self.root)['status'],'review_blocked')
        with self.assertRaisesRegex(ValueError,'UNRESOLVED_UNKNOWNS'):self.freeze()

    def test_clipped_boundary_remains_a_blocker(self):
        self.prepare();review=self.response_doc()
        first=next(iter(review['smallMaterialAudit'].values()))
        first['boundary']['status']='uncertain';first['boundary']['evidence']='Visible contour remains uncertain.'
        result=self.receive(review);self.assertTrue(result['blockers'])
        with self.assertRaisesRegex(ValueError,'M2_UNRESOLVED'):self.freeze()

    def test_real_occlusion_is_not_cleared_by_empty_issues(self):
        material=copy.deepcopy(self.plan['materials'][1]);material['id']='asset-overlap'
        material['preserveText']=[];self.plan['materials'].append(material)
        obj=copy.deepcopy(self.plan['objects'][1]);obj['id']='overlap-object';obj['materialId']=material['id']
        self.plan['objects'].append(obj);self.prepare();review=self.response_doc()
        catalog=read(self.root/'m2/relation-catalog.json');self.assertTrue(catalog['pairs'])
        review['relationReview']=dict(catalogDigest=catalog['digest'],candidateDigest=catalog['candidateDigest'],
            referenceSha256=catalog['referenceSha256'],pairs={row['pairId']:dict(
            disposition='real-occlusion',sourceEvidence='Two solid surfaces overlap in the source.',
            ownershipEvidence='Both surfaces are separately owned.') for row in catalog['pairs']})
        result=self.receive(review);self.assertTrue(result['relationBlockers'])
        with self.assertRaisesRegex(ValueError,'M2_UNRESOLVED'):self.freeze()

    def test_texture_review_is_required_and_valid_full_review_can_freeze(self):
        next(row for row in self.plan['objects'] if row['id']=='panel')['bboxNorm']=[.1,.05,.9,.9]
        doc=dict(kind=textures.KIND,referenceSha256=digest(self.reference),canvas=[1000,1000],regions=[dict(
            id='speckles',sourceBox=[200,200,230,210],appearance='Three short dark speckles.',
            protectedArtwork='Pale panel surface around the speckles.')])
        path=self.base/'textures.json';save(path,doc);self.prepare(path)
        review=self.response_doc();self.assertIn('visualTextureAudit',review)
        # Missing texture review never receives a successful status.
        omitted=copy.deepcopy(review);del omitted['visualTextureAudit']
        with self.assertRaises(Exception):self.receive(omitted)
        self.assertTrue((self.root/'.dag/receive-failed.json').exists())
        self.root=self.base/'complete-texture-run';self.prepare(path)
        self.receive();self.freeze();self.assertIn('visualTexturePolicy',inspect(self.base/'frozen'))

    def test_cli_gate_still_requires_original_result_and_receipts(self):
        from ai_ui_layers.delivery_dag import main
        for flag,value in (('--planning-model','example-model'),('--context-prompt-version','v1'),
                           ('--generation-mode','single')):
            target=self.base/'invalid-cli-output'
            with patch('sys.argv',['ui_layer.py','prepare-host-review','--output',str(target),flag,value]):
                with redirect_stderr(io.StringIO()),self.assertRaises(SystemExit) as error:main()
                self.assertEqual(error.exception.code,2);self.assertFalse(target.exists())
        self.prepare();self.receive()
        config=read(self.root/'.dag/config.json');del config['planningDriver']
        save(self.root/'.dag/config.json',config)
        save(self.root/'.dag/config-digest.json',dict(sha256=digest(self.root/'.dag/config.json')))
        with self.assertRaises(Exception):verify_run(self.root)

    def test_changed_active_runtime_requires_a_fresh_run(self):
        self.prepare();self.receive()
        changed=host_review.runtime_files();key=next(iter(changed));changed[key]='0'*64
        with patch.object(host_review,'runtime_files',return_value=changed):
            with self.assertRaisesRegex(ValueError,'RUNTIME_CHANGED'):self.freeze()
        contract=self.base/'weak-contract'
        for name in host_review.CONTRACT_DIGESTS:
            path=contract/name;path.parent.mkdir(parents=True,exist_ok=True)
            path.write_bytes((self.contract/name).read_bytes())
        (contract/'schemas/visual-plan.schema.json').write_text('{}',encoding='utf-8')
        with self.assertRaisesRegex(ValueError,'CONTRACT_NOT_SUPPORTED'):
            host_review.prepare(self.candidate,self.reference,self.base/'weak-run',contract,seed_author='fixture-author')
        self.assertFalse((self.base/'weak-run').exists())


if __name__=='__main__':unittest.main()
