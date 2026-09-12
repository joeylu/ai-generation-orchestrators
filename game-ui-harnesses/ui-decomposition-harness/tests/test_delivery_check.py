import json
import sys
import tempfile
import unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'src'))
from ai_ui_decomposition.delivery_check import select_default_parts, check_delivery
from ai_ui_decomposition.common import ContractError, sha256


class DeliveryCheckTests(unittest.TestCase):
    def test_region_comparison_is_run_and_failure_keeps_draft(self):
        from PIL import Image
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            def put(name,value):
                path=root/name
                path.write_text(json.dumps(value))
                return {'path':name,'sha256':sha256(path)}
            config={'kind':'ai_ui_delivery_check_v1'}
            config['handoff']=put('candidate.json',{'fixture':True})
            config['bundle']=put('bundle.json',{'document':{'root':{'id':'root','type':'Container','props':{}}}})
            config['binding']=put('binding.json',{'bindings':[]})
            for name,color in [('reference','white'),('rendered','black')]:
                path=root/(name+'.png')
                Image.new('RGBA',(4,4),color).save(path)
                config[name]={'path':path.name,'sha256':sha256(path)}
            state={'focus':None,'hover':None,'pressed':None,'values':{},'caret_phase':'absent'}
            config['browser_evidence']=put('browser.json',{
                'state':state,'renderer':'synthetic-test-fixture',
                'bundle_sha256':config['bundle']['sha256'],
                'handoff_sha256':config['handoff']['sha256'],
                'screenshot_sha256':config['rendered']['sha256']})
            config['region_policy']=put('policy.json',{
                'kind':'ai_ui_region_qa_policy_v1',
                'reference_sha256':config['reference']['sha256'],
                'rendered_sha256':config['rendered']['sha256'],
                'reference_state':state,'rendered_state':state,
                'regions':[{'id':'background','bounds':[0,0,4,4],
                    'channel_tolerance':12,'max_bad_fraction':0.05}]})
            path=root/'config.json'
            path.write_text(json.dumps(config))
            result=check_delivery(path,root/'result')
            self.assertIn({'code':'REGION_VISUAL_QA_REJECTED'},result['issues'])
            self.assertEqual(result['delivery_policy'],'unreviewed_draft')
            self.assertTrue(result['region_qa_digest'])
            self.assertTrue((root/'result/region-qa.json').exists())

    def test_mutually_exclusive_parts_and_slider_are_selected_from_values(self):
        document = {'root':{'id':'root','type':'Container','props':{},'children':[
            {'id':'check','type':'CheckBox','props':{'checked':False}},
            {'id':'radio','type':'RadioGroup','props':{'selectedId':'b','options':[{'id':'a'},{'id':'b'}]}},
            {'id':'slider','type':'Slider','props':{'min':0,'max':100,'value':25}}]}}
        binding = {'bindings':[
            {'componentId':'check','parts':[{'role':'box','layerId':'box'},{'role':'mark','layerId':'mark'}]},
            {'componentId':'radio','parts':[{'role':'indicator','optionId':v,'layerId':v} for v in ['a','b']]},
            {'componentId':'slider','parts':[{'role':'fill','layerId':'fill'},{'role':'thumb','layerId':'thumb'}],
             'states':{'slider':{'fillClip':{'x':0,'y':0,'width':200,'height':10},
                'thumbPositions':{'min':{'x':10,'y':0},'max':{'x':110,'y':0}}}}}]}
        result = select_default_parts(document,binding)
        self.assertEqual([p['layerId'] for p in result['standby']],['mark','a'])
        selected = {p['layerId']:p for p in result['selected']}
        self.assertEqual(selected['fill']['clip']['width'],50)
        self.assertEqual(selected['thumb']['position']['x'],35)
        document['root']['children'][0]['props']['checked'] = True
        self.assertIn('mark',[p['layerId'] for p in select_default_parts(document,binding)['selected']])

    def test_missing_evidence_is_a_failed_report_not_a_pass(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            path = root/'config.json'
            path.write_text(json.dumps({'kind':'ai_ui_delivery_check_v1'}))
            result = check_delivery(path,root/'result')
            self.assertEqual(result['status'],'failed_visual_qa')
            self.assertFalse(result['human_visual_acceptance'])
            self.assertTrue((root/'result/delivery-check.json').exists())

    def test_changed_file_cannot_reuse_evidence(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            artifact = root/'bundle.json'
            artifact.write_text('{}')
            config = {'kind':'ai_ui_delivery_check_v1','bundle':{'path':'bundle.json','sha256':sha256(artifact)}}
            artifact.write_text('{"changed":true}')
            path = root/'config.json'
            path.write_text(json.dumps(config))
            with self.assertRaisesRegex(ContractError,'DELIVERY_CHECK_INPUT_CHANGED'):
                check_delivery(path,root/'result')

    def test_font_and_state_missing_are_reported_per_component(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            artifact = root/'bundle.json'
            artifact.write_text(json.dumps({'document':{'root':{'id':'button','type':'Button','props':{}}}}))
            config = {'kind':'ai_ui_delivery_check_v1','bundle':{'path':'bundle.json','sha256':sha256(artifact)}}
            path = root/'config.json'
            path.write_text(json.dumps(config))
            issues = check_delivery(path,root/'result')['issues']
            self.assertEqual(len([i for i in issues if i['code']=='STATE_EVIDENCE_MISSING']),5)
            self.assertIn({'code':'FONT_METRICS_MISSING','component':'button'},issues)
