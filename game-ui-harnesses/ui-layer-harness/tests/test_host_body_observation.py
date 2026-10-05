"""Offline host fixtures; no platform, CLI, image generation or model calls."""
import _bootstrap
import unittest
import hashlib
from pathlib import Path
from PIL import Image, ImageDraw

import test_body_observation
from ai_ui_layers import host_body_observation as host
from ai_ui_layers.evaluate import save, read, digest
from ai_ui_layers.freeze_visual import body_digest


class HostBodyObservationTests(unittest.TestCase):
    def setUp(self):
        test_body_observation.BodyObservationTests.setUp(self)
        config = read(self.inputs)
        config['materialAuthors'] = ['fixture-author']
        self.inputs.unlink()
        save(self.inputs, config)

    def start(self):
        current = host.prepare(self.inputs, self.job, 5)
        host.authorize(self.job, current['jobDigest'], 'explicit fixture observation approval')
        return host.next_request(self.job)

    def evidence(self, request, *, answer=None, reviewer='fixture-reviewer'):
        folder = self.root / ('return-' + request['materialId'])
        folder.mkdir()
        save(folder / 'response.json', answer or self.answer)
        (folder / 'dispatch.bin').write_bytes(b'fixture independent host dispatch ' + request['requestSha256'].encode())
        (folder / 'return.bin').write_bytes(b'fixture unmodified host return ' + (folder / 'response.json').read_bytes())
        save(folder / 'attestation.json', dict(kind='ui_host_body_attestation_v1', requestSha256=request['requestSha256'],
            submissionDigest=request['submissionDigest'], responseSha256=digest(folder / 'response.json'),
            inputsSha256=request['inputsSha256'], model=request['model'], effort=request['effort'], independentCall=True,
            reviewerId=reviewer, materialAuthors=request['materialAuthors'], hostAssertedModelResponse=True,
            notProviderReceipt=True, notCryptographicallyPlatformVerified=True,
            dispatchEvidenceSha256=digest(folder / 'dispatch.bin'), returnEvidenceSha256=digest(folder / 'return.bin')))
        return folder

    def receive(self, request, folder):
        return host.receive(self.job, request['submissionDigest'], folder / 'response.json',
            host_attestation_path=folder / 'attestation.json', dispatch_evidence_path=folder / 'dispatch.bin',
            return_evidence_path=folder / 'return.bin')

    def test_bound_authorization_model_budget_and_serial_reservation(self):
        current = host.prepare(self.inputs, self.job, 5)
        self.assertEqual(current['model'], 'gpt-6.1-sol')
        self.assertEqual(current['effort'], 'medium')
        self.assertEqual(current['assignedCalls'], 0)
        self.assertEqual(current['configuredMaximumCalls'], 5)
        with self.assertRaisesRegex(ValueError, 'BODY_NOT_READY_NO_RESUBMIT'):
            host.next_request(self.job)
        with self.assertRaisesRegex(ValueError, 'EXPLICIT_BOUND_BODY_APPROVAL_REQUIRED'):
            host.authorize(self.job, '0' * 64, 'yes')
        host.authorize(self.job, current['jobDigest'], 'fixture yes')
        request = host.next_request(self.job)
        self.assertTrue(request['submissionDigest'])
        with self.assertRaisesRegex(ValueError, 'BODY_NOT_READY_NO_RESUBMIT'):
            host.next_request(self.job)
        self.assertEqual(host.status(self.job)['assignedCalls'], 1)

    def test_all_sealed_original_responses_finish_and_replay(self):
        request = self.start()
        count = 0
        while request is not None:
            folder = self.evidence(request)
            self.receive(request, folder)
            copied = self.job / 'attempts' / request['materialId'] / 'response.json'
            self.assertEqual(copied.read_bytes(), (folder / 'response.json').read_bytes())
            count += 1
            request = host.next_request(self.job)
        result = host.finish(self.job, self.output_config)
        self.assertEqual(result['status'], 'completed')
        self.assertEqual(result['sealedCalls'], count)
        self.assertFalse(result['humanVisualAcceptance'])
        config = read(self.output_config)
        self.assertEqual(len(config['wholePlacements']), count)
        response = next((self.job / 'attempts').glob('*/response.json'))
        response.write_bytes(response.read_bytes() + b' ')
        with self.assertRaisesRegex(ValueError, 'BODY_SEALED_EVIDENCE_CHANGED'):
            host.status(self.job)

    def test_uncertain_is_terminal_and_not_repaired(self):
        request = self.start()
        answer = dict(self.answer, boundaryStatus='uncertain', sourceBodyBox=None,
                      referenceCropBodyBox=None, issues=['reference occluded'])
        folder = self.evidence(request, answer=answer)
        with self.assertRaisesRegex(ValueError, 'BODY_OBSERVATION_UNRESOLVED'):
            self.receive(request, folder)
        self.assertEqual(host.status(self.job)['status'], 'blocked_no_retry')
        with self.assertRaisesRegex(ValueError, 'NO_RETRY'):
            self.receive(request, folder)
        with self.assertRaisesRegex(ValueError, 'NO_RESUBMIT'):
            host.next_request(self.job)

    def test_reviewer_author_collision_and_tampered_hash_fail_consumed(self):
        for mutation in ('collision', 'tamper'):
            with self.subTest(mutation=mutation):
                # Fresh immutable job and authorization for each fixture.
                self.job = self.root / ('job-' + mutation)
                request = self.start()
                folder = self.evidence(request, reviewer='fixture-author' if mutation == 'collision' else 'fixture-reviewer')
                if mutation == 'tamper':
                    (folder / 'response.json').write_bytes((folder / 'response.json').read_bytes() + b' ')
                with self.assertRaisesRegex(ValueError, 'INDEPENDENT_BODY_REVIEWER|ATTESTATION_BINDING'):
                    self.receive(request, folder)
                self.assertEqual(host.status(self.job)['status'], 'blocked_no_retry')
                with self.assertRaisesRegex(ValueError, 'NO_RESUBMIT'):
                    host.next_request(self.job)
                # Avoid same external evidence directory on the next subtest.
                folder.rename(folder.with_name(folder.name + '-' + mutation))

    def test_unknown_dispatch_consumes_budget_and_forbids_retry(self):
        request = self.start()
        host.fail(self.job, request['submissionDigest'], 'host accepted request; return indeterminate')
        state = host.status(self.job)
        self.assertEqual(state['assignedCalls'], 1)
        self.assertEqual(state['status'], 'blocked_no_retry')
        with self.assertRaisesRegex(ValueError, 'NO_RETRY'):
            host.fail(self.job, request['submissionDigest'], 'retry')
        with self.assertRaisesRegex(ValueError, 'ALL_GENUINE_BODY_RESPONSES_REQUIRED'):
            host.finish(self.job, self.output_config)

    def test_dense_artwork_gate_is_preserved(self):
        request = self.start()
        answer = dict(self.answer, sourceBodyBox=[12, 12, 18, 18], referenceCropBodyBox=[12, 12, 18, 18])
        with self.assertRaisesRegex(ValueError, 'SOURCE_BODY_OMITS_DENSE_ARTWORK'):
            self.receive(request, self.evidence(request, answer=answer))
        self.assertEqual(host.status(self.job)['status'], 'blocked_no_retry')

    def test_inputs_change_before_dispatch_and_partial_finish_rejected(self):
        request = self.start()
        with self.assertRaisesRegex(ValueError, 'ALL_GENUINE_BODY_RESPONSES_REQUIRED'):
            host.finish(self.job, self.output_config)
        image = Path(request['inputDirectory']) / 'reference-crop.png'
        image.write_bytes(image.read_bytes() + b'x')
        with self.assertRaisesRegex(ValueError, 'BODY_REQUEST_CHANGED'):
            host.load(self.job)

    def test_approved_expanded_policy_preserves_far_faint_alpha_and_bound_instruction(self):
        config = read(self.inputs)
        instruction = 'Store complete nonzero alpha; display at original reference viewport.'
        config.update(canvasPolicy=host.EXPANDED_POLICY, canvasPolicyInstruction=instruction,
                      canvasPolicyInstructionSha256=hashlib.sha256(instruction.encode('utf-8')).hexdigest())
        self.inputs.unlink()
        save(self.inputs, config)
        material = next(m['id'] for m in self.visual['materials'] if m['role'] == 'foreground')
        source = Path(config['materials'][material])
        image = Image.new('RGBA', (1400, 30))
        ImageDraw.Draw(image).rectangle((10, 10, 19, 19), fill=(100, 80, 60, 255))
        image.putpixel((1390, 10), (50, 30, 20, 1))
        image.save(source)
        request = self.start()
        while request is not None:
            self.receive(request, self.evidence(request))
            request = host.next_request(self.job)
        host.finish(self.job, self.output_config)
        output = read(self.output_config)
        self.assertEqual(output['canvasPolicyInstruction'], instruction)
        self.assertEqual(output['canvasPolicyInstructionSha256'], config['canvasPolicyInstructionSha256'])
        self.assertEqual(output['canvasPolicy'], host.EXPANDED_POLICY)
        self.assertEqual(digest(source), host.load(self.job)['sourceHashes'][material])

    def test_complete_with_material_issue_remains_blocked_under_strict_body_schema(self):
        request = self.start()
        with self.assertRaisesRegex(ValueError, 'BODY_OBSERVATION_UNRESOLVED'):
            self.receive(request, self.evidence(request, answer=dict(self.answer, issues=['incomplete body'])))
        self.assertEqual(host.status(self.job)['status'], 'blocked_no_retry')

    def test_explicit_policy_override_cannot_change_bound_input_policy(self):
        config = read(self.inputs)
        instruction = 'Complete alpha storage with original viewport.'
        config.update(canvasPolicy=host.EXPANDED_POLICY, canvasPolicyInstruction=instruction,
                      canvasPolicyInstructionSha256=hashlib.sha256(instruction.encode('utf-8')).hexdigest())
        self.inputs.unlink()
        save(self.inputs, config)
        with self.assertRaisesRegex(ValueError, 'BODY_CANVAS_POLICY_OVERRIDE_CONFLICT'):
            host.prepare(self.inputs, self.job, 5, canvas_policy=host.body.CANVAS_POLICY)
        self.assertFalse(self.job.exists())


if __name__ == '__main__':
    unittest.main()
