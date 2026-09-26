import _bootstrap  # Enable source-layout imports for unittest discovery.
import unittest
from ai_ui_layers.short_prompt import build,exclusions,carries_foreground,object_content


class ShortPromptTests(unittest.TestCase):
    def test_one_icon_with_anchored_decorative_text_keeps_the_text_in_compact_prompt(self):
        from ai_ui_layers.short_prompt import is_compact_labeled_icon
        material=dict(id='icon',label='Flags and paint palette',role='foreground',
                      bboxNorm=[.2,.2,.3,.4],preserveText=['.CPP'])
        visual=dict(backgroundMode='scene-only',textPolicy='remove-business-text',
                    materials=[material],objects=[
                        dict(id='body',materialId='icon',kind='icon',label='Flags and palette',bboxNorm=None),
                        dict(id='mark',materialId='icon',kind='decoration',label='.CPP on white card',
                             bboxNorm=[.22,.3,.27,.35])])
        self.assertTrue(is_compact_labeled_icon(visual,material))
        prompt=build(visual,'icon',[1000,500])
        self.assertIn('.CPP',prompt)
        self.assertIn('Extract only the existing icon',prompt)
        self.assertIn('x=200..300, y=100..200',prompt)
        self.assertLess(len(prompt),320)
        self.assertNotIn('withinMaterial',prompt)
        material['preserveText']=['OTHER']
        self.assertFalse(is_compact_labeled_icon(visual,material))

    def test_atomic_template_uses_frozen_pixel_size_without_layout_or_text_reflow(self):
        import copy
        from ai_ui_layers.short_prompt import is_atomic_artwork
        m=dict(id='graphic',label='Pale strip',role='foreground',bboxNorm=[.878,.28,.893,.772],preserveText=[])
        v=dict(backgroundMode='scene-only',textPolicy='remove-business-text',materials=[m],
               objects=[dict(id='shape',materialId='graphic',label='Centered shape',kind='decoration',bboxNorm=m['bboxNorm'])])
        before=copy.deepcopy(v)
        prompt=build(v,'graphic',[1024,1536])
        self.assertIn('16x756',prompt)
        self.assertIn('0.0212:1',prompt)
        self.assertNotIn('withinMaterial',prompt)
        self.assertNotIn('deleted label',prompt)
        self.assertNotIn('Centered shape',prompt)
        self.assertEqual(v,before)
        for kind in ['button','card','illustration','panel','logo']:
            v['objects'][0]['kind']=kind
            self.assertFalse(is_atomic_artwork(v,m))
        v['objects'][0]['kind']='icon'
        self.assertTrue(is_atomic_artwork(v,m))
        v['objects'][0]['bboxNorm']=None
        self.assertTrue(is_atomic_artwork(v,m))
        compact=build(v,'graphic',[1024,1536])
        self.assertNotIn('withinMaterial',compact)
        self.assertLess(len(compact),300)
        v['objects'][0]['kind']='decoration'
        self.assertFalse(is_atomic_artwork(v,m))
        v['objects'][0]['kind']='icon'
        v['objects'][0]['bboxNorm']=[.879,.3,.889,.7]
        self.assertFalse(is_atomic_artwork(v,m))
        self.assertIn('withinMaterial',build(v,'graphic',[1024,1536]))
        v['objects'][0]['bboxNorm']=m['bboxNorm'];m['preserveText']=['A']
        self.assertFalse(is_atomic_artwork(v,m))

    def test_nested_parts_exclude_localized_foreign_artwork_without_rebuilding_assembly(self):
        import copy
        from ai_ui_layers.generation_groups import sheet_prompt
        from ai_ui_layers.short_prompt import OWNERSHIP_SCOPE
        materials=[dict(id='shell',label='Thin outer rim with end ornaments',role='foreground',
                        bboxNorm=[.7,.2,.8,.9],preserveText=[]),
                   dict(id='insert',label='Pale inner strip',role='foreground',
                        bboxNorm=[.73,.25,.77,.85],preserveText=[])]
        visual=dict(backgroundMode='scene-only',textPolicy='remove-business-text',materials=materials,
                    objects=[dict(id=m['id']+'-object',materialId=m['id'],label=m['label'],
                                  kind='decoration',bboxNorm=m['bboxNorm']) for m in materials])
        before=copy.deepcopy(visual)
        for owner,foreign in [('insert','shell'),('shell','insert')]:
            prompt=build(visual,owner,[1000,1500])
            self.assertIn(OWNERSHIP_SCOPE,prompt)
            self.assertIn('"referenceBox":',prompt)
            self.assertIn(next(m['label'] for m in materials if m['id']==foreign),prompt)
            self.assertNotIn('Restore owned surfaces behind removed content',prompt)
            self.assertNotIn('Continue only this material',prompt)
            self.assertIn('do not borrow',prompt)
        sheet=sheet_prompt(visual,{'assets':[dict(id=m['id'],output_size=[50,600]) for m in materials]},
                           dict(materialIds=['shell','insert'],outputSize=[1000,1000],grid=[2,1]))
        self.assertTrue(sheet.startswith('Use the full reference image'))
        self.assertIn(OWNERSHIP_SCOPE,sheet)
        self.assertIn('retain only borders visible on this owned artwork',sheet)
        self.assertEqual(visual,before)

    def test_conflicting_center_label_cannot_override_offset_icon_geometry(self):
        import copy,json
        from ai_ui_layers.generation_groups import sheet_prompt
        material=dict(id='tab',label='Pale tab',role='foreground',bboxNorm=[.2,.3,.6,.5],preserveText=[])
        visual=dict(backgroundMode='scene-only',textPolicy='remove-business-text',materials=[material],
            objects=[dict(id='icon',materialId='tab',kind='icon',label='Lightning centered in the tab',
                          bboxNorm=[.3,.35,.34,.45]),
                     dict(id='base',materialId='tab',kind='button',label='Pale surface',bboxNorm=None)])
        before=copy.deepcopy(visual)
        content=object_content(visual,material)
        self.assertEqual(content[0]['withinMaterial'],dict(centerX=.3,centerY=.5,width=.1,height=.5))
        self.assertEqual(content[1],{'artwork':'Pale surface'})
        single=build(visual,'tab',[1000,2000])
        sheet=sheet_prompt(visual,{'assets':[dict(id='tab',output_size=[400,400])]},
                           dict(materialIds=['tab'],outputSize=[1000,1000],grid=[1,1]))
        for prompt in [single,sheet]:
            self.assertNotIn('Lightning centered',prompt)
            self.assertIn('"centerX": 0.3',prompt)
            self.assertIn('"width": 0.1',prompt)
            self.assertIn('Pale surface',prompt)
            self.assertIn('one rigid group',prompt)
        self.assertEqual(visual,before)

    def test_anchored_decoration_keeps_appearance_without_control_layout_labels(self):
        material=dict(id='board',label='Parchment board',role='foreground',
                      bboxNorm=[.1,.1,.9,.9],preserveText=[])
        visual=dict(backgroundMode='scene-only',textPolicy='remove-business-text',materials=[material],
            objects=[dict(id='divider',materialId='board',kind='decoration',
                          label='Thin gold divider with hollow diamond ends and central leaf motif',
                          bboxNorm=[.3,.3,.7,.34]),
                     dict(id='icon',materialId='board',kind='icon',
                          label='Lightning centered and enlarged inside button',
                          bboxNorm=[.2,.5,.24,.54])])
        prompt=build(visual,'board',[1000,1000])
        self.assertIn('hollow diamond ends and central leaf motif',prompt)
        self.assertIn('"referenceBox": [0.3, 0.3, 0.7, 0.34]',prompt)
        self.assertNotIn('Lightning centered and enlarged',prompt)
        self.assertIn('"referenceBox": [0.2, 0.5, 0.24, 0.54]',prompt)

    def test_sheet_deduplicates_foreign_artwork_without_losing_exclusion_members(self):
        import json
        from ai_ui_layers.generation_groups import sheet_prompt
        visual={'materials':[dict(id=k,label=k,role='foreground',bboxNorm=box,preserveText=[])
                             for k,box in [('panel',[0,0,1,1]),('a',[.1,.1,.4,.3]),('b',[.6,.1,.9,.3])]],
                'objects':[dict(id='ornament',materialId='panel',label='Gold laurel and ribbon',bboxNorm=None)]}
        prompt=sheet_prompt(visual,{'assets':[dict(id=k,output_size=[300,200]) for k in ['a','b']]},
                            dict(materialIds=['a','b'],outputSize=[1000,1000],grid=[2,1]))
        self.assertEqual(prompt.count('Gold laurel and ribbon'),1)
        entries=json.loads(prompt.split('. Entries: ',1)[1])
        self.assertEqual(entries[0]['excludeReferences'],entries[1]['excludeReferences'])
        self.assertEqual(entries[0]['excludeReferences'],['foreign-0'])

    def test_compact_sheet_variant_keeps_small_icon_geometry_and_identity(self):
        import json
        from ai_ui_layers.generation_groups import compact_sheet_prompt
        visual={'materials':[dict(id='card-a',label='First card',role='foreground',bboxNorm=[.1,.1,.5,.5],preserveText=[]),
                             dict(id='card-b',label='Second card',role='foreground',bboxNorm=[.5,.1,.9,.5],preserveText=[])],
                'objects':[dict(id='surface',materialId='card-a',kind='card',bboxNorm=[.1,.1,.5,.5],label='Card'),
                           dict(id='small-icon',materialId='card-a',kind='icon',bboxNorm=[.3,.3,.34,.34],label='Coin beside deleted price'),
                           dict(id='other',materialId='card-b',kind='card',bboxNorm=[.5,.1,.9,.5],label='Second')]}
        plan={'assets':[dict(id='card-a',output_size=[400,400]),dict(id='card-b',output_size=[400,400])]}
        group=dict(mode='sheet',materialIds=['card-a','card-b'],grid=[2,1],outputSize=[800,400])
        prompt=compact_sheet_prompt(visual,plan,group)
        entries=json.loads(prompt.split('Entries: ',1)[1])
        icon=next(o for o in entries[0]['parts'] if o['kind']=='icon')
        self.assertEqual(icon['size'][0],.1)
        self.assertEqual(icon['center'][0],.55)
        self.assertNotIn('Coin beside deleted price',prompt)
        self.assertIn('Do not enlarge an icon',prompt)
        self.assertIn('canvas aspect 800:400',prompt)
        self.assertEqual([e['materialId'] for e in entries],group['materialIds'])

    def test_portrait_card_group_receives_pixel_ratio_and_only_owned_anchors(self):
        plan={'backgroundMode':'scene-only','textPolicy':'remove-business-text',
              'materials':[dict(id='cards',label='Repeated cards',role='foreground',
                               bboxNorm=[.1,.2,.9,.8],preserveText=[])],
              'objects':[dict(id='first',materialId='cards',label='Card with left icon',kind='card',bboxNorm=[.1,.2,.9,.3]),
                         dict(id='second',materialId='cards',label='Second card',kind='card',bboxNorm=None),
                         dict(id='foreign',materialId='other',label='Other object',bboxNorm=[0,0,1,1])]}
        prompt=build(plan,'cards',[1000,2000])
        self.assertIn('0.6667:1',prompt)
        self.assertIn('"referenceBox": [0.1, 0.2, 0.9, 0.3]',prompt)
        self.assertNotIn('foreign',prompt)
        self.assertNotIn('null',prompt)
        self.assertIn('single uniform scale',prompt)
        self.assertIn('do not add glow',prompt)
        self.assertIn('EVERY side',prompt)

    def test_carrier_is_continuous_surface_not_a_separated_group(self):
        from ai_ui_layers.compile_visual import HARNESS
        from ai_ui_layers.evaluate import read
        plan=read(HARNESS/'planning-harness/examples/visual-plan-scoped.json')
        prompt=build(plan,'asset-panel',[1600,900])
        self.assertIn('removeCompletely',prompt)
        self.assertIn('not transparent holes',prompt)
        self.assertIn('removal takes precedence',prompt)
        self.assertIn('Preserve any genuine original openings',prompt)
        self.assertNotIn('Keep grouped shapes separate',prompt)
        self.assertNotIn('no shared backing',prompt)
    def test_artwork_ratio_uses_reference_pixel_aspect_not_normalized_box(self):
        from ai_ui_layers.compile_visual import HARNESS
        from ai_ui_layers.evaluate import read
        plan=read(HARNESS/'planning-harness/examples/visual-plan-scoped.json')
        panel=next(m for m in plan['materials'] if m['id']=='asset-panel')
        l,t,r,b=panel['bboxNorm']
        expected=(r-l)*1600/((b-t)*900)
        prompt=build(plan,panel['id'],[1600,900])
        self.assertIn(f'{expected:.4f}:1',prompt)
        self.assertIn('EXCLUDING transparent padding',prompt)

    def test_carrier_spacing_applies_to_panel_not_small_foreground_or_background(self):
        from ai_ui_layers.compile_visual import HARNESS
        from ai_ui_layers.evaluate import read
        plan=read(HARNESS/'planning-harness/examples/visual-plan-scoped.json')
        panel=next(m for m in plan['materials'] if m['id']=='asset-panel')
        self.assertTrue(carries_foreground(plan,panel))
        self.assertIn('Do not shorten the panel',build(plan,panel['id']))
        for m in plan['materials']:
            if m['id']!=panel['id']:
                self.assertNotIn('Do not shorten the panel',build(plan,m['id']))
        # A panel merely overlapping a larger/lower carrier is not itself a carrier.
        for m in plan['materials']:
            if m['id']!=panel['id']:m['zOrder']=0
        self.assertFalse(carries_foreground(plan,panel))

    def test_excludes_other_overlapping_artwork_not_own_or_distant_decorations(self):
        panel={'id':'panel','label':'Panel','role':'foreground','bboxNorm':[.1,.1,.9,.9],'preserveText':[]}
        plan={'backgroundMode':'preserve-underlay','textPolicy':'remove-business-text',
              'materials':[panel,{'id':'art','label':'Illustration unit','role':'foreground','bboxNorm':[.3,.2,.7,.6]},
                           {'id':'far','label':'Outside','role':'foreground','bboxNorm':[.91,0,1,.08]},
                           {'id':'bg','label':'Scene','role':'background','bboxNorm':[0,0,1,1]}],
              'objects':[{'materialId':'panel','label':'Gold divider'},
                         {'materialId':'art','label':'Laurel, stars and ribbon'},
                         {'materialId':'far','label':'Distant icon'}]}
        self.assertEqual(exclusions(plan,panel),[{'material':'Illustration unit','referenceBox':[.3,.2,.7,.6],'excludeArtwork':['Laurel, stars and ribbon']}])
        prompt=build(plan,'panel')
        self.assertIn('Gold divider',prompt)
        self.assertIn('Laurel, stars and ribbon',prompt)
        self.assertIn('do not leave empty placeholders',prompt)
        self.assertNotIn('Distant icon',prompt)

    def test_unique_text_constraint_stays_local(self):
        from ai_ui_layers.codex_call import transport_schema
        from ai_ui_layers.evaluate import check_relations
        schema={'type':'array','uniqueItems':True,'items':{'type':'string'}}
        self.assertNotIn('uniqueItems',transport_schema(schema))
        self.assertTrue(schema['uniqueItems'])
        from ai_ui_layers.compile_visual import HARNESS
        from ai_ui_layers.evaluate import read
        plan=read(HARNESS/'planning-harness/examples/visual-plan-scoped.json')
        plan['materials'][0]['preserveText']=['LOGO','LOGO']
        self.assertIn('DUPLICATE_PRESERVE_TEXT',[i['code'] for i in check_relations(plan)])

    def test_full_reference_and_ownership(self):
        plan = {'backgroundMode':'scene-only','textPolicy':'remove-business-text','materials': [{'id': 'card', 'label': 'Item card', 'preserveText':[],
                               'role': 'foreground', 'bboxNorm': [0, 0, 1, 1]}],
                'objects': [{'materialId': 'card', 'label': 'Bottle with card surface'},
                            {'materialId': 'other', 'label': 'Unrelated portrait'}]}
        prompt = build(plan, 'card')
        self.assertIn('Bottle with card surface', prompt)
        self.assertNotIn('Unrelated portrait', prompt)
        self.assertNotIn('Image 2', prompt)
        self.assertIn('transparent PNG', prompt)
        plan['materials'][0]['role'] = 'background'
        self.assertIn('full opaque image', build(plan, 'card'))
        self.assertNotIn('transparent PNG', build(plan, 'card'))

    def test_underlay_does_not_receive_scene_removal_and_exceptions_are_explicit(self):
        plan={'backgroundMode':'preserve-underlay','textPolicy':'remove-business-text',
              'materials':[{'id':'bg','label':'Dimmed task UI','role':'background','bboxNorm':[0,0,1,1],'preserveText':['WORLD']},
                           {'id':'modal','label':'Reward modal','role':'foreground','bboxNorm':[.1,.1,.9,.9],'preserveText':[]}],
              'objects':[{'materialId':'bg','label':'Underlying UI'}]}
        prompt=build(plan,'bg')
        self.assertIn('Keep the visible underlying UI',prompt)
        self.assertNotIn('Remove all UI surfaces',prompt)
        self.assertIn('["WORLD"]',prompt)
        self.assertIn('Reward modal',prompt)
        self.assertIn('preserveText list: []',build(plan,'modal'))
        del plan['backgroundMode']
        with self.assertRaisesRegex(ValueError,'EXPLICIT_SCOPE_REQUIRED'):build(plan,'bg')
