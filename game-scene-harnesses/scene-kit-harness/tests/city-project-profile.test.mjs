import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,writeFileSync,existsSync,readdirSync} from 'node:fs';
import {join,relative} from 'node:path';
import {tmpdir} from 'node:os';
import {initCoherentPipeline,inspectCoherentPipeline,reviewCoherentDesign,reviewCoherentReference,advanceCoherentPipeline,coherentComputeSnapshot,prepareCoherentSourceScopeReview,prepareCoherentVisualReview} from '../src/coherent-pipeline.mjs';
import * as flow from '../src/generation/index.mjs';
import {VISUAL_COHERENCE_POLICY,VISUAL_COHERENCE_ENGINEERED_POLICY} from '../src/generation/visual-coherence.mjs';
import {coherentBrief,coherentAnalysis,referencePng} from './helpers/coherent.mjs';
import {decision} from './helpers/generation.mjs';
import {seal,unseal,jsonBytes,hash,digest} from '../src/generation/common.mjs';
const read=p=>JSON.parse(readFileSync(p,'utf8'));
function workspace(t){const root=mkdtempSync(join(tmpdir(),'scene-kit-city-project-'));t.after(()=>rmSync(root,{recursive:true,force:true}));return root;}
const city=()=>({...coherentBrief('Engineered cyberpunk city'),visualObservations:{sceneFamily:'engineered-city',lighting:'Small attached cyan and magenta fixtures, local colors retained.'}});
test('an explicit engineered city binds project v5 and observations v2 to the engineered policy, with no compute on planning',t=>{
 const root=join(workspace(t),'city'),status=initCoherentPipeline(root,city(),{purpose:'synthetic-simulation'}),profile=read(join(root,'coherent-project.json')),
  observations=read(join(root,'visual-observations.json'));
 assert.equal(profile.format,'ai_scene_coherent_project_v5');assert.equal(profile.visualCoherencePolicySha256,VISUAL_COHERENCE_ENGINEERED_POLICY.sha256);
 assert.equal(observations.format,'ai_scene_visual_observations_v2');assert.equal(observations.policySha256,profile.visualCoherencePolicySha256);
 assert.equal(status.assemblyRequirements.surfaceMappingRequired,true);assert.equal(status.assemblyRequirements.automaticCalibration,false);
 const receipt=(targetSha256,part)=>({decisionId:'city.fixture.'+part,targetSha256,decision:'accept',notes:'Synthetic design review only; no image compute.'});
 reviewCoherentDesign(root,{spec:receipt(status.design.specSha256,'spec'),style:receipt(status.design.styleSha256,'style')});
 const planned=advanceCoherentPipeline(root),snapshot=coherentComputeSnapshot(root);
 assert.equal(planned.stage,'awaiting-reference-compute');assert.equal(planned.reference.status,'planned');assert.equal(snapshot.maximumCalls,1);
 assert.equal(snapshot.plans[0].format,'ai_scene_generation_plan_v28');assert.equal(snapshot.plans[0].request.images.length,2);
 assert.equal(snapshot.generationCalls,0);assert.equal(snapshot.executable,false);
});
test('an unqualified legacy project retains v4 and the original v1 policy and observation shape',t=>{
 const root=join(workspace(t),'legacy');initCoherentPipeline(root,coherentBrief('Legacy material'),{purpose:'synthetic-simulation'});
 const profile=read(join(root,'coherent-project.json')),observations=read(join(root,'visual-observations.json'));
 assert.equal(profile.format,'ai_scene_coherent_project_v4');assert.equal(profile.visualCoherencePolicySha256,VISUAL_COHERENCE_POLICY.sha256);
 assert.equal(observations.format,'ai_scene_visual_observations_v1');assert.deepEqual(observations.observations,{});
});
test('unknown families and a re-sealed downgrade cannot silently apply natural rules to the city project',t=>{
 const parent=workspace(t),invalid=join(parent,'invalid');
 assert.throws(()=>initCoherentPipeline(invalid,{...city(),visualObservations:{sceneFamily:'unlisted-city'}},{purpose:'synthetic-simulation'}));
 assert.equal(existsSync(invalid),false);
 const root=join(parent,'city');initCoherentPipeline(root,city(),{purpose:'synthetic-simulation'});
 const path=join(root,'coherent-project.json'),record=read(path),body=unseal(record);
 writeFileSync(path,jsonBytes(seal({...body,format:'ai_scene_coherent_project_v4',visualCoherencePolicySha256:VISUAL_COHERENCE_POLICY.sha256})));
 assert.throws(()=>inspectCoherentPipeline(root),e=>e.errors?.some(issue=>issue.code==='COHERENT_PROJECT'));
});

function acceptedProject(t,brief){
 const parent=workspace(t),root=join(parent,'project'),workflow=join(root,'workflow'),initial=initCoherentPipeline(root,brief,{purpose:'synthetic-simulation'});
 reviewCoherentDesign(root,{spec:decision('fixture.spec',initial.design.specSha256),style:decision('fixture.style',initial.design.styleSha256)});
 const planned=advanceCoherentPipeline(root),plan=flow.getGenerationPlan(workflow,planned.reference.planSha256);
 flow.authorizePlan(workflow,plan.sha256,decision('fixture.reference',plan.sha256,'approve-compute'));
 const {request,...ticket}=flow.reservePlan(workflow,plan.sha256);flow.recordSubmission(workflow,ticket);const raw=referencePng();flow.receiveResult(workflow,ticket,raw);
 const analysis=coherentAnalysis(plan,hash(raw),read(join(root,'spec-draft.json')).requirements),packet=flow.buildMeasuredReferenceReview(workflow,plan.sha256,analysis,join(parent,'reference-review'));
 reviewCoherentReference(root,analysis,decision('fixture.reference.accept',packet.packetSha256));
 return {parent,root,workflow,raw};
}
function bundleFingerprint(root){
 const artifacts=readdirSync(root,{recursive:true,withFileTypes:true}).filter(entry=>entry.isFile()).map(entry=>{
  const path=join(entry.parentPath??entry.path,entry.name);return {path:relative(root,path).replaceAll('\\','/'),sha256:hash(readFileSync(path))};
 }).sort((a,b)=>a.path.localeCompare(b.path));
 return digest(artifacts);
}
test('city scope previews, including source overrides, use the same engineered contract as the actual next source batch',t=>{
 const f=acceptedProject(t,city()),before=flow.inspectWorkflow(f.workflow),directory=join(f.parent,'scope-review');
 const review=prepareCoherentSourceScopeReview(f.root,directory),proposal=read(join(directory,'proposal.json'));
 assert.equal(review.frozen,false);assert.equal(review.executable,false);assert.equal(review.generationCalls,0);
 assert.deepEqual(readFileSync(join(directory,'input-reference.png')),f.raw);
 for(const plan of proposal.plans){
  assert.equal(plan.compiler,'scene-kit-isolated-layer-source-v4-coherent-v2-engineered');
  assert.equal(plan.sourceScope.definition.visualCoherence.policySha256,VISUAL_COHERENCE_ENGINEERED_POLICY.sha256);
 }
 const override={subjectId:'foreground',parentRole:'foreground',content:'One isolated compact junction box with attached feet.',exclusions:['unrelated fixtures']};
 const overrideDirectory=join(f.parent,'scope-override');prepareCoherentSourceScopeReview(f.root,overrideDirectory,[override]);
 const overridden=read(join(overrideDirectory,'proposal.json')).plans.filter(plan=>plan.instanceBinding.role==='foreground');
 assert(overridden.length>0);assert(overridden.every(plan=>plan.sourceScope.definition.content===override.content));
 assert(overridden.every(plan=>plan.sourceScope.definition.visualCoherence.sceneFamily==='engineered-city'));
 assert.deepEqual(flow.inspectWorkflow(f.workflow),before);
 assert.equal(prepareCoherentSourceScopeReview(f.root,directory).sha256,review.sha256);
 assert.deepEqual(flow.inspectWorkflow(f.workflow),before);
 const next=advanceCoherentPipeline(f.root),snapshot=coherentComputeSnapshot(f.root);assert.equal(next.stage,'awaiting-source-compute');
 assert.equal(snapshot.maximumCalls,proposal.plans.length);assert.equal(snapshot.generationCalls,0);
 for(const actual of snapshot.plans){
  const preview=proposal.plans.find(plan=>plan.recipe.assetId===actual.recipe.assetId);assert(preview);
  assert.equal(actual.compiler,preview.compiler);assert.equal(actual.request.prompt,preview.request.prompt);
  assert.equal(actual.sourceScope.definition.visualCoherence.sha256,preview.sourceScope.definition.visualCoherence.sha256);
  assert.throws(()=>flow.reservePlan(f.workflow,actual.sha256),error=>error.errors?.some(issue=>issue.code==='AUTHORIZATION_REQUIRED'));
 }
});
test('city visual observation overrides retain the family without silently importing or discarding observations',t=>{
 const f=acceptedProject(t,city()),before=flow.inspectWorkflow(f.workflow);
 for(const [name,observations] of [['empty',{}],['appearance',{brushwork:'Broad painted panels with restrained fittings.'}]]){
  const output=join(f.parent,name),review=prepareCoherentVisualReview(f.root,output,observations),shared=read(join(output,'visual-coherence.json'));
  assert.equal(shared.sceneFamily,'engineered-city');assert.equal(shared.policySha256,VISUAL_COHERENCE_ENGINEERED_POLICY.sha256);
  assert.deepEqual(shared.observations,{sceneFamily:'engineered-city',...observations});
  assert(read(join(output,'proposal.json')).plans.every(plan=>plan.compiler==='scene-kit-isolated-layer-source-v4-coherent-v2-engineered'));
  assert.equal(review.generationCalls,0);assert.equal(review.frozen,false);assert.equal(review.executable,false);
 }
 const invalid=join(f.parent,'invalid-family');assert.throws(()=>prepareCoherentVisualReview(f.root,invalid,{sceneFamily:'natural'}));
 assert.equal(existsSync(invalid),false);assert.deepEqual(flow.inspectWorkflow(f.workflow),before);
});
test('absent-family scope preview artifacts keep their complete bytes and legacy visual overrides retain replacement semantics',t=>{
 const f=acceptedProject(t,coherentBrief('Legacy city preview compatibility')),before=flow.inspectWorkflow(f.workflow),output=join(f.parent,'scope-preview');
 prepareCoherentSourceScopeReview(f.root,output);
 assert.equal(bundleFingerprint(output),'42dc277194e6ad579f5c03bbd8da98352beda6419be6b16e07b0494cb36535fa');
 const overrideDirectory=join(f.parent,'visual-override'),observations={brushwork:'A new explicit appearance observation.'};
 prepareCoherentVisualReview(f.root,overrideDirectory,observations);
 const shared=read(join(overrideDirectory,'visual-coherence.json'));assert.equal(shared.format,'ai_scene_visual_coherence_v1');
 assert.deepEqual(shared.observations,observations);assert.equal(Object.hasOwn(shared,'sceneFamily'),false);
 assert.deepEqual(flow.inspectWorkflow(f.workflow),before);
});
