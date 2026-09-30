"""Offline exchange checks for the opt-in source-layout sheet board."""
import _bootstrap
import copy
import json
from pathlib import Path
import unittest
from unittest.mock import patch

import test_compile_visual
from ai_ui_layers import collect_session
from ai_ui_layers import experimental_executor as exchange
from ai_ui_layers import frozen_image_arguments as frozen
from ai_ui_layers.collect_session import audit_relay
from ai_ui_layers.compile_visual import HARNESS
from ai_ui_layers.evaluate import digest, read
from ai_ui_layers.freeze_visual import body_digest, freeze
from ai_ui_layers.generate_session import build_session_prompt


def save(path, value):
    Path(path).write_text(json.dumps(value, ensure_ascii=False), encoding='utf-8')


class SheetLayoutExchangeTests(unittest.TestCase):
    def setUp(self):
        test_compile_visual.VisualCompileTests.setUp(self)
        self.visual = read(HARNESS / 'planning-harness/examples/visual-plan-scoped.json')
        self.visual['unknowns'] = []
        save(self.run / 'm1/draft.json', self.visual)
        source_sha = digest(self.run / 'm1/draft.json')
        review_request = read(self.run / 'm2/request.json')
        review_request['sourcePlanSha256'] = source_sha
        save(self.run / 'm2/request.json', review_request)
        result = read(self.run / 'result.json')
        result['sourcePlanSha256'] = source_sha
        save(self.run / 'result.json', result)
        self.snapshot = self.root / 'context-snapshot'
        self.manifest = freeze(self.run, self.snapshot, 16, 'sheets', 'context-crops')
        self.rows = read(self.snapshot / 'requests.json')['requests']
        self.sheet = next(row for row in self.rows if row.get('kind') == 'sheet')
        self.single = next(row for row in self.rows if row.get('kind') != 'sheet')

    def prepare_board(self, name='board-job'):
        job = self.root / name
        config = exchange.prepare(self.snapshot, self.manifest['digest'], job,
                                  [self.sheet['asset']], reference_mode='sheet-layout-board')
        return job, config

    def rewrite_job(self, job, mutation):
        config = read(job / 'job.json')
        mutation(config)
        config['digest'] = body_digest({key: value for key, value in config.items() if key != 'digest'})
        save(job / 'job.json', config)
        return config

    def test_one_sheet_board_is_frozen_and_one_request_is_digest_authorized(self):
        original_snapshot_digest = digest(self.snapshot / 'snapshot.json')
        job, config = self.prepare_board()
        descriptor = config['sheetLayoutReference']
        self.assertEqual(digest(self.snapshot / 'snapshot.json'), original_snapshot_digest)
        self.assertEqual(config['referenceMode'], 'sheet-layout-board')
        self.assertEqual(config['generationReference'], 'sheet-layout-board')
        self.assertEqual(config['assets'], [self.sheet['asset']])
        self.assertEqual(config['maximumCalls'], 1)
        self.assertEqual(config['automaticRetries'], 0)
        self.assertEqual(exchange.load_job(job)[0], config)
        current = exchange.status(job)
        self.assertEqual(current['generationReference'], 'sheet-layout-board')
        self.assertEqual(current['sheetLayoutReference'], descriptor)
        self.assertEqual(current['status'], 'awaiting_authorization')
        with self.assertRaisesRegex(ValueError, 'EXPLICIT_BOUND_APPROVAL_REQUIRED'):
            exchange.authorize(job, self.manifest['digest'], 'offline fixture')
        exchange.authorize(job, config['digest'], 'offline fixture')
        request = exchange.next_request(job)
        self.assertEqual(request['generationReference'], 'sheet-layout-board')
        self.assertEqual(request['sheetLayoutReference'], descriptor)
        self.assertNotIn('references', request)
        self.assertEqual(request['materialIds'], self.sheet['materialIds'])
        self.assertEqual(request['automaticRetries'], 0)
        self.assertEqual(request['arguments']['referenced_image_paths'],
                         [str((job / 'sheet-layout/board.png').resolve())])
        self.assertEqual(request['arguments']['prompt'],
                         (job / 'sheet-layout/prompt.txt').read_text(encoding='utf-8').rstrip('\n'))
        self.assertEqual(frozen.tool_arguments(request, True), dict(
            prompt=request['arguments']['prompt'], num_last_images_to_include=1,
            transparent_background=True))
        session_prompt = build_session_prompt(request['arguments'], 'sheet-layout-board', True)
        self.assertIn('source-layout board', session_prompt)
        self.assertNotIn(request['arguments']['prompt'], session_prompt)
        self.assertEqual(exchange.status(job)['assignedCalls'], 1)
        with self.assertRaisesRegex(ValueError, 'NOT_READY_NO_RESUBMIT'):
            exchange.next_request(job)

    def test_board_requires_context_snapshot_one_real_multi_material_sheet_and_no_override(self):
        full = self.root / 'full-snapshot'
        full_manifest = freeze(self.run, full, 16, 'sheets', 'full')
        with self.assertRaisesRegex(ValueError, 'CONTEXT_SNAPSHOT_REQUIRED'):
            exchange.prepare(full, full_manifest['digest'], self.root / 'full-job',
                             [self.sheet['asset']], reference_mode='sheet-layout-board')
        single_snapshot = self.root / 'single-snapshot'
        single_manifest = freeze(self.run, single_snapshot, 16, 'single', 'context-crops')
        with self.assertRaises(ValueError):
            exchange.prepare(single_snapshot, single_manifest['digest'], self.root / 'single-job',
                             reference_mode='sheet-layout-board')
        with self.assertRaises(ValueError):
            exchange.prepare(self.snapshot, self.manifest['digest'], self.root / 'material-job',
                             [self.single['asset']], reference_mode='sheet-layout-board')
        with self.assertRaisesRegex(ValueError, 'SINGLE_SHEET_LAYOUT_REQUIRED'):
            exchange.prepare(self.snapshot, self.manifest['digest'], self.root / 'multi-job',
                             [self.sheet['asset'], self.single['asset']], reference_mode='sheet-layout-board')
        override = self.root / 'override.txt'
        override.write_text('Changed prompt', encoding='utf-8')
        with self.assertRaisesRegex(ValueError, 'FROZEN_CONTEXT_REFERENCE_REQUIRED'):
            exchange.prepare(self.snapshot, self.manifest['digest'], self.root / 'override-job',
                             [self.sheet['asset']], prompt_override=override,
                             reference_mode='sheet-layout-board')

    def test_reshashed_job_metadata_and_artifact_changes_fail_closed(self):
        job, config = self.prepare_board()
        exchange.authorize(job, config['digest'], 'offline fixture')
        changed = self.rewrite_job(job, lambda body: body.update(createdAt=body['createdAt'] + 1))
        with self.assertRaisesRegex(ValueError, 'AUTHORIZATION_CHANGED'):
            exchange.status(job)
        with self.assertRaisesRegex(ValueError, 'EXPLICIT_BOUND_APPROVAL_REQUIRED'):
            exchange.authorize(job, config['digest'], 'stale approval')
        self.assertNotEqual(changed['digest'], config['digest'])

        for name, mutation in (
            ('forged-mode', lambda body: body.update(generationReference='context-crops')),
            ('missing-descriptor', lambda body: body.pop('sheetLayoutReference')),
            ('forged-descriptor', lambda body: body.update(sheetLayoutReference={})),
        ):
            with self.subTest(name=name):
                tampered, _ = self.prepare_board(name)
                self.rewrite_job(tampered, mutation)
                with self.assertRaises(ValueError):
                    exchange.load_job(tampered)
        for name, path in (('changed-board', 'board.png'), ('changed-prompt', 'prompt.txt')):
            with self.subTest(name=name):
                tampered, _ = self.prepare_board(name)
                target = tampered / 'sheet-layout' / path
                with target.open('ab') as stream:
                    stream.write(b'fixture modification')
                with self.assertRaises(ValueError):
                    exchange.load_job(tampered)

    def test_frozen_relay_audits_exact_board_metadata_and_single_image_count(self):
        job, config = self.prepare_board()
        exchange.authorize(job, config['digest'], 'offline fixture')
        request = exchange.next_request(job)
        session = self.root / 'session'
        session.mkdir()
        save(session / 'tool-request.json', request)
        sha = frozen.prepare(session, request, True)
        server = frozen.ArgumentServer(session / 'frozen-image-arguments.json', sha)
        server.handle(dict(method='initialize', params={}))
        server.handle(dict(method='notifications/initialized'))
        result = server.handle(dict(method='tools/call', params=dict(name=frozen.TOOL, arguments={})))
        self.assertEqual(result['structuredContent']['num_last_images_to_include'], 1)
        dispatch = dict(toolRequestSha256=digest(session / 'tool-request.json'),
                        transparentBackground=True, imageArgumentsSha256=sha,
                        argumentServerSha256=digest(Path(frozen.__file__)))
        events = [dict(payload=dict(type='custom_tool_call', name='functions.exec'))]
        self.assertEqual(audit_relay(job, session, request, dispatch, events, frozen.RELAY_CODE),
                         (request['arguments']['prompt'], True))
        for name, mutation in (
            ('old-context-metadata', lambda body: body.update(generationReference='context-crops')),
            ('changed-descriptor', lambda body: body.update(sheetLayoutReference={})),
            ('old-reference-list', lambda body: body.update(references=self.sheet['references'])),
        ):
            with self.subTest(name=name):
                changed = copy.deepcopy(request)
                mutation(changed)
                save(session / 'tool-request.json', changed)
                dispatch['toolRequestSha256'] = digest(session / 'tool-request.json')
                with self.assertRaisesRegex(ValueError, 'SESSION_SHEET_LAYOUT_MISMATCH'):
                    audit_relay(job, session, changed, dispatch, events, frozen.RELAY_CODE)

    def test_original_context_exchange_keeps_multiple_frozen_references(self):
        job = self.root / 'context-job'
        config = exchange.prepare(self.snapshot, self.manifest['digest'], job,
                                  [self.sheet['asset']])
        self.assertEqual(config['referenceMode'], 'context-crops')
        self.assertEqual(config['generationReference'], 'context-crops')
        self.assertNotIn('sheetLayoutReference', config)
        exchange.authorize(job, config['digest'], 'offline fixture')
        request = exchange.next_request(job)
        self.assertEqual(request['references'], self.sheet['references'])
        self.assertEqual(len(request['arguments']['referenced_image_paths']),
                         len(self.sheet['references']))
        self.assertNotIn('sheetLayoutReference', request)

    def test_board_collection_rejects_legacy_literal_transport_before_receiving(self):
        job, config = self.prepare_board()
        exchange.authorize(job, config['digest'], 'offline fixture')
        request = exchange.next_request(job)
        session_id = '12345678-1234-1234-1234-123456789abc'
        folder = job / 'generation-sessions' / request['submissionDigest']
        folder.mkdir(parents=True)
        save(folder / 'tool-request.json', request)
        save(folder / 'session-result.json', dict(
            submissionDigest=request['submissionDigest'], exitCode=0,
            sessionIds=[session_id], elapsedSeconds=1))
        # A historical literal prompt receipt must not bypass board metadata auditing.
        home = self.root / 'codex-home'
        log = home / 'sessions' / f'{session_id}.jsonl'
        log.parent.mkdir(parents=True)
        code = ('tools.image_gen__imagegen({prompt: '
                + json.dumps(request['arguments']['prompt'], ensure_ascii=False)
                + ', num_last_images_to_include: 1, transparent_background: true})')
        log.write_text(json.dumps(dict(payload=dict(type='custom_tool_call', input=code)),
                                  ensure_ascii=False) + '\n', encoding='utf-8')
        with patch.object(collect_session, 'receive') as receive:
            with self.assertRaisesRegex(ValueError, 'SHEET_LAYOUT_EXACT_TRANSPORT_REQUIRED'):
                collect_session.collect(job, home)
        receive.assert_not_called()


if __name__ == '__main__':
    unittest.main()
