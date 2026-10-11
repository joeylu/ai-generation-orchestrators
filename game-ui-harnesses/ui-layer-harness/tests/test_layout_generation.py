"""Offline declared-structure prompts and genuine edit lineage fixtures."""
import _bootstrap
from copy import deepcopy
from pathlib import Path
import json
import shutil
import unittest

from PIL import Image

from ai_ui_layers import experimental_executor as ex, host_layout_registration as layout
from ai_ui_layers import layout_generation as generation, material_cleanup as cleanup
from ai_ui_layers.evaluate import read, save, digest
from ai_ui_layers.freeze_visual import freeze
from test_material_cleanup import MaterialCleanupTests
from test_context_references import ContextReferencesTests
from test_host_material_review import HostEvidence


class LayoutGenerationTests(unittest.TestCase):
    bind=ContextReferencesTests.bind

    def test_optional_layout_metadata_does_not_become_required_in_legacy_transport(self):
        from ai_ui_layers.planning_normalization import provider_schema
        from ai_ui_layers.codex_call import transport_schema
        from ai_ui_layers.compile_visual import HARNESS
        schema=read(HARNESS/'planning-harness/schemas/visual-plan.schema.json');before=deepcopy(schema)
        self.assertNotIn('layoutRegistration',schema['required'])
        result=transport_schema(provider_schema(schema))
        self.assertNotIn('layoutRegistration',result['properties'])
        self.assertEqual(schema,before)
        schema['required'].append('layoutRegistration')
        self.assertIn('layoutRegistration',transport_schema(provider_schema(schema))['required'])

    def setUp(self):
        ContextReferencesTests.setUp(self)
        self.snapshot=self.root/'frozen'
        self.frozen=freeze(self.run,self.snapshot,16,generation_mode='sheets',
                           generation_reference='context-crops',context_prompt_version='v8')
        self.mid='asset-panel'
        box=next(p['sourceRegion'] for p in read(self.snapshot/'placements.json')['materials'] if p['id']==self.mid)
        self.targets=[box[1]+(box[3]-box[1])*i//4 for i in (1,2,3)]
        contract=self.root/'contract.json'
        save(contract,dict(kind=layout.KIND,referenceSha256=digest(self.snapshot/'reference.png'),
            materials=[dict(materialId=self.mid,mode='frame',measurementAlphaThreshold=128,
                            horizontalDividerTargets=self.targets)],constraints=[],knownDifferences=[]))
        layout.freeze(self.root,dict(layoutContract=str(contract),layoutContractSha256=digest(contract),
                                      layoutRegistrationPolicy=layout.POLICY))
        self.contract=self.root/'frozen-layout-contract.json'

    def prepare(self,name='job',bound=True):
        job=self.root/name
        config=ex.prepare(self.snapshot,self.frozen['digest'],job,
            layout_contract=self.contract if bound else None)
        return job,config

    def test_new_job_binds_structure_only_to_declared_material_and_keeps_legacy_bytes(self):
        old,old_config=self.prepare('legacy',False)
        job,config=self.prepare()
        self.assertEqual(config['generationMode'],'sheets')
        self.assertEqual(config['layoutGeneration']['materialIds'],[self.mid])
        self.assertEqual(config['layoutGeneration']['promptPolicy'],generation.REFERENCE_STRUCTURE)
        self.assertEqual(config['maximumCalls'],old_config['maximumCalls'])
        _,rows=ex.load_job(job);_,old_rows=ex.load_job(old)
        for key,row in rows.items():
            actual=ex.frozen_request_arguments(job,config,row)
            previous=ex.frozen_request_arguments(old,old_config,old_rows[key])
            self.assertEqual(actual['referenced_image_paths'],
                [str(job/'snapshot'/Path(p).relative_to(old/'snapshot')) for p in previous['referenced_image_paths']])
            if self.mid in row.get('materialIds',[key]):
                self.assertIn('exactly 3 independent thin horizontal divider lines',actual['prompt'])
                self.assertIn(str(self.targets).replace(' ',''),actual['prompt'])
                self.assertTrue(actual['prompt'].startswith(previous['prompt']))
                self.assertIn('Band boundaries and the outer border do not count',actual['prompt'])
                self.assertIn('REFERENCE STRUCTURE RECONSTRUCTION',actual['prompt'])
                self.assertIn('narrow strip between the outer border and the first band',actual['prompt'])
            else:self.assertEqual(actual['prompt'],previous['prompt'])
        self.assertFalse((job/'authorization.json').exists())
        self.assertEqual(list((job/'attempts').iterdir()),[])

    def test_historical_bound_job_replays_without_new_reconstruction_policy(self):
        job,config=self.prepare()
        config.pop('digest');config['layoutGeneration'].pop('promptPolicy')
        (job/'job.json').unlink()
        config=ex.record(job/'job.json',config)
        _,rows=ex.load_job(job)
        arguments=ex.frozen_request_arguments(job,config,rows[self.mid])
        self.assertIn('exactly 3 independent thin horizontal divider lines',arguments['prompt'])
        self.assertNotIn('REFERENCE STRUCTURE RECONSTRUCTION',arguments['prompt'])

    def test_bands_without_dividers_bind_both_edges_and_original_surface_gaps(self):
        value=read(self.contract);value.pop('digest');row=value['materials'][0]
        row.pop('horizontalDividerTargets');top,bottom=row['targetBox'][1::2]
        bands=[[top+30,top+60],[bottom-80,bottom-30]]
        row['horizontalBandTargets']=bands
        self.contract.unlink();ex.record(self.contract,value)
        job,config=self.prepare();_,rows=ex.load_job(job)
        self.assertEqual(config['layoutGeneration']['materialIds'],[self.mid])
        prompt=ex.frozen_request_arguments(job,config,rows[self.mid])['prompt']
        self.assertIn(str(bands).replace(' ',''),prompt)
        self.assertIn('Both edges are required',prompt)
        self.assertIn('visible strip below separately assigned tabs',prompt)
        self.assertNotIn('exactly 0 independent',prompt)

    def test_unknown_prompt_policy_rejected_even_with_rehashed_config(self):
        job,config=self.prepare()
        config.pop('digest');config['layoutGeneration']['promptPolicy']='unknown'
        (job/'job.json').unlink()
        config=ex.record(job/'job.json',config)
        with self.assertRaisesRegex(ValueError,'PROMPT_POLICY'):
            ex.authorize(job,config['digest'],'offline fixture approval')
        self.assertFalse((job/'authorization.json').exists())

    def test_declared_owner_in_sheet_retains_grid_and_other_owners(self):
        value=read(self.contract);value.pop('digest')
        requests=read(self.snapshot/'requests.json')['requests']
        sheet=next(r for r in requests if len(r.get('materialIds',[]))>1)
        mid=sheet['materialIds'][0]
        box=next(p['sourceRegion'] for p in read(self.snapshot/'placements.json')['materials'] if p['id']==mid)
        value['materials'].append(dict(materialId=mid,mode='frame',measurementAlphaThreshold=128,
            targetBox=box,horizontalDividerTargets=[(box[1]+box[3])//2]))
        self.contract.unlink()
        ex.record(self.contract,value)
        job,config=self.prepare()
        _,rows=ex.load_job(job);actual=ex.frozen_request_arguments(job,config,rows[sheet['asset']])
        self.assertIn('REFERENCE STRUCTURE RECONSTRUCTION for material '+mid,actual['prompt'])
        for key in sheet['materialIds']:
            self.assertIn('owner '+key,actual['prompt'])
        self.assertIn('frozen cell layout and uniform scale unchanged',actual['prompt'])
        self.assertEqual(rows[sheet['asset']]['grid'],sheet['grid'])

    def test_changed_frozen_contract_blocks_before_authorization(self):
        job,config=self.prepare()
        with (job/generation.FILE).open('ab') as stream:stream.write(b' ')
        with self.assertRaisesRegex(ValueError,'BINDING_CHANGED'):
            ex.authorize(job,config['digest'],'offline fixture approval')
        self.assertFalse((job/'authorization.json').exists())

    def test_forged_geometry_cannot_be_bound_to_other_snapshot(self):
        value=read(self.contract);value.pop('digest')
        value['materials'][0]['targetBox'][0]+=1
        path=self.root/'changed.json';ex.record(path,value)
        with self.assertRaisesRegex(ValueError,'TARGET_CHANGED'):
            ex.prepare(self.snapshot,self.frozen['digest'],self.root/'bad',layout_contract=path)
        self.assertFalse((self.root/'bad').exists())

    def test_cleanup_edit_uses_same_structure_binding_and_two_real_images(self):
        source=self.root/'source'
        MaterialCleanupTests.make_source(self,self.snapshot,self.frozen['digest'],source,self.mid)
        job=self.root/'edit'
        config=cleanup.prepare_cleanup(self.snapshot,self.frozen['digest'],job,self.mid,source,
                                       layout_contract=self.contract)
        _,rows=ex.load_job(job)
        arguments=ex.frozen_request_arguments(job,config,rows[self.mid])
        self.assertEqual(config['maximumCalls'],1)
        self.assertEqual(config['materialCount'],1)
        self.assertNotIn('promptPolicy',config['layoutGeneration'])
        self.assertEqual(config['generationMode'],'sheets')
        self.assertEqual(len(arguments['referenced_image_paths']),2)
        self.assertIn('restore missing declared lines',arguments['prompt'])
        self.assertIn('exactly 3 independent thin horizontal divider lines',arguments['prompt'])
        self.assertFalse((job/'authorization.json').exists())

    def test_received_panel_replacement_preserves_other_layers_and_requires_real_lineage(self):
        from ai_ui_layers import host_material_review as host, layout_registration_revision as revision
        from ai_ui_layers import viewport_geometry_revision as viewport
        from ai_ui_layers.layer_package import write_package
        source=self.root/'source'
        MaterialCleanupTests.make_source(self,self.snapshot,self.frozen['digest'],source,self.mid)
        job=self.root/'edit'
        config=cleanup.prepare_cleanup(self.snapshot,self.frozen['digest'],job,self.mid,source,
                                       layout_contract=self.contract,input_policy=cleanup.REFERENCE_INPUT_POLICY)
        ex.authorize(job,config['digest'],'offline fixture edit approval')
        request=ex.next_request(job)
        ex.receive(job,request['submissionDigest'],source/'attempts'/self.mid/'raw.png')
        review=self.root/'material-review'
        host.prepare(job,self.mid,review,material_authors=['fixture-generator'],review_registry=self.root/'registry')
        host.receive(**HostEvidence.response(self,review))
        reference=self.snapshot/'reference.png';raw=source/'attempts'/self.mid/'raw.png'
        background=self.root/'background.png'
        with Image.open(reference) as image:image.convert('RGB').convert('RGBA').save(background)
        sibling=self.root/'sibling.png';Image.new('RGBA',(10,10),(20,40,80,255)).save(sibling)
        with Image.open(raw) as image:size=image.size
        layers=[dict(id='background',name='Background',role='background',path='layers/layer-001.png',
                     x=0,y=0,width=1000,height=1000,visible=True),
                dict(id=self.mid,name='Panel',role='foreground',path='layers/layer-002.png',
                     x=0,y=0,width=size[0],height=size[1],visible=True),
                dict(id='sibling',name='Other control',role='foreground',path='layers/layer-003.png',
                     x=20,y=30,width=10,height=10,visible=True)]
        composition=dict(kind='ui_layer_composition_v1',canvas=dict(width=1000,height=1000),
            coordinates='top-left-pixels',order='array-back-to-front',textPolicy='remove-business-text',
            backgroundMode='scene-only',reference='reference.png',preview='preview.png',layers=layers)
        viewer=self.root/'viewer';viewer.mkdir()
        for name in ('viewer.html','viewer.js'):(viewer/name).write_text('fixture',encoding='utf-8')
        old=self.root/'old'
        write_package(reference,composition,
            {key:dict(path=str(path),sha256=digest(path)) for key,path in
             [('background',background),(self.mid,raw),('sibling',sibling)]},old,viewer,
            ['Placement diagnosis: '+json.dumps(dict(materialId=self.mid,sourceSha256=digest(raw)))])
        shutil.copyfile(reference,old/'original-reference.png')
        shutil.copyfile(old/'package/preview.png',old/'viewport-preview.png')
        save(old/'viewport.json',dict(kind='ui_original_viewport_v1',policy=viewport.POLICY,
            originalSize=[1000,1000],worldSize=[1000,1000],worldShift=[0,0],worldViewportBox=[0,0,1000,1000],
            originalReferenceSha256=digest(reference)))
        viewport._wrapper(old);archive=old/'viewport-ui-layers.zip'
        row=deepcopy(read(self.contract)['materials'][0]);row.pop('horizontalDividerTargets')
        row['receivedReplacement']=dict(jobDirectory=str(job),jobDigest=config['digest'],reviewDirectory=str(review),
            reviewRequestSha256=digest(review/'request.json'),reviewResultSha256=digest(review/'result.json'))
        spec=dict(kind=revision.KIND,policy=revision.POLICY,sourceArchive=str(archive),sourceArchiveSha256=digest(archive),
            originalReferenceSha256=digest(reference),materials=[row],constraints=[],knownDifferences=[])
        plan=self.root/'selection.json';save(plan,spec)
        result=revision.revise(plan,self.root/'replaced',viewer)
        records={r['materialId']:r for r in result['records']}
        self.assertIn('receivedReplacement',records[self.mid])
        for key in ('background','sibling'):
            self.assertTrue(records[key]['byteIdentity'])
            old_layer=next(l for l in layers if l['id']==key)
            self.assertEqual(records[key]['layerCanvasRegion'],[old_layer['x'],old_layer['y'],
                old_layer['x']+old_layer['width'],old_layer['y']+old_layer['height']])
        viewport.validate_viewport_archive(self.root/'replaced/delivery/viewport-ui-layers.zip')
        self.assertFalse(result['humanVisualAcceptance'])
        spec['materials'][0]['receivedReplacement']['reviewResultSha256']='0'*64
        plan2=self.root/'changed-selection.json';save(plan2,spec)
        with self.assertRaisesRegex(ValueError,'REPLACEMENT_REVIEW_CHANGED'):
            revision.revise(plan2,self.root/'invalid',viewer)


if __name__=='__main__':unittest.main()
