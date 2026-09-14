import json,os,subprocess,tempfile,unittest,zipfile
from pathlib import Path
from ai_ui_decomposition.common import ContractError,read_json,write_json,sha256
from ai_ui_decomposition.stateful import accept
from ai_ui_decomposition.value_text_handoff import attach


class ListTextBindingTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.consumer=Path(__file__).resolve().parents[2]/'ui-component-harness'
        cls.temp=tempfile.TemporaryDirectory();cls.root=Path(cls.temp.name)/'fixtures'
        subprocess.run(['node',str(Path(__file__).with_name('list-children-fixtures.mjs')),str(cls.consumer),str(cls.root),'v2'],check=True,capture_output=True)
        for name in ['scroll','zero']:
            f=cls.root/name
            attach(f/'ui.component-handoff.draft.zip',f/'value-text-bindings.json',cls.consumer,f/'attached')
            evidence=read_json(f/'evidence.json');evidence['handoffSha256']=sha256(f/'attached/ui.component-handoff.draft.zip')
            write_json(f/'bound-evidence.json',evidence)
            accept(f/'attached/ui.component-handoff.draft.zip',f/'bound-evidence.json',cls.consumer,f/'qa',False)

    @classmethod
    def tearDownClass(cls):cls.temp.cleanup()

    def test_selection_expectations_include_initial_null_and_restore(self):
        matrix=read_json(self.root/'scroll/qa/state-matrix.json')
        node=next(c for c in matrix['components'] if c['componentId']=='list')
        self.assertEqual([s['boundTexts'][0]['text'] for s in node['states']],['Selected: First','Selected: Second','Selected: Third'])
        self.assertEqual([s['boundTexts'][0]['text'] for s in node['boundTextProbes']],['Selected: Second','Selected: (none)','Selected: Second','Selected: Second'])
        self.assertTrue(all(s['boundTexts'][0]['fallbackText']=='Authored fallback' for s in node['states']))

    def test_attachment_preserves_v2_reference_bytes_and_unknowns(self):
        for name in ['scroll','zero']:
            f=self.root/name
            with zipfile.ZipFile(f/'ui.component-handoff.draft.zip') as old,zipfile.ZipFile(f/'attached/ui.component-handoff.draft.zip') as new:
                for member in ['reference/original.png','reference/reference-state.json','acceptance-scope.json','decomposition/ui.draft.zip']:
                    self.assertEqual(old.read(member),new.read(member))
                self.assertEqual(json.loads(old.read('handoff.json'))['reference'],json.loads(new.read('handoff.json'))['reference'])
            self.assertEqual(read_json(f/'attached/export.json')['binding_version'],'1.1')

    def test_official_cli_rejects_partial_duplicate_version_and_target(self):
        f=self.root/'scroll'
        for i,mutate in enumerate([lambda b:b.update(version='1.0'),lambda b:b['bindings'][0]['parts'][1]['items'].pop(),
            lambda b:b['bindings'][0]['parts'][1]['items'][0].update(itemId='second'),lambda b:b['bindings'][0].update(targetId='missing')]):
            b=read_json(f/'value-text-bindings.json');mutate(b);p=f/f'invalid-{i}.json';write_json(p,b)
            with self.assertRaisesRegex(ContractError,'VALUE_TEXT_OFFICIAL_CLI_REJECTED'):attach(f/'ui.component-handoff.draft.zip',p,self.consumer,f/f'rejected-{i}')
            self.assertFalse((f/f'rejected-{i}/ui.component-handoff.draft.zip').exists())

    @unittest.skipUnless(os.environ.get('STATEFUL_BROWSER_TESTS')=='1','Opt-in local actual browser')
    def test_real_inputs_compare_bound_text_and_preserve_source_event_counts(self):
        for name in ['scroll','zero']:
            f=self.root/name;r=accept(f/'attached/ui.component-handoff.draft.zip',f/'bound-evidence.json',self.consumer,f/'browser',True)
            self.assertEqual(r['status'],'technical_passed')
            report=read_json(f/'browser/browser.json');self.assertEqual(len(report['results']),18)
            states=[s for s in report['results'] if s['componentId']=='list']
            self.assertEqual({s['inputProtocol'] for s in states},{'mouse','keyboard','initial-load','public-api'})
            self.assertTrue(all(any(c['slot'].startswith('bound-text/') for c in s['checks']) for s in states))

    @unittest.skipUnless(os.environ.get('STATEFUL_BROWSER_TESTS')=='1','Opt-in local actual browser')
    def test_browser_rejects_stale_footer_expectation(self):
        import ai_ui_decomposition.stateful as module
        f=self.root/'scroll';out=f/'stale-footer'
        accept(f/'attached/ui.component-handoff.draft.zip',f/'bound-evidence.json',self.consumer,out,False)
        matrix=read_json(out/'state-matrix.json');node=next(c for c in matrix['components'] if c['componentId']=='list')
        node['boundTextProbes'][0]['boundTexts'][0]['text']='Authored fallback'
        (out/'state-matrix.json').write_text(json.dumps(matrix),encoding='utf8')
        p=subprocess.run(['node',str(Path(module.__file__).with_name('stateful_browser.mjs')),str(self.consumer),str(out)],capture_output=True)
        self.assertNotEqual(p.returncode,0);r=read_json(out/'browser.json');self.assertEqual(r['error'],'STATE_BOUND_TEXT_MISMATCH')
        self.assertTrue(any(c['slot'].endswith('/text') and not c['pass'] for c in r['results'][-1]['checks']))
