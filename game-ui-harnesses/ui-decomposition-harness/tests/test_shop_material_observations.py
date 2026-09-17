import unittest
from copy import deepcopy
from ai_ui_decomposition.common import ContractError
from ai_ui_decomposition.shop_material_observations import apply_observations


class ShopMaterialObservationsTests(unittest.TestCase):
    def request(self):
        return dict(materials=[dict(layerId='coin',description='Coin')],visibleGeometryRequirements=[])

    def test_explicit_evidence_and_geometry_both_flow_through(self):
        r=self.request();f=dict(materialObservations=dict(version='1.0',items=[dict(layerId='coin',evidence='Observed solid symbol occupies its allocated bounds.',minimumOccupancy=dict(width=.85,height=.9))]))
        apply_observations(f,r)
        self.assertIn('Observed solid',r['materials'][0]['description'])
        self.assertEqual(r['visibleGeometryRequirements'][0]['minimumOccupancy'],dict(width=.85,height=.9))
        apply_observations({},self.request())

    def test_unknown_duplicate_and_invalid_assertions_fail(self):
        base=dict(version='1.0',items=[dict(layerId='coin',evidence='Source review')])
        for change in [dict(version='2.0'),dict(items=[dict(layerId='missing',evidence='review')]),dict(items=base['items']*2),dict(items=[dict(layerId='coin',evidence='')]),dict(items=[dict(layerId='coin',evidence='review',minimumOccupancy=dict(width=1.1))]),dict(items=[dict(layerId='coin',evidence='review',minimumOccupancy=dict(width=True))])]:
            with self.subTest(change=change),self.assertRaises(ContractError):apply_observations(dict(materialObservations={**deepcopy(base),**change}),self.request())
