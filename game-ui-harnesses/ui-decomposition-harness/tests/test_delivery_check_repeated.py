import unittest
from ai_ui_decomposition.delivery_check import select_default_parts
from ai_ui_decomposition.common import ContractError
class RepeatedDefaultTests(unittest.TestCase):
 def select(self,n,parts,states=None):
  return select_default_parts({'root':n},{'bindings':[{'componentId':n['id'],'parts':parts,'states':states or {}}]})
 def test_tabs_expands_templates_and_keeps_inactive_parts_standby(self):
  n={'id':'t','type':'Tabs','layout':{'width':200,'height':100},'props':{'tabs':[{'id':'a'},{'id':'b'}],'activeId':'b'}}
  r=self.select(n,[{'role':x} for x in ['tab','active-tab']],{'tabs':{'headerHeight':40}})
  self.assertEqual([(x['tabId'],x['role']) for x in r['selected']],[('a','tab'),('b','active-tab')]);self.assertEqual(r['selected'][1]['itemLayout']['x'],100)
 def test_list_repeats_source_template_without_selecting_every_row(self):
  n={'id':'l','type':'List','layout':{'width':100,'height':40},'props':{'items':[{'id':'a'},{'id':'b'}],'itemHeight':30,'selectedId':'b'}}
  r=self.select(n,[{'role':'row','itemId':'a'},{'role':'selected-row','itemId':'a'}])
  self.assertEqual([(x['itemId'],x['role']) for x in r['selected']],[('a','row'),('b','selected-row')]);self.assertEqual(r['selected'][1]['position']['y'],30);self.assertEqual(r['selected'][1]['clip']['height'],40)
 def test_select_initial_popup_is_standby(self):
  n={'id':'s','type':'Select','props':{}}
  r=self.select(n,[{'role':x} for x in ['background','indicator','popup']]);self.assertEqual([x['role'] for x in r['selected']],['background','indicator']);self.assertEqual(r['standby'][0]['role'],'popup')
 def test_scroll_external_track_uses_runtime_ratio_not_short_texture(self):
  n={'id':'s','type':'ScrollView','layout':{'width':100,'height':100},'props':{'contentWidth':100,'contentHeight':200,'scrollX':0,'scrollY':50,'appearance':{'sourceCanvas':{'width':100,'height':100},'viewport':{'layout':{'x':0,'y':0,'width':80,'height':100}},'scrollbarTrack':{'layout':{'x':110,'y':0,'width':10,'height':100}},'scrollbarThumbCanvas':{'width':10,'height':10},'scrollbarThumbPositions':{'min':{'x':110,'y':0},'max':{'x':110,'y':90}}}}}
  r=self.select(n,[{'role':'scrollbar-thumb'}]);self.assertEqual(r['selected'][0]['size']['height'],50);self.assertEqual(r['selected'][0]['position'],{'x':110,'y':25})
  n['props']['scrollX']=1
  with self.assertRaisesRegex(ContractError,'HORIZONTAL_SCROLL'):self.select(n,[{'role':'scrollbar-thumb'}])
