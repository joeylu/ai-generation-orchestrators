import test from 'node:test';import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';import {join} from 'node:path';
import * as flow from '../src/generation/index.mjs';
import {createLayerSourceScopes,withVisualCoherenceScopes,validateLayerSourceScopes} from '../src/generation/layer-source.mjs';
import {VISUAL_COHERENCE_POLICY,createVisualCoherence,validateVisualCoherence,visualCoherencePrompt} from '../src/generation/visual-coherence.mjs';
import {seal,unseal} from '../src/generation/common.mjs';
import {setupCoherent,sourcePng} from './helpers/coherent.mjs';import {decision} from './helpers/generation.mjs';
const rejects=(f,code)=>assert.throws(f,e=>e.errors?.some(v=>v.code===code));
const designs=f=>({spec:JSON.parse(readFileSync(join(f.root,'spec-draft.json'))),style:JSON.parse(readFileSync(join(f.root,'style-draft.json')))});
const contract=(f,observations={})=>{const {spec,style}=designs(f);return createVisualCoherence(spec,style,f.target,observations);};
const options=(f,record,batchId='visual.sources')=>({...f.options,batchId,sourceScopes:createLayerSourceScopes(f.brief.requirements,[],record)});

test('one shared reference-relative visual contract binds a complete scene without certifying semantic art or equal-size stones',t=>{
  const f=setupCoherent(t,'Autumn watermill'),record=contract(f,{lighting:'Soft warm afternoon light with pale cool distant mountains.'}),ctx=designs(f);
  assert.equal(record.policySha256,VISUAL_COHERENCE_POLICY.sha256);validateVisualCoherence(record,{...ctx,target:f.target});
  assert.equal(record.layoutMetrics.length,f.target.instances.length);const terrain=record.layoutMetrics.find(i=>i.role==='ground');
  assert.deepEqual(terrain.observedSize,{width:70,height:54});assert.deepEqual(terrain.relativeSize.width,{numerator:70,denominator:256});
  assert.equal(terrain.anchorInterpretation,'observed-anchor-not-certified-root-or-footing');assert.equal(record.visualAcceptance,'not-assessed');assert.equal(record.generationCalls,0);
  assert.equal(record.automatedSemanticDetection,false);assert(record.wholeSceneChecks.some(c=>c.key==='terrain-join'));
  const material=visualCoherencePrompt(record,'material');assert.match(material,/upper quarter/);assert.match(material,/continuous|connected/);assert.match(material,/Masonry joints may be finer/);
  assert.match(material,/small painted top faces are allowed/);assert.doesNotMatch(material,/watermill|observedAnchorWithinEnvelope|instanceId|"x":|"y":/i);
  rejects(()=>contract(f,{unknown:'unbounded art data'}),'VISUAL_COHERENCE_OBSERVATIONS');rejects(()=>contract(f,{lighting:'E:/private/host'}),'PRIVATE_OPERATIONAL_TEXT');
});

test('coherence can be attached without rewriting source briefs, inherited provenance or legacy plan bytes',t=>{
  const f=setupCoherent(t,'Violet crystal cave'),overrides=[{subjectId:'foreground',content:'One isolated violet crystal cluster.',exclusions:['Neighboring cave mouth'],parentRole:'foreground'}];
  const legacyScopes=createLayerSourceScopes(f.brief.requirements,overrides),legacyOptions={...f.options,sourceScopes:legacyScopes};
  const before=flow.inspectWorkflow(f.workflow),legacy=flow.previewCoherentSources(f.workflow,legacyOptions),record=contract(f),scopes=withVisualCoherenceScopes(f.brief.requirements,legacyScopes,record);
  assert.deepEqual(scopes.subjects,legacyScopes.subjects);assert.equal(scopes.format,'ai_scene_layer_source_scopes_v2');validateLayerSourceScopes(f.brief.requirements,scopes);
  const next=flow.previewCoherentSources(f.workflow,{...f.options,batchId:'coherent.visual',sourceScopes:scopes});
  assert.deepEqual(flow.inspectWorkflow(f.workflow),before);assert.deepEqual(flow.previewCoherentSources(f.workflow,legacyOptions),legacy);
  assert.equal(new Set(next.plans.map(p=>p.sourceScope.visualCoherenceSha256)).size,1);
  for(const p of next.plans){
    assert.equal(p.sourceScope.profile,'isolated-layer-v4');assert.equal(p.compiler,'scene-kit-isolated-layer-source-v4-coherent-v1');
    assert.equal(p.recipe.sourceScope.visualCoherence.sha256,record.sha256);assert.equal(p.request.images.length,1);assert.equal(p.request.maximumCalls,1);
    assert.equal(p.sourceScope.sceneCoordinatesInPrompt,false);assert.equal(p.sourceScope.alphaCleanupAllowed,false);
    assert.match(p.request.prompt,/SHARED VISUAL COHERENCE/);assert.doesNotMatch(p.request.prompt,/observedEnvelope|observedAnchorWithinEnvelope|Draw ONLY instance|canonical-reference-frame/);
    assert(!p.request.prompt.includes(JSON.stringify(p.recipe.sourceScope.visualCoherence.layoutMetrics)));assert.equal(p.visualReviewChecklist.visualAcceptance,'not-assessed');
  }
  assert.match(next.plans.find(p=>p.instanceBinding.role==='material').request.prompt,/soil\/cover-to-body transition/);
  assert.match(next.plans.find(p=>p.instanceBinding.role==='foreground').request.prompt,/natural overlaps within its own allowed base/);
});

test('an explicit material sampling brief replaces both default surface proportions for one source',t=>{
  const f=setupCoherent(t),record=contract(f),legacyOptions=options(f,record),legacy=flow.previewCoherentSources(f.workflow,legacyOptions);
  const sampling={subjectId:'ground',parentRole:'main',content:'Use a thin attached surface and a deep continuous body in a near-square landscape canvas.',
    exclusions:[],contentProfile:flow.MATERIAL_SAMPLING_CONTENT_PROFILE};
  const sourceScopes=createLayerSourceScopes(f.brief.requirements,[sampling],record);
  const next=flow.previewCoherentSources(f.workflow,{...legacyOptions,sourceScopes});
  const material=next.plans.find(p=>p.instanceBinding.role==='material');
  const previous=legacy.plans.find(p=>p.instanceBinding.role==='material');
  assert.match(previous.request.prompt,/upper one-eighth/);
  assert.match(previous.request.prompt,/upper quarter/);
  assert.doesNotMatch(material.request.prompt,/upper one-eighth|upper quarter/);
  assert.match(material.request.prompt,/near-square landscape canvas/);
  assert.match(material.request.prompt,/uninterrupted usable body/);
  assert.match(material.request.prompt,/style|brushwork/);
  assert.deepEqual(material.request.images,previous.request.images);
  assert.deepEqual(material.request.output,previous.request.output);
  assert.deepEqual(next.plans.filter(p=>p!==material),legacy.plans.filter(p=>p!==previous));
  const batch=flow.freezeCoherentSources(f.workflow,{...legacyOptions,sourceScopes});
  assert(batch.planSha256s.includes(material.sha256));
  assert.deepEqual(flow.getGenerationPlan(f.workflow,material.sha256),material);
  rejects(()=>flow.reservePlan(f.workflow,material.sha256),'AUTHORIZATION_REQUIRED');
  rejects(()=>createLayerSourceScopes(f.brief.requirements,[{...sampling,subjectId:'foreground',parentRole:'foreground'}],record),'SOURCE_CONTENT_ROLE');
});

test('full source compilation rejects resealed stale reference, style or layout metrics and leaves the workflow unchanged',t=>{
  const f=setupCoherent(t),record=contract(f),before=flow.inspectWorkflow(f.workflow);
  for(const update of [
    {referenceRawSha256:'1'.repeat(64)}, {targetSha256:'2'.repeat(64)}, {styleSha256:'3'.repeat(64)},
    {layoutMetrics:record.layoutMetrics.map((r,i)=>i===0?{...r,observedSize:{width:1,height:1},relativeSize:{width:{...r.relativeSize.width,numerator:1},height:{...r.relativeSize.height,numerator:1}}}:r)},
  ]){
    const changed=seal({...unseal(record),...update});rejects(()=>flow.previewCoherentSources(f.workflow,options(f,changed)),'VISUAL_COHERENCE_BINDING');assert.deepEqual(flow.inspectWorkflow(f.workflow),before);
  }
  const wrongRequirements=seal({...unseal(record),requirementsSha256:'0'.repeat(64)});
  rejects(()=>withVisualCoherenceScopes(f.brief.requirements,createLayerSourceScopes(f.brief.requirements),wrongRequirements),'VISUAL_COHERENCE_BINDING');
  const accepted=seal({...unseal(record),visualAcceptance:'accepted'});rejects(()=>validateVisualCoherence(accepted),'VISUAL_COHERENCE_POLICY');
});

test('a changed shared brief requires a new immutable batch authorization and cannot spend the old approval',t=>{
  const f=setupCoherent(t),record=contract(f),first=flow.freezeCoherentSources(f.workflow,options(f,record));
  flow.authorizeReferenceAssetBatch(f.workflow,first.sha256,decision('visual.original',first.sha256,'approve-compute'));
  const revised=contract(f,{brushwork:'Broad painted masses with fine accents; distant edges retain the reference softness.'});
  const second=flow.freezeCoherentSources(f.workflow,options(f,revised,'visual.revised'));
  assert.notEqual(second.sha256,first.sha256);assert.notEqual(second.planSha256s[0],first.planSha256s[0]);
  rejects(()=>flow.reservePlan(f.workflow,second.planSha256s[0]),'AUTHORIZATION_REQUIRED');
  const status=flow.inspectWorkflow(f.workflow);assert.equal(status.plans.filter(p=>p.stage==='coherent-source').length,first.planSha256s.length*2);
  assert(status.plans.filter(p=>second.planSha256s.includes(p.planSha256)).every(p=>p.status==='planned'));
});

test('source revisions cannot mix shared contracts or downgrade one member while identical-contract revisions remain possible',t=>{
  const f=setupCoherent(t),record=contract(f),batch=flow.freezeCoherentSources(f.workflow,options(f,record,'visual.original'));
  flow.authorizeReferenceAssetBatch(f.workflow,batch.sha256,decision('visual.original.compute',batch.sha256,'approve-compute'));
  const first=batch.planSha256s[0],old=flow.getGenerationPlan(f.workflow,first),{request,...ticket}=flow.reservePlan(f.workflow,first);
  flow.recordSubmission(f.workflow,ticket);flow.receiveResult(f.workflow,ticket,sourcePng(false));
  const different=flow.previewCoherentSources(f.workflow,options(f,contract(f,{lighting:'Reference light with soft contact shade.'}),'visual.other'));
  const downgraded=flow.previewCoherentSources(f.workflow,{...f.options,batchId:'visual.legacy',sourceScopes:createLayerSourceScopes(f.brief.requirements)});
  const before=flow.inspectWorkflow(f.workflow);
  for(const [name,sourceScope]of [['different',different.plans[0].recipe.sourceScope],['downgraded',downgraded.plans[0].recipe.sourceScope]]){
    rejects(()=>flow.reviseCoherentSources(f.workflow,batch.sha256,{batchId:'visual.revision.'+name,replacements:[
      {assetId:old.recipe.assetId,planId:'visual.replacement.'+name,intent:'isolated-layer-v4',sourceScope}
    ]}),'COHERENT_BATCH_VISUAL_COHERENCE');assert.deepEqual(flow.inspectWorkflow(f.workflow),before);
  }
  const revised=flow.reviseCoherentSources(f.workflow,batch.sha256,{batchId:'visual.revision.same',replacements:[
    {assetId:old.recipe.assetId,planId:'visual.replacement.same'}
  ]});
  assert.equal(revised.visualCoherenceSha256,record.sha256);assert.deepEqual(revised.planSha256s.slice(1),batch.planSha256s.slice(1));
  rejects(()=>flow.reservePlan(f.workflow,revised.planSha256s[0]),'AUTHORIZATION_REQUIRED');
});
