import os,subprocess,tempfile,unittest,copy,json
from pathlib import Path
from ai_ui_decomposition.common import ContractError,read_json
from ai_ui_decomposition.stateful import accept,archive_inputs,compile_matrix

class ListChildrenTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.consumer=Path(__file__).resolve().parents[2]/'ui-component-harness'
        cls.temp=tempfile.TemporaryDirectory();cls.root=Path(cls.temp.name)/'fixtures'
        subprocess.run(['node',str(Path(__file__).with_name('list-children-fixtures.mjs')),str(cls.consumer),str(cls.root)],check=True,capture_output=True)
        cls.data={}
        for name in ['scroll','zero']:
            f=cls.root/name;accept(f/'ui.component-handoff.draft.zip',f/'evidence.json',cls.consumer,f/'qa',False)
            binding,assets=archive_inputs(f/'ui.component-handoff.draft.zip')
            cls.data[name]=(read_json(f/'qa/consumed.json'),binding,read_json(f/'evidence.json'),assets)
    @classmethod
    def tearDownClass(cls):cls.temp.cleanup()

    def test_each_selection_and_scroll_position_has_independent_child_evidence(self):
        for name,data in self.data.items():
            m=compile_matrix(*data)
            self.assertTrue(all(len(s['listChildren'])==6 for c in m['components'] for s in c['states']))
            scroll=next(c for c in m['components'] if c['componentId']=='scroll')
            top=scroll['states'][0]['listChildren'][0];bottom=scroll['states'][-1]['listChildren'][0]
            self.assertEqual(top['rect'][1]-bottom['rect'][1],60 if name=='scroll' else 0)
            if name=='scroll':self.assertEqual(bottom['visibleRect'][3],0)

    def test_unsupported_children_overlap_and_corrupt_resource_fail(self):
        for mutate,code in [(lambda n:n['children'][0].update(type='Container'),'CHILD_TYPE'),
            (lambda n:n['children'][1]['layout'].update(x=8,y=8),'CHILD_OVERLAP'),
            (lambda n:n['children'][1]['props']['style'].update(opacity=.5),'CHILD_STYLE'),
            (lambda n:n['children'][0]['layout'].update(width=33),'STATIC_CHILD')]:
            data=copy.deepcopy(self.data['scroll']);node=data[0]['document']['root']['children'][0]['children'][0];mutate(node)
            with self.subTest(code=code),self.assertRaisesRegex(ContractError,code):compile_matrix(*data)
        data=copy.deepcopy(self.data['scroll'])
        next(r for r in data[0]['resources'] if r['path']=='icon.png')['sha256']='0'*64
        with self.assertRaisesRegex(ContractError,'STATE_RESOURCE_MISMATCH'):compile_matrix(*data)

    @unittest.skipUnless(os.environ.get('STATEFUL_BROWSER_TESTS')=='1','Opt-in local actual browser')
    def test_real_selection_wheel_drag_keyboard_and_zero_range(self):
        for name in ['scroll','zero']:
            f=self.root/name;r=accept(f/'ui.component-handoff.draft.zip',f/'evidence.json',self.consumer,f/'browser',True)
            self.assertEqual(r['status'],'technical_passed');report=read_json(f/'browser/browser.json')
            self.assertEqual(len(report['results']),14)
            checks=[c for s in report['results'] for c in s['checks'] if c['slot'].startswith(('list-child','list-composition'))]
            self.assertTrue(checks and all(c['pass'] for c in checks))
            self.assertEqual({s['inputProtocol'] for s in report['results'] if s['componentId']=='scroll'},{'drag','wheel','keyboard'})
            self.assertFalse(report['human_visual_acceptance'])

    @unittest.skipUnless(os.environ.get('STATEFUL_BROWSER_TESTS')=='1','Opt-in local actual browser')
    def test_browser_rejects_wrong_text_and_clipping(self):
        import ai_ui_decomposition.stateful as stateful
        for case in ['text','color','clip']:
            f=self.root/'scroll';out=f/('reject-'+case)
            accept(f/'ui.component-handoff.draft.zip',f/'evidence.json',self.consumer,out,False)
            matrix=read_json(out/'state-matrix.json');children=matrix['components'][0]['states'][0]['listChildren']
            if case=='text':children[1]['text']='WRONG EXPECTED COPY'
            elif case=='color':children[1]['color']='#FF0000'
            else:children[0]['visibleRect'][2]=4
            (out/'state-matrix.json').write_text(json.dumps(matrix),encoding='utf-8')
            result=subprocess.run(['node',str(Path(stateful.__file__).with_name('stateful_browser.mjs')),str(self.consumer),str(out)],capture_output=True)
            self.assertNotEqual(result.returncode,0)
            report=read_json(out/'browser.json');self.assertEqual(report['error'],'STATE_BROWSER_PIXELS_MISMATCH')
            failures=[c['slot'] for r in report['results'] for c in r['checks'] if not c['pass']]
            self.assertIn({'text':'list-child/text-0/text','color':'list-child/text-0/pixels','clip':'list-children/clip-leak'}[case],failures)
