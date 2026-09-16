import copy
import unittest
from ai_ui_decomposition.document_extensions import item_offsets,check_extensions,validate_linkage_receipt
from ai_ui_decomposition.native_delivery import _global_rects
from ai_ui_decomposition.layout_gate import world_bounds,text_owners
from ai_ui_decomposition.stateful import node_contexts


def document():
    child=lambda id:dict(id=id,type='Text',layout=dict(x=10,y=8,width=40,height=20),props=dict(text=id))
    node=dict(id='goods',type='List',layout=dict(x=30,y=50,width=160,height=120),children=[child('a-name'),child('b-name')],
              props=dict(items=[dict(id='a',label='A'),dict(id='b',label='B')],itemHeight=60,rowGap=4,
                         itemContents=dict(version='1.0',coordinateSpace='item-local',labelMode='children',items=[dict(itemId='b',childIds=['b-name']),dict(itemId='a',childIds=['a-name'])])))
    return dict(root=dict(id='root',type='Container',layout=dict(x=3,y=7,width=300,height=300),props={},children=[node]))


class DocumentExtensionsTests(unittest.TestCase):
    def test_one_pixel_same_item_overlap_is_rejected_before_generation(self):
        d=document();node=d['root']['children'][0]
        coin=copy.deepcopy(node['children'][0]);coin['id']='coin';coin['layout'].update(x=49,width=12)
        node['children'].append(coin)
        next(r for r in node['props']['itemContents']['items'] if r['itemId']=='a')['childIds'].append('coin')
        with self.assertRaisesRegex(ValueError,'ITEM_CONTENTS_CHILD_OVERLAP:coin'):check_extensions(d)
        coin['layout']['x']=50
        self.assertEqual(check_extensions(d)['status'],'supported')

    def test_linkage_receipt_cannot_omit_checks_or_participants(self):
        matrix=dict(bundleSha256='a'*64,handoffSha256='b'*64,linkedComponentIds=['goods','plus'])
        receipt=dict(kind='ui_linkage_browser_v1',status='passed',human_visual_acceptance=False,bundleSha256='a'*64,handoffSha256='b'*64,coveredComponentIds=['goods','plus'],checks=[dict(pass_=True)])
        receipt['checks']=[{'pass':True}];validate_linkage_receipt(receipt,matrix)
        for change in [dict(checks=[]),dict(checks=[{'pass':False}]),dict(coveredComponentIds=['goods']),dict(bundleSha256='c'*64),dict(human_visual_acceptance=True),dict(status='failed')]:
            with self.assertRaises(ValueError):validate_linkage_receipt({**receipt,**change},matrix)

    def test_source_geometry_uses_item_order_not_mapping_or_child_order(self):
        d=document();self.assertEqual(item_offsets(d['root']['children'][0]),{'b-name':60,'a-name':0})
        self.assertEqual(_global_rects(d)['b-name'],[43,125,40,20])
        self.assertEqual(world_bounds(d)['b-name']['y'],125)
        self.assertEqual({n['id']:pos for n,pos,_ in node_contexts(d['root'])}['b-name'],(43,125))
        self.assertNotIn('goods',text_owners(d))

    def test_capability_must_be_declared_and_present(self):
        d=document();caps=[dict(id='goods',profiles=['base','item-contents-v1'])]
        self.assertEqual(check_extensions(d,caps)['status'],'supported')
        with self.assertRaisesRegex(ValueError,'CAPABILITY_COVERAGE'):check_extensions(d,[])
        del d['root']['children'][0]['props']['itemContents']
        with self.assertRaisesRegex(ValueError,'CAPABILITY_COVERAGE'):check_extensions(d,caps)
        self.assertEqual(check_extensions(d)['status'],'not_applicable')

    def test_invalid_ownership_and_geometry_fail(self):
        for mutate in [lambda c:c.update(version='2.0'),lambda c:c.update(coordinateSpace='world'),
                       lambda c:c['items'][0].update(itemId='missing'),lambda c:c['items'][0].update(childIds=['a-name']),
                       lambda c:c['items'][0].update(childIds=[]),lambda c:c.update(items=[])]:
            d=document();mutate(d['root']['children'][0]['props']['itemContents'])
            with self.assertRaises(ValueError):check_extensions(d)
        for coordinate in [-1,True,float('nan'),200]:
            d=document();d['root']['children'][0]['children'][0]['layout']['y']=coordinate
            with self.assertRaises(ValueError):check_extensions(d)

    def test_versions_and_missing_linked_ownership_fail(self):
        d=document();d['componentLinkages']=dict(version='1.0',pipelines=[dict(listId='goods',quantity=dict(min=1,max=99,step=1),category=dict(map=[dict(category=None)]))])
        caps=[dict(id='goods',profiles=['item-contents-v1','component-linkages-v1'])]
        self.assertEqual(len(check_extensions(d,caps)['checks']),2)
        d['componentLinkages']['version']='2.0'
        with self.assertRaisesRegex(ValueError,'COMPONENT_LINKAGES_VERSION'):check_extensions(d)
        d['componentLinkages']['version']='1.0';del d['root']['children'][0]['props']['itemContents']
        with self.assertRaisesRegex(ValueError,'ITEM_CONTENTS_REQUIRED'):check_extensions(d)

    def test_old_static_children_keep_legacy_coordinates(self):
        d=document();del d['root']['children'][0]['props']['itemContents']
        self.assertEqual(_global_rects(d)['b-name'],[43,65,40,20])
