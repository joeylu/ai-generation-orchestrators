"""Offline locator-scope transmission and conservative gates; no visual inference."""
import _bootstrap
import json
import unittest

from ai_ui_layers.evaluate import read, digest
from ai_ui_layers.freeze_visual import freeze
from ai_ui_layers.planning_dag import Dag
import test_planning_dag


class ObjectLocatorGuidanceTests(unittest.TestCase):
    def setUp(self):
        test_planning_dag.DagTests.setUp(self)

    def bind_answer(self,folder,answer):
        (folder/'draft.json').write_text(json.dumps(answer),encoding='utf-8')
        receipt=read(folder/'transport.json')
        receipt['responseSha256']=digest(folder/'draft.json')
        (folder/'transport.json').write_text(json.dumps(receipt),encoding='utf-8')

    def test_single_separate_icon_keeps_null_and_receives_same_scope_in_m1_m2(self):
        model=test_planning_dag.FakeModel()
        def observed(folder,sid,first):
            model(folder,sid,first)
            if first:
                answer=read(folder/'draft.json')
                objects=[o for o in answer['objects'] if o['materialId']=='asset-coin-a']
                self.assertEqual(len(objects),1)
                objects[0]['bboxNorm']=None
                self.bind_answer(folder,answer)
        result=Dag(self.root,observed).execute()
        self.assertEqual(result['status'],'frozen')
        self.assertEqual([name for name,_ in model.calls],['m1','m2'])
        plan=read(self.root/'m1/draft.json')
        self.assertIsNone(next(o for o in plan['objects'] if o['materialId']=='asset-coin-a')['bboxNorm'])
        for stage in ('m1','m2'):
            prompt=(self.root/stage/'prompt.md').read_text(encoding='utf-8')
            for rule in ('对象框仅作辅助定位，默认 null', '两项同素材例外必须非 null',
                         '同素材内分离控件各自的完整图形', '同素材去字控件内与文字并排的集成功能图标',
                         '不因邻接外部文字自动要求对象框', '定位歧义，须给原图依据'):
                self.assertIn(rule,prompt)
            request=self.root/'request.json' if stage=='m1' else self.root/stage/'request.json'
            self.assertEqual(read(request)['inputs']['prompt.md'],
                             digest(self.root/stage/'prompt.md'))

    def test_integrated_icon_locator_finding_is_not_filtered_or_downgraded(self):
        model=test_planning_dag.FakeModel()
        def observed(folder,sid,first):
            model(folder,sid,first)
            answer=read(folder/'draft.json')
            if first:
                button=next(m for m in answer['materials'] if m['id']=='asset-buy-button')
                answer['objects'].append(dict(id='integrated-glyph',kind='icon',
                    materialId=button['id'],bboxNorm=None,
                    label='Fixture fixed glyph integrated beside removable text in this button.'))
            elif folder.name=='m2':
                answer['issues']=[dict(code='INTEGRATED_ICON_LOCATOR_MISSING',category='geometry',
                    ids=['integrated-glyph'],description='Fixture integrated glyph and caption share one control material.',
                    suggestedChange='Provide an internal locator for the retained integrated glyph.')]
            self.bind_answer(folder,answer)
        dag=Dag(self.root,observed)
        dag.m1();dag.check()
        dag.review('m2',self.root/'m1/draft.json',self.root/'m1/preview/materials-overlay.png')
        assessment=read(self.root/'m2/assessment.json')
        self.assertEqual(assessment['blockers'][0]['code'],'INTEGRATED_ICON_LOCATOR_MISSING')
        self.assertEqual(assessment['blockers'][0]['category'],'geometry')
        self.assertFalse(assessment['warnings'])
        with self.assertRaisesRegex(ValueError,'M2_UNRESOLVED'):
            freeze(self.root,self.root/'direct-freeze',8,'sheets','context-crops')
        self.assertFalse((self.root/'direct-freeze').exists())
        self.assertEqual(len(model.calls),2)


if __name__=='__main__':unittest.main()
