import os
import unittest
from pathlib import Path
from ai_ui_decomposition.common import ContractError
from ai_ui_decomposition.stateful_input import input_states,input_value
import test_stateful as fixtures
from ai_ui_decomposition.stateful import accept


class InputMetadataTests(unittest.TestCase):
    def node(self,**kwargs):
        return {'props':dict(inputType='text',maxLength=4,enabled=True,readOnly=False,value='Aria',**kwargs)}

    def test_explicit_test_values_never_change_reference(self):
        n=self.node()
        self.assertEqual(input_states(n),['initial','empty','edited','limit'])
        self.assertEqual([input_value(n,s) for s in input_states(n)],['Aria','','QA','QQQQ'])
        self.assertEqual(n['props']['value'],'Aria')

    def test_readonly_disabled_and_unsupported_types(self):
        n=self.node();n['props']['readOnly']=True
        self.assertEqual(input_states(n),['initial','readonly'])
        n['props']['enabled']=False
        self.assertEqual(input_states(n),['initial','disabled'])
        for t in ('password','number','email'):
            n['props']['inputType']=t
            with self.assertRaisesRegex(ContractError,'INPUT_TYPE'):input_states(n)

    def test_limit_is_bounded_and_not_silently_skipped(self):
        n=self.node();n['props']['maxLength']=257
        with self.assertRaisesRegex(ContractError,'INPUT_LIMIT'):input_value(n,'limit')
        n['props']['maxLength']=1
        self.assertEqual(input_value(n,'edited'),'Q')


class InputBrowserTests(unittest.TestCase):
    @unittest.skipUnless(os.environ.get('STATEFUL_BROWSER_TESTS')=='1','opt-in local browser')
    def test_real_keyboard_readonly_disabled_and_materials(self):
        # Reuse only fixture creation; do not inherit unrelated test methods.
        fixtures.StatefulTests.setUpClass()
        try:
            for kind in ['Input','Input-readonly','Input-disabled']:
                p=fixtures.StatefulTests.root/kind
                report=accept(p/'ui.component-handoff.draft.zip',p/'evidence.json',fixtures.StatefulTests.component,p/'input-browser',True)
                self.assertEqual(report['status'],'technical_passed')
        finally:fixtures.StatefulTests.tearDownClass()
