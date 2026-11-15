import test from 'node:test';
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {writeFileSync,readFileSync} from 'node:fs';
import * as flow from '../src/generation/index.mjs';
import {compileTerrainEdgeSource,assessTerrainEdgeSource} from '../src/generation/terrain-edge-source.mjs';
import {prepareTerrainEdgeComputeReview} from '../src/terrain-edge-pipeline.mjs';
import {reserveTerrainEdgeExchange,receiveTerrainEdgeExchange,stopTerrainEdgeExchange} from '../src/terrain-edge-exchange.mjs';
import {applyRecord,replay} from '../src/generation/model.mjs';
import {transact} from '../src/generation/store.mjs';
import {hash,jsonBytes,seal,unseal} from '../src/generation/common.mjs';
import {edgeAppearanceFixture,appearanceCases,appearance,sceneRuleSentinels,legacyAppearanceFingerprints} from './helpers/terrain-edge-appearance.mjs';
import {setupCoherent,sourcePng} from './helpers/coherent.mjs';
import {decision} from './helpers/generation.mjs';

const recipeFor=(f,c)=>({...f.recipe,planId:c.id,assetId:c.id,policySha256:c.policy.sha256,...c.extra,edgeRole:c.role});
const rejects=(action,code)=>assert.throws(action,error=>error.errors?.some(e=>e.code===code));
const receive=(root,sha,bytes)=>{const {request,...ticket}=flow.reservePlan(root,sha);flow.recordSubmission(root,ticket);return flow.receiveResult(root,ticket,bytes);};

test('all 43 legacy terrain edge prompts and plan fingerprints remain exactly pinned without the opt-in',()=>{
 const legacy=legacyAppearanceFingerprints();assert.equal(legacy.rows.length,43);
 // Captured before adding the optional source appearance branch, across all
 // seven historical side/perimeter/native/cover policy families and roles.
 assert.equal(legacy.aggregateSha256,'8474dd19a7bf49a9f4ba4fbe5a7eae183a654dd5bb8871194c0076819ea68570');
});

test('every side, top and bottom branch replaces scene composition rules with explicit source-owned appearance only',()=>{
 const f=edgeAppearanceFixture();
 for(const c of appearanceCases()){
  const recipe=recipeFor(f,c),legacy=compileTerrainEdgeSource(f.state,recipe),plan=compileTerrainEdgeSource(f.state,{...recipe,sourceAppearance:appearance});
  for(const marker of sceneRuleSentinels){assert(legacy.request.prompt.includes(marker),c.id+' legacy fixture retains the scene rule');assert(!plan.request.prompt.includes(marker),c.id+' source must not inherit scene composition');}
  for(const rule of appearance.rules)assert(plan.request.prompt.includes(rule),c.id+' explicit source rule survives');
  assert.match(plan.request.prompt,/whole-scene style rule list is deliberately not inherited/);
  assert.deepEqual(plan.recipe.sourceAppearance,appearance);assert.deepEqual(plan.sourceScope.sourceAppearance,appearance);
  assert.equal(plan.sourceScope.styleRuleInheritance,'source-owned-only-no-scene-rules');
  assert.notEqual(plan.sha256,legacy.sha256);assert.notEqual(plan.request.prompt,legacy.request.prompt);
  assert.deepEqual(plan.target,legacy.target);assert.deepEqual(plan.qualityPolicy,legacy.qualityPolicy);
  assert.deepEqual(plan.request.images,legacy.request.images);assert.equal(plan.request.images.length,2);
  assert.deepEqual(plan.request.output,legacy.request.output);assert.equal(plan.request.maximumCalls,1);
  assert.equal(plan.sourceScope.alphaCleanupAllowed,false);assert.equal(plan.sourceScope.semanticIsolationProven,false);
  assert.deepEqual(plan.materialEvidence,legacy.materialEvidence);assert.deepEqual(plan.referenceEvidence,legacy.referenceEvidence);
  const changed=compileTerrainEdgeSource(f.state,{...recipe,sourceAppearance:{...appearance,rules:[...appearance.rules,'Keep broad cracks quiet.']}});
  assert.notEqual(changed.sha256,plan.sha256);
 }
});

test('source appearance keeps native dimensions, transparent gutter and original PNG technical gates unchanged',()=>{
 const f=edgeAppearanceFixture(),raw=sourcePng(true,611),opaque=sourcePng(false,612);
 for(const c of appearanceCases()){
  const recipe=recipeFor(f,c),old=compileTerrainEdgeSource(f.state,recipe),next=compileTerrainEdgeSource(f.state,{...recipe,sourceAppearance:appearance});
  for(const bytes of [raw,opaque]){
   const before=assessTerrainEdgeSource(old,bytes),after=assessTerrainEdgeSource(next,bytes);
   assert.equal(after.status,before.status);assert.deepEqual(after.issues,before.issues);
   assert.equal(after.rawSha256,hash(bytes));assert.equal(after.automaticSemanticDetection,false);
   assert.equal(after.sourcePngModified,false);assert.equal(after.semanticArtAcceptance,'not-assessed');
  }
  assert(assessTerrainEdgeSource(next,opaque).issues.includes('COHERENT_NO_TRANSPARENCY'));
 }
});

test('appearance is a bounded explicit typed object and rejects invalid opt-ins without rewriting a scene rule list',()=>{
 const f=edgeAppearanceFixture(),recipe=recipeFor(f,appearanceCases().at(-1));
 for(const invalid of [null,{},'source-owned-appearance-v1',{...appearance,profile:'guess-scene-style'},
  {...appearance,rules:[]},{...appearance,rules:['']},{...appearance,rules:[appearance.rules[0],appearance.rules[0]]},
  {...appearance,inheritSceneRules:true},{...appearance,rules:['https://private.invalid/model']}]){
  assert.throws(()=>compileTerrainEdgeSource(f.state,{...recipe,sourceAppearance:invalid}));
 }
 assert.deepEqual(f.state.designs.get(f.recipe.styleSha256).rules,['Preserve local color.',...sceneRuleSentinels]);
});

test('public full-seven preview, export, replay and single-use exchanges bind the exact new appearance and retain terminal unknowns',{timeout:240000},t=>{
 const f=setupCoherent(t,'Synthetic underwater stone',undefined,{transformBrief:b=>({...b,style:{...b.style,rules:sceneRuleSentinels}})});
 const base=flow.freezeCoherentSources(f.workflow,{...f.options,sourceScopes:flow.createLayerSourceScopes(f.brief.requirements)});
 flow.authorizeReferenceAssetBatch(f.workflow,base.sha256,decision('base.compute',base.sha256,'approve-compute'));
 for(const [i,sha]of base.planSha256s.entries()){const p=flow.getGenerationPlan(f.workflow,sha);receive(f.workflow,sha,sourcePng(p.target.alpha==='transparent',i+620));}
 const options={batchId:'appearance.perimeter',baseBatchSha256:base.sha256,capabilitiesSha256:f.options.capabilitiesSha256,
  coverageProfile:'full-perimeter-v1',nativeSizeProfile:'bounded-native-4m-v1',renderEnvelopeProfile:'visible-alpha8-outward16-native-rgba-v1',naturalSurfaceProfile:'reference-defined-cover-v1',
  items:flow.TERRAIN_PERIMETER_ROLES.map((role,i)=>({assetId:'appearance.perimeter.'+i,role,content:'One local native sea-worn stone boundary with unchanged original colors and orientation.',exclusions:['Independent scene subjects'],sourceAppearance:appearance}))};
 const before=flow.inspectWorkflow(f.workflow),preview=flow.previewTerrainEdgeSources(f.workflow,options);
 assert.deepEqual(flow.inspectWorkflow(f.workflow),before);assert.equal(preview.maximumCalls,undefined);assert.equal(preview.batch.maximumCalls,7);
 const changed=structuredClone(options);changed.items[0].sourceAppearance.rules.push('Retain subtle natural cracks.');
 assert.notEqual(flow.previewTerrainEdgeSources(f.workflow,changed).batch.sha256,preview.batch.sha256);
 const invalid=structuredClone(options);invalid.items[3].sourceAppearance.profile='automatic-filter';assert.throws(()=>flow.freezeTerrainEdgeSources(f.workflow,invalid));assert.deepEqual(flow.inspectWorkflow(f.workflow),before);
 const batch=flow.freezeTerrainEdgeSources(f.workflow,options);assert.equal(batch.sha256,preview.batch.sha256);assert.equal(batch.fullPerimeterComplete,true);
 const reviewDir=join(f.parent,'appearance-compute-review'),report=prepareTerrainEdgeComputeReview(f.workflow,batch.sha256,reviewDir);assert.equal(report.maximumCalls,7);
 for(const [i,sha]of batch.planSha256s.entries()){
  const p=flow.getGenerationPlan(f.workflow,sha);assert.deepEqual(p.recipe.sourceAppearance,appearance);
  assert.equal(readFileSync(join(reviewDir,`prompt-${i+1}.txt`),'utf8'),p.request.prompt+'\n');
  assert(!sceneRuleSentinels.some(s=>p.request.prompt.includes(s)));
  rejects(()=>flow.reservePlan(f.workflow,sha),'AUTHORIZATION_REQUIRED');
 }
 const original=flow.getGenerationPlan(f.workflow,batch.planSha256s[0]);
 transact(f.workflow,store=>{const state=replay(store),body=unseal(original),
  tampered=seal({...body,sourceScope:{...body.sourceScope,sourceAppearance:{...appearance,rules:['Unbound changed appearance.']}}});
  rejects(()=>applyRecord(store,state,tampered),'PLAN_RECOMPILE_MISMATCH');});
 flow.authorizeReferenceAssetBatch(f.workflow,batch.sha256,decision('appearance.compute',batch.sha256,'approve-compute'));
 const dir=join(f.parent,'appearance-first-exchange'),exchange=reserveTerrainEdgeExchange(f.workflow,batch.sha256,dir);
 assert.equal(exchange.ticket.planSha256,batch.planSha256s[0]);assert.equal(exchange.request.prompt,preview.plans[0].request.prompt);
 const raw=sourcePng(true,640),path=join(f.parent,'appearance-source.png');writeFileSync(path,raw);
 const received=receiveTerrainEdgeExchange(f.workflow,dir,path);assert.equal(received.plans[0].technicalStatus,'pass');
 assert.deepEqual(readFileSync(join(dir,'source-native.png')),raw);rejects(()=>flow.reservePlan(f.workflow,batch.planSha256s[0]),'RESERVATION_STATE');
 const unknown=join(f.parent,'appearance-unknown'),reserved=reserveTerrainEdgeExchange(f.workflow,batch.sha256,unknown);assert.equal(reserved.ticket.planSha256,batch.planSha256s[1]);
 stopTerrainEdgeExchange(f.workflow,unknown);rejects(()=>reserveTerrainEdgeExchange(f.workflow,batch.sha256,join(f.parent,'no-auto-retry')),'TERRAIN_EDGE_BATCH_STOPPED');
 assert.equal(flow.inspectWorkflow(f.workflow).plans.find(p=>p.planSha256===batch.planSha256s[1]).status,'indeterminate');
});
