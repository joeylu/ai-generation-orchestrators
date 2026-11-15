import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {canonicalJson} from '../src/document.mjs';
import {loadSceneKit,readMap,contextFor} from '../src/kit.mjs';
import {compileMap} from '../src/compile.mjs';
import {createEditor} from '../src/editor.mjs';
import {exportSceneArchive,openSceneExport} from '../src/persistence.mjs';
import {buildTerrainEdgeDelivery,verifyTerrainEdgeDelivery} from '../src/terrain-edge-pipeline.mjs';
import {upgradeTerrainBrushKit,verifyTerrainBrushKit} from '../src/grid-terrain-upgrade.mjs';
import {upgradeTerrainEdgeJunctionKit,verifyTerrainEdgeJunctionKit} from '../src/terrain-edge-junction-upgrade.mjs';
import {upgradeTerrainUnionMaterialKit,verifyTerrainUnionMaterialKit} from '../src/terrain-union-material-upgrade.mjs';
import {TERRAIN_UNION_MATERIAL_PROFILE} from '../src/terrain-union-material.mjs';
import {NEAR_OPAQUE_JOIN_PROFILE} from '../src/terrain-edges.mjs';
import {hash,jsonBytes,seal,unseal} from '../src/generation/common.mjs';
import * as flow from '../src/generation/index.mjs';
import {setupTerrainEdgeDelivery} from './helpers/terrain-edge-delivery.mjs';
import {coherentSurfaceObservations} from './helpers/coherent.mjs';

const readJson=path=>JSON.parse(readFileSync(path,'utf8'));
const rejects=(action,code)=>assert.throws(action,error=>error.errors?.some(issue=>issue.code===code));
const kitRef=handle=>({kitId:handle.kitId,revision:handle.revision});
const plainAuthor=document=>{const {kitRef,...author}=document;return author;};
const pngFiles=context=>new Map([...context.files].filter(([path])=>path.endsWith('.png')));

// Return every triangle's interpolated V at the same physical point. Checking
// both sides of a shared edge catches the old per-column phase reset, even
// when topology, coverage counts and the exported mesh are otherwise valid.
function valuesAt(mesh,x,y){
  const values=[];
  for(let i=0;i<mesh.indices.length;i+=3){
    const ids=mesh.indices.slice(i,i+3),[a,b,c]=ids.map(n=>({x:mesh.positions[n*2],y:mesh.positions[n*2+1]})),
      den=(b.y-c.y)*(a.x-c.x)+(c.x-b.x)*(a.y-c.y);
    if(Math.abs(den)<1e-9)continue;
    const w0=((b.y-c.y)*(x-c.x)+(c.x-b.x)*(y-c.y))/den,
      w1=((c.y-a.y)*(x-c.x)+(a.x-c.x)*(y-c.y))/den,w2=1-w0-w1;
    if(Math.min(w0,w1,w2)<-1e-7)continue;
    values.push(ids.reduce((sum,n,j)=>sum+mesh.uvs[n*2+1]*[w0,w1,w2][j],0));
  }
  return values;
}
function sharedDepth(scene,point){
  return [...(scene.gridTerrains??[]),...(scene.curveTerrains??[])].flatMap(patch=>valuesAt(patch.body,...point));
}
const spread=values=>Math.max(...values)-Math.min(...values);

function authorMap(handle){
  const document=readMap(handle),familyId=contextFor(handle).rules.familyId;
  return {...document,format:'ai_scene_document_v6',bounds:{x:0,y:0,width:12,height:9},
    terrainRuns:[1,2].map(y=>({x:4,y,length:3,familyId})).concat([3,4,5,6].map(y=>({x:2,y,length:6,familyId}))),
    instances:[],assemblyInstances:[],inspectionCases:[],terrainConnections:[],instanceTransforms:[],
    curveTerrains:[{curveId:'touching.low.curve',familyId,profile:'sideview-height-curve-v1',baseY:448,
      points:[{x:64,y:320,slope:0},{x:128,y:320,slope:0}]}],
    defaultCamera:{center:{x:384,y:288},viewport:{width:768,height:576},scale:1}};
}

test('explicit union-material revision joins upward grid phases and touching curves while preserving native assets, author physics and old replay',
  {timeout:900000},async t=>{
    const observations=coherentSurfaceObservations();observations.rockFeaturePairs[0].source.toX=160;
    const f=setupTerrainEdgeDelivery(t,{sourceAlpha:252,surfaceObservations:observations}),controls={...structuredClone(f.controls),
      joinProfile:NEAR_OPAQUE_JOIN_PROFILE,materialDensityProfile:'reference-native-2x-v1'};
    for(const side of ['left','right'])for(const part of ['wall','corner'])controls[side][part].inboardBlend={
      fromX:controls[side][part].innerX,toX:side==='left'?264:24};
    const sourceOptions={...f.deliveryOptions,controls,output:join(f.parent,'v3-native')},sourceReport=buildTerrainEdgeDelivery(sourceOptions),
      v3Root=join(sourceOptions.output,'candidate/kit'),v3=loadSceneKit(v3Root),sourceMap=authorMap(v3),
      gridOptions={root:v3Root,document:sourceMap,output:join(f.parent,'v4-grid')},gridReceipt=upgradeTerrainBrushKit(gridOptions),
      v4Root=join(gridOptions.output,'kit'),v4=loadSceneKit(v4Root),v4Map={...sourceMap,kitRef:kitRef(v4)},
      junctionOptions={root:v4Root,document:v4Map,output:join(f.parent,'v5-junction')},junctionReceipt=upgradeTerrainEdgeJunctionKit(junctionOptions),
      v5Root=join(junctionOptions.output,'kit'),v5=loadSceneKit(v5Root),v5Context=contextFor(v5),oldMap={...sourceMap,kitRef:kitRef(v5)},
      oldScene=compileMap(v5,oldMap),oldCompiled=canonicalJson(oldScene),oldKitBytes=readFileSync(join(v5Root,'kit.json')),
      oldJunctionReceipt=readFileSync(join(junctionOptions.output,'upgrade.json')),workflowBefore=flow.inspectWorkflow(f.workflow),
      upgradeOptions={root:v5Root,document:oldMap,output:join(f.parent,'v6-union')},receipt=upgradeTerrainUnionMaterialKit(upgradeOptions),
      root=join(upgradeOptions.output,'kit'),handle=loadSceneKit(root),context=contextFor(handle),document={...oldMap,kitRef:kitRef(handle)},scene=compileMap(handle,document);

    await t.test('the opt-in revision keeps exact original PNGs, author solids, collision and existing native junction calibration',()=>{
      assert.equal(context.kit.terrainEdges.format,'ai_scene_terrain_edges_v6');
      assert.equal(context.kit.terrainEdges.materialProfile,TERRAIN_UNION_MATERIAL_PROFILE);
      assert.deepEqual(context.kit.terrainEdges.junctions,v5Context.kit.terrainEdges.junctions);
      assert.notEqual(handle.bundleSha256,v5.bundleSha256);assert.notDeepEqual(document.kitRef,oldMap.kitRef);
      assert.deepEqual(plainAuthor(document),plainAuthor(oldMap));assert.deepEqual(scene.collisionSuggestions,oldScene.collisionSuggestions);
      assert.deepEqual(scene.counts,oldScene.counts);assert.equal(scene.terrainPresentation.meshCoveredGridCells,30);
      assert.equal(receipt.format,'ai_scene_terrain_union_material_upgrade_v1');assert.equal(receipt.profile,TERRAIN_UNION_MATERIAL_PROFILE);
      assert.equal(receipt.allOriginalPngBytesPreserved,true);assert.equal(receipt.geometryChanged,false);assert.equal(receipt.collisionChanged,false);
      assert.equal(receipt.generationCalls,0);assert.equal(receipt.artAcceptance,'not-assessed');
      assert.equal(receipt.sourceKitSha256,v5.bundleSha256);assert.equal(receipt.compiledSha256,scene.contentSha256);
      const oldPngs=pngFiles(v5Context),newPngs=pngFiles(context);assert.equal(newPngs.size,oldPngs.size);assert.equal(receipt.originalPngs.length,oldPngs.size);
      for(const [path,bytes]of oldPngs){assert.deepEqual(newPngs.get(path),bytes,path);
        assert.deepEqual(receipt.originalPngs.find(item=>item.path===path),{path,sha256:hash(bytes),byteLength:bytes.length});}
    });

    await t.test('one fixed world phase eliminates the reproduced upward-column and curve-grid discontinuities',()=>{
      for(const point of [[256,320],[128,384]]){
        const before=sharedDepth(oldScene,point),after=sharedDepth(scene,point);
        assert(before.length>=2);assert(spread(before)>=.49,`legacy fixture must reproduce different depth origins at ${point}`);
        assert(after.length>=2);assert(spread(after)<2e-6,`one physical point must have one material depth at ${point}`);
      }
      const editor=createEditor(handle,document),before=editor.serialize();
      editor.execute([{type:'paint-cells',familyId:context.rules.familyId,cells:[{x:4,y:0},{x:5,y:0},{x:6,y:0}]}]);
      const extended=editor.getScene(),values=sharedDepth(extended,[256,320]);assert(values.length>=2);assert(spread(values)<2e-6);
      assert.equal(extended.counts.terrainNodes,scene.counts.terrainNodes+3);editor.undo();assert.equal(editor.serialize(),before);
      editor.redo();assert.equal(editor.getScene().contentSha256,extended.contentSha256);
    });

    await t.test('the new export and ZIP reopen with the exact compiled meshes and replayable sealed upgrade receipt',()=>{
      const reopened=openSceneExport(join(upgradeOptions.output,'export'));
      assert.deepEqual(reopened.document,document);assert.deepEqual(reopened.compiled,scene);
      assert.deepEqual(readFileSync(join(upgradeOptions.output,'scene-kit.zip')),exportSceneArchive(handle,document));
      const verified=verifyTerrainUnionMaterialKit(upgradeOptions);assert.equal(verified.status,'verified');assert.equal(verified.receiptSha256,receipt.sha256);
    });

    await t.test('false receipt claims, changed ZIP bytes and non-v5 upgrade sources are rejected without art acceptance',()=>{
      const receiptPath=join(upgradeOptions.output,'upgrade.json'),original=readFileSync(receiptPath);
      writeFileSync(receiptPath,jsonBytes(seal({...unseal(receipt),geometryChanged:true,artAcceptance:'accepted'})));
      try{rejects(()=>verifyTerrainUnionMaterialKit(upgradeOptions),'TERRAIN_UNION_RECEIPT_REPLAY');}finally{writeFileSync(receiptPath,original);}
      const zipPath=join(upgradeOptions.output,'scene-kit.zip'),zip=readFileSync(zipPath),changed=Buffer.from(zip);changed[changed.length-1]^=1;writeFileSync(zipPath,changed);
      try{rejects(()=>verifyTerrainUnionMaterialKit(upgradeOptions),'TERRAIN_UNION_ZIP_REPLAY');}finally{writeFileSync(zipPath,zip);}
      const invalid={root:v4Root,document:v4Map,output:join(f.parent,'invalid-v4-union')};
      rejects(()=>upgradeTerrainUnionMaterialKit(invalid),'TERRAIN_UNION_UPGRADE_SOURCE');assert.equal(existsSync(invalid.output),false);
      rejects(()=>upgradeTerrainUnionMaterialKit({...upgradeOptions,unexpected:true}),'WORKFLOW_SHAPE');
    });

    await t.test('future checked native deliveries can opt in directly while older v3/v4/v5 deliveries still replay unchanged',()=>{
      const directOptions={...f.deliveryOptions,controls:{...controls,gridProfile:'grid-solid-union-native-v1',junctions:{},materialProfile:TERRAIN_UNION_MATERIAL_PROFILE},
        output:join(f.parent,'direct-v6')},directReport=buildTerrainEdgeDelivery(directOptions),direct=loadSceneKit(join(directOptions.output,'candidate/kit')),
        directContext=contextFor(direct),painted=compileMap(direct,{...oldMap,kitRef:kitRef(direct)});
      assert.equal(directContext.kit.terrainEdges.format,'ai_scene_terrain_edges_v6');
      assert.equal(directContext.kit.terrainEdges.materialProfile,TERRAIN_UNION_MATERIAL_PROFILE);assert.equal(directReport.generationCalls,0);
      assert.equal(directReport.finalHumanArtReview,'pending');
      for(const point of [[256,320],[128,384]])assert(spread(sharedDepth(painted,point))<2e-6);
      assert.deepEqual(painted.collisionSuggestions,oldScene.collisionSuggestions);
      for(const [path,bytes]of pngFiles(v5Context))assert.deepEqual(directContext.files.get(path),bytes,path);
      assert.equal(verifyTerrainEdgeDelivery(directOptions).reportSha256,directReport.sha256);
      assert.equal(verifyTerrainEdgeDelivery(sourceOptions).reportSha256,sourceReport.sha256);
      assert.equal(verifyTerrainBrushKit(gridOptions).receiptSha256,gridReceipt.sha256);
      assert.equal(verifyTerrainEdgeJunctionKit(junctionOptions).receiptSha256,junctionReceipt.sha256);
      assert.equal(canonicalJson(compileMap(loadSceneKit(v5Root),oldMap)),oldCompiled);
      assert.deepEqual(readFileSync(join(v5Root,'kit.json')),oldKitBytes);
      assert.deepEqual(readFileSync(join(junctionOptions.output,'upgrade.json')),oldJunctionReceipt);
    });
    assert.deepEqual(flow.inspectWorkflow(f.workflow),workflowBefore,'material upgrade, brush editing and replay never consume image compute');
  });
