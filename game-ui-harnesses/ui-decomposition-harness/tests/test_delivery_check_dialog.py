import unittest
from ai_ui_decomposition.delivery_check import select_default_parts
class DialogProgressDefaultTests(unittest.TestCase):
 def test_closed_dialog_hides_descendants_and_progress_clips(self):
  progress={'id':'p','type':'ProgressBar','props':{'value':8,'max':10}}
  d={'root':{'id':'d','type':'Dialog','props':{'open':False},'children':[progress]}}
  b={'bindings':[{'componentId':'d','parts':[{'role':'background'}]},{'componentId':'p','parts':[{'role':'track'},{'role':'fill'}],'states':{'progressBar':{'fillClip':{'width':100}}}}]}
  r=select_default_parts(d,b)
  self.assertEqual(r['issues'],[]);self.assertEqual(r['selected'],[]);self.assertEqual(r['standby'][-1]['clip']['width'],80)
  d['root']['props']['open']=True
  r=select_default_parts(d,b);self.assertEqual(len(r['selected']),3);self.assertEqual(r['standby'],[])
