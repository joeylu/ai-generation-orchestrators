import test from 'node:test';
import assert from 'node:assert/strict';
import {loadSceneKit,readMap} from '../src/kit.mjs';
import {createEditor} from '../src/editor.mjs';
import {studioKitSnapshot} from '../src/studio/kit-snapshot.mjs';
import {terrainRegions,regionForTarget} from '../src/terrain-move.mjs';
import {findCurveEndpointJoin} from '../src/curve-join.mjs';
import {snapTerrainBase,findCurveJoinWithBaseSnap} from '../src/studio/terrain-base-snap.mjs';
import {connectedMap} from './helpers/mixed.mjs';
import {fixtureRoot} from './helpers/generation.mjs';
const kit=loadSceneKit(fixtureRoot),metadata=studioKitSnapshot(kit).metadata,grid={width:64,height:64},worldBounds={x:0,y:0,width:4096,height:576};
const curve=(curveId,x0,x1,baseY,top=baseY-128)=>({curveId,familyId:'terrain.primary',profile:'sideview-height-curve-v1',baseY,points:[{x:x0,y:top,slope:0},{x:x1,y:top,slope:0}]});
const map=curves=>({...readMap(kit),format:'ai_scene_document_v6',terrainRuns:[],assemblyInstances:[],curveTerrains:curves,terrainConnections:[],instanceTransforms:[]});
const region=(d,id)=>regionForTarget(terrainRegions(d,{grid,presets:metadata.presets}),{curveId:id});
function connectedPair(){const d={...connectedMap(kit),format:'ai_scene_document_v6',instanceTransforms:[]};d.terrainConnections=d.terrainConnections.filter(c=>c.endpoint==='start');d.terrainRuns=d.terrainRuns.filter(r=>r.x<12);d.curveTerrains.push(curve('free',800,1152,575,447));return d;}

test('whole curve bottom snaps to the map by translation, keeps slope/shape and is exactly undoable',()=>{
  const d=map([curve('a',64,512,575)]),source=structuredClone(d),r=region(d,'a'),p=snapTerrainBase(d,r,{dx:20,dy:0},{grid,worldBounds,scale:1});
  assert.deepEqual(p.delta,{dx:20,dy:1});assert.equal(p.snap.kind,'map');assert.equal(p.snap.y,576);assert.deepEqual(d,source);
  const e=createEditor(kit,d);e.execute([{type:'move-terrain',target:{curveId:'a'},...p.delta}]);const c=e.getDocument().curveTerrains[0];assert.equal(c.baseY,576);for(const [i,p]of c.points.entries())assert.deepEqual(p,{...d.curveTerrains[0].points[i],x:d.curveTerrains[0].points[i].x+20,y:d.curveTerrains[0].points[i].y+1});assert.equal(e.history().undoDepth,1);e.undo();assert.deepEqual(e.getDocument(),source);
});
test('a nearby neighbor base has priority; screen/world thresholds, distant sides and moving away release the snap',()=>{
  const d=map([curve('a',64,256,400),curve('b',288,512,408)]),r=region(d,'a');
  const p=snapTerrainBase(d,r,{dx:24,dy:0},{grid,worldBounds,scale:1});assert.equal(p.snap.kind,'neighbor');assert.equal(p.snap.targetCurveId,'b');assert.equal(p.delta.dy,8);
  assert.equal(snapTerrainBase(d,r,{dx:24,dy:0},{grid,worldBounds,scale:4}).snap,null);
  assert.equal(snapTerrainBase(d,r,{dx:0,dy:0},{grid,worldBounds,scale:1}).snap,null);
  assert.equal(snapTerrainBase(d,r,{dx:24,dy:-20},{grid,worldBounds,scale:1}).snap,null);
  const nearMap=map([curve('a',64,256,575),curve('b',288,512,574)]);assert.equal(snapTerrainBase(nearMap,region(nearMap,'a'),{dx:24,dy:0},{grid,worldBounds,scale:1}).snap.y,574);
});
test('grid-connected pieces never receive fractional-cell corrections',()=>{
  const d=connectedPair();d.curveTerrains.find(c=>c.curveId==='free').points.forEach(p=>p.x+=40);
  const p=snapTerrainBase(d,region(d,'mixed.hill'),{dx:64,dy:0},{grid,worldBounds,scale:1});assert.equal(p.delta.dy,0);assert.notEqual(p.snap?.kind,'neighbor');
});
test('dragging the free endpoint aligns its base before a strict join; one undo restores both originals',()=>{
  const d=connectedPair(),moved=structuredClone(d.curveTerrains.find(c=>c.curveId==='free'));Object.assign(moved.points[0],{x:771,y:448});
  assert.equal(findCurveEndpointJoin(d,moved,0,1).blocked,'CURVE_JOIN_BASE');const join=findCurveJoinWithBaseSnap(d,moved,0,1);assert.equal(join.blocked,null);assert.equal(join.baseSnap.y,576);assert.equal(join.command.curve.baseY,576);
  const e=createEditor(kit,d),before=e.serialize();e.execute(join.commands??[join.command]);assert.equal(e.getDocument().curveTerrains.length,1);assert.equal(e.getDocument().terrainConnections.length,1);assert.equal(e.history().undoDepth,1);e.undo();assert.equal(e.serialize(),before);
});
test('dragging the grid-connected endpoint instead aligns the free target, preserving the fixed grid base',()=>{
  const d=connectedPair(),moved=structuredClone(d.curveTerrains.find(c=>c.curveId==='mixed.hill'));Object.assign(moved.points.at(-1),{x:797,y:447});
  const join=findCurveJoinWithBaseSnap(d,moved,2,1);assert.equal(join.blocked,null);assert.equal(join.commands.length,2);assert.equal(join.commands[0].curve.curveId,'free');assert.equal(join.commands[0].curve.baseY,576);
  const e=createEditor(kit,d),before=e.serialize();e.execute(join.commands);assert.equal(e.getDocument().curveTerrains[0].baseY,576);assert.deepEqual(e.getDocument().terrainConnections,d.terrainConnections);assert.equal(e.history().undoDepth,1);e.undo();assert.equal(e.serialize(),before);
});
test('large differences, high zoom and shallow solid depth keep the existing blocked join',()=>{
  const d=connectedPair(),free=d.curveTerrains.find(c=>c.curveId==='free'),moved=structuredClone(free);Object.assign(moved.points[0],{x:771,y:448});moved.baseY=560;assert.equal(findCurveJoinWithBaseSnap(d,moved,0,1).blocked,'CURVE_JOIN_BASE');moved.baseY=572;assert.equal(findCurveJoinWithBaseSnap(d,moved,0,4).blocked,'CURVE_JOIN_BASE');
  const shallow=map([curve('left',64,768,568,552),curve('right',800,1152,575,559)]),right=structuredClone(shallow.curveTerrains[1]);Object.assign(right.points[0],{x:771,y:552});assert.equal(findCurveJoinWithBaseSnap(shallow,right,0,1).blocked,'CURVE_JOIN_BASE');
});
