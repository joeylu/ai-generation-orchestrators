import test from 'node:test';
import assert from 'node:assert/strict';
import * as flow from '../src/generation/index.mjs';
import {assertBandGuideWorldPlacement} from '../src/generation/band-feature-relation-gate.mjs';
import {createBackgroundBandPlacement,validateBackgroundBandPlacement} from '../src/background-band-placement.mjs';
import {encodeRgbaPng} from '../src/png.mjs';
import {previewBandCompositionGuide} from '../src/generation/band-composition-guide.mjs';
import {seal,unseal,hash} from '../src/generation/common.mjs';
import {setupCoherent} from './helpers/coherent.mjs';
import {receiveEdgeFixture} from './helpers/terrain-edge-delivery.mjs';
import {decision} from './helpers/generation.mjs';
const band=()=>({format:'ai_scene_background_band_v3',profile:'background-band-coverage-v3',guidanceProfile:'normalized-three-cut-coverage-v1',boundaryProfile:'natural-top-finite-three-cuts-v1',coverageBudget:structuredClone(flow.BACKGROUND_BAND_COVERAGE_BUDGET),camera:{referenceCenterWorld:{x:128,y:72},centerDomainWorld:{minX:96,maxX:160,minY:56,maxY:88},viewportWorld:{width:256,height:144},modes:['editor-unparallax','play-parallax']},parallax:{x:.3,y:1},coverageFrameWorld:{x:-48,y:8,width:352,height:176},canvasAspect:{numerator:2,denominator:1},edges:{top:{purpose:'transparent-silhouette'},left:{purpose:'camera-overdraw'},right:{purpose:'camera-overdraw'},bottom:{purpose:'camera-overdraw'}}});
const relations=sha=>({format:'ai_scene_band_feature_relations_v1',referenceRawSha256:sha,features:[{featureId:'peak',description:'synthetic peak'},{featureId:'tower',description:'synthetic tower'}],relations:[{from:'peak',to:'tower',axis:'x',min:.12,max:.2}]});
function guide(sha){const b=band(),spec={format:'ai_scene_band_composition_guide_spec_v1',referenceRawSha256:sha,scale:[.5,.5],translation:{x:[-100,0],y:[-80,8]},features:[{featureId:'peak',description:'synthetic peak',native:{x:[.35,.36],y:[.35,.35]},target:{x:[110,120.5],y:[88,92]}},{featureId:'tower',description:'synthetic tower',native:{x:[.5,.5],y:[.35,.35]},target:{x:[190,200],y:[88,92]}}]};return {spec,decision:decision('guide.approve',previewBandCompositionGuide({band:b,role:'valley',spec}).proposal.sha256)};}
const transformBrief=b=>({...b,requirements:seal({...unseal(b.requirements),subjects:[...b.requirements.subjects,{subjectId:'rear',role:'valley',layerId:'landmark',content:'A synthetic band.',count:{min:1,max:1},placementHint:'wide'}]})});
const transformAnalysis=a=>seal({...unseal(a),instances:[...a.instances,{instanceId:'rear.actual',subjectId:'rear',layerId:'landmark',visibleEnvelope:[{x:0,y:20},{x:256,y:20},{x:256,y:144},{x:0,y:144}],anchor:{x:128,y:80},visibility:'occluded-and-frame-clipped',anchorEvidence:'observed',notes:'Synthetic band.'}]});
function rawBand(){const w=512,h=256,rgba=Buffer.alloc(w*h*4);for(let x=0;x<w;x++)for(let y=12+Math.floor((Math.sin(x/40)+1)*8);y<h;y++)rgba.set([45+x%120,80+y%90,111,254],(y*w+x)*4);return encodeRgbaPng(w,h,rgba);}
test('exact world placement is rechecked despite a previously reviewed raw image',{timeout:120000},t=>{
 const f=setupCoherent(t,'Band world gate',undefined,{transformBrief,transformAnalysis}),ref=hash(f.raw),scopes=flow.createLayerSourceScopes(f.brief.requirements,[{subjectId:'rear',parentRole:'far',content:'A synthetic valley band.',exclusions:[],backgroundBand:band(),bandCompositionGuide:guide(ref),bandFeatureRelations:relations(ref)}]),batch=flow.freezeCoherentSources(f.workflow,{...f.options,sourceScopes:scopes});
 flow.authorizeReferenceAssetBatch(f.workflow,batch.sha256,decision('world.compute',batch.sha256,'approve-compute'));
 const sha=batch.planSha256s.find(s=>flow.getGenerationPlan(f.workflow,s).recipe.assetId==='rear.actual'),plan=flow.getGenerationPlan(f.workflow,sha),bytes=rawBand();receiveEdgeFixture(f.workflow,sha,bytes);
 const observations=[{featureId:'peak',x:[.35,.36],y:[.35,.35]},{featureId:'tower',x:[.5,.5],y:[.35,.35]}],report=flow.reviewCoherentBandGuide(f.workflow,sha,observations),rel=flow.reviewCoherentBandRelations(f.workflow,sha,observations);
 assert.equal(report.status,'reviewed');assert.equal(rel.status,'reviewed');const sources=[{plan,raw:bytes}],reviews=[{planSha256:sha,observations,report}];
 const make=x=>createBackgroundBandPlacement({plan,raw:bytes,sourceToWorld:{numerator:1,denominator:1},positionWorld:{x,y:0},target:f.target});
 const good=make(-64),partial=make(-63),outside=make(-54);
 for(const p of [good,partial,outside])assert.equal(validateBackgroundBandPlacement(p,{plan,raw:bytes,target:f.target}).geometry,'finite-full-frame-and-alpha8-range-pass');
 const peakWorld=p=>observations[0].x.map(n=>p.positionWorld.x+n*512),wanted=plan.sourceScope.definition.bandCompositionGuide.spec.features[0].target.x;
 assert(peakWorld(good)[0]>=wanted[0]&&peakWorld(good)[1]<=wanted[1]);assert(peakWorld(partial)[0]<wanted[1]&&peakWorld(partial)[1]>wanted[1]);assert(peakWorld(outside)[0]>wanted[1]);
 assertBandGuideWorldPlacement(sources,reviews,{bandPlacements:[good]},f.target);
 assert.throws(()=>assertBandGuideWorldPlacement(sources,reviews,{bandPlacements:[partial]},f.target),e=>e.errors?.some(x=>x.code==='BAND_GUIDE_WORLD_MISMATCH'));
 assert.throws(()=>assertBandGuideWorldPlacement(sources,reviews,{bandPlacements:[outside]},f.target),e=>e.errors?.some(x=>x.code==='BAND_GUIDE_WORLD_MISMATCH'));
 assert.throws(()=>assertBandGuideWorldPlacement(sources,reviews,{bandPlacements:[]},f.target),e=>e.errors?.some(x=>x.code==='BAND_GUIDE_WORLD_PLACEMENT'));
 assert.throws(()=>assertBandGuideWorldPlacement(sources,[{...reviews[0],observations:observations.slice(0,1)}],{bandPlacements:[good]},f.target),e=>e.errors?.some(x=>x.code==='BAND_GUIDE_WORLD_MISSING'));
});
