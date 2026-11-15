import test from 'node:test';
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {readFileSync,existsSync} from 'node:fs';
import {setupTerrainEdgeDelivery} from './helpers/terrain-edge-delivery.mjs';
import {buildTerrainEdgeDelivery} from '../src/terrain-edge-pipeline.mjs';
import {loadSceneKit,contextFor,readMap} from '../src/kit.mjs';
import {compileMap} from '../src/compile.mjs';
import {createEditor} from '../src/editor.mjs';
import {createSharedTerrainFieldProfile,SHARED_TERRAIN_UNION_PROFILE} from '../src/shared-terrain-field.mjs';
import {prepareSharedTerrainLoop,upgradeSharedTerrainFieldKit,verifySharedTerrainFieldKit} from '../src/shared-terrain-upgrade.mjs';
import {resolveTerrainMaterialAppearance} from '../src/terrain-loop-material.mjs';
import {validateDocument} from '../src/schema.mjs';
import {hash} from '../src/generation/common.mjs';
import {coherentSurfaceObservations} from './helpers/coherent.mjs';
test('explicit shared-field kit preserves sources, collision, undo/redo and portable replay',{timeout:240000},t=>{
  const observations=coherentSurfaceObservations();observations.rockFeaturePairs[0].source.toX=160;
  const f=setupTerrainEdgeDelivery(t,{surfaceObservations:observations}),controls={...f.controls,materialDensityProfile:'reference-native-2x-v1'},delivery={...f.deliveryOptions,controls};
  buildTerrainEdgeDelivery(delivery);const root=join(delivery.output,'candidate/kit'),h=loadSceneKit(root),ctx=contextFor(h),appearance=ctx.kit.terrainAppearance,
    document={...readMap(h),format:'ai_scene_document_v6',bounds:{x:0,y:0,width:12,height:9},curveTerrains:[],terrainConnections:[],instances:[],assemblyInstances:[],instanceTransforms:[],inspectionCases:[],terrainRuns:[{x:1,y:1,length:2,familyId:ctx.rules.familyId},{x:1,y:2,length:1,familyId:ctx.rules.familyId}]},
    profile=createSharedTerrainFieldProfile(appearance,{outline:{maximumInsetWorld:12,sampleStepWorld:8,wavelengthWorld:64,seed:731},surfaceInterface:{profile:'world-body-native-lip-v1',capSourceSha256:appearance.cap.source.sha256,capEndRow:24,fadeRows:8},lighting:{bandWorld:6,fadeBands:4,leftShade:.95,rightShade:.72,bottomShade:.64}}),options={root,document,profile,output:join(f.parent,'shared-field')},sourceSha=hash(readFileSync(join(root,'kit.json')));
  assert.deepEqual(validateDocument(profile.format,profile),[]);const result=upgradeSharedTerrainFieldKit(options),next=loadSceneKit(join(options.output,'kit')),doc=readMap(next),scene=compileMap(next,doc);
  assert.equal(result.productionKit,false);assert.equal(result.generationCalls,0);assert.equal(scene.terrainSharedField.profileSha256,profile.sha256);assert.equal(scene.terrainEdges,undefined);
  assert.deepEqual(scene.collisionSuggestions,compileMap(h,document).collisionSuggestions);assert.equal(hash(readFileSync(join(root,'kit.json'))),sourceSha);
  for(const p of result.originalPngs)assert.equal(hash(readFileSync(join(options.output,'kit',p.path))),p.sha256);
  assert.equal(verifySharedTerrainFieldKit(options).reportSha256,result.sha256);
  const editor=createEditor(next,doc),before=editor.getScene().contentSha256;
  editor.execute([{type:'paint-cells',cells:[{x:4,y:2}],familyId:ctx.rules.familyId}]);const painted=editor.getScene().contentSha256;assert.notEqual(before,painted);
  editor.undo();assert.equal(editor.getScene().contentSha256,before);editor.redo();assert.equal(editor.getScene().contentSha256,painted);
  const bad={...options,profile:{...profile,sha256:'a'.repeat(64)},output:join(f.parent,'bad-profile')};assert.throws(()=>upgradeSharedTerrainFieldKit(bad));assert.equal(existsSync(bad.output),false);
  const curveDoc={...document,curveTerrains:[{curveId:'curve.delivery',profile:'sideview-height-curve-v1',familyId:ctx.rules.familyId,points:[{x:256,y:64,slope:0},{x:384,y:64,slope:0}],baseY:192}]},
    unionProfile=createSharedTerrainFieldProfile(appearance,{geometryProfile:SHARED_TERRAIN_UNION_PROFILE,outline:profile.outline,surfaceInterface:profile.surfaceInterface,lighting:profile.lighting}),
    unionOptions={root,document:curveDoc,profile:unionProfile,output:join(f.parent,'shared-union')};
  const union=upgradeSharedTerrainFieldKit(unionOptions);assert.equal(union.format,'ai_scene_shared_terrain_delivery_v2');assert(existsSync(join(unionOptions.output,'delivery.json')));
  assert.equal(verifySharedTerrainFieldKit(unionOptions).reportSha256,union.sha256);
  const unionKit=loadSceneKit(join(unionOptions.output,'kit'));assert.equal(compileMap(unionKit,readMap(unionKit)).curveTerrains.length,1);
});

test('v2 replays a v5 body loop and refuses to package a blocked or unreviewed landmark',{timeout:240000},t=>{
  const f=setupTerrainEdgeDelivery(t,{receiveEdges:false});
  const base=loadSceneKit(f.baseKitRoot),baseContext=contextFor(base),baseDocument=readMap(base);
  const before=compileMap(base,baseDocument),world=before.worldBounds;
  const target=before.layers.find(layer=>layer.layerId==='landmark').nodes[0];
  const baseY=world.y+world.height;
  const curve={curveId:'curve.delivery',profile:'sideview-height-curve-v1',familyId:baseContext.rules.familyId,
    points:[{x:world.x,y:baseY-64,slope:0},{x:world.x+128,y:baseY-64,slope:0}],baseY};
  const guardedDocument={...baseDocument,instances:baseDocument.instances.filter(item=>`visual/${item.instanceId}`===target.nodeId),
    assemblyInstances:[],terrainRuns:[],terrainConnections:[],inspectionCases:[],curveTerrains:[curve]};
  const loopOptions={usableRows:240,overlapRows:64,phaseCount:3};
  const {record}=prepareSharedTerrainLoop(baseContext.kit,baseContext.files,loopOptions);
  const looped=resolveTerrainMaterialAppearance(baseContext.kit.terrainAppearance,record);
  const capEndRow=Math.min(14,looped.cap.pixelSize.height);
  const guardedProfile=createSharedTerrainFieldProfile(looped,{geometryProfile:SHARED_TERRAIN_UNION_PROFILE,
    outline:{maximumInsetWorld:12,sampleStepWorld:8,wavelengthWorld:64,seed:731},
    surfaceInterface:{profile:'world-body-native-lip-v1',capSourceSha256:looped.cap.source.sha256,capEndRow,fadeRows:Math.min(4,capEndRow)},
    curveSideRelief:'exposed-inset-v1',candidateReview:'placement-required-v1'});
  const placement=[{observationId:'landmark-visible',instanceId:target.nodeId.slice('visual/'.length),sourceSha256:target.source.sha256,
    sourceRegion:[0,0,target.source.pixelSize.width,target.source.pixelSize.height],frameRegion:[0,0,1,1],minimumVisibleFraction:.25}];
  const guarded={root:f.baseKitRoot,document:guardedDocument,profile:guardedProfile,loopOptions,output:join(f.parent,'guarded-union')};
  const rejected=(fn,code)=>assert.throws(fn,error=>error.errors?.some(item=>item.code===code));
  rejected(()=>upgradeSharedTerrainFieldKit(guarded),'SHARED_FIELD_PLACEMENT_REQUIRED');
  assert(!existsSync(guarded.output));
  const blocked={...guarded,output:join(f.parent,'blocked-union'),placement:[{...placement[0],frameRegion:[0,0,.01,.01]}]};
  rejected(()=>upgradeSharedTerrainFieldKit(blocked),'SHARED_FIELD_PLACEMENT_BLOCKED');
  assert(existsSync(join(blocked.output,'placement-review.json')));
  assert(!existsSync(join(blocked.output,'scene-kit.zip')));
  const receipt=upgradeSharedTerrainFieldKit({...guarded,placement});
  assert.equal(receipt.materialLoopSha256,record.sha256);
  assert(receipt.placementReviewSha256);
  assert.equal(verifySharedTerrainFieldKit({...guarded,placement}).reportSha256,receipt.sha256);
  rejected(()=>verifySharedTerrainFieldKit({...guarded,placement:[{...placement[0],minimumVisibleFraction:.24}]}),'SHARED_FIELD_PLACEMENT_REPLAY');
});
