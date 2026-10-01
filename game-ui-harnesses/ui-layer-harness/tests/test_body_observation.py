import _bootstrap
import copy
import json
import unittest
from pathlib import Path
from unittest.mock import patch

from PIL import Image, ImageDraw

import test_compile_visual
from ai_ui_layers import body_observation as body
from ai_ui_layers.automatic_registration import run as register
from ai_ui_layers.evaluate import digest, read, save
from ai_ui_layers.freeze_visual import freeze

SID = '12345678-1234-1234-1234-123456789abc'


class BodyObservationTests(unittest.TestCase):
    def setUp(self):
        test_compile_visual.VisualCompileTests.setUp(self)
        self.snapshot = self.root / 'snapshot'
        frozen = freeze(self.run, self.snapshot, 5)
        self.inputs = self.root / 'materials.json'
        paths = {}
        for material in self.visual['materials']:
            key = material['id']
            path = self.root / (key + '.png')
            image = Image.new('RGBA', (30, 30))
            if material['role'] == 'background':
                image = Image.new('RGBA', (1000, 1000), (10, 20, 30, 255))
            else:
                ImageDraw.Draw(image).rectangle((10, 10, 19, 19), fill=(100, 80, 60, 255))
                image.putpixel((1, 10), (50, 30, 20, 1))
            image.save(path)
            paths[key] = str(path)
        save(self.inputs, dict(snapshot=str(self.snapshot), snapshotDigest=frozen['digest'], materials=paths))
        self.job = self.root / 'job'
        self.output_config = self.root / 'body-config.json'
        self.calls = []
        self.answer = dict(boundaryStatus='complete', sourceBodyBox=[10, 10, 20, 20],
                           referenceCropBodyBox=[10, 10, 20, 20],
                           evidence='Fixture complete corresponding whole body; no external shadow in anchor.', issues=[])

    def prepare(self):
        return body.prepare(self.inputs, self.job, 5)

    def authorize(self):
        current = self.prepare()
        body.authorize(self.job, current['jobDigest'], 'fixture only: explicit body observation scope')

    def model(self, folder, sid, first):
        self.calls.append((folder.name, sid, first))
        save(folder / 'draft.json', self.answer)
        (folder / 'events.jsonl').write_text(json.dumps({'type': 'thread.started', 'thread_id': SID}) + '\n', encoding='utf-8')
        return dict(exitCode=0, turnCompleted=True, unexpectedEvents=[],
                    responseSha256=digest(folder / 'draft.json'))

    def test_prepare_and_authorization_do_not_call_model_and_digest_is_specific(self):
        current = self.prepare()
        self.assertEqual(current['status'], 'awaiting_body_authorization')
        self.assertEqual(current['assignedCalls'], 0)
        with self.assertRaisesRegex(ValueError, 'BODY_NOT_READY_NO_RESUBMIT'):
            body.execute(self.job, self.output_config, self.model)
        self.assertEqual(self.calls, [])
        for job_digest, approval in (('0'*64, 'yes'), (current['jobDigest'], '')):
            with self.assertRaisesRegex(ValueError, 'EXPLICIT_BOUND_BODY_APPROVAL_REQUIRED'):
                body.authorize(self.job, job_digest, approval)
        body.authorize(self.job, current['jobDigest'], 'fixture approval')
        with self.assertRaisesRegex(ValueError, 'BODY_AUTHORIZATION_ALREADY_USED'):
            body.authorize(self.job, current['jobDigest'], 'duplicate')

    def test_success_freezes_complete_contracts_reuses_one_session_and_registers(self):
        self.authorize()
        result = body.execute(self.job, self.output_config, self.model)
        self.assertEqual(result['status'], 'completed')
        self.assertEqual(result['assignedCalls'], result['maximumCalls'])
        self.assertTrue(self.calls[0][2])
        self.assertTrue(all(sid == SID and not first for _, sid, first in self.calls[1:]))
        config = read(self.output_config)
        self.assertEqual(config['registrationPolicy'], body.SUPPORT_POLICY)
        self.assertEqual(set(config['wholePlacements']), set(read(self.job / 'job.json')['requests']))
        result = register(self.output_config, self.root / 'registered',
                          model_call=lambda _: self.fail('must not localize again'))
        self.assertEqual(result['modelCalls'], 0)
        self.assertFalse(result['humanVisualAcceptance'])
        calls = len(self.calls)
        with self.assertRaisesRegex(ValueError, 'BODY_NOT_READY_NO_RESUBMIT'):
            body.execute(self.job, self.root / 'retry.json', self.model)
        self.assertEqual(len(self.calls), calls)

    def test_uncertain_observation_stops_first_call_without_repair(self):
        self.authorize()
        self.answer.update(boundaryStatus='uncertain', sourceBodyBox=None, referenceCropBodyBox=None,
                           issues=['occluded reference edge'])
        with self.assertRaisesRegex(ValueError, 'BODY_OBSERVATION_UNRESOLVED'):
            body.execute(self.job, self.output_config, self.model)
        self.assertEqual(len(self.calls), 1)
        self.assertFalse(self.output_config.exists())
        self.assertEqual(body.status(self.job)['status'], 'blocked_no_retry')

    def test_invalid_dense_anchor_stops_before_next_model_call(self):
        self.authorize()
        self.answer['sourceBodyBox'] = [12, 12, 18, 18]
        self.answer['referenceCropBodyBox'] = [12, 12, 18, 18]
        with self.assertRaisesRegex(ValueError, 'SOURCE_BODY_OMITS_DENSE_ARTWORK'):
            body.execute(self.job, self.output_config, self.model)
        self.assertEqual(len(self.calls), 1)
        self.assertEqual(body.status(self.job)['status'], 'blocked_no_retry')

    def test_uncertain_transport_reserves_once_and_cannot_be_retried(self):
        self.authorize()
        def timeout(folder, sid, first):
            self.calls.append(folder.name)
            raise TimeoutError('fixture indeterminate transport')
        with self.assertRaises(TimeoutError):
            body.execute(self.job, self.output_config, timeout)
        with self.assertRaisesRegex(ValueError, 'BODY_NOT_READY_NO_RESUBMIT'):
            body.execute(self.job, self.output_config, self.model)
        self.assertEqual(len(self.calls), 1)
        self.assertEqual(body.status(self.job)['assignedCalls'], 1)

    def test_input_and_completed_output_mutation_fail_closed(self):
        self.authorize()
        path = next((self.job / 'requests').glob('*/reference-crop.png'))
        original = path.read_bytes()
        path.write_bytes(original + b'x')
        with self.assertRaisesRegex(ValueError, 'BODY_REQUEST_CHANGED'):
            body.execute(self.job, self.output_config, self.model)
        self.assertEqual(self.calls, [])
        path.write_bytes(original)
        body.execute(self.job, self.output_config, self.model)
        self.output_config.write_text('{}', encoding='utf-8')
        with self.assertRaisesRegex(ValueError, 'BODY_OUTPUT_CONFIG_CHANGED'):
            body.status(self.job)

    def test_budget_exceeded_before_any_output_or_compute(self):
        with self.assertRaisesRegex(ValueError, 'BODY_CALL_BUDGET_EXCEEDED'):
            body.prepare(self.inputs, self.job, 1)
        self.assertFalse(self.job.exists())
        self.assertEqual(self.calls, [])

    def test_live_session_command_keeps_three_images_and_disables_tools(self):
        folder = self.root / 'live'
        folder.mkdir()
        (folder / 'prompt.md').write_text('fixture', encoding='utf-8')
        for first, sid in ((True, None), (False, SID)):
            with self.subTest(first=first), patch('ai_ui_layers.body_observation.shutil.which', return_value='codex'), \
                 patch('ai_ui_layers.body_observation.invoke', return_value={}) as invoked:
                body.live_model(folder, sid, first)
                args = invoked.call_args.args[0]
                self.assertNotIn('--ephemeral', args)
                self.assertEqual(args[args.index('--image') + 1], ','.join(str(folder / name)
                    for name in ('reference.png', 'reference-crop.png', 'generated.png')))
                self.assertIn('features.image_generation=false', args)
                self.assertIn('features.unbounded_connection_retries=false', args)
                self.assertEqual('resume' in args, not first)


if __name__ == '__main__':
    unittest.main()
