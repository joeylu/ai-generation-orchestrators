import base64
import copy
import hashlib
import io
import unittest

from PIL import Image, ImageDraw
from ai_ui_decomposition.common import ContractError
from ai_ui_decomposition.layout_gate import check_layout_requirements, select_surface, world_bounds
from ai_ui_decomposition.delivery_pipeline import compile_world_regions, validate_state_receipt


def fixture():
    image=Image.new('RGBA',(120,90));ImageDraw.Draw(image).rectangle((20,5,99,84),fill='white')
    raw=io.BytesIO();image.save(raw,format='PNG');payload=raw.getvalue()
    node=dict(id='region',type='Select',layout=dict(x=30,y=40,width=120,height=30),props=dict(
        options=[dict(id='a',label='Asia'),dict(id='b',label='Europe')],style=dict(fontSize=16),
        appearance=dict(popupImage='popup.png',popupCanvas=dict(width=120,height=90),
                        popupContentLayout=dict(x=24,y=8,width=72,height=72))))
    panel=dict(id='panel',type='Panel',layout=dict(x=79,y=30,width=300,height=300),props={},children=[node])
    bundle=dict(document=dict(root=panel),resources=[dict(path='popup.png',base64=base64.b64encode(payload).decode(),sha256=hashlib.sha256(payload).hexdigest())])
    req=dict(kind='ui_layout_requirements_v1',panels=[dict(componentId='panel',appearance='plain',reason='No source artwork')],
             selects=[dict(componentId='region',surface='opaque',reason='Readability surface')],buttons=[],textBackgrounds=[])
    obs=dict(kind='ui_visual_observations_v1',texts=[dict(componentId='region')],dialogs=[])
    return bundle,req,obs


class LayoutGateTests(unittest.TestCase):
    def test_complete_opaque_safe_surface(self):
        report=check_layout_requirements(*fixture())
        self.assertEqual(report['status'],'passed');self.assertFalse(report['human_visual_acceptance'])

    def test_visible_border_bbox_is_not_safe_content(self):
        b,r,o=fixture();b['document']['root']['children'][0]['props']['appearance']['popupContentLayout'].update(x=6,width=108)
        issues=check_layout_requirements(b,r,o)['issues']
        self.assertIn('SELECT_CONTENT_OUTSIDE_SURFACE',[i['code'] for i in issues])
        self.assertGreater(next(i['unsafePixels'] for i in issues if i['code']=='SELECT_CONTENT_OUTSIDE_SURFACE'),0)

    def test_interior_hole_rejected_even_when_corners_are_opaque(self):
        b,r,o=fixture();res=b['resources'][0]
        im=Image.open(io.BytesIO(base64.b64decode(res['base64'])));im.putpixel((50,40),(0,0,0,0))
        stream=io.BytesIO();im.save(stream,format='PNG');raw=stream.getvalue()
        res.update(base64=base64.b64encode(raw).decode(),sha256=hashlib.sha256(raw).hexdigest())
        self.assertEqual(check_layout_requirements(b,r,o)['status'],'failed')

    def test_missing_sections_cannot_be_empty_success(self):
        for key in ('panels','selects'):
            b,r,o=fixture();r[key]=[]
            self.assertIn('LAYOUT_REQUIREMENTS_COVERAGE',[i['code'] for i in check_layout_requirements(b,r,o)['issues']])

    def test_missing_observation_cannot_claim_visual_layout(self):
        b,r,o=fixture();o['texts']=[]
        self.assertIn('VISUAL_TEXT_COVERAGE_MISSING',[i['code'] for i in check_layout_requirements(b,r,o)['issues']])
        with self.assertRaisesRegex(ContractError,'VISUAL_OBSERVATIONS_REQUIRED'):check_layout_requirements(b,r,None)

    def test_translucent_requires_adapter_not_silent_opaque_default(self):
        b,r,o=fixture();r['selects'][0]['surface']='translucent'
        self.assertIn('SELECT_TRANSLUCENT_ADAPTER_UNSUPPORTED',[i['code'] for i in check_layout_requirements(b,r,o)['issues']])

    def test_appearance_required_panel_and_text_background(self):
        b,r,o=fixture();r['panels'][0]['appearance']='required'
        text=dict(id='caption',type='Text',props=dict(text='Heading',drawBackground=True))
        b['document']['root']['children'].append(text)
        r['textBackgrounds']=[dict(componentId='caption',drawBackground=False,reason='Parent owns decoration')]
        o['texts'].append(dict(componentId='caption'))
        codes=[i['code'] for i in check_layout_requirements(b,r,o)['issues']]
        self.assertIn('PANEL_APPEARANCE_OWNERSHIP',codes);self.assertIn('TEXT_BACKGROUND_OWNERSHIP',codes)

    def test_bilingual_profile_blocked_before_browser(self):
        b,r,o=fixture();b['document']['root']['children'].append(dict(id='back',type='Button',props=dict(label='返回\nBACK')))
        r['buttons']=[dict(componentId='back',textProfile='per-line',reason='Two independent line sizes')]
        o['texts'].append(dict(componentId='back'))
        self.assertIn('BUTTON_PER_LINE_LAYOUT_UNSUPPORTED',[i['code'] for i in check_layout_requirements(b,r,o)['issues']])

    def test_tall_font_rejects_short_rows(self):
        b,r,o=fixture();b['document']['root']['children'][0]['props']['style']['fontSize']=40
        self.assertIn('SELECT_ROW_TEXT_HEIGHT',[i['code'] for i in check_layout_requirements(b,r,o)['issues']])

    def test_digest_mismatch(self):
        b,r,o=fixture();b['resources'][0]['sha256']='0'*64
        with self.assertRaisesRegex(ContractError,'RESOURCE_CHANGED'):check_layout_requirements(b,r,o)

    def test_nested_world_and_scroll_offsets(self):
        b,_,_=fixture();doc=b['document']
        self.assertEqual(world_bounds(doc)['region'],dict(x=109,y=70,width=120,height=30))
        doc['root'].update(type='ScrollView',props=dict(scrollX=0,scrollY=20))
        self.assertEqual(world_bounds(doc)['region']['y'],50)

    def test_inspection_world_regions_never_reuse_parent_local(self):
        report=compile_world_regions(dict(nodes=[dict(id='input',visible=True,bounds=dict(x=317,y=539,width=570,height=86))]),dict(width=1024,height=1536))
        self.assertEqual(report['regions'][0]['bounds'],[317,539,570,86])

    def test_reference_replay_and_targeted_receipts_are_not_full_acceptance(self):
        good=dict(kind='ui_state_acceptance_v1',status='technical_passed',handoffSha256='h',scope=dict(mode='full'),
                  layoutCoverage='required_checked',visualObservationCoverage='checked',visualObservationSha256='s')
        validate_state_receipt(good,'h')
        for mutate in (dict(kind='ui-reference-acceptance-report'),dict(scope=dict(mode='targeted')),
                       dict(visualObservationCoverage='not_verified_legacy_runtime_only'),dict(handoffSha256='stale')):
            with self.assertRaisesRegex(ContractError,'STATEFUL_RECEIPT_REQUIRED'):validate_state_receipt({**good,**mutate},'h')
