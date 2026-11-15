import test from 'node:test';import assert from 'node:assert/strict';import {fileURLToPath} from 'node:url';
import {loadSceneKit,readMap} from '../src/kit.mjs';import {createEditor} from '../src/editor.mjs';import {studioKitSnapshot} from '../src/studio/kit-snapshot.mjs';import {planTerrainStroke} from '../src/studio/terrain-stroke.mjs';
import {connectedMap} from './helpers/mixed.mjs';
const handle=loadSceneKit(fileURLToPath(new URL('./fixtures/synthetic',import.meta.url))),metadata=studioKitSnapshot(handle).metadata;
function setup(assemblies=[{instanceId:'small',presetId:'platform.small',layerId:'environment',column:4,row:2}]){const document=readMap(handle);document.terrainRuns=[];document.instances=[];document.assemblyInstances=assemblies;document.inspectionCases=[];return createEditor(handle,document);}
const erase=cells=>({type:'erase-cells',cells});const paint=cells=>({type:'paint-cells',familyId:metadata.familyId,cells});
function plan(editor,command,extra={}){return planTerrainStroke({document:editor.getDocument(),presets:metadata.presets,scene:editor.getScene(),command,...extra});}
function connected(){return createEditor(handle,{...connectedMap(handle),format:'ai_scene_document_v6',instanceTransforms:[]});}

test('painting steps on a curve-connected grid releases only the invalid rectangle link in one undoable stroke',()=>{
 const editor=connected(),before=editor.getDocument(),scene=editor.getScene(),p=plan(editor,paint([{x:3,y:6},{x:2,y:6}]));
 editor.execute(p.commands);assert.equal(p.disconnectedCount,1);assert.deepEqual(p.commands.map(c=>c.type),['disconnect-curve-grid','paint-cells']);
 assert.deepEqual(editor.getDocument().curveTerrains,before.curveTerrains);assert.deepEqual(editor.getDocument().terrainConnections,before.terrainConnections.filter(c=>c.endpoint==='end'));
 assert.equal(editor.getScene().counts.terrainNodes,scene.counts.terrainNodes+2);assert.equal(editor.history().undoDepth,1);const after=editor.getDocument();editor.undo();assert.deepEqual(editor.getDocument(),before);editor.redo();assert.deepEqual(editor.getDocument(),after);
});

test('erasing a connection corner releases its link but preserves every other curve, grid and link',()=>{
 const editor=connected(),before=editor.getDocument(),p=plan(editor,erase([{x:3,y:7}]));editor.execute(p.commands);assert.equal(p.disconnectedCount,1);assert.equal(editor.getScene().counts.terrainNodes,15);
 assert.deepEqual(editor.getDocument().curveTerrains,before.curveTerrains);assert.deepEqual(editor.getDocument().terrainConnections,before.terrainConnections.filter(c=>c.endpoint==='end'));editor.undo();assert.deepEqual(editor.getDocument(),before);
});

test('independent upper platforms and no-op strokes leave both links intact',()=>{
 const upper=connected(),upperBefore=upper.getDocument(),upperPlan=plan(upper,paint([{x:4,y:2},{x:5,y:2}]));assert.equal(upperPlan.disconnectedCount,0);upper.execute(upperPlan.commands);assert.deepEqual(upper.getDocument().terrainConnections,upperBefore.terrainConnections);
 const editor=connected(),before=editor.getDocument(),p=plan(editor,paint([{x:0,y:7},{x:3,y:7}]));assert.deepEqual(p.commands,[]);assert.deepEqual(editor.getDocument(),before);assert.equal(editor.history().undoDepth,0);
});

test('raising a complete rectangular platform releases a displaced top corner without moving the curve',()=>{
 const editor=connected(),before=editor.getDocument(),p=plan(editor,paint([{x:0,y:6},{x:1,y:6},{x:2,y:6},{x:3,y:6}]));assert.equal(p.disconnectedCount,1);editor.execute(p.commands);assert.deepEqual(editor.getDocument().curveTerrains,before.curveTerrains);assert.equal(editor.getDocument().terrainConnections.length,1);editor.undo();assert.deepEqual(editor.getDocument(),before);
});

test('painting and erasing preserve a connection when the final rectangle keeps its original top corner and base',()=>{
 const d={...connectedMap(handle),format:'ai_scene_document_v6',instanceTransforms:[]};d.bounds.x=-1;d.bounds.width++;
 const editor=createEditor(handle,d),before=editor.getDocument(),p=plan(editor,paint([{x:-1,y:7},{x:-1,y:8}]));assert.equal(p.disconnectedCount,0);editor.execute(p.commands);assert.deepEqual(editor.getDocument().terrainConnections,before.terrainConnections);
 const erasePlan=plan(editor,erase([{x:-1,y:7},{x:-1,y:8}]));assert.equal(erasePlan.disconnectedCount,0);editor.execute(erasePlan.commands);assert.deepEqual(editor.getDocument(),before);
});

test('a stroke that invalidates two links releases both before painting, with the complete source restored by one undo',()=>{
 const editor=connected(),before=editor.getDocument(),p=plan(editor,paint([{x:3,y:6},{x:12,y:6}]));assert.equal(p.disconnectedCount,2);assert.deepEqual(p.commands.map(c=>c.type),['disconnect-curve-grid','disconnect-curve-grid','paint-cells']);editor.execute(p.commands);assert.equal(editor.getDocument().terrainConnections.length,0);assert.equal(editor.getScene().mixedTerrains.length,0);editor.undo();assert.deepEqual(editor.getDocument(),before);
});

test('erasing a connected assembly expands only its touched owner after unlinking and preserves its decoration',()=>{
 const d={...connectedMap(handle),format:'ai_scene_document_v6',instanceTransforms:[]};d.terrainRuns=d.terrainRuns.filter(run=>run.x!==0);d.assemblyInstances=[{instanceId:'top',presetId:'platform.small',layerId:'environment',column:0,row:6},{instanceId:'bottom',presetId:'platform.small',layerId:'environment',column:0,row:7}];
 const editor=createEditor(handle,d),before=editor.getDocument(),scene=editor.getScene(),p=plan(editor,erase([{x:3,y:7}]));assert.equal(p.disconnectedCount,1);assert.equal(p.expandedCount,1);assert.deepEqual(p.commands.map(c=>c.type),['disconnect-curve-grid','expand-assembly','erase-cells']);editor.execute(p.commands);assert.equal(editor.getScene().counts.terrainNodes,scene.counts.terrainNodes-1);assert.equal(editor.getScene().counts.visualNodes,scene.counts.visualNodes);assert.equal(editor.getDocument().assemblyInstances.length,1);editor.undo();assert.deepEqual(editor.getDocument(),before);
});

test('locked or hidden connected curves block implicit unlinking, while unrelated upper painting is allowed',()=>{
 const editor=connected(),before=editor.getDocument();for(const extra of [{locked:new Set(['mixed.hill'])},{hiddenObjects:new Set(['mixed.hill'])}]){
  const p=plan(editor,paint([{x:3,y:6}]),extra);assert.match(p.code,/STROKE_CONNECTION_/);assert.deepEqual(p.commands,[]);
  assert.equal(plan(editor,paint([{x:5,y:2}]),extra).code,null);
 }assert.deepEqual(editor.getDocument(),before);
});

test('an invalid curve-intersecting stroke cannot leave its automatic disconnect or clear redo behind',()=>{
 const editor=connected(),before=editor.getDocument();editor.execute(plan(editor,paint([{x:5,y:2}])).commands);editor.undo();const history=editor.history(),p=plan(editor,paint([{x:3,y:6},{x:7,y:7}]));assert.equal(p.disconnectedCount,1);
 assert.throws(()=>editor.execute(p.commands),e=>e.errors?.some(i=>i.code==='CURVE_GRID_OVERLAP'));assert.deepEqual(editor.getDocument(),before);assert.deepEqual(editor.history(),history);
});
test('erasing a terrain assembly explicitly expands and edits in one undoable gesture while retaining its visuals',()=>{
 const editor=setup(),before=editor.getDocument(),scene=editor.getScene(),p=plan(editor,erase([{x:4,y:3},{x:4,y:3}]));assert.equal(p.expandedCount,1);assert.deepEqual(p.commands.map(c=>c.type),['expand-assembly','erase-cells']);assert.equal(p.commands[1].cells.length,1);
 assert.deepEqual(editor.getDocument(),before);editor.execute(p.commands);assert.equal(editor.getDocument().assemblyInstances.length,0);assert.equal(editor.getScene().counts.terrainNodes,3);assert.equal(editor.getScene().counts.visualNodes,1);assert.equal(editor.history().undoDepth,1);
 const visuals=s=>s.layers.flatMap(l=>l.nodes).filter(n=>!n.cell).map(n=>({assetId:n.assetId,position:n.position,layerId:n.layerId}));assert.deepEqual(visuals(editor.getScene()),visuals(scene));
 editor.undo();assert.deepEqual(editor.getDocument(),before);assert.equal(editor.getScene().contentSha256,scene.contentSha256);editor.redo();assert.equal(editor.getScene().counts.terrainNodes,3);
});
test('a stroke across nested and regular assemblies expands each owner once and restores both with one undo',()=>{
 const editor=setup([{instanceId:'small',presetId:'platform.small',layerId:'environment',column:4,row:2},{instanceId:'pair',presetId:'platform.pair',layerId:'environment',column:12,row:2}]),before=editor.getDocument(),scene=editor.getScene();
 const p=plan(editor,erase([{x:4,y:3},{x:12,y:3},{x:16,y:4}]));assert.equal(p.expandedCount,2);assert.equal(p.commands.length,3);editor.execute(p.commands);assert.equal(editor.getScene().counts.terrainNodes,scene.counts.terrainNodes-3);assert.equal(editor.getScene().counts.visualNodes,scene.counts.visualNodes);assert.equal(editor.history().undoDepth,1);editor.undo();assert.deepEqual(editor.getDocument(),before);
});
test('painting existing assembly cells is a no-op and painting an adjacent empty cell does not break its assembly',()=>{
 const editor=setup(),before=editor.getDocument();assert.deepEqual(plan(editor,paint([{x:4,y:3}])).commands,[]);assert.deepEqual(plan(editor,erase([{x:4,y:2}])).commands,[]);
 const p=plan(editor,paint([{x:4,y:3},{x:8,y:3}]));assert.deepEqual(p.commands,[paint([{x:8,y:3}])]);editor.execute(p.commands);assert.equal(editor.getDocument().assemblyInstances.length,1);assert.equal(editor.getScene().counts.terrainNodes,5);editor.undo();assert.deepEqual(editor.getDocument(),before);
});
test('locked or hidden terrain/assembly owners and rigid platform skins cannot be silently expanded or deleted',()=>{
 const editor=setup(),before=editor.getDocument(),command=erase([{x:4,y:3}]);
 for(const extra of [{locked:new Set(['terrain'])},{hidden:new Set(['terrain'])},{locked:new Set(['environment'])},{locked:new Set(['small'])},{hidden:new Set(['environment'])},{hiddenObjects:new Set(['small'])}]){const p=plan(editor,command,extra);assert.ok(p.code);assert.deepEqual(p.commands,[]);}
 const rigid=plan(editor,command,{scene:{terrainSkins:[{cells:[{x:4,y:3}]}]}});assert.equal(rigid.code,'STROKE_RIGID_PLATFORM');assert.deepEqual(rigid.commands,[]);assert.deepEqual(editor.getDocument(),before);assert.equal(editor.history().undoDepth,0);
});
test('invalid/cross-boundary strokes and a failed post-expansion edit preserve the complete author and history',()=>{
 const editor=setup(),before=editor.getDocument();assert.equal(plan(editor,erase([{x:4,y:3},{x:-1,y:3}])).code,'TERRAIN_OUT_OF_BOUNDS');assert.equal(plan(editor,erase([{x:4.5,y:3}])).code,'COMMAND_CELL');
 const p=plan(editor,erase([{x:4,y:3}]));assert.throws(()=>editor.execute([...p.commands,{type:'erase-cells',cells:[{x:99999,y:3}]}]));assert.deepEqual(editor.getDocument(),before);assert.equal(editor.history().undoDepth,0);
});
