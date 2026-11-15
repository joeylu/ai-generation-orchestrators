import test from 'node:test';
import assert from 'node:assert/strict';
import * as flow from '../src/generation/index.mjs';
import {assessCoherentSource,coherentSourceExtraInputs,verifyCoherentSourceExtraInputs,compileCoherentSource} from '../src/generation/coherent-source.mjs';
import {encodeRgbaPng,inspectPng} from '../src/png.mjs';
import {transact} from '../src/generation/store.mjs';
import {replay,applyRecord} from '../src/generation/model.mjs';
import {seal,unseal,digest,hash} from '../src/generation/common.mjs';
import {setupCoherent} from './helpers/coherent.mjs';

const reject=(fn,code)=>assert.throws(fn,e=>e.errors?.some(issue=>issue.code===code));
const transformBrief=b=>({...b,requirements:seal({...unseal(b.requirements),subjects:[...b.requirements.subjects,
  {subjectId:'rear',role:'valley',layerId:'landmark',content:'Only one open rear-depth group of eroded rock and small attached plants.',count:{min:1,max:1},placementHint:'wide'}]})});
const transformAnalysis=a=>seal({...unseal(a),instances:[...a.instances,
  {instanceId:'rear.actual',subjectId:'rear',layerId:'landmark',visibleEnvelope:[{x:0,y:20},{x:256,y:20},{x:256,y:144},{x:0,y:144}],
    anchor:{x:128,y:80},visibility:'occluded-and-frame-clipped',anchorEvidence:'observed',notes:'Synthetic open-depth envelope.'}]});
const fixture=t=>setupCoherent(t,'Open depth fixture',undefined,{transformBrief,transformAnalysis});
const band=guidanceProfile=>({format:'ai_scene_background_band_v4',profile:'background-band-open-depth-v4',guidanceProfile,
  boundaryProfile:'natural-top-finite-three-cuts-v1',coverageBudget:structuredClone(flow.BACKGROUND_BAND_COVERAGE_BUDGET),
  camera:{referenceCenterWorld:{x:128,y:72},centerDomainWorld:{minX:96,maxX:160,minY:56,maxY:88},viewportWorld:{width:256,height:144},
    modes:['editor-unparallax','play-parallax']},parallax:{x:.3,y:1},coverageFrameWorld:{x:-48,y:8,width:352,height:176},
  canvasAspect:{numerator:2,denominator:1},edges:{top:{purpose:'transparent-silhouette'},left:{purpose:'camera-overdraw'},
    right:{purpose:'camera-overdraw'},bottom:{purpose:'camera-overdraw'}}});
const scopes=(f,profile)=>flow.withBackgroundBandScopes(f.brief.requirements,flow.createLayerSourceScopes(f.brief.requirements),
  [{subjectId:'rear',backgroundBand:band(profile)}]);

test('earlier open-depth and trench source plans, prompts, requests and guide bytes remain pinned',t=>{
  const f=fixture(t),cases=[
    ['open-depth-three-cut-coverage-v1','0a7e843d31d7da326ebbad2f2c6ab8e98dced8cbca3e9a57a6b1d3a665ff085d','6a3fdaff62c5992ba577f782eee41838cd4653ced384ac59349fc19743b82c8f','0bec6412ac13768e40f1c5a90be661bb6181bd69d0ead5d037f98e500324ab14','8144124690ffd51cd292d160db45ba4f3d5d8e2fbe79077f4d7594110c767af1','060e79dccfeb06bbe022d32389ab8946188a395159e866de897032512831028e'],
    ['open-trench-three-cut-coverage-v2','10c0c0db5211f0060fa9a25bc2cfafef2e1d748acf09f1e46505a75c4fe6037b','89967d6ed51a5a7fc6f0ae0a295a66ec9bf37c773689679121deb173f9a2be15','96acdc1e342450f34133e33a43905112efd1ae34c9c92cea9ec44f58e84ad576','ae5c271cd5355c8a9443386612d62043ef8b10e2c9d7af8f1bf75da69d2b8442','cc75270c6b2e1091743e5a26d9c33e6878054f2f4bd7509a9577e3afaa4de7dd']];
  for(const [profile,planSha,requestSha,promptSha,guideSha,recipeSha] of cases){
    const plan=flow.previewCoherentSources(f.workflow,{...f.options,batchId:'open.depth.legacy',sourceScopes:scopes(f,profile)}).plans.find(p=>p.recipe.assetId==='rear.actual');
    assert.deepEqual([plan.sha256,digest(plan.request),hash(plan.request.prompt),plan.request.images[1].artifact.sha256,
      plan.sourceScope.backgroundBandGuideEvidence.recipeSha256],[planSha,requestSha,promptSha,guideSha,recipeSha]);
  }
});

test('new valley request freezes two exact inputs and rejects guide, plan and capability tampering',{timeout:180000},t=>{
  const f=fixture(t),profile='open-valley-irregular-coverage-v3',b=band(profile),sourceScopes=scopes(f,profile);
  flow.validateBackgroundBand(b,{role:'valley'});reject(()=>flow.validateBackgroundBand(b,{role:'backdrop'}),'BACKGROUND_BAND_IRREGULAR_VALLEY_ROLE');
  const preview=flow.previewCoherentSources(f.workflow,{...f.options,sourceScopes}),plan=preview.plans.find(p=>p.recipe.assetId==='rear.actual');
  const guide=flow.backgroundBandIrregularValleyGuide({role:'valley',canvasAspect:b.canvasAspect,coverageBudget:b.coverageBudget});
  assert.equal(plan.request.images.length,2);assert.equal(plan.request.images[0].artifact.sha256,hash(f.raw));
  assert.equal(plan.request.images[1].role,flow.BACKGROUND_BAND_IRREGULAR_VALLEY_GUIDE_IMAGE_ROLE);
  assert.equal(plan.request.images[1].artifact.sha256,hash(guide.bytes));
  assert.equal(plan.sourceScope.backgroundBandGuideEvidence.recipeSha256,guide.recipe.sha256);
  assert.deepEqual(coherentSourceExtraInputs(plan),[guide.bytes]);
  assert.throws(()=>verifyCoherentSourceExtraInputs(plan,()=>Buffer.alloc(10)));
  const batch=flow.freezeCoherentSources(f.workflow,{...f.options,sourceScopes});
  assert(batch.planSha256s.includes(plan.sha256));
  assert.deepEqual(flow.readGenerationInput(f.workflow,plan.sha256,0),f.raw);
  assert.deepEqual(flow.readGenerationInput(f.workflow,plan.sha256,1),guide.bytes);
  transact(f.workflow,store=>{const state=replay(store),cap=state.capabilities.get(plan.recipe.capabilitiesSha256),
    apply=p=>applyRecord(store,{...state,plans:new Map(state.plans),ids:new Set(state.ids)},p);
    reject(()=>apply(seal({...unseal(plan),sourceScope:{...plan.sourceScope,backgroundBandGuideEvidence:{...plan.sourceScope.backgroundBandGuideEvidence,
      profile:'open-trench-three-cut-coverage-v2'}}})),'PLAN_RECOMPILE_MISMATCH');
    const legacy=flow.backgroundBandOpenTrenchGuide({role:'valley',canvasAspect:b.canvasAspect,coverageBudget:b.coverageBudget});
    reject(()=>apply(seal({...unseal(plan),request:{...plan.request,images:[plan.request.images[0],{...plan.request.images[1],artifact:legacy.artifact}]}})),
      'PLAN_RECOMPILE_MISMATCH');
    state.capabilities.set(cap.sha256,{...cap,maxInputImages:1});
    reject(()=>compileCoherentSource(state,plan.recipe,sha=>store.readBlob(sha)),'BACKGROUND_BAND_GUIDE_CAPABILITY');
  });
  reject(()=>flow.reservePlan(f.workflow,plan.sha256),'AUTHORIZATION_REQUIRED');
});

test('source-owned appearance and an actual cross-gap structure retain v4 alpha rules without a connectivity gate',t=>{
  const f=fixture(t),profile='open-valley-irregular-coverage-v3',b=band(profile),appearance={format:'ai_scene_source_appearance_v1',
    profile:'source-owned-appearance-v1',rules:['Muted stone with restrained structural details.']};
  const plain=scopes(f,profile),owned=flow.withSourceAppearanceScopes(f.brief.requirements,plain,[{subjectId:'rear',sourceAppearance:appearance}]);
  const plan=flow.previewCoherentSources(f.workflow,{...f.options,sourceScopes:owned}).plans.find(p=>p.recipe.assetId==='rear.actual');
  assert.equal(plan.sourceScope.sourceAppearanceEvidence.profile,'source-owned-appearance-v1');
  assert.equal(plan.sourceScope.backgroundBandGuideEvidence.profile,profile);
  const w=1024,h=512,rgba=Buffer.alloc(w*h*4);
  for(let y=20;y<h;y++)for(let x=0;x<w;x++)if(x<200||x>=824||(y>=245&&y<258))
    rgba.set([40+x%90,80+y%70,115,255],(y*w+x)*4);
  const bytes=encodeRgbaPng(w,h,rgba),png=inspectPng(bytes,{includePixels:true});
  const alpha=(x,y)=>png.rgba[(y*w+x)*4+3];
  assert.equal(alpha(512,200),0);assert.equal(alpha(512,250),255);assert.equal(alpha(512,300),0);
  const qa=assessCoherentSource(plan,bytes);
  assert.equal(qa.status,'pass');assert.equal(qa.semanticArtAcceptance,'not-assessed');
  assert.equal(qa.contentContinuity,'not-assessed');
});
