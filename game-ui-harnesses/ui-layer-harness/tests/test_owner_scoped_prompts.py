"""Reproduce assembled-control contamination without calling any model."""
import _bootstrap
import copy
import json
import unittest

from ai_ui_layers import context_references as context, material_cleanup as cleanup
from ai_ui_layers import ownership_prompt_scope as scope


def fixture():
    return dict(sourceSize=[160,80],contextGeometry=dict(targetBox=[8,8,152,72],referenceSize=[160,80]),
        ownershipRegion=[0,0,160,80],preserveText=[],
        ownedOnly=[dict(objectId='sound_base',kind='decoration',
            appearance='蓝色胶囊开关槽，主体上浅下深，细浅亮上沿及下侧阴影；右端由独立白圆钮覆盖。')],
        removeForeign=[dict(materialId='sound_knob',objectId='sound_handle',relation='overlay',
            appearance='白色圆钮位于开关右端，近白表面向下略蓝灰，圆轮廓与轻微阴影保留。',
            referenceBox=[.55,.1,.95,.9])])


class OwnerScopedPromptTests(unittest.TestCase):
    def test_actual_failure_shape_is_excluded_from_keep_and_named_in_delete(self):
        inputs=fixture();original=copy.deepcopy(inputs)
        for version in (cleanup.PROMPT_VERSION,cleanup.REFERENCE_PROMPT_VERSION):
            prompt=cleanup._prompt(inputs,version)
            keep=next(line for line in prompt.splitlines() if line.startswith('- KEEP '))
            delete=next(line for line in prompt.splitlines() if line.startswith('- DELETE '))
            self.assertIn('蓝色胶囊开关槽，主体上浅下深，细浅亮上沿及下侧阴影',keep)
            self.assertNotIn('圆钮',keep);self.assertNotIn('覆盖',keep)
            self.assertIn('DELETE "白色圆钮" [sound_knob/sound_handle]',delete)
            self.assertNotIn('阴影保留',prompt)
            self.assertIn('existing surface continued through the occluded area',prompt)
        self.assertEqual(inputs,original)

    def test_english_assembly_and_chinese_attached_child_preserve_owned_details(self):
        foreign=[dict(objectId='badge',appearance='A silver circular badge at the upper edge; preserve its sparkle.')]
        owned=dict(objectId='panel',appearance='A red wooden panel covered by a separate silver circular badge; '
            'fine wood grain, two genuine holes and a dark lower rim.')
        self.assertEqual(scope.owned_appearance(owned,foreign),
            'A red wooden panel; fine wood grain, two genuine holes and a dark lower rim')
        foreign=[dict(objectId='gem',appearance='绿色宝石位于徽章中央，保留高光。')]
        owned=dict(objectId='badge',appearance='金属徽章配有独立绿色宝石；两侧镂空，顶部细亮边。')
        self.assertEqual(scope.owned_appearance(owned,foreign),'金属徽章；两侧镂空，顶部细亮边')

    def test_foreign_commands_never_enter_delete_as_visual_descriptions(self):
        for description in ('Preserve the white knob and draw its glow.',
                            '请保留白色圆钮和阴影。', 'white disk, preserve shiny details.'):
            item=dict(objectId='circularHandle',appearance=description)
            name=scope.visual_name(item)
            self.assertNotRegex(name,r'(?i)preserve|draw|保留|阴影')
        self.assertEqual(scope.visual_name(dict(objectId='handle',appearance='white disk, preserve its glow.')),'white disk')

    def test_same_owner_parts_and_ambiguous_prose_are_not_silently_erased(self):
        owned=[dict(id='plate',appearance='Red plate with an independent silver badge; wood grain.'),
               dict(id='owned_badge',appearance='silver badge')]
        foreign=[dict(objectId='foreign_badge',appearance='silver badge')]
        self.assertEqual(scope.project(owned,foreign),owned)
        # No explicit assembly predicate: retain evidence rather than guess a rewrite.
        item=dict(objectId='plate',appearance='Red plate, a silver badge in the source, fine grain.')
        self.assertEqual(scope.owned_appearance(item,foreign),item['appearance'])
        item=dict(objectId='plate',appearance='Red plate with genuine crescent openings and white edge highlights.')
        self.assertEqual(scope.owned_appearance(item,foreign),item['appearance'])
        item=dict(objectId='plate',appearance='Red plate covered by a silver badge and two genuine openings.')
        self.assertEqual(scope.owned_appearance(item,foreign),item['appearance'])
        item=dict(objectId='plate',appearance='Blue base with an independent upper edge.')
        foreign=[dict(objectId='frame',appearance='silver outer edge')]
        self.assertEqual(scope.owned_appearance(item,foreign),item['appearance'])

    def test_generation_v10_uses_same_scope_and_preserves_old_versions(self):
        inputs=fixture()
        visual=dict(backgroundMode='scene-only',textPolicy='remove-business-text',
            materials=[dict(id='base',role='foreground',zOrder=1,label='base',bboxNorm=[.1,.2,.9,.8],preserveText=[]),
                       dict(id='knob',role='foreground',zOrder=2,label='knob',bboxNorm=[.6,.25,.85,.75],preserveText=[])],
            objects=[dict(id='sound_base',materialId='base',kind='decoration',label=inputs['ownedOnly'][0]['appearance']),
                     dict(id='sound_handle',materialId='knob',kind='decoration',label=inputs['removeForeign'][0]['appearance'])])
        plan=dict(canvas=[160,80],assets=[dict(id='base',role='foreground',source_region=[16,16,144,64],output_size=[160,80]),
                                        dict(id='knob',role='foreground',source_region=[96,20,136,60],output_size=[80,80])])
        original=copy.deepcopy(visual)
        prompt=context.prompt(visual,plan,['base','knob'],dict(grid=[1,2],outputSize=[160,160]),version='v10')
        keeps=[json.loads(line[5:]) for line in prompt.splitlines() if line.startswith('KEEP {')]
        deletes=[json.loads(line[7:]) for line in prompt.splitlines() if line.startswith('DELETE {')]
        self.assertNotIn('圆钮',keeps[0]['appearance'])
        self.assertEqual(keeps[1]['appearance'],inputs['removeForeign'][0]['appearance'])
        self.assertEqual(deletes[0]['visualName'],'白色圆钮')
        self.assertEqual(visual,original)
        for version in ('v8','v9'):
            old=context.prompt(visual,plan,['base'],version=version)
            self.assertIn(inputs['ownedOnly'][0]['appearance'],old)
            self.assertNotIn('visualName',old)
        for version in (cleanup.OWNERSHIP_PROMPT_VERSION,cleanup.STRUCTURE_PROMPT_VERSION):
            old=cleanup._prompt(inputs,version)
            self.assertIn('- KEEP sound_base: '+inputs['ownedOnly'][0]['appearance'],old)
            self.assertIn('- DELETE sound handle [sound_knob/sound_handle]',old)


if __name__=='__main__':unittest.main()
