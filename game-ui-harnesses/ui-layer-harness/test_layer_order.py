import copy
import unittest
from evaluate import check_relations, draw_order


def fixture():
    return {'kind':'ui_visual_plan_v4', 'coordinateSpace':'reference-normalized-ltrb',
            'materials':[{'id':'bg','role':'background','zOrder':0},
                         {'id':'b','role':'foreground','zOrder':1},
                         {'id':'a','role':'foreground','zOrder':1}],
            'objects':[{'id':'bg','kind':'background','materialId':'bg','bboxNorm':[0,0,1,1]},
                       {'id':'a','kind':'icon','materialId':'a','bboxNorm':[.1,.1,.2,.2]},
                       {'id':'b','kind':'icon','materialId':'b','bboxNorm':[.3,.1,.4,.2]}],
            'unknowns':[]}


class LayerOrderTests(unittest.TestCase):
    def test_disjoint_ties_stable_and_source_unchanged(self):
        plan = fixture(); original = copy.deepcopy(plan)
        order = draw_order(plan, 'source-digest')
        self.assertEqual([x['id'] for x in order['materials']], ['bg','a','b'])
        self.assertEqual([x['drawIndex'] for x in order['materials']], [0,1,2])
        self.assertEqual(plan, original)
        plan['materials'].reverse(); plan['objects'].reverse()
        self.assertEqual(draw_order(plan,'source-digest'),order)

    def test_overlap_blocks_and_names_objects(self):
        plan=fixture(); plan['objects'][2]['bboxNorm']=[.15,.1,.3,.2]
        issue=check_relations(plan)[0]
        self.assertEqual(issue['code'],'SAME_LAYER_OVERLAP_REVIEW')
        self.assertEqual(issue['objectPairs'],[['a','b']])
        with self.assertRaises(ValueError): draw_order(plan,'sha')

    def test_touching_edges_are_not_overlap(self):
        plan=fixture(); plan['objects'][2]['bboxNorm']=[.2,.1,.3,.2]
        self.assertEqual(check_relations(plan),[])

    def test_group_gaps_do_not_count_as_overlap(self):
        plan=fixture()
        plan['objects'].append({'id':'a2','kind':'icon','materialId':'a','bboxNorm':[.6,.1,.7,.2]})
        self.assertEqual(check_relations(plan),[])

    def test_separate_layers_and_background_rules(self):
        plan=fixture();plan['objects'][2]['bboxNorm']=[.15,.1,.3,.2]
        plan['materials'][1]['zOrder']=2
        self.assertEqual(check_relations(plan),[])
        plan['materials'][0]['zOrder']=1
        self.assertIn('BACKGROUND_ORDER',[x['code'] for x in check_relations(plan)])

    def test_old_contract_keeps_unique_requirement(self):
        for kind in ('ui_visual_plan_v2','ui_visual_plan_v3'):
            plan=fixture();plan['kind']=kind
            self.assertIn('FOREGROUND_ORDER_DUPLICATE',[x['code'] for x in check_relations(plan)])


if __name__=='__main__': unittest.main()
