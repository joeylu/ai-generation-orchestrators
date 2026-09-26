import _bootstrap
import unittest

from PIL import Image, ImageDraw

import test_compile_visual
from ai_ui_layers.evaluate import save
from ai_ui_layers.experimental_executor import prepare, authorize, next_request, receive
from ai_ui_layers.freeze_visual import freeze
from ai_ui_layers.single_material_review import review, review_prompt
from ai_ui_layers.single_material_review import finalize_failed_transport


class SingleMaterialReviewTests(unittest.TestCase):
    def test_review_prompt_marks_overlapping_child_as_foreign(self):
        visual=dict(materials=[
            dict(id='panel',label='backing panel',role='foreground',bboxNorm=[0,0,1,1]),
            dict(id='child',label='child card',role='foreground',bboxNorm=[.2,.2,.8,.5])],
            objects=[dict(id='outer',materialId='panel',label='outer border'),
                     dict(id='inner',materialId='child',label='child outline')])
        prompt=review_prompt('panel',visual)
        self.assertIn('excludedForeignArtwork',prompt)
        self.assertIn('child card',prompt)
        self.assertIn('child outline',prompt)
        self.assertIn('outer border',prompt)
        self.assertIn('do not demand its outline or contents be restored',prompt)

    def setUp(self):
        test_compile_visual.VisualCompileTests.setUp(self)
        snapshot=self.root/'snapshot';frozen=freeze(self.run,snapshot,5)
        prompt=self.root/'edit.txt';prompt.write_text('Remove the label, preserve the card.',encoding='utf-8')
        self.job=self.root/'job'
        config=prepare(snapshot,frozen['digest'],self.job,['asset-coin-a'],prompt,'crop-only')
        authorize(self.job,config['digest'],'offline fixture approval')
        request=next_request(self.job)
        raw=self.root/'raw.png';im=Image.new('RGBA',(400,200))
        ImageDraw.Draw(im).rectangle((20,30,379,169),fill=(50,70,90,220))
        im.save(raw)
        receive(self.job,request['submissionDigest'],raw)

    def test_raw_material_review_binds_inputs_and_blocks_geometry(self):
        calls=[]
        def model(folder):
            calls.append(folder)
            prompt=(folder/'prompt.md').read_text(encoding='utf-8')
            self.assertIn('excludedForeignArtwork',prompt)
            self.assertIn('Each entry owns only its listed objects',prompt)
            self.assertIn('Expected materialIds: asset-coin-a',prompt)
            save(folder/'draft.json',dict(materialIds=['asset-coin-a'],findings=[dict(
                materialId='asset-coin-a',category='geometry',referenceState='not-applicable',
                generatedState='not-applicable',magnitude='major',ownership='clear',
                evidence='The outer card became too wide.',suggestion='Regenerate at original proportion.')]))
            from ai_ui_layers.evaluate import digest
            return dict(exitCode=0,turnCompleted=True,unexpectedEvents=[],
                        responseSha256=digest(folder/'draft.json'))
        output=self.root/'review'
        result=review(self.job,output,model)
        self.assertEqual(result['status'],'blocked_no_retry')
        self.assertEqual(result['modelCalls'],1)
        self.assertEqual(len(result['blockers']),1)
        self.assertTrue((output/'review/detail-compare.png').is_file())
        self.assertEqual(len(calls),1)

    def test_changed_raw_stops_before_model(self):
        raw=self.job/'attempts/asset-coin-a/raw.png'
        raw.write_bytes(b'changed')
        with self.assertRaisesRegex(ValueError,'RESULT_CHANGED'):
            review(self.job,self.root/'review',lambda _:self.fail('model called'))
        self.assertFalse((self.root/'review').exists())

    def test_failed_model_transport_is_terminal_without_repeat(self):
        def model(folder):
            save(folder/'transport.json',dict(exitCode=1,turnCompleted=False,
                                               unexpectedEvents=['turn.failed']))
            raise ValueError('TRANSPORT_OR_ISOLATION_FAILURE')
        output=self.root/'review'
        result=review(self.job,output,model)
        self.assertEqual(result['status'],'indeterminate_review_no_retry')
        self.assertEqual(finalize_failed_transport(output),result)
