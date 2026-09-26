import _bootstrap
from unittest.mock import patch
from PIL import Image

from test_received_bundle import ReceivedBundleTests
from ai_ui_layers.evaluate import read, digest
from ai_ui_layers.experimental_executor import prepare, authorize, next_request, receive
from ai_ui_layers.finish_bundle import finish


class FinishBundleTests(ReceivedBundleTests):
    def complete_selection(self):
        rows=read(self.snapshot/'requests.json')['requests']
        rest=[row['asset'] for row in rows if row['asset']!=self.asset]
        job=self.root/'second-job'
        config=prepare(self.snapshot,self.frozen['digest'],job,rest,reference_mode='full-only')
        authorize(job,config['digest'],'offline fixture approval')
        roles={asset['id']:asset['role']
               for asset in read(self.snapshot/'execution-plan.candidate.json')['assets']}
        for row in rows:
            if row['asset']==self.asset:continue
            request=next_request(job)
            self.assertEqual(request['asset'],row['asset'])
            raw=self.root/(row['asset']+'.png')
            alpha=255 if roles[row['asset']]=='background' else 200
            Image.new('RGBA',tuple(row['outputSize']),(70,80,90,alpha)).save(raw)
            receive(job,request['submissionDigest'],raw)
        return {row['asset']:(self.job if row['asset']==self.asset else job)
                for row in rows}

    def test_incomplete_selection_stops_before_output(self):
        for name in ('viewer.html','viewer.js'):(self.root/name).write_text('fixture')
        with self.assertRaisesRegex(ValueError,'INCOMPLETE_RECEIVED_BUNDLE'):
            finish(self.snapshot,self.frozen['digest'],{self.asset:self.job},
                   self.root/'out',self.root)
        self.assertFalse((self.root/'out').exists())

    def test_complete_exact_receipts_are_materialized_and_passed_to_existing_gates(self):
        selection=self.complete_selection()
        for name in ('viewer.html','viewer.js'):(self.root/name).write_text('fixture')
        with patch('ai_ui_layers.finish_bundle.adapt_materials',
                   side_effect=lambda snapshot,sources,output,pre_adapted: sources), \
             patch('ai_ui_layers.finish_bundle.register',return_value={'modelCalls':0}) as register, \
             patch('ai_ui_layers.finish_bundle.sources_from_preview',return_value={}), \
             patch('ai_ui_layers.finish_bundle.build',return_value={'status':'fixture-package'}) as build:
            result=finish(self.snapshot,self.frozen['digest'],selection,
                          self.root/'out',self.root)
        self.assertEqual(result['status'],'delivered_pending_visual_review')
        self.assertEqual(result['reusedReceivedRequests'],5)
        self.assertEqual(result['sourceJobsCount'],2)
        self.assertEqual(result['modelCalls'],0)
        self.assertFalse(result['originalDagPromoted'])
        self.assertFalse(result['humanVisualAcceptance'])
        self.assertEqual(len(read(self.root/'out/bundle/manifest.json')['records']),5)
        register.assert_called_once();build.assert_called_once()
        for asset,job in selection.items():
            self.assertEqual(digest(self.root/'out/bundle/raw'/(asset+'.png')),
                             digest(job/'attempts'/asset/'raw.png'))

    def test_changed_source_receipt_stops_before_package(self):
        selection=self.complete_selection()
        for name in ('viewer.html','viewer.js'):(self.root/name).write_text('fixture')
        source=self.job/'attempts'/self.asset/'raw.png'
        def mutate(*args,**kwargs):
            source.write_bytes(b'changed')
            return {'modelCalls':0}
        with patch('ai_ui_layers.finish_bundle.adapt_materials',
                   side_effect=lambda snapshot,sources,output,pre_adapted: sources), \
             patch('ai_ui_layers.finish_bundle.register',side_effect=mutate), \
             patch('ai_ui_layers.finish_bundle.build') as build:
            with self.assertRaisesRegex(ValueError,'RESULT_CHANGED'):
                finish(self.snapshot,self.frozen['digest'],selection,self.root/'out',self.root)
            build.assert_not_called()
        result=read(self.root/'out/result.json')
        self.assertEqual(result['status'],'blocked_no_retry')
        self.assertEqual(result['stage'],'package')
