import test from 'node:test';
import assert from 'node:assert/strict';
import * as flow from '../src/generation/index.mjs';
import {inspectPng,encodeRgbaPng} from '../src/png.mjs';
import {hash,imageRef,verifyImage,seal,unseal} from '../src/generation/common.mjs';
import {setupCoherent,sourcePng} from './helpers/coherent.mjs';
import {receiveEdgeFixture} from './helpers/terrain-edge-delivery.mjs';
import {decision} from './helpers/generation.mjs';

// Synthetic caBX chunk with independently calculated CRC; no real media.
function cabx(data=Buffer.from('fixture')){const b=Buffer.alloc(data.length+12);b.writeUInt32BE(data.length);b.write('caBX',4,'ascii');data.copy(b,8);let crc=0xffffffff;
 for(const x of b.subarray(4,-4)){crc^=x;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}b.writeUInt32BE((crc^0xffffffff)>>>0,b.length-4);return b;}
function rawPng(){const p=inspectPng(sourcePng(true,23),{includePixels:true});for(let x=0;x<619;x++)p.rgba.set([17,31,49,0],x*4);
 const b=encodeRgbaPng(p.width,p.height,p.rgba);return Buffer.concat([b.subarray(0,33),cabx(),b.subarray(33)]);}
function fixture(t,changed=false){const f=setupCoherent(t,'Hidden native dependency',undefined,{transformAnalysis:a=>{if(!changed)return a;const v=unseal(a);return seal({...v,instances:v.instances.map(i=>i.instanceId==='landmark.actual'?{...i,anchor:{...i.anchor,x:i.anchor.x+1}}:i)});}});
 const scopes=flow.createLayerSourceScopes(f.brief.requirements),batch=flow.freezeCoherentSources(f.workflow,{...f.options,sourceScopes:scopes}),plans=batch.planSha256s.map(s=>flow.getGenerationPlan(f.workflow,s));
 return {...f,batch,bridge:plans.find(x=>x.recipe.assetId==='landmark.actual'),target:plans.find(x=>x.recipe.assetId==='front.left')};}
for(const mode of ['spatial','appearance-v1','appearance-v2'])test(`checked-rebind ${mode} dependency supplies native caBX and hidden RGB bytes without normalization`,{timeout:120000},t=>{
 const source=fixture(t),target=fixture(t,true),raw=rawPng(),png=inspectPng(raw,{includePixels:true,allowCabx:true,allowHiddenRgb:true});assert.equal(png.hiddenRgbPixels,619);
 flow.authorizePlan(source.workflow,source.bridge.sha256,decision('hidden.source.compute',source.bridge.sha256,'approve-compute'));const result=receiveEdgeFixture(source.workflow,source.bridge.sha256,raw);assert.equal(result.technical.status,'pass');assert.equal(result.technical.hiddenRgbPixels,619);
 flow.reviewResult(source.workflow,source.bridge.sha256,decision('hidden.source.accept',hash(raw),'accept'));
 const options={sourceWorkflow:source.workflow,sourcePlanSha256:source.bridge.sha256,targetPlanSha256:target.bridge.sha256,targetSha256:target.bridge.recipe.targetSha256,scopeSha256:target.bridge.sourceScope.definition.sha256},proposal=flow.proposeCoherentRebind(target.workflow,options).proposal;
 const applied=flow.commitCoherentRebind(target.workflow,{...options,proposal,rebindId:'hidden.rebind',parentBatchSha256:target.batch.sha256,batchId:'hidden.rebound',receipt:decision('hidden.rebind.accept',proposal.sha256)});
 flow.reviewResult(target.workflow,applied.record.sha256,decision('hidden.target.accept',hash(raw),'accept'));
 const sourceDependency=mode!=='spatial'?{format:'ai_scene_source_appearance_dependency_'+(mode==='appearance-v2'?'v2':'v1'),sourcePlanSha256:applied.record.sha256}:{format:'ai_scene_source_dependency_v1',sourcePlanSha256:applied.record.sha256,placement:{x:10,y:20,scale:{numerator:1,denominator:2}},observations:[{observationId:'bridge.end',native:{x:200,y:200}}]},next=flow.reviseCoherentSources(target.workflow,applied.batch.sha256,{batchId:'hidden.dependent',allowUnsubmittedDependency:true,expectedBatchSha256:applied.batch.sha256,replacements:[{assetId:'front.left',planId:'hidden.dependent.front',intent:'isolated-layer-v4',sourceDependency}]});
 const sha=next.planSha256s.find(x=>!applied.batch.planSha256s.includes(x)),plan=flow.getGenerationPlan(target.workflow,sha);
 assert.equal(plan.sourceDependencyEvidence.sourceRawSha256,hash(raw));assert.deepEqual(flow.readGenerationInput(target.workflow,sha,0),target.raw);assert.deepEqual(flow.readGenerationInput(target.workflow,sha,1),raw);
 const view=flow.readCoherentWorkflowView(target.workflow,{includeCurrentInputs:true});assert.deepEqual(view.inputs.get(hash(raw)),raw);assert.deepEqual(flow.getGenerationResult(target.workflow,applied.record.sha256).bytes,raw);
});
test('ordinary image imports and verification still reject hidden RGB even with caBX allowed',t=>{
 const f=fixture(t),raw=rawPng(),ref=imageRef(raw,{allowCabx:true,allowHiddenRgb:true}),store={readBlob:()=>raw},before=flow.inspectWorkflow(f.workflow);
 assert.throws(()=>verifyImage(store,ref,{allowCabx:true}));assert.deepEqual(verifyImage(store,ref,{allowCabx:true,allowHiddenRgb:true}),raw);
 assert.throws(()=>flow.importStandardWorkflowImage(f.workflow,raw));assert.throws(()=>flow.importWorkflowImage(f.workflow,raw));assert.deepEqual(flow.inspectWorkflow(f.workflow),before);
});
