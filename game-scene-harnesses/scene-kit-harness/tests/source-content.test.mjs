import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {setupCoherent} from './helpers/coherent.mjs';
import {decision} from './helpers/generation.mjs';
import {seal,unseal} from '../src/generation/common.mjs';
import * as flow from '../src/generation/index.mjs';
import {createVisualCoherence} from '../src/generation/visual-coherence.mjs';
import {createLayerSourceScopes,scopeForCoherentItem} from '../src/generation/layer-source.mjs';

const profile='scope-owned-content-v1';
const parents={sky:'background',backdrop:'far',ground:'main',platform:'main',foreground:'foreground'};
function fixture(t){
 const f=setupCoherent(t,'Orbital engineering',undefined,{transformBrief:b=>({...b,requirements:seal({...unseal(b.requirements),
  subjects:b.requirements.subjects.map(s=>({...s,role:s.subjectId==='landmark'?'backdrop':s.role,
   content:s.subjectId==='landmark'?'One fixed orbital ring and station group; retain its two opposite arms and transparent openings.':s.subjectId==='sky'?'Deep space with a softly lit planet arc.':s.content}))})})});
 const design=n=>JSON.parse(readFileSync(join(f.root,n))),record=createVisualCoherence(design('spec-draft.json'),design('style-draft.json'),f.target,{sceneFamily:'engineered-city'});
 const rows=f.brief.requirements.subjects.map(s=>({subjectId:s.subjectId,parentRole:parents[s.role],content:s.content,exclusions:[],contentProfile:profile}));
 return {...f,record,rows};
}

test('explicit content ownership removes foreign city subjects and plural erasure from actual frozen and reserved requests',t=>{
 const f=fixture(t),legacyOptions={...f.options,sourceScopes:createLayerSourceScopes(f.brief.requirements,f.rows.map(({contentProfile,...r})=>r),f.record)};
 const before=flow.inspectWorkflow(f.workflow),legacy=flow.previewCoherentSources(f.workflow,legacyOptions);
 assert.match(legacy.plans.find(p=>p.instanceBinding.role==='backdrop').request.prompt,/city-building group/);
 const selected={...f.options,batchId:'owned.content',sourceScopes:createLayerSourceScopes(f.brief.requirements,f.rows,f.record)};
 const preview=flow.previewCoherentSources(f.workflow,selected);
 assert.deepEqual(flow.inspectWorkflow(f.workflow),before);
 for(const p of preview.plans){
  const old=legacy.plans.find(v=>v.recipe.assetId===p.recipe.assetId);
  assert.notEqual(p.sha256,old.sha256);assert.deepEqual(p.qualityPolicy,old.qualityPolicy);
  assert.deepEqual(p.request.images.map(i=>i.artifact),old.request.images.map(i=>i.artifact));
  assert.equal(p.request.images[0].role,'accepted-scene-style-material-light-and-declared-content-reference');
  assert.match(p.compiler,/-scope-owned-content-v1$/);
  assert.equal(p.recipe.sourceScope.contentProfile,profile);
  assert.doesNotMatch(p.request.prompt,/One isolated distant city-building|Opaque city sky|this is an engineered city asset|not a request for both sides/);
 }
 const group=preview.plans.find(p=>p.instanceBinding.role==='backdrop');
 assert.match(group.request.prompt,/opposite-side members/);assert.match(group.request.prompt,/orbital ring and station/);
 assert.match(group.request.prompt,/source-local intent with reasonable proportion/);
 const repeated=preview.plans.filter(p=>p.instanceBinding.role==='foreground');assert.equal(repeated.length,2);
 for(const p of repeated)assert.match(p.request.prompt,/Repeated subject-instance counts refer to separate requests: generate only ONE instance here/);
 assert(!group.recipe.sourceScope.referenceStructure);
 assert.match(preview.plans.find(p=>p.instanceBinding.role==='material').request.prompt,/manufactured MATERIAL FIELD/);
 const batch=flow.freezeCoherentSources(f.workflow,selected);
 assert.deepEqual(flow.getGenerationPlan(f.workflow,group.sha256),group);
 assert.throws(()=>flow.reservePlan(f.workflow,group.sha256),e=>e.errors?.some(x=>x.code==='AUTHORIZATION_REQUIRED'));
 assert.match(legacy.batch.sha256,/^[a-f0-9]{64}$/);
 assert.throws(()=>flow.authorizeReferenceAssetBatch(f.workflow,batch.sha256,decision('old.compute',legacy.batch.sha256,'approve-compute')),e=>e.errors?.length>0);
 flow.authorizeReferenceAssetBatch(f.workflow,batch.sha256,decision('new.compute',batch.sha256,'approve-compute'));
 const reserved=flow.reservePlan(f.workflow,group.sha256);assert.deepEqual(reserved.request,group.request);
 assert.deepEqual(flow.previewCoherentSources(f.workflow,legacyOptions),legacy);
});

test('unknown content profiles and mixed material ownership are rejected before planning',t=>{
 const f=fixture(t);
 assert.throws(()=>createLayerSourceScopes(f.brief.requirements,[{...f.rows[0],contentProfile:'automatic-subject-inference'}]),e=>e.errors?.some(x=>x.code==='SOURCE_CONTENT_PROFILE'));
 const requirements=seal({...unseal(f.brief.requirements),subjects:[...f.brief.requirements.subjects,{...f.brief.requirements.subjects.find(s=>s.role==='ground'),subjectId:'another.ground'}]});
 const scopes=createLayerSourceScopes(requirements,f.rows);
 // A single material source cannot silently use the first ground's profile.
 assert.throws(()=>scopeForCoherentItem(requirements,scopes,{role:'material'}),e=>e.errors?.some(x=>x.code==='SOURCE_CONTENT_MATERIAL_AMBIGUOUS'));
});
