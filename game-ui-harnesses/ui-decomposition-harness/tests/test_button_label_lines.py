import copy
import unittest
from ai_ui_decomposition.button_label_lines import validate_label_lines
from ai_ui_decomposition.common import ContractError

class ButtonLabelLinesTests(unittest.TestCase):
    def spec(self):
        return dict(version='1.0',coordinateSpace='target-component-local',lines=[dict(text='返回',fontSize=14,fontWeight='bold',align='center',layout=dict(x=4,y=1,width=92,height=20)),dict(text='BACK',fontSize=9,fontWeight='normal',align='center',layout=dict(x=4,y=23,width=92,height=14))])
    def test_version_content_geometry_and_bounds(self):
        value=self.spec();self.assertEqual(len(validate_label_lines(value,'返回\nBACK',[100,40])),2)
        for mutate in (lambda v:v.update(version='2'),lambda v:v['lines'][1].update(text='invented'),lambda v:v['lines'][0].update(fontSize=float('nan')),lambda v:v['lines'][0]['layout'].update(x=-1),lambda v:v['lines'][1]['layout'].update(y=2),lambda v:v['lines'][0].update(align='middle'),lambda v:v['lines'][1].pop('layout')):
            v=copy.deepcopy(value);mutate(v)
            with self.assertRaises(ContractError):validate_label_lines(v,'返回\nBACK',[100,40])
