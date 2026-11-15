import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import * as flow from '../src/generation/index.mjs';
import {createVisualCoherence} from '../src/generation/visual-coherence.mjs';
import {createLayerSourceScopes} from '../src/generation/layer-source.mjs';
import {hash} from '../src/generation/common.mjs';
import {setupCoherent} from './helpers/coherent.mjs';
import {decision} from './helpers/generation.mjs';
import {galleryRaster,galleryBrief,galleryAnalysis,galleryOverrides} from './helpers/reference-gallery.mjs';

const appearance=rules=>({format:'ai_scene_source_appearance_v1',profile:'source-owned-appearance-v1',promptProfile:'reference-atmosphere-v1',rules});
function visual(f,sceneFamily){
 const design=n=>JSON.parse(readFileSync(join(f.root,n),'utf8'));
 return createVisualCoherence(design('spec-draft.json'),design('style-draft.json'),f.target,{
  ...(sceneFamily?{sceneFamily}:{}),depth:'UNSELECTED_DEPTH: make every surface neutral and equally bright.'});
}

test('atmosphere opt-in removes unrelated sky material directives and binds the actual reserved request without changing legacy plans',t=>{
 const f=setupCoherent(t),coherence=visual(f,'engineered-city');
 const oldAppearance={format:'ai_scene_source_appearance_v1',profile:'source-owned-appearance-v1',rules:['Sky fades from dark violet at the top to pale grey at the bottom.']};
 const rows=[{subjectId:'sky',parentRole:'background',content:'Only a continuous atmospheric sky field.',exclusions:['Architecture and ground'],contentProfile:'scope-owned-content-v1',sourceAppearance:oldAppearance}];
 const oldOptions={...f.options,sourceScopes:createLayerSourceScopes(f.brief.requirements,rows,coherence)};
 const old=flow.freezeCoherentSources(f.workflow,oldOptions),oldPlans=old.planSha256s.map(sha=>flow.getGenerationPlan(f.workflow,sha)),sky=oldPlans.find(p=>p.instanceBinding.role==='sky');
 assert.match(sky.request.prompt,/panel spans, masonry joints/,'reproduce the prior irrelevant sky instruction');
 const own=appearance(oldAppearance.rules),scope=flow.withSourceAppearance(sky.recipe.sourceScope,own);
 const revised=flow.reviseCoherentSources(f.workflow,old.sha256,{batchId:'sky.atmosphere',replacements:[{assetId:sky.recipe.assetId,planId:'sky.atmosphere.source',intent:'isolated-layer-v4',sourceScope:scope}]});
 assert.equal(revised.newImageRequests,1);
 const child=flow.getGenerationPlan(f.workflow,revised.planSha256s.find(sha=>!old.planSha256s.includes(sha)));
 assert.deepEqual(child.recipe.parents,[sky.sha256]);assert.notEqual(child.sha256,sky.sha256);
 assert.deepEqual(child.request.images,sky.request.images);assert.deepEqual(child.qualityPolicy,sky.qualityPolicy);
 assert.equal(child.sourceScope.sourceAppearanceEvidence.promptProfile,own.promptProfile);
 assert.match(child.request.prompt,/dark violet at the top to pale grey at the bottom/);
 assert.doesNotMatch(child.request.prompt,/panel spans, masonry joints|uniform color tint across every surface|UNSELECTED_DEPTH/);
 assert.throws(()=>flow.reservePlan(f.workflow,child.sha256),e=>e.errors?.some(x=>x.code==='AUTHORIZATION_REQUIRED'));
 flow.authorizeReferenceAssetBatch(f.workflow,revised.sha256,decision('sky.atmosphere.compute',revised.sha256,'approve-compute'));
 assert.deepEqual(flow.reservePlan(f.workflow,child.sha256).request,child.request);
 for(const p of oldPlans)assert.deepEqual(flow.getGenerationPlan(f.workflow,p.sha256),p);
 assert.deepEqual(revised.planSha256s.filter(sha=>sha!==child.sha256),old.planSha256s.filter(sha=>sha!==sky.sha256));
 assert.equal(hash(flow.readGenerationInput(f.workflow,child.sha256,0)),hash(f.raw));
});

test('different continuous-floor gallery carries source-local warm wood and green garden appearance through freeze and reservation',t=>{
 const f=setupCoherent(t,'Gallery appearance',undefined,{referenceBytes:galleryRaster().png,transformBrief:galleryBrief,transformAnalysis:galleryAnalysis});
 const observations={
  sky:['Flat pale blue field through the openings; no pronounced vertical gradient is observed.'],
  outside:['Green and olive garden masses above warm earth; lower contrast than the nearby wooden crate. No blue atmospheric cast is observed.'],
  crate:['Warm orange-brown wooden faces with dark seams. This nearby crate is brighter than the near column; preserve its lit faces rather than forcing all near objects into deep shadow.']
 };
 const base=createLayerSourceScopes(f.brief.requirements,galleryOverrides,visual(f));
 const scopes=flow.withSourceAppearanceScopes(f.brief.requirements,base,Object.entries(observations).map(([subjectId,rules])=>({subjectId,sourceAppearance:appearance(rules)})));
 const options={...f.options,sourceScopes:scopes},before=flow.inspectWorkflow(f.workflow),preview=flow.previewCoherentSources(f.workflow,options);
 assert.deepEqual(flow.inspectWorkflow(f.workflow),before);
 assert.equal(preview.plans.length,7);assert(!preview.plans.some(p=>p.instanceBinding.role==='platform'));
 const batch=flow.freezeCoherentSources(f.workflow,options);
 flow.authorizeReferenceAssetBatch(f.workflow,batch.sha256,decision('gallery.atmosphere.compute',batch.sha256,'approve-compute'));
 for(const [subjectId,rules]of Object.entries(observations)){
  const p=preview.plans.find(p=>p.recipe.assetId===subjectId+'.actual');
  assert.deepEqual(p.recipe.sourceScope.sourceAppearance.rules,rules);
  const reserved=flow.reservePlan(f.workflow,p.sha256);assert.deepEqual(reserved.request,p.request);
  for(const rule of rules)assert(reserved.request.prompt.includes(rule));
  assert.doesNotMatch(reserved.request.prompt,/UNSELECTED_DEPTH|majority-surfaces-deep-shadow-v1|uniform color tint across every surface/);
  assert.equal(reserved.request.output.alpha,subjectId==='sky'?'opaque':'transparent');
  assert.equal(hash(flow.readGenerationInput(f.workflow,p.sha256,0)),hash(f.raw));
  assert.deepEqual(flow.getGenerationPlan(f.workflow,p.sha256),p);
 }
 const crate=preview.plans.find(p=>p.recipe.assetId==='crate.actual');
 assert(crate.request.prompt.includes('Near column and gallery frame'),'appearance does not erase neighboring ownership exclusions');
 assert.equal(crate.recipe.sourceScope.framingProfile,'complete-silhouette-v1');
 assert.equal(flow.inspectWorkflow(f.workflow).plans.filter(p=>p.stage==='coherent-source'&&p.received).length,0);
});

test('unknown or automatic appearance profiles cannot enter a plan',()=>{
 const own=appearance(['Selected visible values only.']);assert.deepEqual(flow.validateSourceAppearance(own),own);
 for(const value of [{...own,promptProfile:'guess-atmosphere'}, {...own,autoInfer:true}, {...own,rules:[]}])assert.throws(()=>flow.validateSourceAppearance(value));
});
