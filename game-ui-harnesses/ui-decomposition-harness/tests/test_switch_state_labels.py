import unittest
from ai_ui_decomposition.component_handoff import _validate_state_text_colors
from ai_ui_decomposition.common import ContractError
class SwitchStateLabelTests(unittest.TestCase):
 def test_strict_pair_and_layout_fields(self):
  area={'coordinateSpace':'target-component-local','x':1,'y':2,'width':10,'height':12}
  row={'componentType':'Switch','states':{'switch':{'stateLabelLayouts':{'on':area,'off':area}}}}
  _validate_state_text_colors({'bindings':[row]})
  row['states']['switch']['stateLabelLayouts']['off']={**area,'widht':10}
  with self.assertRaisesRegex(ContractError,'SWITCH_LABEL_LAYOUT_INVALID'):_validate_state_text_colors({'bindings':[row]})
 def test_wrong_component_and_unknown_field_rejected(self):
  with self.assertRaisesRegex(ContractError,'STATE_TYPE_MISMATCH'):_validate_state_text_colors({'bindings':[{'componentType':'Button','states':{'switch':{}}}]})
  with self.assertRaisesRegex(ContractError,'UNKNOWN_STATE_FIELD'):_validate_state_text_colors({'bindings':[{'componentType':'Switch','states':{'switch':{'stateLabelLayout':{}}}}]})
