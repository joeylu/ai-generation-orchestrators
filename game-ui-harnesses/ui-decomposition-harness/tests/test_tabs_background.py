import unittest
from ai_ui_decomposition.component_handoff import _validate_tabs_background
from ai_ui_decomposition.common import ContractError


class TabsBackgroundTests(unittest.TestCase):
    def test_explicit_boolean_and_legacy_absence(self):
        for props in ({},{'drawBackground':False},{'drawBackground':True}):
            _validate_tabs_background({'type':'Tabs','props':props})

    def test_invalid_explicit_value_is_not_silently_defaulted(self):
        for value in (None,0,1,'false',[],{}):
            with self.subTest(value=value),self.assertRaisesRegex(ContractError,'TABS_BACKGROUND_BOOLEAN'):
                _validate_tabs_background({'type':'Tabs','props':{'drawBackground':value}})
