import test from 'node:test';
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {Texture} from 'pixi.js';
import {loadSceneKit,readMap} from '../src/kit.mjs';
import {createEditor} from '../src/editor.mjs';
import {compileMap} from '../src/compile.mjs';
import {validateDocument} from '../src/schema.mjs';
import {canonicalJson} from '../src/document.mjs';
import {saveMap,loadMap,exportScene,openSceneExport} from '../src/persistence.mjs';
import {createSceneView} from '../src/pixi/scene-view.mjs';
import {presetPlacement} from '../src/studio/preset-placement.mjs';
import {terrainRegions,regionForTarget} from '../src/terrain-move.mjs';
import {studioKitSnapshot} from '../src/studio/kit-snapshot.mjs';
import {connectedMap} from './helpers/mixed.mjs';
import {fixtureRoot,setup} from './helpers/generation.mjs';
const kit=loadSceneKit(fixtureRoot),fails=(fn,code)=>assert.throws(fn,e=>e.errors?.some(i=>i.code===code));
const flat=(id='ground',top=448,baseY=576)=>({curveId:id,familyId:'terrain.primary',profile:'sideview-height-curve-v1',baseY,points:[{x:64,y:top,slope:0},{x:960,y:top,slope:0}]});
const map=()=>({...readMap(kit),format:'ai_scene_document_v6',terrainRuns:[],assemblyInstances:[],instances:[],inspectionCases:[],curveTerrains:[flat()],terrainConnections:[],instanceTransforms:[]});
const run=(x,y,length=1)=>({x,y,length,familyId:'terrain.primary'});

test('v6 enables solid intersections explicitly; every legacy author keeps its old semantics and undo identity',()=>{
  const source=map(),legacy={...source,format:'ai_scene_document_v5',terrainRuns:[run(4,2)]};
  fails(()=>compileMap(kit,legacy),'CURVE_GRID_OVERLAP');assert.ok(validateDocument('ai_scene_document_v5',source).length);
  for(let version=1;version<=5;version++){
    const d=readMap(kit);d.format=`ai_scene_document_v${version}`;if(version>=2)d.curveTerrains=[];if(version>=3)d.terrainConnections=[];if(version>=4)d.instanceTransforms=[];
    const e=createEditor(kit,d),before=e.serialize();e.execute([{type:'enable-layered-terrain'}]);assert.equal(e.getDocument().format,'ai_scene_document_v6');assert.equal(e.history().undoDepth,1);e.undo();assert.equal(e.serialize(),before);
  }
  assert.deepEqual(compileMap(kit,source).terrainCoexistence.profile,'layered-terrain-solids-v1');
});
test('grid platforms above and below curves pass; actual interiors intersect and touching edges remain separate',()=>{
  for(const y of [2,6]){const d=map();d.terrainRuns=[run(4,y)];const s=compileMap(kit,d);assert.equal(s.counts.terrainNodes,1);assert.equal(s.mixedTerrains.length,0);}
  const d=map();d.curveTerrains=[flat('floating',192,320)];d.terrainRuns=[run(4,6)];assert.equal(compileMap(kit,d).counts.terrainNodes,1);
  for(const y of [7,8]){const bad=map();bad.terrainRuns=[run(4,y)];fails(()=>compileMap(kit,bad),'CURVE_GRID_OVERLAP');}
  const side=map();side.terrainRuns=[run(0,7),run(15,7)];assert.equal(compileMap(kit,side).counts.terrainNodes,2);
});
test('the sampled slope, rather than its overall bounds, decides conflicts inside each cell column',()=>{
  const d=map();d.curveTerrains[0].points=[{x:64,y:448,slope:0},{x:512,y:256,slope:0},{x:960,y:448,slope:0}];
  d.terrainRuns=[run(1,5)];assert.equal(compileMap(kit,d).counts.terrainNodes,1);
  d.terrainRuns=[run(7,4)];fails(()=>compileMap(kit,d),'CURVE_GRID_OVERLAP');
  d.terrainRuns=[run(7,3)];assert.equal(compileMap(kit,d).counts.terrainNodes,1);
});
test('curve layers can share x ranges; solid intersections at the middle of a hill are still rejected deterministically',()=>{
  const d=map();d.curveTerrains.push(flat('upper',192,256));const a=compileMap(kit,d);
  assert.equal(a.curveTerrains.length,2);assert.equal(a.format,'ai_scene_compiled_v7');d.curveTerrains.reverse();assert.equal(compileMap(kit,d).contentSha256,a.contentSha256);
  const legacy={...d,format:'ai_scene_document_v5'};fails(()=>compileMap(kit,legacy),'CURVE_DOMAIN');
  const lower=d.curveTerrains.find(c=>c.curveId==='ground');lower.points=[{x:64,y:448,slope:0},{x:512,y:256,slope:0},{x:960,y:448,slope:0}];
  assert.equal(compileMap(kit,d).curveTerrains.length,2);d.curveTerrains.find(c=>c.curveId==='upper').baseY=300;fails(()=>compileMap(kit,d),'CURVE_SOLID_OVERLAP');
});
test('negative coordinates and partial endpoint columns use the same open-interior rule',()=>{
  const d=map();d.bounds={x:-16,y:-4,width:64,height:13};d.curveTerrains=[{...flat('negative',-64,128),points:[{x:-511,y:-64,slope:0},{x:-65,y:-64,slope:0}]}];
  for(const y of [-3,2]){d.terrainRuns=[run(-5,y)];assert.equal(compileMap(kit,d).counts.terrainNodes,1);}
  d.terrainRuns=[run(-5,-1)];fails(()=>compileMap(kit,d),'CURVE_GRID_OVERLAP');
});
test('upgrade plus valid placement is one edit; invalid solid placement preserves old author and redo',()=>{
  const legacy={...map(),format:'ai_scene_document_v5'},e=createEditor(kit,legacy),before=e.serialize();
  e.execute([{type:'enable-layered-terrain'},{type:'place-assembly',instance:{instanceId:'above',presetId:'platform.small',layerId:'environment',column:5,row:1}}]);
  assert.equal(e.getDocument().format,'ai_scene_document_v6');assert.equal(e.history().undoDepth,1);const after=e.serialize();e.undo();assert.equal(e.serialize(),before);const history=e.history();
  fails(()=>e.execute([{type:'enable-layered-terrain'},{type:'paint-cells',familyId:'terrain.primary',cells:[{x:5,y:7}]}]),'CURVE_GRID_OVERLAP');assert.equal(e.serialize(),before);assert.deepEqual(e.history(),history);e.redo();assert.equal(e.serialize(),after);
  fails(()=>e.execute([{type:'enable-layered-terrain'}]),'LAYERED_TERRAIN_UPGRADE');fails(()=>e.execute([{type:'enable-layered-terrain',extra:true}]),'COMMAND_SHAPE');
});
test('an upper platform remains a separate moving piece above a connected ground chain',()=>{
  const d={...connectedMap(kit),format:'ai_scene_document_v6',instanceTransforms:[]};d.terrainRuns.push(run(7,1,2));
  const e=createEditor(kit,d),source=e.getDocument(),scene=e.getScene(),metadata=studioKitSnapshot(kit).metadata;
  assert.equal(scene.mixedTerrains.length,1);const regions=terrainRegions(source,{grid:scene.grid,presets:metadata.presets});const upper=regionForTarget(regions,{cell:{x:7,y:1}});assert.equal(upper.curveIds.length,0);
  e.execute([{type:'move-terrain',target:{cell:{x:7,y:1}},dx:64,dy:0}]);assert.deepEqual(e.getDocument().curveTerrains,source.curveTerrains);assert.deepEqual(e.getDocument().terrainConnections,source.terrainConnections);assert.equal(e.getScene().mixedTerrains.length,1);
  e.undo();assert.deepEqual(e.getDocument(),source);
});
test('placement feedback and the compiler share the same curve-solid check',()=>{
  const d=map(),scene=compileMap(kit,d),presets=studioKitSnapshot(kit).metadata.presets,preset=presets.find(p=>p.presetId==='platform.small');
  assert.equal(presetPlacement(preset,{x:320,y:64},scene,d,presets).code,null);
  assert.equal(presetPlacement(preset,{x:320,y:448},scene,d,presets).code,'CURVE_GRID_OVERLAP');
});
test('layered authors retain original source bytes through save, export, reopen, scaling and Pixi rendering',t=>{
  const {parent}=setup(t),d=map(),originalKit=canonicalJson(readMap(kit));d.terrainRuns=[run(4,2,3)];const scene=compileMap(kit,d),file=join(parent,'layered.json');saveMap(kit,d,file);assert.deepEqual(compileMap(kit,loadMap(kit,file)),scene);
  const output=join(parent,'export');exportScene(kit,d,output);const opened=openSceneExport(output);assert.equal(opened.document.format,'ai_scene_document_v6');assert.equal(opened.compiled.contentSha256,scene.contentSha256);assert.equal(opened.handle.bundleSha256,kit.bundleSha256);
  const view=createSceneView({resolveTexture:()=>Texture.WHITE,resolveCurveMaterial:()=>({body:Texture.WHITE,cap:Texture.WHITE})});view.update(scene);assert.ok(view.root.children.some(l=>l.children.length));view.destroy();
  const e=createEditor(kit,d);e.execute([{type:'add-instance',instance:{instanceId:'outside',assetId:'environment-marker',layerId:'environment',x:-128,y:0}},{type:'transform-instance',instanceId:'outside',x:-128,y:0,scale:2}]);assert.equal(e.getDocument().format,'ai_scene_document_v6');assert.equal(e.getDocument().instanceTransforms[0].scale,2);
  assert.equal(canonicalJson(readMap(kit)),originalKit);
});
