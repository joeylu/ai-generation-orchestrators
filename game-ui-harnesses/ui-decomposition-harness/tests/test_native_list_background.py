import copy
import unittest

from ai_ui_decomposition.capabilities import audit
from ai_ui_decomposition.native_delivery import _validate_appearance


class NativeListBackgroundTests(unittest.TestCase):
    def setUp(self):
        self.document = {'canvas': {'width': 400, 'height': 300}}
        self.by_id = {
            'background': {'type': 'Image'},
            'goods': {'type': 'List'},
        }
        self.materials = {
            'background': {'componentId': 'background', 'componentType': 'Image'},
            'goods-row': {'componentId': 'goods', 'componentType': 'List'},
            'goods-selected': {'componentId': 'goods', 'componentType': 'List'},
        }

    def appearance(self, mode=None, include_background=False):
        parts = [
            {'role': 'row', 'layerId': 'goods-row'},
            {'role': 'selected-row', 'layerId': 'goods-selected'},
        ]
        if include_background:
            parts.insert(0, {'role': 'background', 'layerId': 'goods-background'})
        state = {'labelLayout': {}, 'hitArea': {}}
        if mode is not None:
            state['backgroundPolicy'] = {'version': '1.0', 'mode': mode}
        bindings = [
            {'componentId': 'background', 'componentType': 'Image',
             'parts': [{'role': 'image', 'layerId': 'background'}]},
            {'componentId': 'goods', 'componentType': 'List',
             'parts': parts, 'states': {'list': state}},
        ]
        return {
            'registration': {
                'sourceCanvas': {'width': 400, 'height': 300},
                'targetCanvas': {'width': 400, 'height': 300},
                'transform': {'scale': 1, 'offset': {'x': 0, 'y': 0}},
            },
            'bindings': bindings,
        }

    def test_parent_owns_only_rows(self):
        _validate_appearance(self.appearance('parent'), self.document,
                             self.by_id, self.materials, [400, 300])

    def test_parent_rejects_mixed_background_part(self):
        materials = copy.deepcopy(self.materials)
        materials['goods-background'] = {
            'componentId': 'goods', 'componentType': 'List',
        }
        with self.assertRaisesRegex(ValueError, 'NATIVE_LIST_BACKGROUND_POLICY'):
            _validate_appearance(self.appearance('parent', include_background=True),
                                 self.document, self.by_id, materials, [400, 300])

    def test_unknown_policy_version_fails(self):
        appearance = self.appearance('parent')
        appearance['bindings'][1]['states']['list']['backgroundPolicy']['version'] = '2.0'
        with self.assertRaisesRegex(ValueError, 'NATIVE_LIST_BACKGROUND_POLICY'):
            _validate_appearance(appearance, self.document, self.by_id,
                                 self.materials, [400, 300])

    def test_legacy_absent_and_explicit_own_keep_background(self):
        materials = copy.deepcopy(self.materials)
        materials['goods-background'] = {
            'componentId': 'goods', 'componentType': 'List',
        }
        for mode in (None, 'own'):
            with self.subTest(mode=mode):
                _validate_appearance(self.appearance(mode, include_background=True),
                                     self.document, self.by_id, materials, [400, 300])

    def test_capability_profile_is_registered(self):
        report = audit({
            'kind': 'ui-decomposition-capability-request', 'version': '1.0',
            'planDigest': '0' * 64,
            'components': [{'id': 'goods', 'type': 'List',
                            'profiles': ['base', 'list-background-v1']}],
        })
        self.assertEqual(report['status'], 'capability_supported')


if __name__ == '__main__':
    unittest.main()
