import test from 'node:test';
import assert from 'node:assert/strict';
import {digest,hash,seal,unseal} from '../src/generation/common.mjs';
import {bandCompositionGuide,previewBandCompositionGuide,assertBandCompositionGuideDecision} from '../src/generation/band-composition-guide.mjs';
import {BACKGROUND_BAND_COVERAGE_BUDGET,backgroundBandCoverageGuide} from '../src/generation/background-band-coverage-guide.mjs';
import {coherentSourceBackgroundBandGuideInputs} from '../src/generation/coherent-source.mjs';
import * as flow from '../src/generation/index.mjs';
import {setupCoherent} from './helpers/coherent.mjs';
import {inspectPng} from '../src/png.mjs';
const band=()=>({format:'ai_scene_background_band_v3',profile:'background-band-coverage-v3',guidanceProfile:'normalized-three-cut-coverage-v1',boundaryProfile:'natural-top-finite-three-cuts-v1',coverageBudget:structuredClone(BACKGROUND_BAND_COVERAGE_BUDGET),camera:{referenceCenterWorld:{x:128,y:72},centerDomainWorld:{minX:96,maxX:160,minY:56,maxY:88},viewportWorld:{width:256,height:144},modes:['editor-unparallax','play-parallax']},parallax:{x:.3,y:1},coverageFrameWorld:{x:-48,y:8,width:352,height:176},canvasAspect:{numerator:2,denominator:1},edges:{top:{purpose:'transparent-silhouette'},left:{purpose:'camera-overdraw'},right:{purpose:'camera-overdraw'},bottom:{purpose:'camera-overdraw'}}});
const spec=()=>({format:'ai_scene_band_composition_guide_spec_v1',referenceRawSha256:'a'.repeat(64),scale:[.5,.5],translation:{x:[-100,0],y:[-80,8]},features:[{featureId:'feature.one',description:'One observed feature',native:{x:[.3,.4],y:[.3,.4]},target:{x:[0,256],y:[0,144]}},{featureId:'feature.two',description:'Another observed feature',native:{x:[.4,.5],y:[.3,.4]},target:{x:[0,256],y:[0,144]}}]});
const relations=s=>({format:'ai_scene_band_feature_relations_v1',referenceRawSha256:s.referenceRawSha256,features:s.features.map(({featureId,description})=>({featureId,description})),relations:[{from:'feature.one',to:'feature.two',axis:'x',min:0,max:.2}]});
const decision=(band,spec)=>({decisionId:'review.one',decision:'accept',targetSha256:previewBandCompositionGuide({band,role:'valley',spec}).proposal.sha256,notes:'Synthetic explicit review'});
const openBand=()=>({...band(),format:'ai_scene_background_band_v4',profile:'background-band-open-depth-v4',guidanceProfile:'open-valley-irregular-coverage-v3'});
const manySpec=()=>({...spec(),format:'ai_scene_band_composition_guide_spec_v2',features:Array.from({length:12},(_,i)=>({featureId:'feature.'+(i+1),description:'Explicit feature '+(i+1),native:{x:[.3+i*.025,.31+i*.025],y:[.3,.32]},target:{x:[0,256],y:[0,144]}}))});

test('v2 binds twelve numbered feature centers to the actual open-depth base',()=>{
 const b=openBand(),s=manySpec(),g=bandCompositionGuide({band:b,role:'valley',spec:s,decision:decision(b,s)}),png=inspectPng(g.bytes,{includePixels:true});
 assert.equal(g.profile,'band-feature-envelope-guide-v2');assert.equal(g.recipe.markerRendering.profile,'high-contrast-numbered-centers-v3');assert.equal(g.recipe.featureIds.length,12);
 assert.equal(g.proposal.sha256,'22fc8c8ca589d3e59b7391c74cb62f796267429ec351404adab33af626ad4684'); // Frozen HEAD 97f86e6d guide and recipe.
 // Top and lower central void remain transparent away from the deliberate marks.
 assert.equal(png.rgba[3],0);assert.equal(png.rgba[((png.height-1)*png.width+Math.floor(png.width/2))*4+3],0);
 const changed={...b,guidanceProfile:'open-trench-three-cut-coverage-v2'};assert.throws(()=>bandCompositionGuide({band:changed,role:'valley',spec:s,decision:decision(b,s)}));
 assert.throws(()=>previewBandCompositionGuide({band:b,role:'valley',spec:spec()}));
 assert.throws(()=>previewBandCompositionGuide({band:b,role:'valley',spec:{...s,features:[...s.features,{...s.features[0],featureId:'thirteen'}]}}));
 assert.throws(()=>bandCompositionGuide({band:b,role:'valley',spec:s,decision:{...decision(b,s),targetSha256:'b'.repeat(64)}}));
});

test('v2 source freezes and replays its open guide, center instruction and review binding',t=>{
 const transformBrief=b=>({...b,requirements:seal({...unseal(b.requirements),subjects:[...b.requirements.subjects,{subjectId:'rear',role:'valley',layerId:'landmark',content:'A synthetic band.',count:{min:1,max:1},placementHint:'wide'}]})});
 const transformAnalysis=a=>seal({...unseal(a),instances:[...a.instances,{instanceId:'rear.actual',subjectId:'rear',layerId:'landmark',visibleEnvelope:[{x:0,y:20},{x:256,y:20},{x:256,y:144},{x:0,y:144}],anchor:{x:128,y:80},visibility:'occluded-and-frame-clipped',anchorEvidence:'observed',notes:'Synthetic open band.'}]});
 const fixture=setupCoherent(t,'Open feature guide fixture',undefined,{transformBrief,transformAnalysis}),b=openBand(),s=manySpec();s.referenceRawSha256=hash(fixture.raw);
 const r={format:'ai_scene_band_feature_relations_v1',referenceRawSha256:s.referenceRawSha256,features:s.features.map(({featureId,description})=>({featureId,description})),relations:[{from:'feature.1',to:'feature.2',axis:'x',min:0,max:.1}]};
 const scope=flow.createLayerSourceScopes(fixture.brief.requirements,[{subjectId:'rear',parentRole:'far',content:'A synthetic band.',exclusions:[],backgroundBand:b,bandFeatureRelations:r,bandCompositionGuide:{spec:s,decision:decision(b,s)}}]);
 const preview=flow.previewCoherentSources(fixture.workflow,{...fixture.options,batchId:'open.guide.fixture',sourceScopes:scope}),plan=preview.plans.find(p=>p.recipe.assetId==='rear.actual'),g=bandCompositionGuide({band:b,role:'valley',spec:s,decision:decision(b,s)});
 assert.match(plan.compiler,/feature-envelope-guide-v2/);assert.match(plan.request.prompt,/center of EACH named feature/);assert.match(plan.request.prompt,/Feature 12:/);assert.equal(plan.request.images.length,2);
 flow.freezeCoherentSources(fixture.workflow,{...fixture.options,batchId:'open.guide.fixture',sourceScopes:scope});assert.deepEqual(flow.readGenerationInput(fixture.workflow,plan.sha256,1),g.bytes);assert.deepEqual(coherentSourceBackgroundBandGuideInputs(plan),[g.bytes]);
 const bad=structuredClone(plan);bad.request.images[1].artifact.sha256='b'.repeat(64);assert.throws(()=>coherentSourceBackgroundBandGuideInputs(bad));
});
test('guide replay binds reviewed feature ranges and leaves old guide intact',()=>{
 const b=band(),s=spec(),d=decision(b,s),old=backgroundBandCoverageGuide({canvasAspect:b.canvasAspect,coverageBudget:b.coverageBudget,role:'valley'}),a=bandCompositionGuide({band:b,role:'valley',spec:s,decision:d}),again=bandCompositionGuide({band:b,role:'valley',spec:s,decision:d});
 assert.deepEqual(a,again);assert.notEqual(hash(a.bytes),hash(old.bytes));assert.equal(a.recipe.derivedCameraCoverage.contentContinuity,'not-assessed');
 assert.equal(a.proposal.sha256,'64d3a89473bdf13df6e2fac7c0badbfdeec14767d1ed42694d0dfb7e40576784'); // Frozen HEAD 97f86e6d.
 assert.equal(a.proposal.artifact.sha256,hash(a.bytes));assert.equal(a.proposal.recipeSha256,a.recipe.sha256);
 const changedImage=seal({...unseal(a.proposal),artifact:{...a.artifact,sha256:'c'.repeat(64)}});assert.throws(()=>assertBandCompositionGuideDecision(changedImage,d));
 const changedRecipe=seal({...unseal(a.proposal),recipeSha256:'b'.repeat(64)});assert.throws(()=>assertBandCompositionGuideDecision(changedRecipe,d));
 const oldDecision={...d,targetSha256:digest({format:'ai_scene_band_composition_guide_approval_v1',band:b,spec:s})};assert.throws(()=>bandCompositionGuide({band:b,role:'valley',spec:s,decision:oldDecision}));
 const img=inspectPng(a.bytes,{includePixels:true}),x=Math.floor(.3*(img.width-1)),y=Math.floor(.3*(img.height-1)),unit=a.recipe.markerRendering.glyphScale;
 const gray=(xx,yy)=>img.rgba[(yy*img.width+xx)*4];
 assert(unit>=2);assert(a.recipe.markerRendering.lineWidth>=2);
 // Badge is beside the rectangle; a three-pixel stroke remains visible.
 assert.equal(gray(x,y+unit+1),32);assert.equal(gray(x+1,y+unit+1),32);assert.equal(gray(x-2*unit,y),245);
 assert.equal(hash(old.bytes),hash(backgroundBandCoverageGuide({canvasAspect:b.canvasAspect,coverageBudget:b.coverageBudget,role:'valley'}).bytes));
 const changed=spec();changed.features[0].native.x=[.31,.4];assert.throws(()=>bandCompositionGuide({band:b,role:'valley',spec:changed,decision:d}));
 const next=bandCompositionGuide({band:b,role:'valley',spec:changed,decision:decision(b,changed)});assert.notEqual(next.recipe.sha256,a.recipe.sha256);
});
test('rejects infeasible ranges and invalid camera coverage without touching old plans',()=>{
 const b=band(),s=spec();s.features[0].target.x=[-1000,-900];assert.throws(()=>bandCompositionGuide({band:b,role:'valley',spec:s,decision:decision(b,s)}));
 const x=band(),y=spec();x.coverageFrameWorld.width=50;assert.throws(()=>bandCompositionGuide({band:x,role:'valley',spec:y,decision:decision(x,y)}));
});
test('new guide is frozen in source plan and replays exactly',t=>{
 const transformBrief=b=>({...b,requirements:seal({...unseal(b.requirements),subjects:[...b.requirements.subjects,{subjectId:'rear',role:'valley',layerId:'landmark',content:'A synthetic band.',count:{min:1,max:1},placementHint:'wide'}]})});
 const transformAnalysis=a=>seal({...unseal(a),instances:[...a.instances,{instanceId:'rear.actual',subjectId:'rear',layerId:'landmark',visibleEnvelope:[{x:0,y:20},{x:256,y:20},{x:256,y:144},{x:0,y:144}],anchor:{x:128,y:80},visibility:'occluded-and-frame-clipped',anchorEvidence:'observed',notes:'Synthetic band.'}]});
 const fixture=setupCoherent(t,'Band guide fixture',undefined,{transformBrief,transformAnalysis}),b=band(),s=spec();s.referenceRawSha256=hash(fixture.raw);
 const scope=flow.createLayerSourceScopes(fixture.brief.requirements,[{subjectId:'rear',parentRole:'far',content:'A synthetic band.',exclusions:[],backgroundBand:b,bandFeatureRelations:relations(s),bandCompositionGuide:{spec:s,decision:decision(b,s)}}]);
 const preview=flow.previewCoherentSources(fixture.workflow,{...fixture.options,batchId:'guide.fixture',sourceScopes:scope}),plan=preview.plans.find(p=>p.recipe.assetId==='rear.actual');
 const guide=bandCompositionGuide({band:b,role:'valley',spec:s,decision:decision(b,s)});
 assert.equal(plan.request.images[1].artifact.sha256,hash(guide.bytes));assert.deepEqual(coherentSourceBackgroundBandGuideInputs(plan),[guide.bytes]);
 assert.match(plan.request.prompt,/Never paint the boxes/);
 const frozen=flow.freezeCoherentSources(fixture.workflow,{...fixture.options,batchId:'guide.fixture',sourceScopes:scope});
 const actual=flow.getGenerationPlan(fixture.workflow,plan.sha256);assert(frozen.planSha256s.includes(plan.sha256));
 assert.deepEqual(flow.readGenerationInput(fixture.workflow,actual.sha256,1),guide.bytes);
 const changed=structuredClone(actual);changed.request.images[1].artifact.sha256='0'.repeat(64);assert.throws(()=>coherentSourceBackgroundBandGuideInputs(changed));
 const changedReference=structuredClone(actual);changedReference.recipe.sourceScope.bandCompositionGuide.spec.referenceRawSha256='c'.repeat(64);assert.throws(()=>coherentSourceBackgroundBandGuideInputs(changedReference));
 const other=spec();other.referenceRawSha256='b'.repeat(64);
 const bad=flow.createLayerSourceScopes(fixture.brief.requirements,[{subjectId:'rear',parentRole:'far',content:'A synthetic band.',exclusions:[],backgroundBand:b,bandFeatureRelations:relations(other),bandCompositionGuide:{spec:other,decision:decision(b,other)}}]);
 assert.throws(()=>flow.previewCoherentSources(fixture.workflow,{...fixture.options,batchId:'guide.bad.ref',sourceScopes:bad}));
 assert.throws(()=>flow.createLayerSourceScopes(fixture.brief.requirements,[{subjectId:'rear',parentRole:'far',content:'A synthetic band.',exclusions:[],backgroundBand:b,bandCompositionGuide:{spec:s,decision:decision(b,s)}}]));
 const wrong=relations(s);wrong.features[0].description='wrong subject';assert.throws(()=>flow.createLayerSourceScopes(fixture.brief.requirements,[{subjectId:'rear',parentRole:'far',content:'A synthetic band.',exclusions:[],backgroundBand:b,bandFeatureRelations:wrong,bandCompositionGuide:{spec:s,decision:decision(b,s)}}]));
 const impossible=relations(s);impossible.relations[0].min=.8;impossible.relations[0].max=.9;assert.throws(()=>flow.createLayerSourceScopes(fixture.brief.requirements,[{subjectId:'rear',parentRole:'far',content:'A synthetic band.',exclusions:[],backgroundBand:b,bandFeatureRelations:impossible,bandCompositionGuide:{spec:s,decision:decision(b,s)}}]));
});
