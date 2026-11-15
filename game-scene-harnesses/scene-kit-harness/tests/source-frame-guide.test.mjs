import test from 'node:test';
import assert from 'node:assert/strict';
import * as flow from '../src/generation/index.mjs';
import {hash,seal,unseal} from '../src/generation/common.mjs';
import {sourceFrameGuide} from '../src/generation/source-frame-guide.mjs';
import {coherentSourceExtraInputs,verifyCoherentSourceExtraInputs,assessCoherentSource} from '../src/generation/coherent-source.mjs';
import {createReferenceStructure} from '../src/reference-feature-layout.mjs';
import {inspectPng,encodeRgbaPng} from '../src/png.mjs';
import {setupCoherent,referencePng,sourcePng} from './helpers/coherent.mjs';
import {decision} from './helpers/generation.mjs';
function data(raw){
 const structure=createReferenceStructure({referenceRawSha256:hash(raw),viewport:{width:256,height:144},assets:[{instanceId:'landmark.actual',subjectId:'landmark',compositionProfile:'source-owned-feature-group-v1',features:[
  {featureId:'upper.left',description:'Left end of fixed upper girder',target:{x:80,y:50},toleranceWorld:4},
  {featureId:'lower.right',description:'Right end of fixed lower girder',target:{x:160,y:70},toleranceWorld:4}],checks:[{checkId:'only.frame',description:'Fixed frame only; independently movable cargo is excluded.'}]}]});
 const spec={format:'ai_scene_source_frame_guide_spec_v1',referenceRawSha256:hash(raw),referenceViewport:structure.viewport,instanceId:'landmark.actual',frameWorld:{x:32,y:16,width:192,height:144},markerRadiusWorld:1};
 const options={spec,structure,role:'landmark',referenceBytes:raw},g=flow.previewSourceFrameGuide(options),review=decision('frame.guide',g.proposal.sha256);
 return {options,g,structure,spec,row:{subjectId:'landmark',parentRole:'far',content:'A fixed industrial frame; preserve both girders and the asymmetric opening.',exclusions:['Independent moving cargo'],referenceStructure:structure,framingProfile:'complete-silhouette-v1',sourceFrameGuide:{spec,decision:review}}};
}
const pixel=(p,x,y)=>[...p.rgba.subarray((y*p.width+x)*4,(y*p.width+x)*4+4)];
test('isolated guide preserves registered reference pixels and marks only owned features and unobserved reserve',()=>{
 const raw=referencePng(),before=hash(raw),{options,g}=data(raw),png=inspectPng(g.bytes,{includePixels:true}),ref=inspectPng(raw,{includePixels:true});
 assert.equal(hash(raw),before);assert.deepEqual(g.recipe.featureIds,['upper.left','lower.right']);
 assert.equal(g.recipe.sourcePixelsProduced,0);assert.equal(g.proposal.generationCalls,0);assert.equal(g.recipe.sourceBoundary,'complete-isolated-contour-all-four-edges-transparent');
 const {scale,position}=g.recipe.referenceMapping.guidePixelToWorld,x=120,y=200;
 assert.deepEqual(pixel(png,x,y),pixel(ref,Math.floor((position.x+(x+.5)*scale)*2),Math.floor((position.y+(y+.5)*scale)*2)));
 const outside=pixel(png,10,png.height-1);assert.equal(outside[0],outside[1]);assert([215,235].includes(outside[0]));
 assert.throws(()=>flow.previewSourceFrameGuide({...options,referenceBytes:Buffer.alloc(9)}));
 assert.throws(()=>flow.previewSourceFrameGuide({...options,spec:{...options.spec,frameWorld:{x:0,y:0,width:32,height:32}}}));
 assert.throws(()=>flow.previewSourceFrameGuide({...options,spec:{...options.spec,markerRadiusWorld:5}}));
 assert.throws(()=>flow.previewSourceFrameGuide({...options,role:'sky'}));
 assert.throws(()=>flow.previewSourceFrameGuide({...options,spec:{...options.spec,instanceId:'unowned'}}));
 assert.throws(()=>sourceFrameGuide({...options,decision:decision('stale','a'.repeat(64))}));
 // Integer contain registration must not stretch a slightly mismatched reference.
 const width=513,height=288,rgba=Buffer.alloc(width*height*4,255),odd=encodeRgbaPng(width,height,rgba),d=data(odd),mapped=d.g.recipe.referenceMapping;
 assert.deepEqual(mapped.referenceContentFrame,{x:0,y:0,width:256,height:143});
});
test('isolated guide freezes and replays exact two inputs without borrowing compute or band edge exemptions',t=>{
 const f=setupCoherent(t),{row,g}=data(f.raw),scopes=flow.createLayerSourceScopes(f.brief.requirements,[row]),opts={...f.options,sourceScopes:scopes};
 const p=flow.previewCoherentSources(f.workflow,opts).plans.find(p=>p.recipe.assetId==='landmark.actual');
 assert.match(p.compiler,/source-frame-guide-v1/);assert.match(p.request.prompt,/ISOLATED SOURCE FRAME/);assert.doesNotMatch(p.request.prompt,/12 percent|Center the complete group|canyon|finite cuts/i);
 assert.equal(p.request.images.length,2);assert.equal(p.request.maximumCalls,1);assert.equal(p.target.alpha,'transparent');assert.equal(p.sourceScope.boundaryPolicy,undefined);
 assert.deepEqual(coherentSourceExtraInputs(p,()=>f.raw),[g.bytes]);assert.throws(()=>coherentSourceExtraInputs(p));
 assert.throws(()=>verifyCoherentSourceExtraInputs(p,()=>f.raw));
 const original=flow.freezeCoherentSources(f.workflow,opts);assert.deepEqual(flow.readGenerationInput(f.workflow,p.sha256,0),f.raw);assert.deepEqual(flow.readGenerationInput(f.workflow,p.sha256,1),g.bytes);
 assert.throws(()=>flow.reservePlan(f.workflow,p.sha256),e=>e.errors?.some(x=>x.code==='AUTHORIZATION_REQUIRED'));
 assert.equal(assessCoherentSource(p,sourcePng(true)).status,'pass');
 const png=inspectPng(sourcePng(true),{includePixels:true});png.rgba.set([40,80,90,255],200*png.width*4);
 assert(assessCoherentSource(p,encodeRgbaPng(png.width,png.height,png.rgba)).issues.includes('COHERENT_CLIPPED_SILHOUETTE'));
 // A new registered frame is independently frozen and does not modify old bytes.
 const d=data(f.raw),nextSpec={...d.spec,frameWorld:{x:24,y:16,width:192,height:144}},preview=flow.previewSourceFrameGuide({...d.options,spec:nextSpec});
 const next=flow.withSourceFrameGuide(p.recipe.sourceScope,{spec:nextSpec,decision:decision('new.frame',preview.proposal.sha256)});
 const batch=flow.reviseCoherentSources(f.workflow,original.sha256,{batchId:'next.frame.batch',replacements:[{assetId:'landmark.actual',planId:'next.frame',intent:'isolated-layer-v4',sourceScope:next}]});
 const revised=flow.getGenerationPlan(f.workflow,batch.planSha256s.find(s=>!original.planSha256s.includes(s)));
 assert.deepEqual(flow.getGenerationPlan(f.workflow,p.sha256),p);assert.deepEqual(flow.readGenerationInput(f.workflow,revised.sha256,1),preview.bytes);
 assert.throws(()=>flow.reservePlan(f.workflow,revised.sha256),e=>e.errors?.some(x=>x.code==='AUTHORIZATION_REQUIRED'));
});
test('stale guide review, wrong owner and competing second-image contracts block before freezing',t=>{
 const f=setupCoherent(t),{row,options}=data(f.raw),before=flow.inspectWorkflow(f.workflow).eventCount;
 const preview=r=>flow.previewCoherentSources(f.workflow,{...f.options,sourceScopes:flow.createLayerSourceScopes(f.brief.requirements,[r])});
 assert.throws(()=>preview({...row,sourceFrameGuide:{...row.sourceFrameGuide,decision:decision('stale','a'.repeat(64))}}));
 const base=flow.previewCoherentSources(f.workflow,{...f.options,sourceScopes:flow.createLayerSourceScopes(f.brief.requirements,[row])}).plans.find(p=>p.recipe.assetId==='landmark.actual').recipe.sourceScope;
 for(const k of ['backgroundBand','bandCompositionGuide','visualGuideProfile','lightingProfile'])assert.throws(()=>flow.withSourceFrameGuide(seal({...unseal(base),[k]:{}}),row.sourceFrameGuide));
 const proposal=seal({format:'ai_scene_reference_feature_correction_v1',structureSha256:row.referenceStructure.sha256,evidenceSha256:'e'.repeat(64),changes:[{instanceId:'landmark.actual',featureId:'lower.right',oldTarget:{x:160,y:70},target:{x:164,y:70},reason:'Independent synthetic reference review.'}]});
 const correction={proposal,decision:decision('corrected',proposal.sha256)};
 assert.throws(()=>preview({...row,featureCorrection:correction}));
 const g=flow.previewSourceFrameGuide({...options,correction}),p=preview({...row,featureCorrection:correction,sourceFrameGuide:{spec:row.sourceFrameGuide.spec,decision:decision('corrected.guide',g.proposal.sha256)}}).plans.find(p=>p.recipe.assetId==='landmark.actual');
 assert.equal(p.request.images[1].artifact.sha256,g.artifact.sha256);assert.equal(flow.inspectWorkflow(f.workflow).eventCount,before);
});
