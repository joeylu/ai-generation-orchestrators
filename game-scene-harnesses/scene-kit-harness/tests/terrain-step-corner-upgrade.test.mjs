import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {canonicalJson,canonicalMap} from '../src/document.mjs';
import {loadSceneKit,readMap,contextFor} from '../src/kit.mjs';
import {compileMap} from '../src/compile.mjs';
import {createEditor} from '../src/editor.mjs';
import {exportSceneArchive,openSceneExport} from '../src/persistence.mjs';
import {buildTerrainEdgeDelivery,verifyTerrainEdgeDelivery} from '../src/terrain-edge-pipeline.mjs';
import {upgradeTerrainStepCornerKit,verifyTerrainStepCornerKit} from '../src/terrain-step-corner-upgrade.mjs';
import {TERRAIN_UNION_MATERIAL_PROFILE} from '../src/terrain-union-material.mjs';
import {NEAR_OPAQUE_JOIN_PROFILE} from '../src/terrain-edges.mjs';
import {hash,jsonBytes,seal,unseal} from '../src/generation/common.mjs';
import * as flow from '../src/generation/index.mjs';
import {setupTerrainEdgeDelivery} from './helpers/terrain-edge-delivery.mjs';
import {coherentSurfaceObservations} from './helpers/coherent.mjs';

const read=p=>JSON.parse(readFileSync(p,'utf8')),
  rejects=(action,code)=>assert.throws(action,error=>error.errors?.some(issue=>issue.code===code)),
  kitRef=handle=>({kitId:handle.kitId,revision:handle.revision}),
  plain=document=>{const {kitRef,...author}=document;return author;},
  pngFiles=context=>new Map([...context.files].filter(([path])=>path.endsWith('.png')));
function staircaseMap(handle){
  const source=readMap(handle),familyId=contextFor(handle).rules.familyId;
  return canonicalMap({...source,format:'ai_scene_document_v6',bounds:{x:0,y:0,width:12,height:9},
    terrainRuns:[{x:4,y:2,length:3,familyId},...[3,4,5,6].map(y=>({x:2,y,length:8,familyId}))],
    instances:[],assemblyInstances:[],inspectionCases:[],terrainConnections:[],instanceTransforms:[],curveTerrains:[],
    defaultCamera:{center:{x:384,y:288},viewport:{width:768,height:576},scale:1}});
}

test('explicit concave step-corner upgrade preserves source PNGs, author topology and replayable exports',
  {timeout:900000},async t=>{
    const observations=coherentSurfaceObservations();observations.rockFeaturePairs[0].source.toX=160;
    const f=setupTerrainEdgeDelivery(t,{sourceAlpha:252,surfaceObservations:observations}),controls={...structuredClone(f.controls),
      joinProfile:NEAR_OPAQUE_JOIN_PROFILE,materialDensityProfile:'reference-native-2x-v1',gridProfile:'grid-solid-union-native-v1',
      junctions:{},materialProfile:TERRAIN_UNION_MATERIAL_PROFILE,materialLoop:{overlapRows:64,phaseCount:3}};
    for(const side of ['left','right'])for(const part of ['wall','corner'])controls[side][part].inboardBlend={
      fromX:controls[side][part].innerX,toX:side==='left'?264:24};
    const sourceOptions={...f.deliveryOptions,controls,output:join(f.parent,'source-v6-loop')},sourceReport=buildTerrainEdgeDelivery(sourceOptions),
      sourceRoot=join(sourceOptions.output,'candidate/kit'),oldHandle=loadSceneKit(sourceRoot),oldContext=contextFor(oldHandle),oldMap=staircaseMap(oldHandle),
      oldScene=compileMap(oldHandle,oldMap),oldCompiled=canonicalJson(oldScene),oldKitBytes=readFileSync(join(sourceRoot,'kit.json')),
      workflowBefore=flow.inspectWorkflow(f.workflow),cornerOptions={widthWorld:32,heightWorld:18},
      options={root:sourceRoot,document:oldMap,output:join(f.parent,'step-corners'),cornerOptions},receipt=upgradeTerrainStepCornerKit(options),
      root=join(options.output,'kit'),handle=loadSceneKit(root),context=contextFor(handle),document=canonicalMap({...oldMap,kitRef:kitRef(handle)}),
      scene=compileMap(handle,document),config=context.kit.terrainStepCorners;

    await t.test('only the explicit corner configuration and kit references change; all original PNGs stay byte-identical',()=>{
      assert.notEqual(handle.bundleSha256,oldHandle.bundleSha256);assert.deepEqual(plain(document),plain(oldMap));
      assert.deepEqual(config,{format:'ai_scene_terrain_step_corners_v1',profile:'concave-source-surface-ramp-v1',widthWorld:32,heightWorld:18,segments:16});
      assert.deepEqual(context.kit.terrainAppearance,oldContext.kit.terrainAppearance);
      assert.deepEqual(context.kit.terrainEdges,oldContext.kit.terrainEdges);assert.deepEqual(context.kit.terrainMaterialLoop,oldContext.kit.terrainMaterialLoop);
      const before=pngFiles(oldContext),after=pngFiles(context);assert.equal(after.size,before.size);
      for(const [path,bytes]of before)assert.deepEqual(after.get(path),bytes,path);
      assert.equal(receipt.originalPngs.length,before.size);assert.equal(receipt.addedPngFiles,0);assert.equal(receipt.allOriginalPngBytesPreserved,true);
      assert.equal(receipt.stepCornersSha256,hash(canonicalJson(config)));assert.deepEqual(receipt.cornerConfiguration,config);
      assert.equal(receipt.generationCalls,0);assert.equal(receipt.artAcceptance,'not-assessed');
    });

    await t.test('source-bound corner presentation keeps logical cells and collision identical while ordinary brush history recompiles exactly',()=>{
      assert.deepEqual(scene.counts,oldScene.counts);assert.deepEqual(scene.collisionSuggestions,oldScene.collisionSuggestions);
      assert.equal(receipt.authorGeometryChanged,false);assert.equal(receipt.visualBoundaryChanged,true);assert.equal(receipt.collisionChanged,false);
      assert.deepEqual(scene.terrainStepCorners.profile,config);assert.equal(scene.terrainStepCorners.authorGeometryChanged,false);
      assert.equal(scene.terrainStepCorners.sourcePngChanged,false);assert(Array.isArray(scene.terrainStepCorners.placed));
      const editor=createEditor(handle,document),initial=editor.serialize();
      editor.execute([{type:'paint-cells',familyId:context.rules.familyId,cells:[{x:4,y:1},{x:5,y:1},{x:6,y:1}]}]);
      const raised=editor.getScene();assert.equal(raised.counts.terrainNodes,scene.counts.terrainNodes+3);
      editor.undo();assert.equal(editor.serialize(),initial);editor.redo();assert.equal(editor.getScene().contentSha256,raised.contentSha256);
      editor.execute([{type:'erase-cells',cells:[{x:3,y:3}]}]);const erased=editor.getScene();assert.equal(erased.counts.terrainNodes,raised.counts.terrainNodes-1);
      editor.undo();assert.equal(editor.getScene().contentSha256,raised.contentSha256);
    });

    await t.test('new author export, ZIP and standalone configuration reopen with the exact compiled result',()=>{
      const opened=openSceneExport(join(options.output,'export'));assert.deepEqual(opened.document,document);assert.deepEqual(opened.compiled,scene);
      assert.deepEqual(readFileSync(join(options.output,'scene-kit.zip')),exportSceneArchive(handle,document));
      assert.deepEqual(read(join(options.output,'step-corners.json')),config);
      const verification=verifyTerrainStepCornerKit(options);assert.equal(verification.status,'verified');assert.equal(verification.receiptSha256,receipt.sha256);
      assert.equal(verification.stepCornersSha256,receipt.stepCornersSha256);
    });

    await t.test('re-sealed false receipts, changed standalone configuration and ZIP bytes fail deterministic replay',()=>{
      const receiptPath=join(options.output,'upgrade.json'),saved=readFileSync(receiptPath);
      writeFileSync(receiptPath,jsonBytes(seal({...unseal(receipt),allOriginalPngBytesPreserved:false,artAcceptance:'accepted'})));
      try{rejects(()=>verifyTerrainStepCornerKit(options),'TERRAIN_STEP_CORNER_RECEIPT_REPLAY');}finally{writeFileSync(receiptPath,saved);}
      const configPath=join(options.output,'step-corners.json'),savedConfig=readFileSync(configPath);
      writeFileSync(configPath,jsonBytes({...config,heightWorld:12}));
      try{rejects(()=>verifyTerrainStepCornerKit(options),'TERRAIN_STEP_CORNER_CONFIG_REPLAY');}finally{writeFileSync(configPath,savedConfig);}
      const zipPath=join(options.output,'scene-kit.zip'),zip=readFileSync(zipPath),changed=Buffer.from(zip);changed[changed.length-1]^=1;writeFileSync(zipPath,changed);
      try{rejects(()=>verifyTerrainStepCornerKit(options),'TERRAIN_STEP_CORNER_ZIP_REPLAY');}finally{writeFileSync(zipPath,zip);}
    });

    await t.test('unbounded ramps, unknown options and implicit second upgrades are refused while the old kit and workflow remain untouched',()=>{
      for(const cornerOptions of [{widthWorld:7,heightWorld:4},{widthWorld:49,heightWorld:18},{widthWorld:16,heightWorld:13},{widthWorld:32,heightWorld:25},{widthWorld:32,heightWorld:NaN}]){
        const output=join(f.parent,'invalid-corner-'+String(cornerOptions.widthWorld)+'-'+String(cornerOptions.heightWorld));
        rejects(()=>upgradeTerrainStepCornerKit({...options,cornerOptions,output}),'STEP_CORNER_PROFILE');assert.equal(existsSync(output),false);
      }
      rejects(()=>upgradeTerrainStepCornerKit({...options,cornerOptions:{...cornerOptions,unknown:true}}),'WORKFLOW_SHAPE');
      const repeated={...options,root,document,output:join(f.parent,'second-step-upgrade')};
      rejects(()=>upgradeTerrainStepCornerKit(repeated),'TERRAIN_STEP_CORNER_UPGRADE_SOURCE');assert.equal(existsSync(repeated.output),false);
      assert.throws(()=>verifyTerrainStepCornerKit({...options,cornerOptions:{widthWorld:32,heightWorld:16}}));
      assert.equal(canonicalJson(compileMap(loadSceneKit(sourceRoot),oldMap)),oldCompiled);assert.deepEqual(readFileSync(join(sourceRoot,'kit.json')),oldKitBytes);
      assert.equal(verifyTerrainEdgeDelivery(sourceOptions).reportSha256,sourceReport.sha256);assert.deepEqual(flow.inspectWorkflow(f.workflow),workflowBefore);
    });

    await t.test('a future source delivery can opt into bounded step corners without a per-map asset patch',()=>{
      const {materialLoop,...withoutLoop}=controls,
        directOptions={...sourceOptions,controls:{...withoutLoop,stepCorners:cornerOptions},output:join(f.parent,'direct-step-corners')},
        directReport=buildTerrainEdgeDelivery(directOptions),direct=loadSceneKit(join(directOptions.output,'candidate/kit')),
        directContext=contextFor(direct),initial=compileMap(direct,readMap(direct));
      assert.deepEqual(directContext.kit.terrainStepCorners,config);assert.equal(directReport.generationCalls,0);
      assert.deepEqual(initial.terrainStepCorners.profile,config);assert.equal(initial.terrainStepCorners.sourcePngChanged,false);
      assert.equal(directContext.kit.terrainMaterialLoop,undefined,'step corners also work without the optional body loop');
      assert.equal(pngFiles(directContext).size,pngFiles(oldContext).size-1);
      for(const [path,bytes]of pngFiles(directContext))assert.deepEqual(oldContext.files.get(path),bytes,path);
      assert.equal(verifyTerrainEdgeDelivery(directOptions).reportSha256,directReport.sha256);
      assert.deepEqual(flow.inspectWorkflow(f.workflow),workflowBefore);
    });
  });
