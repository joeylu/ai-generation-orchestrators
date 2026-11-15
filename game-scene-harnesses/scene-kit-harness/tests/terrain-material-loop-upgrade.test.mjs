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
import {upgradeTerrainMaterialLoopKit,verifyTerrainMaterialLoopKit} from '../src/terrain-material-loop-upgrade.mjs';
import {TERRAIN_UNION_MATERIAL_PROFILE} from '../src/terrain-union-material.mjs';
import {NEAR_OPAQUE_JOIN_PROFILE} from '../src/terrain-edges.mjs';
import {hash,jsonBytes,seal,unseal} from '../src/generation/common.mjs';
import * as flow from '../src/generation/index.mjs';
import {setupTerrainEdgeDelivery} from './helpers/terrain-edge-delivery.mjs';
import {coherentSurfaceObservations} from './helpers/coherent.mjs';

const read=p=>JSON.parse(readFileSync(p,'utf8')),ratio=v=>v.numerator/v.denominator,
  rejects=(action,code)=>assert.throws(action,error=>error.errors?.some(issue=>issue.code===code)),
  kitRef=handle=>({kitId:handle.kitId,revision:handle.revision}),pngFiles=context=>new Map([...context.files].filter(([path])=>path.endsWith('.png'))),
  plain=document=>{const {kitRef,...author}=document;return author;};

function mapFor(handle){
  const source=readMap(handle),familyId=contextFor(handle).rules.familyId;
  return {...source,format:'ai_scene_document_v6',bounds:{x:0,y:0,width:12,height:9},
    terrainRuns:[{x:4,y:2,length:3,familyId},...[3,4,5,6].map(y=>({x:2,y,length:6,familyId}))],
    instances:[],assemblyInstances:[],inspectionCases:[],terrainConnections:[],instanceTransforms:[],
    curveTerrains:[{curveId:'separate.curve',familyId,profile:'sideview-height-curve-v1',baseY:576,
      points:[{x:576,y:320,slope:0},{x:768,y:320,slope:0}]}],
    defaultCamera:{center:{x:384,y:288},viewport:{width:768,height:576},scale:1}};
}

function physicalBodyJacobian(scene){
  const material=scene.terrainMaterial,expectedX=1010/512,expectedY=506/256;
  for(const patch of [...scene.gridTerrains,...scene.curveTerrains])for(let n=0;n<patch.body.indices.length;n+=3){
    const ids=patch.body.indices.slice(n,n+3),[a,b,c]=ids.map(i=>({x:patch.body.positions[i*2],y:patch.body.positions[i*2+1],u:patch.body.uvs[i*2],v:patch.body.uvs[i*2+1]})),
      det=(b.x-a.x)*(c.y-a.y)-(c.x-a.x)*(b.y-a.y);
    if(Math.abs(det)<1e-7)continue;
    const dUdX=((b.u-a.u)*(c.y-a.y)-(c.u-a.u)*(b.y-a.y))/det,
      dUdY=((b.x-a.x)*(c.u-a.u)-(c.x-a.x)*(b.u-a.u))/det,
      dVdX=((b.v-a.v)*(c.y-a.y)-(c.v-a.v)*(b.y-a.y))/det,
      dVdY=((b.x-a.x)*(c.v-a.v)-(c.x-a.x)*(b.v-a.v))/det;
    assert(Math.abs(material.body.pixelSize.width*dUdX-expectedX)<1e-8);
    assert(Math.abs(material.body.pixelSize.height*dVdY-expectedY)<1e-8);
    assert(Math.abs(dUdY)<1e-10);assert(Math.abs(dVdX)<1e-10);
  }
}

test('explicit material loop adds a replayable derived body while preserving the checked v6 kit and native world scale',
  {timeout:900000},async t=>{
    const observations=coherentSurfaceObservations();observations.rockFeaturePairs[0].source.toX=160;
    const f=setupTerrainEdgeDelivery(t,{sourceAlpha:252,surfaceObservations:observations}),controls={...structuredClone(f.controls),
      joinProfile:NEAR_OPAQUE_JOIN_PROFILE,materialDensityProfile:'reference-native-2x-v1',gridProfile:'grid-solid-union-native-v1',junctions:{},materialProfile:TERRAIN_UNION_MATERIAL_PROFILE};
    for(const side of ['left','right'])for(const part of ['wall','corner'])controls[side][part].inboardBlend={
      fromX:controls[side][part].innerX,toX:side==='left'?264:24};
    const sourceOptions={...f.deliveryOptions,controls,output:join(f.parent,'source-v6')},sourceReport=buildTerrainEdgeDelivery(sourceOptions),
      sourceRoot=join(sourceOptions.output,'candidate/kit'),oldHandle=loadSceneKit(sourceRoot),oldContext=contextFor(oldHandle),oldMap=mapFor(oldHandle),
      oldScene=compileMap(oldHandle,oldMap),oldCompiled=canonicalJson(oldScene),oldKitBytes=readFileSync(join(sourceRoot,'kit.json')),
      workflowBefore=flow.inspectWorkflow(f.workflow),loopOptions={usableRows:384,overlapRows:96,phaseCount:3},
      options={root:sourceRoot,document:oldMap,output:join(f.parent,'material-loop'),loopOptions},receipt=upgradeTerrainMaterialLoopKit(options),
      root=join(options.output,'kit'),handle=loadSceneKit(root),context=contextFor(handle),document={...oldMap,kitRef:kitRef(handle)},scene=compileMap(handle,document),
      loop=context.kit.terrainMaterialLoop;

    await t.test('all checked original PNGs and original appearance remain unchanged while exactly one body asset is added',()=>{
      assert.notEqual(handle.bundleSha256,oldHandle.bundleSha256);assert.notDeepEqual(document.kitRef,oldMap.kitRef);
      assert.deepEqual(context.kit.terrainAppearance,oldContext.kit.terrainAppearance);
      assert.deepEqual(context.kit.terrainEdges,oldContext.kit.terrainEdges);
      assert.deepEqual(plain(document),plain(oldMap));assert.deepEqual(scene.collisionSuggestions,oldScene.collisionSuggestions);assert.deepEqual(scene.counts,oldScene.counts);
      const before=pngFiles(oldContext),after=pngFiles(context);assert.equal(after.size,before.size+1);
      for(const [path,bytes]of before)assert.deepEqual(after.get(path),bytes,path);
      assert.equal(receipt.originalPngs.length,before.size);assert.equal(receipt.addedPngFiles,1);assert.equal(receipt.allOriginalPngBytesPreserved,true);
      assert.equal(receipt.format,'ai_scene_terrain_material_loop_upgrade_v1');assert.equal(receipt.generationCalls,0);assert.equal(receipt.artAcceptance,'not-assessed');
      assert.equal(receipt.geometryChanged,false);assert.equal(receipt.collisionChanged,false);assert.equal(receipt.materialLoopSha256,loop.sha256);
      assert.deepEqual(receipt.derivedBody,loop.output);assert.equal(loop.output.source.path,'materials/body-loop.png');
      assert.equal(hash(context.files.get(loop.output.source.path)),loop.output.source.sha256);
    });

    await t.test('effective material uses the derived PNG with a rational period preserving source pixels per world unit on grid and separate curves',()=>{
      assert.equal(scene.terrainMaterial.body.source.sha256,loop.output.source.sha256);
      assert.deepEqual(scene.terrainMaterial.cap,oldScene.terrainMaterial.cap);
      assert.notEqual(scene.terrainMaterial.body.source.sha256,oldScene.terrainMaterial.body.source.sha256);
      assert(Math.abs(loop.output.pixelSize.width/ratio(loop.bodyPeriod.width)-1010/512)<1e-12);
      assert(Math.abs(loop.output.pixelSize.height/ratio(loop.bodyPeriod.height)-506/256)<1e-12);
      physicalBodyJacobian(scene);
      const editor=createEditor(handle,document),initial=editor.serialize();
      editor.execute([{type:'paint-cells',familyId:context.rules.familyId,cells:[{x:4,y:1},{x:5,y:1},{x:6,y:1}]}]);
      const raised=editor.getScene();assert.equal(raised.counts.terrainNodes,scene.counts.terrainNodes+3);physicalBodyJacobian(raised);
      editor.undo();assert.equal(editor.serialize(),initial);editor.redo();assert.equal(editor.getScene().contentSha256,raised.contentSha256);
    });

    await t.test('export, ZIP, standalone loop evidence and receipt all replay from original source bytes',()=>{
      const opened=openSceneExport(join(options.output,'export'));assert.deepEqual(opened.document,document);assert.deepEqual(opened.compiled,scene);
      assert.deepEqual(readFileSync(join(options.output,'scene-kit.zip')),exportSceneArchive(handle,document));
      assert.deepEqual(read(join(options.output,'material-loop.json')),loop);
      const verification=verifyTerrainMaterialLoopKit(options);assert.equal(verification.status,'verified');assert.equal(verification.receiptSha256,receipt.sha256);
      assert.equal(verification.materialLoopSha256,loop.sha256);
    });

    await t.test('re-sealed false receipt, changed ZIP or standalone loop evidence cannot pass replay',()=>{
      const receiptPath=join(options.output,'upgrade.json'),saved=readFileSync(receiptPath);
      writeFileSync(receiptPath,jsonBytes(seal({...unseal(receipt),addedPngFiles:0,artAcceptance:'accepted'})));
      try{rejects(()=>verifyTerrainMaterialLoopKit(options),'TERRAIN_MATERIAL_LOOP_RECEIPT_REPLAY');}finally{writeFileSync(receiptPath,saved);}
      const loopPath=join(options.output,'material-loop.json'),savedLoop=readFileSync(loopPath);writeFileSync(loopPath,jsonBytes({...loop,sha256:'a'.repeat(64)}));
      try{rejects(()=>verifyTerrainMaterialLoopKit(options),'TERRAIN_MATERIAL_LOOP_RECORD_REPLAY');}finally{writeFileSync(loopPath,savedLoop);}
      const zipPath=join(options.output,'scene-kit.zip'),zip=readFileSync(zipPath),changed=Buffer.from(zip);changed[changed.length-1]^=1;writeFileSync(zipPath,changed);
      try{rejects(()=>verifyTerrainMaterialLoopKit(options),'TERRAIN_MATERIAL_LOOP_ZIP_REPLAY');}finally{writeFileSync(zipPath,zip);}
    });

    await t.test('a second implicit loop, undeclared controls or changed usable rows are rejected and original v6 still replays',()=>{
      const repeated={...options,root,document,output:join(f.parent,'loop-again')};
      rejects(()=>upgradeTerrainMaterialLoopKit(repeated),'TERRAIN_MATERIAL_LOOP_UPGRADE_SOURCE');assert.equal(existsSync(repeated.output),false);
      rejects(()=>upgradeTerrainMaterialLoopKit({...options,loopOptions:{...loopOptions,unknown:1}}),'WORKFLOW_SHAPE');
      assert.throws(()=>verifyTerrainMaterialLoopKit({...options,loopOptions:{...loopOptions,usableRows:385}}));
      assert.equal(canonicalJson(compileMap(loadSceneKit(sourceRoot),oldMap)),oldCompiled);assert.deepEqual(readFileSync(join(sourceRoot,'kit.json')),oldKitBytes);
      assert.equal(verifyTerrainEdgeDelivery(sourceOptions).reportSha256,sourceReport.sha256);
    });
    assert.deepEqual(flow.inspectWorkflow(f.workflow),workflowBefore,'loop derivation and brush edits never consume image compute');
  });
