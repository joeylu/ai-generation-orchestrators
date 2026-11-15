import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { loadSceneKit, readMap, createEditor, compileMap, saveMap, loadMap, exportScene, openSceneExport,
  findCurveEndpointJoin } from '../src/index.mjs';
import { fixtureRoot, setup } from './helpers/generation.mjs';

const kit = loadSceneKit(fixtureRoot);
export function joinMap() {
  const curve = (curveId, points) => ({ curveId, profile: 'sideview-height-curve-v1', familyId:'terrain.primary', baseY:576,
    points: points.map(([x,y]) => ({x,y,slope:0})) });
  return { ...readMap(kit), format:'ai_scene_document_v2', terrainRuns:[], assemblyInstances:[], curveTerrains:[
    curve('ground.left', [[64,448],[256,320],[448,384]]),
    curve('ground.right', [[480,384],[704,256],[960,448]]),
  ] };
}
const moving = (document, side = 'left') => {
  const curve = structuredClone(document.curveTerrains.find(c=>c.curveId===`ground.${side}`));
  Object.assign(side === 'left' ? curve.points.at(-1) : curve.points[0], side === 'left' ? {x:476,y:382} : {x:451,y:382});
  return curve;
};
const command = (doc, side = 'left') => ({type:'join-curve-terrains',curve:moving(doc,side), endpoint:side==='left'?'end':'start',targetCurveId:side==='left'?'ground.right':'ground.left'});
const rejects = (fn,code) => assert.throws(fn,error=>error.errors?.some(item=>item.code===code));

test('joining the right endpoint keeps the stationary point, left ID, shared tangent and every other anchor', () => {
  const document=joinMap(), before=structuredClone(document), editor=createEditor(kit,document);
  editor.execute([command(document)]);
  const merged=editor.getDocument().curveTerrains[0];
  assert.equal(merged.curveId,'ground.left');assert.equal(merged.points.length,5);
  assert.deepEqual(merged.points,[...document.curveTerrains[0].points.slice(0,-1),...document.curveTerrains[1].points]);
  assert.deepEqual(document,before);assert.equal(editor.history().undoDepth,1);
  const scene=editor.getScene(), surface=scene.curveTerrains[0].surface;
  assert.equal(surface.filter(p=>p.x===480).length,1);
  assert.equal(scene.collisionSuggestions.curveContours.length,1);
  assert.deepEqual(scene.collisionSuggestions.curveContours[0].surface,surface);
  assert.equal(scene.curveTerrains[0].samples[0].distance,0);
  const index=surface.findIndex(p=>p.x===480);
  assert.ok(scene.curveTerrains[0].cap.uvs[index*4]>0);
  assert.ok(scene.curveTerrains[0].samples[index+1].distance>scene.curveTerrains[0].samples[index].distance);
});

test('joining the left endpoint retains the left stationary curve ID and position', () => {
  const document=joinMap(), editor=createEditor(kit,document);editor.execute([command(document,'right')]);
  assert.equal(editor.getDocument().curveTerrains[0].curveId,'ground.left');
  assert.deepEqual(editor.getDocument().curveTerrains[0].points,[...document.curveTerrains[0].points,...document.curveTerrains[1].points.slice(1)]);
});

test('joining and its endpoint movement are one exact undo/redo; a rejected join preserves redo', () => {
  const document=joinMap(), editor=createEditor(kit,document), before=editor.serialize();
  editor.execute([command(document)]);const merged=editor.serialize();editor.undo();
  assert.equal(editor.serialize(),before);const history=editor.history();
  rejects(()=>editor.execute([{...command(document),targetCurveId:'missing'}]),'CURVE_JOIN_TARGET');
  assert.deepEqual(editor.history(),history);editor.redo();assert.equal(editor.serialize(),merged);
});

test('join picking uses both 12 screen pixels and a 64 world-unit cap, and ignores interior points', () => {
  const doc=joinMap(), source=moving(doc);source.points.at(-1).y=384;
  source.points.at(-1).x=468;assert.ok(findCurveEndpointJoin(doc,source,2,1));
  source.points.at(-1).x=467;assert.equal(findCurveEndpointJoin(doc,source,2,1),null);
  source.points.at(-1).x=474;assert.ok(findCurveEndpointJoin(doc,source,2,2));
  source.points.at(-1).x=473;assert.equal(findCurveEndpointJoin(doc,source,2,2),null);
  source.points.at(-1).x=416;assert.ok(findCurveEndpointJoin(doc,source,2,.08));
  source.points.at(-1).x=415;assert.equal(findCurveEndpointJoin(doc,source,2,.08),null);
  assert.equal(findCurveEndpointJoin(doc,source,1,1),null);
  assert.equal(findCurveEndpointJoin(doc,source,2,0),null);
});

test('nearby incompatible endpoints are explicitly blocked without changing either curve', () => {
  const doc=joinMap();doc.curveTerrains[1].baseY=560;const before=structuredClone(doc), source=moving(doc);
  const candidate=findCurveEndpointJoin(doc,source,2,1);
  assert.equal(candidate.blocked,'CURVE_JOIN_BASE');assert.equal(candidate.merged,null);assert.deepEqual(doc,before);
});

for(const [name,change,code] of [
  ['same curve',c=>{c.targetCurveId=c.curve.curveId;},'CURVE_JOIN_TARGET'],
  ['missing source',c=>{c.curve.curveId='missing';},'CURVE_JOIN_TARGET'],
  ['interior endpoint name',c=>{c.endpoint='middle';},'CURVE_JOIN_ENDPOINT'],
  ['distant endpoints',c=>{c.curve.points.at(-1).x=400;},'CURVE_JOIN_DISTANCE'],
  ['different family',c=>{c.curve.familyId='foreign';},'CURVE_JOIN_MATERIAL'],
  ['different base',c=>{c.curve.baseY=560;},'CURVE_JOIN_BASE'],
  ['unknown author field',c=>{c.curve.hostPath='private';},'CURVE_JOIN_SHAPE'],
  ['malformed points',c=>{c.curve.points=null;},'CURVE_JOIN_SHAPE'],
  ['unknown command field',c=>{c.extra=true;},'COMMAND_SHAPE'],
]) test(`join rejects ${name} atomically`,()=>{
  const doc=joinMap(), editor=createEditor(kit,doc), before=editor.serialize(), c=command(doc);change(c);
  rejects(()=>editor.execute([c]),code);assert.equal(editor.serialize(),before);assert.equal(editor.history().undoDepth,0);
});

test('merging too many points or an overlong span fails before changing the map', () => {
  const doc=joinMap();doc.curveTerrains.forEach((c,index)=>{c.points=Array.from({length:17},(_,i)=>({x:64+index*544+i*32,y:448,slope:0}));});
  let editor=createEditor(kit,doc), c=command(doc);c.curve=structuredClone(doc.curveTerrains[0]);c.curve.points.at(-1).x=604;
  rejects(()=>editor.execute([c]),'CURVE_JOIN_POINT_LIMIT');assert.equal(editor.history().undoDepth,0);
  const wide=joinMap();wide.bounds.width=80;
  wide.curveTerrains[0].points=[{x:64,y:448,slope:0},{x:2112,y:448,slope:0}];
  wide.curveTerrains[1].points=[{x:2144,y:448,slope:0},{x:4256,y:448,slope:0}];
  editor=createEditor(kit,wide);c=command(wide);c.curve=structuredClone(wide.curveTerrains[0]);c.curve.points.at(-1).x=2140;
  rejects(()=>editor.execute([c]),'CURVE_JOIN_SPAN');assert.equal(editor.history().undoDepth,0);
});

test('a source moved past the target cannot fold or reverse the merged terrain', () => {
  const doc=joinMap(), editor=createEditor(kit,doc), c=command(doc);c.endpoint='start';c.curve.points[0]={x:960,y:448,slope:0};
  rejects(()=>editor.execute([c]),'CURVE_POINT_ORDER');assert.equal(editor.history().undoDepth,0);
});

test('the merged draft still passes complete mesh validation; a bad cap rolls the whole join back', () => {
  const doc=joinMap(), editor=createEditor(kit,doc), c=command(doc), before=editor.serialize();
  c.curve.points[1]={x:448,y:64,slope:0};
  rejects(()=>editor.execute([c]),'CURVE_CAP_FOLD');assert.equal(editor.serialize(),before);
});

test('merged author, shared contour and cumulative edge mapping survive save and verified export',t=>{
  const {parent}=setup(t), doc=joinMap(), editor=createEditor(kit,doc);editor.execute([command(doc)]);
  const file=join(parent,'joined.json');saveMap(kit,editor.getDocument(),file);
  assert.deepEqual(compileMap(kit,loadMap(kit,file)),editor.getScene());
  const output=join(parent,'export');exportScene(kit,editor.getDocument(),output);
  assert.deepEqual(openSceneExport(output).compiled,editor.getScene());
});
