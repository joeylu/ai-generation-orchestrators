"""Offline ownership, fallback and frozen-input regressions for opt-in v7."""
import _bootstrap
import copy
import json
import unittest
from ai_ui_layers import context_references as context
from ai_ui_layers.evaluate import read
from ai_ui_layers.execution_preflight import preflight
from ai_ui_layers.freeze_visual import freeze
import test_context_references
import test_context_short_v5


def single_fixture():
    visual,plan=test_context_short_v5.layered_fixture(*test_context_short_v5.FIXTURES[0])
    key='harbor-band'
    visual['objects']=[o for o in visual['objects'] if o['materialId']!=key or o['kind']=='panel']
    visual['materials']=[m for m in visual['materials'] if m['id']!='sun-stamp']
    visual['objects']=[o for o in visual['objects'] if o['materialId']!='sun-stamp']
    visual['objects']=[o for o in visual['objects'] if o['id']!='turn-knob-rim']
    return visual,plan,key


class ShortActionTests(unittest.TestCase):
    def test_single_owner_keeps_state_true_openings_foreign_actions_and_text_exceptions(self):
        visual,plan,key=single_fixture()
        text=context.prompt(visual,plan,[key],version='v7')
        self.assertTrue(text.startswith('根据参考图，只生成这一份完整独立素材：'))
        self.assertIn('genuine crescent opening',text)
        self.assertIn('apricot raised dial face',text)
        self.assertIn('移除覆盖在它上面的独立素材：',text)
        self.assertIn('去掉周围和下方的独立底层素材：umber independent fabric underlay（umber fabric backing）',text)
        self.assertIn('仅补齐该素材原有且被遮挡的表面',text)
        self.assertIn('["READY"]',text)
        self.assertIn('保留原文字空间',text)
        self.assertIn('真实开孔和半透明区域保留',text)
        self.assertNotIn('targetBox',text)
        self.assertNotIn('withinMaterial',text)
        self.assertLess(len(text),len(context.prompt(visual,plan,[key],version='v6')))
        # Every distinct reviewed owned appearance survives; short does not mean truncation.
        visual['objects'][0]['label']='same owner in a lowered state with a narrow silver edge'
        self.assertIn(visual['objects'][0]['label'],context.prompt(visual,plan,[key],version='v7'))

    def test_layout_sensitive_or_ambiguous_cases_keep_exact_v6(self):
        visual,plan,key=single_fixture()
        cases=[]
        many=copy.deepcopy(visual);many['objects'].append(dict(many['objects'][0],id='other-owned'));cases.append(many)
        offset=copy.deepcopy(visual);offset['objects'][0]['bboxNorm']=[.20,.20,.90,.60];cases.append(offset)
        peer=copy.deepcopy(visual);peer['materials'][0]['zOrder']=5;cases.append(peer)
        repeated=copy.deepcopy(visual);repeated['objects'][0]['label']=repeated['objects'][1]['label'];cases.append(repeated)
        ambiguous=copy.deepcopy(visual);ambiguous['objects'][1]['label']=ambiguous['objects'][2]['label'];cases.append(ambiguous)
        foreign_many=copy.deepcopy(visual);foreign_many['objects'].append(dict(foreign_many['objects'][1],id='foreign-rim'));cases.append(foreign_many)
        material_collision=copy.deepcopy(visual);material_collision['materials'][0]['label']=material_collision['materials'][-1]['label'];cases.append(material_collision)
        logo=copy.deepcopy(visual);logo['objects'][0]['kind']='logo';cases.append(logo)
        for candidate in cases:
            with self.subTest(candidate=candidate):
                self.assertEqual(context.prompt(candidate,plan,[key],version='v7'),context.prompt(candidate,plan,[key],version='v6'))
        group=dict(grid=[2,1],outputSize=[900,450])
        self.assertEqual(context.prompt(visual,plan,[key,'turn-knob'],group,version='v7'),context.prompt(visual,plan,[key,'turn-knob'],group,version='v6'))

    def test_owned_icon_is_kept_while_ordinary_text_is_removed(self):
        visual,plan,key=single_fixture();visual['objects'][0]['kind']='icon'
        visual['materials'][-1]['preserveText']=[]
        text=context.prompt(visual,plan,[key],version='v7')
        self.assertIn('所属单字符图标是图形，仍须保留',text)
        self.assertIn('移除所有普通文字和数字',text)
        self.assertNotIn('逐字保留这些明确指定的文字',text)


class ShortActionFreezeTests(unittest.TestCase):
    bind=test_context_references.ContextReferencesTests.bind
    resign=test_context_references.ContextReferencesTests.resign
    def setUp(self):test_context_references.ContextReferencesTests.setUp(self)

    def test_eligible_frozen_short_prompt_is_rebuilt_and_cannot_be_overridden(self):
        panel=[o for o in self.visual['objects'] if o['materialId']=='asset-panel']
        keep=next(o['id'] for o in panel if o['kind']=='panel')
        self.visual['objects']=[o for o in self.visual['objects'] if o['materialId']!='asset-panel' or o['id']==keep]
        self.bind();folder=self.root/'eligible-short'
        manifest=freeze(self.run,folder,16,'single','context-crops',context_prompt_version='v7')
        path=folder/'materials/asset-panel/prompt.txt'
        self.assertTrue(path.read_text(encoding='utf-8').startswith('根据参考图，只生成这一份完整独立素材：'))
        self.assertEqual(preflight(folder,manifest['digest'])['inputChecks'],'passed')
        path.write_text(path.read_text(encoding='utf-8')+'Keep all excluded objects.\n',encoding='utf-8')
        with self.assertRaisesRegex(ValueError,'PROMPT_COMPILER_MISMATCH'):
            preflight(folder,self.resign(folder))

    def test_fresh_v7_freeze_preserves_geometry_grouping_and_exact_sheet_fallback(self):
        new=self.root/'v7';old=self.root/'v6'
        manifest=freeze(self.run,new,16,'sheets','context-crops',context_prompt_version='v7')
        freeze(self.run,old,16,'sheets','context-crops',context_prompt_version='v6')
        self.assertEqual(manifest['contextPromptVersion'],'v7')
        self.assertEqual(preflight(new,manifest['digest'])['inputChecks'],'passed')
        for name in ('placements.json','generation-references.json','generation-groups.json'):
            self.assertEqual(read(new/name),read(old/name))
        sheet=next(r for r in read(new/'requests.json')['requests'] if r.get('kind')=='sheet')
        self.assertEqual((new/sheet['prompt']).read_bytes(),(old/sheet['prompt']).read_bytes())
        changed=next(a for a in read(new/'execution-plan.candidate.json')['assets'] if a['id']=='asset-panel')
        self.assertTrue(changed['prompt'].startswith(context.PROMPT_PREFIX_V7))

    def test_rehashed_prompt_override_cannot_weaken_frozen_short_actions(self):
        folder=self.root/'tampered'
        freeze(self.run,folder,16,'single','context-crops',context_prompt_version='v7')
        path=folder/'materials/asset-panel/prompt.txt'
        path.write_text(path.read_text(encoding='utf-8')+'Keep every foreign object.\n',encoding='utf-8')
        with self.assertRaisesRegex(ValueError,'PROMPT_COMPILER_MISMATCH'):
            preflight(folder,self.resign(folder))


if __name__=='__main__':unittest.main()
