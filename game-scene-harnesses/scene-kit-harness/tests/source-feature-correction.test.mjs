import test from 'node:test';
import assert from 'node:assert/strict';
import * as flow from '../src/generation/index.mjs';
import {hash,seal,unseal,digest} from '../src/generation/common.mjs';
import {createReferenceStructure,resolveReferenceFeatureTargets,referenceStructurePrompt,assertCompositionStructureCoversSources,reviewReferenceFeatureLayout} from '../src/reference-feature-layout.mjs';
import {previewBandCompositionGuide} from '../src/generation/band-composition-guide.mjs';
import {BACKGROUND_BAND_COVERAGE_BUDGET} from '../src/generation/background-band-coverage-guide.mjs';
import {setupCoherent,sourcePng} from './helpers/coherent.mjs';
import {decision} from './helpers/generation.mjs';
const code=(e,c)=>e.errors?.some(x=>x.code===c);
const asset=(instanceId='landmark.actual',subjectId='landmark')=>({instanceId,subjectId,
 features:[{featureId:'left',description:'Visible left joint',target:{x:80,y:50},toleranceWorld:4},
  {featureId:'right',description:'Visible right joint',target:{x:160,y:70},toleranceWorld:4}],
 checks:[{checkId:'owned',description:'Only the fixed frame and its own joints; no moving load.'}]});
const structure=(f,assets=[asset()])=>createReferenceStructure({referenceRawSha256:hash(f.raw),viewport:{width:256,height:144},assets});
function correction(s,instanceId=s.assets[0].instanceId){
 const proposal=seal({format:'ai_scene_reference_feature_correction_v1',structureSha256:s.sha256,evidenceSha256:'e'.repeat(64),changes:[{
  instanceId,featureId:'right',oldTarget:{x:160,y:70},target:{x:176,y:70},reason:'Synthetic reference review identified the actual endpoint beyond the repeated inner joint.'}]});
 return {proposal,decision:decision('coordinate.review',proposal.sha256)};
}
const brief=s=>({subjectId:'landmark',parentRole:'far',content:'One fixed industrial frame and its own joints.',exclusions:['Independent moving load'],referenceStructure:s});

test('source correction is opt-in, survives revision/replay, and cannot borrow authorization or be dropped downstream',t=>{
 const f=setupCoherent(t),s=structure(f),c=correction(s),scopes=flow.createLayerSourceScopes(f.brief.requirements,[brief(s)]);
 const original=flow.freezeCoherentSources(f.workflow,{...f.options,sourceScopes:scopes});
 const old=original.planSha256s.map(sha=>flow.getGenerationPlan(f.workflow,sha)).find(p=>p.recipe.assetId==='landmark.actual');
 flow.authorizeReferenceAssetBatch(f.workflow,original.sha256,decision('old.compute',original.sha256,'approve-compute'));
 const updated=flow.withReferenceFeatureCorrection(old.recipe.sourceScope,c);
 const batch=flow.reviseCoherentSources(f.workflow,original.sha256,{batchId:'corrected.batch',replacements:[{assetId:'landmark.actual',planId:'corrected.frame',intent:'isolated-layer-v4',sourceScope:updated}]});
 const sha=batch.planSha256s.find(x=>!original.planSha256s.includes(x)),p=flow.getGenerationPlan(f.workflow,sha);
 assert.deepEqual(flow.getGenerationPlan(f.workflow,old.sha256),old);
 assert.equal(p.recipe.sourceScope.referenceStructure.sha256,s.sha256);assert.deepEqual(p.recipe.sourceScope.featureCorrection,c);
 assert.equal(p.sourceScope.featureCorrectionSha256,digest(c));assert.match(p.compiler,/reference-feature-correction-v1/);
 assert.match(old.request.prompt,/span aspect width\/height: 4.0000/);assert.match(p.request.prompt,/span aspect width\/height: 4.8000/);
 assert.equal(p.request.maximumCalls,1);assert.deepEqual(p.request.images,old.request.images);assert.deepEqual(p.qualityPolicy,old.qualityPolicy);
 assert.throws(()=>flow.reservePlan(f.workflow,sha),e=>code(e,'AUTHORIZATION_REQUIRED'));
 const state=flow.inspectWorkflow(f.workflow).plans;assert.equal(state.find(p=>p.planSha256===old.sha256).status,'authorized');assert.equal(state.find(p=>p.planSha256===sha).status,'planned');
 const bare=unseal(p.recipe.sourceScope);delete bare.featureCorrection;
 assert.throws(()=>flow.reviseCoherentSources(f.workflow,batch.sha256,{batchId:'drop.correction',replacements:[{assetId:'landmark.actual',planId:'drop.frame',intent:'isolated-layer-v4',sourceScope:seal(bare)}]}),e=>code(e,'REFERENCE_FEATURE_CORRECTION_REVISION_CHANGE'));
 const changed=structuredClone(c);changed.decision.notes+=' changed receipt';
 assert.throws(()=>flow.reviseCoherentSources(f.workflow,batch.sha256,{batchId:'swap.correction',replacements:[{assetId:'landmark.actual',planId:'swap.frame',intent:'isolated-layer-v4',sourceScope:flow.withReferenceFeatureCorrection(p.recipe.sourceScope,changed)}]}),e=>code(e,'REFERENCE_FEATURE_CORRECTION_REVISION_CHANGE'));
 const sources=[{plan:p,raw:sourcePng(true)}],composition={format:'ai_scene_coherent_composition_v6',referenceStructure:s};
 assert.throws(()=>assertCompositionStructureCoversSources(composition,sources),e=>code(e,'REFERENCE_FEATURE_CORRECTION_REQUIRED'));
 assert.throws(()=>assertCompositionStructureCoversSources({...composition,featureCorrection:changed},sources),e=>code(e,'REFERENCE_FEATURE_CORRECTION_REQUIRED'));
 assertCompositionStructureCoversSources({...composition,featureCorrection:c},sources);
 assert.throws(()=>reviewReferenceFeatureLayout({structure:s,sources,measurements:[]}),e=>code(e,'REFERENCE_FEATURE_CORRECTION_REQUIRED'));
 // Carrying the right correction cannot accept missing native observations.
 assert.equal(reviewReferenceFeatureLayout({structure:s,sources,measurements:[],correction:c}).status,'blocked');
 const resolved=resolveReferenceFeatureTargets(s,c);assert.equal(s.assets[0].features[1].target.x,160);assert.equal(resolved.assets[0].features[1].target.x,176);
 assert.deepEqual(resolved.assets[0].checks,s.assets[0].checks);assert.equal(resolved.assets[0].features[1].toleranceWorld,4);
});

test('invalid or conflicting correction decisions fail before any source is frozen',t=>{
 const f=windowFixture(t),s=structure(f,[asset(),asset('rear.actual','rear')]),c=correction(s);
 const before=flow.inspectWorkflow(f.workflow).eventCount;
 const wrong=structuredClone(c);wrong.decision.targetSha256='a'.repeat(64);
 assert.throws(()=>flow.createLayerSourceScopes(f.brief.requirements,[{...brief(s),featureCorrection:wrong}]),e=>code(e,'REFERENCE_FEATURE_CORRECTION_DECISION'));
 assert.throws(()=>flow.createLayerSourceScopes(f.brief.requirements,[{...brief(s),referenceStructure:undefined,featureCorrection:c}]));
 const altered=structuredClone(c);altered.proposal=seal({...unseal(c.proposal),changes:[{...c.proposal.changes[0],toleranceWorld:32}]});altered.decision=decision('invalid.fields',altered.proposal.sha256);
 assert.throws(()=>referenceStructurePrompt(s,'landmark.actual',altered));
 const other=structuredClone(c);other.decision.decisionId='different.review';
 const scopes=flow.createLayerSourceScopes(f.brief.requirements,[{...brief(s),featureCorrection:c},
  {subjectId:'rear',parentRole:'far',content:'Independent fixture group.',exclusions:[],referenceStructure:s,featureCorrection:other}]);
 assert.throws(()=>flow.previewCoherentSources(f.workflow,{...f.options,sourceScopes:scopes}),e=>code(e,'REFERENCE_FEATURE_CORRECTION_BATCH_CONFLICT'));
 assert.equal(flow.inspectWorkflow(f.workflow).eventCount,before);
});

function windowFixture(t){
 return setupCoherent(t,'Synthetic industrial frame',undefined,{
  transformBrief:b=>({...b,requirements:seal({...unseal(b.requirements),subjects:[...b.requirements.subjects,{subjectId:'rear',role:'valley',layerId:'landmark',content:'Fixed factory frame.',count:{min:1,max:1},placementHint:'wide'}]})}),
  transformAnalysis:a=>seal({...unseal(a),instances:[...a.instances,{instanceId:'rear.actual',subjectId:'rear',layerId:'landmark',visibleEnvelope:[{x:0,y:20},{x:256,y:20},{x:256,y:144},{x:0,y:144}],anchor:{x:128,y:80},visibility:'occluded-and-frame-clipped',anchorEvidence:'observed',notes:'Synthetic fixed frame.'}]})});
}
test('reference-window source and guide use the same corrected coordinates with exact input replay',t=>{
 const f=windowFixture(t),s=structure(f,[asset('rear.actual','rear')]),c=correction(s);
 const band={format:'ai_scene_background_band_v4',profile:'background-band-open-depth-v4',guidanceProfile:'open-valley-irregular-coverage-v3',boundaryProfile:'natural-top-finite-three-cuts-v1',coverageBudget:structuredClone(BACKGROUND_BAND_COVERAGE_BUDGET),camera:{referenceCenterWorld:{x:128,y:72},centerDomainWorld:{minX:128,maxX:128,minY:72,maxY:72},viewportWorld:{width:256,height:144},modes:['editor-unparallax','play-parallax']},parallax:{x:.3,y:1},coverageFrameWorld:{x:-48,y:8,width:352,height:176},canvasAspect:{numerator:2,denominator:1},edges:{top:{purpose:'transparent-silhouette'},left:{purpose:'camera-overdraw'},right:{purpose:'camera-overdraw'},bottom:{purpose:'camera-overdraw'}}};
 const resolved=resolveReferenceFeatureTargets(s,c).assets[0];
 const guideSpec={format:'ai_scene_band_composition_guide_spec_v3',instructionProfile:'registered-window-extraction-v1',referenceRawSha256:hash(f.raw),referenceViewport:{width:256,height:144},scale:[.5,.5],translation:{x:[-96,-96],y:[-36,-36]},
  features:resolved.features.map(f=>({featureId:f.featureId,description:f.description,native:{x:[(f.target.x+96-1)/520,(f.target.x+96+1)/520],y:[(f.target.y+36-1)/260,(f.target.y+36+1)/260]},target:{x:[f.target.x-4,f.target.x+4],y:[f.target.y-4,f.target.y+4]}}))};
 const guide=previewBandCompositionGuide({band,role:'valley',spec:guideSpec,referenceBytes:f.raw});
 const row={subjectId:'rear',parentRole:'far',content:'Fixed factory frame with clear openings.',exclusions:['Independent moving load'],backgroundBand:band,referenceStructure:s,featureCorrection:c,
  bandFeatureRelations:{format:'ai_scene_band_feature_relations_v1',referenceRawSha256:hash(f.raw),features:guideSpec.features.map(({featureId,description})=>({featureId,description})),relations:[{from:'left',to:'right',axis:'x',min:.17,max:.20}]},
  bandCompositionGuide:{spec:guideSpec,decision:decision('guide.review',guide.proposal.sha256)}};
 const scopes=flow.createLayerSourceScopes(f.brief.requirements,[row]),options={...f.options,sourceScopes:scopes};
 const preview=flow.previewCoherentSources(f.workflow,options),p=preview.plans.find(p=>p.recipe.assetId==='rear.actual');
 assert.match(p.request.prompt,/span aspect width\/height: 4.8000/);assert.match(p.compiler,/registered-window-extraction-v1/);
 const removed={...row};delete removed.featureCorrection;
 assert.throws(()=>flow.previewCoherentSources(f.workflow,{...options,sourceScopes:flow.createLayerSourceScopes(f.brief.requirements,[removed])}),e=>code(e,'BAND_REFERENCE_WINDOW_FEATURES'));
 const frozen=flow.freezeCoherentSources(f.workflow,options);assert(frozen.planSha256s.includes(p.sha256));assert.deepEqual(flow.getGenerationPlan(f.workflow,p.sha256),p);
 assert.deepEqual(flow.readGenerationInput(f.workflow,p.sha256,0),f.raw);assert.deepEqual(flow.readGenerationInput(f.workflow,p.sha256,1),guide.bytes);
 assert.throws(()=>flow.reservePlan(f.workflow,p.sha256),e=>code(e,'AUTHORIZATION_REQUIRED'));
});
