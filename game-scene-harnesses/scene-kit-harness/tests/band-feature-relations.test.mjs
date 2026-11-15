import test from 'node:test';
import assert from 'node:assert/strict';
import * as flow from '../src/generation/index.mjs';
import {validateBandFeatureRelations} from '../src/generation/band-feature-relations.mjs';
import {seal,unseal,hash} from '../src/generation/common.mjs';
import {setupCoherent} from './helpers/coherent.mjs';

const transformBrief=b=>({...b,requirements:seal({...unseal(b.requirements),subjects:[...b.requirements.subjects,{subjectId:'rear',role:'valley',layerId:'landmark',content:'A synthetic band.',count:{min:1,max:1},placementHint:'wide'}]})});
const transformAnalysis=a=>seal({...unseal(a),instances:[...a.instances,{instanceId:'rear.actual',subjectId:'rear',layerId:'landmark',visibleEnvelope:[{x:0,y:20},{x:256,y:20},{x:256,y:144},{x:0,y:144}],anchor:{x:128,y:80},visibility:'occluded-and-frame-clipped',anchorEvidence:'observed',notes:'Synthetic band.'}]});
const band=()=>({format:'ai_scene_background_band_v3',profile:'background-band-coverage-v3',guidanceProfile:'normalized-three-cut-coverage-v1',boundaryProfile:'natural-top-finite-three-cuts-v1',coverageBudget:structuredClone(flow.BACKGROUND_BAND_COVERAGE_BUDGET),camera:{referenceCenterWorld:{x:128,y:72},centerDomainWorld:{minX:96,maxX:160,minY:56,maxY:88},viewportWorld:{width:256,height:144},modes:['editor-unparallax','play-parallax']},parallax:{x:.3,y:1},coverageFrameWorld:{x:-48,y:8,width:352,height:176},canvasAspect:{numerator:2,denominator:1},edges:{top:{purpose:'transparent-silhouette'},left:{purpose:'camera-overdraw'},right:{purpose:'camera-overdraw'},bottom:{purpose:'camera-overdraw'}}});
const relations=sha=>({format:'ai_scene_band_feature_relations_v1',referenceRawSha256:sha,features:[{featureId:'peak',description:'the distant peak'},{featureId:'tower',description:'the distant bridge tower'}],relations:[{from:'peak',to:'tower',axis:'x',min:.12,max:.2}]});
const scopes=(f,r)=>flow.createLayerSourceScopes(f.brief.requirements,[{subjectId:'rear',parentRole:'far',content:'A distant peak and bridge tower in one band.',exclusions:[],backgroundBand:band(),...(r?{bandFeatureRelations:r}:{})}]);
test('declared band feature relations bind the actual reference and alter only the opted-in plan',t=>{
 const f=setupCoherent(t,'Band relation fixture',undefined,{transformBrief,transformAnalysis}),opts={...f.options,batchId:'relation.preview'},plain=scopes(f),first=flow.previewCoherentSources(f.workflow,{...opts,sourceScopes:plain}),again=flow.previewCoherentSources(f.workflow,{...opts,sourceScopes:scopes(f)}),r=relations(hash(f.raw)),withRel=flow.previewCoherentSources(f.workflow,{...opts,sourceScopes:scopes(f,r)});
 assert.deepEqual(first,again);
 const old=first.plans.find(p=>p.recipe.assetId==='rear.actual'),next=withRel.plans.find(p=>p.recipe.assetId==='rear.actual');
 assert.deepEqual(flow.withBandFeatureRelations(old.recipe.sourceScope,r),next.recipe.sourceScope);
 assert.notEqual(old.sha256,next.sha256);assert.match(next.request.prompt,/REFERENCE-OBSERVED SAME-LAYER FEATURE RELATIONS/);assert.match(next.request.prompt,/0.12 to 0.2 of asset width/);assert.doesNotMatch(old.request.prompt,/REFERENCE-OBSERVED SAME-LAYER/);
 assert.equal(next.request.images[1].artifact.sha256,old.request.images[1].artifact.sha256);assert.equal(next.sourceScope.sceneCoordinatesInPrompt,false);assert.equal(next.visualReviewChecklist.automatedSemanticDetection,false);
 assert.throws(()=>flow.previewCoherentSources(f.workflow,{...opts,sourceScopes:scopes(f,relations('a'.repeat(64)))}));
 const changed=relations(hash(f.raw));changed.relations[0].max=.25;assert.notEqual(flow.previewCoherentSources(f.workflow,{...opts,sourceScopes:scopes(f,changed)}).plans.find(p=>p.recipe.assetId==='rear.actual').sha256,next.sha256);
});
test('invalid, contradictory and out-of-band relations reject',()=>{
 const r=relations('a'.repeat(64));validateBandFeatureRelations(r);
 for(const mutate of [x=>x.relations[0].max=2,x=>x.relations[0].from='unknown',x=>x.relations.push({...x.relations[0]}),x=>x.relations.push({from:'tower',to:'peak',axis:'x',min:.1,max:.2})]){const x=structuredClone(r);mutate(x);assert.throws(()=>validateBandFeatureRelations(x));}
 const chain=relations('a'.repeat(64));chain.features.push({featureId:'cliff',description:'a third feature'});chain.relations.push({from:'tower',to:'cliff',axis:'x',min:.9,max:1});assert.throws(()=>validateBandFeatureRelations(chain));
});
