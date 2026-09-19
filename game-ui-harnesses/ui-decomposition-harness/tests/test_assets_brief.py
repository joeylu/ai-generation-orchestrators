from copy import deepcopy
from pathlib import Path
import tempfile
import unittest
from PIL import Image
from ai_ui_decomposition.assets_brief import compile_brief, packing_canvas, prepare as prepare_current, request_brief
from ai_ui_decomposition.common import ContractError,read_json,write_json,sha256,digest
from ai_ui_decomposition.assets_boards import verify


def prepare(*args, **kwargs):
    return prepare_current(*args, **kwargs, legacy_brief=True)


def fixture():
    return dict(kind='ui_assets_brief_v1',id='brief-test',reviewed=True,
        assets=[dict(id='scene',role='background',region=[0,0,128,128],description='Blue sky'),
                dict(id='panel',role='important_component',region=[10,10,100,100],description='Thin gold frame'),
                dict(id='left',role='important_component',region=[20,30,20,20],description='Cyan circle'),
                dict(id='right',role='important_component',region=[50,30,20,20],description='Gold star')],
        elements=[dict(id='sky',label='Sky',region=[0,0,128,128],owner='scene'),
                  dict(id='frame',label='Gold frame',region=[10,10,100,100],owner='panel'),
                  dict(id='circle',label='Cyan circle',region=[20,30,20,20],owner='left'),
                  dict(id='star',label='Gold star',region=[50,30,20,20],owner='right'),
                  dict(id='text',label='Ordinary title',region=[30,70,40,20],owner=None)],
        boards=[dict(id='symbols',assets=['left','right'])])


class BriefTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.root=Path(self.tmp.name)
        self.ref=self.root/'ref.png';Image.new('RGB',(128,128),'blue').save(self.ref)
        self.brief=self.root/'brief.json';write_json(self.brief,fixture())

    def tearDown(self):self.tmp.cleanup()

    def test_one_entry_reaches_verified_frozen_batch_without_authorization(self):
        out=self.root/'prepared';result=prepare(self.ref,self.brief,out)
        self.assertEqual((result['maximumCalls'],result['generationCalls']),(3,0))
        verify(out/'compiled',out/'workspace/runs/generation')
        self.assertFalse((out/'workspace/runs/generation/assets-authorization.json').exists())
        self.assertEqual(sha256(out/'reference.png'),sha256(self.ref))
        self.assertEqual([s['stage'] for s in result['stages']],['input','compile','planning-check','board-compile','freeze'])
        self.assertTrue(all(s['status']=='completed' and s['elapsedSeconds']>=0 for s in result['stages']))
        self.assertEqual(len(list((out/'events').glob('*.json'))),10)

    def test_frozen_single_and_board_requests_preserve_fidelity_constraints(self):
        out=self.root/'fidelity';prepare(self.ref,self.brief,out)
        requests=list((out/'workspace/runs/generation/requests').glob('*/prompt.txt'))
        self.assertEqual(len(requests),3)
        for path in requests:
            prompt=path.read_text(encoding='utf-8')
            self.assertIn('not permission to redesign',prompt)
            self.assertIn('Explicit ownership exclusions',prompt)
            self.assertNotIn('as style evidence',prompt)
            if 'opaque UI-free scene' in prompt:
                self.assertIn('complete only occluded regions',prompt)
                self.assertIn('Do not invent a new central subject',prompt)
                self.assertNotIn('Reconstruct an opaque scene',prompt)
            if 'component-family-board-v1:' in prompt:
                self.assertIn('reference region',prompt)
                self.assertIn('do not merge or reorder',prompt)
        # A compiler change affects new freezes, never existing requests.
        before={p:p.read_bytes() for p in requests}
        verify(out/'compiled',out/'workspace/runs/generation')
        self.assertEqual(before,{p:p.read_bytes() for p in requests})

    def test_ownership_exclusions_and_coverage_have_one_source(self):
        source=dict(path='reference.png',sha256=sha256(self.ref),size=[128,128])
        plan,coverage,_=compile_brief(fixture(),source)
        for e in coverage['elements']:
            for asset in plan['assets']:
                excluded=asset['prompt'].split('Exclude these separately owned materials and ordinary text: ')[1]
                if asset['id'] not in e['ownerAssets']:
                    self.assertIn(asset['id'],e['removedBy'])
                    self.assertIn('"id": "'+e['id']+'"',excluded)
                else:self.assertNotIn(asset['id'],e['removedBy'])
        self.assertTrue(all('source_asset' in a and a['source_asset'] is None for a in plan['assets']))

    def test_unreviewed_brief_preserves_blocked_report_and_never_freezes(self):
        b=fixture();b['reviewed']=False;path=self.root/'pending.json';write_json(path,b)
        out=self.root/'pending'
        with self.assertRaisesRegex(ContractError,'BRIEF_PLANNING_BLOCKED'):prepare(self.ref,path,out)
        self.assertEqual(read_json(out/'planning-check.json')['status'],'blocked')
        self.assertEqual(read_json(out/'failure.json')['stages'][-1]['status'],'failed')
        self.assertFalse((out/'workspace').exists())

    def test_crest_outside_source_still_blocks_not_automatically_shrunk(self):
        b=fixture();b['elements'][1]['region']=[10,2,100,108]
        path=self.root/'crest.json';write_json(path,b);out=self.root/'crest'
        with self.assertRaisesRegex(ContractError,'PLANNING_SOURCE_GAP:frame'):prepare(self.ref,path,out)
        self.assertEqual(read_json(out/'coverage.json')['elements'][1]['region'],[10,2,100,108])

    def test_real_failure_shapes_fit_without_extreme_canvas_or_repeated_guessing(self):
        for sizes in [[[640,100]]*5,[[76,76]]*5,[[300,128],[305,128]]]:
            w,h=packing_canvas(sizes)
            self.assertLessEqual(max(w/h,h/w),2)
            from ai_ui_decomposition.component_boards import plan_boards
            s=plan_boards(dict(kind='ai_ui_material_observations_v2',strategy='component-family-board-v1',
                packing_canvas=[w,h],assets=[dict(id='a'+str(i),component_type='Image',component_group='g',
                target_size=size,source_reusable=False,source_evidence='') for i,size in enumerate(sizes)]))
            self.assertEqual(len(s['boards'][0]['slots']),len(sizes))

    def test_unlike_group_is_rejected_instead_of_scaled_to_fit(self):
        with self.assertRaisesRegex(ContractError,'SIMILAR_SIZE'):packing_canvas([[20,20],[300,50]])

    def test_unknown_owner_and_duplicate_board_members_fail(self):
        for mutation in ['owner','member']:
            b=fixture()
            if mutation=='owner':b['elements'][0]['owner']='unknown'
            else:b['boards'][0]['assets']=['left','left']
            path=self.root/(mutation+'.json');write_json(path,b)
            with self.assertRaises(ContractError):prepare(self.ref,path,self.root/mutation)

    def test_no_boards_and_existing_output_keep_safety_boundaries(self):
        b=fixture();b['boards']=[];path=self.root/'singles.json';write_json(path,b)
        out=self.root/'singles';r=prepare(self.ref,path,out)
        self.assertEqual(r['maximumCalls'],4)
        before=(out/'preparation.json').read_bytes()
        with self.assertRaisesRegex(ContractError,'OUTPUT_EXISTS'):prepare(self.ref,path,out)
        self.assertEqual(before,(out/'preparation.json').read_bytes())

    def test_public_cli_has_same_non_generating_result(self):
        import contextlib,io
        from ai_ui_decomposition.assets_cli import main
        with contextlib.redirect_stdout(io.StringIO()):
            code=main(['prepare-brief','--legacy-brief','--reference',str(self.ref),'--brief',str(self.brief),'--output',str(self.root/'cli')])
        self.assertEqual(code,0)
        self.assertEqual(read_json(self.root/'cli/preparation.json')['generationCalls'],0)

    def test_host_request_binds_reference_and_measures_submission_without_model_timer(self):
        path=self.root/'request.json';request=request_brief(self.ref,path)
        result=prepare(self.ref,self.brief,self.root/'timed',path)
        self.assertEqual(result['requestTiming']['requestDigest'],request['digest'])
        self.assertGreaterEqual(result['requestTiming']['elapsedSeconds'],0)
        self.assertEqual(result['requestTiming']['startedAt'],request['startedAt'])

    def test_changed_request_and_changed_reference_are_rejected(self):
        path=self.root/'request.json';request=request_brief(self.ref,path)
        changed=self.root/'changed.json';write_json(changed,dict(request,startedAt='2000-01-01T00:00:00+00:00'))
        with self.assertRaisesRegex(ContractError,'BRIEF_REQUEST_CHANGED'):
            prepare(self.ref,self.brief,self.root/'bad-request',changed)
        Image.new('RGB',(128,128),'red').save(self.ref)
        with self.assertRaisesRegex(ContractError,'BRIEF_REQUEST_REFERENCE_CHANGED'):
            prepare(self.ref,self.brief,self.root/'bad-source',path)

    def test_invalid_clock_cannot_fabricate_negative_or_naive_wait_time(self):
        request=request_brief(self.ref,self.root/'request.json')
        for i,stamp in enumerate(['2999-01-01T00:00:00+00:00','2026-01-01T00:00:00',None]):
            changed=dict(request,startedAt=stamp)
            changed['digest']=digest({k:v for k,v in changed.items() if k!='digest'})
            path=self.root/f'clock-{i}.json';write_json(path,changed)
            with self.assertRaisesRegex(ContractError,'BRIEF_REQUEST_CLOCK'):
                prepare(self.ref,self.brief,self.root/f'clock-{i}',path)

    def test_repeated_placements_create_nodes_without_extra_generation(self):
        b=fixture();b['assets'][2]['placements']=[[20,30],[20,60]]
        path=self.root/'repeat.json';write_json(path,b)
        result=prepare(self.ref,path,self.root/'repeat')
        plan=read_json(self.root/'repeat/plan.json')
        self.assertEqual(len(plan['nodes']),5)
        self.assertEqual(result['maximumCalls'],3)

    def test_explicit_observed_repeat_survives_board_freeze_and_source_binding(self):
        b=fixture();b['assets'][2]['placements']=[[20,30],[20,60]]
        b['elements'].append(dict(id='second-circle',label='Second circle',region=[20,60,20,20],
            owner='left',reuse=dict(element='circle',reason='Reviewed same circle and size at both locations')))
        path=self.root/'mapped.json';write_json(path,b)
        out=self.root/'mapped';r=prepare(self.ref,path,out)
        _,_,target,_=verify(out/'compiled',out/'workspace/runs/generation')
        self.assertEqual(r['maximumCalls'],3)
        self.assertEqual(target['reference_coverage']['elements'][-1]['region'],[20,60,20,20])
        geometry=read_json(out/'planning-check.json')['geometry'][-1]
        self.assertEqual(geometry['sourceRegion'],[20,30,20,20])
        self.assertTrue(geometry['reuseTransformValid'])

    def test_repeat_without_explicit_mapping_still_fails(self):
        b=fixture();b['assets'][2]['placements']=[[20,30],[20,60]]
        b['elements'].append(dict(id='second-circle',label='Second circle',region=[20,60,20,20],owner='left'))
        path=self.root/'unmapped.json';write_json(path,b)
        with self.assertRaisesRegex(ContractError,'PLANNING_SOURCE_GAP:second-circle'):
            prepare(self.ref,path,self.root/'unmapped')

    def test_repeat_mapping_rejects_missing_evidence_wrong_owner_scale_and_chain(self):
        for mutation in ('reason','owner','size','chain','missing','self','placement'):
            with self.subTest(mutation=mutation):
                b=fixture();b['assets'][2]['placements']=[[20,30],[20,60]]
                repeat=dict(id='second-circle',label='Second circle',region=[20,60,20,20],owner='left',
                            reuse=dict(element='circle',reason='Reviewed repeat'))
                b['elements'].append(repeat)
                if mutation=='reason':repeat['reuse']['reason']=' '
                if mutation=='owner':repeat['owner']='right'
                if mutation=='size':repeat['region'][2]=19
                if mutation=='chain':b['elements'][2]['reuse']=dict(element='second-circle',reason='cycle')
                if mutation=='missing':repeat['reuse']['element']='unknown'
                if mutation=='self':repeat['reuse']['element']='second-circle'
                if mutation=='placement':b['assets'][2]['placements'][1]=[19,60]
                path=self.root/(mutation+'.json');write_json(path,b)
                with self.assertRaises(ContractError):prepare(self.ref,path,self.root/mutation)

    def test_budget_increase_is_reported_without_approval_or_freeze_block(self):
        first=self.root/'first';prepare(self.ref,self.brief,first)
        b=fixture();b['boards']=[];path=self.root/'split.json';write_json(path,b)
        second=self.root/'second'
        result=prepare(self.ref,path,second,previous_budget_path=first/'budget-review.json')
        budget=read_json(second/'budget-review.json')
        self.assertEqual((budget['previousCalls'],budget['plannedCalls'],budget['change']),(3,4,1))
        self.assertEqual(result['maximumCalls'],budget['plannedCalls'])
        self.assertEqual(budget['candidates'][0]['assetIds'],['left','right'])
        self.assertEqual(result['generationCalls'],0)
        self.assertEqual(read_json(second/'brief.json'),b)

    def test_budget_survives_geometry_failure_and_cli_can_review_without_freezing(self):
        import contextlib,io
        from ai_ui_decomposition.assets_cli import main
        b=fixture();b['elements'][1]['region']=[10,2,100,108]
        path=self.root/'bad.json';write_json(path,b);out=self.root/'bad'
        with self.assertRaisesRegex(ContractError,'PLANNING_SOURCE_GAP'):prepare(self.ref,path,out)
        self.assertEqual(read_json(out/'budget-review.json')['plannedCalls'],3)
        report=self.root/'standalone.json'
        with contextlib.redirect_stdout(io.StringIO()):
            code=main(['budget-review','--plan',str(out/'plan.json'),'--groups',str(out/'groups.json'),
                       '--output',str(report),'--previous-budget',str(out/'budget-review.json')])
        self.assertEqual(code,0)
        self.assertEqual(read_json(report)['change'],0)
        self.assertFalse((out/'workspace').exists())
