import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {join,dirname} from 'node:path';
import * as flow from '../src/generation/index.mjs';
import {loadSceneKit,readMap,contextFor} from '../src/kit.mjs';
import {compileMap} from '../src/compile.mjs';
import {inspectPng,encodeRgbaPng} from '../src/png.mjs';
import {hash,jsonBytes} from '../src/generation/common.mjs';
import {compileMeasuredSurfaceMapping,MEASURED_FIELD_SHA256} from '../src/terrain-proof/measured-field.mjs';
import {deriveMeasuredFieldDensity2,MEASURED_FIELD_DENSITY2_SHA256} from '../src/terrain-proof/measured-field-density.mjs';
import {createMeasuredCoherentComposition} from '../src/coherent-composition.mjs';
import {setupCoherent,sourcePng,coherentSurfaceObservations} from './helpers/coherent.mjs';
import {terrainEdgesFixture} from './helpers/terrain-edges.mjs';
import {decision} from './helpers/generation.mjs';

const rejects=(fn,code)=>assert.throws(fn,error=>error.errors?.some(issue=>issue.code===code));
function fixture(t){
  const f=setupCoherent(t),batch=flow.freezeCoherentSources(f.workflow,f.options);
  flow.authorizeReferenceAssetBatch(f.workflow,batch.sha256,decision('base.compute',batch.sha256,'approve-compute'));
  batch.planSha256s.forEach((sha,index)=>{const plan=flow.getGenerationPlan(f.workflow,sha),{request,...ticket}=flow.reservePlan(f.workflow,sha);
    flow.recordSubmission(f.workflow,ticket);flow.receiveResult(f.workflow,ticket,sourcePng(plan.target.alpha==='transparent',index+17));});
  const material=flow.getGenerationResult(f.workflow,batch.planSha256s[0]).bytes,observations={...coherentSurfaceObservations(),sourceSurfaceTopY:0,sourceBodyStartY:40,
    rockFeaturePairs:[{featureId:'native.rock',source:{fromX:100,toX:201},reference:{fromX:80,toX:182}}]},
    mapping=compileMeasuredSurfaceMapping({reference:f.raw,target:f.target,material,observations}),composition=createMeasuredCoherentComposition(batch,f.target,mapping),baseRoot=join(f.parent,'base');
  flow.buildCoherentCandidate(f.workflow,batch.sha256,'density.base',baseRoot,composition);
  const handle=loadSceneKit(join(baseRoot,'kit')),context=contextFor(handle),dense=deriveMeasuredFieldDensity2(material,mapping);
  const files=new Map([...context.files].map(([path,bytes])=>[path,Buffer.from(bytes)])),kit=structuredClone(context.kit);
  kit.terrainAppearance={...kit.terrainAppearance,format:'ai_scene_continuous_terrain_appearance_v6',profileSha256:MEASURED_FIELD_DENSITY2_SHA256,
    studySha256:dense.report.sha256,surfaceOriginInBodyPixels:dense.report.surfaceOriginInBodyPixels};
  for(const kind of ['body','cap']){const item=kit.terrainAppearance[kind],bytes=dense.files.get(`materials/${kind}-field.png`),png=inspectPng(bytes);
    files.set(item.source.path,bytes);item.source.sha256=hash(bytes);item.source.byteLength=bytes.length;item.pixelSize={width:png.width,height:png.height};}
  const write=(name,change=()=>{},changeFiles=()=>{})=>{
    const root=join(f.parent,name),k=structuredClone(kit),assets=new Map(files);change(k);changeFiles(assets,k);assets.set('kit.json',jsonBytes(k));
    for(const [path,bytes]of assets){const file=join(root,path);mkdirSync(dirname(file),{recursive:true});writeFileSync(file,bytes);}
    return root;
  };
  return {...f,batch,handle,context,dense,kit,files,write};
}

test('appearance v6 uses direct-native density2 fields while legacy v5 physical geometry and UV mapping remain stable',{timeout:240000},async t=>{
  const f=fixture(t),before=flow.inspectWorkflow(f.workflow);
  await t.test('v6 validates exact fields and compiles the same physical top, body, UV and collision',()=>{
    const handle=loadSceneKit(f.write('dense')),map=readMap(handle),legacy=compileMap(f.handle,readMap(f.handle)),scene=compileMap(handle,map);
    assert.equal(scene.terrainMaterial.format,'ai_scene_continuous_terrain_appearance_v6');assert.deepEqual(scene.terrainMaterial.body.pixelSize,{width:1010,height:506});
    assert.equal(scene.terrainMaterial.cap.pixelSize.width,1010);assert.equal(scene.terrainMaterial.cap.pixelSize.height%2,0);
    assert.deepEqual(map,readMap(f.handle));assert.deepEqual(scene.collisionSuggestions,legacy.collisionSuggestions);
    assert.equal(scene.source.authorSha256,legacy.source.authorSha256);assert.notEqual(scene.source.kitSha256,legacy.source.kitSha256);
    assert.equal(scene.curveTerrains.length,legacy.curveTerrains.length);
    for(let i=0;i<scene.curveTerrains.length;i++){
      const dense=scene.curveTerrains[i],old=legacy.curveTerrains[i];
      for(const field of ['body','cap','contour','surface','bounds','samples','profile'])assert.deepEqual(dense[field],old[field]);
      assert.deepEqual(dense.materialMapping.bodyPeriod,old.materialMapping.bodyPeriod);assert.equal(dense.materialMapping.capPeriod,old.materialMapping.capPeriod);
      assert.equal(dense.materialMapping.sourceOriginNormalizationHeight,506);assert.equal(Object.hasOwn(old.materialMapping,'sourceOriginNormalizationHeight'),false);
    }
    assert.equal(contextFor(f.handle).kit.terrainAppearance.format,'ai_scene_continuous_terrain_appearance_v5');
  });
  await t.test('mismatched profile, old field dimensions, old origin units and odd cap height are rejected',()=>{
    rejects(()=>loadSceneKit(f.write('wrong-profile',kit=>kit.terrainAppearance.profileSha256=MEASURED_FIELD_SHA256)),'APPEARANCE_PROFILE');
    rejects(()=>loadSceneKit(f.write('wrong-format',kit=>kit.terrainAppearance.format='ai_scene_continuous_terrain_appearance_v5')),'APPEARANCE_PROFILE');
    rejects(()=>loadSceneKit(f.write('wrong-origin',kit=>kit.terrainAppearance.surfaceOriginInBodyPixels=f.context.kit.terrainAppearance.surfaceOriginInBodyPixels)),'APPEARANCE_MEASURED_MAPPING');
    rejects(()=>loadSceneKit(f.write('odd-cap',kit=>kit.terrainAppearance.cap.pixelSize.height--)),'APPEARANCE_MEASURED_MAPPING');
    rejects(()=>loadSceneKit(f.write('wrong-field',kit=>kit.terrainAppearance.body=structuredClone(f.context.kit.terrainAppearance.body),assets=>{
      const item=f.context.kit.terrainAppearance.body;assets.set(item.source.path,f.context.files.get(item.source.path));
    })),'APPEARANCE_GEOMETRY');
  });
  await t.test('dense field PNG bytes and opaque source paint remain checked',()=>{
    rejects(()=>loadSceneKit(f.write('wrong-bytes',()=>{},(assets,kit)=>{
      const item=kit.terrainAppearance.body,bytes=Buffer.from(assets.get(item.source.path));bytes[bytes.length-1]^=1;assets.set(item.source.path,bytes);
    })),'CHECKSUM_MISMATCH');
    rejects(()=>loadSceneKit(f.write('alpha-change',()=>{},(assets,kit)=>{
      const item=kit.terrainAppearance.body,png=inspectPng(assets.get(item.source.path),{includePixels:true});png.rgba[3]=254;
      const bytes=encodeRgbaPng(png.width,png.height,png.rgba);assets.set(item.source.path,bytes);item.source.sha256=hash(bytes);item.source.byteLength=bytes.length;
    })),'APPEARANCE_MEASURED_ALPHA');
  });
  await t.test('side covers accept v6 only when their measured source identity still matches',()=>{
    const fixture=terrainEdgesFixture(),edges=fixture.edges;edges.sourceBinding={materialSourceSha256:f.kit.terrainAppearance.sourceSha256,surfaceMappingSha256:f.kit.terrainAppearance.surfaceMappingSha256};
    const make=(name,change=()=>{})=>f.write(name,kit=>{kit.terrainEdges=structuredClone(edges);change(kit);},assets=>{for(const [path,bytes]of fixture.files)assets.set(path,bytes);});
    const handle=loadSceneKit(make('dense-with-edges')),scene=compileMap(handle,readMap(handle));
    assert(scene.terrainEdgePlacement.placed.length>0);assert(scene.curveTerrains.some(curve=>curve.edgeMeshes?.length>0));
    rejects(()=>loadSceneKit(make('wrong-edge-binding',kit=>kit.terrainEdges.sourceBinding.materialSourceSha256='f'.repeat(64))),'TERRAIN_EDGE_BINDING');
  });
  assert.deepEqual(flow.inspectWorkflow(f.workflow),before,'validation and compilation never consume source compute');
});
