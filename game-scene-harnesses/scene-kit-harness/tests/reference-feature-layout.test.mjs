import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {assertCompositionStructureCoversSources,createReferenceStructure,reviewReferenceFeatureLayout} from '../src/reference-feature-layout.mjs';
import {createFeatureCoherentComposition,createMeasuredCoherentComposition} from '../src/coherent-composition.mjs';
import {scopeForCoherentItem} from '../src/generation/layer-source.mjs';
import {compileMeasuredSurfaceMapping} from '../src/terrain-proof/measured-field.mjs';
import {seal,unseal,hash} from '../src/generation/common.mjs';
import {encodeRgbaPng,inspectPng} from '../src/png.mjs';
import {loadSceneKit,readMap,contextFor} from '../src/kit.mjs';
import {compileMap} from '../src/compile.mjs';
import {createSharedTerrainFieldProfile,SHARED_TERRAIN_UNION_PROFILE} from '../src/shared-terrain-field.mjs';
import {upgradeSharedTerrainFieldKit,verifySharedTerrainFieldKit} from '../src/shared-terrain-upgrade.mjs';
import * as flow from '../src/generation/index.mjs';
import {setupCoherent,sourcePng,coherentSurfaceObservations} from './helpers/coherent.mjs';
import {decision} from './helpers/generation.mjs';
const native=[{x:80,y:100},{x:400,y:100},{x:80,y:300}];
function structure(referenceRawSha256){return createReferenceStructure({referenceRawSha256,viewport:{width:256,height:144},assets:[{instanceId:'landmark.actual',subjectId:'landmark',
 features:native.map((p,i)=>({featureId:'part.'+i,description:'Synthetic explicit source feature '+i,target:{x:50+p.x/4,y:20+p.y/4},toleranceWorld:1})),checks:[{checkId:'open.gap',description:'The source retains the reference opening and adds no supporting wall.'}]}]});}
function raw(fringe=true){const w=512,h=512,rgba=Buffer.alloc(w*h*4);for(let y=100;y<=300;y++)for(let x=80;x<=400;x++)if(x<100||x>380||y<120)rgba.set([123+x%80,88,45,254],(y*w+x)*4);
 if(fringe){rgba.set([255,20,0,1],0);rgba.set([255,20,0,1],rgba.length-4);}return encodeRgbaPng(w,h,rgba);}
const measurements=(plan,bytes)=>[{instanceId:'landmark.actual',sourcePlanSha256:plan.sha256,sourceRawSha256:hash(bytes),features:native.map((p,i)=>({featureId:'part.'+i,native:p})),checks:[{checkId:'open.gap',verdict:'pass'}]}];
const dummy=ref=>seal({recipe:{assetId:'landmark.actual'},referenceEvidence:[{rawSha256:ref}],instanceBinding:{subjectId:'landmark'}});
const code=(e,c)=>e.errors?.some(x=>x.code===c);
test('a new reference registration can join existing sources without replacing frozen obligations',()=>{
 const existing=structure('a'.repeat(64)), first=existing.assets[0];
 const second={...first,instanceId:'band.actual',subjectId:'band'};
 const added=createReferenceStructure({...unseal(existing),assets:[second]});
 const source=referenceStructure=>({plan:{sourceScope:{definition:{referenceStructure}}}});
 const sources=[source(existing),source(added)];
 const compose=referenceStructure=>({format:'ai_scene_coherent_composition_v6',referenceStructure});
 const combined=createReferenceStructure({...unseal(existing),assets:[first,second]});
 assert.doesNotThrow(()=>assertCompositionStructureCoversSources(compose(combined),sources));
 assert.throws(()=>assertCompositionStructureCoversSources(compose(existing),sources),e=>code(e,'REFERENCE_STRUCTURE_COMPOSITION_REQUIRED'));
 const changed=structuredClone(unseal(combined));changed.assets[0].features[0].target.x++;
 assert.throws(()=>assertCompositionStructureCoversSources(compose(createReferenceStructure(changed)),sources),e=>code(e,'REFERENCE_STRUCTURE_COMPOSITION_REQUIRED'));
 const otherReference=createReferenceStructure({...unseal(added),referenceRawSha256:'b'.repeat(64)});
 assert.throws(()=>assertCompositionStructureCoversSources(compose(combined),[source(otherReference)]),e=>code(e,'REFERENCE_STRUCTURE_COMPOSITION_REQUIRED'));
});
test('feature fit ignores remote weak Alpha for calibration while retaining all original pixels',()=>{
 const ref='a'.repeat(64),s=structure(ref),p=dummy(ref),a=raw(),b=raw(false);
 const run=bytes=>reviewReferenceFeatureLayout({structure:s,sources:[{plan:p,raw:bytes}],measurements:measurements(p,bytes)});
 const x=run(a),y=run(b);assert.equal(x.status,'reviewed');assert.deepEqual(x.rows[0].placement,y.rows[0].placement);
 assert.deepEqual(x.rows[0].placement,{positionWorld:{x:50,y:20},sourceToWorld:{numerator:1,denominator:4}});
 assert.equal(x.sourcePngModified,false);assert.equal(x.automaticImageUnderstanding,false);
});
test('shape disagreement, missing features, unresolved structure and stale measurements fail closed',()=>{
 const ref='a'.repeat(64),s=structure(ref),p=dummy(ref),bytes=raw(),m=measurements(p,bytes),run=ms=>reviewReferenceFeatureLayout({structure:s,sources:[{plan:p,raw:bytes}],measurements:ms});
 const wrong=structuredClone(m);wrong[0].features[2].native.y=180;assert.equal(run(wrong).status,'blocked');assert(run(wrong).rows[0].issues.includes('REFERENCE_FEATURE_SHAPE_MISMATCH'));
 const missing=structuredClone(m);missing[0].features.pop();assert.equal(run(missing).status,'blocked');
 const uncertain=structuredClone(m);uncertain[0].checks[0].verdict='uncertain';assert.equal(run(uncertain).status,'blocked');
 assert.equal(run([]).status,'blocked');const stale=structuredClone(m);stale[0].sourceRawSha256='0'.repeat(64);assert.throws(()=>run(stale),e=>code(e,'REFERENCE_FEATURE_BINDING'));
 const extra=structuredClone(m);extra[0].features.push(extra[0].features[0]);assert.throws(()=>run(extra));
 assert.throws(()=>reviewReferenceFeatureLayout({structure:s,sources:[{plan:dummy('b'.repeat(64)),raw:bytes}],measurements:m}));
});
test('source plans preserve the same structure across revisions and opt into structure-aware prompts',{timeout:120000},t=>{
 const f=setupCoherent(t),s=structure(hash(f.raw)),scopes=flow.createLayerSourceScopes(f.brief.requirements,[{subjectId:'landmark',parentRole:'far',content:'Synthetic structure-bound landmark.',exclusions:[],referenceStructure:s}]);
  assert.throws(()=>flow.createLayerSourceScopes(f.brief.requirements,[{subjectId:'landmark',parentRole:'far',content:'Synthetic invalid structure.',exclusions:[],referenceStructure:null}]));
 const batch=flow.freezeCoherentSources(f.workflow,{...f.options,sourceScopes:scopes}),sha=batch.planSha256s.find(sha=>flow.getGenerationPlan(f.workflow,sha).recipe.assetId==='landmark.actual'),p=flow.getGenerationPlan(f.workflow,sha);
 assert.equal(p.sourceScope.definition.referenceStructure.sha256,s.sha256);assert(p.request.prompt.includes('REFERENCE STRUCTURE:'));assert(!p.request.prompt.includes('Its composition, neighboring subjects'));
  assert.equal(p.sourceScope.referenceUsage,'style-material-light-and-declared-reference-structure');assert.equal(p.request.images[0].role,'accepted-scene-style-material-light-and-declared-structure-reference');
 flow.authorizeReferenceAssetBatch(f.workflow,batch.sha256,decision('structure.compute',batch.sha256,'approve-compute'));
 const {request,...ticket}=flow.reservePlan(f.workflow,sha);flow.recordSubmission(f.workflow,ticket);flow.receiveResult(f.workflow,ticket,raw());
 const {referenceStructure,...rest}=unseal(p.sourceScope.definition),unbound=seal(rest);
 assert.throws(()=>flow.reviseCoherentSources(f.workflow,batch.sha256,{batchId:'structure.drop',replacements:[{assetId:'landmark.actual',planId:'structure.drop',intent:'isolated-layer-v4',sourceScope:unbound}]}),e=>code(e,'REFERENCE_STRUCTURE_REVISION_CHANGE'));
 const v=unseal(s);v.assets[0].features[0].target.x++;const changed=seal({...unseal(p.sourceScope.definition),referenceStructure:seal(v)});
 assert.throws(()=>flow.reviseCoherentSources(f.workflow,batch.sha256,{batchId:'structure.change',replacements:[{assetId:'landmark.actual',planId:'structure.change',intent:'isolated-layer-v4',sourceScope:changed}]}),e=>code(e,'REFERENCE_STRUCTURE_REVISION_CHANGE'));
 const next=flow.reviseCoherentSources(f.workflow,batch.sha256,{batchId:'structure.revise',replacements:[{assetId:'landmark.actual',planId:'structure.revise',intent:'isolated-layer-v4'}]});
 const revised=next.planSha256s.map(sha=>flow.getGenerationPlan(f.workflow,sha)).find(p=>p.recipe.assetId==='landmark.actual');assert.equal(revised.sourceScope.definition.referenceStructure.sha256,s.sha256);assert.notEqual(revised.sha256,sha);
});
test('v6 candidate gates before delivery, replays and uses full native RGBA with feature-calibrated placement',{timeout:180000},t=>{
 const f=setupCoherent(t),original=unseal(structure(hash(f.raw)));
 const target={...original.assets[0].features[0].target},oldTarget={x:target.x+18,y:target.y};
 original.assets[0].features[0].target=oldTarget;
 const s=seal(original),scopes=flow.createLayerSourceScopes(f.brief.requirements,[{subjectId:'landmark',parentRole:'far',content:'Synthetic structure-bound landmark.',exclusions:[],referenceStructure:s}]),batch=flow.freezeCoherentSources(f.workflow,{...f.options,sourceScopes:scopes}),material=sourcePng(false,27);
 flow.authorizeReferenceAssetBatch(f.workflow,batch.sha256,decision('feature.compute',batch.sha256,'approve-compute'));let plan;
 for(const sha of batch.planSha256s){const p=flow.getGenerationPlan(f.workflow,sha),{request,...ticket}=flow.reservePlan(f.workflow,sha);flow.recordSubmission(f.workflow,ticket);const b=p.recipe.assetId==='landmark.actual'?raw():p.instanceBinding.role==='material'?material:sourcePng(p.target.alpha==='transparent',27);flow.receiveResult(f.workflow,ticket,b);if(p.recipe.assetId==='landmark.actual')plan=p;}
 const mapping=compileMeasuredSurfaceMapping({reference:f.raw,target:f.target,material,observations:coherentSurfaceObservations()}),legacy=createMeasuredCoherentComposition(batch,f.target,mapping);
 const fail=join(f.parent,'unbound');assert.throws(()=>flow.buildCoherentCandidate(f.workflow,batch.sha256,'features.kit',fail,legacy),e=>code(e,'REFERENCE_STRUCTURE_COMPOSITION_REQUIRED'));assert.equal(existsSync(fail),false);
 const m=measurements(plan,raw()),baseline=createFeatureCoherentComposition(batch,f.target,mapping,s,m);
 assert.equal(flow.reviewCoherentReferenceFeatures(f.workflow,batch.sha256,baseline).status,'blocked');
 const proposal=seal({format:'ai_scene_reference_feature_correction_v1',structureSha256:s.sha256,
   evidenceSha256:'e'.repeat(64),changes:[{instanceId:'landmark.actual',featureId:'part.0',oldTarget,target,reason:'Synthetic review found the original coordinate on the neighboring stone.'}]});
 const featureCorrection={proposal,decision:decision('feature.coordinate.correction',proposal.sha256,'accept')};
 assert.throws(()=>createFeatureCoherentComposition(batch,f.target,mapping,s,m,{featureCorrection:{proposal,decision:decision('stale',s.sha256,'accept')}}),e=>code(e,'REFERENCE_FEATURE_CORRECTION_DECISION'));
 const profile=createFeatureCoherentComposition(batch,f.target,mapping,s,m,{featureCorrection}),bad=structuredClone(m);bad[0].checks[0].verdict='fail';
  assert.equal(flow.reviewCoherentReferenceFeatures(f.workflow,batch.sha256,profile).status,'reviewed');
 const blocked=createFeatureCoherentComposition(batch,f.target,mapping,s,bad,{featureCorrection}),fail2=join(f.parent,'blocked');assert.throws(()=>flow.buildCoherentCandidate(f.workflow,batch.sha256,'features.kit',fail2,blocked),e=>code(e,'REFERENCE_FEATURE_LAYOUT_BLOCKED'));assert.equal(existsSync(fail2),false);
  assert.equal(flow.reviewCoherentReferenceFeatures(f.workflow,batch.sha256,blocked).status,'blocked');
  assert.throws(()=>flow.checkCoherentCandidateRelations(f.workflow,batch.sha256,null,null,blocked),e=>code(e,'REFERENCE_FEATURE_LAYOUT_BLOCKED'));
 const out=join(f.parent,'features');flow.buildCoherentCandidate(f.workflow,batch.sha256,'features.kit',out,profile);flow.verifyCoherentCandidate(f.workflow,batch.sha256,'features.kit',out,profile);
 const k=loadSceneKit(join(out,'kit')),scene=compileMap(k,readMap(k)),n=scene.layers.flatMap(l=>l.nodes).find(n=>n.assetId==='scene.landmark.actual');assert.deepEqual(n.position,{x:50,y:20});assert.deepEqual(n.size,{width:128,height:128});
 const image=inspectPng(readFileSync(join(out,'kit',n.source.path)),{includePixels:true}),before=inspectPng(raw(),{includePixels:true});assert.equal(image.width,512);assert.deepEqual(image.rgba,before.rgba);assert.equal(hash(readFileSync(join(out,'source/landmark.actual.png'))),hash(raw()));
 const report=JSON.parse(readFileSync(join(out,'evidence/reference-feature-review.json')));assert.equal(report.status,'reviewed');assert.equal(report.artAcceptance,'not-assessed');
 assert.equal(report.structureSha256,s.sha256);
 assert.deepEqual(JSON.parse(readFileSync(join(out,'evidence/reference-feature-correction.json'))),featureCorrection);
 const appearance=contextFor(k).kit.terrainAppearance;
 assert.equal(appearance.format,'ai_scene_continuous_terrain_appearance_v5');
 const field=createSharedTerrainFieldProfile(appearance,{
   geometryProfile:SHARED_TERRAIN_UNION_PROFILE,
   outline:{maximumInsetWorld:4,sampleStepWorld:8,wavelengthWorld:64,seed:91},
   surfaceInterface:{profile:'world-body-native-lip-v1',capSourceSha256:appearance.cap.source.sha256,capEndRow:1,fadeRows:1},
 });
 const options={root:join(out,'kit'),document:readMap(k),profile:field,output:join(f.parent,'field')};
 const upgraded=upgradeSharedTerrainFieldKit(options);
 assert.equal(verifySharedTerrainFieldKit(options).reportSha256,upgraded.sha256);
 assert.equal(upgraded.allOriginalPngBytesPreserved,true);
 assert.equal(upgraded.collisionChanged,false);
});
test('structure-aware band requests still materialize and replay their exact second guide input',{timeout:120000},t=>{
 const f=setupCoherent(t,undefined,undefined,{transformBrief:b=>({...b,requirements:seal({...unseal(b.requirements),subjects:b.requirements.subjects.map(s=>s.subjectId==='landmark'?{...s,role:'valley'}:s)})})}),s=structure(hash(f.raw));
 const band={format:'ai_scene_background_band_v3',profile:'background-band-coverage-v3',guidanceProfile:'normalized-three-cut-coverage-v1',boundaryProfile:'natural-top-finite-three-cuts-v1',coverageBudget:structuredClone(flow.BACKGROUND_BAND_COVERAGE_BUDGET),
 camera:{referenceCenterWorld:{x:128,y:72},centerDomainWorld:{minX:96,maxX:160,minY:56,maxY:88},viewportWorld:{width:256,height:144},modes:['editor-unparallax','play-parallax']},parallax:{x:.3,y:1},coverageFrameWorld:{x:-48,y:8,width:352,height:176},canvasAspect:{numerator:2,denominator:1},edges:{top:{purpose:'transparent-silhouette'},left:{purpose:'camera-overdraw'},right:{purpose:'camera-overdraw'},bottom:{purpose:'camera-overdraw'}}};
 const scopes=flow.createLayerSourceScopes(f.brief.requirements,[{subjectId:'landmark',parentRole:'far',content:'Synthetic continuous valley.',exclusions:[],backgroundBand:band,referenceStructure:s}]),batch=flow.freezeCoherentSources(f.workflow,{...f.options,sourceScopes:scopes});
 const p=batch.planSha256s.map(sha=>flow.getGenerationPlan(f.workflow,sha)).find(p=>p.recipe.assetId==='landmark.actual');
 assert.equal(p.request.images.length,2);assert.equal(hash(flow.readGenerationInput(f.workflow,p.sha256,1)),p.request.images[1].artifact.sha256);
 assert(flow.readCoherentWorkflowView(f.workflow).plans.some(plan=>plan.sha256===p.sha256));
});
test('source batches cannot mix different structure contracts or leave declared owners unplanned',{timeout:120000},t=>{
 const f=setupCoherent(t),a=structure(hash(f.raw)),v=unseal(a),front=id=>({...v.assets[0],instanceId:id,subjectId:'foreground'});
 const global=seal({...v,assets:[v.assets[0],front('front.left'),front('front.right')]}),otherBody=structuredClone(unseal(global));otherBody.assets[0].checks[0].description+=' Changed design.';const other=seal(otherBody);
 const scopes=flow.createLayerSourceScopes(f.brief.requirements,[{subjectId:'landmark',parentRole:'far',content:'Synthetic landmark.',exclusions:[],referenceStructure:global},{subjectId:'foreground',parentRole:'foreground',content:'Synthetic foreground.',exclusions:[],referenceStructure:other}]);
 assert.throws(()=>flow.freezeCoherentSources(f.workflow,{...f.options,sourceScopes:scopes}),e=>code(e,'REFERENCE_STRUCTURE_BATCH_CONFLICT'));
 const missing=seal({...v,assets:[v.assets[0],{...v.assets[0],instanceId:'missing.actual'}]}),incomplete=flow.createLayerSourceScopes(f.brief.requirements,[{subjectId:'landmark',parentRole:'far',content:'Synthetic landmark.',exclusions:[],referenceStructure:missing}]);
 assert.throws(()=>flow.freezeCoherentSources(f.workflow,{...f.options,sourceScopes:incomplete}),e=>code(e,'REFERENCE_STRUCTURE_BATCH_COVERAGE'));
 assert.equal(flow.readCoherentWorkflowView(f.workflow).plans.filter(p=>p.recipe.stage==='coherent-source').length,0);
});
test('a revised batch adds disjoint source structure and rejects conflicting rows',t=>{
 const f=setupCoherent(t),requirements=f.brief.requirements,existing=structure(hash(f.raw));
 const scopes=flow.createLayerSourceScopes(requirements,[{subjectId:'landmark',parentRole:'far',content:'Synthetic landmark.',exclusions:[],referenceStructure:existing}]);
 const parent=flow.freezeCoherentSources(f.workflow,{...f.options,sourceScopes:scopes});
 const front={...existing.assets[0],instanceId:'front.left',subjectId:'foreground'};
 const revise=(suffix,assets)=>{
  const referenceStructure=createReferenceStructure({...unseal(existing),assets});
  const frontScopes=flow.createLayerSourceScopes(requirements,[{subjectId:'foreground',parentRole:'foreground',content:'Synthetic front.',exclusions:[],referenceStructure}]);
  const sourceScope=scopeForCoherentItem(requirements,frontScopes,{role:'foreground',instance:{subjectId:'foreground'}});
  return flow.reviseCoherentSources(f.workflow,parent.sha256,{batchId:'revision.'+suffix,replacements:[{assetId:'front.left',planId:'revision.front.'+suffix,intent:'isolated-layer-v4',sourceScope}]});
 };
 const conflict=structuredClone(existing.assets[0]);conflict.features[0].target.x++;
 assert.throws(()=>revise('conflict',[front,conflict]),e=>code(e,'REFERENCE_STRUCTURE_BATCH_CONFLICT'));
 const revised=revise('disjoint',[front]);
 assert.equal(revised.newImageRequests,1);
 assert.equal(revised.planSha256s.filter(sha=>!parent.planSha256s.includes(sha)).length,1);
 assert.equal(flow.readCoherentWorkflowView(f.workflow).batches.at(-1).sha256,revised.sha256);
});
test('feature compositions retain ordinary explicit-transform conventions for unrelated sources',{timeout:120000},t=>{
 const f=setupCoherent(t,undefined,undefined,{transformAnalysis:a=>seal({...unseal(a),instances:a.instances.map(i=>i.instanceId==='landmark.actual'?{...i,visibleEnvelope:[{x:10,y:35},{x:60,y:35},{x:60,y:95},{x:10,y:95}],anchor:{x:35,y:65}}:i)})}),base=structure(hash(f.raw));
 const s=seal({...unseal(base),assets:base.assets.map(a=>({...a,instanceId:'front.left',subjectId:'foreground'}))}),batch=flow.freezeCoherentSources(f.workflow,f.options),mapping=compileMeasuredSurfaceMapping({reference:f.raw,target:f.target,material:sourcePng(false,27),observations:coherentSurfaceObservations()});
 const transform=instanceId=>({instanceId,x:10,y:30,scale:{numerator:1,denominator:1},tint:0xffffff,opacity:1});
 const p=createFeatureCoherentComposition(batch,f.target,mapping,s,[],{transforms:[transform('landmark.actual')]});assert(!p.contacts.some(c=>c.instanceId==='landmark.actual'));
 assert.throws(()=>createFeatureCoherentComposition(batch,f.target,mapping,s,[],{transforms:[transform('front.left')]}),e=>code(e,'REFERENCE_FEATURE_PLACEMENT_CONFLICT'));
});
