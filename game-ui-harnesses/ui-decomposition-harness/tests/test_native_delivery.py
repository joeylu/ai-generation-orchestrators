"""Native contracts compiled through real offline generation receipts and official import.

All artwork here is an existing procedural local fixture, not user-art acceptance.
"""
import copy
import io
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
import zipfile
from PIL import Image
from ai_ui_decomposition.common import read_json,write_json,sha256
from ai_ui_decomposition.delivery_adapter import compile_delivery,prepare_handoff
from ai_ui_decomposition import batch
from ai_ui_decomposition.adapter import export_request,seal_result,import_result
from ai_ui_decomposition.handoff_build import build_handoff
from ai_ui_decomposition.acceptance_execution import AcceptanceExecution
from ai_ui_decomposition.reference_delivery import FIELDS
from ai_ui_decomposition.stateful import accept


def walk(n):
    yield n
    for child in n.get('children',[]):yield from walk(child)


def native_fixture(directory):
    with zipfile.ZipFile(directory/'ui.component-handoff.draft.zip') as outer:
        document=json.loads(outer.read('component.ui-bundle.json'))['document']
        binding=json.loads(outer.read('appearance-binding.json'))
        with zipfile.ZipFile(io.BytesIO(outer.read('decomposition/ui.draft.zip'))) as z:
            scene=json.loads(z.read('scene.json'));images={n['id']:(n,z.read(n['png'])) for g in scene['tree'] for n in g.get('children',[])}
    kind=document['root']['children'][0]['type'];size=[document['canvas']['width'],document['canvas']['height']]
    document['root']['children'].insert(0,dict(id='background',type='Image',layout=dict(x=0,y=0,width=size[0],height=size[1]),props=dict(source='layers/background.png',fit='stretch',drawBackground=False,style=copy.deepcopy(document['root']['props']['style']))))
    materials=[];raws={};bg=next((n,b) for n,b in images.values() if n['role']=='background')
    materials.append(dict(layerId='background',componentId='background',rect=[0,0,*size],description='Offline fixture background',groupId=None));raws['background']=bg[1]
    for b in binding['bindings']:
        for part in b['parts']:
            key=part['layerId']
            if key in raws:continue
            n,data=images[key];materials.append(dict(layerId=key,componentId=b['componentId'],rect=[n['left'],n['top'],*n['size']],description='Offline fixture '+key,groupId=kind.lower()));raws[key]=data
    bindings=[dict(componentId='background',componentType='Image',parts=[dict(role='image',layerId='background')]),*binding['bindings']]
    nodes=list(walk(document['root']))
    texts=[]
    for n in nodes:
        if 'style' in n['props']:n['props']['style']['fontFamily']='Arial'
        p=n['props'];t=n['type'];labels=[]
        if t=='Input':labels=[p['value'] or p['placeholder']]
        if t=='CheckBox':labels=[p['label']]
        if t=='Select':labels=[x['label'] for x in p['options'] if x['id']==p['selectedId']]
        if t=='Tabs':labels=[x['label'] for x in p['tabs']]
        if t=='List':labels=[x['label'] for x in p['items']]
        for text in labels:
            if text:texts.append(dict(componentId=n['id'],text=text,minFontSize=p['style']['fontSize'],region=copy.deepcopy(n['layout'])))
    reference=dict(kind='ui-reference-state',schemaVersion='1.0',components=[dict(componentId=n['id'],componentType=n['type'],fields={f:dict(status='unknown',reason='Procedural fixture has no observed reference state') for f in FIELDS[n['type']]}) for n in nodes if n['type'] in FIELDS])
    scope=dict(kind='ui-acceptance-scope',schemaVersion='1.0',referenceState='reference/reference-state.json',components=[dict(componentId=n['id'],mode='compare',reason='Explicit fixture comparison scope') for n in nodes],derivedTestStates=[],human_visual_acceptance=False)
    evidence=read_json(directory/'evidence.json')
    request=dict(kind='ui_native_delivery_input_v1',version='1.0',referenceSha256=sha256(directory/'reference.png'),document=document,materials=materials,
        boardPolicies={kind.lower():dict(version='1.0',mode='relative-cell',target_padding=2,max_canvas_aspect_error=.15)},
        appearance=dict(registration=binding['registration'],bindings=bindings),
        capabilities=[dict(id=n['id'],type=n['type'],profiles=['base']) for n in nodes],referenceState=reference,acceptanceScope=scope,
        referenceMapping=dict(coordinateSpace='raw-image-pixel-edges-to-runtime-canvas',sourceSize=size,targetSize=size,crop=[0,0,*size],rotationDegrees=0,flipX=False,flipY=False,scale=[1,1],offset=[0,0]),
        layoutSpacing=dict(version='1.1',panelFooters=[],scrollBottomSpaces=[],nonFooterButtons={}),
        layoutRequirements=dict(kind='ui_layout_requirements_v1',panels=[],selects=[dict(componentId=n['id'],surface='opaque',reason='Opaque local fixture popup') for n in nodes if n['type']=='Select'],buttons=[],textBackgrounds=[]),
        visualObservations=dict(kind='ui_visual_observations_v1',texts=texts,dialogs=[],requiredTextGeometryIds=[]),stateEvidence=dict(kind='ui_state_evidence_v1',components=evidence['components']))
    return request,raws


class NativeDeliveryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp=tempfile.TemporaryDirectory();cls.root=Path(cls.tmp.name)
        cls.consumer=Path(__file__).resolve().parents[2]/'ui-component-harness'
        subprocess.run(['node',str(Path(__file__).with_name('stateful-fixtures.mjs')),str(cls.consumer),str(cls.root/'fixtures')],check=True,capture_output=True)
    @classmethod
    def tearDownClass(cls):cls.tmp.cleanup()

    def test_five_native_types_through_official_import(self):
        for kind in ['Tabs','Input','Select','List','CheckBox']:
            with self.subTest(kind=kind):
                fixture=self.root/'fixtures'/kind;request,raws=native_fixture(fixture)
                out=self.root/kind;out.mkdir();compiled=out/'compiled'
                compile_delivery(fixture/'reference.png',request,compiled,self.consumer,8)
                batch.freeze(compiled/'plan.json',out/'generation','one',capability_request=compiled/'capabilities.json',component_document=compiled/'semantic-document.json',layout_spacing=compiled/'layout-spacing.json')
                run=out/'generation/runs/one'
                for asset in read_json(compiled/'plan.json')['assets']:
                    key=asset['id'];bundle=out/('request-'+key);export_request(run,key,bundle)
                    if key.startswith('board-'):
                        board=read_json(compiled/('strategy-'+key[6:]+'.json'))['boards'][0]
                        image=Image.new('RGB',board['canvas'],'#F808F8')
                        for slot in board['slots']:
                            part=Image.open(io.BytesIO(raws[slot['asset_id']])).convert('RGBA');l,t,r,b=slot['search_window']
                            image.paste(part,((l+r-part.width)//2,(t+b-part.height)//2),part)
                    else:image=Image.open(io.BytesIO(raws[key])).convert('RGB')
                    path=out/(key+'.png');image.save(path);seal_result(bundle,path);import_result(run,bundle)
                build=prepare_handoff(compiled,run,out/'prepared',self.consumer)
                try:build_handoff(build,self.consumer,out/'handoff',AcceptanceExecution(90))
                except ValueError:
                    if (out/'handoff/layout-check.json').exists():self.fail(str(read_json(out/'handoff/layout-check.json')['issues']))
                    raise
                source=out/'handoff/acceptance-inputs/source.zip'
                proof=out/'handoff/acceptance-inputs/evidence.json'
                result=accept(source,proof,self.consumer,out/'state',browser=os.environ.get('NATIVE_DELIVERY_BROWSER')=='1')
                self.assertIn(result['status'],('deterministic_passed','technical_passed'))
                with zipfile.ZipFile(source) as z:self.assertEqual(z.read('reference/original.png'),(fixture/'reference.png').read_bytes())
                imported=read_json(out/'handoff/consumed.json',max_bytes=64000000)
                self.assertTrue(any(n['type']==kind and 'appearance' in n['props'] for n in walk(imported['document']['root'])))

    def test_invalid_native_inputs_fail(self):
        fixture=self.root/'fixtures/CheckBox';request,_=native_fixture(fixture)
        for name,mutate in [('reference',lambda r:r.update(referenceSha256='0'*64)),('layer',lambda r:r['appearance']['bindings'][1]['parts'][0].update(layerId='missing')),('capability',lambda r:r['capabilities'].pop()),('unknown_behavior',lambda r:r['document']['root']['children'][1]['props'].update(onClick={'increment':'count'})),('unknown_option',lambda r:r['referenceState']['components'][0]['fields'].update(checked=dict(status='observed',value='bad',evidence='Fixture')) )]:
            with self.subTest(name=name):
                bad=copy.deepcopy(request);mutate(bad)
                with self.assertRaises(ValueError):compile_delivery(fixture/'reference.png',bad,self.root/('invalid-'+name),self.consumer,8)

    def test_owned_image_row_source_registration_and_official_import(self):
        fixture=self.root/'fixtures/List';request,raws=native_fixture(fixture)
        node=request['document']['root']['children'][1];p=node['props'];r=node['layout']
        p['itemContents']=dict(version='1.0',coordinateSpace='item-local',labelMode='children',items=[])
        request['visualObservations']['texts']=[]
        next(c for c in request['capabilities'] if c['id']==node['id'])['profiles'].append('item-contents-v1')
        for i,item in enumerate(p['items']):
            cid=item['id']+'-icon';style=copy.deepcopy(p['style'])
            node['children'].append(dict(id=cid,type='Image',layout=dict(x=8,y=8,width=24,height=24),props=dict(source='layers/'+cid+'.png',fit='contain',drawBackground=False,style=style)))
            p['itemContents']['items'].append(dict(itemId=item['id'],childIds=[cid]))
            request['capabilities'].append(dict(id=cid,type='Image',profiles=['base']))
            request['appearance']['bindings'].append(dict(componentId=cid,componentType='Image',parts=[dict(role='image',layerId=cid)]))
            request['materials'].append(dict(layerId=cid,componentId=cid,rect=[r['x']+8,r['y']+i*50+8,24,24],description='Procedural owned icon',groupId=None))
            request['acceptanceScope']['components'].append(dict(componentId=cid,mode='compare',reason='Procedural owned image'))
            image=Image.new('RGBA',(24,24));image.paste(('red','blue')[i],(2,2,22,22));buffer=io.BytesIO();image.save(buffer,format='PNG');raws[cid]=buffer.getvalue()
        out=self.root/'owned-images';out.mkdir();compiled=out/'compiled'
        bad=copy.deepcopy(request);bad['materials'][-1]['rect'][1]-=50
        with self.assertRaisesRegex(ValueError,'NATIVE_IMAGE_SOURCE_REGISTRATION'):
            compile_delivery(fixture/'reference.png',bad,out/'bad',self.consumer,8)
        compile_delivery(fixture/'reference.png',request,compiled,self.consumer,8)
        batch.freeze(compiled/'plan.json',out/'generation','one',capability_request=compiled/'capabilities.json',component_document=compiled/'semantic-document.json',layout_spacing=compiled/'layout-spacing.json')
        run=out/'generation/runs/one'
        for asset in read_json(compiled/'plan.json')['assets']:
            key=asset['id'];bundle=out/('request-'+key);export_request(run,key,bundle)
            if key.startswith('board-'):
                board=read_json(compiled/('strategy-'+key[6:]+'.json'))['boards'][0];image=Image.new('RGB',board['canvas'],'#F808F8')
                for slot in board['slots']:
                    part=Image.open(io.BytesIO(raws[slot['asset_id']])).convert('RGBA');l,t,r,b=slot['search_window'];image.paste(part,((l+r-part.width)//2,(t+b-part.height)//2),part)
            elif key=='background':image=Image.open(io.BytesIO(raws[key])).convert('RGB')
            else:
                part=Image.open(io.BytesIO(raws[key])).convert('RGBA');image=Image.new('RGB',part.size,'#F808F8');image.paste(part,(0,0),part)
            path=out/(key+'.png');image.save(path);seal_result(bundle,path);import_result(run,bundle)
        build=prepare_handoff(compiled,run,out/'prepared',self.consumer)
        build_handoff(build,self.consumer,out/'handoff',AcceptanceExecution(90))
        result=accept(out/'handoff/acceptance-inputs/source.zip',out/'handoff/acceptance-inputs/evidence.json',self.consumer,out/'state',browser=os.environ.get('NATIVE_DELIVERY_BROWSER')=='1')
        self.assertIn(result['status'],('deterministic_passed','technical_passed'))
        applied=read_json(out/'state/consumed.json',max_bytes=64000000)['document']
        owned=next(n for n in walk(applied['root']) if n['id']==node['id'])
        self.assertEqual(owned['props']['itemContents'],p['itemContents'])
        self.assertEqual([c['layout']['y'] for c in owned['children']],[8,8])

    def test_native_input_reaches_dag_authorization_without_media(self):
        from ai_ui_decomposition import workflow
        fixture=self.root/'fixtures/CheckBox';request,_=native_fixture(fixture)
        job=self.root/'native-dag'
        workflow.create_job(fixture/'reference.png',job,factory='ai_ui_decomposition.repository_workflow:create',options=dict(componentRoot=str(self.consumer),response=request,generationMode='file'),maximum_calls=8,stage_timeout=30)
        result=workflow.advance(job,allow_vision=True)
        self.assertEqual(result['status'],'awaiting_authorization')
        self.assertFalse((job/'nodes/generate').exists())

    def test_required_observation_state_and_appearance_cannot_be_omitted(self):
        fixture=self.root/'fixtures/CheckBox';request,_=native_fixture(fixture)
        cid=request['document']['root']['children'][1]['id']
        for name,mutate in [
            ('text_geometry_list',lambda r:r['visualObservations'].pop('requiredTextGeometryIds')),
            ('text_geometry_target',lambda r:r['visualObservations'].update(requiredTextGeometryIds=[cid])),
            ('state',lambda r:r['stateEvidence']['components'].clear()),
            ('state_side',lambda r:r['stateEvidence']['components'][cid]['states'].pop('on')),
            ('appearance',lambda r:(r['appearance']['bindings'].pop(),r.update(materials=r['materials'][:1],boardPolicies={}))),
        ]:
            with self.subTest(name=name):
                bad=copy.deepcopy(request);mutate(bad)
                with self.assertRaises(ValueError):compile_delivery(fixture/'reference.png',bad,self.root/('missing-'+name),self.consumer,8)

    def test_gap_board_policy_reaches_frozen_prompt(self):
        fixture=self.root/'fixtures/CheckBox';request,_=native_fixture(fixture)
        request['boardPolicies']['checkbox']['mode']='foreground-gap-row'
        out=self.root/'gap-policy';compile_delivery(fixture/'reference.png',request,out,self.consumer,8)
        board=read_json(out/'strategy-checkbox.json')['boards'][0]
        self.assertEqual(board['canvas'][0],board['canvas'][1])
        prompt=next(a['prompt'] for a in read_json(out/'plan.json')['assets'] if a['id']=='board-checkbox')
        self.assertIn('foreground-gap-row',prompt)
        self.assertIn(str(board['canvas']),prompt)
        for slot in board['slots']:self.assertIn(str(slot['search_window']),prompt)

    def test_content_gap_policy_reaches_native_compile_and_request(self):
        from test_content_gap_board import policy
        from ai_ui_decomposition.batch import _prompt
        fixture=self.root/'fixtures/CheckBox';request,_=native_fixture(fixture)
        request['boardPolicies']['checkbox']=policy()
        out=self.root/'content-gap';compile_delivery(fixture/'reference.png',request,out,self.consumer,8)
        board=read_json(out/'strategy-checkbox.json')['boards'][0]
        self.assertEqual(board['extraction_policy'],policy())
        asset=next(a for a in read_json(out/'plan.json')['assets'] if a['id']=='board-checkbox')
        prompt=_prompt(asset)
        self.assertIn('component-family-content-gap-v1.1',prompt)
        self.assertIn('not exact pixel placement',prompt)
        self.assertNotIn('Keep the explicitly declared raw canvas',prompt)
