"""Offline regressions for fragmented UI requests and six-owner transport."""
import _bootstrap
import unittest
from PIL import Image
from ai_ui_layers.generation_groups import (
    build_groups, configured_policy, COMPACT_CONTROL_POLICY, CONTEXT_GROUP_POLICY,
)
from ai_ui_layers import host_delivery as host, host_m1, sheet_layout_reference, experimental_executor
from ai_ui_layers.evaluate import read, save
from ai_ui_layers.execution_preflight import preflight
import test_host_delivery as fixtures
import test_host_sheet_fallback as fallback_fixtures
import test_fast_warning_delivery as fast_fixtures
import test_host_m1 as m1_fixtures


def controls():
    # Geometry reproduces nineteen independent materials on a settings screen;
    # there are no user images, private paths, model responses or provider calls.
    rows=[('background',1374,1145),('panel',1013,822),('panel',936,647),
        ('panel',939,72),('icon',42,42),('button',465,72),('button',471,72),
        ('decoration',936,65),('decoration',936,64),('decoration',486,22),
        ('decoration',327,20),('badge',49,50),('button',112,55),('button',113,59),
        ('badge',49,50),('button',619,67),('icon',24,17),('button',349,80),('button',336,81)]
    objects=[];assets=[]
    for i,(kind,w,h) in enumerate(rows):
        key='material-'+str(i)
        objects.append(dict(materialId=key,kind=kind))
        assets.append(dict(id=key,role='background' if i==0 else 'important_component',output_size=[w,h]))
    return dict(objects=objects),dict(assets=assets)


class CompactControlGroupTests(unittest.TestCase):
    def test_nineteen_settings_materials_use_six_requests_without_downsampling(self):
        visual,plan=controls()
        self.assertEqual(build_groups(visual,plan,CONTEXT_GROUP_POLICY)['plannedCalls'],12)
        result=build_groups(visual,plan,COMPACT_CONTROL_POLICY)
        self.assertEqual(result['plannedCalls'],6)
        self.assertEqual([len(g['materialIds']) for g in result['groups']],[1,1,1,6,6,4])
        self.assertEqual(result,build_groups(visual,plan,COMPACT_CONTROL_POLICY))
        all_ids=[mid for group in result['groups'] for mid in group['materialIds']]
        self.assertEqual(len(all_ids),len(set(all_ids)))
        self.assertEqual(set(all_ids),{a['id'] for a in plan['assets']})
        by_id={a['id']:a for a in plan['assets']}
        for group in result['groups']:
            if group['mode']!='sheet':continue
            cols,rows=group['grid'];width,height=group['outputSize']
            self.assertEqual(cols*rows,len(group['materialIds']))
            for mid in group['materialIds']:
                w,h=by_id[mid]['output_size']
                self.assertGreaterEqual(.8*(width//cols)/w,1)
                self.assertGreaterEqual(.8*(height//rows)/h,1)

    def test_dense_groups_do_not_admit_illustrations_logos_unknowns_or_backgrounds(self):
        for kind in ('illustration','logo','unknown','card','background'):
            with self.subTest(kind=kind):
                visual=dict(objects=[dict(materialId=key,kind=kind) for key in ('a','b')])
                plan=dict(assets=[dict(id=key,role='background' if kind=='background' else 'important_component',
                    output_size=[40,40]) for key in ('a','b')])
                groups=build_groups(visual,plan,COMPACT_CONTROL_POLICY)['groups']
                self.assertEqual([g['mode'] for g in groups],['single','single'])

    def test_small_panels_can_share_a_sheet_but_large_panels_remain_full_resolution(self):
        visual=dict(objects=[dict(materialId=key,kind='panel') for key in ('a','b')])
        def plan(w,h):return dict(assets=[dict(id=key,role='important_component',output_size=[w,h]) for key in ('a','b')])
        self.assertEqual(build_groups(visual,plan(200,150),COMPACT_CONTROL_POLICY)['plannedCalls'],1)
        self.assertEqual(build_groups(visual,plan(1013,822),COMPACT_CONTROL_POLICY)['plannedCalls'],2)

    def test_policy_is_opt_in_and_cannot_silently_apply_to_single_or_full_reference(self):
        self.assertEqual(configured_policy({},'sheets','context-crops'),CONTEXT_GROUP_POLICY)
        for mode,reference,policy in [('single','context-crops',COMPACT_CONTROL_POLICY),
                ('sheets','full',COMPACT_CONTROL_POLICY),('sheets','context-crops','unknown')]:
            with self.assertRaisesRegex(ValueError,'CONTEXT_CONTROL_GROUPING_REQUIRED'):
                configured_policy(dict(generationGroupingPolicy=policy),mode,reference)


class CompactControlHostTests(unittest.TestCase):
    setUp=fixtures.HostDeliveryTests.setUp
    prepare=fallback_fixtures.HostSheetFallbackTests.prepare
    acquire=fallback_fixtures.HostSheetFallbackTests.acquire
    finish=fast_fixtures.FastWarningDeliveryTests.finish
    check_output=fast_fixtures.FastWarningDeliveryTests.check_output

    def add_coins(self):
        source=next(m for m in self.plan['materials'] if m['id']=='asset-coin-a')
        for i in range(4):
            key='asset-extra-'+str(i)
            self.plan['materials'].append(dict(source,id=key,bboxNorm=[.1+i*.1,.1,.15+i*.1,.15]))
            self.plan['objects'].append(dict(id='extra-'+str(i),label='Synthetic fixture control '+str(i),
                kind=('badge','button','icon','badge')[i],materialId=key,bboxNorm=None))
        fixtures.review_fixtures.save(self.candidate,self.plan)

    def test_six_owner_request_freezes_builds_board_reviews_and_exports_without_body_calls(self):
        self.add_coins()
        self.prepare(generationGroupingPolicy=COMPACT_CONTROL_POLICY,maximumBodyCalls=1)
        snapshot=self.run/'frozen'
        self.assertEqual(read(self.run/'planning/.dag/config.json')['generationGroupingPolicy'],COMPACT_CONTROL_POLICY)
        self.assertEqual(read(snapshot/'generation-groups.json')['policy'],COMPACT_CONTROL_POLICY)
        preflight(snapshot,read(snapshot/'snapshot.json')['digest'])
        row=next(r for r in read(snapshot/'requests.json')['requests'] if len(r.get('materialIds',[]))==6)
        config,index=experimental_executor.load_job(self.run/'images')
        args=experimental_executor.frozen_request_arguments(self.run/'images',config,index[row['asset']])
        self.assertEqual(len(args['referenced_image_paths']),1)
        self.assertEqual(read(self.run/'images/context-boards'/row['asset']/'sheet-layout/board.json')['materialIds'],row['materialIds'])
        metadata,png,prompt=sheet_layout_reference.build(snapshot,row,prompt_version='v2')
        self.assertEqual(metadata['materialIds'],row['materialIds'])
        self.assertEqual(len(metadata['cells']),6)
        self.assertGreater(len(png),0)
        self.acquire(False)
        from ai_ui_layers.received_bundle import inspect_sources
        from ai_ui_layers.evaluate import digest
        checked=inspect_sources(snapshot,config['snapshotDigest'],{key:self.run/'images' for key in config['assets']},require_all=True)
        record=next(r for r in checked['records'] if r['asset']==row['asset'])
        self.assertEqual(record['promptMode'],'source_bound_context_board')
        self.assertEqual(record['promptSha256'],digest(self.run/'images/context-boards'/row['asset']/'sheet-layout/prompt.txt'))
        self.assertEqual(record['contextBoardReference'],config['contextBoardReferences'][row['asset']])
        self.finish();self.check_output()
        self.assertEqual(read(self.run/'diagnostic-output/result.json')['layerCount'],9)

    def test_native_board_tampering_is_rejected_before_authorization(self):
        self.add_coins()
        self.prepare(generationGroupingPolicy=COMPACT_CONTROL_POLICY,maximumBodyCalls=1)
        job=self.run/'images'
        config,index=experimental_executor.load_job(job)
        key=next(iter(config['contextBoardReferences']))
        board=job/'context-boards'/key/'sheet-layout/board.png'
        board.write_bytes(b'changed reference board')
        with self.assertRaisesRegex(ValueError,'SHEET_LAYOUT_ARTIFACT_CHANGED'):
            experimental_executor.authorize(job,config['digest'],'offline fixture')
        self.assertFalse((job/'authorization.json').exists())
        self.assertEqual(list((job/'attempts').iterdir()),[])

    def test_fresh_m1_passes_opt_in_grouping_to_independent_planning_and_freeze(self):
        self.add_coins()
        config=read(self.config_path);config.pop('seed')
        config.update(planningMode=host_m1.MODE,m1Planner='fixture-author',generationGroupingPolicy=COMPACT_CONTROL_POLICY)
        path=self.base/'fresh-compact.json';save(path,config)
        self.run=self.base/'fresh-compact';host.prepare(path,self.run)
        self.root=self.run/'planning'
        m1_fixtures.FreshHostM1Tests.generate(self)
        self.assertEqual(read(self.root/'.dag/config.json')['generationGroupingPolicy'],COMPACT_CONTROL_POLICY)
        self.response=self.base/'m2-compact-response.json'
        fixtures.HostDeliveryTests.planning(self)
        self.assertEqual(read(self.run/'frozen/generation-groups.json')['policy'],COMPACT_CONTROL_POLICY)
        self.assertTrue(any(len(r.get('materialIds',[]))==6 for r in read(self.run/'frozen/requests.json')['requests']))


if __name__=='__main__':unittest.main()
