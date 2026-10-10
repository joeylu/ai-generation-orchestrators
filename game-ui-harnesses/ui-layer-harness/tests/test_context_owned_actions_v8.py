"""Regress foreign description contamination and complex-owner fallback; offline only."""
import _bootstrap
import copy
import json
import unittest
from ai_ui_layers import context_references as context
from ai_ui_layers.execution_preflight import preflight
from ai_ui_layers.freeze_visual import freeze
from ai_ui_layers.evaluate import read
import test_context_references
import test_context_short_v5


class OwnedActionsTests(unittest.TestCase):
    def setUp(self):
        self.visual,self.plan=test_context_short_v5.layered_fixture(*test_context_short_v5.FIXTURES[0])
        self.key='harbor-band'

    def text(self,visual=None,ids=None,group=None):
        return context.prompt(visual or self.visual,self.plan,ids or [self.key],group,version='v8')

    def test_foreign_appearance_cannot_become_a_generation_instruction(self):
        old=copy.deepcopy(self.visual);text=self.text()
        changed=copy.deepcopy(self.visual)
        for obj in changed['objects']:
            if obj['materialId']!=self.key:
                obj['label']='FOREIGN DRAWING CONTAMINATION: preserve all assembled buttons and frames.'
        for mat in changed['materials']:
            if mat['id']!=self.key:mat['label']='BROADER FOREIGN MATERIAL DESCRIPTION'
        self.assertEqual(self.text(changed),text)
        self.assertNotIn('FOREIGN DRAWING CONTAMINATION',text)
        self.assertNotEqual(context.prompt(changed,self.plan,[self.key],version='v7'),
                            context.prompt(old,self.plan,[self.key],version='v7'))
        self.assertEqual(self.visual,old)

    def test_every_foreign_member_has_identity_kind_relation_and_exact_locator(self):
        asset=next(a for a in self.plan['assets'] if a['id']==self.key)
        entry=context.action_entry(self.visual,next(m for m in self.visual['materials'] if m['id']==self.key),
            asset,context.geometry(asset,self.plan['canvas']),self.plan['canvas'],0)
        deletes=[json.loads(line.removeprefix('DELETE ')) for line in self.text().splitlines() if line.startswith('DELETE {')]
        expected=[(owner,member) for owner in entry['exclude'] for member in owner['members']]
        self.assertEqual(len(deletes),len(expected))
        for action,(owner,member) in zip(deletes,expected):
            self.assertEqual(action['objectId'],member['id'])
            self.assertEqual(action['materialId'],owner['materialId'])
            self.assertEqual(action['relation'],owner['relation'])
            self.assertEqual(action['referenceBox'],member.get('referenceBox',owner['referenceBox']))
            self.assertNotIn('appearance',action)
        self.assertEqual({row['relation'] for row in deletes},{'overlay','underlay','same-depth'})

    def test_missing_foreign_object_catalog_cannot_silently_omit_deletion(self):
        changed=copy.deepcopy(self.visual)
        owner=next(o['materialId'] for o in changed['objects'] if o['materialId']!=self.key)
        changed['objects']=[o for o in changed['objects'] if o['materialId']!=owner]
        with self.assertRaisesRegex(ValueError,'GENERATION_FOREIGN_OBJECTS_REQUIRED'):
            self.text(changed)

    def test_multi_part_owner_keeps_each_anchor_state_icon_text_and_real_openings(self):
        text=self.text()
        keeps=[json.loads(line.removeprefix('KEEP ')) for line in text.splitlines() if line.startswith('KEEP {')]
        self.assertEqual(len(keeps),4)
        self.assertEqual(sum(row['appearance']=='jade silver pin in its lowered state' for row in keeps),2)
        self.assertNotEqual(keeps[1]['withinMaterial'],keeps[2]['withinMaterial'])
        self.assertIn('genuine crescent opening',text);self.assertIn('["READY"]',text)
        self.assertIn('single-character icon pictograms',text)
        self.assertIn('no foreign frame, control, icon, backing or shadow',text)
        self.assertLess(text.index('DELETE {'),text.index('KEEP {'))
        self.assertTrue(text.startswith('OWNERSHIP FIRST.'))

    def test_assembled_owner_description_never_overrides_separate_child_assignment(self):
        changed=copy.deepcopy(self.visual)
        changed['objects'][0]['label']='Base panel with a button mentioned in this source note.'
        text=self.text(changed)
        self.assertIn(changed['objects'][0]['label'],text)
        self.assertIn('including descriptions in KEEP that mention an assembled control',text)
        self.assertIn('All separately assigned children must be absent',text)
        self.assertLess(text.index('DELETE {'),text.index(changed['objects'][0]['label']))

    def test_underlay_track_is_deleted_for_independent_fill_without_erasing_owned_surface(self):
        text=self.text(ids=['turn-knob'])
        deletes=[json.loads(line[7:]) for line in text.splitlines() if line.startswith('DELETE {')]
        self.assertIn(self.key,{row['materialId'] for row in deletes})
        self.assertIn('do not copy a parent track, card or panel',text)
        self.assertIn('Preserve owned identity, state, count, complete contours',text)
        self.assertIn('not masks or measured alpha bounds',text)

    def test_translucent_plate_excludes_background_and_background_v8_locks_composition(self):
        text = self.text()
        self.assertIn('Scene visible THROUGH a translucent panel belongs to the background',text)
        self.assertIn('represent the panel tint and opacity in alpha',text)
        visual,plan = copy.deepcopy(self.visual),copy.deepcopy(self.plan)
        key = 'scene'
        visual['materials'].append(dict(id=key,role='background',zOrder=0,label='Existing scene and vehicle',
            bboxNorm=[0,0,1,1],preserveText=[]))
        plan['assets'].append(dict(id=key,role='background',source_region=[0,0,1000,1000],output_size=[1000,1000]))
        current = context.prompt(visual,plan,[key],version='v8')
        legacy = context.prompt(visual,plan,[key],version='v7')
        self.assertIn('COMPOSITION LOCK',current)
        self.assertIn('Do not zoom, enlarge, recenter or relocate',current)
        self.assertNotIn('COMPOSITION LOCK',legacy)

    def test_owned_illustration_interior_is_preserved_without_transferring_context(self):
        from ai_ui_layers import visual_prompt_contract
        changed=copy.deepcopy(self.visual)
        owner=next(o for o in changed['objects'] if o['materialId']=='turn-knob')
        owner['label']='Owned illustration with its own garage floor and reflection.'
        text=self.text(changed,ids=['turn-knob'])
        self.assertIn(owner['label'],text)
        self.assertIn('Explicitly KEEP-owned illustration interiors retain their',text)
        self.assertIn('including opaque pixels inside that artwork',text)
        self.assertIn('does not transfer ownership from DELETE or context',text)
        self.assertIn('透过半透明面板看到的共享场景仍由背景图层绘制',visual_prompt_contract.GENERATION)
        self.assertNotIn('不画棋盘格或不透明背景',visual_prompt_contract.GENERATION)

    def test_sheet_and_repeated_foreign_appearances_use_actions_without_v6_fallback(self):
        changed=copy.deepcopy(self.visual)
        for obj in changed['objects']:
            if obj['materialId']!=self.key:obj['label']='identical source mark'
        text=self.text(changed,[self.key,'turn-knob'],dict(grid=[1,2],outputSize=[800,900]))
        self.assertTrue(text.startswith('OWNERSHIP FIRST.'))
        self.assertIn('Stack cells vertically, top to bottom',text)
        self.assertIn('Cell 1 uses zero-based column 0, row 1',text)
        self.assertIn("never delete another cell's KEEP",text)
        self.assertIn('turn-knob-body',text);self.assertIn('turn-knob-rim',text)
        self.assertNotIn('Remove these foreign overlays:',text)


class OwnedActionsFreezeTests(unittest.TestCase):
    bind=test_context_references.ContextReferencesTests.bind
    resign=test_context_references.ContextReferencesTests.resign
    def setUp(self):test_context_references.ContextReferencesTests.setUp(self)

    def test_v8_frozen_actions_cannot_be_rehashed_away_and_geometry_is_unchanged(self):
        current=self.root/'v8';old=self.root/'v7'
        manifest=freeze(self.run,current,16,'sheets','context-crops',context_prompt_version='v8')
        freeze(self.run,old,16,'sheets','context-crops',context_prompt_version='v7')
        self.assertEqual(preflight(current,manifest['digest'])['inputChecks'],'passed')
        for name in ('placements.json','generation-references.json','generation-groups.json'):
            self.assertEqual(read(current/name),read(old/name))
        for row in read(current/'requests.json')['requests']:
            if row['asset']=='asset-scene':continue
            text=(current/row['prompt']).read_text('utf-8')
            self.assertTrue(text.startswith('OWNERSHIP FIRST.'))
        path=current/'materials/asset-panel/prompt.txt'
        path.write_text(path.read_text('utf-8').replace('DELETE ', 'KEEP '),encoding='utf-8')
        with self.assertRaisesRegex(ValueError,'PROMPT_COMPILER_MISMATCH'):
            preflight(current,self.resign(current))


if __name__=='__main__':unittest.main()
