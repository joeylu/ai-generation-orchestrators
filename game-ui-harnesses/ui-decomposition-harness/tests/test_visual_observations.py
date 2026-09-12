import base64,copy,io,unittest
from PIL import Image
from ai_ui_decomposition.visual_observations import check_visual_observations

def fixture():
    im=Image.new('RGBA',(100,100),'white');buffer=io.BytesIO();im.save(buffer,format='PNG')
    backdrop=dict(color='#000000',opacity=.6)
    bundle={'resources':[{'path':'frame.png','base64':base64.b64encode(buffer.getvalue()).decode()}],'document':{'root':{'id':'dialog','type':'Dialog','layout':{'height':100},'props':{'backdrop':backdrop,'appearance':{'sourceCanvas':{'height':100},'background':{'image':'frame.png','layout':{'y':0,'height':100}}}},'children':[{'id':'claim','type':'Button','layout':{'y':70,'height':10}}]}}}
    observations={'kind':'ui_visual_observations_v1','texts':[{'componentId':'claim','text':'CLAIM','region':dict(x=10,y=70,width=50,height=10),'minFontSize':9}],'dialogs':[{'componentId':'dialog','bodyRequired':False,'backdrop':backdrop,'bottomContentInset':15}]}
    inspection={'nodes':[{'id':'claim','visible':True,'renderedTextBounds':[{'text':'CLAIM','fontFamily':'Arial','fontSize':10,'bounds':dict(x=10,y=70,width=45,height=10)}]}]}
    return bundle,observations,inspection

class VisualObservationTests(unittest.TestCase):
    def test_valid_observations_are_not_human_acceptance(self):
        r=check_visual_observations(*fixture());self.assertEqual(r['status'],'passed');self.assertFalse(r['human_visual_acceptance'])
    def test_missing_text_small_font_bad_position_duplicate_frame_and_wrong_backdrop_fail(self):
        for mode,code in [('missing','RUNTIME_TEXT_MISSING_OR_TRUNCATED'),('font','TEXT_FONT_OR_SIZE'),('position','TEXT_OUTSIDE_OBSERVED_REGION'),('frame','DUPLICATE_DIALOG_BODY'),('backdrop','BACKDROP_OWNERSHIP'),('inset','DIALOG_BOTTOM_CONTENT_INSET')]:
            b,o,i=fixture();b=copy.deepcopy(b);o=copy.deepcopy(o)
            if mode=='missing':i['nodes'][0]['renderedTextBounds']=[]
            if mode=='font':i['nodes'][0]['renderedTextBounds'][0]['fontSize']=5
            if mode=='position':i['nodes'][0]['renderedTextBounds'][0]['bounds']['y']=30
            if mode=='frame':b['document']['root']['props']['appearance']['body']={'image':'extra.png'}
            if mode=='backdrop':b['document']['root']['props']['backdrop']['opacity']=.28
            if mode=='inset':b['document']['root']['children'][0]['layout']['y']=90
            self.assertIn(code,[x['code'] for x in check_visual_observations(b,o,i)['issues']])

    def test_overlapping_observed_text_is_rejected(self):
        b,o,i=fixture();b['document']['root']['children'].append({'id':'caption','type':'Text'})
        o['texts'].append({**o['texts'][0],'componentId':'caption'})
        i['nodes'].append({**i['nodes'][0],'id':'caption'})
        self.assertIn('OBSERVED_TEXT_OVERLAP',[x['code'] for x in check_visual_observations(b,o,i)['issues']])
