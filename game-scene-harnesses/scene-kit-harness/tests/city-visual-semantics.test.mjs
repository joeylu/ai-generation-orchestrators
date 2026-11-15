import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import * as flow from '../src/generation/index.mjs';
import {canonicalJson} from '../src/document.mjs';
import {hash,seal,unseal} from '../src/generation/common.mjs';
import {createLayerSourceScopes,withVisualCoherenceScopes} from '../src/generation/layer-source.mjs';
import {createVisualCoherence,validateVisualCoherence,visualCoherencePrompt,validateVisualObservations,
  VISUAL_COHERENCE_POLICY,VISUAL_COHERENCE_ENGINEERED_POLICY} from '../src/generation/visual-coherence.mjs';
import {setupCoherent} from './helpers/coherent.mjs';
import {decision} from './helpers/generation.mjs';

const rejects=(fn,code)=>assert.throws(fn,error=>error.errors?.some(issue=>issue.code===code));
const designs=f=>({spec:JSON.parse(readFileSync(join(f.root,'spec-draft.json'))),style:JSON.parse(readFileSync(join(f.root,'style-draft.json')))});
const contract=(f,observations={})=>createVisualCoherence(designs(f).spec,designs(f).style,f.target,observations);
const cityObservations={sceneFamily:'engineered-city',lighting:'Blue-grey ambient key with bounded cyan fixture light and a few warm windows.'};
const cityContents={
  sky:'A blue-grey night sky with restrained clouds.',
  landmark:'One concrete maintenance station with its own steel mounting base and amber windows.',
  ground:'Continuous concrete support with a thin metal wearing surface and regular panel seams.',
  platform:'One closed-body hovering maintenance platform with an attached compact drive unit.',
  foreground:'One low independent municipal service fixture with compact mounting feet and bounded cyan indicators.',
  backdrop:'One distant city-building group with tiny window lights.',
  scenery:'One service-pipe fixture module with complete compact mounting anchors.',
  valley:'One rear-city facade group with embedded service infrastructure.'
};
const rect=(x,y)=>[{x,y},{x:x+20,y},{x:x+20,y:y+20},{x,y:y+20}];
function cityFixture(t){return setupCoherent(t,'Illustrated engineered city',undefined,{
  transformBrief:brief=>({...brief,requirements:seal({...unseal(brief.requirements),subjects:[
    ...brief.requirements.subjects.map(s=>({...s,content:cityContents[s.role]})),
    ...['backdrop','scenery','valley'].map(role=>({subjectId:role,role,layerId:'landmark',content:cityContents[role],count:{min:1,max:1},placementHint:'center'}))]})}),
  transformAnalysis:analysis=>seal({...unseal(analysis),instances:[...analysis.instances,...['backdrop','scenery','valley'].map((role,index)=>({
    instanceId:role+'.actual',subjectId:role,layerId:'landmark',visibleEnvelope:rect(30+index*25,20),anchor:{x:40+index*25,y:30},
    visibility:'visible',anchorEvidence:'observed',notes:'Synthetic city group, not artwork acceptance.'}))]})});}
const sourceOptions=(f,record,batchId='city.visual.sources')=>({...f.options,batchId,
  sourceScopes:createLayerSourceScopes(f.brief.requirements,[],record)});

test('the absent scene family retains the original sealed visual contract, prompt and full source-plan bytes',t=>{
  const f=setupCoherent(t,'Legacy city visual compatibility'),record=contract(f),proposal=flow.previewCoherentSources(f.workflow,
    {...f.options,sourceScopes:createLayerSourceScopes(f.brief.requirements,[],record)});
  assert.equal(record.sha256,'ef076126037ee41420c2de3ce5925e75f4140502bf2ee75d8ac33ea646201308');
  assert.equal(hash(visualCoherencePrompt(record,'material')),'440ca315c49cdd70c9f0cfa9cd8915f9dc923b7cb1671ae32ef1b8204f71a0df');
  assert.equal(hash(canonicalJson(proposal)),'175f993ae81f8578fb138773056b1d3afa89d7c29ec201baae619e25f1a3c96f');
  assert.equal(record.format,'ai_scene_visual_coherence_v1');assert.equal(record.policySha256,VISUAL_COHERENCE_POLICY.sha256);
  assert(!Object.hasOwn(record,'sceneFamily'));assert(proposal.plans.every(p=>p.compiler==='scene-kit-isolated-layer-source-v4-coherent-v1'));
});

test('engineered city is an explicit typed family with its own sealed policy and reference-bound v2 contract',t=>{
  const f=cityFixture(t),record=contract(f,cityObservations),ctx=designs(f);
  assert.equal(record.format,'ai_scene_visual_coherence_v2');assert.equal(record.sceneFamily,'engineered-city');
  assert.equal(record.policySha256,VISUAL_COHERENCE_ENGINEERED_POLICY.sha256);assert.notEqual(record.policySha256,VISUAL_COHERENCE_POLICY.sha256);
  assert.deepEqual(record.observations,cityObservations);assert.equal(record.visualAcceptance,'not-assessed');assert.equal(record.generationCalls,0);
  validateVisualCoherence(record,{...ctx,target:f.target});
  assert.match(record.wholeSceneChecks.find(c=>c.key==='terrain-join').focus,/manufactured joints and corners/);
  rejects(()=>validateVisualObservations({sceneFamily:'natural'}),'VISUAL_COHERENCE_SCENE_FAMILY');
  rejects(()=>validateVisualObservations({sceneFamily:1}),'VISUAL_COHERENCE_SCENE_FAMILY');
  rejects(()=>validateVisualObservations({sceneFamily:'engineered-city',unknown:'extra'}),'VISUAL_COHERENCE_OBSERVATIONS');
  rejects(()=>validateVisualObservations({sceneFamily:'engineered-city',lighting:'E:/private/host'}),'PRIVATE_OPERATIONAL_TEXT');
});

test('all city source roles receive manufactured responsibilities without inherited positive natural-scene instructions',t=>{
  const f=cityFixture(t),record=contract(f,cityObservations),before=flow.inspectWorkflow(f.workflow),proposal=flow.previewCoherentSources(f.workflow,sourceOptions(f,record)),
    byRole=new Map(proposal.plans.map(p=>[p.instanceBinding.role,p]));
  assert.equal(byRole.size,8);assert.equal(proposal.plans.length,9);assert.deepEqual(flow.inspectWorkflow(f.workflow),before);
  for(const plan of proposal.plans){
    assert.equal(plan.compiler,'scene-kit-isolated-layer-source-v4-coherent-v2-engineered');
    assert.equal(plan.sourceScope.profile,'isolated-layer-v4');assert.equal(plan.sourceScope.visualCoherenceSha256,record.sha256);
    assert.equal(plan.request.maximumCalls,1);assert.equal(plan.request.images.length,1);assert.equal(plan.sourceScope.alphaCleanupAllowed,false);
    const positive=plan.request.prompt.split('\n\n').filter(line=>!line.startsWith('Exclude entirely:')).join('\n\n');
    assert.doesNotMatch(positive,/\b(?:rock|soil|moss|roots?|landforms?|valley|cliffs?|boulders?)\b/i);
    assert.match(positive,/bounded local reflections/);assert.match(positive,/without.*broad bloom/);
    assert(!plan.request.prompt.includes(JSON.stringify(record.layoutMetrics)));
    assert.doesNotMatch(plan.request.prompt,/observedEnvelope|observedAnchorWithinEnvelope|"x":|"y":/);
  }
  assert.match(byRole.get('backdrop').request.prompt,/distant city-building group/);
  assert.match(byRole.get('valley').request.prompt,/rear-city depth group/);
  assert.match(byRole.get('material').request.prompt,/thin wearing surface/);assert.match(byRole.get('material').request.prompt,/deliberate.*right angles/);
  assert.match(byRole.get('platform').request.prompt,/closed-body maintenance platform/);assert.match(byRole.get('platform').request.prompt,/No pillars, legs/);
  assert.match(byRole.get('scenery').request.prompt,/service-fixture or utility group/);
  assert.match(byRole.get('foreground').request.prompt,/municipal or industrial fixture group/);
  assert.match(byRole.get('foreground').request.prompt,/cables, cutouts/);
  assert.equal(byRole.get('material').target.alpha,'opaque');assert.equal(byRole.get('sky').target.alpha,'opaque');
  assert.equal(byRole.get('foreground').target.alpha,'transparent');assert.match(byRole.get('foreground').request.prompt,/12 percent fully transparent/);
});

test('resealed family, policy, acceptance or reference substitutions cannot certify a different engineered contract',t=>{
  const f=cityFixture(t),record=contract(f,cityObservations),before=flow.inspectWorkflow(f.workflow);
  rejects(()=>validateVisualCoherence(seal({...unseal(record),sceneFamily:'other-city'})),'VISUAL_COHERENCE_POLICY');
  rejects(()=>validateVisualCoherence(seal({...unseal(record),policySha256:VISUAL_COHERENCE_POLICY.sha256})),'VISUAL_COHERENCE_POLICY');
  rejects(()=>validateVisualCoherence(seal({...unseal(record),observations:{lighting:'City light'}})),'VISUAL_COHERENCE_SCENE_FAMILY');
  rejects(()=>validateVisualCoherence(seal({...unseal(record),visualAcceptance:'accepted'})),'VISUAL_COHERENCE_POLICY');
  for(const changes of [{referenceRawSha256:'1'.repeat(64)},{targetSha256:'2'.repeat(64)},{styleSha256:'3'.repeat(64)}]){
    const changed=seal({...unseal(record),...changes});
    rejects(()=>flow.previewCoherentSources(f.workflow,sourceOptions(f,changed)),'VISUAL_COHERENCE_BINDING');
  }
  const legacy=contract(f),downgraded=seal({...unseal(legacy),observations:cityObservations});
  rejects(()=>validateVisualCoherence(downgraded),'VISUAL_COHERENCE_SCENE_FAMILY');
  assert.deepEqual(flow.inspectWorkflow(f.workflow),before);
});

test('city planning preserves source content and mandatory exclusions and never infers a city family from theme words',t=>{
  const f=cityFixture(t),legacy=createLayerSourceScopes(f.brief.requirements),old=flow.previewCoherentSources(f.workflow,{...f.options,sourceScopes:legacy}),
    record=contract(f,cityObservations),next=withVisualCoherenceScopes(f.brief.requirements,legacy,record),proposal=flow.previewCoherentSources(f.workflow,
      {...f.options,batchId:'city.explicit',sourceScopes:next});
  assert.deepEqual(next.subjects,legacy.subjects);assert.equal(old.plans.find(p=>p.instanceBinding.role==='backdrop').compiler,'scene-kit-isolated-layer-source-v4');
  assert.match(old.plans.find(p=>p.instanceBinding.role==='backdrop').request.prompt,/landform group/);
  assert.match(proposal.plans.find(p=>p.instanceBinding.role==='backdrop').request.prompt,/city-building group/);
  for(const p of proposal.plans){const original=old.plans.find(v=>v.recipe.assetId===p.recipe.assetId);
    assert.deepEqual(p.recipe.sourceScope.exclusions,original.recipe.sourceScope.exclusions);
    assert.equal(p.recipe.sourceScope.content,original.recipe.sourceScope.content);assert.equal(p.request.images[0].artifact.sha256,original.request.images[0].artifact.sha256);}
});

test('changing to the engineered contract creates new immutable plans without reusing an old compute approval',t=>{
  const f=cityFixture(t),legacy=contract(f),first=flow.freezeCoherentSources(f.workflow,sourceOptions(f,legacy,'legacy.visual'));
  flow.authorizeReferenceAssetBatch(f.workflow,first.sha256,decision('legacy.visual.compute',first.sha256,'approve-compute'));
  const city=contract(f,cityObservations),second=flow.freezeCoherentSources(f.workflow,sourceOptions(f,city,'city.visual'));
  assert.notEqual(first.sha256,second.sha256);assert.notEqual(first.planSha256s[0],second.planSha256s[0]);
  rejects(()=>flow.reservePlan(f.workflow,second.planSha256s[0]),'AUTHORIZATION_REQUIRED');
  assert(flow.inspectWorkflow(f.workflow).plans.filter(p=>second.planSha256s.includes(p.planSha256)).every(p=>p.status==='planned'));
});
