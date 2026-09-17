import unittest
import tempfile
from pathlib import Path
from PIL import Image
from ai_ui_decomposition.common import sha256
from ai_ui_decomposition.shop_facts import synthetic_facts, expand_shop_facts


class ShopParentBackgroundTests(unittest.TestCase):
    def test_explicit_parent_omits_generated_background_and_retains_evidence(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)/'original.png';Image.new('RGB',(640,480),'white').save(p)
            f=synthetic_facts(sha256(p),[640,480])
            f['rows'].update(backgroundPolicy=dict(version='1.0',mode='parent'),
                             backgroundEvidence='Reviewed source has row frames over the parent Panel, no independent List panel.')
            r=expand_shop_facts(p,f)
            panel=next(n for n in r['document']['root']['children'] if n['type']=='Panel')
            tabs=next(n for n in panel['children'] if n['type']=='Tabs')
            self.assertEqual(len({t['contentId'] for t in tabs['props']['tabs']}),len(tabs['props']['tabs']))
            self.assertIn('shop-list',{n['id'] for n in panel['children']})
            self.assertNotIn('tabs-content',{n['id'] for n in panel['children']})
            selected=next(n for n in panel['children'] if n['id']=='selected-name')
            self.assertEqual(selected['props']['wrap'],'word')
            self.assertEqual(selected['layout']['width'],f['footer']['selectedName']['bounds'][2])
            self.assertLessEqual(selected['layout']['y']+selected['layout']['height'],f['footer']['checkbox']['rect'][1]-f['panel']['rect'][1]-4)
            self.assertTrue(any('Long selected names' in s.get('description','') for s in r['acceptanceScope']['derivedTestStates']))
            for cid in ('quantity-minus','quantity-plus'):
                button=next(n for n in panel['children'] if n['id']==cid)
                binding=next(b for b in r['appearance']['bindings'] if b['componentId']==cid)
                label=binding['states']['button']['labelLayout']
                self.assertGreater(label['x'],0)
                self.assertGreater(label['y'],0)
                self.assertLess(label['x']+label['width'],button['layout']['width'])
                self.assertLess(label['y']+label['height'],button['layout']['height'])
            self.assertTrue(all(isinstance(t.get('region'),dict) and 'minFontSize' in t for t in r['visualObservations']['texts']))
            b=next(b for b in r['appearance']['bindings'] if b['componentId']=='shop-list')
            self.assertEqual({p['role'] for p in b['parts']},{'row','selected-row'})
            self.assertEqual(b['states']['list']['backgroundPolicy'],f['rows']['backgroundPolicy'])
            self.assertNotIn('list-background',{m['layerId'] for m in r['materials']})
            self.assertTrue(any('Explicit List background' in s.get('description','') for s in r['acceptanceScope']['derivedTestStates']))

    def test_policy_requires_evidence(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)/'original.png';Image.new('RGB',(640,480),'white').save(p)
            f=synthetic_facts(sha256(p),[640,480]);f['rows']['backgroundPolicy']=dict(version='1.0',mode='parent')
            with self.assertRaises(ValueError):expand_shop_facts(p,f)
