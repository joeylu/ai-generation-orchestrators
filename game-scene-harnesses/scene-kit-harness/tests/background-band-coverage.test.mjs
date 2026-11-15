import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import * as flow from '../src/generation/index.mjs';
import {assessCoherentSource,coherentSourceBackgroundBandGuideInputs,verifyCoherentSourceExtraInputs,compileCoherentSource} from '../src/generation/coherent-source.mjs';
import {transact} from '../src/generation/store.mjs';
import {replay} from '../src/generation/model.mjs';
import {createMeasuredCoherentComposition} from '../src/coherent-composition.mjs';
import {compileMeasuredSurfaceMapping} from '../src/terrain-proof/measured-field.mjs';
import {loadSceneKit,contextFor,readMap} from '../src/kit.mjs';
import {exportScene,openSceneExport} from '../src/persistence.mjs';
import {compileMap} from '../src/compile.mjs';
import {encodeRgbaPng,inspectPng} from '../src/png.mjs';
import {seal,unseal,hash,digest} from '../src/generation/common.mjs';
import {setupCoherent,sourcePng,coherentSurfaceObservations} from './helpers/coherent.mjs';
import {decision} from './helpers/generation.mjs';

const reject=(fn,code)=>assert.throws(fn,e=>e.errors?.some(issue=>issue.code===code));
const band=(v=3)=>({format:`ai_scene_background_band_v${v}`,profile:v===2?'background-band-guided-v2':'background-band-coverage-v3',
  guidanceProfile:v===2?'three-edge-continuation-v1':'normalized-three-cut-coverage-v1',
  ...(v===3?{boundaryProfile:'natural-top-finite-three-cuts-v1',coverageBudget:structuredClone(flow.BACKGROUND_BAND_COVERAGE_BUDGET)}:{}),
  camera:{referenceCenterWorld:{x:128,y:72},centerDomainWorld:{minX:96,maxX:160,minY:56,maxY:88},viewportWorld:{width:256,height:144},modes:['editor-unparallax','play-parallax']},
  parallax:{x:.3,y:1},coverageFrameWorld:{x:-48,y:8,width:352,height:176},canvasAspect:{numerator:2,denominator:1},
  edges:{top:{purpose:'transparent-silhouette'},left:{purpose:'camera-overdraw'},right:{purpose:'camera-overdraw'},bottom:{purpose:'camera-overdraw'}}});
const transformBrief=b=>({...b,requirements:seal({...unseal(b.requirements),subjects:[...b.requirements.subjects,
  {subjectId:'ridges',role:'backdrop',layerId:'landmark',content:'Bare far ridges only, excluding the forest valley.',count:{min:1,max:1},placementHint:'wide'},
  {subjectId:'valley',role:'valley',layerId:'landmark',content:'Rear forest valley and its own lower slopes only, excluding far ridges.',count:{min:1,max:1},placementHint:'wide'}]})});
const transformAnalysis=a=>seal({...unseal(a),instances:[...a.instances,...['ridges','valley'].map((subjectId,i)=>({instanceId:subjectId+'.actual',subjectId,layerId:'landmark',
  visibleEnvelope:[{x:20+i*60,y:10},{x:90+i*60,y:10},{x:90+i*60,y:60},{x:20+i*60,y:60}],anchor:{x:55+i*60,y:35},visibility:'visible',anchorEvidence:'observed',notes:'Synthetic coarse envelope.'}))]});
function rawBand(seed=0){const width=512,height=256,rgba=Buffer.alloc(width*height*4);
  for(let x=0;x<width;x++)for(let y=12+Math.floor((Math.sin(x/40)+1)*8);y<height;y++)rgba.set([45+(x+seed)%120,80+(y+seed)%90,111+seed,254],(y*width+x)*4);
  rgba.set([19,23,29,0],0);rgba.set([32,41,52,1],(width+7)*4);return encodeRgbaPng(width,height,rgba);}
function receive(workflow,sha,bytes){const {request,...ticket}=flow.reservePlan(workflow,sha);flow.recordSubmission(workflow,ticket);return flow.receiveResult(workflow,ticket,bytes);}

test('coverage-v3 is explicit and its aspect and normalized budget cannot leak into legacy roles or formats',()=>{
  const b=band();flow.validateBackgroundBand(b,{role:'backdrop'});assert.equal(flow.COVERAGE_BACKGROUND_BAND_PROFILE,b.profile);
  assert.equal(flow.BACKGROUND_BAND_FINITE_CUTS_PROFILE,b.boundaryProfile);
  for(const mutate of [x=>x.boundaryProfile='all-edges-finite',x=>delete x.coverageBudget,x=>x.coverageBudget.upperContourPercent.min=0,
    x=>x.coverageBudget.majorFeatureWidthPercent.max=80,x=>x.guidanceProfile='three-edge-continuation-v1']){
    const bad=band();mutate(bad);assert.throws(()=>flow.validateBackgroundBand(bad,{role:'backdrop'}));
  }
  reject(()=>flow.validateBackgroundBand(b,{role:'foreground'}),'BACKGROUND_BAND_ROLE');
  const old=band(2);old.boundaryProfile=b.boundaryProfile;assert.throws(()=>flow.validateBackgroundBand(old,{role:'backdrop'}));
});

test('fresh v3 two-input plans retain original cut RGBA, use only the new top QA and derive a full-native candidate',{timeout:600000},t=>{
  const f=setupCoherent(t,'Coverage v3 fixture',undefined,{transformBrief,transformAnalysis}),scopes=flow.createLayerSourceScopes(f.brief.requirements),
    v2Scopes=flow.withBackgroundBandScopes(f.brief.requirements,scopes,['ridges','valley'].map(subjectId=>({subjectId,backgroundBand:band(2)}))),
    options={...f.options,batchId:'coverage.legacy',sourceScopes:v2Scopes},preview=flow.previewCoherentSources(f.workflow,options),
    oldPlans=preview.plans.filter(p=>['backdrop','valley'].includes(p.instanceBinding.role));
  // Captured with the complete synthetic v2 compiler before adding v3. These
  // are complete prompt/plan/request bytes, rather than substring assertions.
  assert.deepEqual(oldPlans.map(p=>[hash(p.request.prompt),p.sha256,digest(p.request)]),[
    ['2800fd4866726375178a8ef5425e05e2cb01f1003faf49eba3433c9fcbd110e2','ed5fc059d3e65117a8b70ada5b9fa9277d70f2cc635b3fbd5114402758969ae5','b31fcfbb549a0472faa3832cb85c2e5c902fa52e445340f62ce3561e5a5e69bc'],
    ['0d06f3eeafcd7a546f585db72ac66448edd8549e9cb75f98ed51aac8af9f72bf','218129fb15fda3a5cf5ae08fce628c5b59b8b16d8b914187b36075234fe5852c','65413702c8761a9cd59997a5624669b7ecddf9677b611288308fda5234c21b6e'],
  ]);
  const oldBatch=flow.freezeCoherentSources(f.workflow,options);flow.authorizeReferenceAssetBatch(f.workflow,oldBatch.sha256,decision('coverage.old',oldBatch.sha256,'approve-compute'));
  const oldRaw=rawBand(0);
  for(const [i,p]of preview.plans.entries())if(p.instanceBinding.role!=='valley')receive(f.workflow,p.sha256,p.instanceBinding.role==='backdrop'?oldRaw:sourcePng(p.target.alpha==='transparent',i));
  assert(assessCoherentSource(oldPlans[0],oldRaw).issues.includes('COHERENT_CLIPPED_SILHOUETTE'));
  const oldStates=flow.inspectWorkflow(f.workflow).plans.filter(p=>oldPlans.some(old=>old.sha256===p.planSha256)),
    next=flow.reviseCoherentSources(f.workflow,oldBatch.sha256,{batchId:'coverage.v3',replacements:oldPlans.map((p,i)=>({assetId:p.recipe.assetId,planId:'coverage.v3.'+i,intent:'isolated-layer-v4',sourceScope:flow.withBackgroundBand(p.recipe.sourceScope,band())}))}),
    changed=next.planSha256s.filter(sha=>!oldBatch.planSha256s.includes(sha)),plans=changed.map(sha=>flow.getGenerationPlan(f.workflow,sha));
  assert.equal(changed.length,2);reject(()=>flow.reservePlan(f.workflow,changed[0]),'AUTHORIZATION_REQUIRED');
  const fresh=flow.previewCoherentSources(f.workflow,{...f.options,batchId:'coverage.first.theme',sourceScopes:flow.withBackgroundBandScopes(f.brief.requirements,scopes,['ridges','valley'].map(subjectId=>({subjectId,backgroundBand:band()})))});
  assert.equal(fresh.plans.filter(p=>p.sourceScope?.boundaryPolicy).length,2,'new-project first scopes use the same explicit v3 contract');
  for(const p of plans){
    assert.match(p.compiler,/-background-band-coverage-v3-guide-v1$/);assert.equal(p.request.images.length,2);
    assert(p.request.prompt.startsWith('BACKGROUND BAND background-band-coverage-v3: use canvas aspect 2:1'));
    assert.match(p.request.prompt,/4–12 percent/);assert.match(p.request.prompt,/22–32 percent/);
    assert.doesNotMatch(p.request.prompt,/approximately two percent|do not copy[^.]*proportions|Keep at least 12 percent|"minX"|"coverageFrameWorld"/i);
    const g=flow.backgroundBandCoverageGuide({canvasAspect:p.recipe.sourceScope.backgroundBand.canvasAspect,coverageBudget:p.recipe.sourceScope.backgroundBand.coverageBudget,role:p.instanceBinding.role});
    assert.equal(p.request.images[1].role,flow.BACKGROUND_BAND_COVERAGE_GUIDE_IMAGE_ROLE);assert.equal(p.sourceScope.backgroundBandGuideEvidence.recipeSha256,g.recipe.sha256);
    assert.deepEqual(coherentSourceBackgroundBandGuideInputs(p),[g.bytes]);assert.deepEqual(flow.readGenerationInput(f.workflow,p.sha256,0),f.raw);assert.deepEqual(flow.readGenerationInput(f.workflow,p.sha256,1),g.bytes);
    assert.equal(g.artifact.pixelSize.width,g.artifact.pixelSize.height*2);
    for(const mutate of [x=>x.request.images[1].role='neutral-background-band-three-edge-continuation-example',x=>x.sourceScope.backgroundBandGuideEvidence.recipeSha256='0'.repeat(64),x=>x.recipe.sourceScope.backgroundBand.canvasAspect={numerator:3,denominator:1}]){
      const bad=structuredClone(p);mutate(bad);assert.throws(()=>coherentSourceBackgroundBandGuideInputs(bad));
    }
    reject(()=>verifyCoherentSourceExtraInputs(p,()=>Buffer.alloc(8)),'BACKGROUND_BAND_GUIDE_REPLAY');
    const qa=assessCoherentSource(p,rawBand(1));assert.equal(qa.status,'pass');assert.equal(qa.edgeMaximumAlpha,254);assert.equal(qa.topEdgeMaximumAlpha,1);
    assert.equal(qa.boundaryProfile,'natural-top-finite-three-cuts-v1');assert.deepEqual(qa.declaredFiniteCuts,['left','right','bottom']);assert.equal(qa.contentContinuity,'not-assessed');
    const image=inspectPng(rawBand(1),{includePixels:true,allowHiddenRgb:true}),bad=Buffer.from(image.rgba);bad[3]=2;
    assert(assessCoherentSource(p,encodeRgbaPng(512,256,bad)).issues.includes('COHERENT_BACKGROUND_TOP_GUTTER'));
    const opaque=Buffer.from(image.rgba);for(let n=3;n<opaque.length;n+=4)opaque[n]=255;
    assert(assessCoherentSource(p,encodeRgbaPng(512,256,opaque)).issues.includes('COHERENT_NO_TRANSPARENCY'));
    assert(assessCoherentSource(p,g.bytes).issues.includes('COHERENT_NO_TRANSPARENCY'),'opaque technical image cannot be accepted as transparent output');
  }
  transact(f.workflow,store=>{const state=replay(store),p=plans[0],cap=state.capabilities.get(p.recipe.capabilitiesSha256);state.capabilities.set(cap.sha256,{...cap,maxInputImages:1});
    reject(()=>compileCoherentSource(state,p.recipe,sha=>store.readBlob(sha)),'BACKGROUND_BAND_GUIDE_CAPABILITY');});
  flow.authorizeReferenceAssetBatch(f.workflow,next.sha256,decision('coverage.fresh',next.sha256,'approve-compute'));
  const raws=plans.map((p,i)=>rawBand(i+1));plans.forEach((p,i)=>assert.equal(receive(f.workflow,p.sha256,raws[i]).technical.status,'pass'));
  const observations=coherentSurfaceObservations();observations.rockFeaturePairs[0].source.toX=160;
  const material=next.planSha256s.map(sha=>flow.getGenerationPlan(f.workflow,sha)).find(p=>p.instanceBinding.role==='material'),
    mapping=compileMeasuredSurfaceMapping({reference:{raw:f.raw},material:{raw:flow.getGenerationResult(f.workflow,material.sha256).bytes},target:f.target,observations}),
    placements=plans.map((plan,i)=>flow.createBackgroundBandPlacement({plan,raw:raws[i],target:f.target,sourceToWorld:{numerator:1,denominator:1},positionWorld:{x:-64,y:0}})),
    composition=createMeasuredCoherentComposition(next,f.target,mapping,{bandPlacements:placements,contacts:[]}),root=join(f.parent,'coverage.candidate');
  assert.equal(composition.format,'ai_scene_coherent_composition_v5');
  const missing=createMeasuredCoherentComposition(next,f.target,mapping,{contacts:[]});reject(()=>flow.buildCoherentCandidate(f.workflow,next.sha256,'coverage.missing',join(f.parent,'missing'),missing),'COHERENT_BACKGROUND_BAND_CALIBRATION_REQUIRED');
  const before=flow.inspectWorkflow(f.workflow);flow.buildCoherentCandidate(f.workflow,next.sha256,'coverage.candidate',root,composition);
  assert.equal(flow.verifyCoherentCandidate(f.workflow,next.sha256,'coverage.candidate',root,composition).status,'deterministic-proof-valid');
  const handle=loadSceneKit(join(root,'kit')),context=contextFor(handle);
  for(const [i,p]of plans.entries()){
    assert.deepEqual(readFileSync(join(root,'source',p.recipe.assetId+'.png')),raws[i]);
    const original=inspectPng(raws[i],{includePixels:true,allowHiddenRgb:true}),derived=inspectPng(context.files.get('assets/scene.'+p.recipe.assetId+'.png'),{includePixels:true});
    assert.deepEqual([derived.width,derived.height],[512,256]);for(let n=0;n<original.rgba.length;n+=4)assert.deepEqual(derived.rgba.subarray(n,n+4),original.rgba[n+3]?original.rgba.subarray(n,n+4):Buffer.alloc(4));
    const evidence=JSON.parse(readFileSync(join(root,'evidence',p.recipe.assetId+'-placement.json')));assert.equal(evidence.contentContinuity,'not-assessed');assert.equal(evidence.sourceSampling.targetReached,false);
  }
  const out=join(f.parent,'coverage.export');exportScene(handle,readMap(handle),out);assert.equal(openSceneExport(out).compiled.contentSha256,compileMap(handle,readMap(handle)).contentSha256);
  assert.deepEqual(flow.inspectWorkflow(f.workflow),before);assert.deepEqual(flow.getGenerationResult(f.workflow,oldPlans[0].sha256).bytes,oldRaw);
  assert.deepEqual(flow.inspectWorkflow(f.workflow).plans.filter(p=>oldPlans.some(old=>old.sha256===p.planSha256)),oldStates);
  assert(assessCoherentSource(flow.getGenerationPlan(f.workflow,oldPlans[0].sha256),oldRaw).issues.includes('COHERENT_CLIPPED_SILHOUETTE'),'v2 failure is never rejudged under v3');
});
