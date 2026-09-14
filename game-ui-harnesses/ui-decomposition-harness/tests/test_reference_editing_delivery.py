import copy
import unittest
from ai_ui_decomposition.common import ContractError
from ai_ui_decomposition.reference_delivery import validate_states
import test_input_reference_v11 as fixtures


class EditingDeliveryTests(unittest.TestCase):
    def fixture(self):return fixtures.InputReferenceV11().fixture()

    def test_utf16_offsets_and_unknown_retained_selection(self):
        state,scope,doc=self.fixture();f=state['components'][0]['fields']
        f['value']['value']='😀';f['selectionStart']['value']=2;f['selectionEnd']['value']=2
        self.assertEqual(validate_states(state,scope,doc),[])
        f['focused']['value']=False;f['caretVisible']['value']=False
        for key in ('selectionStart','selectionEnd','selectionDirection'):
            f[key]={'status':'unknown','reason':'Unfocused selection is unobservable'}
        self.assertEqual(len(validate_states(state,scope,doc)),3)

    def test_disabled_and_readonly_cannot_show_caret(self):
        for key in ('enabled','readOnly'):
            state,scope,doc=self.fixture();doc['root']['props'][key]=key=='readOnly'
            with self.assertRaises(ContractError):validate_states(state,scope,doc)

    def test_unknown_focus_does_not_allow_visible_caret(self):
        state,scope,doc=self.fixture()
        state['components'][0]['fields']['focused']={'status':'unknown','reason':'Not observed'}
        with self.assertRaisesRegex(ContractError,'CARET_CONFLICT'):validate_states(state,scope,doc)

    def test_multiple_observed_focused_inputs_fail(self):
        state,scope,doc=self.fixture();second=copy.deepcopy(doc['root']);second['id']='second'
        doc['root']={'id':'root','type':'Container','children':[doc['root'],second]}
        row=copy.deepcopy(state['components'][0]);row['componentId']='second';state['components'].append(row)
        with self.assertRaisesRegex(ContractError,'MULTIPLE_FOCUSED'):validate_states(state,scope,doc)
