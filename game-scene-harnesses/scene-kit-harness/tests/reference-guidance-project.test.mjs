import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,writeFileSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {initCoherentPipeline,inspectCoherentPipeline,reviewCoherentDesign,advanceCoherentPipeline,coherentComputeSnapshot,prepareCoherentSourceScopeReview,deliverCoherentPipeline} from '../src/coherent-pipeline.mjs';
import * as flow from '../src/generation/index.mjs';
import {coherentBrief,coherentAnalysis,referencePng,sourcePng} from './helpers/coherent.mjs';
import {decision} from './helpers/generation.mjs';
import {seal,unseal,jsonBytes,hash} from '../src/generation/common.mjs';
const read=p=>JSON.parse(readFileSync(p,'utf8'));
function parent(t){const p=mkdtempSync(join(tmpdir(),'scene-kit-reference-guidance-'));t.after(()=>rmSync(p,{recursive:true,force:true}));return p;}
const brief=(city=true,guided=true)=>({...coherentBrief(city?'City wall-mounted fixture study':'Natural independent foreground study'),
 ...(city?{visualObservations:{sceneFamily:'engineered-city'}}:{}),...(guided?{referenceGuidanceProfile:'isolated-component-v2'}:{})});
function planned(t,b){const p=parent(t),root=join(p,'project'),s=initCoherentPipeline(root,b,{purpose:'synthetic-simulation'});
 reviewCoherentDesign(root,{spec:decision('fixture.spec',s.design.specSha256),style:decision('fixture.style',s.design.styleSha256)});
 return {parent:p,root,workflow:join(root,'workflow'),state:inspectCoherentPipeline(root)};}

test('the guidance profile is explicit typed data and invalid profiles fail before creating a project',t=>{
 const p=parent(t);for(const [i,value]of ['unknown',null,{}].entries()){
  const root=join(p,'invalid-'+i);assert.throws(()=>initCoherentPipeline(root,{...brief(),referenceGuidanceProfile:value},{purpose:'synthetic-simulation'}));assert.equal(existsSync(root),false);
 }
});

test('v6 chooses the actual v31 reference contract for both explicit city and non-city observations without authorizing compute',t=>{
 for(const city of [true,false]){
  const f=planned(t,brief(city)),profile=read(join(f.root,'coherent-project.json')),observations=read(join(f.root,'visual-observations.json'));
  assert.equal(profile.format,'ai_scene_coherent_project_v6');assert.equal(profile.referenceGuidanceProfile,'isolated-component-v2');
  assert.equal(observations.format,city?'ai_scene_visual_observations_v2':'ai_scene_visual_observations_v1');
  assert.equal(f.state.referenceGuidanceProfile,'isolated-component-v2');assert.equal(f.state.assemblyRequirements.surfaceMappingRequired,true);
  assert.equal(f.state.reference.status,'planned');const before=flow.inspectWorkflow(f.workflow),snapshot=coherentComputeSnapshot(f.root),plan=snapshot.plans[0];
  assert.equal(plan.format,'ai_scene_generation_plan_v31');assert.equal(plan.request.images.length,2);
  assert.equal(plan.request.images[0].artifact.sha256,'2619d46aa41b10867799487cb0547579081a5ba45d95e817d2b2a760ac396e43');
  assert.equal(plan.request.images[1].artifact.sha256,'e0b82ccbce22883727c1cf55765d415a72c98395dc7faa614f97e9c099e1b162');
  assert.equal(snapshot.maximumCalls,1);assert.equal(snapshot.generationCalls,0);assert.equal(snapshot.executable,false);
  assert.equal(before.plans.find(p=>p.current&&p.stage==='reference').referenceGuidanceProfile,'isolated-component-v2');
  assert.throws(()=>flow.reservePlan(f.workflow,plan.sha256),e=>e.errors?.some(x=>x.code==='AUTHORIZATION_REQUIRED'));
  assert.deepEqual(flow.inspectWorkflow(f.workflow),before);
 }
});

test('re-sealed profile downgrade and reverse legacy upgrade cannot mislabel the actual frozen reference contract',t=>{
 const next=planned(t,brief()),path=join(next.root,'coherent-project.json'),body=unseal(read(path));
 delete body.referenceGuidanceProfile;body.format='ai_scene_coherent_project_v5';writeFileSync(path,jsonBytes(seal(body)));
 assert.throws(()=>inspectCoherentPipeline(next.root),e=>e.errors?.some(x=>x.code==='COHERENT_REFERENCE_GUIDANCE_BINDING'));
 const old=planned(t,brief(true,false)),oldPath=join(old.root,'coherent-project.json');
 assert.equal(flow.getGenerationPlan(old.workflow,old.state.reference.planSha256).format,'ai_scene_generation_plan_v28');
 writeFileSync(oldPath,jsonBytes(seal({...unseal(read(oldPath)),format:'ai_scene_coherent_project_v6',referenceGuidanceProfile:'isolated-component-v2'})));
 assert.throws(()=>inspectCoherentPipeline(old.root),e=>e.errors?.some(x=>x.code==='COHERENT_REFERENCE_GUIDANCE_BINDING'));
});

test('v6 city source preview and freeze agree, keep separate compute approval and still require measured surfaces before delivery',t=>{
 const f=planned(t,brief()),plan=flow.getGenerationPlan(f.workflow,f.state.reference.planSha256);
 flow.authorizePlan(f.workflow,plan.sha256,decision('fixture.reference.compute',plan.sha256,'approve-compute'));
 const {request,...ticket}=flow.reservePlan(f.workflow,plan.sha256);flow.recordSubmission(f.workflow,ticket);
 const raw=referencePng();assert.equal(flow.receiveResult(f.workflow,ticket,raw).technical.status,'pass');
 const req=read(join(f.root,'requirements.json')),analysis=coherentAnalysis(plan,hash(raw),req),packet=flow.buildMeasuredReferenceReview(f.workflow,plan.sha256,analysis,join(f.parent,'reference-review'));
 flow.reviewMeasuredReference(f.workflow,plan.sha256,analysis,decision('fixture.reference.accept',packet.packetSha256));
 const before=flow.inspectWorkflow(f.workflow),reviewRoot=join(f.parent,'source-review'),review=prepareCoherentSourceScopeReview(f.root,reviewRoot),proposal=read(join(reviewRoot,'proposal.json'));
 assert.equal(review.generationCalls,0);assert.deepEqual(flow.inspectWorkflow(f.workflow),before);
 const state=advanceCoherentPipeline(f.root),snapshot=coherentComputeSnapshot(f.root);assert.equal(state.stage,'awaiting-source-compute');
 assert.equal(snapshot.maximumCalls,6);assert.equal(snapshot.generationCalls,0);
 for(const p of snapshot.plans){const preview=proposal.plans.find(row=>row.recipe.assetId===p.recipe.assetId);
  assert.equal(p.compiler,'scene-kit-isolated-layer-source-v4-coherent-v2-engineered');assert.equal(p.request.prompt,preview.request.prompt);
  assert.equal(p.sourceScope.definition.visualCoherence.sceneFamily,'engineered-city');
  assert.throws(()=>flow.reservePlan(f.workflow,p.sha256),e=>e.errors?.some(x=>x.code==='AUTHORIZATION_REQUIRED'));
 }
 flow.authorizeReferenceAssetBatch(f.workflow,state.batchSha256,decision('fixture.sources.compute',state.batchSha256,'approve-compute'));
 for(const p of snapshot.plans){const {request,...ticket}=flow.reservePlan(f.workflow,p.sha256);flow.recordSubmission(f.workflow,ticket);
  assert.equal(flow.receiveResult(f.workflow,ticket,sourcePng(p.target.alpha==='transparent')).technical.status,'pass');
 }
 assert.equal(inspectCoherentPipeline(f.root).stage,'ready-to-deliver');
 const output=join(f.parent,'unmeasured-delivery');
 assert.throws(()=>deliverCoherentPipeline(f.root,output),e=>e.errors?.some(x=>x.code==='COHERENT_SURFACE_MAPPING_REQUIRED'));
 assert.equal(existsSync(output),false);
});
