"""Offline mirror + official consumer regression for explicit Select highlights."""
import copy,json,os,subprocess,tempfile,unittest
from pathlib import Path
from ai_ui_decomposition.common import ContractError,read_json,write_json
from ai_ui_decomposition.select_menu_highlights import validate_menu_highlights,scale_menu_highlights,require_runtime_menu_highlights
from ai_ui_decomposition.component_handoff import _validate_state_text_colors,export_component_handoff

def sample():
    p={'color':'#168ADD','alpha':.45,'insets':{'top':1,'right':8,'bottom':1,'left':8},'cornerRadius':0}
    return {'popupContentLayout':{'coordinateSpace':'target-popup-local','x':2,'y':1,'width':350,'height':144},'menuHighlights':{'version':'1.0','coordinateSpace':'popup-row-local','selected':p,'hover':{**copy.deepcopy(p),'alpha':.2}}}

class HighlightTests(unittest.TestCase):
    def test_valid_legacy_and_zero_alpha(self):
        s=sample();self.assertEqual(validate_menu_highlights(s,3,[354,146]),s['menuHighlights']);self.assertIsNone(validate_menu_highlights({},3))
        s['menuHighlights']['selected']['alpha']=0;s['menuHighlights']['hover']['alpha']=1;validate_menu_highlights(s,3,[354,146])
    def test_invalid_fields_numbers_and_geometry(self):
        changes=[('VERSION',lambda s:s['menuHighlights'].update(version='2.0')),('FIELDS',lambda s:s['menuHighlights'].pop('hover')),('FIELDS',lambda s:s['menuHighlights'].update(theme='auto')),('COLOR',lambda s:s['menuHighlights']['hover'].update(color='#abc')),('COLOR',lambda s:s['menuHighlights']['hover'].update(color='blue')),('ALPHA',lambda s:s['menuHighlights']['hover'].update(alpha=True)),('ALPHA',lambda s:s['menuHighlights']['hover'].update(alpha=float('nan'))),('ALPHA',lambda s:s['menuHighlights']['hover'].update(alpha=1.1)),('INSET',lambda s:s['menuHighlights']['selected']['insets'].update(top=-1)),('INSET',lambda s:s['menuHighlights']['selected']['insets'].update(top=float('inf'))),('ROW_GEOMETRY',lambda s:s['menuHighlights']['hover']['insets'].update(left=350)),('RADIUS',lambda s:s['menuHighlights']['hover'].update(cornerRadius=30)),('POPUP_CONTENT',lambda s:s.pop('popupContentLayout')),('POPUP_GEOMETRY',lambda s:s['popupContentLayout'].update(x=20))]
        for code,mutate in changes:
            with self.subTest(code=code):
                s=sample();mutate(s)
                with self.assertRaisesRegex(ContractError,code):validate_menu_highlights(s,3,[354,146])
    def test_scale_once_and_runtime_missing_or_tampered_fails(self):
        s=sample();a={'popupContentLayout':{'x':1,'y':.5,'width':175,'height':72},'popupCanvas':{'width':177,'height':73},'menuHighlights':scale_menu_highlights(s['menuHighlights'],.5)}
        require_runtime_menu_highlights(s,a,3,2);self.assertEqual(a['menuHighlights']['selected']['insets']['left'],4)
        self.assertEqual(s['menuHighlights']['selected']['insets']['left'],8)
        for broken in [{k:v for k,v in a.items() if k!='menuHighlights'},copy.deepcopy(a)]:
            if 'menuHighlights' in broken:broken['menuHighlights']['selected']['alpha']=.1
            with self.assertRaisesRegex(ContractError,'MISMATCH'):require_runtime_menu_highlights(s,broken,3,2)
    def test_schema_extension_and_state_allowlist(self):
        import jsonschema
        schema=read_json(Path(__file__).resolve().parents[1]/'references/select-tabs-states.schema.json');s=sample()
        s.update(labelLayout={'coordinateSpace':'target-component-local','x':0,'y':0,'width':20,'height':20},popupPlacement={'coordinateSpace':'target-component-local','anchor':'below-start','gap':0})
        jsonschema.validate({'select':s},schema);_validate_state_text_colors({'bindings':[{'componentType':'Select','states':{'select':s}}]})
        s.pop('popupContentLayout')
        with self.assertRaises(jsonschema.ValidationError):jsonschema.validate({'select':s},schema)

class HighlightIntegrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.consumer=Path(__file__).resolve().parents[2]/'ui-component-harness';cls.temp=tempfile.TemporaryDirectory();cls.out=Path(cls.temp.name)/'fixtures'
        subprocess.run(['node',str(Path(__file__).with_name('stateful-fixtures.mjs')),str(cls.consumer),str(cls.out)],check=True,capture_output=True)
    @classmethod
    def tearDownClass(cls):cls.temp.cleanup()
    def test_producer_export_consumer_import_matrix_and_tamper(self):
        from test_select_option_icons import export_fixture
        from ai_ui_decomposition.stateful import accept,archive_inputs,compile_matrix
        from ai_ui_decomposition.common import sha256
        f=self.out/'Select-highlights';out=self.out/'highlight-export';export_fixture(f/'ui.component-handoff.draft.zip',out)
        evidence=read_json(f/'evidence.json');evidence['handoffSha256']=sha256(out/'ui.component-handoff.draft.zip');evidence['reference']={'path':'preview.png','sha256':sha256(out/'preview.png')};write_json(out/'evidence.json',evidence)
        accept(out/'ui.component-handoff.draft.zip',out/'evidence.json',self.consumer,out/'qa',False)
        b=read_json(out/'qa/consumed.json');binding,assets=archive_inputs(out/'ui.component-handoff.draft.zip');matrix=compile_matrix(b,binding,evidence,assets)
        self.assertIn('selectMenuHighlights',matrix['components'][0]);b['document']['root']['children'][0]['props']['appearance']['menuHighlights']['hover']['alpha']=.9
        with self.assertRaisesRegex(ContractError,'STATE_SELECT_MENU_HIGHLIGHTS_MISMATCH'):compile_matrix(b,binding,evidence,assets)
    @unittest.skipUnless(os.environ.get('STATEFUL_BROWSER_TESTS')=='1','Opt-in local actual PixiJS')
    def test_real_mouse_keyboard_pixels_selected_hover_and_restore(self):
        from ai_ui_decomposition.stateful import accept
        f=self.out/'Select-highlights';result=accept(f/'ui.component-handoff.draft.zip',f/'evidence.json',self.consumer,f/'browser',True)
        self.assertEqual(result['status'],'technical_passed');report=read_json(f/'browser/browser.json')
        rows=[c for s in report['results'] for c in s['checks'] if c['slot'].startswith('menu-highlights/')]
        self.assertEqual(len(rows),24);self.assertTrue(all(c['pass'] for c in rows))
        for state in report['results']:
            checks=state['checks'];popup=next(c for c in checks if c['slot']=='popup')
            self.assertTrue(popup['occluded']);self.assertIsNone(popup['pass'])
            self.assertGreater(popup['coveredPixels'],0)
            icons=[c for c in checks if c['slot'].startswith('option-icon/')]
            self.assertTrue(icons and all(c['pass'] and c['checkedPixels']>0 for c in icons))
            self.assertTrue(next(c for c in checks if c['slot']=='select-popup-destroyed')['pass'])
