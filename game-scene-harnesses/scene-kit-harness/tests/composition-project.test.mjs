import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,writeFileSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,sep,basename} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync,spawnSync} from 'node:child_process';
import {initCoherentPipeline,inspectCoherentPipeline,reviewCoherentDesign,advanceCoherentPipeline,coherentComputeSnapshot,prepareCoherentSourceScopeReview,deliverCoherentPipeline,exportCoherentComputeReview} from '../src/coherent-pipeline.mjs';
import * as flow from '../src/generation/index.mjs';
import {coherentBrief,coherentAnalysis,referencePng,sourcePng} from './helpers/coherent.mjs';
import {decision} from './helpers/generation.mjs';
import {seal,unseal,jsonBytes,hash} from '../src/generation/common.mjs';
import {encodeRgbaPng} from '../src/png.mjs';
const read=p=>JSON.parse(readFileSync(p,'utf8'));
function parent(t){const p=mkdtempSync(join(tmpdir(),'scene-kit-composition-project-'));t.after(()=>{assert(resolve(p).startsWith(resolve(tmpdir())+sep)&&basename(p).startsWith('scene-kit-composition-project-'));rmSync(p,{recursive:true,force:true});});return p;}
function guide(seed=0,width=256,height=144){const rgba=Buffer.alloc(width*height*4,255);for(let y=20;y<height-20;y++)for(let x=20;x<width-20;x++)rgba.set([70+seed,90+seed,110+seed,255],(y*width+x)*4);return encodeRgbaPng(width,height,rgba);}
const brief=(city=true)=>({...coherentBrief(city?'City soft layout':'Natural soft layout'),referenceGuidanceProfile:'soft-composition-v3',...(city?{visualObservations:{sceneFamily:'engineered-city'}}:{})});
const guideInput=(bytes,id='fixture.guide')=>({bytes,receipt:decision(id,hash(bytes))});
function initialized(t,city=true){const p=parent(t),root=join(p,'project'),bytes=guide(),b=brief(city),status=initCoherentPipeline(root,b,{purpose:'synthetic-simulation',compositionGuide:guideInput(bytes)});return {parent:p,root,workflow:join(root,'workflow'),bytes,brief:b,status};}
function acceptDesign(f){return reviewCoherentDesign(f.root,{spec:decision('fixture.spec',f.status.design.specSha256),style:decision('fixture.style',f.status.design.styleSha256)});}
const rejects=(fn,code)=>assert.throws(fn,e=>e.errors?.some(x=>x.code===code));

test('missing, unaccepted, wrong-image and incompatible guide inputs fail before creating a project',t=>{
 const p=parent(t),bytes=guide();
 for(const [i,input]of [undefined,{bytes,receipt:decision('reject',hash(bytes),'reject')},{bytes,receipt:decision('wrong','0'.repeat(64))},{...guideInput(bytes),extra:true},guideInput(guide(0,256,256))].entries()){
  const root=join(p,'invalid-'+i);assert.throws(()=>initCoherentPipeline(root,brief(),{purpose:'synthetic-simulation',...(input?{compositionGuide:input}:{})}));assert.equal(existsSync(root),false);
 }
 const legacy=join(p,'legacy-wrong');assert.throws(()=>initCoherentPipeline(legacy,{...coherentBrief('legacy')},{purpose:'synthetic-simulation',compositionGuide:guideInput(bytes)}));assert.equal(existsSync(legacy),false);
});

test('v7 uses the reviewed third image for city or natural themes while guide approval authorizes no compute',t=>{
 for(const city of [true,false]){
  const f=initialized(t,city),profile=read(join(f.root,'coherent-project.json'));
  assert.equal(profile.format,'ai_scene_coherent_project_v7');assert.equal(profile.referenceGuidanceProfile,'soft-composition-v3');
  assert.equal(f.status.stage,'awaiting-design-review');assert.equal(f.status.reference,null);assert.equal(f.status.assemblyRequirements.surfaceMappingRequired,true);
  const state=flow.inspectWorkflow(f.workflow),bound=state.compositionGuides.find(x=>x.sha256===profile.compositionGuideSha256);assert(bound);assert.equal(bound.specSha256,f.status.design.specSha256);assert.equal(bound.imageSha256,hash(f.bytes));
  const status=acceptDesign(f),snapshot=coherentComputeSnapshot(f.root),p=snapshot.plans[0];
  assert.equal(status.stage,'awaiting-reference-compute');assert.equal(p.format,'ai_scene_generation_plan_v32');assert.equal(p.request.images.length,3);
  assert.equal(p.request.images[2].role,'accepted-soft-composition-guide');assert.equal(p.recipe.compositionGuideSha256,profile.compositionGuideSha256);
  assert.deepEqual(flow.readGenerationInput(f.workflow,p.sha256,2),f.bytes);assert.equal(p.inputPolicy.compositionPixelLocking,false);
  assert.equal(snapshot.maximumCalls,1);assert.equal(snapshot.generationCalls,0);assert.equal(status.reference.status,'planned');
  rejects(()=>flow.reservePlan(f.workflow,p.sha256),'AUTHORIZATION_REQUIRED');
  const reviewRoot=join(f.parent,'compute-review');exportCoherentComputeReview(f.root,reviewRoot);assert.deepEqual(readFileSync(join(reviewRoot,'input-1-3.png')),f.bytes);
 }
});

test('an initialized v7 cannot drop its accepted guide by re-sealing as v6 before the reference exists',t=>{
 const f=initialized(t),path=join(f.root,'coherent-project.json'),body=unseal(read(path));delete body.compositionGuideSha256;body.format='ai_scene_coherent_project_v6';body.referenceGuidanceProfile='isolated-component-v2';writeFileSync(path,jsonBytes(seal(body)));
 rejects(()=>inspectCoherentPipeline(f.root),'COHERENT_COMPOSITION_GUIDE_BINDING');
});

test('a frozen v7 cannot swap reviewed guides or disguise an existing v31 reference as v32',t=>{
 const f=initialized(t);acceptDesign(f);const path=join(f.root,'coherent-project.json'),profile=read(path),bytes=guide(8);
 const other=flow.importCoherentCompositionGuide(f.workflow,{guideId:'fixture.guide.two',specSha256:f.status.design.specSha256,receipt:decision('fixture.guide.two',hash(bytes))},bytes);
 writeFileSync(path,jsonBytes(seal({...unseal(profile),compositionGuideSha256:other.sha256})));rejects(()=>inspectCoherentPipeline(f.root),'COHERENT_REFERENCE_GUIDANCE_BINDING');
 const p=parent(t),root=join(p,'legacy'),legacy=initCoherentPipeline(root,{...coherentBrief('Legacy city'),referenceGuidanceProfile:'isolated-component-v2',visualObservations:{sceneFamily:'engineered-city'}},{purpose:'synthetic-simulation'});
 reviewCoherentDesign(root,{spec:decision('old.spec',legacy.design.specSha256),style:decision('old.style',legacy.design.styleSha256)});
 const oldPath=join(root,'coherent-project.json');writeFileSync(oldPath,jsonBytes(seal({...unseal(read(oldPath)),format:'ai_scene_coherent_project_v7',referenceGuidanceProfile:'soft-composition-v3',compositionGuideSha256:other.sha256})));
 rejects(()=>inspectCoherentPipeline(root),'COHERENT_COMPOSITION_GUIDE_BINDING');
});

test('accepted v32 drives the same city sources in preview and freeze and retains separate source compute and measured delivery gates',t=>{
 const f=initialized(t),status=acceptDesign(f),plan=flow.getGenerationPlan(f.workflow,status.reference.planSha256);
 flow.authorizePlan(f.workflow,plan.sha256,decision('fixture.reference.compute',plan.sha256,'approve-compute'));
 const {request,...ticket}=flow.reservePlan(f.workflow,plan.sha256);flow.recordSubmission(f.workflow,ticket);const raw=referencePng();assert.equal(flow.receiveResult(f.workflow,ticket,raw).technical.status,'pass');
 const req=read(join(f.root,'requirements.json')),analysis=coherentAnalysis(plan,hash(raw),req),packet=flow.buildMeasuredReferenceReview(f.workflow,plan.sha256,analysis,join(f.parent,'reference-review'));
 flow.reviewMeasuredReference(f.workflow,plan.sha256,analysis,decision('fixture.reference.accept',packet.packetSha256));
 const before=flow.inspectWorkflow(f.workflow),reviewRoot=join(f.parent,'source-review');prepareCoherentSourceScopeReview(f.root,reviewRoot);assert.deepEqual(flow.inspectWorkflow(f.workflow),before);
 const proposal=read(join(reviewRoot,'proposal.json')),next=advanceCoherentPipeline(f.root),snapshot=coherentComputeSnapshot(f.root);assert.equal(next.stage,'awaiting-source-compute');
 for(const p of snapshot.plans){assert.equal(p.compiler,'scene-kit-isolated-layer-source-v4-coherent-v2-engineered');assert.equal(p.request.prompt,proposal.plans.find(x=>x.recipe.assetId===p.recipe.assetId).request.prompt);rejects(()=>flow.reservePlan(f.workflow,p.sha256),'AUTHORIZATION_REQUIRED');}
 flow.authorizeReferenceAssetBatch(f.workflow,next.batchSha256,decision('fixture.sources.compute',next.batchSha256,'approve-compute'));
 for(const p of snapshot.plans){const {request,...ticket}=flow.reservePlan(f.workflow,p.sha256);flow.recordSubmission(f.workflow,ticket);assert.equal(flow.receiveResult(f.workflow,ticket,sourcePng(p.target.alpha==='transparent')).technical.status,'pass');}
 assert.equal(inspectCoherentPipeline(f.root).stage,'ready-to-deliver');const out=join(f.parent,'unmeasured');rejects(()=>deliverCoherentPipeline(f.root,out),'COHERENT_SURFACE_MAPPING_REQUIRED');assert.equal(existsSync(out),false);
});

test('CLI imports the explicit paired local guide inputs without planning or invoking an image adapter',t=>{
 const p=parent(t),bytes=guide(),briefPath=join(p,'brief.json'),imagePath=join(p,'guide.png'),receiptPath=join(p,'guide-decision.json'),root=join(p,'project'),cli=fileURLToPath(new URL('../scripts/coherent.mjs',import.meta.url));
 writeFileSync(briefPath,jsonBytes(brief()));writeFileSync(imagePath,bytes);writeFileSync(receiptPath,jsonBytes(decision('cli.guide',hash(bytes))));
 const result=JSON.parse(execFileSync(process.execPath,[cli,'init','--brief',briefPath,'--out',root,'--composition-guide',imagePath,'--guide-decision',receiptPath],{encoding:'utf8'}));
 assert.equal(result.stage,'awaiting-design-review');assert.equal(result.reference,null);assert.equal(result.referenceGuidanceProfile,'soft-composition-v3');assert.equal(flow.inspectWorkflow(join(root,'workflow')).plans.length,0);
 const invalid=join(p,'invalid'),bad=spawnSync(process.execPath,[cli,'init','--brief',briefPath,'--out',invalid,'--composition-guide',imagePath],{encoding:'utf8'});
 assert.notEqual(bad.status,0);assert.match(bad.stderr,/COHERENT_ARGUMENTS/);assert.equal(existsSync(invalid),false);
});
