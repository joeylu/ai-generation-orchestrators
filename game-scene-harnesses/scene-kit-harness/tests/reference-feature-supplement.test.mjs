import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {join} from 'node:path';
import * as flow from '../src/generation/index.mjs';
import {createReferenceStructure,resolveReferenceFeatureTargets,reviewReferenceFeatureLayout,assertCompositionStructureCoversSources} from '../src/reference-feature-layout.mjs';
import {createFeatureCoherentComposition} from '../src/coherent-composition.mjs';
import {compileMeasuredSurfaceMapping} from '../src/terrain-proof/measured-field.mjs';
import {seal,unseal,hash,digest} from '../src/generation/common.mjs';import {encodeRgbaPng} from '../src/png.mjs';
import {setupCoherent,referencePng,sourcePng,coherentSurfaceObservations} from './helpers/coherent.mjs';import {decision} from './helpers/generation.mjs';
const points=[{x:200,y:100},{x:400,y:100},{x:300,y:250}];
const structure=raw=>createReferenceStructure({referenceRawSha256:hash(raw),viewport:{width:256,height:144},assets:[{instanceId:'landmark.actual',subjectId:'landmark',compositionProfile:'source-owned-feature-group-v1',features:points.map((n,i)=>({featureId:'outer.'+i,description:'Fixed frame point '+i,target:{x:50+n.x/4,y:25+n.y/4},toleranceWorld:1})),checks:[{checkId:'frame',description:'Retain the fixed frame and openings.'}]}]});
const supplemental=s=>{const proposal=seal({format:'ai_scene_reference_feature_supplement_v1',structureSha256:s.sha256,evidenceSha256:'e'.repeat(64),additions:[{instanceId:'landmark.actual',features:[{featureId:'inner',description:'Internal crossbar center',target:{x:125,y:65},toleranceWorld:1}],checks:[{checkId:'partition',description:'Inner bar retains the upper opening partition.'}]}]});return {proposal,decision:decision('supplement.review',proposal.sha256)};};
const reseal=(s,change)=>{const body=structuredClone(unseal(s.proposal));change(body);const proposal=seal(body);return {proposal,decision:decision('changed.review',proposal.sha256)};};
const code=(e,c)=>e.errors?.some(x=>x.code===c);
test('supplement only appends reviewed features and checks under the exact immutable base',()=>{
 const s=structure(referencePng()),a=supplemental(s),v=resolveReferenceFeatureTargets(s,undefined,a);
 assert.deepEqual(v.assets[0].features.slice(0,3),s.assets[0].features);assert.deepEqual(v.assets[0].checks.slice(0,1),s.assets[0].checks);assert.equal(v.assets[0].features.length,4);assert.equal(s.assets[0].features.length,3);
 for(const mutate of [p=>p.structureSha256='b'.repeat(64),p=>p.additions[0].instanceId='unknown',p=>p.additions[0].features[0].featureId='outer.0',p=>p.additions[0].checks[0].checkId='frame',p=>p.additions[0].features[0].toleranceWorld=40,p=>p.additions[0].features[0].target.y=200,p=>p.additions.push(p.additions[0]),p=>{p.additions[0].features=[];p.additions[0].checks=[];}])assert.throws(()=>resolveReferenceFeatureTargets(s,undefined,reseal(a,mutate)));
 assert.throws(()=>resolveReferenceFeatureTargets(s,undefined,{...a,decision:decision('stale','b'.repeat(64))}),e=>code(e,'REFERENCE_FEATURE_SUPPLEMENT_DECISION'));
 const correctionProposal=seal({format:'ai_scene_reference_feature_correction_v1',structureSha256:s.sha256,evidenceSha256:'c'.repeat(64),changes:[{instanceId:'landmark.actual',featureId:'outer.1',oldTarget:{x:150,y:50},target:{x:151,y:50},reason:'Independent synthetic coordinate review.'}]});
 const correction={proposal:correctionProposal,decision:decision('erratum',correctionProposal.sha256)};
 const combined=resolveReferenceFeatureTargets(s,correction,a);assert.equal(combined.assets[0].features[1].target.x,151);assert.equal(combined.assets[0].features[3].target.y,65);
});

test('correct supplemental member cannot hide a regressed original frame',()=>{
 // A different composition from the scene sample: a synthetic triangular
 // industrial frame. The added internal member stays at its reference position
 // while the right outer attachment is displaced on the new source.
 const s=structure(referencePng()),a=supplemental(s),raw=sourcePng(true,31);
 const plan=seal({recipe:{assetId:'landmark.actual'},referenceEvidence:[{rawSha256:s.referenceRawSha256}],instanceBinding:{subjectId:'landmark'},sourceScope:{definition:{referenceStructure:s,featureSupplement:a}}});
 const m={instanceId:'landmark.actual',sourcePlanSha256:plan.sha256,sourceRawSha256:hash(raw),features:[
  ...points.map((native,i)=>({featureId:'outer.'+i,native:i===1?{x:native.x+96,y:native.y}:native})),
  {featureId:'inner',native:{x:300,y:160}}
 ],checks:[{checkId:'frame',verdict:'pass'},{checkId:'partition',verdict:'pass'}]};
 const report=reviewReferenceFeatureLayout({structure:s,supplement:a,sources:[{plan,raw}],measurements:[m]});
 assert.equal(report.status,'blocked');assert(report.rows[0].issues.includes('REFERENCE_FEATURE_SHAPE_MISMATCH'));
 assert.deepEqual(report.rows[0].points.map(p=>p.featureId),['outer.0','outer.1','outer.2','inner']);
 assert(report.rows[0].points.filter(p=>p.featureId.startsWith('outer.')).some(p=>p.error>p.toleranceWorld));
 assert.deepEqual(report.rows[0].points.slice(0,3).map(p=>p.target),s.assets[0].features.map(f=>f.target));
 assert.equal(report.sourcePngModified,false);assert.equal(report.generationCalls,0);
});

test('supplement survives source revision, reviewed guide replay, candidate gates and delivery export',{timeout:180000},t=>{
 const f=setupCoherent(t),s=structure(f.raw),a=supplemental(s),spec={format:'ai_scene_source_frame_guide_spec_v1',referenceRawSha256:hash(f.raw),referenceViewport:s.viewport,instanceId:'landmark.actual',frameWorld:{x:32,y:16,width:192,height:144},markerRadiusWorld:1};
 const preview=extra=>flow.previewSourceFrameGuide({spec,structure:s,role:'landmark',referenceBytes:f.raw,...extra}),oldGuide=preview({});
 const scopes=flow.createLayerSourceScopes(f.brief.requirements,[{subjectId:'landmark',parentRole:'far',content:'Fixed industrial frame with an internal bar.',exclusions:['Moving load'],framingProfile:'complete-silhouette-v1',referenceStructure:s,sourceFrameGuide:{spec,decision:decision('old.guide',oldGuide.proposal.sha256)}}]);
 const batch=flow.freezeCoherentSources(f.workflow,{...f.options,sourceScopes:scopes}),old=flow.getGenerationPlan(f.workflow,batch.planSha256s.find(sha=>flow.getGenerationPlan(f.workflow,sha).recipe.assetId==='landmark.actual'));
 flow.authorizePlan(f.workflow,old.sha256,decision('old.compute',old.sha256,'approve-compute'));
 const extended=flow.withReferenceFeatureSupplement(old.recipe.sourceScope,a);
 const revision=scope=>({batchId:'supplement.batch',replacements:[{assetId:'landmark.actual',planId:'supplement.source',intent:'isolated-layer-v4',sourceScope:scope}]});
 assert.throws(()=>flow.reviseCoherentSources(f.workflow,batch.sha256,revision(extended)),e=>code(e,'SOURCE_FRAME_GUIDE_DECISION'));
 const guide=preview({supplement:a});assert.equal(guide.recipe.featureIds.length,4);assert.notEqual(guide.artifact.sha256,oldGuide.artifact.sha256);
 const selected=flow.withSourceFrameGuide(extended,{spec,decision:decision('new.guide',guide.proposal.sha256)}),updated=flow.reviseCoherentSources(f.workflow,batch.sha256,revision(selected));
 const plan=flow.getGenerationPlan(f.workflow,updated.planSha256s.find(x=>!batch.planSha256s.includes(x)));
 assert.deepEqual(flow.getGenerationPlan(f.workflow,old.sha256),old);assert.deepEqual(plan.recipe.sourceScope.referenceStructure,s);assert.equal(plan.sourceScope.featureSupplementSha256,digest(a));assert.match(plan.request.prompt,/inner \(Internal crossbar center\)/);
 assert.deepEqual(flow.readGenerationInput(f.workflow,plan.sha256,1),guide.bytes);assert.throws(()=>flow.reservePlan(f.workflow,plan.sha256),e=>code(e,'AUTHORIZATION_REQUIRED'));
 const bare=unseal(plan.recipe.sourceScope);delete bare.featureSupplement;
 assert.throws(()=>flow.reviseCoherentSources(f.workflow,updated.sha256,{...revision(seal(bare)),batchId:'drop.batch'}),e=>code(e,'REFERENCE_FEATURE_SUPPLEMENT_REVISION_CHANGE'));
 const changed=reseal(a,p=>p.additions[0].features[0].target.y++);
 assert.throws(()=>flow.reviseCoherentSources(f.workflow,updated.sha256,{...revision(flow.withReferenceFeatureSupplement(plan.recipe.sourceScope,changed)),batchId:'change.batch'}),e=>code(e,'REFERENCE_FEATURE_SUPPLEMENT_REVISION_CHANGE'));
 const rgba=Buffer.alloc(512*512*4);for(let y=90;y<=260;y++)for(let x=190;x<=410;x++)if(x<210||x>390||y<110||y>240||y>=155&&y<=165)rgba.set([80+x%90,110,145,255],(y*512+x)*4);
 const raw=encodeRgbaPng(512,512,rgba),source={plan,raw},m={instanceId:'landmark.actual',sourcePlanSha256:plan.sha256,sourceRawSha256:hash(raw),features:[...points.map((native,i)=>({featureId:'outer.'+i,native})),{featureId:'inner',native:{x:300,y:160}}],checks:[{checkId:'frame',verdict:'pass'},{checkId:'partition',verdict:'pass'}]};
 assert.throws(()=>reviewReferenceFeatureLayout({structure:s,sources:[source],measurements:[m]}),e=>code(e,'REFERENCE_FEATURE_SUPPLEMENT_REQUIRED'));
 assert.throws(()=>assertCompositionStructureCoversSources({format:'ai_scene_coherent_composition_v6',referenceStructure:s},[source]),e=>code(e,'REFERENCE_FEATURE_SUPPLEMENT_REQUIRED'));
 const missing={...m,features:m.features.slice(0,3)};assert.equal(reviewReferenceFeatureLayout({structure:s,sources:[source],measurements:[missing],supplement:a}).status,'blocked');
 flow.authorizeReferenceAssetBatch(f.workflow,updated.sha256,decision('new.compute',updated.sha256,'approve-compute'));const material=sourcePng(false,27);
 for(const sha of updated.planSha256s){const p=flow.getGenerationPlan(f.workflow,sha),{request,...ticket}=flow.reservePlan(f.workflow,sha);flow.recordSubmission(f.workflow,ticket);flow.receiveResult(f.workflow,ticket,sha===plan.sha256?raw:p.instanceBinding.role==='material'?material:sourcePng(p.target.alpha==='transparent',27));}
 const mapping=compileMeasuredSurfaceMapping({reference:f.raw,target:f.target,material,observations:coherentSurfaceObservations()}),composition=createFeatureCoherentComposition(updated,f.target,mapping,s,[m],{featureSupplement:a});
 assert.equal(flow.reviewCoherentReferenceFeatures(f.workflow,updated.sha256,composition).status,'reviewed');
 const blocked=createFeatureCoherentComposition(updated,f.target,mapping,s,[missing],{featureSupplement:a});assert.throws(()=>flow.checkCoherentCandidateRelations(f.workflow,updated.sha256,null,null,blocked),e=>code(e,'REFERENCE_FEATURE_LAYOUT_BLOCKED'));
 const out=join(f.parent,'supplement.delivery');flow.buildCoherentCandidate(f.workflow,updated.sha256,'supplement.kit',out,composition);flow.verifyCoherentCandidate(f.workflow,updated.sha256,'supplement.kit',out,composition);
 assert.deepEqual(JSON.parse(readFileSync(join(out,'evidence/reference-feature-supplement.json'))),a);assert.deepEqual(JSON.parse(readFileSync(join(out,'evidence/reference-structure.json'))),s);
 assert.equal(JSON.parse(readFileSync(join(out,'evidence/reference-feature-review.json'))).supplementSha256,digest(a));assert.equal(hash(readFileSync(join(out,'source/landmark.actual.png'))),hash(raw));
});
