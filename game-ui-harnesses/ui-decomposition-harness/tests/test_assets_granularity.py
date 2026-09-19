from copy import deepcopy
import tempfile
import unittest
from pathlib import Path
from PIL import Image
from ai_ui_decomposition.assets_brief import prepare
from ai_ui_decomposition.common import ContractError, write_json, read_json
from test_assets_brief import fixture


class GranularityTests(unittest.TestCase):
    def brief(self):
        b=fixture();b['kind']='ui_assets_brief_v2'
        b['granularity']={'units':[dict(id='panel-system',elements=['frame','circle','star'],
            basis='Observed connected static panel',splits=[],connections=[])]}
        return b

    def run_brief(self,b,root):
        ref=root/'ref.png';Image.new('RGB',(128,128),'blue').save(ref)
        path=root/'brief.json';write_json(path,b)
        return prepare(ref,path,root/'out')

    def test_v1_requires_explicit_replay(self):
        with tempfile.TemporaryDirectory() as d:
            with self.assertRaisesRegex(ContractError,'BRIEF_V2_REQUIRED'):
                self.run_brief(fixture(),Path(d))

    def test_unjustified_split_blocks_before_budget_or_freeze(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d)
            with self.assertRaisesRegex(ContractError,'SPLIT_UNJUSTIFIED'):
                self.run_brief(self.brief(),root)
            self.assertFalse((root/'out/workspace').exists())
            self.assertFalse((root/'out/budget-review.json').exists())
            self.assertEqual(read_json(root/'out/granularity-review.json')['status'],'blocked')

    def test_static_elements_can_share_one_owner(self):
        b=self.brief();b['assets']=b['assets'][:2];b['boards']=[]
        for e in b['elements']:
            if e['owner'] in ('left','right'):e['owner']='panel'
        with tempfile.TemporaryDirectory() as d:
            r=self.run_brief(b,Path(d));self.assertEqual(r['maximumCalls'],2)

    def test_relative_layout_survives_frozen_requests(self):
        b=self.justified()
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);self.run_brief(b,root)
            prompts=[p.read_text(encoding='utf-8') for p in
                     (root/'out/workspace/runs/generation/requests').glob('*/prompt.txt')]
            panel=next(p for p in prompts if 'Thin gold frame' in p)
            self.assertIn('"boxPercent": [10.0, 20.0, 20.0, 20.0]',panel)
            self.assertIn('reserve-space-do-not-draw',panel)
            self.assertIn('do not redistribute rows',panel)
            board=next(p for p in prompts if 'component-family-board-v1:' in p)
            self.assertIn('"boxPercent": [0.0, 0.0, 100.0, 100.0]',board)
            self.assertIn('not board coordinates',board)

    def justified(self):
        b=self.brief();u=b['granularity']['units'][0]
        u['splits']=[dict(asset=a,reason='user-request',evidence='User needs separate editing') for a in ('panel','left','right')]
        u['connections']=[dict(assets=list(pair),relation='occluding',seam='Separate closed boundaries',
            occlusion='Symbols overlay panel interior',alignment='Preserve original source pixel coordinates')
            for pair in [('panel','left'),('panel','right'),('left','right')]]
        return b

    def test_justified_split_reaches_real_freeze(self):
        with tempfile.TemporaryDirectory() as d:
            r=self.run_brief(self.justified(),Path(d))
            self.assertEqual(r['generationCalls'],0);self.assertEqual(r['maximumCalls'],3)

    def test_bad_connections_evidence_inventory_and_reasons_block(self):
        for change in ('missing','duplicate','owner','evidence','reason','inventory'):
            with self.subTest(change=change), tempfile.TemporaryDirectory() as d:
                b=self.justified();u=b['granularity']['units'][0]
                if change=='missing':u['connections'].pop()
                if change=='duplicate':u['connections'].append(deepcopy(u['connections'][0]))
                if change=='owner':u['connections'][0]['assets'][0]='unknown'
                if change=='evidence':u['connections'][0]['alignment']=' '
                if change=='reason':u['splits'][0]['reason']='fewer-calls'
                if change=='inventory':b['granularity']['units']=[]
                with self.assertRaises(ContractError):self.run_brief(b,Path(d))
