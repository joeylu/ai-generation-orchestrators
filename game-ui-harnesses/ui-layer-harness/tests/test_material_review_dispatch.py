"""Offline dispatch and bounded scheduling; never calls a model or image tool."""
import _bootstrap
import io
import json
from contextlib import redirect_stdout
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from PIL import Image

from ai_ui_layers import material_review_dispatch as dispatch, host_delivery as host
from ai_ui_layers import host_material_review as material
from ai_ui_layers.evaluate import read, save, digest
import test_host_sheet_fallback as fixtures
import test_host_material_review as evidence_fixtures


class DispatchPacketTests(unittest.TestCase):
    def setUp(self):
        temporary=tempfile.TemporaryDirectory();self.addCleanup(temporary.cleanup)
        self.folder=Path(temporary.name)
        for name in ('reference.png','generated.png','detail-compare.png'):
            Image.new('RGBA',(16,16),(80,90,100,255)).save(self.folder/name)
        (self.folder/'prompt.md').write_text('Exact frozen visual rules and object catalog.',encoding='utf-8')
        save(self.folder/'schema.json',dict(type='object',required=['ownershipObservations']))
        save(self.folder/'observation-mapping.json',dict(reference=dict(scale=1)))
        self.inputs={p.name:digest(p) for p in self.folder.iterdir()}

    def test_packet_inlines_exact_contract_and_orders_all_images(self):
        extra=self.folder/'native-proposal.png';Image.new('RGB',(16,16)).save(extra)
        self.inputs[extra.name]=digest(extra)
        self.inputs[dispatch.NAME]=dispatch.prepare(self.folder,'request-a',['owner-a'],self.inputs)
        dispatch.verify(self.folder,'request-a',['owner-a'],self.inputs)
        packet=read(self.folder/dispatch.NAME)
        self.assertEqual(packet['prompt'],(self.folder/'prompt.md').read_text('utf-8'))
        self.assertEqual(packet['responseSchema'],read(self.folder/'schema.json'))
        self.assertEqual([row['file'] for row in packet['images']],
            ['reference.png','generated.png','detail-compare.png','native-proposal.png'])
        self.assertEqual([row['imageNumber'] for row in packet['images']],[1,2,3,4])
        self.assertNotIn(dispatch.NAME,packet['sourceInputs'])
        self.assertEqual(packet['imageMetadata']['observation-mapping.json'],read(self.folder/'observation-mapping.json'))
        self.assertFalse(packet['visualAcceptanceAsserted'])

    def test_changed_attachment_and_changed_packet_cannot_replay(self):
        self.inputs[dispatch.NAME]=dispatch.prepare(self.folder,'request-a',['owner-a'],self.inputs)
        image=self.folder/'generated.png';image.write_bytes(image.read_bytes()+b'changed')
        with self.assertRaisesRegex(ValueError,'PACKET_INPUT_CHANGED'):
            dispatch.verify(self.folder,'request-a',['owner-a'],self.inputs)
        self.inputs['generated.png']=digest(image)
        with self.assertRaisesRegex(ValueError,'PACKET_BINDING_CHANGED'):
            dispatch.verify(self.folder,'request-a',['owner-a'],self.inputs)
        packet=read(self.folder/dispatch.NAME);packet['assignedMaterialIds']=[]
        (self.folder/dispatch.NAME).write_text(json.dumps(packet),encoding='utf-8')
        with self.assertRaisesRegex(ValueError,'PACKET_CHANGED'):
            dispatch.verify(self.folder,'request-a',['owner-a'],self.inputs)

    def test_missing_image_or_unsafe_attachment_is_rejected(self):
        inputs=dict(self.inputs);inputs.pop('detail-compare.png')
        with self.assertRaisesRegex(ValueError,'IMAGES_REQUIRED'):
            dispatch.prepare(self.folder,'request-a',['owner-a'],inputs)
        inputs=dict(self.inputs,**{'../outside.json':'0'*64})
        with self.assertRaisesRegex(ValueError,'PATH_INVALID'):
            dispatch.prepare(self.folder,'request-a',['owner-a'],inputs)

    def test_new_defaults_and_invalid_config_before_any_compute(self):
        for fast,limit in ((False,1),(True,3)):
            config={};dispatch.configure(config,fast=fast)
            self.assertEqual(config['maximumConcurrentMaterialReviews'],limit)
            self.assertEqual(config['materialReviewDispatchPolicy'],dispatch.POLICY)
        for limit in (True,False,0,5,-1,1.5,'3',None):
            with self.subTest(limit=limit),self.assertRaisesRegex(ValueError,'CONCURRENCY_REQUIRED'):
                dispatch.configure(dict(maximumConcurrentMaterialReviews=limit))
        for policy in ('unknown',None):
            with self.assertRaisesRegex(ValueError,'POLICY_UNSUPPORTED'):
                dispatch.configure(dict(materialReviewDispatchPolicy=policy))
        config=dict(maximumConcurrentMaterialReviews=1,materialReviewDispatchPolicy=dispatch.LEGACY)
        dispatch.configure(config,fast=True)
        self.assertEqual(config['materialReviewDispatchPolicy'],dispatch.LEGACY)
        self.assertEqual(config['maximumConcurrentMaterialReviews'],1)

    def test_historical_scope_is_serial_and_pending_is_never_ready_again(self):
        rows=[dict(requestId=key) for key in ('a','b','c','d')]
        pending,outstanding,ready,slots=dispatch.availability({},rows,set(),{'a'})
        self.assertEqual(slots,0);self.assertEqual([row['requestId'] for row in ready],['b','c','d'])
        pending,outstanding,ready,slots=dispatch.availability(dict(maximumConcurrentCalls=3),rows,{'b'},{'a','b'})
        self.assertEqual(slots,2);self.assertEqual([row['requestId'] for row in ready],['c','d'])
        self.assertEqual([row['requestId'] for row in outstanding],['a'])
        self.assertEqual([row['requestId'] for row in pending],['a','c','d'])


class HostReviewSchedulingTests(unittest.TestCase):
    setUp=fixtures.HostSheetFallbackTests.setUp
    prepare=fixtures.HostSheetFallbackTests.prepare
    acquire=fixtures.HostSheetFallbackTests.acquire

    def receive(self, reservation):
        key=reservation['currentRequest']['requestId'];folder=self.run/'reviews'/key
        evidence=evidence_fixtures.HostEvidence.response(self,folder)
        original=evidence['response'].read_bytes()
        host.receive(self.run,reservation['submissionDigest'],evidence['response'],
            host_attestation=evidence['host_attestation'],dispatch_evidence=evidence['dispatch_evidence'],
            return_evidence=evidence['return_evidence'])
        self.assertEqual((folder/'review/draft.json').read_bytes(),original)
        material.verify_run(folder)

    def test_batch_reservation_out_of_order_receipt_and_complete_warning_delivery(self):
        self.prepare();self.acquire(False);self.root=self.base
        current=host.status(self.run)
        self.assertEqual(read(self.run/'config.json')['maximumConcurrentMaterialReviews'],3)
        scope=read(Path(current['scopeDirectory'])/'scope.json')
        self.assertGreaterEqual(len(scope['requests']),3)
        for row in scope['requests']:
            folder=Path(row['requestDirectory']);nested=read(folder/'request.json')
            self.assertEqual(row['reviewPacketSha256'],digest(Path(row['reviewPacketPath'])))
            self.assertEqual(nested['inputs'][dispatch.NAME],row['reviewPacketSha256'])
            packet=read(folder/dispatch.NAME)
            self.assertEqual(packet['prompt'],(folder/'prompt.md').read_text('utf-8'))
            self.assertEqual(packet['responseSchema'],read(folder/'schema.json'))
            material.verify_prepared(folder.parent)
        with self.assertRaisesRegex(ValueError,'AUTHORIZATION_REQUIRED'):host.next_request(self.run,count=3)
        host.authorize(self.run,current['scopeDigest'],'Offline review fixtures only')
        before=host._files(self.run)
        with self.assertRaisesRegex(ValueError,'CONCURRENCY_LIMIT'):host.next_request(self.run,count=4)
        self.assertEqual(host._files(self.run),before)
        stdout=io.StringIO()
        with patch('sys.argv',['ui_layer.py','host-next','--run',str(self.run),'--count','3']),redirect_stdout(stdout):host.main()
        batch=json.loads(stdout.getvalue());reservations=batch['reservations']
        keys={row['currentRequest']['requestId'] for row in reservations}
        self.assertEqual(len(keys),3)
        self.assertEqual(host.status(self.run)['status'],'awaiting_result')
        self.assertEqual(host.status(self.run)['availableReviewSlots'],0)
        before=host._files(self.run)
        with self.assertRaisesRegex(ValueError,'NO_RESUBMIT'):host.next_request(self.run)
        self.assertEqual(host._files(self.run),before)
        # Receive a later dispatch first; only that reservation frees a slot.
        self.receive(reservations.pop(1))
        current=host.status(self.run)
        if current['unreservedRequestCount']:
            self.assertEqual(current['status'],'ready');self.assertEqual(current['availableReviewSlots'],1)
            extra=host.next_request(self.run)
            self.assertNotIn(extra['currentRequest']['requestId'],keys)
            keys.add(extra['currentRequest']['requestId']);reservations.append(extra)
        for reservation in reversed(reservations):self.receive(reservation)
        while host.status(self.run)['stage']=='material_review':
            batch=host.next_request(self.run,count=3)
            self.assertLessEqual(len(batch['reservations']),3)
            for reservation in batch['reservations']:
                self.assertNotIn(reservation['currentRequest']['requestId'],keys)
                keys.add(reservation['currentRequest']['requestId']);self.receive(reservation)
        self.assertEqual(len(keys),scope['maximumCalls'])
        self.assertEqual(host.status(self.run)['status'],'diagnostic_complete_pending_visual_acceptance')
        self.assertFalse(host.status(self.run)['humanVisualAcceptance'])
        self.assertFalse((self.run/'body').exists())

    def test_one_unknown_parallel_result_stops_new_dispatch_without_retry(self):
        self.prepare();self.acquire(False)
        host.authorize(self.run,host.status(self.run)['scopeDigest'],'Offline review fixtures only')
        batch=host.next_request(self.run,count=3)
        folder=self.run/'scopes/material_review'
        submissions={p.name:p.read_bytes() for p in folder.glob('*-submission.json')}
        host.fail(self.run,batch['reservations'][1]['submissionDigest'],'Unknown host acceptance')
        self.assertEqual(host.status(self.run)['status'],'failed_no_retry')
        with self.assertRaisesRegex(ValueError,'NO_NEXT'):host.next_request(self.run)
        self.assertEqual(submissions,{p.name:p.read_bytes() for p in folder.glob('*-submission.json')})

    def test_explicit_serial_still_refuses_a_second_pending_reservation(self):
        self.prepare(maximumConcurrentMaterialReviews=1,materialReviewDispatchPolicy=dispatch.LEGACY)
        self.acquire(False)
        host.authorize(self.run,host.status(self.run)['scopeDigest'],'Offline serial fixtures only')
        reservation=host.next_request(self.run)
        self.assertNotIn('reviewPacketPath',reservation['currentRequest'])
        with self.assertRaisesRegex(ValueError,'NO_RESUBMIT'):host.next_request(self.run)


if __name__=='__main__':unittest.main()
