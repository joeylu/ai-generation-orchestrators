import test from 'node:test';
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {Texture} from 'pixi.js';
import {loadSceneKit,readMap,createEditor,compileMap,validateDocument,gridConnectionTargets,findGridConnection,saveMap,loadMap,exportScene,openSceneExport} from '../src/index.mjs';
import {createSceneView} from '../src/pixi/scene-view.mjs';
import {mixedPreset} from '../src/studio/curve-tools.mjs';
import {fixtureRoot,setup} from './helpers/generation.mjs';
import {mixedMap,connectedMap,connectionCommands} from './helpers/mixed.mjs';
const kit=loadSceneKit(fixtureRoot), rejects=(fn,code)=>assert.throws(fn,e=>e.errors?.some(item=>item.code===code));

test('v3 is explicit and closed; v1/v2 reject connections and retain their compiler formats',()=>{
  const doc=connectedMap(kit);assert.deepEqual(validateDocument('ai_scene_document_v3',doc),[]);
  assert.ok(validateDocument('ai_scene_document_v2',{...mixedMap(kit),terrainConnections:[]}).length);
  const bad=structuredClone(doc);delete bad.terrainConnections;assert.ok(validateDocument('ai_scene_document_v3',bad).length);
  assert.equal(compileMap(kit,readMap(kit)).format,'ai_scene_compiled_v1');assert.equal(compileMap(kit,mixedMap(kit)).format,'ai_scene_compiled_v2');
});
test('a two-sided connection preserves grid cells and yields one surface, continuous UVs and one collider',()=>{
  const original=mixedMap(kit),doc=connectedMap(kit),scene=compileMap(kit,doc),patch=scene.mixedTerrains[0];
  assert.deepEqual(doc.terrainRuns,original.terrainRuns);assert.deepEqual(doc.kitRef,original.kitRef);assert.equal(scene.format,'ai_scene_compiled_v3');
  assert.equal(scene.counts.terrainNodes,16);assert.equal(patch.source.gridCells.length,16);assert.deepEqual(patch.source.curveIds,['mixed.hill']);
  assert.equal(patch.surface.filter(p=>p.x===256).length,1);assert.equal(patch.surface.filter(p=>p.x===768).length,1);
  assert.equal(scene.collisionSuggestions.boundarySegments.length,0);assert.equal(scene.collisionSuggestions.curveContours.length,0);assert.equal(scene.collisionSuggestions.mixedContours.length,1);
  assert.deepEqual(scene.collisionSuggestions.mixedContours[0].surface,patch.surface);
  assert.deepEqual(patch.contour[0],patch.contour.at(-1));
  for(const [i,p] of patch.surface.entries()){assert.deepEqual(patch.body.positions.slice(i*4,i*4+2),[p.x,p.y]);assert.deepEqual(patch.cap.positions.slice(i*4,i*4+2),[p.x,p.y]);assert.ok(Math.abs(patch.body.uvs[i*4]-p.x/256)<1e-6);if(i)assert.ok(patch.samples[i].distance>patch.samples[i-1].distance);}
});
test('template upgrade, cells, curve and both connections are exactly one undoable gesture',()=>{
  const editor=createEditor(kit),before=editor.serialize(),sample=mixedPreset(editor.getDocument(),'mixed.sample','terrain.primary');
  editor.execute(sample.commands);const after=editor.serialize();assert.equal(editor.history().undoDepth,1);assert.equal(editor.getDocument().format,'ai_scene_document_v3');
  assert.equal(editor.getDocument().terrainConnections.length,2);assert.equal(editor.getScene().mixedTerrains.length,1);
  editor.undo();assert.equal(editor.serialize(),before);editor.redo();assert.equal(editor.serialize(),after);
});
test('candidate discovery supports rectangular top corners, screen/world thresholds and no interior points',()=>{
  const doc=mixedMap(kit),targets=gridConnectionTargets(compileMap(kit,doc)),curve=structuredClone(doc.curveTerrains[0]);
  assert.equal(targets.length,4);assert.ok(findGridConnection(doc,curve,0,1,targets));assert.equal(findGridConnection(doc,curve,1,1,targets),null);
  curve.points[0].x=269;assert.equal(findGridConnection(doc,curve,0,1,targets),null);assert.ok(findGridConnection(doc,curve,0,.5,targets));
  curve.points[0].x=321;assert.equal(findGridConnection(doc,curve,0,.08,targets),null);
  const l=structuredClone(doc);l.terrainRuns[0].length=3;assert.equal(gridConnectionTargets(compileMap(kit,l)).length,2);
});
for(const [name,mutate,code] of [
  ['duplicate endpoint',d=>{d.terrainConnections.push({...d.terrainConnections[0]});},'GRID_CONNECTION_DUPLICATE'],
  ['missing curve',d=>{d.terrainConnections[0].curveId='missing';},'CURVE_MISSING'],
  ['moved anchor',d=>{d.curveTerrains[0].points[0].x++;},'GRID_CONNECTION_ANCHOR'],
  ['different base',d=>{d.curveTerrains[0].baseY=570;},'GRID_CONNECTION_BASE'],
  ['interior cell',d=>{d.terrainConnections[0].cell.x=2;},'GRID_CONNECTION_EDGE'],
  ['irregular platform',d=>{d.terrainRuns[0].length=3;},'GRID_CONNECTION_RECTANGLE'],
  ['unknown connection field',d=>{d.terrainConnections[0].provider='private';},'SCHEMA_PROPERTY'],
  ['fractional cell',d=>{d.terrainConnections[0].cell.x=3.5;},'SCHEMA_TYPE'],
])test(`mixed author rejects ${name}`,()=>{const doc=connectedMap(kit);mutate(doc);rejects(()=>compileMap(kit,doc),code);});
test('invalid command shapes, missing upgrade, distant and incompatible joins do not change author or history',()=>{
  const original=mixedMap(kit),editor=createEditor(kit,original),before=editor.serialize();
  rejects(()=>editor.execute([connectionCommands(original,'start')]),'MIXED_UPGRADE_REQUIRED');assert.equal(editor.serialize(),before);
  editor.execute([{type:'enable-mixed-terrain'}]);const ready=editor.serialize();
  for(const [change,code] of [[c=>{c.cell.extra=true;},'GRID_CONNECTION_SHAPE'],[c=>{c.curve.baseY=570;},'GRID_CONNECTION_BASE'],[c=>{c.curve.points[0].x=400;},'GRID_CONNECTION_DISTANCE']]){
    const c=connectionCommands(editor.getDocument(),'start');change(c);rejects(()=>editor.execute([c]),code);assert.equal(editor.serialize(),ready);assert.equal(editor.history().undoDepth,1);
  }
});
test('editing a connected platform into an L rejects the entire brush; disconnect unlocks later reshaping',()=>{
  const editor=createEditor(kit,connectedMap(kit)),before=editor.serialize();
  rejects(()=>editor.execute([{type:'erase-cells',cells:[{x:0,y:7}]}]),'GRID_CONNECTION_RECTANGLE');assert.equal(editor.serialize(),before);
  editor.execute([{type:'disconnect-curve-grid',curveId:'mixed.hill',endpoint:'start'}]);editor.execute([{type:'erase-cells',cells:[{x:0,y:7}]}]);assert.equal(editor.getScene().counts.terrainNodes,15);
  editor.undo();editor.undo();assert.equal(editor.serialize(),before);
});
test('deleting a curve removes its links while preserving all authored cells',()=>{
  const doc=connectedMap(kit),editor=createEditor(kit,doc);editor.execute([{type:'remove-curve-terrain',curveId:'mixed.hill'}]);
  assert.equal(editor.getDocument().terrainConnections.length,0);assert.equal(editor.getScene().mixedTerrains.length,0);assert.deepEqual(editor.getDocument().terrainRuns,doc.terrainRuns);
  editor.undo();assert.deepEqual(editor.getDocument(),doc);
});
test('merging free curve ends preserves their outer grid links and shared compiled patch',()=>{
  const doc=connectedMap(kit),original=doc.curveTerrains[0];
  doc.curveTerrains=[{...original,curveId:'left',points:[{x:256,y:448,slope:0},{x:384,y:384,slope:0},{x:512,y:448,slope:0}]},
    {...original,curveId:'right',points:[{x:544,y:448,slope:0},{x:672,y:384,slope:0},{x:768,y:448,slope:0}]}];
  doc.terrainConnections=[{curveId:'left',endpoint:'start',cell:{x:3,y:7}},{curveId:'right',endpoint:'end',cell:{x:12,y:7}}];
  const editor=createEditor(kit,doc),curve=structuredClone(doc.curveTerrains[0]);curve.points.at(-1).x=543;
  editor.execute([{type:'join-curve-terrains',curve,endpoint:'end',targetCurveId:'right'}]);
  assert.equal(editor.getDocument().curveTerrains.length,1);assert.ok(editor.getDocument().terrainConnections.every(c=>c.curveId==='left'));assert.equal(editor.getScene().mixedTerrains.length,1);
  rejects(()=>editor.execute([{type:'join-curve-terrains',curve:editor.getDocument().curveTerrains[0],endpoint:'start',targetCurveId:'left'}]),'CURVE_JOIN_TARGET');
});
test('mixed chains over 8192 units are rejected without clipping or weakening sampling',()=>{
  const doc=mixedMap(kit);doc.bounds.width=160;doc.terrainRuns=[{x:0,y:7,length:130,familyId:'terrain.primary'},{x:0,y:8,length:130,familyId:'terrain.primary'}];
  doc.curveTerrains[0].points=[{x:8321,y:448,slope:0},{x:8650,y:320,slope:0},{x:9000,y:448,slope:0}];
  const editor=createEditor(kit,doc),before=editor.serialize();rejects(()=>editor.execute([{type:'enable-mixed-terrain'},{type:'connect-curve-grid',curve:doc.curveTerrains[0],endpoint:'start',cell:{x:129,y:7}}]),'GRID_CONNECTION_SPAN');assert.equal(editor.serialize(),before);
});
test('v3 authors and unified meshes survive canonical save/open and verified exports',t=>{
  const {parent}=setup(t),doc=connectedMap(kit),file=join(parent,'mixed.json');saveMap(kit,doc,file);assert.deepEqual(loadMap(kit,file),doc);
  const output=join(parent,'export');exportScene(kit,doc,output);assert.deepEqual(openSceneExport(output).compiled,compileMap(kit,doc));
});
test('negative world coordinates and an expanded map keep the same connected geometry and material phase',()=>{
  const doc=connectedMap(kit);doc.bounds.x=-16;doc.terrainRuns.forEach(run=>run.x-=16);doc.curveTerrains[0].points.forEach(p=>p.x-=1024);doc.terrainConnections.forEach(c=>c.cell.x-=16);
  const patch=compileMap(kit,doc).mixedTerrains[0];assert.equal(patch.body.uvs[0],-4);doc.bounds.width+=16;
  assert.deepEqual(compileMap(kit,doc).mixedTerrains[0],patch);
});
test('Pixi replaces only connected cells and curves with one pair of meshes, preserving unrelated tiles and host textures',()=>{
  const doc=connectedMap(kit);doc.terrainRuns.push({x:20,y:8,length:1,familyId:'terrain.primary'});const scene=compileMap(kit,doc);
  let fail=false;const view=createSceneView({resolveTexture:()=>Texture.EMPTY,resolveCurveMaterial:()=>{if(fail)throw new Error('missing');return {body:Texture.WHITE,cap:Texture.EMPTY};}});view.update(scene);
  const layer=view.root.children.find(c=>c.label==='terrain');assert.equal(layer.children.length,3);assert.equal(layer.children.filter(c=>c.label.startsWith('mixed/')).length,2);
  fail=true;assert.throws(()=>view.update(scene),/missing/);assert.equal(view.root.children.find(c=>c.label==='terrain'),layer);view.destroy();assert.ok(Texture.WHITE.source);
});
