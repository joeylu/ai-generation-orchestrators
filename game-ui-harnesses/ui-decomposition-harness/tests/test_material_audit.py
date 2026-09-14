import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from PIL import Image
from ai_ui_decomposition.common import ContractError, digest, sha256, write_json
from ai_ui_decomposition.material_audit import audit


class MaterialAuditTests(unittest.TestCase):
    def run_audit(self, category=None, mutate=False):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            raw = root/'requests/a/raw.png'
            raw.parent.mkdir(parents=True)
            image = Image.new('RGBA', (20,20))
            image.paste((0,100,200,255), (3,3,17,17))
            image.save(raw)
            plan = {'assets':[dict(id='a',route='generated_isolation',output_size=[20,20],output_mode='transparent_component')]}
            frozen = {'digest':'batch','requests':{'a':{'id':'a'}}}
            observation = None
            if category:
                observation = root/'observations.json'
                write_json(observation,dict(kind='ai_ui_material_observations_v1',plan_digest=digest(plan),
                    findings=[dict(asset='a',raw_sha256='wrong' if mutate else sha256(raw),
                        category=category,observer='model',evidence='Observed in the supplied raw asset')]))
            with patch('ai_ui_decomposition.material_audit.batch.load',return_value=(frozen,plan)), patch('ai_ui_decomposition.material_audit.verified_result'):
                return audit(root,root/'out',observation)

    def test_cosmetic_differences_do_not_request_regeneration(self):
        result=self.run_audit('texture_difference')
        self.assertEqual(result['assets'][0]['action'],'reuse_candidate')
        self.assertFalse(result['visual_acceptance_ready'])
        self.assertFalse(result['compute_authorized'])

    def test_wrong_semantic_is_blocking(self):
        self.assertEqual(self.run_audit('wrong_semantic_asset')['status'],'needs_repair')

    def test_unknown_is_not_silently_accepted(self):
        self.assertEqual(self.run_audit('uncertain')['assets'][0]['action'],'review_evidence')

    def test_stale_source_is_rejected(self):
        with self.assertRaisesRegex(ContractError,'AUDIT_SOURCE_CHANGED'):
            self.run_audit('texture_difference',True)

    def test_unknown_category_cannot_relax_check(self):
        with self.assertRaisesRegex(ContractError,'AUDIT_CATEGORY'):
            self.run_audit('ignore_all_errors')

    def test_no_observer_does_not_establish_semantic_review(self):
        self.assertEqual(self.run_audit()['semantic_review'],'not_performed')
