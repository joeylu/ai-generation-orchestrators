import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {setupTerrainEdgeDelivery} from './helpers/terrain-edge-delivery.mjs';
import {coherentSurfaceObservations} from './helpers/coherent.mjs';
import {buildTerrainEdgeDelivery,verifyTerrainEdgeDelivery} from '../src/terrain-edge-pipeline.mjs';
import {compileMap} from '../src/compile.mjs';
import {loadSceneKit,contextFor,readMap} from '../src/kit.mjs';
import {inspectPng} from '../src/png.mjs';
import {canonicalJson} from '../src/document.mjs';
import {seal,unseal,jsonBytes,hash} from '../src/generation/common.mjs';
import {NEAR_OPAQUE_JOIN_PROFILE,GRID_TERRAIN_EDGE_PROFILE} from '../src/terrain-edges.mjs';
import {TERRAIN_UNION_MATERIAL_PROFILE,TERRAIN_SURFACE_INTERFACE_PROFILE} from '../src/terrain-union-material.mjs';
import {resolveTerrainMaterialAppearance} from '../src/terrain-loop-material.mjs';
import {studioKitSnapshot} from '../src/studio/kit-snapshot.mjs';

const ratio=q=>q.numerator/q.denominator;
const kitRef=handle=>({kitId:handle.kitId,revision:handle.revision});
const rejects=(action,code)=>assert.throws(action,error=>error.errors?.some(issue=>issue.code===code));
const plain=({kitRef,...document})=>document;
function author(handle){
  const map=readMap(handle),familyId=contextFor(handle).rules.familyId;
  return {...map,kitRef:kitRef(handle),format:'ai_scene_document_v6',bounds:{x:0,y:0,width:12,height:9},
    terrainRuns:[{x:1,y:3,length:3,familyId}],instances:[],assemblyInstances:[],inspectionCases:[],
    terrainConnections:[],instanceTransforms:[],curveTerrains:[
      {curveId:'lower',familyId,profile:'sideview-height-curve-v1',baseY:576,points:[{x:0,y:256,slope:0},{x:336,y:256,slope:0}]},
      {curveId:'separate',familyId,profile:'sideview-height-curve-v1',baseY:576,points:[{x:512,y:320,slope:0},{x:768,y:320,slope:0}]}],
    defaultCamera:{center:{x:384,y:288},viewport:{width:768,height:576},scale:1}};
}

test('dense native-lip and rigid repeat delivery selects its exact body in the compiler and Studio, while old kits still replay',
  {timeout:900000},t=>{
    const observations=coherentSurfaceObservations();observations.rockFeaturePairs[0].source.toX=160;
    const f=setupTerrainEdgeDelivery(t,{sourceAlpha:252,surfaceObservations:observations}),controls={...structuredClone(f.controls),
      joinProfile:NEAR_OPAQUE_JOIN_PROFILE,materialDensityProfile:'reference-native-2x-v1',gridProfile:GRID_TERRAIN_EDGE_PROFILE,
      junctions:{},materialProfile:TERRAIN_UNION_MATERIAL_PROFILE};
    for(const side of ['left','right'])for(const part of ['wall','corner'])controls[side][part].inboardBlend={
      fromX:controls[side][part].innerX,toX:side==='left'?264:24};
    const legacyOptions={...f.deliveryOptions,controls,output:join(f.parent,'legacy-rigid-base')},legacyReport=buildTerrainEdgeDelivery(legacyOptions),
      legacyRoot=join(legacyOptions.output,'candidate/kit'),legacyHandle=loadSceneKit(legacyRoot),legacyContext=contextFor(legacyHandle),
      appearance=legacyContext.kit.terrainAppearance,legacyKitBytes=readFileSync(join(legacyRoot,'kit.json')),
      surfaceInterface={profile:TERRAIN_SURFACE_INTERFACE_PROFILE,capSourceSha256:appearance.cap.source.sha256,capEndRow:20,fadeRows:4},
      options={...f.deliveryOptions,controls:{...controls,surfaceInterface,rigidBodyRepeat:{fromRow:24,toRow:360}},output:join(f.parent,'rigid-native-lip')},
      report=buildTerrainEdgeDelivery(options),root=join(options.output,'candidate/kit'),handle=loadSceneKit(root),context=contextFor(handle),
      repeat=context.kit.terrainRigidRepeat,input=inspectPng(legacyContext.files.get(appearance.body.source.path),{includePixels:true}),
      output=inspectPng(context.files.get(repeat.output.source.path),{includePixels:true});

    assert.deepEqual(output.rgba,input.rgba.subarray(24*input.width*4,360*input.width*4));
    assert.equal(output.width,input.width);assert.equal(output.height,336);
    assert.equal(output.height*repeat.bodyPeriod.height.denominator*256,input.height*repeat.bodyPeriod.height.numerator);
    assert.equal(repeat.phaseOriginWorldY.numerator*input.height,24*256*repeat.phaseOriginWorldY.denominator);
    assert.deepEqual(context.kit.terrainAppearance,appearance,'the measured base appearance remains immutable');
    for(const [path,bytes]of legacyContext.files)if(path.endsWith('.png'))assert.deepEqual(context.files.get(path),bytes,path);
    assert.equal([...context.files.keys()].filter(p=>p.endsWith('.png')).length,[...legacyContext.files.keys()].filter(p=>p.endsWith('.png')).length+1);
    assert.equal(hash(context.files.get(repeat.output.source.path)),repeat.output.source.sha256);

    const map=author(handle),scene=compileMap(handle,map),oldMap=author(legacyHandle),oldScene=compileMap(legacyHandle,oldMap),
      snapshot=studioKitSnapshot(handle),material=scene.terrainMaterial,H=ratio(repeat.bodyPeriod.height),origin=ratio(repeat.phaseOriginWorldY);
    assert.deepEqual(plain(map),plain(oldMap));assert.deepEqual(scene.collisionSuggestions,oldScene.collisionSuggestions);
    assert.equal(material.format,'ai_scene_continuous_terrain_appearance_v8');assert.deepEqual(material.body,repeat.output);
    assert.deepEqual(material.bodyOriginWorldY,repeat.phaseOriginWorldY);assert.deepEqual(material.bodyPeriod,repeat.bodyPeriod);
    assert.equal(scene.terrainUnionMaterial.bodyRepeatSha256,repeat.sha256);
    assert.deepEqual(scene.terrainUnionMaterial.surfaceInterface,surfaceInterface);
    assert.deepEqual(scene.terrainUnionMaterial.bodyOriginWorldY,repeat.phaseOriginWorldY);
    assert(scene.gridTerrains.length&&scene.curveTerrains.length,'exercise grid, touching curve and detached curve rendering');
    for(const patch of [...scene.gridTerrains,...scene.curveTerrains]){
      assert(patch.body.indices.length,'the body remains present');
      for(let i=0;i<patch.body.positions.length;i+=2){
        assert(Math.abs(patch.body.uvs[i]-patch.body.positions[i]/512)<2e-6,'all owners share the same X phase');
        assert(Math.abs(patch.body.uvs[i+1]-(patch.body.positions[i+1]-origin)/H)<2e-6,'all owners use the replayed rational period and shared source origin');
      }
    }
    assert.equal(snapshot.metadata.kitMaterial.format,material.format);
    assert.deepEqual(snapshot.metadata.kitMaterial.body.source,repeat.output.source);
    assert.deepEqual(snapshot.metadata.kitMaterial.bodyOriginWorldY,repeat.phaseOriginWorldY);
    assert.deepEqual(snapshot.assets.get(snapshot.metadata.kitMaterial.body.url),context.files.get(repeat.output.source.path));
    assert.equal(verifyTerrainEdgeDelivery(options).reportSha256,report.sha256);
    assert.equal(verifyTerrainEdgeDelivery(legacyOptions).reportSha256,legacyReport.sha256,'absent fields retain the old complete delivery byte replay');
    assert.deepEqual(readFileSync(join(legacyRoot,'kit.json')),legacyKitBytes);
    assert.equal(Object.hasOwn(legacyContext.kit,'terrainRigidRepeat'),false);

    const path=join(root,'kit.json'),saved=readFileSync(path);
    const withKit=(mutate,action)=>{const changed=structuredClone(context.kit);mutate(changed);writeFileSync(path,jsonBytes(changed));try{action();}finally{writeFileSync(path,saved);}};
    withKit(kit=>{const body=unseal(kit.terrainRigidRepeat);body.profile='unknown-rigid-profile';kit.terrainRigidRepeat=seal(body);},
      ()=>rejects(()=>loadSceneKit(root),'SCHEMA_CONST'));
    withKit(kit=>{const body=unseal(kit.terrainRigidRepeat);body.output.source.sha256='a'.repeat(64);kit.terrainRigidRepeat=seal(body);},
      ()=>rejects(()=>loadSceneKit(root),'RIGID_REPEAT_REPLAY'));
    const mixed={...options,output:join(f.parent,'mixed-repeat'),controls:{...options.controls,materialLoop:{overlapRows:64,phaseCount:1}}};
    rejects(()=>buildTerrainEdgeDelivery(mixed),'RIGID_REPEAT_BINDING');assert.equal(existsSync(mixed.output),false);
    const unknown={...options,output:join(f.parent,'unknown-repeat-option'),controls:{...controls,rigidBodyRepeat:{fromRow:24,toRow:360,profile:'unknown'}}};
    rejects(()=>buildTerrainEdgeDelivery(unknown),'WORKFLOW_SHAPE');assert.equal(existsSync(unknown.output),false);
    assert.equal(report.generationCalls,0);assert.equal(report.finalHumanArtReview,'pending');
  });

test('a rigid repeat cannot silently coexist with the earlier natural material loop resolver',()=>{
  rejects(()=>resolveTerrainMaterialAppearance({format:'ai_scene_continuous_terrain_appearance_v6'},{},{profile:'rigid-source-row-repeat-v1'}),'RIGID_REPEAT_CONFLICT');
});
