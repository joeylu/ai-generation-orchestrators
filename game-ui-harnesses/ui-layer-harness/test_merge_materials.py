import unittest
import test_compile_visual as fixtures
from freeze_visual import freeze
from merge_materials import merge
from execution_preflight import preflight
from evaluate import read,digest

class MergeTests(unittest.TestCase):
    setUp=fixtures.VisualCompileTests.setUp
    def test_merge_preserves_objects_and_historical_review(self):
        parent=self.root/'parent';f=freeze(self.run,parent,5)
        before=digest(parent/'snapshot.json');out=self.root/'merged'
        r=merge(parent,f['digest'],out,['asset-coin-a','asset-coin-b'],'asset-panel','explicit test merge')
        self.assertEqual(r['materialCount'],3)
        self.assertFalse(r['newM2ReviewPerformed'])
        self.assertEqual(digest(parent/'snapshot.json'),before)
        v=read(out/'evidence/revised-visual-plan.json')
        self.assertEqual(len(v['objects']),len(self.visual['objects']))
        self.assertTrue(all(o['materialId']=='asset-panel' for o in v['objects'] if o['id'].startswith('coin-')))
        self.assertEqual(preflight(out,r['digest'])['inputChecks'],'passed')
    def test_cross_surface_merge_is_rejected(self):
        parent=self.root/'parent';f=freeze(self.run,parent,5)
        with self.assertRaisesRegex(ValueError,'CONTAINED_FOREGROUND'):
            merge(parent,f['digest'],self.root/'out',['asset-coin-a'],'asset-buy-button','test')
        self.assertFalse((self.root/'out').exists())
