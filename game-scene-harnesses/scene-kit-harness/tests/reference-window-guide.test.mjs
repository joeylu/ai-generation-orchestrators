import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectPng} from '../src/png.mjs';
import {hash,seal,unseal} from '../src/generation/common.mjs';
import {previewBandCompositionGuide,bandCompositionGuide,validateBandCompositionGuideConfiguration} from '../src/generation/band-composition-guide.mjs';
import {BACKGROUND_BAND_COVERAGE_BUDGET} from '../src/generation/background-band-coverage-guide.mjs';
import {coherentSourceExtraInputs,verifyCoherentSourceExtraInputs} from '../src/generation/coherent-source.mjs';
import {assertCandidateBandGuideReviews} from '../src/generation/band-feature-relation-gate.mjs';
import {createReferenceStructure} from '../src/reference-feature-layout.mjs';
import * as flow from '../src/generation/index.mjs';
import {setupCoherent,referencePng,sourcePng} from './helpers/coherent.mjs';
import {decision as receipt} from './helpers/generation.mjs';
const band=()=>({format:'ai_scene_background_band_v4',profile:'background-band-open-depth-v4',guidanceProfile:'open-valley-irregular-coverage-v3',boundaryProfile:'natural-top-finite-three-cuts-v1',coverageBudget:structuredClone(BACKGROUND_BAND_COVERAGE_BUDGET),camera:{referenceCenterWorld:{x:128,y:72},centerDomainWorld:{minX:96,maxX:160,minY:56,maxY:88},viewportWorld:{width:256,height:144},modes:['editor-unparallax','play-parallax']},parallax:{x:.3,y:1},coverageFrameWorld:{x:-48,y:8,width:352,height:176},canvasAspect:{numerator:2,denominator:1},edges:{top:{purpose:'transparent-silhouette'},left:{purpose:'camera-overdraw'},right:{purpose:'camera-overdraw'},bottom:{purpose:'camera-overdraw'}}});
const named=[{featureId:'one',description:'First visible source feature',target:{x:80,y:50},toleranceWorld:4},{featureId:'two',description:'Second visible source feature',target:{x:160,y:70},toleranceWorld:4}];
const spec=raw=>({format:'ai_scene_band_composition_guide_spec_v3',referenceRawSha256:hash(raw),referenceViewport:{width:256,height:144},scale:[.5,.5],translation:{x:[-96,-96],y:[-36,-36]},features:named.map(f=>({featureId:f.featureId,description:f.description,native:{x:[(f.target.x+96-1)/520,(f.target.x+96+1)/520],y:[(f.target.y+36-1)/260,(f.target.y+36+1)/260]},target:{x:[f.target.x-4,f.target.x+4],y:[f.target.y-4,f.target.y+4]}}))});
const relations=s=>({format:'ai_scene_band_feature_relations_v1',referenceRawSha256:s.referenceRawSha256,features:s.features.map(({featureId,description})=>({featureId,description})),relations:[{from:'one',to:'two',axis:'x',min:.14,max:.17}]});
const decision=(b,s,raw)=>receipt('window.guide',previewBandCompositionGuide({band:b,role:'valley',spec:s,referenceBytes:raw}).proposal.sha256);

test('v3 renders the accepted reference in a registered window and marks unseen reserve',()=>{
 const raw=referencePng(),before=hash(raw),b=band(),s=spec(raw),g=bandCompositionGuide({band:b,role:'valley',spec:s,decision:decision(b,s,raw),referenceBytes:raw}),png=inspectPng(g.bytes,{includePixels:true}),ref=inspectPng(raw,{includePixels:true});
 assert.equal(hash(raw),before);assert.equal(g.profile,'band-reference-window-guide-v3');assert.equal(g.recipe.referenceMapping.segmentationPerformed,false);
 assert.equal(g.proposal.sha256,'725d9baf7bd229becb9d24beb6954ad1650a2a516892f898c113a33371308b8b'); // Exact HEAD 97f86e6d PNG, recipe and proposal.
 assert.deepEqual(g.recipe.referenceMapping.referenceWindowInGuide,{x:192,y:72,width:512,height:288});
 // An unmarked interior pixel is sampled from the correct accepted-reference
 // coordinate, not an arbitrary centered crop or a new theme-shaped gray mass.
 const x=250,y=100,wx=-96+(x+.5)*.5,wy=-36+(y+.5)*.5,sx=Math.floor(wx/256*ref.width),sy=Math.floor(wy/144*ref.height);
 assert.deepEqual([...png.rgba.subarray((y*png.width+x)*4,(y*png.width+x)*4+4)],[...ref.rgba.subarray((sy*ref.width+sx)*4,(sy*ref.width+sx)*4+4)]);
 assert.deepEqual([...png.rgba.subarray(0,4)],[215,215,215,255]);assert.equal(g.recipe.referenceMapping.originalReferenceModified,false);
 assert.throws(()=>previewBandCompositionGuide({band:b,role:'valley',spec:s}));assert.throws(()=>previewBandCompositionGuide({band:b,role:'valley',spec:s,referenceBytes:Buffer.alloc(30)}));
 const changed=structuredClone(s);changed.referenceViewport.width=200;assert.throws(()=>previewBandCompositionGuide({band:b,role:'valley',spec:changed,referenceBytes:raw}));
 assert.throws(()=>bandCompositionGuide({band:b,role:'valley',spec:s,referenceBytes:raw,decision:{...decision(b,s,raw),targetSha256:'c'.repeat(64)}}));
});

function fixture(t){
 const transformBrief=b=>({...b,requirements:seal({...unseal(b.requirements),subjects:[...b.requirements.subjects,{subjectId:'rear',role:'valley',layerId:'landmark',content:'A synthetic canyon.',count:{min:1,max:1},placementHint:'wide'}]})});
 const transformAnalysis=a=>seal({...unseal(a),instances:[...a.instances,{instanceId:'rear.actual',subjectId:'rear',layerId:'landmark',visibleEnvelope:[{x:0,y:20},{x:256,y:20},{x:256,y:144},{x:0,y:144}],anchor:{x:128,y:80},visibility:'occluded-and-frame-clipped',anchorEvidence:'observed',notes:'Synthetic observed group.'}]});
 return setupCoherent(t,'Window guide fixture',undefined,{transformBrief,transformAnalysis});
}
function overrides(f){const b=band(),s={...spec(f.raw),instructionProfile:'registered-window-extraction-v1'},structure=createReferenceStructure({referenceRawSha256:hash(f.raw),viewport:{width:256,height:144},assets:[{instanceId:'rear.actual',subjectId:'rear',features:named,checks:[{checkId:'only.owned',description:'Only the synthetic owned group is present.'}]}]});return {b,s,row:{subjectId:'rear',parentRole:'far',content:'A synthetic canyon.',exclusions:[],backgroundBand:b,referenceStructure:structure,bandFeatureRelations:relations(s),bandCompositionGuide:{spec:s,decision:decision(b,s,f.raw)}}};}

test('v3 freezes, materializes and replays the exact reference-derived second input',t=>{
 const f=fixture(t),{b,s,row}=overrides(f),scopes=flow.createLayerSourceScopes(f.brief.requirements,[row]),options={...f.options,batchId:'window.source',sourceScopes:scopes},preview=flow.previewCoherentSources(f.workflow,options),p=preview.plans.find(p=>p.recipe.assetId==='rear.actual'),g=bandCompositionGuide({band:b,role:'valley',spec:s,decision:row.bandCompositionGuide.decision,referenceBytes:f.raw});
 assert.equal(p.request.images.length,2);assert.equal(p.request.images[1].role,'accepted-reference-window-in-band-frame-guide');assert.match(p.compiler,/reference-window-guide-v3/);assert.match(p.request.prompt,/REFERENCE WINDOW REGISTRATION/);assert.match(p.request.prompt,/not a demand for a physical end cap/);
 assert.match(p.compiler,/registered-window-extraction-v1/);assert.match(p.request.prompt,/REGISTERED SOURCE FRAME/);assert.doesNotMatch(p.request.prompt,/The neutral example distinguishes/);assert.doesNotMatch(p.request.prompt,/Approximate identity and coherent materials are sufficient/);
 assert.deepEqual(coherentSourceExtraInputs(p,()=>f.raw),[g.bytes]);assert.throws(()=>coherentSourceExtraInputs(p));assert.throws(()=>verifyCoherentSourceExtraInputs(p,()=>f.raw));
 flow.freezeCoherentSources(f.workflow,options);assert.deepEqual(flow.readGenerationInput(f.workflow,p.sha256,0),f.raw);assert.deepEqual(flow.readGenerationInput(f.workflow,p.sha256,1),g.bytes);
 const bad=structuredClone(p);bad.request.images[1].artifact.sha256='d'.repeat(64);assert.throws(()=>coherentSourceExtraInputs(bad,()=>f.raw));
 flow.authorizePlan(f.workflow,p.sha256,receipt('window.compute',p.sha256,'approve-compute'));const {request,...ticket}=flow.reservePlan(f.workflow,p.sha256);flow.recordSubmission(f.workflow,ticket);const raw=sourcePng(true);flow.receiveResult(f.workflow,ticket,raw);
 const obs=s.features.map(x=>({featureId:x.featureId,x:[(x.native.x[0]+x.native.x[1])/2,(x.native.x[0]+x.native.x[1])/2],y:[(x.native.y[0]+x.native.y[1])/2,(x.native.y[0]+x.native.y[1])/2]})),report=flow.reviewCoherentBandGuide(f.workflow,p.sha256,obs);assert.equal(report.status,'reviewed');
 const source={plan:p,result:flow.getGenerationResult(f.workflow,p.sha256).result,raw},reviews=[{planSha256:p.sha256,observations:obs,report}];assert.equal(assertCandidateBandGuideReviews([source],reviews,f.raw).length,1);assert.throws(()=>assertCandidateBandGuideReviews([source],reviews));assert.throws(()=>assertCandidateBandGuideReviews([source],reviews,Buffer.alloc(30)));
});

test('v3 compilation blocks unreviewed raster decisions and changed structure targets',t=>{
 const f=fixture(t),{row}=overrides(f);
 const wrong=structuredClone(row);wrong.bandCompositionGuide.decision.targetSha256='b'.repeat(64);validateBandCompositionGuideConfiguration({band:wrong.backgroundBand,role:'valley',...wrong.bandCompositionGuide});
 const scopes=flow.createLayerSourceScopes(f.brief.requirements,[wrong]);assert.throws(()=>flow.previewCoherentSources(f.workflow,{...f.options,sourceScopes:scopes}));
 const changed=structuredClone(row);changed.bandCompositionGuide.spec.features[0].target.x=[0,256];changed.bandCompositionGuide.decision=decision(changed.backgroundBand,changed.bandCompositionGuide.spec,f.raw);const bad=flow.createLayerSourceScopes(f.brief.requirements,[changed]);assert.throws(()=>flow.previewCoherentSources(f.workflow,{...f.options,sourceScopes:bad}));
 const missing=structuredClone(row);delete missing.referenceStructure;const absent=flow.createLayerSourceScopes(f.brief.requirements,[missing]);assert.throws(()=>flow.previewCoherentSources(f.workflow,{...f.options,sourceScopes:absent}));
});

test('an explicit registered-band brief uses the already reviewed v3 PNG without the neutral topology prompt',t=>{
 const f=fixture(t),{b,s:registered,row}=overrides(f);
 const {instructionProfile:_,...s}=registered;
 const plain={...row,bandCompositionGuide:{spec:s,decision:decision(b,s,f.raw)}};
 const create=override=>flow.createLayerSourceScopes(f.brief.requirements,[override]);
 const legacy=flow.previewCoherentSources(f.workflow,{...f.options,sourceScopes:create(plain)});
 const selected={...plain,contentProfile:flow.REGISTERED_BAND_REGISTRATION_PROFILE};
 const options={...f.options,sourceScopes:create(selected)};
 const current=flow.previewCoherentSources(f.workflow,options);
 const old=legacy.plans.find(p=>p.recipe.assetId==='rear.actual');
 const plan=current.plans.find(p=>p.recipe.assetId==='rear.actual');
 assert.deepEqual(plan.request.images,old.request.images);
 assert.match(plan.request.prompt,/REGISTERED SOURCE FRAME/);
 assert.match(plan.request.prompt,/Image 2 fixes the scale and placement of the declared layer/);
 assert.match(plan.request.prompt,/Numbered centers identify reference observations/);
 assert.doesNotMatch(plan.request.prompt,/Image 2 is a fixed abstract|neutral example|brief-owned canyon|canyon forms|Named feature span aspect/);
 assert.deepEqual(current.plans.filter(p=>p!==plan),legacy.plans.filter(p=>p!==old));
 const batch=flow.freezeCoherentSources(f.workflow,options);
 assert(batch.planSha256s.includes(plan.sha256));
 assert.deepEqual(flow.readGenerationInput(f.workflow,plan.sha256,1),previewBandCompositionGuide({band:b,role:'valley',spec:s,referenceBytes:f.raw}).bytes);
 assert.throws(()=>create({...selected,bandCompositionGuide:row.bandCompositionGuide}),e=>e.errors?.some(v=>v.code==='SOURCE_CONTENT_REGISTERED_BAND'));
});

test('v4 binds owned targets and replays a placement guide with only the reviewed markers',t=>{
 const f=fixture(t),{b,s:registered,row}=overrides(f);
 const {instructionProfile,referenceViewport,...shared}=registered;
 const spec={...shared,format:'ai_scene_band_composition_guide_spec_v4'};
 const render=guideSpec=>previewBandCompositionGuide({band:b,role:'valley',spec:guideSpec});
 const guide=render(spec),png=inspectPng(guide.bytes,{includePixels:true});
 assert.equal(guide.profile,'band-feature-markers-guide-v4');
 assert.equal(guide.recipe.referenceMapping,undefined);
 assert.equal(guide.recipe.baseUsage,'canvas-aspect-size-and-coverage-contract-only-no-fixed-contour');
 assert.deepEqual(render(spec).bytes,guide.bytes);
 const markerBoxes=spec.features.map(feature=>({
   minX:Math.floor(feature.native.x[0]*(png.width-1))-50,
   maxX:Math.ceil(feature.native.x[1]*(png.width-1))+10,
   minY:Math.floor(feature.native.y[0]*(png.height-1))-10,
   maxY:Math.ceil(feature.native.y[1]*(png.height-1))+50,
 }));
 const counts=markerBoxes.map(()=>0);
 for(let offset=3;offset<png.rgba.length;offset+=4){
   if(!png.rgba[offset])continue;
   const pixel=(offset-3)/4,x=pixel%png.width,y=Math.floor(pixel/png.width);
   const index=markerBoxes.findIndex(box=>x>=box.minX&&x<=box.maxX&&y>=box.minY&&y<=box.maxY);
   assert(index>=0,'opaque pixels must be part of a feature marker');
   counts[index]++;
 }
 assert(counts.every(count=>count>0));
 const reviewed={...row,bandCompositionGuide:{spec,decision:receipt('markers.guide',guide.proposal.sha256)}};
 const options=override=>({...f.options,batchId:'markers.source',sourceScopes:flow.createLayerSourceScopes(f.brief.requirements,[override])});
 const batch=flow.freezeCoherentSources(f.workflow,options(reviewed));
 const plan=batch.planSha256s.map(sha=>flow.getGenerationPlan(f.workflow,sha)).find(p=>p.recipe.assetId==='rear.actual');
 assert.deepEqual(plan.recipe.sourceScope.referenceStructure,row.referenceStructure);
 assert.deepEqual(flow.readGenerationInput(f.workflow,plan.sha256,0),f.raw);
 assert.deepEqual(flow.readGenerationInput(f.workflow,plan.sha256,1),guide.bytes);
 assert.equal(plan.sourceScope.backgroundBandGuideEvidence.usage,'reviewed-asset-local-feature-locations-only');
 assert.match(plan.request.prompt,/SOURCE FEATURE FRAME: use the 2:1 whole-canvas aspect/);
 assert.match(plan.request.prompt,/The transparent field around the markers gives no terrain outline or coverage target/);
 assert.match(plan.request.prompt,/Required structure only\.owned/);
 assert.doesNotMatch(plan.request.prompt,/Named feature span aspect|relative coverage budget above|The neutral example distinguishes|colored scene window/);

 const moved=structuredClone(reviewed);
 moved.bandCompositionGuide.spec.features[0].target.x=[0,256];
 assert.throws(()=>options(moved),e=>e.errors?.some(v=>v.code==='BAND_COMPOSITION_DECISION'));
 moved.bandCompositionGuide.decision=receipt('markers.moved',render(moved.bandCompositionGuide.spec).proposal.sha256);
 assert.throws(()=>flow.previewCoherentSources(f.workflow,{...options(moved),batchId:'markers.changed'}),e=>e.errors?.some(v=>v.code==='BAND_REFERENCE_WINDOW_FEATURES'));
});
