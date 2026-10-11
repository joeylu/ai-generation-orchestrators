"""Ownership defects remain visible and actionable without automatic compute."""
import _bootstrap
from copy import deepcopy
import unittest

from ai_ui_layers.material_repair_plan import compile_plan
from ai_ui_layers import context_references as context
from test_context_short_v5 import layered_fixture, FIXTURES


class MaterialRepairTests(unittest.TestCase):
    def test_duplicate_neighbor_and_handle_target_only_the_contaminated_materials(self):
        warnings=[dict(code='OWNERSHIP_OBSERVATION_BLOCKED',materialId=mid,
            objectId=obj,ownerMaterialId=owner,scope='foreign',state='present',evidence='Fixture visible foreign artwork.')
            for mid,obj,owner in [('tab','selected-strip','neighbor'),('track','handle','knob')]]
        sources={mid:dict(sha256=str(i)*64) for i,mid in enumerate(['tab','track','knob','neighbor'],1)}
        before=deepcopy(warnings)
        result=compile_plan(warnings,sources,'a'*64)
        self.assertEqual(result['affectedMaterialIds'],['tab','track'])
        self.assertTrue(all(row['action']=='remove-foreign-object' for row in result['actions']))
        self.assertTrue(result['preservesOtherMaterials']);self.assertTrue(result['newBoundComputeAuthorizationRequired'])
        self.assertEqual(result['automaticRetries'],0);self.assertEqual(result['generationCalls'],0)
        self.assertFalse(result['artworkModified']);self.assertFalse(result['visualAcceptanceAsserted'])
        self.assertEqual(warnings,before)
        self.assertEqual(compile_plan(warnings*2,sources,'a'*64),result)

    def test_uncertain_observations_never_become_removal_instructions(self):
        result=compile_plan([dict(code='OWNERSHIP_OBSERVATION_BLOCKED',materialId='panel',
            objectId='border',scope='owned',state='uncertain',evidence='Fixture uncertain contour.')],
            dict(panel=dict(sha256='a'*64)),'b'*64)
        self.assertEqual(result['actions'][0]['action'],'resolve-uncertain-ownership')
        with self.assertRaisesRegex(ValueError,'SOURCE_REQUIRED'):
            compile_plan([dict(code='OWNERSHIP_OBSERVATION_BLOCKED',materialId='unknown')],{},'b'*64)

    def test_conflicting_observations_remain_uncertain_without_blocking_delivery(self):
        base=dict(code='OWNERSHIP_OBSERVATION_BLOCKED',materialId='track',objectId='handle',
            ownerMaterialId='knob',scope='foreign')
        warnings=[dict(base,state='present',evidence='Fixture visible handle.'),
            dict(base,state='uncertain',evidence='Fixture ambiguous edge.')]
        sources=dict(track=dict(sha256='a'*64))
        result=compile_plan(warnings,sources,'b'*64)
        self.assertEqual(result,compile_plan(list(reversed(warnings))*2,sources,'b'*64))
        entry=result['actions'][0]
        self.assertEqual(entry['action'],'resolve-uncertain-ownership')
        self.assertTrue(entry['conflictingObservations'])
        self.assertIn('visible handle',entry['evidence']);self.assertIn('ambiguous edge',entry['evidence'])
        self.assertEqual(result['generationCalls'],0);self.assertFalse(result['artworkModified'])

    def test_v9_prevents_contact_slivers_and_assembled_controls_without_changing_v8(self):
        visual,plan=layered_fixture(*FIXTURES[0]);before=deepcopy(visual)
        old=context.prompt(visual,plan,['harbor-band'],version='v8')
        current=context.prompt(visual,plan,['harbor-band'],version='v9')
        self.assertNotIn('CONTACT OWNERSHIP',old)
        self.assertIn('narrow clipped strip',current)
        self.assertIn('assembled control plus a second separate part',current)
        old_actions=[line for line in old.splitlines() if line.startswith(('KEEP {','DELETE {'))]
        self.assertEqual(old_actions,[line for line in current.splitlines() if line.startswith(('KEEP {','DELETE {'))])
        self.assertEqual(visual,before)


if __name__=='__main__':unittest.main()
