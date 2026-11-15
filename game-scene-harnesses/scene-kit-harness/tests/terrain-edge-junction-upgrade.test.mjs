import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {canonicalJson} from '../src/document.mjs';
import {loadSceneKit,readMap,contextFor} from '../src/kit.mjs';
import {compileMap} from '../src/compile.mjs';
import {exportSceneArchive,openSceneExport} from '../src/persistence.mjs';
import {buildTerrainEdgeDelivery,verifyTerrainEdgeDelivery} from '../src/terrain-edge-pipeline.mjs';
import {upgradeTerrainBrushKit,verifyTerrainBrushKit} from '../src/grid-terrain-upgrade.mjs';
import {upgradeTerrainEdgeJunctionKit,verifyTerrainEdgeJunctionKit} from '../src/terrain-edge-junction-upgrade.mjs';
import {TERRAIN_JUNCTION_PROFILE} from '../src/terrain-edge-junction.mjs';
import {NEAR_OPAQUE_JOIN_PROFILE} from '../src/terrain-edges.mjs';
import {hash,jsonBytes,seal,unseal} from '../src/generation/common.mjs';
import * as flow from '../src/generation/index.mjs';
import {setupTerrainEdgeDelivery} from './helpers/terrain-edge-delivery.mjs';
import {coherentSurfaceObservations} from './helpers/coherent.mjs';

const readJson=path=>JSON.parse(readFileSync(path,'utf8'));
const rejects=(action,code)=>assert.throws(action,error=>error.errors?.some(issue=>issue.code===code));
const withoutKitRef=document=>{const {kitRef,...author}=document;return author;};
const kitRef=handle=>({kitId:handle.kitId,revision:handle.revision});
const pngInventory=context=>new Map([...context.files].filter(([path])=>path.endsWith('.png')));

function authoredMap(handle){
  const map=readMap(handle);
  return {...map,format:'ai_scene_document_v6',bounds:{x:0,y:0,width:12,height:8},
    terrainRuns:[{x:2,y:2,length:2,familyId:contextFor(handle).rules.familyId},{x:2,y:3,length:2,familyId:contextFor(handle).rules.familyId}],
    instances:[],assemblyInstances:[],terrainConnections:[],inspectionCases:[],instanceTransforms:[],
    curveTerrains:[{curveId:'junction.curve',familyId:contextFor(handle).rules.familyId,profile:'sideview-height-curve-v1',baseY:320,
      points:[{x:384,y:128,slope:0},{x:640,y:128,slope:0}]}],
    defaultCamera:{center:{x:384,y:256},viewport:{width:768,height:512},scale:1}};
}

// A complete synthetic source batch supplies every artifact. These tests never
// load a real project, invoke an image adapter, or generate new native artwork.
test('explicit v4 to v5 native-junction upgrade preserves source bytes and author physics, replays exports, and leaves old deliveries intact',
  {timeout:600000},async t=>{
    const observations=coherentSurfaceObservations();observations.rockFeaturePairs[0].source.toX=160;
    const f=setupTerrainEdgeDelivery(t,{sourceAlpha:252,surfaceObservations:observations}),controls={...structuredClone(f.controls),
      joinProfile:NEAR_OPAQUE_JOIN_PROFILE,materialDensityProfile:'reference-native-2x-v1'};
    for(const side of ['left','right'])for(const part of ['wall','corner'])controls[side][part].inboardBlend={
      fromX:controls[side][part].innerX,toX:side==='left'?264:24};
    const sourceOptions={...f.deliveryOptions,controls,output:join(f.parent,'v3-native-delivery')},v3Report=buildTerrainEdgeDelivery(sourceOptions),
      v3=loadSceneKit(join(sourceOptions.output,'candidate/kit')),v3Context=contextFor(v3),sourceMap=authoredMap(v3),
      brushOptions={root:join(sourceOptions.output,'candidate/kit'),document:sourceMap,output:join(f.parent,'v4-brush-upgrade')},
      brushReceipt=upgradeTerrainBrushKit(brushOptions),v4Root=join(brushOptions.output,'kit'),v4=loadSceneKit(v4Root),v4Context=contextFor(v4),
      oldMap={...sourceMap,kitRef:kitRef(v4)},oldScene=compileMap(v4,oldMap),oldCompiled=canonicalJson(oldScene),
      oldKitBytes=readFileSync(join(v4Root,'kit.json')),oldBrushReceiptBytes=readFileSync(join(brushOptions.output,'upgrade.json')),
      workflowBefore=flow.inspectWorkflow(f.workflow),upgradeOptions={root:v4Root,document:oldMap,output:join(f.parent,'v5-junction-upgrade'),junctionOptions:{}},
      receipt=upgradeTerrainEdgeJunctionKit(upgradeOptions),handle=loadSceneKit(join(upgradeOptions.output,'kit')),context=contextFor(handle),
      document={...oldMap,kitRef:kitRef(handle)},scene=compileMap(handle,document),junctions=context.kit.terrainEdges.junctions;

    await t.test('default options explicitly freeze the legacy mapped wall origin and repeat period in a new immutable kit',()=>{
      assert.equal(v3Context.kit.terrainEdges.format,'ai_scene_terrain_edges_v3');
      assert.equal(v4Context.kit.terrainEdges.format,'ai_scene_terrain_edges_v4');
      assert.equal(context.kit.terrainEdges.format,'ai_scene_terrain_edges_v5');
      assert.equal(context.kit.terrainEdges.gridProfile,'grid-solid-union-native-v1');
      assert.equal(junctions.profile,TERRAIN_JUNCTION_PROFILE);assert.equal(junctions.coverage,'native-alpha-source-over-overlap');
      assert.equal(junctions.sourcePngChanged,false);assert.equal(junctions.visualAcceptance,'not-assessed');
      for(const side of ['left','right']){
        const {wall,corner}=v4Context.kit.terrainEdges[side],cs=corner.scale.numerator/corner.scale.denominator,ws=wall.scale.numerator/wall.scale.denominator;
        assert.equal(junctions[side].cornerWall.firstWallNativeOriginWorld,(corner.wallStartY-corner.surfaceY)*cs-wall.repeatY.from*ws);
        assert.equal(junctions[side].wallRepeat.stepWorld,(wall.repeatY.to-wall.repeatY.from)*ws);
        assert.equal(junctions[side].cornerWall.nativeFromY,0);assert.equal(junctions[side].cornerWall.nativeToY,corner.pixelSize.height);
        assert.equal(junctions[side].wallRepeat.nativeFromY,0);assert.equal(junctions[side].wallRepeat.nativeToY,wall.pixelSize.height);
        assert.equal(junctions[side].cornerWall.drawOrder,'complete-corner-after-walls');
        assert.equal(junctions[side].wallRepeat.drawOrder,'lower-walls-before-upper-walls');
      }
      assert.notEqual(handle.bundleSha256,v4.bundleSha256);assert.notDeepEqual(document.kitRef,oldMap.kitRef);
      assert.equal(receipt.format,'ai_scene_terrain_edge_junction_upgrade_v1');assert.equal(receipt.generationCalls,0);
      assert.equal(receipt.geometryChanged,false);assert.equal(receipt.collisionChanged,false);assert.equal(receipt.artAcceptance,'not-assessed');
      assert.equal(receipt.allOriginalPngBytesPreserved,true);assert.equal(receipt.sourceKitSha256,v4.bundleSha256);
      assert.equal(receipt.junctionsSha256,junctions.sha256);assert.equal(receipt.compiledSha256,scene.contentSha256);
      assert.deepEqual(readJson(join(upgradeOptions.output,'junctions.json')),junctions);
    });

    await t.test('only the author kit reference changes while curve and painted-grid physics and all source PNGs survive',()=>{
      assert.deepEqual(withoutKitRef(document),withoutKitRef(oldMap));
      assert.deepEqual(scene.collisionSuggestions,oldScene.collisionSuggestions);
      assert(scene.gridTerrains[0].edgeMeshes.length>0);assert(scene.curveTerrains[0].edgeMeshes.length>0);
      assert.equal(scene.terrainPresentation.meshCoveredGridCells,4);
      const oldPngs=pngInventory(v4Context),newPngs=pngInventory(context);
      assert.equal(newPngs.size,oldPngs.size);assert.equal(receipt.originalPngs.length,oldPngs.size);
      for(const [path,bytes]of oldPngs){
        assert.deepEqual(newPngs.get(path),bytes,path);
        const evidence=receipt.originalPngs.find(item=>item.path===path);
        assert.deepEqual(evidence,{path,sha256:hash(bytes),byteLength:bytes.length});
      }
      for(const [path,bytes]of pngInventory(v3Context))assert.deepEqual(newPngs.get(path),bytes,path);
    });

    await t.test('the upgraded export and ZIP reopen deterministically and omitted options mean the same default as an empty object',()=>{
      const reopened=openSceneExport(join(upgradeOptions.output,'export'));
      assert.deepEqual(reopened.document,document);assert.deepEqual(reopened.compiled,scene);
      const zip=readFileSync(join(upgradeOptions.output,'scene-kit.zip'));
      assert.deepEqual(zip,exportSceneArchive(handle,document));
      const {junctionOptions,...omitted}=upgradeOptions;
      const verified=verifyTerrainEdgeJunctionKit(omitted);
      assert.equal(verified.status,'verified');assert.equal(verified.receiptSha256,receipt.sha256);
    });

    await t.test('resealing a false receipt cannot certify changed geometry or grant art acceptance',()=>{
      const receiptPath=join(upgradeOptions.output,'upgrade.json'),originalReceipt=readFileSync(receiptPath);
      writeFileSync(receiptPath,jsonBytes(seal({...unseal(receipt),geometryChanged:true,artAcceptance:'accepted'})));
      try{rejects(()=>verifyTerrainEdgeJunctionKit(upgradeOptions),'TERRAIN_JUNCTION_RECEIPT_REPLAY');}
      finally{writeFileSync(receiptPath,originalReceipt);}
      assert.deepEqual(readFileSync(receiptPath),originalReceipt);
      const invalid={root:join(sourceOptions.output,'candidate/kit'),document:sourceMap,output:join(f.parent,'invalid-v3-junction')};
      rejects(()=>upgradeTerrainEdgeJunctionKit(invalid),'TERRAIN_JUNCTION_UPGRADE_SOURCE');assert.equal(existsSync(invalid.output),false);
    });

    await t.test('future native deliveries can opt in through controls without changing older v3 or v4 replay',()=>{
      const directOptions={...f.deliveryOptions,controls:{...controls,gridProfile:'grid-solid-union-native-v1',junctions:{}},output:join(f.parent,'direct-v5-delivery')},
        report=buildTerrainEdgeDelivery(directOptions),direct=loadSceneKit(join(directOptions.output,'candidate/kit')),directContext=contextFor(direct),
        initial=compileMap(direct,readMap(direct)),painted=compileMap(direct,{...oldMap,kitRef:kitRef(direct)});
      assert.equal(directContext.kit.terrainEdges.format,'ai_scene_terrain_edges_v5');
      assert.deepEqual(directContext.kit.terrainEdges.junctions,junctions);assert.equal(report.generationCalls,0);
      assert.equal(report.finalHumanArtReview,'pending');assert.equal(readJson(join(directOptions.output,'candidate/readiness.json')).edgeJunctions.artAcceptance,'not-assessed');
      assert(initial.terrainSkins.length>0);assert.equal(Object.hasOwn(initial,'gridTerrains'),false,'fixed platform skins retain their own source artwork');
      assert.equal(painted.terrainPresentation.meshCoveredGridCells,4);assert(painted.gridTerrains[0].edgeMeshes.length>0);
      assert.deepEqual(painted.collisionSuggestions,oldScene.collisionSuggestions);
      for(const [path,bytes]of pngInventory(v4Context))assert.deepEqual(directContext.files.get(path),bytes,path);
      assert.equal(verifyTerrainEdgeDelivery(directOptions).reportSha256,report.sha256);
      assert.equal(verifyTerrainEdgeDelivery(sourceOptions).reportSha256,v3Report.sha256);
      assert.equal(verifyTerrainBrushKit(brushOptions).receiptSha256,brushReceipt.sha256);
      assert.equal(canonicalJson(compileMap(loadSceneKit(v4Root),oldMap)),oldCompiled);
      assert.deepEqual(readFileSync(join(v4Root,'kit.json')),oldKitBytes);
      assert.deepEqual(readFileSync(join(brushOptions.output,'upgrade.json')),oldBrushReceiptBytes);
    });
    assert.deepEqual(flow.inspectWorkflow(f.workflow),workflowBefore,'deterministic upgrade and delivery never reserve or consume image compute');
  });
