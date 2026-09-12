import base64
import copy
import io
import unittest
from PIL import Image
from ai_ui_decomposition.visual_policy import system_typography, check_visual_layout
from ai_ui_decomposition.common import ContractError


def fixture():
    rect = lambda x,y,w,h: dict(x=x,y=y,width=w,height=h)
    style = dict(fontFamily='Arial',fontWeight='normal',fontSize=20,textColor='#ABCDEF')
    def node(id, type, w, h, **props):
        return dict(id=id,type=type,layout=rect(0,0,w,h),props=dict(style=copy.deepcopy(style),**props))
    icon = dict(image='icon.png',layout=rect(8,8,24,24))
    tabs=node('tabs','Tabs',120,40,tabs=[dict(id='one')],appearance=dict(items=[dict(tabId='one',layout=rect(0,0,120,40),labelLayout=rect(40,0,80,40))],icons=[dict(tabId='one',icon=copy.deepcopy(icon),activeIcon=copy.deepcopy(icon))]))
    row=node('list','List',100,94,itemHeight=50,rowGap=6,drawBackground=False,appearance=dict(rowCanvas=dict(width=100,height=44),selectedRowCanvas=dict(width=100,height=44)))
    child=node('slot','Image',30,30); child['layout'].update(x=5,y=5); row['children']=[child]
    progress=node('progress','ProgressBar',100,20,appearance=dict(track=dict(layout=rect(0,0,100,20)),fillClip=rect(4,4,92,12)))
    scroll=node('scroll','ScrollView',100,94,drawBackground=False,scrollbarVisibility='auto',contentHeight=94)
    root=node('root','Container',200,200); root['children']=[tabs,row,progress,scroll]
    image=Image.new('RGBA',(24,24),(255,255,255,255)); buffer=io.BytesIO(); image.save(buffer,format='PNG')
    bundle=dict(document=dict(root=root),resources=[dict(path='icon.png',base64=base64.b64encode(buffer.getvalue()).decode())])
    policy=dict(kind='ui_visual_layout_policy_v1',lists=[dict(componentId='list',contentInsets=[4,4,4,4],paintHeight=44)],tabs=[dict(componentId='tabs',minVisibleHeightRatio=.5,maxVisibleHeightRatio=.7)],progressBars=[dict(componentId='progress',innerInsets=[4,4,4,4])],scrollViews=[dict(componentId='scroll',contentHeight=94)])
    return bundle,policy


class VisualPolicyTests(unittest.TestCase):
    def test_reference_visible_scrollbar_policy(self):
        bundle, policy = fixture()
        policy['scrollViews'][0]['scrollbarVisibility'] = 'always'
        self.assertEqual(check_visual_layout(bundle, policy)['status'], 'failed')
        bundle['document']['root']['children'][3]['props']['scrollbarVisibility'] = 'always'
        self.assertEqual(check_visual_layout(bundle, policy)['status'], 'passed')

    def test_explicit_system_typography_preserves_layout_color_and_size(self):
        bundle,_=fixture(); original=bundle['document']; before=copy.deepcopy(original)
        original['root']['props']['style']['fontFamily']='Custom'; original['root']['props']['fontSource']='font.woff2'
        normalized=system_typography(original)
        self.assertEqual(normalized['root']['props']['style'], before['root']['props']['style'])
        self.assertNotIn('fontSource',normalized['root']['props'])
        self.assertIn('fontSource',original['root']['props'])

    def test_valid_geometry_is_technical_only(self):
        report=check_visual_layout(*fixture())
        self.assertEqual(report['status'],'passed'); self.assertFalse(report['human_visual_acceptance'])

    def test_regressions_are_rejected(self):
        for index,field,value,code in [(1,'drawBackground',True,'LIST_DUPLICATE_BACKGROUND'),(1,'rowGap',0,'LIST_ROW_PAINT_HEIGHT'),(3,'contentHeight',95,'SCROLL_CONTENT_EXTENT')]:
            bundle,policy=fixture(); bundle['document']['root']['children'][index]['props'][field]=value
            self.assertIn(code,[i['code'] for i in check_visual_layout(bundle,policy)['issues']])
        bundle,policy=fixture(); nodes=bundle['document']['root']['children']
        nodes[1]['children'][0]['layout']['y']=20
        nodes[2]['props']['appearance']['fillClip']['x']=0
        codes=[i['code'] for i in check_visual_layout(bundle,policy)['issues']]
        self.assertIn('LIST_SLOT_OUTSIDE_CONTENT',codes); self.assertIn('PROGRESS_FILL_COVERS_FRAME',codes)

    def test_icon_size_overlap_state_anchor_and_omitted_coverage_fail(self):
        bundle,policy=fixture(); icon=bundle['document']['root']['children'][0]['props']['appearance']['icons'][0]['icon']['layout']
        icon.update(width=48,height=40)
        codes=[i['code'] for i in check_visual_layout(bundle,policy)['issues']]
        for code in ['TAB_ICON_VISIBLE_PROPORTION','TAB_ICON_LABEL_OVERLAP','TAB_ICON_STATE_GEOMETRY']: self.assertIn(code,codes)
        policy['tabs']=[]
        with self.assertRaisesRegex(ContractError,'VISUAL_POLICY_COMPONENT_COVERAGE'): check_visual_layout(bundle,policy)
