import _bootstrap
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from PIL import Image, ImageDraw

from ai_ui_layers import delivery_dag as delivery, experimental_executor as exchange
from ai_ui_layers.evaluate import read, save, digest
from ai_ui_layers.extract_sheets import cells
from ai_ui_layers.execution_preflight import preflight
from ai_ui_layers.freeze_visual import inspect
from ai_ui_layers.generation_groups import build_groups
from test_planning_dag import FakeModel


class SheetDeliveryTests(unittest.TestCase):
    def test_structured_findings_are_classified_and_bound_before_delivery(self):
        self.media()
        def review(folder):
            self.calls+=1
            ids=read(folder/'request.json')['materialIds']
            save(folder/'draft.json',dict(materialIds=ids,findings=[dict(
                materialId=ids[0],category='progress',referenceState='full',generatedState='near-full',
                magnitude='major',ownership='clear',evidence='Small gap at end.',suggestion='Optional correction.')]))
            return dict(exitCode=0,turnCompleted=True,unexpectedEvents=[],responseSha256=digest(folder/'draft.json'))
        self.dag.sheet_model=review
        result=self.dag.execute()
        self.assertEqual(result['status'],'delivered_pending_visual_review')
        assessment=read(self.run/'extraction'/self.sheets[0]/'assessment.json')
        self.assertEqual(assessment['decisions'][0]['severity'],'warning')
        self.assertFalse(assessment['humanVisualAcceptance'])
        assessment_path=self.run/'extraction'/self.sheets[0]/'assessment.json'
        assessment_path.write_text('{}')
        with self.assertRaisesRegex(ValueError,'COMPLETED_OUTPUT_CHANGED'):self.dag.status()

    def warning_review(self, folder):
        result=self.review(folder)
        answer=read(folder/'draft.json')
        answer['warnings']=[dict(category='minor-progress-deviation',
            materialId=answer['materialIds'][0], evidence='Small fill-length difference; same state.',
            suggestion='Optional visual correction after preview.')]
        (folder/'draft.json').write_text(__import__('json').dumps(answer),encoding='utf-8')
        result['responseSha256']=digest(folder/'draft.json')
        return result

    def test_warning_only_continues_and_survives_delivery_archive(self):
        import zipfile,json
        self.media();self.dag.sheet_model=self.warning_review
        result=self.dag.execute()
        self.assertEqual(result['status'],'delivered_pending_visual_review')
        warnings=result['extraction']['warnings']
        self.assertEqual(len(warnings),1)
        self.assertFalse(result['humanVisualAcceptance'])
        with zipfile.ZipFile(self.run/'delivery/ui-layers.zip') as archive:
            review=json.loads(archive.read('review.json'))
            self.assertTrue(any(warnings[0]['evidence'] in issue and warnings[0]['reviewSha256'] in issue
                                for issue in review['issues']))
            self.assertFalse(review['humanVisualAcceptance'])
        self.dag.execute();self.assertEqual(self.calls,1)

    def test_warning_cannot_override_blocking_issue(self):
        self.media()
        def review(folder):
            result=self.warning_review(folder);answer=read(folder/'draft.json')
            answer['issues']=['State reversed: selected became unselected.']
            (folder/'draft.json').write_text(__import__('json').dumps(answer),encoding='utf-8');result['responseSha256']=digest(folder/'draft.json')
            return result
        self.dag.sheet_model=review
        with self.assertRaisesRegex(ValueError,'SHEET_VISUAL_ISSUES'):self.dag.execute()
        self.assertFalse((self.run/'delivery').exists())

    def test_warning_cannot_override_wrong_identity(self):
        self.media()
        def review(folder):
            result=self.warning_review(folder);answer=read(folder/'draft.json')
            answer['materialIds'].reverse()
            (folder/'draft.json').write_text(__import__('json').dumps(answer),encoding='utf-8');result['responseSha256']=digest(folder/'draft.json')
            return result
        self.dag.sheet_model=review
        with self.assertRaisesRegex(ValueError,'SHEET_IDENTITY_MISMATCH'):self.dag.execute()

    def test_unknown_warning_category_fails_closed(self):
        self.media()
        def review(folder):
            result=self.warning_review(folder);answer=read(folder/'draft.json')
            answer['warnings'][0]['category']='missing-artwork'
            (folder/'draft.json').write_text(__import__('json').dumps(answer),encoding='utf-8');result['responseSha256']=digest(folder/'draft.json')
            return result
        self.dag.sheet_model=review
        from jsonschema import ValidationError
        with self.assertRaises(ValidationError):self.dag.execute()
        self.assertFalse((self.run/'delivery').exists())

    def test_explicit_sheet_review_from_complete_job_preserves_receipts(self):
        self.media()
        before={str(p.relative_to(self.job)):digest(p) for p in self.job.rglob('*') if p.is_file()}
        result=exchange.review_sheet(self.job,self.root/'selected-complete',self.review,request_id=self.sheets[0])
        self.assertEqual(result['selectedRequest'],self.sheets[0])
        self.assertEqual(self.calls,1)
        self.assertEqual(before,{str(p.relative_to(self.job)):digest(p) for p in self.job.rglob('*') if p.is_file()})
        with self.assertRaisesRegex(ValueError,'UNKNOWN_RECEIVED_REQUEST'):
            exchange.review_sheet(self.job,self.root/'unknown',self.review,request_id='not-received')
        with self.assertRaisesRegex(ValueError,'ONE_RECEIVED_SHEET_REQUIRED'):
            exchange.review_sheet(self.job,self.root/'single',self.review,request_id='asset-scene')

    def test_relative_extraction_paths_are_absolute_for_isolated_model(self):
        import os
        from ai_ui_layers.extract_sheets import extract
        self.media()
        previous=Path.cwd()
        def review(folder):
            self.assertTrue(folder.is_absolute())
            self.assertTrue((folder/'schema.json').is_file())
            return self.review(folder)
        try:
            os.chdir(self.root)
            snapshot=Path('run/generation/snapshot')
            current=exchange.status(self.job)
            sources={key:str(self.job/'attempts'/key/'raw.png') for key in current['requests']}
            result=extract(snapshot,inspect(snapshot)['digest'],sources,Path('relative-extraction'),review)
            self.assertEqual(result['status'],'extracted_pending_material_validation')
        finally:
            os.chdir(previous)

    def setUp(self):
        tmp=tempfile.TemporaryDirectory();self.addCleanup(tmp.cleanup);self.root=Path(tmp.name)
        image=self.root/'reference.png';Image.new('RGB',(1000,1000)).save(image)
        viewer=self.root/'viewer';viewer.mkdir()
        (viewer/'viewer.html').write_text('<html></html>');(viewer/'viewer.js').write_text('void 0;')
        self.run=delivery.init(image,self.root/'run',viewer,max_calls=4,generation_mode='sheets')
        self.calls=0
        self.dag=delivery.DeliveryDag(self.run,FakeModel(),sheet_model=self.review)
        self.dag.execute();self.job=self.run/'generation'

    def review(self,folder):
        self.calls+=1
        save(folder/'draft.json',dict(materialIds=read(folder/'request.json')['materialIds'],issues=[]))
        return dict(exitCode=0,turnCompleted=True,unexpectedEvents=[],responseSha256=digest(folder/'draft.json'))

    def media(self):
        exchange.authorize(self.job,read(self.job/'job.json')['digest'],'offline fixture only')
        self.sheets=[]
        while exchange.status(self.job)['status']=='ready':
            q=exchange.next_request(self.job)
            im=Image.new('RGBA',(240,240))
            if 'materialIds' in q:
                columns,rows=q['grid'];im=Image.new('RGBA',(columns*100,rows*100))
                draw=ImageDraw.Draw(im)
                for i,key in enumerate(q['materialIds']):
                    x=i%columns*100;y=i//columns*100
                    draw.rectangle((x+15,y+15,x+84,y+84),fill=(60+i*70,90,100,128+i*127))
                self.sheets.append(q['asset'])
            elif q['asset']=='asset-scene':im=Image.new('RGB',(240,240),(40,50,60))
            else:ImageDraw.Draw(im).rectangle((20,20,219,219),fill=(80,90,100,255))
            raw=self.root/'raw.png';im.save(raw);exchange.receive(self.job,q['submissionDigest'],raw)

    def test_one_sheet_receipt_produces_separate_layers_and_bound_pixels(self):
        config=read(self.job/'job.json');self.assertEqual(config['maximumCalls'],4)
        self.assertEqual(config['materialCount'],5)
        snap=self.job/'snapshot';self.assertEqual(preflight(snap,inspect(snap)['digest'])['requestCount'],4)
        self.media();result=self.dag.execute()
        self.assertEqual(result['status'],'delivered_pending_visual_review')
        self.assertEqual(self.calls,1);self.assertFalse(result['humanVisualAcceptance'])
        extracted=read(self.run/'extraction/result.json')
        self.assertEqual(len(extracted['materials']),5)
        sheet_prompt=(self.run/'extraction'/self.sheets[0]/'prompt.md').read_text(encoding='utf-8')
        self.assertIn('ordinary labels and numbers visible only in image 1 are intentionally removed',sheet_prompt)
        self.assertIn('Judge proportions from the visible artwork contour',sheet_prompt)
        self.assertIn('Transparent padding and placement within a grid cell are irrelevant',sheet_prompt)
        self.assertIn('Image 3 shows each frozen reference crop beside its generated cell',sheet_prompt)
        detail_folder=self.run/'extraction'/self.sheets[0]
        detail=read(detail_folder/'detail-compare.json')
        request=read(detail_folder/'request.json')
        sheet_row=next(row for row in read(self.job/'snapshot/requests.json')['requests']
                       if row['asset']==self.sheets[0])
        self.assertEqual([row['materialId'] for row in detail['rows']],sheet_row['materialIds'])
        self.assertEqual(request['inputs']['detail-compare.png'],digest(detail_folder/'detail-compare.png'))
        self.assertEqual(detail['imageSha256'],digest(detail_folder/'detail-compare.png'))
        with Image.open(detail_folder/'detail-compare.png') as comparison:
            self.assertEqual(comparison.size,(1440,480))
            self.assertEqual(comparison.getpixel((360,120)),(0,0,0))
            self.assertNotEqual(comparison.getpixel((1080,120)),(0,0,0))
        self.assertEqual({r['materialId'] for r in extracted['records']},{'asset-coin-a','asset-coin-b'})
        for record in extracted['records']:
            source=self.job/'attempts'/record['requestId']/'raw.png'
            self.assertEqual(record['sourceSha256'],digest(source))
            with Image.open(source) as whole,Image.open(extracted['materials'][record['materialId']]) as crop:
                self.assertEqual(whole.crop(record['sourceBox']).tobytes(),crop.tobytes())
                self.assertEqual(crop.getchannel('A').getextrema()[0],0)
        import zipfile,json
        with zipfile.ZipFile(self.run/'delivery/ui-layers.zip') as z:
            composition=json.loads(z.read('composition.json'))
            self.assertEqual(len(composition['layers']),5)
        self.dag.execute();self.assertEqual(self.calls,1)
        target=Path(extracted['materials']['asset-coin-a']);target.write_bytes(b'changed')
        with self.assertRaisesRegex(ValueError,'COMPLETED_OUTPUT_CHANGED'):self.dag.status()

    def test_review_sees_frozen_frame_adaptation_before_grouped_delivery(self):
        fake=FakeModel()
        def model(folder,sid,first):
            fake(folder,sid,first)
            if first:
                plan=read(folder/'draft.json')
                for mid,top in (('asset-coin-a',.25),('asset-coin-b',.4)):
                    material=next(m for m in plan['materials'] if m['id']==mid)
                    material.update(bboxNorm=[.6,top,.9,top+.08],adaptationPolicy='horizontal-frame-slice')
                    obj=next(o for o in plan['objects'] if o['materialId']==mid)
                    obj['kind']='card';obj['label']='Plain-center framed card'
                    obj['bboxNorm']=material['bboxNorm']
                (folder/'draft.json').write_text(__import__('json').dumps(plan),encoding='utf-8')
                receipt=read(folder/'transport.json');receipt['responseSha256']=digest(folder/'draft.json')
                (folder/'transport.json').write_text(__import__('json').dumps(receipt),encoding='utf-8')
        image=self.root/'reference.png';viewer=self.root/'viewer'
        run=delivery.init(image,self.root/'frame-run',viewer,max_calls=4,generation_mode='sheets')
        seen=[]
        def review(folder):
            request=read(folder/'request.json')
            seen.append(request)
            self.assertNotEqual(request['reviewSourceSha256'],request['preparedSha256'])
            self.assertIsNotNone(request['adaptedEvidenceSha256'])
            return self.review(folder)
        dag=delivery.DeliveryDag(run,model,sheet_model=review)
        self.assertEqual(dag.execute()['status'],'awaiting_authorization')
        job=run/'generation';exchange.authorize(job,read(job/'job.json')['digest'],'offline fixture')
        while exchange.status(job)['status']=='ready':
            q=exchange.next_request(job)
            if q.get('materialIds'):
                columns,rows=q['grid'];im=Image.new('RGBA',(columns*400,rows*150))
                draw=ImageDraw.Draw(im)
                for i in range(len(q['materialIds'])):
                    x=i%columns*400;y=i//columns*150
                    draw.rectangle((x+20,y+30,x+379,y+119),fill=(180,150,100,255))
                    draw.rectangle((x+23,y+33,x+376,y+116),outline=(50,30,15,255),width=2)
            elif q['asset']=='asset-scene':im=Image.new('RGB',(240,240),(40,50,60))
            else:
                im=Image.new('RGBA',(240,240));ImageDraw.Draw(im).rectangle((20,20,219,219),fill=(80,90,100,255))
            raw=self.root/'frame-raw.png';im.save(raw);exchange.receive(job,q['submissionDigest'],raw)
        dag.node('raw_complete',dag.collect_raw)
        self.assertEqual(len(seen),1)
        extracted=read(run/'extraction/result.json')
        self.assertEqual(set(extracted['adaptations']),{'asset-coin-a','asset-coin-b'})
        registered=read(run/'registration-input.json')['materials']
        for mid,report in extracted['adaptations'].items():
            self.assertEqual(digest(Path(registered[mid])),report['outputSha256'])
            self.assertFalse(report['humanVisualAcceptance'])
        evidence=read(run/'adaptation/result.json')['materials']
        self.assertEqual(set(evidence),set(extracted['adaptations']))
        dag.verify()
        self.assertEqual(dag.execute()['status'],'delivered_pending_visual_review')
        self.assertTrue((run/'delivery/ui-layers.zip').is_file())

    def test_sheet_failure_is_terminal_before_registration(self):
        self.media()
        def wrong(folder):
            result=self.review(folder);p=folder/'draft.json';a=read(p);a['materialIds'].reverse()
            p.write_text(__import__('json').dumps(a),encoding='utf-8');result['responseSha256']=digest(p)
            return result
        self.dag.sheet_model=wrong
        with patch('ai_ui_layers.delivery_dag.register',side_effect=AssertionError('must not register')):
            with self.assertRaisesRegex(ValueError,'SHEET_IDENTITY_MISMATCH'):self.dag.execute()
            with self.assertRaisesRegex(ValueError,'NO_RESUBMIT'):self.dag.execute()
        self.assertEqual(self.calls,1);self.assertFalse((self.run/'delivery').exists())

    def test_contour_failure_spends_no_review_and_cannot_auto_retry(self):
        self.media()
        # Exercise the extractor directly with an offline bad-pixel fixture;
        # the actual exchange receipts remain unchanged.
        from ai_ui_layers.extract_sheets import extract
        row=next(r for r in read(self.job/'snapshot/requests.json')['requests'] if r.get('kind')=='sheet')
        im=Image.new('RGBA',(200,100));ImageDraw.Draw(im).rectangle((10,10,190,90),fill='white')
        bad=self.root/'bad.png';im.save(bad)
        sources={r['asset']:str(self.job/'attempts'/r['asset']/'raw.png') for r in read(self.job/'snapshot/requests.json')['requests']}
        sources[row['asset']]=str(bad)
        with self.assertRaisesRegex(ValueError,'CONTOUR_TOUCHES'):
            extract(self.job/'snapshot',inspect(self.job/'snapshot')['digest'],sources,self.root/'blocked',self.review)
        self.assertEqual(self.calls,0)

    def test_review_issues_transport_or_tampering_cannot_publish(self):
        self.media()
        def tamper(folder):
            result=self.review(folder);(folder/'prompt.md').write_text('changed');return result
        self.dag.sheet_model=tamper
        with self.assertRaisesRegex(ValueError,'SHEET_INPUT_CHANGED'):self.dag.execute()
        self.assertFalse((self.run/'delivery').exists())

    def test_frozen_group_assignment_and_prompt_are_bound(self):
        p=self.job/'snapshot/generation-groups.json';p.write_text('{}')
        with self.assertRaisesRegex(ValueError,'ARTIFACT_CHANGED'):exchange.status(self.job)

    def test_explicit_single_crop_variant_preserves_frozen_pixels_and_rejects_sheets(self):
        snapshot=self.job/'snapshot';before=inspect(snapshot)['digest']
        rows=read(snapshot/'requests.json')['requests']
        row=next(r for r in rows if r.get('kind')!='sheet')
        sheet=next(r['asset'] for r in rows if r.get('kind')=='sheet')
        prompt=self.root/'crop-prompt.txt';prompt.write_text('Image 1 is full context; image 2 is a contextual crop, not a mask.')
        target=self.root/'crop-job'
        cfg=exchange.prepare(snapshot,before,target,[row['asset']],prompt,'full-and-crop')
        self.assertEqual(cfg['referenceMode'],'full-and-crop')
        exchange.authorize(target,cfg['digest'],'offline fixture')
        request=exchange.next_request(target)
        refs=request['arguments']['referenced_image_paths']
        self.assertEqual(len(refs),2)
        self.assertEqual(digest(Path(refs[1])),digest(snapshot/row['crop']))
        self.assertEqual(inspect(snapshot)['digest'],before)
        for selected,variant in [([sheet],prompt),([row['asset']],None),([r['asset'] for r in rows],prompt)]:
            with self.assertRaisesRegex(ValueError,'SINGLE_MATERIAL_REFERENCE_VARIANT'):
                exchange.prepare(snapshot,before,self.root/'blocked-crop',selected,variant,'full-and-crop')
        self.assertFalse((self.root/'blocked-crop').exists())
        Path(refs[1]).write_bytes(b'tamper')
        with self.assertRaisesRegex(ValueError,'ARTIFACT_CHANGED'):exchange.status(target)

    def test_crop_only_edit_variant_binds_only_the_original_crop(self):
        snapshot=self.job/'snapshot';before=inspect(snapshot)['digest']
        rows=read(snapshot/'requests.json')['requests']
        row=next(r for r in rows if r.get('kind')!='sheet')
        sheet=next(r['asset'] for r in rows if r.get('kind')=='sheet')
        prompt=self.root/'edit-prompt.txt';prompt.write_text('Remove letters and outside background only.',encoding='utf-8')
        target=self.root/'crop-only-job'
        cfg=exchange.prepare(snapshot,before,target,[row['asset']],prompt,'crop-only')
        exchange.authorize(target,cfg['digest'],'offline fixture')
        request=exchange.next_request(target)
        refs=request['arguments']['referenced_image_paths']
        self.assertEqual(len(refs),1)
        self.assertEqual(digest(Path(refs[0])),digest(snapshot/row['crop']))
        self.assertEqual(request['arguments']['prompt'],prompt.read_text(encoding='utf-8'))
        self.assertEqual(inspect(snapshot)['digest'],before)
        with self.assertRaisesRegex(ValueError,'SINGLE_MATERIAL_REFERENCE_VARIANT'):
            exchange.prepare(snapshot,before,self.root/'blocked-crop-only',[sheet],prompt,'crop-only')
        self.assertFalse((self.root/'blocked-crop-only').exists())

    def test_sheet_crops_edit_variant_binds_each_frozen_crop_in_cell_order(self):
        snapshot=self.job/'snapshot';before=inspect(snapshot)['digest']
        rows=read(snapshot/'requests.json')['requests']
        row=next(r for r in rows if r.get('kind')=='sheet')
        single=next(r['asset'] for r in rows if r.get('kind')!='sheet')
        prompt=self.root/'sheet-edit-prompt.txt';prompt.write_text('Edit image 1 and image 2 in cell order.',encoding='utf-8')
        target=self.root/'sheet-crops-job'
        cfg=exchange.prepare(snapshot,before,target,[row['asset']],prompt,'sheet-crops-only')
        self.assertEqual(cfg['referenceMode'],'sheet-crops-only')
        exchange.authorize(target,cfg['digest'],'offline fixture')
        request=exchange.next_request(target)
        refs=request['arguments']['referenced_image_paths']
        self.assertEqual(len(refs),len(row['materialIds']))
        for ref,mid in zip(refs,row['materialIds']):
            self.assertEqual(digest(Path(ref)),digest(snapshot/'materials'/mid/'reference-crop.png'))
        self.assertEqual(inspect(snapshot)['digest'],before)
        with self.assertRaisesRegex(ValueError,'SINGLE_SHEET_CROPS_VARIANT'):
            exchange.prepare(snapshot,before,self.root/'blocked-sheet-crops',[single],prompt,'sheet-crops-only')
        with self.assertRaisesRegex(ValueError,'SINGLE_SHEET_CROPS_VARIANT'):
            exchange.prepare(snapshot,before,self.root/'blocked-sheet-crops',[row['asset']],None,'sheet-crops-only')
        self.assertFalse((self.root/'blocked-sheet-crops').exists())
        Path(refs[0]).write_bytes(b'tamper')
        with self.assertRaisesRegex(ValueError,'ARTIFACT_CHANGED'):exchange.status(target)

    def test_single_request_variants_in_grouped_snapshot_are_bound(self):
        snapshot=self.job/'snapshot';before=inspect(snapshot)['digest']
        rows=read(snapshot/'requests.json')['requests']
        single=next(r['asset'] for r in rows if r.get('kind')!='sheet')
        sheet=next(r['asset'] for r in rows if r.get('kind')=='sheet')
        prompt=self.root/'short.txt';prompt.write_text('Preserve only this material.',encoding='utf-8')
        target=self.root/'single-variant'
        cfg=exchange.prepare(snapshot,before,target,[single],prompt)
        self.assertEqual(cfg['maximumCalls'],1)
        self.assertEqual(cfg['referenceMode'],'full-only')
        with self.assertRaisesRegex(ValueError,'NOT_READY'):exchange.next_request(target)
        exchange.authorize(target,cfg['digest'],'offline variant authorization')
        q=exchange.next_request(target)
        self.assertEqual(q['arguments']['prompt'],'Preserve only this material.')
        self.assertEqual(len(q['arguments']['referenced_image_paths']),1)
        self.assertEqual(inspect(snapshot)['digest'],before)
        sheet_job=self.root/'sheet-variant'
        sheet_cfg=exchange.prepare(snapshot,before,sheet_job,[sheet],prompt)
        self.assertEqual(sheet_cfg['maximumCalls'],1)
        exchange.authorize(sheet_job,sheet_cfg['digest'],'offline fixture')
        sheet_request=exchange.next_request(sheet_job)
        self.assertEqual(sheet_request['materialIds'],next(r['materialIds'] for r in rows if r['asset']==sheet))
        self.assertEqual(sheet_request['arguments']['prompt'],'Preserve only this material.')
        self.assertEqual(len(sheet_request['arguments']['referenced_image_paths']),1)
        (sheet_job/'prompt-variant.txt').write_text('tampered',encoding='utf-8')
        with self.assertRaisesRegex(ValueError,'PROMPT_VARIANT_CHANGED'):exchange.status(sheet_job)
        (target/'prompt-variant.txt').write_text('changed')
        with self.assertRaisesRegex(ValueError,'PROMPT_VARIANT_CHANGED'):exchange.status(target)

    def test_received_sheet_variant_reviews_only_selected_materials(self):
        self.media();snapshot=self.job/'snapshot'
        sheet=next(r['asset'] for r in read(snapshot/'requests.json')['requests'] if r.get('kind')=='sheet')
        variant=self.root/'variant.txt';variant.write_text('Keep original proportions.',encoding='utf-8')
        job=self.root/'variant-job';cfg=exchange.prepare(snapshot,inspect(snapshot)['digest'],job,[sheet],variant)
        with self.assertRaisesRegex(ValueError,'ONE_RECEIVED_SHEET_REQUIRED'):
            exchange.review_sheet(job,self.root/'early',self.review)
        exchange.authorize(job,cfg['digest'],'offline fixture')
        q=exchange.next_request(job)
        exchange.receive(job,q['submissionDigest'],self.job/'attempts'/sheet/'raw.png')
        result=exchange.review_sheet(job,self.root/'selected',self.review)
        self.assertEqual(result['status'],'selected_sheet_extracted_pending_material_validation')
        self.assertEqual(set(result['materials']),set(q['materialIds']))
        self.assertEqual(self.calls,1)
        self.assertEqual(read(self.root/'selected/variant-source.json')['jobDigest'],cfg['digest'])
        self.assertFalse((self.root/'selected/composition.json').exists())
        with self.assertRaises(FileExistsError):
            exchange.review_sheet(job,self.root/'selected',self.review)
        self.assertEqual(self.calls,1)

    def test_visual_issues_and_uncertain_transport_stop_extraction(self):
        from ai_ui_layers.extract_sheets import extract
        self.media();snapshot=self.job/'snapshot'
        sources={r['asset']:str(self.job/'attempts'/r['asset']/'raw.png') for r in read(snapshot/'requests.json')['requests']}
        def issues(folder):
            save(folder/'draft.json',dict(materialIds=read(folder/'request.json')['materialIds'],issues=['wrong observed state']))
            return dict(exitCode=0,turnCompleted=True,unexpectedEvents=[],responseSha256=digest(folder/'draft.json'))
        for name,model,error in [('issues',issues,'SHEET_VISUAL_ISSUES'),
                                 ('transport',lambda _:dict(exitCode=1),'TRANSPORT_FAILED')]:
            with self.subTest(name=name),self.assertRaisesRegex(ValueError,error):
                extract(snapshot,inspect(snapshot)['digest'],sources,self.root/name,model)
            self.assertEqual(read(self.root/name/'result.json')['status'],'blocked_no_retry')
            self.assertFalse(list((self.root/name).glob('sheet-*/asset-*.png')))

    def test_public_preview_is_non_authorizable_and_preserves_source(self):
        import subprocess,sys,json
        entry=Path(delivery.__file__).resolve().parents[2]/'ui_layer.py'
        snapshot=self.job/'snapshot';before=inspect(snapshot)['digest'];out=self.root/'preview'
        proc=subprocess.run([sys.executable,str(entry),'preview-groups','--snapshot',str(snapshot),
             '--snapshot-digest',before,'--output',str(out)],capture_output=True,text=True,encoding='utf-8')
        self.assertEqual(proc.returncode,0,proc.stdout+proc.stderr)
        result=json.loads(proc.stdout)
        self.assertEqual(result['plannedCalls'],4);self.assertEqual(result['materialCount'],5)
        self.assertEqual(result['status'],'preview_only_new_run_required')
        self.assertEqual(inspect(snapshot)['digest'],before)
        self.assertFalse((out/'job.json').exists());self.assertFalse((out/'authorization.json').exists())


class SheetCellTests(unittest.TestCase):
    def test_experimental_grouping_can_be_reconstructed_without_changing_default(self):
        sizes={'claim':[154,65],'coin':[220,70],'crystal':[205,71]}
        visual={'objects':[{'materialId':key,'kind':'button'} for key in sizes]}
        plan={'assets':[{'id':key,'role':'foreground','output_size':size}
                        for key,size in sizes.items()]}
        groups=build_groups(visual,plan,'compatible-size-and-kind-grid-v2')['groups']
        self.assertEqual([g['materialIds'] for g in groups],
                         [['claim'],['coin','crystal']])
        default=build_groups(visual,plan)['groups']
        self.assertEqual([g['materialIds'] for g in default],
                         [['claim','coin','crystal']])

    def test_single_request_ownership_gate_remains_strict(self):
        import copy
        import test_compile_visual
        from ai_ui_layers.freeze_visual import freeze
        test_compile_visual.VisualCompileTests.setUp(self)
        snapshot=self.root/'single';bound=freeze(self.run,snapshot,5)
        original=read(snapshot/'requests.json')
        for defect in ('duplicate','order','fake-sheet'):
            data=copy.deepcopy(original)
            if defect=='duplicate':data['requests'][1]=data['requests'][0]
            elif defect=='order':data['requests'].reverse()
            else:data['requests'][0]['kind']='sheet'
            def fixture_read(path):return data if Path(path).name=='requests.json' else read(path)
            with self.subTest(defect=defect),patch('ai_ui_layers.execution_preflight.read',side_effect=fixture_read):
                with self.assertRaisesRegex(ValueError,'REQUEST_PLAN_MISMATCH'):preflight(snapshot,bound['digest'])

    def test_missing_unused_opaque_and_faint_seam_pixels_rejected(self):
        row=dict(grid=[2,2],materialIds=['a','b','c'])
        valid=Image.new('RGBA',(200,200));d=ImageDraw.Draw(valid)
        for x,y in ((0,0),(100,0),(0,100)):d.rectangle((x+20,y+20,x+79,y+79),fill=(40,50,60,128))
        self.assertEqual(len(cells(valid,row)),3)
        for point,value,error in [((150,150),(1,2,3,1),'UNUSED_CELL'),((99,50),(1,2,3,1),'CONTOUR_TOUCHES')]:
            im=valid.copy();im.putpixel(point,value)
            with self.assertRaisesRegex(ValueError,error):cells(im,row)
        im=valid.copy();ImageDraw.Draw(im).rectangle((100,0,199,99),fill=(0,0,0,0))
        with self.assertRaisesRegex(ValueError,'MISSING_MATERIAL'):cells(im,row)
        with self.assertRaisesRegex(ValueError,'NATIVE_ALPHA'):cells(valid.convert('RGB'),row)


if __name__=='__main__':unittest.main()
