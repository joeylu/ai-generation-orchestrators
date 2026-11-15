import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import * as flow from '../src/generation/index.mjs';
import {reviewBandFeatureRelations} from '../src/generation/band-feature-relation-review.mjs';
import {assertCandidateBandRelationReviews} from '../src/generation/band-feature-relation-gate.mjs';
import {createMeasuredCoherentComposition} from '../src/coherent-composition.mjs';
import {compileMeasuredSurfaceMapping} from '../src/terrain-proof/measured-field.mjs';
import {createBackgroundBandPlacement} from '../src/background-band-placement.mjs';
import {encodeRgbaPng} from '../src/png.mjs';
import {seal,unseal,hash} from '../src/generation/common.mjs';
import {setupCoherent,sourcePng,coherentSurfaceObservations} from './helpers/coherent.mjs';
import {receiveEdgeFixture} from './helpers/terrain-edge-delivery.mjs';
import {decision} from './helpers/generation.mjs';

const band=()=>({format:'ai_scene_background_band_v3',profile:'background-band-coverage-v3',guidanceProfile:'normalized-three-cut-coverage-v1',boundaryProfile:'natural-top-finite-three-cuts-v1',coverageBudget:structuredClone(flow.BACKGROUND_BAND_COVERAGE_BUDGET),camera:{referenceCenterWorld:{x:128,y:72},centerDomainWorld:{minX:96,maxX:160,minY:56,maxY:88},viewportWorld:{width:256,height:144},modes:['editor-unparallax','play-parallax']},parallax:{x:.3,y:1},coverageFrameWorld:{x:-48,y:8,width:352,height:176},canvasAspect:{numerator:2,denominator:1},edges:{top:{purpose:'transparent-silhouette'},left:{purpose:'camera-overdraw'},right:{purpose:'camera-overdraw'},bottom:{purpose:'camera-overdraw'}}});
const relations=sha=>({format:'ai_scene_band_feature_relations_v1',referenceRawSha256:sha,features:[{featureId:'peak',description:'synthetic peak'},{featureId:'tower',description:'synthetic tower'}],relations:[{from:'peak',to:'tower',axis:'x',min:.12,max:.2}]});
const transformBrief=b=>({...b,requirements:seal({...unseal(b.requirements),subjects:[...b.requirements.subjects,{subjectId:'rear',role:'valley',layerId:'landmark',content:'A synthetic band.',count:{min:1,max:1},placementHint:'wide'}]})});
const transformAnalysis=a=>seal({...unseal(a),instances:[...a.instances,{instanceId:'rear.actual',subjectId:'rear',layerId:'landmark',visibleEnvelope:[{x:0,y:20},{x:256,y:20},{x:256,y:144},{x:0,y:144}],anchor:{x:128,y:80},visibility:'occluded-and-frame-clipped',anchorEvidence:'observed',notes:'Synthetic band.'}]});
function rawBand(){const w=512,h=256,rgba=Buffer.alloc(w*h*4);for(let x=0;x<w;x++)for(let y=12+Math.floor((Math.sin(x/40)+1)*8);y<h;y++)rgba.set([45+x%120,80+y%90,111,254],(y*w+x)*4);return encodeRgbaPng(w,h,rgba);}
const observations=()=>[{featureId:'peak',x:[.2,.2],y:[.2,.2]},{featureId:'tower',x:[.36,.36],y:[.2,.2]}];
function setup(t,withRelations){const f=setupCoherent(t,'Band gate synthetic',undefined,{transformBrief,transformAnalysis});
 const override={subjectId:'rear',parentRole:'far',content:'A synthetic valley band.',exclusions:[],backgroundBand:band(),...(withRelations?{bandFeatureRelations:relations(hash(f.raw))}:{})};
 const scopes=flow.createLayerSourceScopes(f.brief.requirements,[override]),batch=flow.freezeCoherentSources(f.workflow,{...f.options,sourceScopes:scopes});
 flow.authorizeReferenceAssetBatch(f.workflow,batch.sha256,decision('band.gate.compute',batch.sha256,'approve-compute'));
 for(const [i,sha]of batch.planSha256s.entries()){const p=flow.getGenerationPlan(f.workflow,sha);receiveEdgeFixture(f.workflow,sha,p.recipe.assetId==='rear.actual'?rawBand():sourcePng(p.target.alpha==='transparent',i+10));}
 const sha=batch.planSha256s.find(s=>flow.getGenerationPlan(f.workflow,s).recipe.assetId==='rear.actual'),plan=flow.getGenerationPlan(f.workflow,sha),result=flow.getGenerationResult(f.workflow,sha);
 const material=flow.getGenerationResult(f.workflow,batch.planSha256s[0]).bytes,measure=coherentSurfaceObservations();measure.rockFeaturePairs[0].source.toX=160;
 const mapping=compileMeasuredSurfaceMapping({reference:f.raw,target:f.target,material,observations:measure}),placement=createBackgroundBandPlacement({plan,raw:result.bytes,sourceToWorld:{numerator:1,denominator:1},positionWorld:{x:-64,y:0}});
 return {...f,batch,sha,plan,result,composition:createMeasuredCoherentComposition(batch,f.target,mapping,{bandPlacements:[placement]})};
}
test('candidate gate binds the real relation plan, source bytes and technical QA, and fails closed',{timeout:300000},t=>{
 const f=setup(t,true),inputs={plan:f.plan,technical:f.result.result.technical,rawBytes:f.result.bytes,observations:observations()},report=reviewBandFeatureRelations(inputs),row={planSha256:f.sha,observations:inputs.observations,report},before=flow.inspectWorkflow(f.workflow);
 assert.equal(report.status,'reviewed');const build=(name,rows)=>flow.buildCoherentCandidate(f.workflow,f.batch.sha256,'band.fixture',join(f.parent,name),f.composition,rows);
 assert.throws(()=>build('missing',undefined));assert.equal(existsSync(join(f.parent,'missing')),false);
 const missingObservation=inputs.observations.slice(0,1),missingReport=reviewBandFeatureRelations({...inputs,observations:missingObservation});assert.equal(missingReport.status,'blocked');assert.throws(()=>build('missing-observation',[{...row,observations:missingObservation,report:missingReport}]));
 const uncertain=structuredClone(inputs.observations);uncertain[1].x=[.3,.45];const uncertainReport=reviewBandFeatureRelations({...inputs,observations:uncertain});assert.equal(uncertainReport.status,'blocked');assert.throws(()=>build('uncertain',[{...row,observations:uncertain,report:uncertainReport}]));
 const violated=structuredClone(inputs.observations);violated[1].x=[.8,.8];const rejected=reviewBandFeatureRelations({...inputs,observations:violated});assert.equal(rejected.status,'blocked');assert.throws(()=>build('rejected',[{...row,observations:violated,report:rejected}]));
 assert.throws(()=>build('stale',[{...row,observations:uncertain}]));assert.throws(()=>build('wrong-plan',[{...row,planSha256:'0'.repeat(64)}]));
 const fakeTechnical=seal({...unseal(inputs.technical),pixelIdentityAssessed:true}),fakeReport=reviewBandFeatureRelations({...inputs,technical:fakeTechnical});assert.equal(fakeReport.status,'reviewed');assert.throws(()=>build('fake-qa',[{...row,report:fakeReport}]));
 assert.deepEqual(flow.inspectWorkflow(f.workflow),before);
 const root=join(f.parent,'candidate'),bundle=build('candidate',[row]),verified=flow.verifyCoherentCandidate(f.workflow,f.batch.sha256,'band.fixture',root,f.composition);
 assert.equal(verified.bundleSha256,bundle.sha256);const evidence=join(root,'evidence/band-relations-reviews.json'),saved=readFileSync(evidence);try{writeFileSync(evidence,JSON.stringify([{...row,observations:uncertain}]));assert.throws(()=>flow.verifyCoherentCandidate(f.workflow,f.batch.sha256,'band.fixture',root,f.composition));}finally{writeFileSync(evidence,saved);}
 assert.deepEqual(flow.inspectWorkflow(f.workflow),before);
});
test('a candidate without explicit relation constraints remains compatible',{timeout:300000},t=>{
 const f=setup(t,false),root=join(f.parent,'legacy'),bundle=flow.buildCoherentCandidate(f.workflow,f.batch.sha256,'legacy.fixture',root,f.composition);
 assert.equal(flow.verifyCoherentCandidate(f.workflow,f.batch.sha256,'legacy.fixture',root,f.composition).bundleSha256,bundle.sha256);
});
test('rebound source relation review uses exact target plan and current rebound identity',{timeout:300000},t=>{
 const source=setup(t,true),target=setupCoherent(t,'Band gate synthetic',undefined,{transformBrief,transformAnalysis:a=>{const value=unseal(transformAnalysis(a)),instances=value.instances.map(i=>i.instanceId==='rear.actual'?{...i,anchor:{...i.anchor,x:i.anchor.x+1}}:i);return seal({...value,instances});}});
 const scope=flow.createLayerSourceScopes(target.brief.requirements,[{subjectId:'rear',parentRole:'far',content:'A synthetic valley band.',exclusions:[],backgroundBand:band(),bandFeatureRelations:relations(hash(target.raw))}]),batch=flow.freezeCoherentSources(target.workflow,{...target.options,sourceScopes:scope}),targetSha=batch.planSha256s.find(s=>flow.getGenerationPlan(target.workflow,s).recipe.assetId==='rear.actual'),targetPlan=flow.getGenerationPlan(target.workflow,targetSha);
 const options={sourceWorkflow:source.workflow,sourcePlanSha256:source.sha,targetPlanSha256:targetSha,targetSha256:targetPlan.recipe.targetSha256,scopeSha256:targetPlan.sourceScope.definition.sha256},proposal=flow.proposeCoherentRebind(target.workflow,options).proposal;
 const rebound=flow.commitCoherentRebind(target.workflow,{...options,proposal,rebindId:'band.rebind',parentBatchSha256:batch.sha256,batchId:'band.rebound',receipt:decision('band.rebind.review',proposal.sha256)}),plan=flow.getGenerationPlan(target.workflow,rebound.record.sha256),result=flow.getGenerationResult(target.workflow,plan.sha256),obs=observations(),report=flow.reviewCoherentBandRelations(target.workflow,plan.sha256,obs),row={planSha256:plan.sha256,observations:obs,report};
 const inputs=[{plan,reviewPlan:targetPlan,result:result.result,raw:result.bytes}];assert.equal(report.status,'reviewed');assert.deepEqual(assertCandidateBandRelationReviews(inputs,[row]),[row]);
 assert.throws(()=>assertCandidateBandRelationReviews(inputs,[{...row,planSha256:targetSha}]));assert.throws(()=>assertCandidateBandRelationReviews([{...inputs[0],reviewPlan:source.plan}],[row]));
 assert.throws(()=>assertCandidateBandRelationReviews([{...inputs[0],raw:Buffer.from('tampered')}],[row]));
});
test('CLI preserves both reviewed and blocked observations without source mutation',{timeout:300000},t=>{
 const f=setup(t,true),before=flow.inspectWorkflow(f.workflow),script=join(process.cwd(),'game-scene-harnesses/scene-kit-harness/scripts/coherent.mjs');
 for(const [name,obs,expected,exit] of [['good',observations(),'reviewed',0],['bad',[{featureId:'peak',x:[.2,.2],y:[.2,.2]},{featureId:'tower',x:[.8,.8],y:[.2,.2]}],'blocked',2]]){
  const input=join(f.parent,name+'-observations.json'),output=join(f.parent,name+'-review.json');writeFileSync(input,JSON.stringify(obs));
  const call=spawnSync(process.execPath,[script,'band-relations-review','--root',f.root,'--source',f.sha,'--observations',input,'--out',output],{encoding:'utf8'});
  assert.equal(call.status,exit,call.stderr);const review=JSON.parse(readFileSync(output));assert.equal(review.status,expected);assert.equal(review.humanArtAcceptance,'not-assessed');assert.equal(review.planSha256,f.sha);
 }
 assert.deepEqual(flow.inspectWorkflow(f.workflow),before);
});
