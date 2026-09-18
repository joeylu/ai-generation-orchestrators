import copy,tempfile,unittest
from pathlib import Path
from ai_ui_decomposition.binding_aliases import materialize

class BindingAliasesTests(unittest.TestCase):
    def test_only_explicit_same_tab_state_pair_is_aliased_without_mutation(self):
        with tempfile.TemporaryDirectory() as temp:
            source=Path(temp)/'glyph.png';source.write_bytes(b'fixture-pixel-bytes')
            catalog={'parts':[dict(layerId='glyph',componentId='tabs',rect=[1,2,20,20])]}
            appearance={'bindings':[dict(componentId='tabs',componentType='Tabs',parts=[dict(layerId='glyph',role=r,tabId='a') for r in ['icon','active-icon']])]}
            original=copy.deepcopy(appearance)
            c,a,p,aliases=materialize(catalog,appearance,{'glyph':source})
            self.assertEqual(appearance,original)
            self.assertEqual(len(c['parts']),2)
            self.assertNotEqual(a['bindings'][0]['parts'][0]['layerId'],a['bindings'][0]['parts'][1]['layerId'])
            self.assertEqual(p[aliases[0]['layerId']],source)
            self.assertTrue(aliases[0]['pixelIdentity'])
            appearance['bindings'][0]['parts'][1]['tabId']='other'
            with self.assertRaisesRegex(ValueError,'DUPLICATE_LAYER_UNSUPPORTED'):
                materialize(catalog,appearance,{'glyph':source})
