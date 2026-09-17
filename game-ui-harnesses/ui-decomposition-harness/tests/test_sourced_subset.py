import unittest
from ai_ui_decomposition.sourced_handoff import verify_subset

class SourcedSubsetTests(unittest.TestCase):
    def test_subset_retains_layer_identity_and_target_geometry(self):
        source={'slots':[{'asset_id':k,'target_size':[100,20]} for k in ['bg','row','selected']]}
        verify_subset(source,{'slots':source['slots'][1:]})
        for bad in [{'asset_id':'unknown','target_size':[100,20]},
                    {'asset_id':'row','target_size':[101,20]}]:
            with self.assertRaisesRegex(ValueError,'SOURCED_SUBSET_GEOMETRY_CHANGED'):
                verify_subset(source,{'slots':[bad]})
