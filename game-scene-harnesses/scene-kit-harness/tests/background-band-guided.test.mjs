import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import * as flow from '../src/generation/index.mjs';
import * as pipeline from '../src/coherent-pipeline.mjs';
import {validateBackgroundBand,backgroundBandPrompt} from '../src/generation/background-band.mjs';
import {backgroundBandGuide,BACKGROUND_BAND_GUIDE_PROFILE,BACKGROUND_BAND_GUIDE_IMAGE_ROLE} from '../src/generation/background-band-guide.mjs';
import {compileCoherentSource,coherentSourceBackgroundBandGuideInputs,verifyCoherentSourceExtraInputs} from '../src/generation/coherent-source.mjs';
import {transact} from '../src/generation/store.mjs';
import {replay} from '../src/generation/model.mjs';
import {createBackgroundBandPlacement} from '../src/background-band-placement.mjs';
import {createMeasuredCoherentComposition} from '../src/coherent-composition.mjs';
import {compileMeasuredSurfaceMapping} from '../src/terrain-proof/measured-field.mjs';
import {loadSceneKit,contextFor,readMap} from '../src/kit.mjs';
import {exportScene,openSceneExport} from '../src/persistence.mjs';
import {compileMap} from '../src/compile.mjs';
import {encodeRgbaPng,inspectPng} from '../src/png.mjs';
import {seal,unseal,hash,digest} from '../src/generation/common.mjs';
import {coherentBrief,coherentAnalysis,referencePng,sourcePng,coherentSurfaceObservations} from './helpers/coherent.mjs';
import {decision} from './helpers/generation.mjs';

const rejects=(fn,code)=>assert.throws(fn,e=>e.errors?.some(issue=>issue.code===code));
const band=(guided=false)=>({format:guided?'ai_scene_background_band_v2':'ai_scene_background_band_v1',
  profile:guided?'background-band-guided-v2':'background-band-v1',...(guided?{guidanceProfile:BACKGROUND_BAND_GUIDE_PROFILE}:{}),
  camera:{referenceCenterWorld:{x:128,y:72},centerDomainWorld:{minX:96,maxX:160,minY:56,maxY:88},viewportWorld:{width:256,height:144},modes:['editor-unparallax','play-parallax']},
  parallax:{x:.3,y:1},coverageFrameWorld:{x:-48,y:8,width:352,height:176},canvasAspect:{numerator:2,denominator:1},
  edges:{top:{purpose:'transparent-silhouette'},left:{purpose:'camera-overdraw'},right:{purpose:'camera-overdraw'},bottom:{purpose:'camera-overdraw'}}});
function brief(){const b=coherentBrief('Synthetic snow bands');return {...b,requirements:seal({...unseal(b.requirements),subjects:[...b.requirements.subjects,
  {subjectId:'ridges',role:'backdrop',layerId:'landmark',content:'Distant bare snow peaks only; no forest valley.',count:{min:1,max:1},placementHint:'wide'},
  {subjectId:'valley',role:'valley',layerId:'landmark',content:'One rear forest valley and its own lower snow rock painting; no distant snow peaks.',count:{min:1,max:1},placementHint:'wide'}]})};}
const overrides=(b,guided)=>['ridges','valley'].map(subjectId=>({subjectId,content:b.requirements.subjects.find(s=>s.subjectId===subjectId).content,
  exclusions:[],parentRole:'far',backgroundBand:band(guided)}));
function receive(workflow,plan,bytes){const {request,...ticket}=flow.reservePlan(workflow,plan.sha256);flow.recordSubmission(workflow,ticket);return flow.receiveResult(workflow,ticket,bytes);}
function rawBand(seed=0,clipped=false){const width=512,height=256,rgba=Buffer.alloc(width*height*4);
  for(let y=2;y<254;y++)for(let x=2;x<510;x++)if(y>=20+Math.floor(x/30)%10)rgba.set([50+(x+seed)%120,75+(y+seed)%90,110+seed,255],(y*width+x)*4);
  rgba.set([19,23,29,0],0);rgba.set([30,40,50,1],(10*width+1)*4);if(clipped)rgba.set([50,60,70,255],(200*width)*4);
  return encodeRgbaPng(width,height,rgba);}
function withBands(a){return seal({...unseal(a),instances:[...a.instances,...['ridges','valley'].map((subjectId,i)=>({instanceId:subjectId+'.actual',subjectId,layerId:'landmark',
  visibleEnvelope:[{x:20+i*60,y:10},{x:90+i*60,y:10},{x:90+i*60,y:60},{x:20+i*60,y:60}],anchor:{x:55+i*60,y:35},visibility:'visible',anchorEvidence:'observed',notes:'Synthetic coarse envelope, never a generation pixel target.'}))]});}

test('guided-v2 is an explicit typed asset-local continuation profile; v1 text and exact policy remain separate',()=>{
  const old=band(),guided=band(true);validateBackgroundBand(old,{role:'backdrop'});validateBackgroundBand(guided,{role:'valley'});
  assert.equal(flow.GUIDED_BACKGROUND_BAND_PROFILE,'background-band-guided-v2');
  assert.match(backgroundBandPrompt(guided),/NEW SAME-LAYER content/);assert.match(backgroundBandPrompt(guided),/two percent/);
  assert.match(backgroundBandPrompt(guided),/not curl upward into a closed mountain foot/);
  assert.doesNotMatch(backgroundBandPrompt(old),/Image 2|two percent|NEW SAME-LAYER/);
  assert.match(backgroundBandPrompt(old),/at least TWO native pixels/);
  for(const mutate of [b=>delete b.guidanceProfile,b=>b.guidanceProfile='deep-shadow-complete-fixture-v1',b=>b.edges.left.purpose='occlusion-overlap',b=>b.profile='background-band-v1']){
    const bad=band(true);mutate(bad);assert.throws(()=>validateBackgroundBand(bad,{role:'backdrop'}));
  }
  rejects(()=>validateBackgroundBand(guided,{role:'foreground'}),'BACKGROUND_BAND_ROLE');
  assert.notEqual(digest(old),digest(guided));assert.deepEqual(old.camera,guided.camera);assert.deepEqual(old.coverageFrameWorld,guided.coverageFrameWorld);
});

test('public guided revision preserves failed-v1 and unused authorization, binds two exact inputs, receives doubles and derives full-native v5',{timeout:600000},t=>{
  const parent=mkdtempSync(join(tmpdir(),'guided-background-band-'));t.after(()=>rmSync(parent,{recursive:true,force:true}));
  const root=join(parent,'project'),b=brief(),init=pipeline.initCoherentPipeline(root,{...b,sourceScopes:overrides(b,false)},{purpose:'synthetic-simulation'}),workflow=join(root,'workflow');
  // First-theme v2 overrides are public typed input too; init itself never computes.
  const firstRoot=join(parent,'first-guided'),first=pipeline.initCoherentPipeline(firstRoot,{...b,sourceScopes:overrides(b,true)},{purpose:'synthetic-simulation'});
  assert.equal(first.stage,'awaiting-design-review');assert.equal(flow.inspectWorkflow(join(firstRoot,'workflow')).plans.length,0);
  assert.equal(JSON.parse(readFileSync(join(firstRoot,'source-scopes.json'))).subjects.find(s=>s.subjectId==='ridges').backgroundBand.format,'ai_scene_background_band_v2');
  pipeline.reviewCoherentDesign(root,{spec:decision('guided.spec',init.design.specSha256),style:decision('guided.style',init.design.styleSha256)});
  const planned=pipeline.advanceCoherentPipeline(root),reference=flow.getGenerationPlan(workflow,planned.reference.planSha256),referenceRaw=referencePng();
  pipeline.authorizeCoherentStage(root,decision('guided.reference.compute',reference.sha256,'approve-compute'));receive(workflow,reference,referenceRaw);
  const analysis=withBands(coherentAnalysis(reference,hash(referenceRaw),b.requirements)),packet=pipeline.prepareCoherentReferenceReview(root,analysis,join(parent,'reference-review'));
  const oldStatus=pipeline.reviewCoherentReference(root,analysis,decision('guided.reference.accept',packet.packetSha256)),oldBatchSha=oldStatus.batchSha256,
    oldPlans=oldStatus.sources.map(s=>flow.getGenerationPlan(workflow,s.planSha256)),oldBands=oldPlans.filter(p=>['backdrop','valley'].includes(p.instanceBinding.role));
  // Fixed complete v1 bytes: the guided branch must never rewrite a historical
  // one-input request, even when the new helper is installed in the same core.
  assert.deepEqual(oldBands.map(p=>[hash(p.request.prompt),p.sha256,digest(p.request)]),[
    ['287528c7e72586e58aa1547768eafe1a005257d64a67f70cf6851304546c8a8f','16736314f15a320b0ace1b2e8d36cd9559caf59fa457ddf72518a0ba76ab9954','46f388e6286bc9428c39826922fe98040c4db112aa1a85f2866ca94145818a55'],
    ['e4f337ad116aa37eee415813e1b3940915b3e062560a97779cced4ccd4485ff2','dba1754d46a2dddc265fef3982ee4d8def15b71c0cb334dfe50f16cd98bd1d27','23e1851e1800df096f153c4489f51f06a53c71601ed8603c7f150c5bb5c09cf6'],
  ]);
  const guidedScopes=flow.withBackgroundBandScopes(b.requirements,JSON.parse(readFileSync(join(root,'source-scopes.json'))),['ridges','valley'].map(subjectId=>({subjectId,backgroundBand:band(true)}))),
    preview=flow.previewCoherentSources(workflow,{batchId:'guided.first.preview',referencePlanSha256:reference.sha256,capabilitiesSha256:reference.recipe.capabilitiesSha256,sourceScopes:guidedScopes}),
    previewBands=preview.plans.filter(p=>['backdrop','valley'].includes(p.instanceBinding.role));
  for(const p of previewBands){
    assert.match(p.compiler,/-background-band-v2-guide-v1$/);assert.equal(p.request.images.length,2);
    assert.deepEqual(p.request.images.map(i=>i.role),['accepted-scene-style-material-light-reference',BACKGROUND_BAND_GUIDE_IMAGE_ROLE]);
    assert.doesNotMatch(p.request.prompt,/Keep at least 12 percent|Center the one group|majority-surfaces-deep-shadow-v1|"minX"|"coverageFrameWorld"/);
    assert.match(p.request.prompt,/NEW SAME-LAYER content/);assert.match(p.request.prompt,/TECHNICAL INPUT 2 demonstrates ONLY/);
    assert.equal(p.sourceScope.backgroundBandGuideEvidence.role,p.instanceBinding.role);
    assert.deepEqual(coherentSourceBackgroundBandGuideInputs(p),[backgroundBandGuide(BACKGROUND_BAND_GUIDE_PROFILE,p.instanceBinding.role).bytes]);
    for(const mutate of [x=>x.request.images[1].role='neutral-deep-shadow-complete-fixture-example',x=>x.sourceScope.backgroundBandGuideEvidence.recipeSha256='0'.repeat(64),
      x=>x.sourceScope.backgroundBandGuideEvidence.role=x.instanceBinding.role==='valley'?'backdrop':'valley',x=>x.request.images.reverse()]){
      const bad=structuredClone(p);mutate(bad);rejects(()=>coherentSourceBackgroundBandGuideInputs(bad),'BACKGROUND_BAND_GUIDE_INPUT');
    }
    rejects(()=>verifyCoherentSourceExtraInputs(p,()=>Buffer.alloc(8)),'BACKGROUND_BAND_GUIDE_REPLAY');
  }
  transact(workflow,store=>{const state=replay(store),p=previewBands[0],cap=state.capabilities.get(p.recipe.capabilitiesSha256);
    state.capabilities.set(cap.sha256,{...cap,maxInputImages:1});rejects(()=>compileCoherentSource(state,p.recipe,sha=>store.readBlob(sha)),'BACKGROUND_BAND_GUIDE_CAPABILITY');});
  pipeline.authorizeCoherentStage(root,decision('guided.old.batch.compute',oldBatchSha,'approve-compute'));
  const rejected=oldBands.find(p=>p.instanceBinding.role==='backdrop'),unused=oldBands.find(p=>p.instanceBinding.role==='valley'),failedRaw=rawBand(0,true);
  for(const [i,p]of oldPlans.entries())if(p!==unused)receive(workflow,p,p===rejected?failedRaw:sourcePng(p.target.alpha==='transparent',i));
  const oldBefore=flow.inspectWorkflow(workflow),oldRejected=oldBefore.plans.find(p=>p.planSha256===rejected.sha256),oldUnused=oldBefore.plans.find(p=>p.planSha256===unused.sha256);
  assert.equal(oldRejected.status,'rejected-technical');assert.equal(oldUnused.status,'authorized');assert.equal(oldUnused.reserved,false);
  const replacements=oldBands.map((p,i)=>({assetId:p.recipe.assetId,planId:'guided.revision.'+i,intent:'isolated-layer-v4',sourceScope:flow.withBackgroundBand(p.recipe.sourceScope,band(true))})),
    revisedStatus=pipeline.reviseCoherentStage(root,{batchId:'guided.revision',replacements}),changed=revisedStatus.sources.filter(p=>!oldPlans.some(old=>old.sha256===p.planSha256));
  assert.equal(changed.length,2);assert(changed.every(p=>p.status==='planned'));assert.equal(revisedStatus.remainingSourceCalls,2);
  rejects(()=>flow.reservePlan(workflow,changed[0].planSha256),'AUTHORIZATION_REQUIRED');
  const reviewRoot=join(parent,'compute-review'),review=pipeline.exportCoherentComputeReview(root,reviewRoot),scopeReview=JSON.parse(readFileSync(join(reviewRoot,'source-scope-review.json'))),snapshot=JSON.parse(readFileSync(join(reviewRoot,'compute-snapshot.json')));
  assert.equal(snapshot.remainingCalls,2);assert.equal(snapshot.targetSha256,revisedStatus.batchSha256);
  for(const p of scopeReview.sources.filter(p=>p.backgroundBandGuideEvidence))assert.equal(p.backgroundBandGuideEvidence.imageRole,BACKGROUND_BAND_GUIDE_IMAGE_ROLE);
  assert.equal(scopeReview.sources.filter(p=>p.backgroundBandGuideEvidence).length,2);
  for(const [i,p]of snapshot.plans.entries())if(p.sourceScope?.backgroundBandGuideEvidence){assert.deepEqual(readFileSync(join(reviewRoot,`input-${i+1}-1.png`)),referenceRaw);
    assert.deepEqual(readFileSync(join(reviewRoot,`input-${i+1}-2.png`)),backgroundBandGuide(BACKGROUND_BAND_GUIDE_PROFILE,p.instanceBinding.role).bytes);}
  assert.equal(review.generationCalls,0);pipeline.authorizeCoherentStage(root,decision('guided.fresh.compute',revisedStatus.batchSha256,'approve-compute'));
  const received=[];
  for(let i=0;i<2;i++){
    const exchangeRoot=join(parent,'exchange-'+i),exchange=pipeline.reserveCoherentExchange(root,exchangeRoot),p=flow.getGenerationPlan(workflow,exchange.ticket.planSha256),raw=rawBand(i+1),file=join(parent,'result-'+i+'.png');
    assert.equal(exchange.inputs.length,2);assert.equal(exchange.inputs[1].role,BACKGROUND_BAND_GUIDE_IMAGE_ROLE);assert.equal(exchange.maximumCalls,1);assert.equal(exchange.automaticRetry,false);
    assert.deepEqual(flow.readGenerationInput(workflow,p.sha256,0),referenceRaw);assert.deepEqual(flow.readGenerationInput(workflow,p.sha256,1),backgroundBandGuide(BACKGROUND_BAND_GUIDE_PROFILE,p.instanceBinding.role).bytes);
    assert.deepEqual(readFileSync(join(exchangeRoot,'input-2.png')),flow.readGenerationInput(workflow,p.sha256,1));writeFileSync(file,raw);
    pipeline.receiveCoherentExchange(root,exchangeRoot,file);assert.equal(flow.getGenerationResult(workflow,p.sha256).result.technical.status,'pass');received.push({plan:p,raw});
  }
  const ready=pipeline.inspectCoherentPipeline(root);assert.equal(ready.stage,'ready-to-deliver');const inputs=pipeline.coherentSurfaceInputs(root),observations=coherentSurfaceObservations();observations.rockFeaturePairs[0].source.toX=160;
  const mapping=compileMeasuredSurfaceMapping({reference:{raw:referenceRaw},material:{raw:inputs.material.raw},target:inputs.target,observations}),
    placements=received.map(({plan,raw})=>createBackgroundBandPlacement({plan,raw,sourceToWorld:{numerator:1,denominator:1},positionWorld:{x:-64,y:0},target:inputs.target})),
    composition=createMeasuredCoherentComposition(inputs.batch,inputs.target,mapping,{bandPlacements:placements,contacts:[]}),output=join(parent,'candidate');
  assert.equal(composition.format,'ai_scene_coherent_composition_v5');flow.buildCoherentCandidate(workflow,ready.batchSha256,'guided.candidate',output,composition);
  assert.equal(flow.verifyCoherentCandidate(workflow,ready.batchSha256,'guided.candidate',output,composition).status,'deterministic-proof-valid');
  const handle=loadSceneKit(join(output,'kit')),context=contextFor(handle);
  for(const {plan,raw}of received){assert.deepEqual(readFileSync(join(output,'source',plan.recipe.assetId+'.png')),raw);
    const original=inspectPng(raw,{includePixels:true,allowHiddenRgb:true}),derived=inspectPng(context.files.get('assets/scene.'+plan.recipe.assetId+'.png'),{includePixels:true});
    assert.deepEqual([derived.width,derived.height],[original.width,original.height]);for(let n=0;n<original.rgba.length;n+=4)assert.deepEqual(derived.rgba.subarray(n,n+4),original.rgba[n+3]?original.rgba.subarray(n,n+4):Buffer.alloc(4));
    const evidence=JSON.parse(readFileSync(join(output,'evidence',plan.recipe.assetId+'-placement.json')));assert.equal(evidence.geometry,'finite-full-frame-and-alpha8-range-pass');assert.equal(evidence.contentContinuity,'not-assessed');
    assert.equal(evidence.sourceSampling.targetReached,false);assert.equal(context.catalog.modules.find(m=>m.assetId==='scene.'+plan.recipe.assetId).repeatAxis,'none');
  }
  const exported=join(parent,'export');exportScene(handle,readMap(handle),exported);assert.equal(openSceneExport(exported).compiled.contentSha256,compileMap(handle,readMap(handle)).contentSha256);
  assert.deepEqual(flow.getGenerationResult(workflow,rejected.sha256).bytes,failedRaw);const after=flow.inspectWorkflow(workflow);
  assert.deepEqual(after.plans.find(p=>p.planSha256===rejected.sha256),oldRejected);assert.deepEqual(after.plans.find(p=>p.planSha256===unused.sha256),oldUnused);
});
