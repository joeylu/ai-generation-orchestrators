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
const band=(version=4)=>({format:`ai_scene_background_band_v${version}`,profile:version===4?'background-band-open-depth-v4':'background-band-coverage-v3',guidanceProfile:version===4?'open-depth-three-cut-coverage-v1':'normalized-three-cut-coverage-v1',boundaryProfile:'natural-top-finite-three-cuts-v1',coverageBudget:structuredClone(flow.BACKGROUND_BAND_COVERAGE_BUDGET),
 camera:{referenceCenterWorld:{x:128,y:72},centerDomainWorld:{minX:96,maxX:160,minY:56,maxY:88},viewportWorld:{width:256,height:144},modes:['editor-unparallax','play-parallax']},parallax:{x:.3,y:1},coverageFrameWorld:{x:-48,y:8,width:352,height:176},canvasAspect:{numerator:2,denominator:1},edges:{top:{purpose:'transparent-silhouette'},left:{purpose:'camera-overdraw'},right:{purpose:'camera-overdraw'},bottom:{purpose:'camera-overdraw'}}});
const fixture=t=>setupCoherent(t,'Open depth fixture',undefined,{transformBrief,transformAnalysis});
const scopes=(f,b)=>flow.withBackgroundBandScopes(f.brief.requirements,flow.createLayerSourceScopes(f.brief.requirements),[{subjectId:'rear',backgroundBand:b}]);
const receive=(workflow,sha,bytes)=>{const {request,...ticket}=flow.reservePlan(workflow,sha);flow.recordSubmission(workflow,ticket);return flow.receiveResult(workflow,ticket,bytes);};
function openRaw(seed=0){
 const w=512,h=256,rgba=Buffer.alloc(w*h*4);
 for(let y=0;y<h;y++)for(let x=0;x<w;x++)if((x<144&&y>=20+x%9||x>=352&&y>=29+x%7)&&!(x>=48&&x<96&&y>=70&&y<132))rgba.set([40+(x+seed)%100,80+(y+seed)%90,115+seed,255],(y*w+x)*4);
 rgba.set([21,27,33,0],0);return encodeRgbaPng(w,h,rgba);
}

test('open depth is explicit, rejects mixed profiles and retains complete legacy-v3 prompt/plan/request/guide bytes',t=>{
 const f=fixture(t),plain=scopes(f,band(3)),owned=flow.withSourceAppearanceScopes(f.brief.requirements,plain,[{subjectId:'rear',sourceAppearance:appearance}]);
 const expected=[['c4d5792233557591fa6bd543e2ae96f8a462c0fcb841bb1070456f38770ae70e','b2aee5dfc15426aa6ed0c2e8b58c9f3c80dfea081c52b9ee11e0e331a638568c','792a09d1c8cff4db8285706a435d19cf6d9e1b284c414e2e7e258e7ec48af073'],
  ['05dcf3545341315ad466bc118c4b33ab009e6e9a471eaa572880e6acd060486c','f5518f5c6f633a943b7171f6c4983f690743deed4e6f224e1265a124d6e5029f','f4876b774bcea8481b6a79173725b538f556c105e7be129b1040f963c615f329']];
 for(const [i,s]of [plain,owned].entries()){
  const p=flow.previewCoherentSources(f.workflow,{...f.options,batchId:'open.depth.legacy',sourceScopes:s}).plans.find(p=>p.recipe.assetId==='rear.actual');
  assert.deepEqual([hash(p.request.prompt),p.sha256,digest(p.request)],expected[i]);assert.equal(p.request.images[1].artifact.sha256,'98aa5071d869b7a403c7632065c1c3745cb8154ff878fd7d30dd44e3638dfcfd');
 }
 const b=band();flow.validateBackgroundBand(b,{role:'valley'});assert.equal(flow.OPEN_DEPTH_BACKGROUND_BAND_PROFILE,b.profile);
 for(const mutate of [x=>x.format='ai_scene_background_band_v3',x=>x.guidanceProfile='normalized-three-cut-coverage-v1',x=>x.boundaryProfile='all-edges-open',x=>x.coverageBudget.upperContourPercent.max=50]){const bad=band();mutate(bad);assert.throws(()=>flow.validateBackgroundBand(bad,{role:'valley'}));}
 reject(()=>flow.validateBackgroundBand(b,{role:'foreground'}),'BACKGROUND_BAND_ROLE');
 const first=flow.createLayerSourceScopes(f.brief.requirements,[{subjectId:'rear',parentRole:'far',content:'Only one open rear material group.',exclusions:[],backgroundBand:b,sourceAppearance:appearance}]),
  firstPlan=flow.previewCoherentSources(f.workflow,{...f.options,batchId:'open.depth.first-source',sourceScopes:first}).plans.find(p=>p.recipe.assetId==='rear.actual');
 assert.equal(firstPlan.recipe.sourceScope.format,'ai_scene_layer_source_scope_v6');assert.deepEqual(firstPlan.recipe.parents,[]);
 assert.equal(firstPlan.request.images[1].role,flow.BACKGROUND_BAND_OPEN_DEPTH_GUIDE_IMAGE_ROLE,'new themes can use appearance and open topology from the first source plan');
});

test('v4 open source keeps two canonical inputs, top QA, full-native placement, actual open RGBA and independent export',{timeout:600000},t=>{
 const f=fixture(t),legacyScopes=scopes(f,band(3)),oldProposal=flow.previewCoherentSources(f.workflow,{...f.options,sourceScopes:legacyScopes}),old=flow.freezeCoherentSources(f.workflow,{...f.options,sourceScopes:legacyScopes});
 flow.authorizeReferenceAssetBatch(f.workflow,old.sha256,decision('open.old.compute',old.sha256,'approve-compute'));
 const oldRear=oldProposal.plans.find(p=>p.recipe.assetId==='rear.actual'),oldRaw=sourcePng(true,9);
 oldProposal.plans.forEach((p,i)=>receive(f.workflow,p.sha256,p===oldRear?oldRaw:sourcePng(p.target.alpha==='transparent',i)));
 const sourceScope=flow.withSourceAppearance(flow.withBackgroundBand(oldRear.recipe.sourceScope,band()),appearance),
  next=flow.reviseCoherentSources(f.workflow,old.sha256,{batchId:'open.depth.v4',replacements:[{assetId:'rear.actual',planId:'open.depth.v4.rear',intent:'isolated-layer-v4',sourceScope}]}),plan=flow.getGenerationPlan(f.workflow,next.planSha256s.at(-1));
 assert.match(plan.compiler,/-background-band-open-depth-v4-guide-v1-source-owned-appearance-v1$/);assert.equal(plan.recipe.sourceScope.format,'ai_scene_layer_source_scope_v6');
 assert.match(plan.request.prompt,/OPEN BODY/);assert.match(plan.request.prompt,/a true void crossing a cut stays transparent/);
 assert.doesNotMatch(plan.request.prompt,/painted body occupies the remaining height|Continue original same-layer content through the wide lower body|The pale gray space above the example contour|newly painted to both side technical ends/);
 assert.equal(plan.request.images.length,2);assert.equal(plan.request.images[1].role,flow.BACKGROUND_BAND_OPEN_DEPTH_GUIDE_IMAGE_ROLE);
 const guide=flow.backgroundBandOpenDepthGuide({canvasAspect:band().canvasAspect,coverageBudget:band().coverageBudget,role:'valley'});
 assert.equal(plan.sourceScope.backgroundBandGuideEvidence.recipeSha256,guide.recipe.sha256);assert.deepEqual(coherentSourceExtraInputs(plan),[guide.bytes]);
 assert.deepEqual(flow.readGenerationInput(f.workflow,plan.sha256,0),f.raw);assert.deepEqual(flow.readGenerationInput(f.workflow,plan.sha256,1),guide.bytes);
 assert.equal(plan.sourceScope.sourceAppearanceEvidence.inheritedSceneRules,false);assert.equal(plan.sourceScope.boundaryPolicy.profile,'natural-top-finite-three-cuts-v1');
 assert.throws(()=>verifyCoherentSourceExtraInputs(plan,()=>Buffer.alloc(10)));
 transact(f.workflow,store=>{const state=replay(store),cap=state.capabilities.get(plan.recipe.capabilitiesSha256);
  const apply=p=>applyRecord(store,{...state,plans:new Map(state.plans),ids:new Set(state.ids)},p);
  reject(()=>apply(seal({...unseal(plan),sourceScope:{...plan.sourceScope,backgroundBandGuideEvidence:{...plan.sourceScope.backgroundBandGuideEvidence,profile:'normalized-three-cut-coverage-v1'}}})),'PLAN_RECOMPILE_MISMATCH');
  state.capabilities.set(cap.sha256,{...cap,maxInputImages:1});reject(()=>compileCoherentSource(state,plan.recipe,sha=>store.readBlob(sha)),'BACKGROUND_BAND_GUIDE_CAPABILITY');
 });
 const raw=openRaw(1),png=inspectPng(raw,{includePixels:true,allowHiddenRgb:true}),qa=assessCoherentSource(plan,raw);assert.equal(qa.status,'pass');assert.equal(qa.topEdgeMaximumAlpha,0);assert.equal(qa.edgeMaximumAlpha,255);
 for(let y=0;y<png.height;y++)assert.equal(png.rgba[(y*png.width+250)*4+3],0,'the central void remains open through the bottom');
 assert.equal(png.rgba[(90*png.width+70)*4+3],0,'an interior material opening remains truly transparent');
 const bad=Buffer.from(png.rgba);bad[3]=2;assert(assessCoherentSource(plan,encodeRgbaPng(png.width,png.height,bad)).issues.includes('COHERENT_BACKGROUND_TOP_GUTTER'));
 const opaque=Buffer.from(png.rgba);for(let i=3;i<opaque.length;i+=4)opaque[i]=255;assert(assessCoherentSource(plan,encodeRgbaPng(png.width,png.height,opaque)).issues.includes('COHERENT_NO_TRANSPARENCY'));
 reject(()=>flow.reservePlan(f.workflow,plan.sha256),'AUTHORIZATION_REQUIRED');flow.authorizeReferenceAssetBatch(f.workflow,next.sha256,decision('open.v4.compute',next.sha256,'approve-compute'));assert.equal(receive(f.workflow,plan.sha256,raw).technical.status,'pass');
 const observations=coherentSurfaceObservations();observations.rockFeaturePairs[0].source.toX=160;
 const material=next.planSha256s.map(sha=>flow.getGenerationPlan(f.workflow,sha)).find(p=>p.instanceBinding.role==='material'),mapping=compileMeasuredSurfaceMapping({reference:{raw:f.raw},material:{raw:flow.getGenerationResult(f.workflow,material.sha256).bytes},target:f.target,observations}),
  placement=flow.createBackgroundBandPlacement({plan,raw,target:f.target,sourceToWorld:{numerator:1,denominator:1},positionWorld:{x:-128,y:0}}),
  composition=createMeasuredCoherentComposition(next,f.target,mapping,{bandPlacements:[placement],contacts:[]}),root=join(f.parent,'open.candidate');
 const missing=createMeasuredCoherentComposition(next,f.target,mapping,{contacts:[]});reject(()=>flow.buildCoherentCandidate(f.workflow,next.sha256,'open.missing',join(f.parent,'missing'),missing),'COHERENT_BACKGROUND_BAND_CALIBRATION_REQUIRED');
 const cropped={...placement,nativeFrame:{...placement.nativeFrame,width:500}};reject(()=>validateBackgroundBandPlacement(cropped,{plan,raw,target:f.target}),'BACKGROUND_BAND_NATIVE_FRAME');
 flow.buildCoherentCandidate(f.workflow,next.sha256,'open.candidate',root,composition);assert.equal(flow.verifyCoherentCandidate(f.workflow,next.sha256,'open.candidate',root,composition).status,'deterministic-proof-valid');
 const handle=loadSceneKit(join(root,'kit')),derived=inspectPng(contextFor(handle).files.get('assets/scene.rear.actual.png'),{includePixels:true});
 assert.deepEqual(readFileSync(join(root,'source/rear.actual.png')),raw);assert.deepEqual([derived.width,derived.height],[png.width,png.height]);
 for(let i=0;i<png.rgba.length;i+=4)assert.deepEqual(derived.rgba.subarray(i,i+4),png.rgba[i+3]?png.rgba.subarray(i,i+4):Buffer.alloc(4));
 const out=join(f.parent,'open.export');exportScene(handle,readMap(handle),out);assert.equal(openSceneExport(out).compiled.contentSha256,compileMap(handle,readMap(handle)).contentSha256);
 assert.deepEqual(flow.getGenerationResult(f.workflow,oldRear.sha256).bytes,oldRaw,'legacy returned source is preserved, not retroactively reclassified');
});
