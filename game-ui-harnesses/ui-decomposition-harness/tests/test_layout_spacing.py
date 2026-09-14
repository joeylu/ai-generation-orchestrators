import copy
import unittest
from ai_ui_decomposition.layout_spacing import check_layout_spacing, require_export_spacing
from ai_ui_decomposition.common import ContractError


class LayoutSpacingTests(unittest.TestCase):
    def setUp(self):
        self.doc={'root':{'id':'panel','type':'Panel','layout':{'height':1440},'children':[
            {'id':'back','type':'Button','layout':{'y':1278,'height':90}},
            {'id':'scroll','type':'ScrollView','layout':{'height':850},'props':{'contentHeight':874},'children':[
                {'id':'list','type':'List','layout':{'y':12},'props':{'items':list(range(6)),'itemHeight':138,'rowGap':6}}]}]}}
        self.plan={'version':'1.0','panelFooters':[{'panelId':'panel','componentIds':['back'],'innerBottom':1386,'minimumGap':18,'evidence':'fixture observed inner border'}],
                   'scrollBottomSpaces':[{'componentId':'scroll','bottomWhitespace':40,'reason':'explicit authorized whitespace'}]}

    def test_valid_spacing_no_mutation(self):
        original=copy.deepcopy(self.doc);report=check_layout_spacing(self.doc,self.plan)
        self.assertEqual(report['checks'][0]['bottomGap'],18)
        self.assertEqual(report['checks'][1]['scrollRange'],24)
        self.assertEqual(self.doc,original)

    def test_old_button_fails_even_inside_outer_panel(self):
        self.doc['root']['children'][0]['layout']['y']=1302
        with self.assertRaisesRegex(ContractError,'FOOTER_GAP'):check_layout_spacing(self.doc,self.plan)

    def test_omitted_scroll_decision_fails(self):
        self.plan['scrollBottomSpaces']=[]
        with self.assertRaisesRegex(ContractError,'DECISION_MISSING'):check_layout_spacing(self.doc,self.plan)

    def test_explicit_zero_is_valid(self):
        self.plan['scrollBottomSpaces'][0]['bottomWhitespace']=0
        self.doc['root']['children'][1]['props']['contentHeight']=834
        self.assertEqual(check_layout_spacing(self.doc,self.plan)['checks'][1]['scrollRange'],0)

    def test_wrong_extent_fails(self):
        self.doc['root']['children'][1]['props']['contentHeight']=850
        with self.assertRaisesRegex(ContractError,'CONTENT_HEIGHT'):check_layout_spacing(self.doc,self.plan)

    def test_missing_ornament_evidence_fails(self):
        self.plan['panelFooters'][0]['evidence']=''
        with self.assertRaisesRegex(ContractError,'EVIDENCE'):check_layout_spacing(self.doc,self.plan)

    def test_export_defaults_to_required_and_rejects_old_optional_inventory(self):
        with self.assertRaisesRegex(ContractError,'PLAN_REQUIRED'):require_export_spacing(self.doc)
        with self.assertRaisesRegex(ContractError,'EXPORT_PLAN_VERSION'):require_export_spacing(self.doc,self.plan)

    def test_export_must_classify_every_panel_button(self):
        self.plan.update(version='1.1',nonFooterButtons={})
        self.doc['root']['children'].append({'id':'close','type':'Button','layout':{'y':0,'height':24}})
        with self.assertRaisesRegex(ContractError,'BUTTON_DECISION_MISSING'):require_export_spacing(self.doc,self.plan)
        self.plan['nonFooterButtons']['close']='Header close control; not a footer action'
        report=require_export_spacing(self.doc,self.plan)
        self.assertEqual(report['status'],'passed');self.assertIn('documentDigest',report);self.assertIn('planDigest',report)
        self.plan['nonFooterButtons']['back']='Conflict'
        with self.assertRaisesRegex(ContractError,'NON_FOOTER_CONFLICT'):require_export_spacing(self.doc,self.plan)

    def test_no_relevant_components_need_no_plan(self):
        self.assertEqual(require_export_spacing({'root':{'id':'image','type':'Image'}})['status'],'not_applicable')

    def test_freeze_gate_and_snapshot_integrity(self):
        from test_harness import HarnessTests
        from ai_ui_decomposition import batch
        from ai_ui_decomposition.common import digest,write_json
        f=HarnessTests();f.setUp()
        try:
            capability={'kind':'ui-decomposition-capability-request','version':'1.0','planDigest':digest(f.plan),
                        'components':[{'id':'scroll','type':'ScrollView','profiles':['vertical']}]}
            cp=f.root/'spacing-capability.json';write_json(cp,capability)
            with self.assertRaisesRegex(ContractError,'SPACING_PREFLIGHT_REQUIRED'):
                batch.freeze(f.plan_path,f.workspace,'spacing-missing',capability_request=cp)
            self.assertFalse((f.workspace/'runs/spacing-missing').exists())
            self.plan.update(version='1.1',nonFooterButtons={})
            dp=f.root/'spacing-document.json';pp=f.root/'spacing-plan.json'
            write_json(dp,self.doc);write_json(pp,self.plan)
            r=batch.freeze(f.plan_path,f.workspace,'spacing-valid',capability_request=cp,component_document=dp,layout_spacing=pp)
            self.assertEqual(r['layout_spacing_preflight']['status'],'passed')
            run=f.workspace/'runs/spacing-valid';batch.load(run)
            with (run/'layout-spacing-plan.json').open('a') as out:out.write(' ')
            with self.assertRaisesRegex(ContractError,'SPACING_SNAPSHOT_CHANGED'):batch.load(run)
        finally:f.tearDown()
