import test from 'node:test';
import assert from 'node:assert/strict';
import {compileGridTerrainFields} from '../src/grid-terrain.mjs';
import {join} from 'node:path';
import {readFileSync,writeFileSync} from 'node:fs';
import {Texture} from 'pixi.js';
import {loadSceneKit,readMap,contextFor} from '../src/kit.mjs';
import {compileMap} from '../src/compile.mjs';
import {createEditor} from '../src/editor.mjs';
import {createSceneView} from '../src/pixi/scene-view.mjs';
import {studioKitSnapshot} from '../src/studio/kit-snapshot.mjs';
import {planTerrainStroke} from '../src/studio/terrain-stroke.mjs';
import {exportScene,openSceneExport,exportSceneArchive} from '../src/persistence.mjs';
import {buildTerrainEdgeDelivery} from '../src/terrain-edge-pipeline.mjs';
import {upgradeTerrainBrushKit,verifyTerrainBrushKit} from '../src/grid-terrain-upgrade.mjs';
import {NEAR_OPAQUE_JOIN_PROFILE} from '../src/terrain-edges.mjs';
import {hash,seal,unseal,jsonBytes} from '../src/generation/common.mjs';
import * as flow from '../src/generation/index.mjs';
import {setupTerrainEdgeDelivery} from './helpers/terrain-edge-delivery.mjs';
import {coherentSurfaceObservations} from './helpers/coherent.mjs';

const grid={width:64,height:64},appearance={format:'ai_scene_continuous_terrain_appearance_v6',
  surfaceOriginInBodyPixels:{numerator:-30,denominator:1},capDepth:{numerator:4096,denominator:253},
  capUvEnd:{numerator:1,denominator:1},surfaceMappingSha256:'b'.repeat(64)};
const occupancy=points=>new Map(points.map(([x,y])=>[`${x},${y}`,'terrain.primary']));
const fields=(cells,options={})=>compileGridTerrainFields(cells,{grid,appearance,layerId:'terrain',...options});
function covers(mesh,x,y){
  for(let i=0;i<mesh.indices.length;i+=3){const ids=mesh.indices.slice(i,i+3),[a,b,c]=ids.map(n=>({x:mesh.positions[n*2],y:mesh.positions[n*2+1]})),
    den=(b.y-c.y)*(a.x-c.x)+(c.x-b.x)*(a.y-c.y);if(Math.abs(den)<1e-9)continue;
    const u=((b.y-c.y)*(x-c.x)+(c.x-b.x)*(y-c.y))/den,v=((c.y-a.y)*(x-c.x)+(a.x-c.x)*(y-c.y))/den;
    if(Math.min(u,v,1-u-v)>=-1e-9)return true;
  }return false;
}

test('grid material uses the measured body and real exposed surface rather than legacy tile artwork',()=>{
  const cells=occupancy([[1,2],[2,2],[1,3],[2,3]]),before=new Map(cells),[patch]=fields(cells);
  assert.deepEqual(cells,before);assert.equal(patch.source.gridCells.length,4);assert.equal(patch.body.indices.length,24);
  assert.equal(patch.cap.indices.length,12);assert.deepEqual(patch.surfaceSpans,[{from:{x:64,y:128},to:{x:192,y:128}}]);
  assert.deepEqual(patch.materialMapping.bodyPeriod,{width:512,height:256});assert.equal(patch.materialMapping.sourceOriginNormalizationHeight,506);
  assert.equal(patch.materialMapping.surfaceMappingSha256,appearance.surfaceMappingSha256);
  assert.equal(patch.body.uvs[0],64/512);assert.equal(patch.body.uvs[1],-30/506);
  assert.equal(patch.cap.uvs[0],64/512);assert.equal(patch.cap.uvs[1],0);assert.equal(patch.cap.uvs[3],1);
  const shared=patch.body.positions.reduce((out,_,index)=>{if(index%2===0&&patch.body.positions[index]===128&&patch.body.positions[index+1]===192)out.push(patch.body.uvs.slice(index,index+2));return out;},[]);
  assert.equal(shared.length,4);assert(shared.every(uv=>uv[0]===.25&&uv[1]===-30/506+.25));
  assert.equal(patch.generationCalls,0);assert.equal(patch.visualAcceptance,'not-assessed');
});

test('L shapes and enclosed grid holes retain their actual solid union and exposed inner ledges',()=>{
  for(const points of [[[1,2],[2,2],[3,2],[1,3]],[[1,2],[2,2],[3,2],[1,3],[3,3],[1,4],[2,4],[3,4]]]){
    const cells=occupancy(points),patches=fields(cells);
    assert.equal(patches.length,1);assert.deepEqual(new Set(patches[0].source.gridCells.map(c=>`${c.x},${c.y}`)),new Set(cells.keys()));
    for(let y=1;y<6;y++)for(let x=0;x<5;x++)assert.equal(patches.some(p=>covers(p.body,x*64+32,y*64+32)),cells.has(`${x},${y}`),`occupancy at ${x},${y}`);
    assert(!patches.some(p=>covers(p.body,160,224)));assert(!patches.some(p=>covers(p.cap,160,224)));
  }
  const ring=fields(occupancy([[1,2],[2,2],[3,2],[1,3],[3,3],[1,4],[2,4],[3,4]]))[0];
  assert(ring.surfaceSpans.some(s=>s.from.x===128&&s.to.x===192&&s.from.y===256),'the bottom of the hole owns its real north ledge');
});

test('attached owners are excluded without inventing cap faces and disconnected IDs remain deterministic',()=>{
  const cells=occupancy([[1,2],[1,3],[2,3],[4,2]]),excludedCells=new Set(['1,2']),patches=fields(cells,{excludedCells});
  assert.equal(patches.length,2);assert(!patches.some(p=>p.source.gridCells.some(c=>c.x===1&&c.y===2)));
  assert(!patches.some(p=>p.surfaceSpans.some(s=>s.from.x===64&&s.from.y===192)),'a still-occupied excluded upper cell is not a new painted surface');
  const reversed=new Map([...cells].reverse());assert.deepEqual(fields(reversed,{excludedCells}),patches);
  assert.deepEqual(fields(cells,{excludedCells:new Set(cells.keys())}),[]);assert.deepEqual(fields(new Map()),[]);
  const interlocked=fields(occupancy([[1,4],[2,4],[3,4],[4,4],[4,3],[4,2],[4,1],[1,1]]));
  assert.equal(interlocked.length,2);assert.equal(new Set(interlocked.map(p=>p.gridTerrainId)).size,2,'IDs use an owned anchor, not an ambiguous bounding-box corner');
});

function blankMap(handle){
  return {...readMap(handle),format:'ai_scene_document_v6',bounds:{x:0,y:0,width:12,height:8},
    terrainRuns:[],instances:[],assemblyInstances:[],curveTerrains:[],terrainConnections:[],inspectionCases:[],instanceTransforms:[],
    defaultCamera:{center:{x:384,y:256},viewport:{width:768,height:512},scale:1}};
}
const fails=(fn,code)=>assert.throws(fn,error=>error.errors?.some(issue=>issue.code===code));

test('the actual brush editor renders continuous fields and native sides, then undoes and exports without changing native assets',{timeout:360000},async t=>{
  const observations=coherentSurfaceObservations();observations.rockFeaturePairs[0].source.toX=160;
  const f=setupTerrainEdgeDelivery(t,{sourceAlpha:252,surfaceObservations:observations}),controls={...structuredClone(f.controls),
    joinProfile:NEAR_OPAQUE_JOIN_PROFILE,materialDensityProfile:'reference-native-2x-v1'};
  for(const side of ['left','right'])for(const part of ['wall','corner'])controls[side][part].inboardBlend={fromX:controls[side][part].innerX,toX:side==='left'?264:24};
  const baseOutput=join(f.parent,'v3-delivery');buildTerrainEdgeDelivery({...f.deliveryOptions,controls,output:baseOutput});
  const baseRoot=join(baseOutput,'candidate/kit'),oldHandle=loadSceneKit(baseRoot),oldMap=blankMap(oldHandle),upgraded=join(f.parent,'grid-upgrade'),
    upgradeOptions={root:baseRoot,document:oldMap,output:upgraded},receipt=upgradeTerrainBrushKit(upgradeOptions),handle=loadSceneKit(join(upgraded,'kit')),
    context=contextFor(handle),document={...oldMap,kitRef:{kitId:handle.kitId,revision:handle.revision}},metadata=studioKitSnapshot(handle).metadata,
    editor=createEditor(handle,document),before=editor.serialize(),workflowBefore=flow.inspectWorkflow(f.workflow);
  const plan=(ed,command)=>planTerrainStroke({command,document:ed.getDocument(),scene:ed.getScene(),presets:metadata.presets});
  const paint=cells=>({type:'paint-cells',familyId:metadata.familyId,cells}),erase=cells=>({type:'erase-cells',cells});
  const four=[{x:2,y:2},{x:3,y:2},{x:2,y:3},{x:3,y:3}];let painted,L;
  await t.test('v4 opt-in paints both same-material surfaces and exposed native rock edges without resolving old tile sprites',()=>{
    assert.equal(context.kit.terrainEdges.format,'ai_scene_terrain_edges_v4');assert.equal(context.kit.terrainAppearance.format,'ai_scene_continuous_terrain_appearance_v6');
    assert.equal(receipt.generationCalls,0);assert.equal(receipt.allOriginalPngBytesPreserved,true);
    assert.equal(Object.hasOwn(editor.getScene(),'gridTerrains'),false);
    const gesture=plan(editor,paint(four));assert.equal(gesture.code,null);editor.execute(gesture.commands);painted=editor.getScene();
    assert.equal(editor.history().undoDepth,1);assert.equal(painted.counts.terrainNodes,4);assert.equal(painted.gridTerrains.length,1);
    assert.equal(painted.terrainPresentation.meshCoveredGridCells,4);assert.equal(painted.terrainPresentation.renderedGridNodes,0);
    assert.equal(painted.gridTerrains[0].source.gridCells.length,4);assert(painted.gridTerrains[0].edgeMeshes.length>0);
    assert(painted.terrainEdgePlacement.grid.placed.some(edge=>edge.side==='left'&&edge.cornerApplied));
    assert(painted.terrainEdgePlacement.grid.placed.some(edge=>edge.side==='right'&&edge.cornerApplied));
    const legacy=compileMap(oldHandle,{...editor.getDocument(),kitRef:oldMap.kitRef});
    assert.equal(Object.hasOwn(legacy,'gridTerrains'),false);assert.equal(legacy.terrainPresentation.renderedGridNodes,4);
    assert.deepEqual(painted.collisionSuggestions,legacy.collisionSuggestions);
    let tileResolutions=0;
    const view=createSceneView({resolveTexture:()=>{tileResolutions++;return Texture.WHITE;},
      resolveCurveMaterial:()=>({body:Texture.WHITE,cap:Texture.WHITE,edges:{'left.wall':Texture.WHITE,'right.wall':Texture.WHITE,'left.corner':Texture.WHITE,'right.corner':Texture.WHITE}})});
    view.update(painted);assert.equal(tileResolutions,0,'logical 47-tile nodes remain data but are not rendered over the new material');
    const meshes=view.root.children.flatMap(layer=>layer.children);assert.equal(meshes.length,2+painted.gridTerrains[0].edgeMeshes.length);
    view.previewTerrain({cellKeys:new Set(four.map(cell=>`${cell.x},${cell.y}`)),curveIds:[],instanceIds:[],assemblyIds:[]},{dx:64,dy:0});
    assert(meshes.every(mesh=>mesh.x===64&&mesh.y===0));view.resetPreview();assert(meshes.every(mesh=>mesh.x===0&&mesh.y===0));view.destroy();
  });
  await t.test('one stroke is one history entry and erased grid regions keep their real shape',()=>{
    editor.undo();assert.equal(editor.serialize(),before);assert.equal(Object.hasOwn(editor.getScene(),'gridTerrains'),false);
    editor.redo();assert.equal(editor.getScene().contentSha256,painted.contentSha256);
    editor.execute(plan(editor,erase([{x:2,y:2}])).commands);L=editor.getDocument();const scene=editor.getScene();
    assert.equal(scene.counts.terrainNodes,3);assert.equal(scene.terrainPresentation.meshCoveredGridCells,3);
    assert(!scene.gridTerrains.some(patch=>covers(patch.body,160,160)),'the erased corner is not filled by a component bounding rectangle');
    const after=editor.serialize();editor.undo();assert.equal(editor.getScene().contentSha256,painted.contentSha256);editor.redo();assert.equal(editor.serialize(),after);
  });
  await t.test('rigid platform skins stay intact and are never replaced by generic grid material',()=>{
    const map=readMap(handle);map.bounds={x:0,y:0,width:12,height:8};const rigid=createEditor(handle,map),beforeRigid=rigid.getScene();
    assert(beforeRigid.terrainSkins.length>0);assert.equal(Object.hasOwn(beforeRigid,'gridTerrains'),false);
    rigid.execute(plan(rigid,paint([{x:6,y:4}])).commands);const scene=rigid.getScene(),skinCells=new Set(scene.terrainSkins.flatMap(skin=>skin.cells.map(cell=>`${cell.x},${cell.y}`)));
    assert.equal(scene.terrainPresentation.meshCoveredGridCells,1);assert(scene.gridTerrains.every(patch=>patch.source.gridCells.every(cell=>!skinCells.has(`${cell.x},${cell.y}`))));
    assert.deepEqual(scene.terrainSkins,beforeRigid.terrainSkins);
    const cell=scene.terrainSkins[0].cells[0],rejected=plan(rigid,erase([cell]));assert.equal(rejected.code,'STROKE_RIGID_PLATFORM');assert.deepEqual(rejected.commands,[]);
  });
  await t.test('shared curve walls are removed while explicit mixed-patch restrictions remain unchanged',()=>{
    const map={...document,terrainRuns:[{x:2,y:2,length:2,familyId:metadata.familyId},{x:2,y:3,length:2,familyId:metadata.familyId},{x:2,y:4,length:2,familyId:metadata.familyId}],
      curveTerrains:[{curveId:'touching.curve',familyId:metadata.familyId,profile:'sideview-height-curve-v1',baseY:320,points:[{x:256,y:128,slope:0},{x:448,y:128,slope:0}]}]},scene=compileMap(handle,map);
    assert(scene.gridTerrains.length>0);assert(!scene.terrainEdgePlacement.placed.some(edge=>edge.x===256&&edge.toY>128&&edge.fromY<320),'a shared interior is not decorated twice');
    fails(()=>compileMap(handle,{...map,terrainConnections:[{curveId:'touching.curve',endpoint:'start',cell:{x:3,y:2}}]}),'TERRAIN_EDGE_GEOMETRY');
  });
  await t.test('a future checked source batch can explicitly deliver grid-capable material without a case-specific upgrade',()=>{
    const output=join(f.parent,'direct-grid-delivery'),report=buildTerrainEdgeDelivery({...f.deliveryOptions,controls:{...controls,gridProfile:'grid-solid-union-native-v1'},output}),
      direct=loadSceneKit(join(output,'candidate/kit')),initial=compileMap(direct,readMap(direct)),directContext=contextFor(direct);
    assert.equal(report.generationCalls,0);assert.equal(directContext.kit.terrainEdges.format,'ai_scene_terrain_edges_v4');
    assert.equal(directContext.kit.terrainEdges.gridProfile,'grid-solid-union-native-v1');
    assert(initial.terrainSkins.length>0);assert.equal(Object.hasOwn(initial,'gridTerrains'),false,'the fixed platform skin is excluded even on a freshly delivered grid-capable kit');
    const fresh=createEditor(direct,blankMap(direct));fresh.execute([{type:'paint-cells',familyId:directContext.rules.familyId,cells:four}]);
    const scene=fresh.getScene();assert.equal(scene.terrainPresentation.meshCoveredGridCells,4);assert(scene.gridTerrains[0].edgeMeshes.length>0);
    const legacy=compileMap(oldHandle,{...fresh.getDocument(),kitRef:oldMap.kitRef});assert.equal(Object.hasOwn(legacy,'gridTerrains'),false);
  });
  await t.test('new brush export reopens with the exact compiled mesh and original PNGs, leaving the old package unchanged',()=>{
    const scene=compileMap(handle,L),output=join(f.parent,'paint-export'),exported=exportScene(handle,L,output),reopened=openSceneExport(output);
    assert.equal(exported.generationCalls,0);assert.equal(reopened.compiled.contentSha256,scene.contentSha256);
    assert.deepEqual(reopened.compiled.gridTerrains,scene.gridTerrains);assert.deepEqual(reopened.compiled.collisionSuggestions,scene.collisionSuggestions);
    assert.equal(hash(exportSceneArchive(handle,L)),hash(exportSceneArchive(reopened.handle,L)));
    assert.equal(verifyTerrainBrushKit(upgradeOptions).status,'verified');
    const receiptFile=join(upgraded,'upgrade.json'),original=readFileSync(receiptFile),body=unseal(JSON.parse(original));
    writeFileSync(receiptFile,jsonBytes(seal({...body,geometryChanged:true})));
    try {fails(()=>verifyTerrainBrushKit(upgradeOptions),'GRID_BRUSH_RECEIPT_REPLAY');}finally {writeFileSync(receiptFile,original);}
    for(const [path,bytes]of contextFor(oldHandle).files)if(path.endsWith('.png'))assert.deepEqual(context.files.get(path),bytes);
  });
  assert.deepEqual(flow.inspectWorkflow(f.workflow),workflowBefore,'brush edits and exports do not invoke image generation or change its evidence');
});
