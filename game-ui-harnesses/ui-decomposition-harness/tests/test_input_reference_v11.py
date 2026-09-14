import unittest
from ai_ui_decomposition.reference_delivery import validate_states
class InputReferenceV11(unittest.TestCase):
    def fixture(self):
        observed=lambda value:dict(status='observed',value=value,evidence='Procedural test')
        node=dict(id='input',type='Input',props=dict(value='AB',inputType='text',maxLength=8,enabled=True,readOnly=False))
        document=dict(root=node)
        state=dict(kind='ui-reference-state',schemaVersion='1.1',components=[dict(componentId='input',componentType='Input',fields={k:observed(v) for k,v in dict(value='AB',focused=True,selectionStart=1,selectionEnd=1,selectionDirection='none',caretVisible=True).items()})])
        scope=dict(kind='ui-acceptance-scope',schemaVersion='1.0',referenceState='reference/reference-state.json',human_visual_acceptance=False,derivedTestStates=[],components=[dict(componentId='input',mode='compare',reason='Fixture')])
        return state,scope,document
    def test_known_and_unknown(self):
        state,scope,doc=self.fixture();self.assertEqual(validate_states(state,scope,doc),[])
        state['components'][0]['fields']['caretVisible']=dict(status='unknown',reason='Unobserved phase')
        self.assertEqual(validate_states(state,scope,doc),['input.caretVisible'])
    def test_invalid_focus_selection(self):
        for key,value in [('selectionStart',9),('focused',False),('selectionDirection','invalid')]:
            state,scope,doc=self.fixture();state['components'][0]['fields'][key]['value']=value
            with self.assertRaises(Exception):validate_states(state,scope,doc)
    def test_legacy(self):
        state,scope,doc=self.fixture();state['schemaVersion']='1.0';state['components'][0]['fields']={'value':state['components'][0]['fields']['value']}
        self.assertEqual(validate_states(state,scope,doc),[])
