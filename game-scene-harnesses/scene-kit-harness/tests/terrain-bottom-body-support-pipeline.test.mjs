import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {validateDocument} from '../src/schema.mjs';
import {validateTerrainBottomEdges,TERRAIN_BOTTOM_BODY_SUPPORT_PROFILE as support,TERRAIN_BOTTOM_THIN_PLATFORM_TOP_PROFILE as thinTop,
 TERRAIN_BOTTOM_ADAPTIVE_COVERAGE_PROFILE as adaptive,TERRAIN_BOTTOM_JUNCTION_PROFILE as underlap} from '../src/terrain-bottom-edges.mjs';
import {prepareTerrainBottomEdgeAssets} from '../src/terrain-bottom-edge-pipeline.mjs';
import {buildTerrainEdgeDelivery,verifyTerrainEdgeDelivery} from '../src/terrain-edge-pipeline.mjs';
import * as flow from '../src/generation/index.mjs';
import * as publicApi from '../src/index.mjs';
import {loadSceneKit,readMap,contextFor} from '../src/kit.mjs';
import {compileMap} from '../src/compile.mjs';
import {hash} from '../src/generation/common.mjs';
import {terrainEdgesFixture} from './helpers/terrain-edges.mjs';
import {setupBottomDelivery,bottomSideControls,bottomFixture} from './helpers/terrain-bottom-delivery.mjs';
import {receiveEdgeFixture} from './helpers/terrain-edge-delivery.mjs';
import {decision} from './helpers/generation.mjs';
const rejects=(action,code)=>assert.throws(action,error=>error.errors?.some(issue=>issue.code===code));
function shape(){
 const f=terrainEdgesFixture(),b=bottomFixture(),appearance={...f.appearance,format:'ai_scene_continuous_terrain_appearance_v6'},edges={...f.edges,format:'ai_scene_terrain_edges_v6',materialProfile:'union-world-body-local-surface-v1'};
 for(const side of ['left','right'])edges[side].wall.repeatY.from=32;
 const bottom={format:'ai_scene_terrain_bottom_edges_v2',profile:'native-horizontal-bottom-union-v2',sourceBinding:structuredClone(edges.sourceBinding),nativeSizeProfile:'bounded-native-4m-v1',renderEnvelopeProfile:'visible-alpha8-outward16-native-rgba-v1',junctionProfile:adaptive};
 for(const [key,role]of [['edge','bottom-edge'],['leftCorner','left-bottom-corner'],['rightCorner','right-bottom-corner']]){
  const raw=b.raws.get(role);bottom[key]={source:{path:'bottom/'+key+'.png',sha256:hash(raw),byteLength:raw.length},pixelSize:{width:384,height:384},...structuredClone(b.controls[key])};
 }
 return {bottom,appearance,edges};
}
test('typed body support is additive in v2, remains opt-in and is closed to unknown values or v1 declarations',()=>{
 const f=shape(),legacy=structuredClone(f.bottom),selected={...f.bottom,bodySupportProfile:support};
 assert.equal(publicApi.TERRAIN_BOTTOM_BODY_SUPPORT_PROFILE,support);
 for(const value of [legacy,selected])assert.equal(validateDocument('ai_scene_terrain_bottom_edges_v2',value).length,0);
 assert.equal(validateTerrainBottomEdges(selected,f.appearance,{terrainEdges:f.edges}).bodySupportProfile,support);
 const protectedTop={...selected,thinPlatformTopProfile:thinTop};
 assert.equal(publicApi.TERRAIN_BOTTOM_THIN_PLATFORM_TOP_PROFILE,thinTop);
 assert.equal(validateDocument('ai_scene_terrain_bottom_edges_v2',protectedTop).length,0);
 assert.equal(validateTerrainBottomEdges(protectedTop,f.appearance,{terrainEdges:f.edges}).thinPlatformTopProfile,thinTop);
 assert(validateDocument('ai_scene_terrain_bottom_edges_v2',{...protectedTop,thinPlatformTopProfile:'arbitrary-cap'}).length);
 rejects(()=>validateTerrainBottomEdges({...legacy,thinPlatformTopProfile:thinTop},f.appearance,{terrainEdges:f.edges}),'TERRAIN_BOTTOM_THIN_PLATFORM_TOP_PROFILE');
 validateTerrainBottomEdges(legacy,f.appearance,{terrainEdges:f.edges});assert.deepEqual(f.bottom,legacy);
 assert.equal(Object.hasOwn(legacy,'bodySupportProfile'),false);
 assert(validateDocument('ai_scene_terrain_bottom_edges_v2',{...selected,bodySupportProfile:'automatic-alpha-fill'}).length);
 const {nativeSizeProfile,renderEnvelopeProfile,junctionProfile,...old}=legacy,v1={...old,format:'ai_scene_terrain_bottom_edges_v1',profile:'native-horizontal-bottom-union-v1'};
 assert.equal(validateDocument('ai_scene_terrain_bottom_edges_v1',v1).length,0);
 assert(validateDocument('ai_scene_terrain_bottom_edges_v1',{...v1,bodySupportProfile:support}).length);
 rejects(()=>validateTerrainBottomEdges({...v1,bodySupportProfile:support},f.appearance,{terrainEdges:f.edges}),'TERRAIN_BOTTOM_BODY_SUPPORT_PROFILE');
});
test('body support controls reject wrong profile or missing adaptive/native dependencies before source or filesystem processing',()=>{
 const b=bottomFixture(),base={...b.controls,nativeSizeProfile:'bounded-native-4m-v1',renderEnvelopeProfile:'visible-alpha8-outward16-native-rgba-v1',junctionProfile:adaptive,bodySupportProfile:support};
 for(const patch of [{bodySupportProfile:'fill-exterior'},{junctionProfile:underlap},{junctionProfile:undefined}]){
  const controls={...base,...patch};if(controls.junctionProfile===undefined)delete controls.junctionProfile;
  rejects(()=>prepareTerrainBottomEdgeAssets({controls,files:null,kit:null,inputs:null}),'TERRAIN_BOTTOM_BODY_SUPPORT_PROFILE');
 }
 const {nativeSizeProfile,renderEnvelopeProfile,...nonNative}=base;
 rejects(()=>prepareTerrainBottomEdgeAssets({controls:nonNative,files:null,kit:null,inputs:null}),'TERRAIN_BOTTOM_BODY_SUPPORT_PROFILE');
 const f=shape();rejects(()=>validateTerrainBottomEdges({...f.bottom,bodySupportProfile:support,junctionProfile:underlap},f.appearance,{terrainEdges:f.edges}),'TERRAIN_BOTTOM_BODY_SUPPORT_PROFILE');
 const {bodySupportProfile,...withoutSupport}=base;
 rejects(()=>prepareTerrainBottomEdgeAssets({controls:{...withoutSupport,thinPlatformTopProfile:thinTop},files:null,kit:null,inputs:null}),'TERRAIN_BOTTOM_THIN_PLATFORM_TOP_PROFILE');
 rejects(()=>prepareTerrainBottomEdgeAssets({controls:{...base,thinPlatformTopProfile:'arbitrary-cap'},files:null,kit:null,inputs:null}),'TERRAIN_BOTTOM_THIN_PLATFORM_TOP_PROFILE');
});
test('a fresh full perimeter public delivery binds explicit original-solid support and replays with source PNGs, author geometry and compute history intact',{timeout:900000},t=>{
 const f=setupBottomDelivery(t,{receiveSides:false}),side=bottomSideControls(f),bottom=bottomFixture(),raws=new Map([...f.raws,...bottom.raws]),batch=flow.freezeTerrainEdgeSources(f.workflow,{
  batchId:'body.support.native.full',baseBatchSha256:f.base.sha256,capabilitiesSha256:f.options.capabilitiesSha256,coverageProfile:'full-perimeter-v1',nativeSizeProfile:'bounded-native-4m-v1',renderEnvelopeProfile:'visible-alpha8-outward16-native-rgba-v1',
  items:flow.TERRAIN_PERIMETER_ROLES.map((role,i)=>({assetId:'body.support.native.'+i,role,content:'One independent synthetic native perimeter responsibility '+role+'.',exclusions:['Independent objects']}))});
 for(const v of [side.left.wall,side.right.wall])v.repeatY.from=144;
 flow.authorizeReferenceAssetBatch(f.workflow,batch.sha256,decision('body.support.native.compute',batch.sha256,'approve-compute'));
 for(const sha of batch.planSha256s)receiveEdgeFixture(f.workflow,sha,raws.get(flow.getGenerationPlan(f.workflow,sha).recipe.edgeRole));
 const before=flow.inspectWorkflow(f.workflow),sourceHandle=loadSceneKit(f.baseKitRoot),sourceMap=readMap(sourceHandle),sourceScene=compileMap(sourceHandle,sourceMap),
  controls={...side,bottom:{...bottom.controls,nativeSizeProfile:'bounded-native-4m-v1',renderEnvelopeProfile:'visible-alpha8-outward16-native-rgba-v1',junctionProfile:adaptive,
   bodySupportProfile:support,thinPlatformTopProfile:thinTop}},
  options={...f.deliveryOptions,batchSha256:batch.sha256,controls,output:join(f.parent,'body-support-native-delivery')};
 const invalid={...options,controls:{...controls,bottom:{...controls.bottom,junctionProfile:underlap}},output:join(f.parent,'invalid-body-support')};
 rejects(()=>buildTerrainEdgeDelivery(invalid),'TERRAIN_BOTTOM_BODY_SUPPORT_PROFILE');assert.equal(existsSync(invalid.output),false);
 const report=buildTerrainEdgeDelivery(options),handle=loadSceneKit(join(options.output,'candidate/kit')),context=contextFor(handle),map=readMap(handle),scene=compileMap(handle,map),ready=JSON.parse(readFileSync(join(options.output,'candidate/readiness.json')));
 assert.equal(context.kit.terrainBottomEdges.bodySupportProfile,support);
 assert.equal(ready.bottomEdges.bodySupportProfile,support);assert.equal(report.generationCalls,0);assert.equal(report.finalHumanArtReview,'pending');
 assert.equal(context.kit.terrainBottomEdges.thinPlatformTopProfile,thinTop);
 assert.equal(ready.bottomEdges.thinPlatformTopProfile,thinTop);
 assert.equal(validateDocument('ai_scene_kit_v4',context.kit).length,0);
 const plain=({kitRef,...author})=>author;assert.deepEqual(plain(map),plain(sourceMap));assert.deepEqual(scene.collisionSuggestions,sourceScene.collisionSuggestions);
 for(const role of flow.TERRAIN_PERIMETER_ROLES)assert.deepEqual(readFileSync(join(options.output,'candidate/source/'+role+'-native.png')),raws.get(role));
 assert.equal(verifyTerrainEdgeDelivery(options).reportSha256,report.sha256);assert.deepEqual(flow.inspectWorkflow(f.workflow),before);
});
