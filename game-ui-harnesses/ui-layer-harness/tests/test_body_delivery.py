import _bootstrap
import io
import json
import unittest
from unittest.mock import patch

from PIL import Image

from ai_ui_layers import body_observation as body
from ai_ui_layers import delivery_dag as delivery
from ai_ui_layers.evaluate import read, save, digest
import test_delivery_dag
import test_sheet_delivery

SID = '12345678-1234-1234-1234-123456789abc'


class BodyDeliveryTests(unittest.TestCase):
    def setUp(self):
        test_delivery_dag.DeliveryTests.setUp(self)
        self.run = delivery.init(self.image, self.root/'new-body-run', self.viewer, generation_mode='single')
        self.body_calls = []
        self.dag = delivery.DeliveryDag(self.run, self.model, body_model=self.body_model)

    def body_model(self, folder, sid, first):
        self.body_calls.append((folder.name, sid, first))
        with Image.open(folder/'generated.png') as im:
            core = im.convert('RGBA').getchannel('A').point(lambda a:255 if a>=128 else 0).getbbox()
        save(folder/'draft.json', dict(boundaryStatus='complete', sourceBodyBox=list(core),
            referenceCropBodyBox=[10,10,30,30], evidence='Fixture complete whole corresponding body.', issues=[]))
        (folder/'events.jsonl').write_text(json.dumps({'type':'thread.started','thread_id':SID})+'\n',encoding='utf-8')
        return dict(exitCode=0,turnCompleted=True,unexpectedEvents=[],responseSha256=digest(folder/'draft.json'))

    def complete_media(self):
        test_delivery_dag.DeliveryTests.complete_media(self)

    def test_new_default_run_waits_for_specific_body_authorization_then_packages(self):
        first = self.dag.execute()
        self.assertEqual(first['registrationPolicy'], body.POLICY)
        self.assertEqual(first['contextPromptVersion'], 'v8')
        self.assertEqual(first['status'], 'awaiting_authorization')
        self.assertEqual(read(self.run/'planning/.dag/config.json')['contextPromptVersion'], 'v8')
        self.complete_media()
        waiting = self.dag.execute()
        self.assertEqual(waiting['status'], 'awaiting_body_authorization')
        self.assertEqual(self.body_calls, [])
        self.assertFalse((self.run/'registration').exists())
        body_job = self.run/'body-observation'
        # Image authorization is a different digest and cannot approve observation.
        with self.assertRaisesRegex(ValueError, 'EXPLICIT_BOUND_BODY_APPROVAL_REQUIRED'):
            body.authorize(body_job, read(self.run/'generation/job.json')['digest'], 'fixture')
        with patch('sys.argv', ['ui-layer', 'authorize-body', '--output', str(self.run),
                '--job-digest', waiting['bodyObservation']['jobDigest'], '--approval', 'fixture body authorization']), \
                patch('sys.stdout', io.StringIO()):
            delivery.main()
        result = self.dag.execute()
        self.assertEqual(result['status'], 'delivered_pending_visual_review')
        self.assertFalse(result['humanVisualAcceptance'])
        self.assertEqual(len(self.body_calls), waiting['bodyObservation']['maximumCalls'])
        config = read(self.run/'body-registration-input.json')
        self.assertEqual(config['registrationPolicy'], body.SUPPORT_POLICY)
        registered = read(self.run/'registration/result.json')
        self.assertEqual(registered['modelCalls'], 0)
        composition = read(self.run/'delivery/package/composition.json')
        for layer in composition['layers']:
            with Image.open(self.run/'delivery/package'/layer['path']) as im:
                self.assertEqual(im.size, (layer['width'], layer['height']))
        previous_calls = len(self.body_calls)
        self.assertEqual(self.dag.execute()['status'], 'delivered_pending_visual_review')
        self.assertEqual(len(self.body_calls), previous_calls)

    def test_body_budget_failure_stops_before_any_image_job(self):
        run = delivery.init(self.image, self.root/'too-small-budget', self.viewer, max_body_calls=1)
        with self.assertRaisesRegex(ValueError, 'BODY_CALL_BUDGET_EXCEEDED'):
            delivery.DeliveryDag(run, self.model).execute()
        self.assertFalse((run/'generation').exists())
        self.assertEqual(delivery.DeliveryDag(run, self.model).status()['status'], 'stopped_no_retry')

    def test_default_sheet_route_observes_independent_materials_and_recomposes_package(self):
        from ai_ui_layers.layer_package import composite, validate_archive

        self.run = delivery.init(self.image, self.root/'default-sheet-run', self.viewer)
        self.calls = 0
        self.dag = delivery.DeliveryDag(self.run, self.model,
            sheet_model=lambda folder: test_sheet_delivery.SheetDeliveryTests.review(self, folder),
            body_model=self.body_model)
        initial = self.dag.execute()
        self.assertEqual(initial['generationMode'], 'sheets')
        self.assertEqual(initial['generationReference'], 'context-crops')
        self.assertEqual(initial['contextPromptVersion'], 'v8')
        self.job = self.run/'generation'
        test_sheet_delivery.SheetDeliveryTests.media(self)
        waiting = self.dag.execute()
        self.assertEqual(waiting['status'], 'awaiting_body_authorization')
        self.assertEqual(self.body_calls, [])
        self.assertEqual(self.calls, 1)
        self.assertEqual(len(read(self.run/'extraction/result.json')['materials']), 5)
        body.authorize(self.run/'body-observation', waiting['bodyObservation']['jobDigest'],
                       'offline fixture body authorization')
        result = self.dag.execute()
        self.assertEqual(result['status'], 'delivered_pending_visual_review')
        self.assertEqual(len(self.body_calls), 4)
        self.assertEqual(read(self.run/'registration/result.json')['modelCalls'], 0)
        package = self.run/'delivery/package'
        composition = read(package/'composition.json')
        self.assertEqual(len(composition['layers']), 5)
        self.assertEqual(len({layer['path'] for layer in composition['layers']}), 5)
        recomposed = composite(package, composition)
        with Image.open(package/'preview.png') as preview:
            self.assertEqual(recomposed.tobytes(), preview.tobytes())
        self.assertEqual(validate_archive(self.run/'delivery/ui-layers.zip')['status'],
                         'package_integrity_passed')
        self.assertFalse(result['humanVisualAcceptance'])
        self.dag.execute()
        self.assertEqual(len(self.body_calls), 4)
        self.assertEqual(self.calls, 1)

    def test_body_transport_failure_is_terminal_and_package_absent(self):
        self.dag.execute()
        self.complete_media()
        waiting = self.dag.execute()
        body.authorize(self.run/'body-observation', waiting['bodyObservation']['jobDigest'], 'fixture')
        def failed(folder, sid, first):
            self.body_calls.append(folder.name)
            raise TimeoutError('fixture uncertain receipt')
        self.dag.body_model = failed
        with self.assertRaises(TimeoutError):
            self.dag.execute()
        with self.assertRaisesRegex(ValueError, 'NO_RESUBMIT'):
            self.dag.execute()
        self.assertEqual(len(self.body_calls), 1)
        self.assertEqual(self.dag.status()['status'], 'stopped_no_retry')
        self.assertFalse((self.run/'delivery').exists())

    def test_legacy_missing_fields_preserve_v3_and_no_body_stage(self):
        path = self.run/'.dag/config.json'
        config = read(path)
        for field in ('registrationPolicy','maximumBodyCalls','contextPromptVersion'):
            config.pop(field)
        config['graph'] = delivery.GRAPH
        path.write_text(json.dumps(config), encoding='utf-8')
        (self.run/'.dag/config-digest.json').write_text(json.dumps({'sha256':digest(path)}), encoding='utf-8')
        dag = delivery.DeliveryDag(self.run, self.model)
        result = dag.execute()
        self.assertEqual(result['registrationPolicy'], 'legacy-region-fit')
        self.assertEqual(read(self.run/'planning/frozen/snapshot.json')['contextPromptVersion'], 'v3')
        self.complete_media()
        with patch('ai_ui_layers.delivery_dag.register', side_effect=test_delivery_dag.DeliveryTests.fixture_registration):
            self.assertEqual(dag.execute()['status'], 'delivered_pending_visual_review')
        self.assertFalse((self.run/'body-observation').exists())

    def test_new_full_run_rejects_explicit_context_version_before_creation(self):
        output = self.root/'invalid-full'
        with self.assertRaisesRegex(ValueError, 'CONTEXT_PROMPT_REQUIRES_CONTEXT_CROPS'):
            delivery.init(self.image, output, self.viewer, generation_reference='full', context_prompt_version='v7')
        self.assertFalse(output.exists())


if __name__ == '__main__':
    unittest.main()
