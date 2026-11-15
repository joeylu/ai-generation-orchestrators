import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import * as flow from '../src/generation/index.mjs';
import * as pipeline from '../src/coherent-pipeline.mjs';
import {compileCoherentSource,COHERENT_POLICY} from '../src/generation/coherent-source.mjs';
import {applyRecord,replay} from '../src/generation/model.mjs';
import {transact} from '../src/generation/store.mjs';
import {sourceVisualGuide,SOURCE_VISUAL_GUIDE_PROFILE} from '../src/generation/source-visual-guide.mjs';
import {hash,digest,jsonBytes,seal,unseal} from '../src/generation/common.mjs';
import {setupCoherent,sourcePng} from './helpers/coherent.mjs';
import {decision} from './helpers/generation.mjs';

const PROFILE='scope-owned-support-v1';
const rejects=(fn,code)=>assert.throws(fn,e=>e.errors?.some(issue=>issue.code===code));
const options=(f,sourceScopes,batchId='grounding.legacy')=>({...f.options,batchId,sourceScopes});
const entries=workflow=>transact(workflow,store=>new Map([...replay(store).plans].map(([sha,e])=>[sha,structuredClone(e)])));
const evidence=workflow=>Object.fromEntries(['events','blobs'].map(folder=>[folder,readdirSync(join(workflow,folder)).sort().map(name=>({name,sha256:hash(readFileSync(join(workflow,folder,name)))}))]));
function coherence(f,observations={}){return transact(f.workflow,store=>{const s=replay(store),ref=s.plans.get(f.plan.sha256);return flow.createVisualCoherence(
  s.designs.get(f.plan.recipe.specSha256),s.designs.get(f.plan.recipe.styleSha256),ref.reconstructionTarget,observations);});}
const shared=(f,scopes=flow.createLayerSourceScopes(f.brief.requirements))=>flow.withVisualCoherenceScopes(f.brief.requirements,scopes,coherence(f));
const complete=(workflow,sha,bytes)=>{const {request,...ticket}=flow.reservePlan(workflow,sha);flow.recordSubmission(workflow,ticket);return flow.receiveResult(workflow,ticket,bytes);};

// Captured before introducing the opt-in profile. These hashes cover every byte
// of the complete prompt, request and plan, not selected legacy substrings.
const LEGACY=[
  [
    ['d4b010f16f4b5d6db400ebb43fc2556e7580e851f2e22f9558fb3e51d827a411','37ae5ac7a7c85d6164f03fdaaf0d171c5022e2e4077845b2d4fcdf54c4b5fd88','abe7959ad9da852f2865ab83717deceb2ecc851fa85c53a2d3d2e60d1c204d2b'],
    ['e72f18095cf3a48bc517f89de9bf75eb3d95d0f9a0e0c256b8505eaabf711d49','63eb4ff6c9e5d132680601166f19d863808d430ddae31ea0fbcfb74d1cb55647','cea838e6c794cb37a0747a84e635833eb76cb1955c822c3e4e1f6259fc3f1b95'],
    ['39bf1485ed86ce42e7dc1bd09f8a41718335ff65fe7370df08ea6bbf5c899a20','10eff158b2f5b84c88b0b5fa529731296b2c654386772268038857120bc87123','3251d5e25f3c17a7dc59b1d022d685789794850da5f7a76ba65aff87df77ac46'],
    ['1fc46a9dabc0fad35e7762af1f0888b53a41270816189535a815fe2c6204ef60','964cdf0367ba012de1d9daddf6886f9f9b613703a40b4911e4996f9a398b3713','acdf2bfefd2b592879b9c5ccbf6472c4e4dfd6d337e2ea55ab54d77c456188fa'],
    ['0e9e60fc3217dc9f3473ef032bcadb4b98dd2a861883bfeb4bf4d96de1cfb4f8','b71b81e30838badbb57e5310e8c246d043f90b10dda277b4cbe742e074f7e06f','fbc16f105ff0ae9b9c053ced1645a0e3406f780b078e19b0b18628255f83394d'],
    ['0e9e60fc3217dc9f3473ef032bcadb4b98dd2a861883bfeb4bf4d96de1cfb4f8','c57b5f7a6a02562188909b83644911ab04d0121717ed431998dcc1a3831a8c5c','fbc16f105ff0ae9b9c053ced1645a0e3406f780b078e19b0b18628255f83394d'],
  ],
  [
    ['cb918fd269a37db4ac1de976d5e25da4711df8b6a1cd829bb90c24ee6ad21a58','901a89191f403f7c8360c25669dc82a53fa2cc6be325014f0415d5d563349d89','f71766f36686ed330616c4cb6e90d14eb47f0c534d92c2ad26849a68f05065fe'],
    ['9769dd8c63357dadf40271ee1fdef87e89946b642bbaa07f3924970f637d08de','35d6b79c68fe393aaa1b8f2fae840443890f4208c018282321ed6b3a7c6ed63d','505d035b9ac341197644a32da96aef61e45cfa4bd68981e92d3c8e9b5292dd93'],
    ['32ec1c4d9a990a87bc6bf5655d029024acbaf7d018e3fcf74005c12a8ee91253','3cffd50ee13ed7a4dc35a2bab083056aa06a08cff9136df5a4ef6f6b43729715','97cee966008f753351b624dc79b5972d2954b68e0d3a45818cd8d507e5678945'],
    ['2487e43fd56e95c7e20aef9b3fccbe8ae30c6342af80fd273bf7d31847a06d86','4815afebe2d9cae32e9297c8a18ada4359536672a1c008bf16b81bfb55afb737','13c3379ac4762016245d235de1a720fd7cb2265d652a69590b1e3cd60f963dc9'],
    ['83ba5d7e2e94145fc1cbb8aa308ac0fcf9905cb4c5fc500ba0ab6b41b1b78ef2','bcf47854c4b8974588047cebdf78dd0f60d84153f4174fe49ab4b3b345c1015c','4035613e7c1822f14b65089be9e2db914e48611ce9431c927f1178a04a3927a7'],
    ['83ba5d7e2e94145fc1cbb8aa308ac0fcf9905cb4c5fc500ba0ab6b41b1b78ef2','f15654fc9d5e3c80812d7fcaaa9d11281d38feb58ba7a6936f652fa5a5062306','4035613e7c1822f14b65089be9e2db914e48611ce9431c927f1178a04a3927a7'],
  ],
];
LEGACY.push([...LEGACY[1].slice(0,4),
  ['8ea2a8376cbf437071ce2ec162c4798a1f87168debbd87428677c4bddc356571','cd1e6de03b71c4ccc5e58c2e988218ed00e8f6c93656b1d41c688bf3465b072b','17d9fe52bf340f0b23c02c513f6dfd58a342a604725f2de3b43613617e1b4a82'],
  ['8ea2a8376cbf437071ce2ec162c4798a1f87168debbd87428677c4bddc356571','f874869047b9b574db93819bd3cf3ee8ca9e7353650ca2ea58c163a6b0c6b18f','17d9fe52bf340f0b23c02c513f6dfd58a342a604725f2de3b43613617e1b4a82'],
]);

test('default v1, coherent v2 and guided v3 replay fixed complete prompt, plan and request SHA-256 bytes',t=>{
  const f=setupCoherent(t),plain=flow.createLayerSourceScopes(f.brief.requirements),coherent=shared(f,plain),guided=flow.withSourceVisualGuideScopes(f.brief.requirements,coherent,['foreground']);
  const before=evidence(f.workflow);
  for(const [index,scopes]of [plain,coherent,guided].entries()){
    const proposal=flow.previewCoherentSources(f.workflow,options(f,scopes));
    assert.deepEqual(proposal.plans.map(p=>[hash(p.request.prompt),p.sha256,digest(p.request)]),LEGACY[index]);
    assert(proposal.plans.every(p=>!Object.hasOwn(p.recipe.sourceScope,'groundingProfile')));
    assert.deepEqual(evidence(f.workflow),before);
  }
  const batch=flow.freezeCoherentSources(f.workflow,options(f,guided));
  assert.deepEqual(batch.planSha256s,LEGACY[2].map(r=>r[1]));
  for(const [i,sha]of batch.planSha256s.entries()){
    const p=flow.getGenerationPlan(f.workflow,sha);assert.deepEqual([hash(p.request.prompt),p.sha256,digest(p.request)],LEGACY[2][i]);
  }
  assert.equal(flow.getGenerationPlan(f.workflow,batch.planSha256s.at(-1)).request.images.length,2);
});

test('grounding opt-in composes with coherence and source guide in either order while unchanged sources retain exact plans',t=>{
  const f=setupCoherent(t),plain=flow.createLayerSourceScopes(f.brief.requirements),visual=coherence(f),before=evidence(f.workflow);
  const addGround=s=>flow.withScopeOwnedGroundingScopes(f.brief.requirements,s,['foreground','landmark']);
  const addGuide=s=>flow.withSourceVisualGuideScopes(f.brief.requirements,s,['foreground']);
  const addVisual=s=>flow.withVisualCoherenceScopes(f.brief.requirements,s,visual);
  const scopes=addVisual(addGuide(addGround(plain)));
  assert.deepEqual(scopes,addGround(addGuide(addVisual(plain))));
  assert.deepEqual(scopes,addGuide(addGround(addVisual(plain))));
  assert.equal(scopes.format,'ai_scene_layer_source_scopes_v4');
  assert.equal(flow.SCOPE_OWNED_GROUNDING_PROFILE,PROFILE);
  assert.deepEqual(flow.withScopeOwnedGroundingScopes(f.brief.requirements,scopes,['foreground','landmark']),scopes);
  const old=flow.previewCoherentSources(f.workflow,options(f,addGuide(addVisual(plain)))),next=flow.previewCoherentSources(f.workflow,options(f,scopes));
  for(const [index,plan]of next.plans.entries()){
    if(!['landmark','foreground'].includes(plan.instanceBinding.role)){assert.deepEqual(plan,old.plans[index]);continue;}
    assert.equal(plan.recipe.intent,'isolated-layer-v4');assert.equal(plan.format,'ai_scene_generation_plan_v27');
    assert.equal(plan.recipe.sourceScope.format,'ai_scene_layer_source_scope_v4');assert.equal(plan.recipe.sourceScope.groundingProfile,PROFILE);
    assert.match(plan.compiler,/-scope-owned-support-v1$/);assert.notEqual(plan.sha256,old.plans[index].sha256);
    assert.equal(plan.request.images.length,plan.instanceBinding.role==='foreground'?2:1);
    assert.doesNotMatch(plan.request.prompt,/Use compact attached roots or foundations/);
    assert.deepEqual(plan.request.images,old.plans[index].request.images);
    assert.equal(plan.sourceScope.alphaCleanupAllowed,false);assert.equal(plan.sourceScope.semanticIsolationProven,false);
    assert.equal(plan.recipe.sourceScope.visualCoherence.sha256,visual.sha256);
    const fromSingle=flow.withScopeOwnedGrounding(old.plans[index].recipe.sourceScope);
    assert.deepEqual(fromSingle,plan.recipe.sourceScope);assert.deepEqual(flow.withScopeOwnedGrounding(fromSingle),fromSingle);
    if(plan.instanceBinding.role==='foreground'){
      const unguided=flow.previewCoherentSources(f.workflow,options(f,addGround(addVisual(plain)))).plans[index];
      assert.deepEqual(flow.withSourceVisualGuide(unguided.recipe.sourceScope),fromSingle);
      assert.deepEqual(flow.withScopeOwnedGrounding(flow.withSourceVisualGuide(unguided.recipe.sourceScope)),fromSingle);
    }
  }
  const withoutVisual=flow.previewCoherentSources(f.workflow,options(f,addGround(plain))).plans.at(-1);
  assert.equal(withoutVisual.request.images.length,1);assert(!Object.hasOwn(withoutVisual.recipe.sourceScope,'visualCoherence'));
  assert.doesNotMatch(withoutVisual.request.prompt,/Use compact attached roots or foundations/);
  assert.match(withoutVisual.request.prompt,/single.asset brief/i);assert.match(withoutVisual.request.prompt,/support|contact/i);
  assert.deepEqual(evidence(f.workflow),before);
});

test('explicit rock and fallen-root briefs survive intact without shared support content introducing another asset',t=>{
  const f=setupCoherent(t,'Synthetic frozen mountain'),plain=shared(f),before=evidence(f.workflow);
  const briefs=[
    'One compact dark rubble group with only a few short attached dead twigs; no complete fallen log or root arch.',
    'One fallen root plate with thick attached roots, sparse dead branches and its own small soil base.',
  ];
  for(const [index,content]of briefs.entries()){
    const base=flow.previewCoherentSources(f.workflow,options(f,plain)).plans.at(-1),scope=flow.withScopeOwnedGrounding(seal({...unseal(base.recipe.sourceScope),content,contentOrigin:'explicit-source-brief'}));
    transact(f.workflow,store=>{
      const plan=compileCoherentSource(replay(store),{...base.recipe,planId:'grounding.brief.'+index,sourceScope:scope},sha=>store.readBlob(sha));
      assert(plan.request.prompt.includes('SINGLE-ASSET BRIEF: '+content));
      assert.doesNotMatch(plan.request.prompt,/Use compact attached roots or foundations|No (?:roots|vegetation)|(?:ban|forbid) all (?:roots|vegetation)/i);
      assert.deepEqual(plan.request.images,base.request.images);assert.equal(plan.recipe.sourceScope.content,content);
    });
  }
  assert.deepEqual(evidence(f.workflow),before);
});

test('scenery source support is also explicit and inherited legitimate foundations remain part of the brief',t=>{
  const f=setupCoherent(t,undefined,undefined,{transformBrief:b=>({...b,requirements:seal({...unseal(b.requirements),subjects:b.requirements.subjects.map(s=>s.subjectId==='landmark'?{...s,role:'scenery',content:'One shrine with its own stone foundation and moss.'}:s)})})});
  const scopes=flow.withScopeOwnedGroundingScopes(f.brief.requirements,shared(f),['landmark']);
  const plan=flow.previewCoherentSources(f.workflow,options(f,scopes)).plans.find(p=>p.instanceBinding.role==='scenery');
  assert.equal(plan.recipe.sourceScope.groundingProfile,PROFILE);assert(plan.request.prompt.includes('SINGLE-ASSET BRIEF: One shrine with its own stone foundation and moss.'));
  assert.doesNotMatch(plan.request.prompt,/Use compact attached roots or foundations/);
});

test('engineered grounding replaces inferred footing instructions and preserves explicitly requested fixture bases',t=>{
  const f=setupCoherent(t,'Synthetic municipal service deck'),content='One complete dark junction fixture with its own low rectangular steel base and two short cable connections.';
  const plain=flow.createLayerSourceScopes(f.brief.requirements,[{subjectId:'foreground',content,parentRole:'foreground',exclusions:['Neighboring utility cabinet']}]);
  const legacy=flow.withVisualCoherenceScopes(f.brief.requirements,plain,coherence(f,{sceneFamily:'engineered-city'}));
  const old=flow.previewCoherentSources(f.workflow,options(f,legacy)),oldBytes=jsonBytes(old),before=evidence(f.workflow);
  const scopes=flow.withScopeOwnedGroundingScopes(f.brief.requirements,legacy,['foreground']),next=flow.previewCoherentSources(f.workflow,options(f,scopes));
  for(const [index,plan]of next.plans.entries()){
    if(plan.instanceBinding.role!=='foreground'){assert.deepEqual(plan,old.plans[index]);continue;}
    assert.match(old.plans[index].request.prompt,/Use only the asset's own compact structural footing, mounting feet, bracket or equipment base/);
    assert.doesNotMatch(plan.request.prompt,/Use only the asset's own compact structural footing, mounting feet, bracket or equipment base|Use compact attached roots or foundations/);
    assert(plan.request.prompt.includes('SINGLE-ASSET BRIEF: '+content));
    assert.match(plan.request.prompt,/only when explicitly declared by the SINGLE-ASSET BRIEF/);
    assert.equal(plan.recipe.sourceScope.content,content);assert.equal(plan.recipe.sourceScope.groundingProfile,PROFILE);
    assert.equal(plan.compiler,'scene-kit-isolated-layer-source-v4-coherent-v2-engineered-scope-owned-support-v1');
    assert.deepEqual(plan.request.images,old.plans[index].request.images);assert.notEqual(plan.sha256,old.plans[index].sha256);
  }
  assert.deepEqual(jsonBytes(flow.previewCoherentSources(f.workflow,options(f,legacy))),oldBytes);
  assert.deepEqual(evidence(f.workflow),before);
});

test('version-specific exact shapes reject grounding leakage, unknown profiles, opaque roles and unbound recipe fields',t=>{
  const f=setupCoherent(t),plain=flow.createLayerSourceScopes(f.brief.requirements),visual=shared(f,plain),guided=flow.withSourceVisualGuideScopes(f.brief.requirements,visual,['foreground']);
  const grounded=flow.withScopeOwnedGroundingScopes(f.brief.requirements,guided,['foreground']),before=evidence(f.workflow);
  for(const subjects of [[],['missing'],['foreground','foreground']])rejects(()=>flow.withScopeOwnedGroundingScopes(f.brief.requirements,plain,subjects),'SCOPE_OWNED_GROUNDING_SUBJECTS');
  for(const subject of ['sky','ground','platform'])rejects(()=>flow.withScopeOwnedGroundingScopes(f.brief.requirements,plain,[subject]),'SCOPE_OWNED_GROUNDING_ROLE');
  for(const legacy of [plain,visual,guided]){
    const leaked=seal({...unseal(legacy),subjects:legacy.subjects.map(row=>row.subjectId==='foreground'?{...row,groundingProfile:PROFILE}:row)});
    rejects(()=>flow.validateLayerSourceScopes(f.brief.requirements,leaked),'WORKFLOW_SHAPE');
  }
  const modify=change=>seal({...unseal(grounded),subjects:grounded.subjects.map(row=>row.subjectId==='foreground'?{...row,...change}:row)});
  rejects(()=>flow.validateLayerSourceScopes(f.brief.requirements,modify({groundingProfile:'invented-support'})),'SCOPE_OWNED_GROUNDING_PROFILE');
  rejects(()=>flow.validateLayerSourceScopes(f.brief.requirements,modify({groundingProfile:PROFILE,rootBudget:1})),'WORKFLOW_SHAPE');
  rejects(()=>flow.validateLayerSourceScopes(f.brief.requirements,seal({...unseal(grounded),groundingProfile:PROFILE})),'WORKFLOW_SHAPE');
  const noGround=grounded.subjects.map(({groundingProfile,...row})=>row);
  rejects(()=>flow.validateLayerSourceScopes(f.brief.requirements,seal({...unseal(grounded),subjects:noGround})),'SCOPE_OWNED_GROUNDING_SUBJECTS');
  const proposal=flow.previewCoherentSources(f.workflow,options(f,grounded)),front=proposal.plans.at(-1);
  for(const p of proposal.plans.filter(p=>['material','sky','platform'].includes(p.instanceBinding.role)))rejects(()=>flow.withScopeOwnedGrounding(p.recipe.sourceScope),'SCOPE_OWNED_GROUNDING_ROLE');
  transact(f.workflow,store=>{
    const state=replay(store),compile=sourceScope=>compileCoherentSource(state,{...front.recipe,sourceScope},sha=>store.readBlob(sha));
    rejects(()=>compile(seal({...unseal(front.recipe.sourceScope),groundingProfile:'invented-support'})),'SCOPE_OWNED_GROUNDING_PROFILE');
    rejects(()=>compile(seal({...unseal(front.recipe.sourceScope),format:'ai_scene_layer_source_scope_v3'})),'WORKFLOW_SHAPE');
    const {groundingProfile,...missing}=unseal(front.recipe.sourceScope);
    rejects(()=>compile(seal(missing)),'WORKFLOW_SHAPE');
    rejects(()=>compileCoherentSource(state,{...front.recipe,groundingProfile:PROFILE},sha=>store.readBlob(sha)),'WORKFLOW_SHAPE');
  });
  assert.deepEqual(evidence(f.workflow),before);
});

test('model replay binds grounding instructions, compiler identity, scope profile and canonical two-input evidence',t=>{
  const f=setupCoherent(t),scopes=flow.withScopeOwnedGroundingScopes(f.brief.requirements,flow.withSourceVisualGuideScopes(f.brief.requirements,shared(f),['foreground']),['foreground']);
  const plan=flow.previewCoherentSources(f.workflow,options(f,scopes)).plans.at(-1),guide=sourceVisualGuide(SOURCE_VISUAL_GUIDE_PROFILE),before=evidence(f.workflow);
  transact(f.workflow,store=>{
    const state=replay(store),validStore={...store,readBlob:sha=>sha===guide.artifact.sha256?guide.bytes:store.readBlob(sha)};
    const apply=p=>applyRecord(validStore,{...state,plans:new Map(state.plans),ids:new Set(state.ids)},p);
    apply(plan);
    for(const change of [
      {compiler:plan.compiler.replace('-scope-owned-support-v1','')},
      {request:{...plan.request,prompt:plan.request.prompt+'\nUse compact attached roots or foundations.'}},
      {request:{...plan.request,images:[...plan.request.images].reverse()}},
      {sourceScope:{...plan.sourceScope,groundingProfile:'invented-support'}},
    ])rejects(()=>apply(seal({...unseal(plan),...change})),'PLAN_RECOMPILE_MISMATCH');
    const altered=Buffer.from(guide.bytes);altered[altered.length-1]^=1;
    rejects(()=>applyRecord({...validStore,readBlob:sha=>sha===guide.artifact.sha256?altered:store.readBlob(sha)},
      {...state,plans:new Map(state.plans),ids:new Set(state.ids)},plan),'SOURCE_VISUAL_GUIDE_REPLAY');
  });
  const batch=flow.freezeCoherentSources(f.workflow,options(f,scopes));
  assert.deepEqual(flow.getGenerationPlan(f.workflow,batch.planSha256s.at(-1)),plan);
  assert.deepEqual(flow.readGenerationInput(f.workflow,plan.sha256,0),f.raw);
  assert.deepEqual(flow.readGenerationInput(f.workflow,plan.sha256,1),guide.bytes);
  assert.equal(evidence(f.workflow).blobs.length,before.blobs.length+1);
});

test('grounded replacements of authorized-unused and planned parents need fresh exact approval and preserve historical native bytes',{timeout:180000},t=>{
  const f=setupCoherent(t),scopes=flow.withSourceVisualGuideScopes(f.brief.requirements,shared(f),['foreground']),batch=flow.freezeCoherentSources(f.workflow,options(f,scopes,'grounding.original'));
  flow.authorizeReferenceAssetBatch(f.workflow,batch.sha256,decision('grounding.original.compute',batch.sha256,'approve-compute'));
  const leftSha=batch.planSha256s.at(-2),rightSha=batch.planSha256s.at(-1),leftRaw=sourcePng(true,3);
  assert.equal(complete(f.workflow,leftSha,leftRaw).technical.status,'pass');
  const old=entries(f.workflow),nativeFiles=evidence(f.workflow).blobs,right=old.get(rightSha).plan;
  assert.equal(old.get(rightSha).status,'authorized');assert(!Object.hasOwn(old.get(rightSha),'attempt'));
  const replacement=plan=>({assetId:plan.recipe.assetId,planId:'grounding.child',intent:flow.LAYER_SOURCE_INTENT,sourceScope:flow.withScopeOwnedGrounding(plan.recipe.sourceScope)});
  const first=flow.reviseCoherentSources(f.workflow,batch.sha256,{batchId:'grounding.child.batch',replacements:[replacement(right)]}),firstSha=first.planSha256s.at(-1);
  const firstPlan=flow.getGenerationPlan(f.workflow,firstSha),beforeSecond=entries(f.workflow);
  assert.equal(first.newImageRequests,1);assert.deepEqual(first.planSha256s.slice(0,-1),batch.planSha256s.slice(0,-1));
  rejects(()=>flow.reservePlan(f.workflow,firstSha),'AUTHORIZATION_REQUIRED');
  const newScope=seal({...unseal(firstPlan.recipe.sourceScope),content:'One dark rubble group with only a few short attached twigs.',contentOrigin:'explicit-source-brief'});
  const second=flow.reviseCoherentSources(f.workflow,first.sha256,{batchId:'grounding.planned.child.batch',replacements:[{assetId:right.recipe.assetId,
    planId:'grounding.planned.child',intent:flow.LAYER_SOURCE_INTENT,sourceScope:newScope}]}),secondSha=second.planSha256s.at(-1),after=entries(f.workflow);
  for(const [sha,e]of beforeSecond)assert.deepEqual(after.get(sha),e);
  for(const [sha,e]of old)assert.deepEqual(after.get(sha),e);
  assert.deepEqual(evidence(f.workflow).blobs,nativeFiles);
  assert.equal(after.get(firstSha).status,'planned');assert.equal(after.get(secondSha).status,'planned');
  assert.deepEqual(after.get(secondSha).plan.recipe.parents,[firstSha]);assert.notEqual(secondSha,firstSha);
  rejects(()=>flow.reservePlan(f.workflow,secondSha),'AUTHORIZATION_REQUIRED');
  rejects(()=>flow.authorizeReferenceAssetBatch(f.workflow,second.sha256,decision('grounding.old.approval',batch.sha256,'approve-compute')),'AUTHORIZATION_STATE');
  flow.authorizeReferenceAssetBatch(f.workflow,second.sha256,decision('grounding.fresh.approval',second.sha256,'approve-compute'));
  const raw=sourcePng(true,7);assert.equal(complete(f.workflow,secondSha,raw).technical.status,'pass');
  assert.deepEqual(flow.getGenerationResult(f.workflow,leftSha).bytes,leftRaw);assert.deepEqual(flow.getGenerationResult(f.workflow,secondSha).bytes,raw);
  assert.deepEqual(flow.getGenerationPlan(f.workflow,rightSha),right);assert.equal(entries(f.workflow).get(rightSha).status,'authorized');
});

test('compute export and exact two-input reception retain v4 grounding evidence without granting semantic acceptance',{timeout:180000},t=>{
  const f=setupCoherent(t),scopes=flow.withScopeOwnedGroundingScopes(f.brief.requirements,flow.withSourceVisualGuideScopes(f.brief.requirements,shared(f),['foreground']),['foreground']);
  const batch=flow.freezeCoherentSources(f.workflow,options(f,scopes,'grounding.export'));
  flow.authorizeReferenceAssetBatch(f.workflow,batch.sha256,decision('grounding.export.compute',batch.sha256,'approve-compute'));
  for(const [index,sha]of batch.planSha256s.slice(0,-2).entries()){
    const p=flow.getGenerationPlan(f.workflow,sha);assert.equal(complete(f.workflow,sha,sourcePng(p.target.alpha==='transparent',index+11)).technical.status,'pass');
  }
  // Only synthetic project metadata to inspect an already accepted fixture.
  const referenceProject=JSON.parse(readFileSync(join(f.root,'project.json')));
  writeFileSync(join(f.root,'coherent-project.json'),jsonBytes(seal({format:'ai_scene_coherent_project_v1',projectId:referenceProject.projectId,
    referenceProjectSha256:referenceProject.sha256,policySha256:COHERENT_POLICY.sha256})));
  writeFileSync(join(f.root,'coherent-policy.json'),jsonBytes(COHERENT_POLICY));
  const before=evidence(f.workflow),out=join(f.parent,'grounding-compute-review'),review=pipeline.exportCoherentComputeReview(f.root,out);
  assert.equal(review.remainingCalls,2);const scopeReview=JSON.parse(readFileSync(join(out,'source-scope-review.json')));
  for(const row of scopeReview.sources.filter(row=>row.role==='foreground')){assert.equal(row.scope.format,'ai_scene_layer_source_scope_v4');assert.equal(row.scope.groundingProfile,PROFILE);}
  assert.equal(pipeline.exportCoherentComputeReview(f.root,out).sha256,review.sha256);assert.deepEqual(evidence(f.workflow),before);
  const exchangeDir=join(f.parent,'grounding-exchange'),exchange=pipeline.reserveCoherentExchange(f.root,exchangeDir),guide=sourceVisualGuide(SOURCE_VISUAL_GUIDE_PROFILE);
  assert.equal(exchange.ticket.planSha256,batch.planSha256s.at(-2));assert.equal(exchange.request.images.length,2);
  assert.equal(exchange.ticket.requestSha256,digest(flow.getGenerationPlan(f.workflow,exchange.ticket.planSha256).request));
  assert.deepEqual(readFileSync(join(exchangeDir,'input-1.png')),f.raw);assert.deepEqual(readFileSync(join(exchangeDir,'input-2.png')),guide.bytes);
  const source=sourcePng(true,21),file=join(f.parent,'grounding-native.png');writeFileSync(file,source);
  pipeline.receiveCoherentExchange(f.root,exchangeDir,file);
  assert.deepEqual(readFileSync(join(exchangeDir,'source-native.png')),source);
  const result=flow.getGenerationResult(f.workflow,exchange.ticket.planSha256);assert.equal(result.result.technical.status,'pass');assert.deepEqual(result.bytes,source);
  assert.equal(entries(f.workflow).get(exchange.ticket.planSha256).status,'pending-visual-review');
  assert.equal(flow.getGenerationPlan(f.workflow,exchange.ticket.planSha256).sourceScope.semanticIsolationProven,false);
  const finalSha=batch.planSha256s.at(-1),finalRaw=sourcePng(true,22);assert.equal(complete(f.workflow,finalSha,finalRaw).technical.status,'pass');
  const candidate=join(f.parent,'grounding-candidate'),beforeAssembly=evidence(f.workflow);
  flow.buildCoherentCandidate(f.workflow,batch.sha256,'grounding.candidate',candidate);
  flow.verifyCoherentCandidate(f.workflow,batch.sha256,'grounding.candidate',candidate);
  const readiness=JSON.parse(readFileSync(join(candidate,'readiness.json')));
  for(const row of readiness.sourceEvidence.filter(row=>row.role==='foreground')){
    const scope=JSON.parse(readFileSync(join(candidate,`evidence/${row.assetId}-scope.json`))),plan=flow.getGenerationPlan(f.workflow,row.planSha256);
    assert.equal(scope.format,'ai_scene_layer_source_scope_v4');assert.equal(scope.groundingProfile,PROFILE);
    assert.equal(row.scopeSha256,scope.sha256);assert.deepEqual(scope,plan.recipe.sourceScope);
    assert.equal(row.artAcceptance,'not-assessed');assert.equal(row.semanticIsolation,'not-assessed');
    assert.deepEqual(readFileSync(join(candidate,`source/${row.assetId}.png`)),flow.getGenerationResult(f.workflow,row.planSha256).bytes);
  }
  assert.equal(readiness.artAcceptance,'not-assessed');assert.equal(readiness.productionKit,false);assert.deepEqual(evidence(f.workflow),beforeAssembly);
});
