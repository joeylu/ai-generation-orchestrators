import unittest
from ai_ui_decomposition.common import ContractError
from ai_ui_decomposition.scrollbar_thumb_slices import validate_thumb_slices
from ai_ui_decomposition.component_handoff import _validate_state_text_colors


class ThumbSlicesTests(unittest.TestCase):
    def setUp(self):self.value={'version':'1.0','coordinateSpace':'thumb-source-pixels','top':6,'bottom':6}
    def test_valid_and_zero_end(self):
        self.assertEqual(validate_thumb_slices(self.value,60,True),self.value)
        validate_thumb_slices({**self.value,'top':0},60,True)
        validate_thumb_slices({**self.value,'top':6.0},60,True)
    def test_invalid_types_versions_fields_and_extent(self):
        changes=[{'version':'2.0'},{'coordinateSpace':'target-component-local'},{'top':True},{'bottom':1.5},{'top':-1},{'bottom':float('inf')},{'top':None},{'top':54},{'capInsets':6}]
        for change in changes:
            with self.subTest(change=change),self.assertRaises(ContractError):validate_thumb_slices({**self.value,**change},60,True)
        for height in [0,float('nan'),float('inf'),12]:
            with self.subTest(height=height),self.assertRaises(ContractError):validate_thumb_slices(self.value,height,True)
    def test_insets_mandatory_and_legacy_unchanged(self):
        with self.assertRaisesRegex(ContractError,'INSETS_REQUIRED'):validate_thumb_slices(self.value,60,False)
        _validate_state_text_colors({'bindings':[{'componentType':'ScrollView','states':{'scrollView':{'thumbPositions':{}}}}]})
    def test_export_accepts_exact_field_rejects_missing_insets(self):
        state={'scrollbarInsets':{'version':'1.0','top':32,'bottom':32},'scrollbarThumbSlices':self.value}
        binding={'bindings':[{'componentType':'ScrollView','states':{'scrollView':state}}]}
        _validate_state_text_colors(binding)
        del state['scrollbarInsets']
        with self.assertRaisesRegex(ContractError,'INSETS_REQUIRED'):_validate_state_text_colors(binding)
