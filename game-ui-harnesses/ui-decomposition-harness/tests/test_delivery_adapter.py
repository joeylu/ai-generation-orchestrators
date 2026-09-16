import copy
import json
from pathlib import Path
import tempfile
import unittest
from PIL import Image,ImageDraw
from ai_ui_decomposition import batch, workflow
from ai_ui_decomposition.common import read_json,write_json,sha256,digest
from ai_ui_decomposition.delivery_adapter import compile_delivery,prepare_handoff
from ai_ui_decomposition.adapter import export_request,seal_result,import_result
from ai_ui_decomposition.handoff_build import build_handoff
from ai_ui_decomposition.acceptance_execution import AcceptanceExecution
from workflow_fixture import draft


class DeliveryAdapterTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.base=Path(self.tmp.name);self.ref=self.base/'original.png'
        Image.new('RGB',(200,160),'#102030').save(self.ref)
        self.consumer=Path(__file__).resolve().parents[2]/'ui-component-harness'
        self.response=dict(draft=draft(),observations=dict(version='delivery-observations-1',referenceSha256=sha256(self.ref),geometryCorrections=[],panelFooters=[dict(componentId='panel',innerBottom=140,minimumGap=8,evidence='Synthetic fixture explicit inner safe edge')],materials=[dict(componentId='panel',description='Empty blue panel'),dict(componentId='action',description='Empty gold button')]))
    def tearDown(self):self.tmp.cleanup()
    def compile(self):return compile_delivery(self.ref,self.response,self.base/'compiled',self.consumer,4)
    def test_title_requires_independent_text_geometry(self):
        self.response['draft']['nodes'].append(dict(id='title',type='Text',parentId='panel',rect=[30,30,100,30],text='Title',fontSize=16,color='#FFFFFF',role='title'))
        with self.assertRaisesRegex(ValueError,'ADAPTER_TEXT_GEOMETRY_REQUIRED'):self.compile()
    def test_button_text_does_not_exclude_entire_skin(self):
        from ai_ui_decomposition.delivery_adapter import button_text_state
        state=button_text_state('返回首页',36,312,122)
        line=state['labelLines']['lines'][0]
        self.assertEqual(line['align'],'center')
        self.assertEqual(line['layout']['height'],45)
        self.assertEqual(line['layout']['y'],38.5)
        self.assertLess(line['layout']['height'],122)
    def test_real_preflight_and_workflow_pause(self):
        job=self.base/'job';workflow.create_job(self.ref,job,factory='ai_ui_decomposition.repository_workflow:create',options=dict(componentRoot=str(self.consumer),response=self.response),maximum_calls=4,stage_timeout=30)
        result=workflow.advance(job,allow_vision=True)
        self.assertEqual(result['status'],'awaiting_authorization');self.assertFalse((job/'nodes/generate').exists())
        self.assertEqual(workflow.inspect_job(job),result)
    def test_missing_material_or_reference_rejected(self):
        for key in ('material','reference'):
            r=copy.deepcopy(self.response)
            if key=='material':r['observations']['materials']=[]
            else:r['observations']['referenceSha256']='0'*64
            with self.assertRaises(ValueError):compile_delivery(self.ref,r,self.base/key,self.consumer,4)
    def test_geometry_rejected(self):
        self.response['observations']['geometryCorrections']=[dict(componentId='action',rect=[999,0,10,10],reason='invalid fixture')]
        with self.assertRaises(ValueError):self.compile()
    def test_real_materials_to_official_v2(self):
        self.compile();compiled=self.base/'compiled'
        frozen=batch.freeze(compiled/'plan.json',self.base/'generation','one',capability_request=compiled/'capabilities.json',component_document=compiled/'semantic-document.json',layout_spacing=compiled/'layout-spacing.json')
        run=self.base/'generation/runs/one';plan=read_json(compiled/'plan.json')
        for asset in plan['assets']:
            key=asset['id'];bundle=self.base/'requests'/key;export_request(run,key,bundle)
            if key.startswith('board-'):
                board=read_json(compiled/('strategy-'+key[6:]+'.json'))['boards'][0]
                picture=Image.new('RGB',board['canvas'],'#F808F8');draw=ImageDraw.Draw(picture)
                for slot in board['slots']:
                    x,y,xx,yy=slot['search_window'];w,h=slot['target_size'];cx=(x+xx)//2;cy=(y+yy)//2
                    draw.rectangle((cx-w//2+3,cy-h//2+3,cx+w//2-3,cy+h//2-3),fill='#DDCC88')
            else:
                picture=Image.new('RGB',asset['output_size'],'#102030' if key=='background' else '#F808F8')
                if key!='background':w,h=picture.size;ImageDraw.Draw(picture).rectangle((2,2,w-3,h-3),fill='#203040')
            raw=self.base/(key+'.png');picture.save(raw);seal_result(bundle,raw);import_result(run,bundle)
        build=prepare_handoff(compiled,run,self.base/'prepared',self.consumer)
        run_plan=build_handoff(build,self.consumer,self.base/'handoff',AcceptanceExecution(60))
        self.assertTrue(run_plan.is_file())
        consumed=read_json(self.base/'handoff/consumed.json',max_bytes=64*1024*1024)
        self.assertIn('componentHandoff',consumed)
        import zipfile
        source=self.base/'handoff/acceptance-inputs/source.zip'
        with zipfile.ZipFile(source) as z:self.assertEqual(z.read('reference/original.png'),self.ref.read_bytes())
        # Real state matrix compilation is covered by existing acceptance tests;
        # this adapter test verifies the input evidence has all Button states.
        proof=read_json(compiled/'state-evidence.json')['components']['action']
        self.assertEqual(set(proof['states']),{'default','hover','pressed'})
        self.assertEqual(proof['relations']['background']['mode'],'shared')
        from ai_ui_decomposition.stateful import accept
        accepted=accept(source,self.base/'handoff/acceptance-inputs/evidence.json',self.consumer,self.base/'state-check',browser=False)
        self.assertNotEqual(accepted['status'],'failed')
        # Consolidated delivery may reuse authenticated results from named runs.
        from ai_ui_decomposition.sourced_handoff import prepare_from_sources
        from ai_ui_decomposition.cached import verified_result
        catalog=read_json(compiled/'material-catalog.json')
        sources={}
        for key in {r['generationAsset'] for r in catalog['parts']}:
            frozen,_,receipt,_=verified_result(run,key)
            sources[key]=dict(runDirectory=str(run),assetId=key,batchDigest=frozen['digest'],expectedRawSha256=receipt['raw_sha256'],basis='Offline generated fixture reuse')
        joined=prepare_from_sources(compiled,sources,self.base/'joined',self.consumer)
        joined_plan=build_handoff(joined,self.consumer,self.base/'joined-handoff',AcceptanceExecution(60))
        self.assertTrue(joined_plan.is_file())
        revised=copy.deepcopy(sources)
        board_key=next(k for k in revised if k.startswith('board-'))
        original=read_json(compiled/('strategy-'+board_key[6:]+'.json'))
        revised[board_key]['extractionRevision']=dict(version='1.0',originalStrategyDigest=original['digest'],
            policy=dict(version='1.0',mode='foreground-gap-row',target_padding=2,max_canvas_aspect_error=.15),reason='Offline explicit extraction revision')
        revised_build=prepare_from_sources(compiled,revised,self.base/'revision-join',self.consumer)
        self.assertTrue(build_handoff(revised_build,self.consumer,self.base/'revision-handoff',AcceptanceExecution(60)).is_file())
        lineage=read_json(self.base/'revision-join/material-lineage.json')
        self.assertIn('extractionRevision',next(r for r in lineage['sources'] if r['target']==board_key))
        for field,value,code in [('version','9.0','SOURCED_REVISION_VERSION'),('originalStrategyDigest','0'*64,'SOURCED_REVISION_STRATEGY_CHANGED')]:
            invalid=copy.deepcopy(revised);invalid[board_key]['extractionRevision'][field]=value
            with self.assertRaisesRegex(ValueError,code):prepare_from_sources(compiled,invalid,self.base/('invalid-'+field),self.consumer)
            self.assertFalse((self.base/('invalid-'+field)).exists())
        bad=copy.deepcopy(sources);bad[next(iter(bad))]['expectedRawSha256']='0'*64
        with self.assertRaisesRegex(ValueError,'SOURCED_RAW_CHANGED'):prepare_from_sources(compiled,bad,self.base/'bad-join',self.consumer)
        self.assertFalse((self.base/'bad-join').exists())
        from ai_ui_decomposition.consolidated_delivery import verify
        bound={k:{**v,'runDirectory':run.relative_to(self.base).as_posix()} for k,v in sources.items()}
        envelope=dict(kind='ui_consolidated_delivery_plan_v1',version='1.0',compiledDirectory='compiled',sources=bound,
            generation={'target':'none'},inputs=[dict(path=p.relative_to(self.base).as_posix(),sha256=sha256(p)) for p in compiled.iterdir() if p.is_file()])
        envelope['digest']=digest(envelope);write_json(self.base/'envelope.json',envelope)
        verify(self.base/'envelope.json',self.base)
        (compiled/'appearance-plan.json').write_text('{}')
        with self.assertRaisesRegex(ValueError,'CONSOLIDATED_INPUT_CHANGED'):verify(self.base/'envelope.json',self.base)


if __name__=='__main__':unittest.main()
