import sys
import unittest
from pathlib import Path
from PIL import Image
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'src'))
from ai_ui_decomposition.material_strategy import plan_material_strategy
from ai_ui_decomposition.media import require_long_control_geometry
from ai_ui_decomposition.common import ContractError


class MaterialStrategyTests(unittest.TestCase):
    def test_controls_never_share_icon_boards_and_clean_sources_are_reused(self):
        records=[('scroll','track',[14,524],False),('popup','panel',[236,170],False),
                 ('book','icon',[50,60],False),('paw','icon',[48,58],False),
                 ('large','icon',[200,200],False),('clean','icon',[50,50],True)]
        result=plan_material_strategy({'kind':'ai_ui_material_observations_v1','assets':[
            {'id':key,'category':kind,'target_size':size,'source_reusable':reuse}
            for key,kind,size,reuse in records]})
        decisions={r['id']:r for r in result['decisions']}
        self.assertEqual(decisions['scroll']['route'],'individual')
        self.assertEqual(decisions['popup']['route'],'individual')
        self.assertEqual(decisions['book']['group'],decisions['paw']['group'])
        self.assertNotEqual(decisions['book']['group'],decisions['large']['group'])
        self.assertEqual(decisions['clean']['route'],'source_crop')
        self.assertEqual(result['generation_calls'],0)

    def test_correct_canvas_does_not_hide_short_scrollbar(self):
        material=Image.new('RGBA',(14,524))
        material.paste((0,100,0,255),(0,190,14,270))
        with self.assertRaisesRegex(ContractError,'LONG_CONTROL_SUPPORT_ASPECT_MISMATCH'):
            require_long_control_geometry(material,[14,524])
        require_long_control_geometry(Image.new('RGBA',(14,524),'green'),[14,524])
        with self.assertRaisesRegex(ContractError,'LONG_CONTROL_SUPPORT_ASPECT_MISMATCH'):
            require_long_control_geometry(Image.new('RGBA',(700,42),'green'),[658,26])
