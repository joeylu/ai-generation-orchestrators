import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import * as flow from '../src/generation/index.mjs';
import {buildTerrainEdgeDelivery,verifyTerrainEdgeDelivery} from '../src/terrain-edge-pipeline.mjs';
import {buildTerrainBottomEdgeDelivery,verifyTerrainBottomEdgeDelivery} from '../src/terrain-bottom-edge-pipeline.mjs';
import {loadSceneKit,contextFor,readMap} from '../src/kit.mjs';
import {compileMap} from '../src/compile.mjs';
import {canonicalJson} from '../src/document.mjs';
import {encodeRgbaPng,inspectPng} from '../src/png.mjs';
import {jsonBytes} from '../src/generation/common.mjs';
import {freezeBottomDeliverySources as freeze,bottomSideControls as sideControls,setupBottomDelivery as setup,bottomFixture} from './helpers/terrain-bottom-delivery.mjs';
import {receiveEdgeFixture} from './helpers/terrain-edge-delivery.mjs';
import {decision} from './helpers/generation.mjs';

const json=path=>JSON.parse(readFileSync(path,'utf8'));
const rejects=(action,code)=>assert.throws(action,error=>error.errors?.some(issue=>issue.code===code));
const plain=({kitRef,...document})=>document;
function wideBottom(){
  const width=2172,height=384,rgba=Buffer.alloc(width*height*4);
  for(let y=64;y<240;y++)for(let x=320;x<1856;x++)rgba.set([70+x%23,90+y%31,130+x%17,252],(y*width+x)*4);
  // Native weak-alpha paint remains in the PNG both inside and outside the
  // separately reviewed render window. No source sample may be erased.
  for(const y of [280,300])for(let x=1024;x<1032;x++)rgba.set([35,70,110,4],(y*width+x)*4);
  rgba.set([11,23,37,0],0);return {raw:encodeRgbaPng(width,height,rgba),rgba,width,height};
}

test('three-source bottom upgrade verifies its original side lineage and preserves all sources, profiles, authors and collision',{timeout:900000},t=>{
  const f=setup(t),controls=sideControls(f),baseOptions={...f.deliveryOptions,controls,output:join(f.parent,'sides')},sideReport=buildTerrainEdgeDelivery(baseOptions),
    baseKitRoot=join(baseOptions.output,'candidate/kit'),baseHandle=loadSceneKit(baseKitRoot),base=contextFor(baseHandle),originalScene=compileMap(baseHandle,readMap(baseHandle)),
    {batch,bottom}=freeze(f,flow.TERRAIN_BOTTOM_EDGE_ROLES,'bottom.upgrade'),before=flow.inspectWorkflow(f.workflow),
    options={workflow:f.workflow,baseKitRoot,batchSha256:batch.sha256,controls:{bottom:bottom.controls},output:join(f.parent,'bottom-upgrade')};
  const invalid={...options,controls:structuredClone(options.controls),output:join(f.parent,'bad-native-control')};invalid.controls.bottom.edge.innerY=250;
  assert.throws(()=>buildTerrainBottomEdgeDelivery(invalid));assert.equal(existsSync(invalid.output),false);
  rejects(()=>buildTerrainBottomEdgeDelivery({...options,output:join(baseOptions.output,'candidate','forbidden')}),'OUTPUT_OVERLAP');
  const report=buildTerrainBottomEdgeDelivery(options),handle=loadSceneKit(join(options.output,'candidate/kit')),context=contextFor(handle),map=readMap(handle),scene=compileMap(handle,map);
  assert.equal(report.format,'ai_scene_terrain_bottom_edge_delivery_v1');assert.equal(report.generationCalls,0);assert.equal(report.finalHumanArtReview,'pending');
  assert.deepEqual(plain(map),plain(readMap(baseHandle)));assert.deepEqual(scene.collisionSuggestions,originalScene.collisionSuggestions);
  for(const field of ['terrainEdges','terrainAppearance','terrainRigidRepeat'])assert.deepEqual(context.kit[field],base.kit[field],field);
  assert.equal(context.kit.terrainBottomEdges.profile,'native-horizontal-bottom-union-v1');
  for(const [path,bytes]of base.files)if(path.endsWith('.png'))assert.deepEqual(context.files.get(path),bytes,path);
  const candidate=json(join(options.output,'candidate/readiness.json'));
  assert.equal(candidate.originalSideBatchSha256,f.batch.sha256);assert.equal(candidate.originalSideSourcesPreserved,true);assert.equal(candidate.originalProfilesPreserved,true);
  assert.equal(candidate.sourceEvidence.length,3);assert(candidate.sourceEvidence.every(row=>row.sourcePngAlphaChanged===false&&row.visibleRgbaChanged===false&&row.zeroAlphaRgbNormalizedPixels===1));
  for(const [key,role]of [['edge','bottom-edge'],['leftCorner','left-bottom-corner'],['rightCorner','right-bottom-corner']]){
    const raw=bottom.raws.get(role),source=inspectPng(raw,{includePixels:true,allowHiddenRgb:true}),derived=inspectPng(context.files.get(context.kit.terrainBottomEdges[key].source.path),{includePixels:true});
    assert.deepEqual(readFileSync(join(options.output,'candidate/source/'+role+'-native.png')),raw);
    for(let p=0;p<source.rgba.length;p+=4){assert.equal(derived.rgba[p+3],source.rgba[p+3]);if(source.rgba[p+3])assert.deepEqual(derived.rgba.subarray(p,p+4),source.rgba.subarray(p,p+4));}
  }
  assert.equal(verifyTerrainBottomEdgeDelivery(options).reportSha256,report.sha256);assert.equal(verifyTerrainEdgeDelivery(baseOptions).reportSha256,sideReport.sha256);
  assert.deepEqual(flow.inspectWorkflow(f.workflow),before);
  const nativePath=join(options.output,'candidate/source/bottom-edge-native.png'),saved=readFileSync(nativePath);writeFileSync(nativePath,Buffer.from('changed'));
  rejects(()=>verifyTerrainBottomEdgeDelivery(options),'PROOF_BUNDLE_RECOMPILE_MISMATCH');writeFileSync(nativePath,saved);
  const oldNative=join(baseOptions.output,'candidate/source/left-wall-native.png'),oldSaved=readFileSync(oldNative);writeFileSync(oldNative,Buffer.from('changed'));
  rejects(()=>verifyTerrainBottomEdgeDelivery(options),'TERRAIN_BOTTOM_BASE_INVENTORY');writeFileSync(oldNative,oldSaved);
  assert.equal(verifyTerrainBottomEdgeDelivery(options).reportSha256,report.sha256);
  rejects(()=>buildTerrainBottomEdgeDelivery({...options,baseKitRoot:join(options.output,'candidate/kit'),output:join(f.parent,'repeat-bottom-upgrade')}),'TERRAIN_BOTTOM_DELIVERY_BASE');
});

test('a fresh seven-source full perimeter delivery uses the common pipeline and old four-source delivery still replays',{timeout:900000},t=>{
  const f=setup(t),controls=sideControls(f),legacy={...f.deliveryOptions,controls,output:join(f.parent,'legacy-four')},old=buildTerrainEdgeDelivery(legacy),
    {batch,bottom}=freeze(f,flow.TERRAIN_PERIMETER_ROLES,'full.perimeter'),before=flow.inspectWorkflow(f.workflow),
    options={...f.deliveryOptions,batchSha256:batch.sha256,controls:{...controls,bottom:bottom.controls},output:join(f.parent,'full-seven')};
  rejects(()=>buildTerrainEdgeDelivery({...options,controls,output:join(f.parent,'missing-bottom-controls')}),'TERRAIN_EDGE_DELIVERY_COVERAGE');
  const report=buildTerrainEdgeDelivery(options),handle=loadSceneKit(join(options.output,'candidate/kit')),context=contextFor(handle),
    baseHandle=loadSceneKit(join(legacy.output,'candidate/kit')),base=contextFor(baseHandle),candidate=json(join(options.output,'candidate/readiness.json'));
  assert.equal(candidate.sourceEvidence.length,7);assert.equal(candidate.bottomEdges.nativeBottomSources,true);assert.equal(candidate.bottomEdges.rotatedTopCap,false);
  assert.deepEqual(candidate.bottomEdges.sourceRoles,flow.TERRAIN_BOTTOM_EDGE_ROLES);assert.equal(report.generationCalls,0);assert.equal(report.finalHumanArtReview,'pending');
  assert.deepEqual(context.kit.terrainEdges,base.kit.terrainEdges);assert.deepEqual(context.kit.terrainRigidRepeat,base.kit.terrainRigidRepeat);
  for(const [path,bytes]of base.files)if(path.endsWith('.png'))assert.deepEqual(context.files.get(path),bytes,path);
  assert.deepEqual(plain(readMap(handle)),plain(readMap(baseHandle)));
  assert.deepEqual(compileMap(handle,readMap(handle)).collisionSuggestions,compileMap(baseHandle,readMap(baseHandle)).collisionSuggestions);
  assert.equal(verifyTerrainEdgeDelivery(options).reportSha256,report.sha256);assert.equal(verifyTerrainEdgeDelivery(legacy).reportSha256,old.sha256);
  assert.deepEqual(flow.inspectWorkflow(f.workflow),before);assert.equal(canonicalJson(context.kit.terrainBottomEdges.sourceBinding),canonicalJson(context.kit.terrainEdges.sourceBinding));
});

test('an exact accepted zero-call native-size preparation produces explicit v2 bottom geometry and preserves the failed original QA',{timeout:1200000},t=>{
  const f=setup(t),controls=sideControls(f),baseOptions={...f.deliveryOptions,controls,output:join(f.parent,'native-size-side-base')};
  buildTerrainEdgeDelivery(baseOptions);
  const {batch,bottom}=freeze(f,flow.TERRAIN_BOTTOM_EDGE_ROLES,'bottom.native.size',false),{raw,rgba}=wideBottom(),originalPlanSha256=batch.planSha256s[0];
  bottom.controls.edge.repeatX={from:768,to:1408};
  flow.authorizeReferenceAssetBatch(f.workflow,batch.sha256,decision('native.size.compute',batch.sha256,'approve-compute'));
  receiveEdgeFixture(f.workflow,originalPlanSha256,raw);
  const original=flow.getGenerationResult(f.workflow,originalPlanSha256),beforeAdoption=flow.inspectWorkflow(f.workflow);
  assert.equal(original.result.technical.status,'fail');assert.deepEqual(original.result.technical.issues,['OUTPUT_SIZE']);
  const {proposal,bytes}=flow.proposeTerrainEdgeNativeSizePreparation(f.workflow,originalPlanSha256,batch.sha256);
  assert.deepEqual(bytes,raw);assert.equal(proposal.maximumNewImageCalls,0);
  const pending={workflow:f.workflow,baseKitRoot:join(baseOptions.output,'candidate/kit'),batchSha256:batch.sha256,
    controls:{bottom:{...bottom.controls,nativeSizeProfile:'bounded-native-4m-v1',renderEnvelopeProfile:'visible-alpha8-outward16-native-rgba-v1'}},output:join(f.parent,'before-exact-adoption')};
  rejects(()=>buildTerrainBottomEdgeDelivery(pending),'TERRAIN_EDGE_SOURCES_INCOMPLETE');assert.equal(existsSync(pending.output),false);
  const adopted=flow.prepareAndAdoptTerrainEdgeNativeSizeSource(f.workflow,{preparationId:'native.size.prepared',proposal,
    receipt:decision('native.size.exact.accept',proposal.sha256),parentBatchSha256:batch.sha256,batchId:'native.size.continuation'});
  assert.equal(adopted.record.request.maximumCalls,0);assert.equal(adopted.batch.maximumCalls,0);assert.equal(adopted.batch.newImageRequests,0);
  assert.deepEqual(adopted.batch.planSha256s.slice(1),batch.planSha256s.slice(1));
  for(const sha of batch.planSha256s.slice(1)){
    const before=beforeAdoption.plans.find(item=>item.planSha256===sha),after=flow.inspectWorkflow(f.workflow).plans.find(item=>item.planSha256===sha);
    assert.equal(before.status,'authorized');assert.equal(after.status,'authorized');
    receiveEdgeFixture(f.workflow,sha,bottom.raws.get(flow.getGenerationPlan(f.workflow,sha).recipe.edgeRole));
  }
  const options={...pending,batchSha256:adopted.batch.sha256,output:join(f.parent,'accepted-native-size')},before=flow.inspectWorkflow(f.workflow),
    legacy={...options,controls:{bottom:bottom.controls},output:join(f.parent,'native-size-without-explicit-v2')};
  rejects(()=>buildTerrainBottomEdgeDelivery(legacy),'TERRAIN_BOTTOM_NATIVE_SIZE_PROFILE');assert.equal(existsSync(legacy.output),false);
  const report=buildTerrainBottomEdgeDelivery(options),handle=loadSceneKit(join(options.output,'candidate/kit')),context=contextFor(handle),
    candidate=json(join(options.output,'candidate/readiness.json')),source=candidate.sourceEvidence.find(item=>item.edgeRole==='bottom-edge');
  assert.equal(context.kit.terrainBottomEdges.format,'ai_scene_terrain_bottom_edges_v2');assert.equal(context.kit.terrainBottomEdges.profile,'native-horizontal-bottom-union-v2');
  assert.equal(context.kit.terrainBottomEdges.nativeSizeProfile,'bounded-native-4m-v1');assert.equal(context.kit.terrainBottomEdges.edge.pixelSize.width,2172);
  assert.equal(context.kit.terrainBottomEdges.renderEnvelopeProfile,'visible-alpha8-outward16-native-rgba-v1');
  assert.deepEqual(json(join(options.output,'candidate/evidence/bottom-native-envelope-validation.json')),candidate.nativeEnvelopeValidation);
  const measured=candidate.nativeEnvelopeValidation.sources.find(item=>item.key==='edge').nativeRenderEnvelope;
  assert.equal(measured.weakTailOutsideEnvelope.pixelCount,8);assert.equal(measured.weakTailOutsideEnvelope.alphaSum,32);
  assert.equal(measured.weakTailOutsideEnvelope.maximumAlpha,4);assert.equal(measured.sourcePixelsRemoved,0);
  assert.equal(measured.clipping,'render-geometry-only-original-RGBA-kept');
  assert.equal(source.nativeSizePreparation.sha256,adopted.record.sha256);assert.equal(source.nativeSizePreparation.originalTechnicalSha256,original.result.technical.sha256);
  assert.equal(source.nativeSizePreparation.originalQaStatus,'fail');assert.deepEqual(source.nativeSizePreparation.originalIssues,['OUTPUT_SIZE']);
  assert.equal(source.nativeSizePreparation.maximumNewImageCalls,0);assert.equal(source.nativeSizePreparation.originalPngBytesUnchanged,true);
  assert.deepEqual(readFileSync(join(options.output,'candidate/source/bottom-edge-original-native.png')),raw);
  assert.deepEqual(readFileSync(join(options.output,'candidate/source/bottom-edge-native.png')),raw);
  assert.deepEqual(readFileSync(join(options.output,'candidate/evidence/bottom-edge-original-technical-qa.json')),jsonBytes(original.result.technical));
  assert.deepEqual(readFileSync(join(options.output,'candidate/evidence/bottom-edge-native-size-preparation.json')),jsonBytes(adopted.record));
  const derived=inspectPng(context.files.get(context.kit.terrainBottomEdges.edge.source.path),{includePixels:true}),expected=Buffer.from(rgba);
  for(let p=0;p<expected.length;p+=4)if(!expected[p+3])expected.fill(0,p,p+3);assert.deepEqual(derived.rgba,expected);
  assert.equal(verifyTerrainBottomEdgeDelivery(options).reportSha256,report.sha256);assert.deepEqual(flow.inspectWorkflow(f.workflow),before);
  assert.deepEqual(flow.getGenerationResult(f.workflow,originalPlanSha256).result,original.result);
  const qaPath=join(options.output,'candidate/evidence/bottom-edge-original-technical-qa.json'),saved=readFileSync(qaPath);writeFileSync(qaPath,Buffer.from('{}'));
  rejects(()=>verifyTerrainBottomEdgeDelivery(options),'PROOF_BUNDLE_RECOMPILE_MISMATCH');writeFileSync(qaPath,saved);
});

test('new frozen native-size source plans qualify v2 without a preparation and retain the measured weak tail evidence',{timeout:1200000},t=>{
  const f=setup(t,{receiveSides:false}),controls=sideControls(f),bottom=bottomFixture(),raws=new Map([...f.raws,...bottom.raws]);
  raws.set('bottom-edge',wideBottom().raw);bottom.controls.edge.repeatX={from:768,to:1408};
  const batch=flow.freezeTerrainEdgeSources(f.workflow,{batchId:'native.size.full.perimeter',baseBatchSha256:f.base.sha256,capabilitiesSha256:f.options.capabilitiesSha256,
    coverageProfile:'full-perimeter-v1',nativeSizeProfile:'bounded-native-4m-v1',renderEnvelopeProfile:'visible-alpha8-outward16-native-rgba-v1',
    items:flow.TERRAIN_PERIMETER_ROLES.map((role,index)=>({assetId:'native.full.'+index,role,content:'One isolated synthetic native perimeter responsibility '+role+'.',exclusions:['Independent props']}))});
  flow.authorizeReferenceAssetBatch(f.workflow,batch.sha256,decision('native.full.compute',batch.sha256,'approve-compute'));
  for(const sha of batch.planSha256s){assert.equal(flow.getGenerationPlan(f.workflow,sha).format,'ai_scene_generation_plan_v35');
    receiveEdgeFixture(f.workflow,sha,raws.get(flow.getGenerationPlan(f.workflow,sha).recipe.edgeRole));}
  const before=flow.inspectWorkflow(f.workflow),options={...f.deliveryOptions,batchSha256:batch.sha256,
    controls:{...controls,bottom:{...bottom.controls,nativeSizeProfile:'bounded-native-4m-v1',renderEnvelopeProfile:'visible-alpha8-outward16-native-rgba-v1'}},output:join(f.parent,'native-frozen-full')};
  const invalid={...options,controls:structuredClone(options.controls),output:join(f.parent,'missing-native-render-profile')};
  invalid.controls.bottom.renderEnvelopeProfile='unreviewed-clip';
  rejects(()=>buildTerrainEdgeDelivery(invalid),'TERRAIN_BOTTOM_NATIVE_SIZE_PROFILE');assert.equal(existsSync(invalid.output),false);
  const report=buildTerrainEdgeDelivery(options),context=contextFor(loadSceneKit(join(options.output,'candidate/kit'))),candidate=json(join(options.output,'candidate/readiness.json'));
  assert.equal(context.kit.terrainBottomEdges.format,'ai_scene_terrain_bottom_edges_v2');assert.equal(candidate.sourceEvidence.length,7);
  assert.deepEqual(candidate.bottomEdges.sourcePreparations,[]);assert.equal(candidate.bottomEdges.renderEnvelopeProfile,'visible-alpha8-outward16-native-rgba-v1');
  const measured=candidate.bottomEdges.nativeEnvelopeValidation.sources.find(item=>item.key==='edge').nativeRenderEnvelope;
  assert.equal(measured.weakTailOutsideEnvelope.pixelCount,8);assert.equal(measured.sourcePixelsRemoved,0);
  assert.deepEqual(readFileSync(join(options.output,'candidate/source/bottom-edge-native.png')),wideBottom().raw);
  assert.equal(verifyTerrainEdgeDelivery(options).reportSha256,report.sha256);assert.deepEqual(flow.inspectWorkflow(f.workflow),before);
});
