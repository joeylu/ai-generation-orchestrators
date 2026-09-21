import _bootstrap  # Enable source-layout imports for unittest discovery.
import unittest
from ai_ui_layers.short_prompt import build,exclusions,carries_foreground


class ShortPromptTests(unittest.TestCase):
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
        self.assertEqual(exclusions(plan,panel),[{'material':'Illustration unit','excludeArtwork':['Laurel, stars and ribbon']}])
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
