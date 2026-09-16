"""Official finalizer and consumer integration, using local procedural materials."""
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
import zipfile

from PIL import Image
from ai_ui_decomposition.acceptance_execution import AcceptanceExecution
from ai_ui_decomposition.common import ContractError, read_json, sha256, write_json
from ai_ui_decomposition.handoff_build import build_handoff
from ai_ui_decomposition.headless import auto_run
from test_headless import FakeProvider


class HandoffBuildTests(unittest.TestCase):
    def test_processed_materials_compile_through_official_consumer_without_receipt_authoring(self):
        component=Path(__file__).resolve().parents[2]/'ui-component-harness'
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);original=root/'original.PNG';Image.new('RGB',(64,48),'#17314a').save(original)
            provider=FakeProvider()
            auto_run(original,root/'job',provider,maximum_calls=4,timeout_seconds=60,authorized=True,output_format='png_zip')
            calls=(provider.image_calls,provider.vision_calls,provider.quality_calls)
            # A minimal real semantic bundle; no fake bundle digest or delivery receipt.
            script="""import fs from 'node:fs';import {createBundle} from './lib/bundle.js';
const style={backgroundColor:'#17314a',borderColor:'#17314a',borderWidth:0,cornerRadius:0,textColor:'#FFFFFF',fontFamily:'Arial',fontSize:18,fontWeight:'normal',opacity:1};
const document={schemaVersion:'0.2',id:'build-fixture',canvas:{width:64,height:48},root:{id:'root',type:'Container',layout:{x:0,y:0,width:64,height:48},props:{style},children:[]}};
fs.writeFileSync(process.argv[1],JSON.stringify(await createBundle(document,[],{kind:'programmatic-fixture',description:'Local compiler regression'})));"""
            subprocess.run(['node','--input-type=module','-e',script,str(root/'bundle.json')],cwd=component,check=True,capture_output=True)
            docs={
                'state':dict(kind='ui-reference-state',schemaVersion='1.0',components=[]),
                'scope':dict(kind='ui-acceptance-scope',schemaVersion='1.0',referenceState='reference/reference-state.json',components=[dict(componentId='root',mode='compare',reason='Local fixture')],derivedTestStates=[],human_visual_acceptance=False),
                'mapping':dict(coordinateSpace='raw-image-pixel-edges-to-runtime-canvas',sourceSize=[64,48],targetSize=[64,48],crop=[0,0,64,48],rotationDegrees=0,flipX=False,flipY=False,scale=[1,1],offset=[0,0]),
                'spacing':dict(version='1.1',panelFooters=[],scrollBottomSpaces=[],nonFooterButtons={}),
                'layout':dict(kind='ui_layout_requirements_v1',panels=[],selects=[],buttons=[],textBackgrounds=[]),
                'observations':dict(kind='ui_visual_observations_v1',texts=[],dialogs=[]),
            }
            for name,value in docs.items():write_json(root/(name+'.json'),value)
            ref=lambda name:dict(path=name,sha256=sha256(root/name))
            run=root/'job/workspace/runs/automatic'
            plan=dict(kind='ui_handoff_build_plan_v1',run=dict(path=run.relative_to(root).as_posix(),batchSha256=sha256(run/'batch.json'),materialsSha256=sha256(run/'materials/materials.json')),
                      componentBundle=ref('bundle.json'),appearance=dict(registration=dict(sourceCanvas=dict(width=64,height=48),targetCanvas=dict(width=64,height=48),transform=dict(scale=1,offset=dict(x=0,y=0))),bindings=[dict(componentId='root',componentType='Container',parts=[dict(role='background',layerId='scene')])]),
                      referenceOriginal=ref('original.PNG'),referenceState=ref('state.json'),acceptanceScope=ref('scope.json'),referenceMapping=ref('mapping.json'),layoutSpacing=ref('spacing.json'),layoutRequirements=ref('layout.json'),visualObservations=ref('observations.json'),stateEvidence=dict(kind='ui_state_evidence_v1',components={}))
            write_json(root/'plan.json',plan)
            result=build_handoff(root/'plan.json',component,root/'build',AcceptanceExecution(60))
            self.assertTrue(result.is_file())
            self.assertEqual(calls,(provider.image_calls,provider.vision_calls,provider.quality_calls))
            compiled=read_json(result);evidence=read_json(result.parent/'evidence.json')
            self.assertEqual(evidence['handoffSha256'],compiled['source']['sha256'])
            with zipfile.ZipFile(result.parent/'source.zip') as z:
                self.assertEqual(z.read('reference/original.PNG'),original.read_bytes())
                self.assertEqual(json.loads(z.read('handoff.json'))['kind'],'ai_ui_component_handoff_v2')
            self.assertEqual(read_json(root/'build/layout-check.json')['status'],'passed')
            self.assertEqual(read_json(root/'build/assembly/delivery.json')['human_visual_acceptance'],False)
            from ai_ui_decomposition.process import read_materials
            from ai_ui_decomposition.common import safe_relative
            source_row=next(r for r in read_materials(run)['assets'] if r['asset']=='scene')
            geometry=dict(kind='ui_visible_material_geometry_plan_v1',version='1.0',checks=[dict(
                kind='ui_visible_material_geometry_v1',version='1.0',materialId='scene',
                sourceSha256=sha256(safe_relative(run,source_row['path'])),alphaThreshold=128,
                minimumOccupancy=None,expectedAlphaBounds=dict(rect=[0,0,1,1],tolerance=[0]*4),
                imageWorldRect=None,reservedRects=[],textWorldRects=[])])
            write_json(root/'geometry.json',geometry);plan['visibleMaterialGeometry']=ref('geometry.json')
            write_json(root/'with-geometry.json',plan)
            with self.assertRaisesRegex(ContractError,'VISIBLE_MATERIAL_GEOMETRY_REJECTED'):
                build_handoff(root/'with-geometry.json',component,root/'geometry-failed',AcceptanceExecution(60))
            self.assertFalse((root/'geometry-failed/assembly').exists())
            geometry['checks'][0].update(expectedAlphaBounds=None,minimumOccupancy={'width':.5})
            write_json(root/'geometry-good.json',geometry);plan['visibleMaterialGeometry']=ref('geometry-good.json')
            write_json(root/'with-geometry-good.json',plan)
            build_handoff(root/'with-geometry-good.json',component,root/'geometry-passed',AcceptanceExecution(60))
            self.assertEqual(read_json(root/'geometry-passed/visible-material-geometry.json')['status'],'passed')
            # Mutated material identity and workspace escapes fail before finalization.
            plan['run']['materialsSha256']='0'*64;write_json(root/'bad.json',plan)
            with self.assertRaisesRegex(ContractError,'HANDOFF_BUILD_RUN_CHANGED'):
                build_handoff(root/'bad.json',component,root/'bad-build',AcceptanceExecution(60))
            self.assertFalse((root/'bad-build/assembly').exists())
            plan['run']['path']='../outside';write_json(root/'unsafe.json',plan)
            with self.assertRaisesRegex(ContractError,'UNSAFE_PATH'):
                build_handoff(root/'unsafe.json',component,root/'unsafe-build',AcceptanceExecution(60))
