import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import * as flow from '../src/generation/index.mjs';
import {createReferenceStructure,reviewReferenceFeatureLayout} from '../src/reference-feature-layout.mjs';
import {REFERENCE_INTENT_CRITERIA} from '../src/reference-intent-review.mjs';
import {createFeatureCoherentComposition} from '../src/coherent-composition.mjs';
import {compileMeasuredSurfaceMapping} from '../src/terrain-proof/measured-field.mjs';
import {seal,unseal,hash,digest} from '../src/generation/common.mjs';
import {setupCoherent,referencePng,sourcePng,coherentSurfaceObservations} from './helpers/coherent.mjs';
import {decision} from './helpers/generation.mjs';
const points=[{x:120,y:100},{x:360,y:100},{x:240,y:300}];
const declaration=raw=>createReferenceStructure({referenceRawSha256:hash(raw),viewport:{width:256,height:144},assets:[{instanceId:'landmark.actual',subjectId:'landmark',features:points.map((p,i)=>({featureId:'frame.'+i,description:'Observed industrial frame attachment',target:{x:40+p.x/4,y:20+p.y/4},toleranceWorld:1})),checks:[{checkId:'spacing',description:'Retain reference attachment spacing.'}]}]});
const measurement=(plan,raw)=>({instanceId:'landmark.actual',sourcePlanSha256:plan.sha256,sourceRawSha256:hash(raw),features:points.map((p,i)=>({featureId:'frame.'+i,native:{x:p.x+(i===1?60:0),y:p.y}})),checks:[{checkId:'spacing',verdict:'fail'}]});
const intent=(s,m)=>seal({format:'ai_scene_reference_intent_review_v1',profile:'reference-inspired-v1',structureSha256:s.sha256,measurementsSha256:digest([m]),evidenceSha256:'e'.repeat(64),reviewer:'agent',intentReason:'User requests a usable reference-inspired industrial frame, with variable attachment spacing.',assets:[{instanceId:m.instanceId,sourcePlanSha256:m.sourcePlanSha256,sourceRawSha256:m.sourceRawSha256,acceptedFeatureIds:s.assets[0].features.map(f=>f.featureId),acceptedCheckIds:['spacing'],judgments:REFERENCE_INTENT_CRITERIA.map(criterion=>({criterion,verdict:'pass',notes:'Synthetic explicit observation of this criterion; not automated vision.'}))}]});
const mutate=(p,fn)=>{const v=structuredClone(unseal(p));fn(v);return seal(v);};
const hasCode=(error,code)=>error.errors?.some(e=>e.code===code);

test('explicit intent accepts declared layout variation but retains strict diagnosis and functional gates',()=>{
 const s=declaration(referencePng()),raw=sourcePng(true,31),plan=seal({recipe:{assetId:'landmark.actual'},referenceEvidence:[{rawSha256:s.referenceRawSha256}],instanceBinding:{subjectId:'landmark'}}),m=measurement(plan,raw),policy=intent(s,m);
 const review=(measurements=[m],intentReview=policy)=>reviewReferenceFeatureLayout({structure:s,sources:[{plan,raw}],measurements,intentReview});
 const strict=reviewReferenceFeatureLayout({structure:s,sources:[{plan,raw}],measurements:[m]});assert.equal(strict.status,'blocked');
 const accepted=review();assert.equal(accepted.status,'reviewed');assert.equal(accepted.strictReferenceMatchStatus,'blocked');assert.equal(accepted.strictReviewSha256,strict.sha256);assert.deepEqual(accepted.rows[0].points,strict.rows[0].points);assert.deepEqual(accepted.rows[0].placement,strict.rows[0].placement);
 assert.equal(accepted.artAcceptance,'not-assessed');assert.equal(accepted.sourcePngModified,false);
 assert.equal(review([m],mutate(policy,p=>p.assets[0].acceptedFeatureIds=[])).status,'blocked');
 assert.equal(review([m],mutate(policy,p=>p.assets[0].acceptedCheckIds=[])).status,'blocked');
 for(const criterion of REFERENCE_INTENT_CRITERIA)for(const verdict of ['fail','uncertain'])assert.equal(review([m],mutate(policy,p=>p.assets[0].judgments.find(j=>j.criterion===criterion).verdict=verdict)).status,'blocked');
 const missing={...m,features:m.features.slice(0,2)},missingChecks={...m,checks:[]};
 for(const incomplete of [missing,missingChecks])assert.equal(review([incomplete],intent(s,incomplete)).status,'blocked');
 for(const change of [p=>p.assets[0].sourceRawSha256='c'.repeat(64),p=>p.structureSha256='b'.repeat(64),p=>p.measurementsSha256='a'.repeat(64),p=>p.assets[0].acceptedFeatureIds.push('unknown'),p=>p.assets.push(p.assets[0]),p=>p.assets[0].judgments.pop()])assert.throws(()=>review([m],mutate(policy,change)));
 assert.equal(reviewReferenceFeatureLayout({structure:s,sources:[{plan,raw}],measurements:[m]}).sha256,strict.sha256);
});

test('intent-aware candidate exports and replays the exact review without changing source plans or QA',{timeout:180000},t=>{
 const f=setupCoherent(t),s=declaration(f.raw),scopes=flow.createLayerSourceScopes(f.brief.requirements,[{subjectId:'landmark',parentRole:'far',content:'Fixed industrial frame.',exclusions:['Moving load'],referenceStructure:s}]);
 const batch=flow.freezeCoherentSources(f.workflow,{...f.options,sourceScopes:scopes}),plans=batch.planSha256s.map(sha=>flow.getGenerationPlan(f.workflow,sha)),plan=plans.find(p=>p.recipe.assetId==='landmark.actual');
 const raw=sourcePng(true,31),material=sourcePng(false,27),m=measurement(plan,raw),policy=intent(s,m);
 flow.authorizeReferenceAssetBatch(f.workflow,batch.sha256,decision('sources.compute',batch.sha256,'approve-compute'));
 for(const p of plans){const {request,...ticket}=flow.reservePlan(f.workflow,p.sha256);flow.recordSubmission(f.workflow,ticket);flow.receiveResult(f.workflow,ticket,p.sha256===plan.sha256?raw:p.instanceBinding.role==='material'?material:sourcePng(p.target.alpha==='transparent',27));}
 const mapping=compileMeasuredSurfaceMapping({reference:f.raw,target:f.target,material,observations:coherentSurfaceObservations()});
 const strict=createFeatureCoherentComposition(batch,f.target,mapping,s,[m]);
 assert.throws(()=>flow.checkCoherentCandidateRelations(f.workflow,batch.sha256,null,null,strict),e=>hasCode(e,'REFERENCE_FEATURE_LAYOUT_BLOCKED'));
 const composition=createFeatureCoherentComposition(batch,f.target,mapping,s,[m],{referenceIntentReview:policy});
 assert.equal(flow.checkCoherentCandidateRelations(f.workflow,batch.sha256,null,null,composition).status,'checked');
 const out=join(f.parent,'intent.delivery');flow.buildCoherentCandidate(f.workflow,batch.sha256,'intent.kit',out,composition);flow.verifyCoherentCandidate(f.workflow,batch.sha256,'intent.kit',out,composition);
 const report=JSON.parse(readFileSync(join(out,'evidence/reference-feature-review.json')));
 assert.equal(report.status,'reviewed');assert.equal(report.strictReferenceMatchStatus,'blocked');
 assert.deepEqual(JSON.parse(readFileSync(join(out,'evidence/reference-intent-review.json'))),policy);
 assert.deepEqual(flow.getGenerationPlan(f.workflow,plan.sha256),plan);assert.equal(hash(readFileSync(join(out,'source/landmark.actual.png'))),hash(raw));
 const failedPolicy=mutate(policy,p=>p.assets[0].judgments[0].verdict='fail'),blocked=createFeatureCoherentComposition(batch,f.target,mapping,s,[m],{referenceIntentReview:failedPolicy});
 assert.throws(()=>flow.checkCoherentCandidateRelations(f.workflow,batch.sha256,null,null,blocked),e=>hasCode(e,'REFERENCE_FEATURE_LAYOUT_BLOCKED'));
});
