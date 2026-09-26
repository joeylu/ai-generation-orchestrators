import _bootstrap
import json
import unittest

import test_accepted_materials
import test_sheet_delivery
from ai_ui_layers.evaluate import read, digest
from ai_ui_layers.execution_preflight import preflight
from ai_ui_layers.freeze_visual import body_digest
from ai_ui_layers.generation_groups import sheet_prompt
from ai_ui_layers.raw_review_required import finish
from ai_ui_layers.layer_package import validate_archive


class RawReviewRequiredTests(unittest.TestCase):
    def test_complete_single_job_packages_without_visual_acceptance(self):
        test_accepted_materials.AcceptanceTests.setUp(self)
        before=read(self.job/'job.json')['digest']
        output=self.root/'raw-finish'
        result=finish(self.job,before,output,self.viewer,['Fixture visual concern.'])
        self.assertEqual(result['status'],'review_required')
        self.assertEqual(result['layerCount'],5)
        self.assertTrue(result['sourceReceiptReplayPassed'])
        self.assertTrue(result['candidatePreviewMatched'])
        self.assertFalse(result['originalDagPromoted'])
        self.assertFalse(result['humanVisualAcceptance'])
        self.assertEqual(result['generationCalls'],0)
        self.assertEqual(result['modelCalls'],0)
        self.assertTrue((output/'package/viewer.html').is_file())
        self.assertTrue((self.root/'raw-finish-selection.json').is_file())
        validate_archive(output/'ui-layers.zip')
        review=read(output/'package/review.json')
        self.assertIn('Fixture visual concern.',review['issues'])

    def test_incomplete_or_changed_receipt_stops_before_output(self):
        test_accepted_materials.AcceptanceTests.setUp(self)
        key=read(self.job/'job.json')['assets'][0]
        (self.job/'attempts'/key/'raw.png').write_bytes(b'changed')
        with self.assertRaises(ValueError):
            finish(self.job,read(self.job/'job.json')['digest'],self.root/'invalid',self.viewer)
        self.assertFalse((self.root/'invalid').exists())

    def test_complete_sheet_job_extracts_each_cell_and_packages(self):
        self.review=lambda folder: test_sheet_delivery.SheetDeliveryTests.review(self,folder)
        test_sheet_delivery.SheetDeliveryTests.setUp(self)
        test_sheet_delivery.SheetDeliveryTests.media(self)
        result=finish(self.job,read(self.job/'job.json')['digest'],
                      self.root/'sheet-finish',self.root/'viewer')
        self.assertEqual(result['status'],'review_required')
        self.assertEqual(result['layerCount'],5)
        self.assertEqual(result['sourceJobsCount'],1)
        self.assertTrue(result['sourceReceiptReplayPassed'])
        self.assertFalse(result['humanVisualAcceptance'])
        validate_archive(self.root/'sheet-finish/ui-layers.zip')

    def test_legacy_sheet_prompt_accepts_only_exact_compiler_template(self):
        self.review=lambda folder: test_sheet_delivery.SheetDeliveryTests.review(self,folder)
        test_sheet_delivery.SheetDeliveryTests.setUp(self)
        snapshot=self.job/'snapshot'
        row=next(row for row in read(snapshot/'requests.json')['requests'] if row.get('kind')=='sheet')
        group=next(group for group in read(snapshot/'generation-groups.json')['groups']
                   if group['id']==row['asset'])
        visual=read(snapshot/'evidence/m1-draft.json')
        plan=read(snapshot/'execution-plan.candidate.json')
        prompt=snapshot/row['prompt']
        prompt.write_text(sheet_prompt(visual,plan,group,legacy_without_attached_props=True)+'\n',encoding='utf-8')
        frozen=read(snapshot/'snapshot.json')
        frozen['files'][row['prompt']]=digest(prompt)
        frozen['digest']=body_digest({key:value for key,value in frozen.items() if key!='digest'})
        (snapshot/'snapshot.json').write_text(json.dumps(frozen),encoding='utf-8')
        self.assertEqual(preflight(snapshot,frozen['digest'])['inputChecks'],'passed')
        prompt.write_text(prompt.read_text(encoding='utf-8').replace('observed state','invented state'),encoding='utf-8')
        frozen['files'][row['prompt']]=digest(prompt)
        frozen['digest']=body_digest({key:value for key,value in frozen.items() if key!='digest'})
        (snapshot/'snapshot.json').write_text(json.dumps(frozen),encoding='utf-8')
        with self.assertRaisesRegex(ValueError,'PROMPT_COMPILER_MISMATCH'):
            preflight(snapshot,frozen['digest'])


if __name__=='__main__':unittest.main()
