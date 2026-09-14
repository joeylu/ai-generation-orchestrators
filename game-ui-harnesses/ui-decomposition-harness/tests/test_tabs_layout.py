"""Offline exact counterpart of the consumer's versioned Tabs direction contract."""
import copy
import unittest
from ai_ui_decomposition.common import ContractError
from ai_ui_decomposition.tabs_layout import validate_tabs_layout


class TabsLayoutTests(unittest.TestCase):
    def state(self):
        return {'layoutPolicy': {'version': '1.0', 'orientation': 'vertical'}, 'headerHeight': 64,
                'items': [{'tabId': name, 'layout': {'x': 0, 'y': i*76, 'width': 180, 'height': 64}}
                          for i, name in enumerate(['a', 'b', 'c'])]}

    def test_vertical_horizontal_and_legacy(self):
        s = self.state()
        self.assertEqual(validate_tabs_layout(s, ['a','b','c'], 560, 340), s['layoutPolicy'])
        self.assertIsNone(validate_tabs_layout({}, [], 560, 340))
        s['layoutPolicy']['orientation'] = 'horizontal'
        for i, item in enumerate(s['items']): item['layout'].update(x=i*180, y=0)
        s['items'].reverse()  # Horizontal legacy compiler orders by tabId, not input order.
        self.assertEqual(validate_tabs_layout(s, ['a','b','c'], 560, 340)['orientation'], 'horizontal')

    def test_malformed_layout_fails(self):
        cases = [lambda s:s['layoutPolicy'].update(version='2.0'),
                 lambda s:s['layoutPolicy'].update(direction='vertical'),
                 lambda s:s.pop('items'), lambda s:s['items'].pop(),
                 lambda s:s['items'].reverse(), lambda s:s['items'][0].update(tabId='unknown'),
                 lambda s:s['items'][1]['layout'].update(y=50),
                 lambda s:s['items'][1]['layout'].update(x=1),
                 lambda s:s['items'][1]['layout'].update(y=400),
                 lambda s:s['items'][1]['layout'].update(height=63),
                 lambda s:s['items'][1]['layout'].update(y=float('nan')),
                 lambda s:s['items'][1].update(layout=None),
                 lambda s:s['items'].__setitem__(1,None)]
        for i, mutate in enumerate(cases):
            with self.subTest(case=i):
                s=copy.deepcopy(self.state()); mutate(s)
                with self.assertRaises(ContractError): validate_tabs_layout(s,['a','b','c'],560,340)
