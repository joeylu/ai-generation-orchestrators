import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import * as flow from '../src/generation/index.mjs';
import {assessCoherentSource,coherentSourceExtraInputs,verifyCoherentSourceExtraInputs,compileCoherentSource} from '../src/generation/coherent-source.mjs';
import {transact} from '../src/generation/store.mjs';
import {replay,applyRecord} from '../src/generation/model.mjs';
import {createMeasuredCoherentComposition} from '../src/coherent-composition.mjs';
import {compileMeasuredSurfaceMapping} from '../src/terrain-proof/measured-field.mjs';
import {loadSceneKit,readMap,contextFor} from '../src/kit.mjs';
import {exportScene,openSceneExport} from '../src/persistence.mjs';
import {compileMap} from '../src/compile.mjs';
import {encodeRgbaPng,inspectPng} from '../src/png.mjs';
import {validateBackgroundBandPlacement} from '../src/background-band-placement.mjs';
import {seal,unseal,digest,hash} from '../src/generation/common.mjs';
import {setupCoherent,sourcePng,coherentSurfaceObservations} from './helpers/coherent.mjs';
import {decision} from './helpers/generation.mjs';
const reject=(fn,code)=>assert.throws(fn,e=>e.errors?.some(issue=>issue.code===code));
const transformBrief=b=>({...b,requirements:seal({...unseal(b.requirements),subjects:[...b.requirements.subjects,{subjectId:'rear',role:'valley',layerId:'landmark',content:'Only one open rear-depth group of eroded rock and small attached plants.',count:{min:1,max:1},placementHint:'wide'}]})});
const transformAnalysis=a=>seal({...unseal(a),instances:[...a.instances,{instanceId:'rear.actual',subjectId:'rear',layerId:'landmark',visibleEnvelope:[{x:0,y:20},{x:256,y:20},{x:256,y:144},{x:0,y:144}],anchor:{x:128,y:80},visibility:'occluded-and-frame-clipped',anchorEvidence:'observed',notes:'Synthetic open-depth envelope.'}]});
const appearance={format:'ai_scene_source_appearance_v1',profile:'source-owned-appearance-v1',rules:['Quiet cool-grey eroded stone, low contrast and broad clean hand-painted edges.']};
const band=(trench=true)=>({format:'ai_scene_background_band_v4',profile:'background-band-open-depth-v4',guidanceProfile:trench?'open-trench-three-cut-coverage-v2':'open-depth-three-cut-coverage-v1',boundaryProfile:'natural-top-finite-three-cuts-v1',coverageBudget:structuredClone(flow.BACKGROUND_BAND_COVERAGE_BUDGET),
 camera:{referenceCenterWorld:{x:128,y:72},centerDomainWorld:{minX:96,maxX:160,minY:56,maxY:88},viewportWorld:{width:256,height:144},modes:['editor-unparallax','play-parallax']},parallax:{x:.3,y:1},coverageFrameWorld:{x:-48,y:8,width:352,height:176},canvasAspect:{numerator:2,denominator:1},edges:{top:{purpose:'transparent-silhouette'},left:{purpose:'camera-overdraw'},right:{purpose:'camera-overdraw'},bottom:{purpose:'camera-overdraw'}}});
const fixture=t=>setupCoherent(t,'Open depth fixture',undefined,{transformBrief,transformAnalysis});
const scopes=(f,b)=>flow.withBackgroundBandScopes(f.brief.requirements,flow.createLayerSourceScopes(f.brief.requirements),[{subjectId:'rear',backgroundBand:b}]);
const receive=(workflow,sha,bytes)=>{const {request,...ticket}=flow.reservePlan(workflow,sha);flow.recordSubmission(workflow,ticket);return flow.receiveResult(workflow,ticket,bytes);};
function trenchRaw(){
 const w=512,h=256,rgba=Buffer.alloc(w*h*4);
 for(let x=0;x<w;x++){const left=x<170,right=x>=342,top=left?20+Math.floor(x/43)*18:28+Math.floor((511-x)/43)*15;
  if(left||right)for(let y=top;y<h;y++)rgba.set([44+x%100,83+y%90,118,252],(y*w+x)*4);}
 rgba.set([21,27,33,0],0);return encodeRgbaPng(w,h,rgba);
}

test('trench subtype is explicit and valley-only while complete legacy-v4 source bytes remain fixed',t=>{
 const f=fixture(t),plain=scopes(f,band(false)),owned=flow.withSourceAppearanceScopes(f.brief.requirements,plain,[{subjectId:'rear',sourceAppearance:appearance}]),
  expected=[['0bec6412ac13768e40f1c5a90be661bb6181bd69d0ead5d037f98e500324ab14','0a7e843d31d7da326ebbad2f2c6ab8e98dced8cbca3e9a57a6b1d3a665ff085d','6a3fdaff62c5992ba577f782eee41838cd4653ced384ac59349fc19743b82c8f'],
   ['20930efa3237eb3266dee95abf98f34122c5d2a5831976f2325d6e78b9f8a142','f9c48d7683e98e42bb532665f77561da869db111b26eef3e4806527df479a5ee','97d417447c8971455ae52eb585c8a992d62d32ad2627a4bfebd43a3408c386c8']];
 for(const [i,s]of [plain,owned].entries()){
  const p=flow.previewCoherentSources(f.workflow,{...f.options,batchId:'open.depth.legacy',sourceScopes:s}).plans.find(p=>p.recipe.assetId==='rear.actual');
  assert.deepEqual([hash(p.request.prompt),p.sha256,digest(p.request)],expected[i]);assert.equal(p.request.images[1].artifact.sha256,'8144124690ffd51cd292d160db45ba4f3d5d8e2fbe79077f4d7594110c767af1');assert.equal(p.sourceScope.backgroundBandGuideEvidence.recipeSha256,'060e79dccfeb06bbe022d32389ab8946188a395159e866de897032512831028e');
 }
 const b=band();flow.validateBackgroundBand(b,{role:'valley'});reject(()=>flow.validateBackgroundBand(b,{role:'backdrop'}),'BACKGROUND_BAND_OPEN_TRENCH_ROLE');
 reject(()=>flow.validateBackgroundBand(b,{role:'foreground'}),'BACKGROUND_BAND_ROLE');
 assert.throws(()=>flow.backgroundBandOpenTrenchGuide({canvasAspect:b.canvasAspect,coverageBudget:b.coverageBudget,role:'backdrop'}));
 const unknown=band();unknown.guidanceProfile='automatically-infer-trench';assert.throws(()=>flow.validateBackgroundBand(unknown,{role:'valley'}));
 const oldFormat={...b,format:'ai_scene_background_band_v3',profile:'background-band-coverage-v3'};assert.throws(()=>flow.validateBackgroundBand(oldFormat,{role:'valley'}));
 const first=flow.createLayerSourceScopes(f.brief.requirements,[{subjectId:'rear',parentRole:'far',content:'One broad rear trench only.',exclusions:[],backgroundBand:b,sourceAppearance:appearance}]),
  firstPlan=flow.previewCoherentSources(f.workflow,{...f.options,batchId:'open.trench.first',sourceScopes:first}).plans.find(p=>p.recipe.assetId==='rear.actual');
 assert.deepEqual(firstPlan.recipe.parents,[]);assert.equal(firstPlan.request.images[1].role,flow.BACKGROUND_BAND_OPEN_TRENCH_GUIDE_IMAGE_ROLE);
});

test('fresh trench request binds its new transparent guide and retains QA, full-native calibration, original RGBA and export',{timeout:600000},t=>{
 const f=fixture(t),legacyScopes=scopes(f,band(false)),oldProposal=flow.previewCoherentSources(f.workflow,{...f.options,sourceScopes:legacyScopes}),old=flow.freezeCoherentSources(f.workflow,{...f.options,sourceScopes:legacyScopes});
 flow.authorizeReferenceAssetBatch(f.workflow,old.sha256,decision('trench.old.compute',old.sha256,'approve-compute'));
 const oldRear=oldProposal.plans.find(p=>p.recipe.assetId==='rear.actual'),oldRaw=sourcePng(true,9);
 oldProposal.plans.forEach((p,i)=>receive(f.workflow,p.sha256,p===oldRear?oldRaw:sourcePng(p.target.alpha==='transparent',i)));
 const sourceScope=flow.withSourceAppearance(flow.withBackgroundBand(oldRear.recipe.sourceScope,band()),appearance),next=flow.reviseCoherentSources(f.workflow,old.sha256,{batchId:'open.trench.v2',replacements:[{assetId:'rear.actual',planId:'open.trench.rear',intent:'isolated-layer-v4',sourceScope}]}),plan=flow.getGenerationPlan(f.workflow,next.planSha256s.at(-1));
 assert.match(plan.compiler,/-background-band-open-trench-v4-guide-v2-source-owned-appearance-v1$/);assert.match(plan.request.prompt,/OPEN TRENCH TOPOLOGY/);
 assert.doesNotMatch(plan.request.prompt,/detached same-layer masses and real holes|remaining height continuously|opaque surround, theme or crest count/);
 assert.equal(plan.request.images.length,2);assert.equal(plan.request.images[1].role,flow.BACKGROUND_BAND_OPEN_TRENCH_GUIDE_IMAGE_ROLE);
 const guide=flow.backgroundBandOpenTrenchGuide({canvasAspect:band().canvasAspect,coverageBudget:band().coverageBudget,role:'valley'});
 assert.deepEqual(coherentSourceExtraInputs(plan),[guide.bytes]);assert.equal(plan.sourceScope.backgroundBandGuideEvidence.recipeSha256,guide.recipe.sha256);
 assert.deepEqual(flow.readGenerationInput(f.workflow,plan.sha256,0),f.raw);assert.deepEqual(flow.readGenerationInput(f.workflow,plan.sha256,1),guide.bytes);assert.throws(()=>verifyCoherentSourceExtraInputs(plan,()=>Buffer.alloc(10)));
 transact(f.workflow,store=>{const state=replay(store),cap=state.capabilities.get(plan.recipe.capabilitiesSha256),apply=p=>applyRecord(store,{...state,plans:new Map(state.plans),ids:new Set(state.ids)},p);
  reject(()=>apply(seal({...unseal(plan),sourceScope:{...plan.sourceScope,backgroundBandGuideEvidence:{...plan.sourceScope.backgroundBandGuideEvidence,profile:'open-depth-three-cut-coverage-v1'}}})),'PLAN_RECOMPILE_MISMATCH');
  reject(()=>apply(seal({...unseal(plan),request:{...plan.request,images:[plan.request.images[0],oldRear.request.images[1]]}})),'PLAN_RECOMPILE_MISMATCH');
  state.capabilities.set(cap.sha256,{...cap,maxInputImages:1});reject(()=>compileCoherentSource(state,plan.recipe,sha=>store.readBlob(sha)),'BACKGROUND_BAND_GUIDE_CAPABILITY');
 });
 const raw=trenchRaw(),png=inspectPng(raw,{includePixels:true,allowHiddenRgb:true}),qa=assessCoherentSource(plan,raw);assert.equal(qa.status,'pass');assert.equal(qa.topEdgeMaximumAlpha,0);assert.equal(qa.edgeMaximumAlpha,252);
 for(let y=0;y<png.height;y++)assert.equal(png.rgba[(y*png.width+250)*4+3],0,'the wide trench stays open through the bottom');
 const bad=Buffer.from(png.rgba);bad[3]=2;assert(assessCoherentSource(plan,encodeRgbaPng(png.width,png.height,bad)).issues.includes('COHERENT_BACKGROUND_TOP_GUTTER'));
 const opaque=Buffer.from(png.rgba);for(let i=3;i<opaque.length;i+=4)opaque[i]=255;assert(assessCoherentSource(plan,encodeRgbaPng(png.width,png.height,opaque)).issues.includes('COHERENT_NO_TRANSPARENCY'));
 reject(()=>flow.reservePlan(f.workflow,plan.sha256),'AUTHORIZATION_REQUIRED');flow.authorizeReferenceAssetBatch(f.workflow,next.sha256,decision('trench.new.compute',next.sha256,'approve-compute'));assert.equal(receive(f.workflow,plan.sha256,raw).technical.status,'pass');
 const observations=coherentSurfaceObservations();observations.rockFeaturePairs[0].source.toX=160;
 const material=next.planSha256s.map(sha=>flow.getGenerationPlan(f.workflow,sha)).find(p=>p.instanceBinding.role==='material'),mapping=compileMeasuredSurfaceMapping({reference:{raw:f.raw},material:{raw:flow.getGenerationResult(f.workflow,material.sha256).bytes},target:f.target,observations}),
  placement=flow.createBackgroundBandPlacement({plan,raw,target:f.target,sourceToWorld:{numerator:1,denominator:1},positionWorld:{x:-128,y:0}}),composition=createMeasuredCoherentComposition(next,f.target,mapping,{bandPlacements:[placement],contacts:[]}),root=join(f.parent,'trench.candidate');
 const missing=createMeasuredCoherentComposition(next,f.target,mapping,{contacts:[]});reject(()=>flow.buildCoherentCandidate(f.workflow,next.sha256,'trench.missing',join(f.parent,'missing'),missing),'COHERENT_BACKGROUND_BAND_CALIBRATION_REQUIRED');
 reject(()=>validateBackgroundBandPlacement({...placement,nativeFrame:{...placement.nativeFrame,width:500}},{plan,raw,target:f.target}),'BACKGROUND_BAND_NATIVE_FRAME');
 flow.buildCoherentCandidate(f.workflow,next.sha256,'trench.candidate',root,composition);assert.equal(flow.verifyCoherentCandidate(f.workflow,next.sha256,'trench.candidate',root,composition).status,'deterministic-proof-valid');
 const handle=loadSceneKit(join(root,'kit')),derived=inspectPng(contextFor(handle).files.get('assets/scene.rear.actual.png'),{includePixels:true});assert.deepEqual(readFileSync(join(root,'source/rear.actual.png')),raw);
 assert.deepEqual([derived.width,derived.height],[png.width,png.height]);for(let i=0;i<png.rgba.length;i+=4)assert.deepEqual(derived.rgba.subarray(i,i+4),png.rgba[i+3]?png.rgba.subarray(i,i+4):Buffer.alloc(4));
 const out=join(f.parent,'trench.export');exportScene(handle,readMap(handle),out);assert.equal(openSceneExport(out).compiled.contentSha256,compileMap(handle,readMap(handle)).contentSha256);assert.deepEqual(flow.getGenerationResult(f.workflow,oldRear.sha256).bytes,oldRaw);
});
