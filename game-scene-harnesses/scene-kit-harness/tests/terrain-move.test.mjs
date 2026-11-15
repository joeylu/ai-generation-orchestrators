import test from 'node:test';
import assert from 'node:assert/strict';
import {Texture} from 'pixi.js';
import {loadSceneKit,readMap,contextFor} from '../src/kit.mjs';
import {createEditor} from '../src/editor.mjs';
import {runsFromCells,cellsFromRuns} from '../src/document.mjs';
import {terrainRegions,regionForTarget,hitTerrainRegion,terrainMoveBlock,terrainMoveDelta} from '../src/terrain-move.mjs';
import {createSceneView} from '../src/pixi/scene-view.mjs';
import {fixtureRoot} from './helpers/generation.mjs';
import {connectedMap} from './helpers/mixed.mjs';
const kit=loadSceneKit(fixtureRoot),context=contextFor(kit),grid=context.kit.grid;
const presets=context.library.presets.map(p=>({presetId:p.presetId,terrainRuns:runsFromCells(context.model.getPreset(p.presetId).cells)}));
const regions=d=>terrainRegions(d,{grid,presets,terrainSkins:context.model.analyzeMap(d).terrainSkins});
const command=(target,dx,dy)=>({type:'move-terrain',target,dx,dy});
const fails=(fn,code)=>assert.throws(fn,e=>e.errors?.some(i=>i.code===code));
const freeCurve=()=>({curveId:'free',familyId:'terrain.primary',profile:'sideview-height-curve-v1',baseY:576,points:[{x:1280,y:448,slope:0},{x:1536,y:320,slope:0},{x:1792,y:448,slope:0}]});

test('one connected grid island moves without overwriting others; click/no-op and failed moves preserve redo',()=>{
  const d={...readMap(kit),assemblyInstances:[],instances:[],inspectionCases:[],terrainRuns:[{x:2,y:4,length:2,familyId:'terrain.primary'},{x:8,y:4,length:2,familyId:'terrain.primary'}]},e=createEditor(kit,d),before=e.serialize();
  e.execute([command({cell:{x:2,y:4}},64,-64)]);const moved=e.getDocument(),cells=cellsFromRuns(moved.terrainRuns);
  assert.ok(cells.has('3,3')&&cells.has('4,3')&&cells.has('8,4'));assert.equal(cells.size,4);assert.equal(e.history().undoDepth,1);
  e.undo();assert.equal(e.serialize(),before);const history=e.history();
  e.execute([command({cell:{x:2,y:4}},0,0)]);assert.deepEqual(e.history(),history);
  fails(()=>e.execute([command({cell:{x:2,y:4}},384,0)]),'TERRAIN_OVERLAP');assert.equal(e.serialize(),before);assert.deepEqual(e.history(),history);
  fails(()=>e.execute([command({cell:{x:2,y:4}},1,0)]),'TERRAIN_MOVE_GRID');assert.equal(e.serialize(),before);
  fails(()=>e.execute([command({cell:{x:2,y:4}},-256,0)]),'TERRAIN_OUT_OF_BOUNDS');assert.deepEqual(e.history(),history);
  e.redo();assert.deepEqual(e.getDocument(),moved);
});
test('a pure curve translates every point and base by integer pixels, retaining slopes, ID and exact undo',()=>{
  const d={...readMap(kit),format:'ai_scene_document_v2',terrainRuns:[],assemblyInstances:[],curveTerrains:[freeCurve()]},e=createEditor(kit,d),before=e.serialize();
  e.execute([command({curveId:'free'},37,-21)]);const c=e.getDocument().curveTerrains[0];
  assert.equal(c.baseY,555);for(const [i,p]of c.points.entries())assert.deepEqual(p,{...d.curveTerrains[0].points[i],x:d.curveTerrains[0].points[i].x+37,y:d.curveTerrains[0].points[i].y-21});
  assert.deepEqual(e.getDocument().instances,d.instances);e.undo();assert.equal(e.serialize(),before);
  fails(()=>e.execute([command({curveId:'free'},0,10)]),'CURVE_OUT_OF_BOUNDS');assert.equal(e.serialize(),before);
});
test('connected curves, both grid platforms and link anchors move as one atomic piece from either target',()=>{
  const d=connectedMap(kit),e=createEditor(kit,d),before=e.serialize();
  for(const target of [{curveId:'mixed.hill'},{cell:{x:0,y:8}}]){
    e.execute([command(target,128,-64)]);const after=e.getDocument(),scene=e.getScene();assert.equal(e.history().undoDepth,1);assert.equal(scene.mixedTerrains.length,1);assert.equal(scene.counts.terrainNodes,16);
    for(const [i,l]of after.terrainConnections.entries())assert.deepEqual(l.cell,{x:d.terrainConnections[i].cell.x+2,y:d.terrainConnections[i].cell.y-1});
    assert.equal(after.curveTerrains[0].baseY,512);assert.ok(cellsFromRuns(after.terrainRuns).has('2,6'));e.undo();assert.equal(e.serialize(),before);
  }
});
test('terrain assemblies including disconnected nested pieces retain their wrappers and decoration when moving',()=>{
  const e=createEditor(kit),d=e.getDocument(),a=d.assemblyInstances.find(i=>i.instanceId==='pair.main'),before=e.getScene();
  const r=regionForTarget(regions(d),{assemblyId:a.instanceId});assert.ok(r.cells.length>0);assert.ok(r.assemblyIds.includes(a.instanceId));
  const visuals=before.layers.flatMap(l=>l.nodes).filter(n=>n.nodeId.startsWith('visual/'+a.instanceId+'/'));
  e.execute([command({assemblyId:a.instanceId},64,0)]);const after=e.getScene();assert.equal(e.getDocument().assemblyInstances.find(i=>i.instanceId===a.instanceId).column,a.column+1);
  for(const n of visuals){const m=after.layers.flatMap(l=>l.nodes).find(m=>m.nodeId===n.nodeId);assert.deepEqual(m.position,{x:n.position.x+64,y:n.position.y});assert.deepEqual(m.source,n.source);}
  assert.equal(after.counts.terrainNodes,before.counts.terrainNodes);e.undo();assert.deepEqual(e.getDocument(),d);
});
test('terrain hit/lock/snap behavior uses the whole region and respects primary or attached owner layers',()=>{
  const d=connectedMap(kit),r=regions(d)[0];
  assert.ok(hitTerrainRegion([r],{x:512,y:400},grid));assert.equal(hitTerrainRegion([r],{x:512,y:100},grid),null);
  assert.deepEqual(terrainMoveDelta(r,{x:0,y:0},{x:43,y:-19},grid),{dx:64,dy:0});
  assert.match(terrainMoveBlock(r,d,{locked:new Set([r.terrainLayerId])}),/锁定/);
  assert.match(terrainMoveBlock(r,d,{hidden:new Set([r.terrainLayerId])}),/隐藏/);
  const assembled=readMap(kit),a=assembled.assemblyInstances[0],ar=regionForTarget(regions(assembled),{assemblyId:a.instanceId});
  assert.match(terrainMoveBlock(ar,assembled,{locked:new Set([a.instanceId])}),/锁定/);
  assert.match(terrainMoveBlock(ar,assembled,{hiddenObjects:new Set([a.instanceId])}),/隐藏/);
});
test('terrain previews move the actual mixed mesh and reset without modifying geometry or textures',()=>{
  const d=connectedMap(kit),e=createEditor(kit,d),scene=e.getScene(),r=regions(d)[0],view=createSceneView({resolveTexture:()=>Texture.WHITE,resolveCurveMaterial:()=>({body:Texture.WHITE,cap:Texture.WHITE})});
  view.update(scene);const mesh=view.root.children.flatMap(c=>c.children).find(c=>c.label.startsWith('mixed/')),positions=[...mesh.geometry.positions];
  view.previewTerrain(r,{dx:64,dy:-64});assert.equal(mesh.x,64);assert.equal(mesh.y,-64);view.previewTerrain(r,{dx:128,dy:0});assert.equal(mesh.x,128);
  assert.deepEqual([...mesh.geometry.positions],positions);view.resetPreview();assert.equal(mesh.x,0);assert.equal(mesh.y,0);view.destroy();assert.ok(Texture.WHITE.source);
});
test('movement command has closed target/offset fields and invalid attempts never affect author/history',()=>{
  const e=createEditor(kit),before=e.serialize(),history=e.history();
  for(const bad of [command({curveId:'missing'},1,0),command({cell:{x:0.5,y:0}},64,0),command({cell:{x:0,y:0},curveId:'free'},64,0),command({arbitrary:'bad'},64,0)])fails(()=>e.execute([bad]),'TERRAIN_MOVE_TARGET');
  fails(()=>e.execute([command({assemblyId:'pair.main'},NaN,0)]),'TERRAIN_MOVE_OFFSET');
  fails(()=>e.execute([{...command({assemblyId:'pair.main'},64,0),path:'no'}]),'COMMAND_SHAPE');assert.equal(e.serialize(),before);assert.deepEqual(e.history(),history);
});
