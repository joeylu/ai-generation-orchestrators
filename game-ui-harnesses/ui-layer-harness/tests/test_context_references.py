import _bootstrap
import json
from pathlib import Path
import tempfile
import unittest
from PIL import Image, ImageDraw
from ai_ui_layers import experimental_executor as exchange
from ai_ui_layers import context_references as context
from ai_ui_layers.compile_visual import compile_plan, HARNESS
from ai_ui_layers.freeze_visual import freeze, body_digest
from ai_ui_layers.execution_preflight import preflight
from ai_ui_layers.evaluate import read, digest
from ai_ui_layers.generation_groups import build_groups, DEFAULT_GROUP_POLICY, CONTEXT_GROUP_POLICY
from ai_ui_layers.generate_session import build_session_prompt
from ai_ui_layers.frozen_image_arguments import tool_arguments
import test_compile_visual


def save(path,value):
    # Test fixtures deliberately mutate and rehash evidence to exercise preflight.
    Path(path).write_text(json.dumps(value,ensure_ascii=False),encoding='utf-8')


class ContextReferencesTests(unittest.TestCase):
    def setUp(self):
        test_compile_visual.VisualCompileTests.setUp(self)
        self.visual=read(HARNESS/'planning-harness/examples/visual-plan-scoped.json')
        self.visual['unknowns']=[]
        # Asymmetric fixture pixels make crop identity and order observable.
        image=Image.new('RGBA',(1000,1000),(8,16,24,255));draw=ImageDraw.Draw(image)
        draw.rectangle((650,200,760,320),fill=(255,100,20,180))
        draw.rectangle((650,350,760,470),fill=(30,70,240,90))
        image.save(self.run/'m1/reference.png')
        self.bind()

    def bind(self):
        save(self.run/'m1/draft.json',self.visual)
        request=read(self.run/'request.json')
        request['inputs']['reference.png']=digest(self.run/'m1/reference.png')
        save(self.run/'request.json',request)
        review=read(self.run/'m2/request.json');review['sourcePlanSha256']=digest(self.run/'m1/draft.json')
        save(self.run/'m2/request.json',review)
        result=read(self.run/'result.json');result['sourcePlanSha256']=digest(self.run/'m1/draft.json')
        save(self.run/'result.json',result)

    def frozen(self,mode='sheets',reference='context-crops',name='frozen'):
        folder=self.root/name;manifest=freeze(self.run,folder,16,mode,reference)
        return folder,manifest

    def legacy_frozen(self,name='legacy-context'):
        folder=self.root/name
        manifest=freeze(self.run,folder,16,'sheets','context-crops',context_prompt_version='v1')
        return folder,manifest

    def resign(self,folder):
        manifest=read(folder/'snapshot.json')
        for name in manifest['files']:manifest['files'][name]=digest(folder/name)
        manifest['digest']=body_digest({k:v for k,v in manifest.items() if k!='digest'})
        save(folder/'snapshot.json',manifest)
        return manifest['digest']

    def test_margin_minimum_cap_clamp_and_local_coordinates(self):
        asset=dict(id='small',role='important_component',source_region=[2,3,42,43])
        ref=context.geometry(asset,[100,80])
        self.assertEqual(ref['cropRegion'],[0,0,50,51])
        self.assertEqual(ref['contextMargin'],8)
        self.assertEqual(ref['targetBox'],[2,3,42,43])
        self.assertEqual(context.local_box([.02,.0375,.42,.5375],ref,[100,80]),ref['targetBoxNorm'])
        asset['source_region']=[100,100,900,900]
        self.assertEqual(context.geometry(asset,[1000,1000])['contextMargin'],64)
        asset['source_region']=[100,100,191,191]
        self.assertEqual(context.geometry(asset,[1000,1000])['contextMargin'],10)

    def test_frozen_context_changes_only_generation_inputs(self):
        full,old=self.frozen(reference='full',name='full')
        folder,manifest=self.frozen()
        self.assertNotEqual(old['digest'],manifest['digest'])
        self.assertEqual(read(full/'placements.json'),read(folder/'placements.json'))
        before=read(full/'execution-plan.candidate.json');after=read(folder/'execution-plan.candidate.json')
        for left,right in zip(before['assets'],after['assets']):
            self.assertEqual({k:v for k,v in left.items() if k!='prompt'},
                             {k:v for k,v in right.items() if k!='prompt'})
        refs=read(folder/'generation-references.json')['references']
        scene=next(r for r in refs if r['materialId']=='asset-scene')
        self.assertEqual(scene['reference'],'reference.png')
        self.assertEqual(scene['sha256'],digest(folder/'reference.png'))
        coin=next(r for r in refs if r['materialId']=='asset-coin-a')
        self.assertEqual(coin['cropRegion'],[692,242,758,308])
        self.assertEqual(coin['targetBox'],[8,8,58,58])
        self.assertEqual(coin['sourceSha256'],scene['sha256'])
        with Image.open(folder/coin['reference']) as actual,Image.open(folder/'reference.png') as source:
            self.assertEqual(actual.tobytes(),source.crop(coin['cropRegion']).tobytes())
        self.assertEqual(preflight(folder,manifest['digest'])['generationReference'],'context-crops')
        self.assertNotIn('generationReference',read(full/'requests.json'))

    def test_context_group_policy_caps_four_without_changing_old_six(self):
        materials=[];objects=[];assets=[]
        for i in range(6):
            key='icon-'+str(i);materials.append(dict(id=key,role='foreground'))
            objects.append(dict(materialId=key,kind='icon'))
            assets.append(dict(id=key,role='important_component',output_size=[40,40]))
        visual=dict(materials=materials,objects=objects);plan=dict(assets=assets)
        old=build_groups(visual,plan,DEFAULT_GROUP_POLICY);new=build_groups(visual,plan,CONTEXT_GROUP_POLICY)
        self.assertEqual([len(g['materialIds']) for g in old['groups']],[6])
        self.assertEqual([len(g['materialIds']) for g in new['groups']],[4,2])
        one=build_groups(visual,dict(assets=assets[:1]),CONTEXT_GROUP_POLICY)['groups'][0]
        self.assertEqual(one['mode'],'single')

    def test_prompt_retains_boxed_appearance_with_local_layout(self):
        obj=next(o for o in self.visual['objects'] if o['materialId']=='asset-coin-a')
        obj['label']='Blue coin with six red dots and a small hanging silver tag'
        obj['bboxNorm']=[.7,.25,.75,.30]
        self.bind();folder,manifest=self.frozen()
        row=next(r for r in read(folder/'requests.json')['requests'] if r.get('kind')=='sheet')
        prompt=(folder/row['prompt']).read_text(encoding='utf-8')
        self.assertIn(obj['label'],prompt)
        self.assertIn('withinMaterial',prompt)
        self.assertIn('referenceIndex',prompt)
        self.assertIn('targetBox',prompt)
        self.assertIn('real continuous alpha',prompt)
        self.assertIn('10% fully transparent margin',prompt)
        self.assertIn('preserveText',prompt)
        self.assertNotIn('Use the full reference',prompt)
        data=__import__('json').loads(prompt.split('Entries: ',1)[1])
        part=next(p for e in data for p in e['parts'] if p['id']==obj['id'])
        ref=row['references'][0]
        self.assertEqual(part['referenceBox'],context.local_box(obj['bboxNorm'],ref,[1000,1000]))
        self.assertEqual(part['withinMaterial'],[.5,.5,1.0,1.0])
        self.assertEqual([e['materialId'] for e in data],row['materialIds'])
        self.assertEqual([r['referenceIndex'] for r in row['references']],[1,2])

    def test_new_context_prompt_is_versioned_and_legacy_snapshot_stays_v1(self):
        old,old_manifest=self.legacy_frozen()
        new,new_manifest=self.frozen(name='new-context')
        self.assertNotIn('contextPromptVersion',old_manifest)
        self.assertEqual(new_manifest['contextPromptVersion'],'v2')
        self.assertEqual(preflight(old,old_manifest['digest'])['inputChecks'],'passed')
        self.assertEqual(preflight(new,new_manifest['digest'])['inputChecks'],'passed')
        old_plan=read(old/'execution-plan.candidate.json')
        new_plan=read(new/'execution-plan.candidate.json')
        self.assertTrue(all(a['prompt'].startswith(context.PROMPT_PREFIX_V1) for a in old_plan['assets']))
        self.assertTrue(all(a['prompt'].startswith(context.PROMPT_PREFIX_V2) for a in new_plan['assets']))
        old_sheet=next(r for r in read(old/'requests.json')['requests'] if r.get('kind')=='sheet')
        new_sheet=next(r for r in read(new/'requests.json')['requests'] if r.get('kind')=='sheet')
        # These are historical d7 prompt bytes from this fixed fixture, not
        # another call to the v1 renderer under test.
        self.assertEqual(digest(old/'materials/asset-panel/prompt.txt'),
                         'ab67b1c41c8a295e6477e53bd4d49b928454fba201965894c130d2faae686808')
        self.assertEqual(digest(old/old_sheet['prompt']),
                         '327db8028fc12cf1fe7ba87a4914fd413c3dbfd1235a70854f29d682a6bbfa44')
        old_text=(old/old_sheet['prompt']).read_text(encoding='utf-8')
        new_text=(new/new_sheet['prompt']).read_text(encoding='utf-8')
        self.assertLess(len(new_text),len(old_text))
        self.assertIn('cellIndex is 0-based',new_text)
        self.assertIn('withinMaterial=(centerX,centerY,width,height)',new_text)
        self.assertIn('canvas aspect',new_text)
        self.assertIn('artworkPixelSize is planned crop size',new_text)
        self.assertIn('without underlying scene',new_text)
        self.assertNotIn('For sheets',context.prompt(self.visual,new_plan,
            [new_plan['assets'][1]['id']]))

    def test_context_group_preview_uses_frozen_prompt_version(self):
        from ai_ui_layers.generation_groups import preview
        for name,folder,manifest in (
            ('old-preview',*self.legacy_frozen()),
            ('new-preview',*self.frozen(name='new-snapshot')),
        ):
            output=self.root/name
            preview(folder,manifest['digest'],output)
            for row in read(folder/'requests.json')['requests']:
                if row.get('kind')=='sheet':
                    self.assertEqual((output/(row['asset']+'.txt')).read_bytes(),
                                     (folder/row['prompt']).read_bytes())

    def test_rehashed_context_version_removal_and_cross_version_prompt_fail(self):
        folder,_=self.frozen()
        manifest=read(folder/'snapshot.json');manifest.pop('contextPromptVersion')
        report=read(folder/'compile-report.json');report.pop('contextPromptVersion')
        save(folder/'compile-report.json',report);save(folder/'snapshot.json',manifest)
        with self.assertRaisesRegex(ValueError,'CONTEXT_PLAN_COMPILER_MISMATCH'):
            preflight(folder,self.resign(folder))
        old,_=self.legacy_frozen()
        rows=read(old/'requests.json')['requests']
        sheet=next(r for r in rows if r.get('kind')=='sheet')
        replacement=self.frozen(name='v2-source')[0]
        other=next(r for r in read(replacement/'requests.json')['requests'] if r.get('kind')=='sheet')
        (old/sheet['prompt']).write_bytes((replacement/other['prompt']).read_bytes())
        with self.assertRaisesRegex(ValueError,'PROMPT_COMPILER_MISMATCH'):
            preflight(old,self.resign(old))

    def test_preflight_recomputes_rehashed_crop_and_metadata(self):
        folder,_=self.frozen();refs=read(folder/'generation-references.json')
        ref=next(r for r in refs['references'] if r['materialId']=='asset-coin-a')
        Image.new('RGBA',tuple(ref['referenceSize']),(1,2,3,4)).save(folder/ref['reference'])
        ref['sha256']=digest(folder/ref['reference']);save(folder/'generation-references.json',refs)
        with self.assertRaisesRegex(ValueError,'CONTEXT_REFERENCE_MISMATCH'):
            preflight(folder,self.resign(folder))
        folder2,_=self.frozen(name='metadata')
        refs=read(folder2/'generation-references.json');refs['references'][1]['targetBox'][0]+=1
        save(folder2/'generation-references.json',refs)
        with self.assertRaisesRegex(ValueError,'CONTEXT_REFERENCE_METADATA_MISMATCH'):
            preflight(folder2,self.resign(folder2))

    def test_rehashed_reference_order_prompt_and_group_policy_are_rejected(self):
        folder,_=self.frozen();requests=read(folder/'requests.json')
        row=next(r for r in requests['requests'] if r.get('kind')=='sheet');row['references'].reverse()
        save(folder/'requests.json',requests)
        with self.assertRaisesRegex(ValueError,'GROUP_REQUEST_MISMATCH'):
            preflight(folder,self.resign(folder))
        second,_=self.frozen(name='prompt');rows=read(second/'requests.json')['requests']
        sheet=next(r for r in rows if r.get('kind')=='sheet')
        (second/sheet['prompt']).write_text('Rewrite the artwork.',encoding='utf-8')
        with self.assertRaisesRegex(ValueError,'PROMPT_COMPILER_MISMATCH'):
            preflight(second,self.resign(second))
        third,_=self.frozen(name='policy');groups=read(third/'generation-groups.json')
        groups['policy']=DEFAULT_GROUP_POLICY;save(third/'generation-groups.json',groups)
        with self.assertRaisesRegex(ValueError,'CONTEXT_GROUP_POLICY_MISMATCH'):
            preflight(third,self.resign(third))

    def test_job_next_session_use_frozen_context_refs_and_cannot_retry(self):
        folder,manifest=self.frozen();rows=read(folder/'requests.json')['requests']
        sheet=next(r for r in rows if r.get('kind')=='sheet')
        job=self.root/'job';config=exchange.prepare(folder,manifest['digest'],job,[sheet['asset']])
        self.assertEqual(config['referenceMode'],'context-crops')
        with self.assertRaisesRegex(ValueError,'EXPLICIT_BOUND_APPROVAL_REQUIRED'):
            exchange.authorize(job,'old-job-digest','fixture')
        exchange.authorize(job,config['digest'],'offline fixture only')
        request=exchange.next_request(job)
        expected=[str((job/'snapshot'/r['reference']).resolve()) for r in sheet['references']]
        self.assertEqual(request['arguments']['referenced_image_paths'],expected)
        self.assertEqual(request['arguments']['prompt'],(folder/sheet['prompt']).read_text(encoding='utf-8').rstrip('\n'))
        self.assertEqual(request['references'],sheet['references'])
        relay=tool_arguments(request,True)
        self.assertEqual(relay['num_last_images_to_include'],2)
        self.assertEqual(relay['prompt'],request['arguments']['prompt'])
        message=build_session_prompt(request['arguments'],'context-crops',True)
        self.assertIn('expanded context crops',message)
        self.assertNotIn(request['arguments']['prompt'],message)
        exchange.fail(job,request['submissionDigest'],'fixture uncertainty')
        with self.assertRaisesRegex(ValueError,'NOT_READY_NO_RESUBMIT'):exchange.next_request(job)
        self.assertEqual(exchange.status(job)['assignedCalls'],1)

    def test_rehashed_mode_removal_cannot_downgrade_context_snapshot(self):
        folder,_=self.frozen(mode='single');requests=read(folder/'requests.json')
        requests.pop('generationReference')
        for row in requests['requests']:
            row.pop('generationReference');row.pop('references')
        save(folder/'requests.json',requests)
        manifest=read(folder/'snapshot.json');manifest.pop('generationReference')
        save(folder/'snapshot.json',manifest)
        with self.assertRaisesRegex(ValueError,'CONTEXT_REFERENCE_MODE_MISMATCH'):
            preflight(folder,self.resign(folder))

    def test_collection_checks_rehashed_context_metadata_against_frozen_request(self):
        from ai_ui_layers import frozen_image_arguments as frozen
        from ai_ui_layers.collect_session import audit_relay
        folder,manifest=self.frozen();row=next(r for r in read(folder/'requests.json')['requests'] if r.get('kind')=='sheet')
        job=self.root/'relay-job';config=exchange.prepare(folder,manifest['digest'],job,[row['asset']])
        exchange.authorize(job,config['digest'],'offline fixture')
        request=exchange.next_request(job);session=self.root/'session';session.mkdir()
        save(session/'tool-request.json',request)
        sha=frozen.prepare(session,request,True)
        server=frozen.ArgumentServer(session/'frozen-image-arguments.json',sha)
        server.handle(dict(method='initialize',params={}))
        server.handle(dict(method='notifications/initialized'))
        server.handle(dict(method='tools/call',params=dict(name=frozen.TOOL,arguments={})))
        dispatch=dict(toolRequestSha256=digest(session/'tool-request.json'),transparentBackground=True,
                      imageArgumentsSha256=sha,argumentServerSha256=digest(Path(frozen.__file__)))
        events=[dict(payload=dict(type='custom_tool_call',name='functions.exec'))]
        actual=audit_relay(job,session,request,dispatch,events,frozen.RELAY_CODE)
        self.assertEqual(actual,(request['arguments']['prompt'],True))
        request['references'].reverse();save(session/'tool-request.json',request)
        dispatch['toolRequestSha256']=digest(session/'tool-request.json')
        with self.assertRaisesRegex(ValueError,'SESSION_CONTEXT_REFERENCES_MISMATCH'):
            audit_relay(job,session,request,dispatch,events,frozen.RELAY_CODE)

    def test_context_is_opt_in_and_cannot_change_frozen_parameters(self):
        full,old=self.frozen(reference='full',name='old')
        with self.assertRaisesRegex(ValueError,'CONTEXT_SNAPSHOT_REQUIRED'):
            exchange.prepare(full,old['digest'],self.root/'wrong',reference_mode='context-crops')
        folder,manifest=self.frozen();override=self.root/'override.txt';override.write_text('change it')
        for mode in ('full-only','sheet-crops-only'):
            with self.assertRaisesRegex(ValueError,'FROZEN_CONTEXT_REFERENCE_REQUIRED'):
                exchange.prepare(folder,manifest['digest'],self.root/mode,reference_mode=mode)
        with self.assertRaisesRegex(ValueError,'FROZEN_CONTEXT_REFERENCE_REQUIRED'):
            exchange.prepare(folder,manifest['digest'],self.root/'override',prompt_override=override)
        single,snapshot=self.frozen(mode='single',name='single')
        self.assertEqual(preflight(single,snapshot['digest'])['requestCount'],5)

    def test_context_sheet_keeps_receive_extract_review_registration_package_gates(self):
        import zipfile
        from ai_ui_layers import delivery_dag as delivery
        from test_planning_dag import FakeModel
        import test_sheet_delivery
        viewer=self.root/'viewer';viewer.mkdir()
        (viewer/'viewer.html').write_text('<html></html>')
        (viewer/'viewer.js').write_text('void 0;')
        self.run=delivery.init(self.run/'m1/reference.png',self.root/'delivery-run',viewer,
                              max_calls=16,generation_reference='context-crops')
        self.calls=0
        self.dag=delivery.DeliveryDag(self.run,FakeModel(),sheet_model=lambda folder:
            test_sheet_delivery.SheetDeliveryTests.review(self,folder))
        self.dag.execute();self.job=self.run/'generation'
        test_sheet_delivery.SheetDeliveryTests.media(self)
        result=self.dag.execute()
        self.assertEqual(result['status'],'delivered_pending_visual_review')
        self.assertFalse(result['humanVisualAcceptance'])
        self.assertEqual(self.calls,1)
        extracted=read(self.run/'extraction/result.json')
        self.assertEqual(len(extracted['materials']),5)
        detail=read(self.run/'extraction'/self.sheets[0]/'detail-compare.json')
        for item in detail['rows']:
            target=self.job/'snapshot/materials'/item['materialId']/'reference-crop.png'
            context_path=self.job/'snapshot/materials'/item['materialId']/'context-reference.png'
            self.assertNotEqual(digest(target),digest(context_path))
            self.assertEqual(item['referenceCropSha256'],digest(target))
        with zipfile.ZipFile(self.run/'delivery/ui-layers.zip') as archive:
            self.assertEqual(len(json.loads(archive.read('composition.json'))['layers']),5)
        self.dag.execute();self.assertEqual(self.calls,1)

    def test_delivery_and_planning_freeze_mode_without_extra_model_calls(self):
        from ai_ui_layers import delivery_dag as delivery
        from test_planning_dag import FakeModel
        source=self.run/'m1/reference.png';run=self.root/'public-run'
        delivery.init(source,run,target='frozen',max_calls=16,generation_reference='context-crops')
        model=FakeModel();result=delivery.DeliveryDag(run,model).execute()
        self.assertEqual(result['status'],'frozen')
        self.assertEqual(len(model.calls),2)
        self.assertEqual(read(run/'.dag/config.json')['generationReference'],'context-crops')
        self.assertEqual(read(run/'planning/.dag/config.json')['generationReference'],'context-crops')
        manifest=read(run/'planning/frozen/snapshot.json')
        self.assertEqual(manifest['generationReference'],'context-crops')
        self.assertEqual(preflight(run/'planning/frozen',manifest['digest'])['inputChecks'],'passed')


if __name__=='__main__':unittest.main()
