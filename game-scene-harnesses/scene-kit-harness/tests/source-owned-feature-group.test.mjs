import test from 'node:test';
import assert from 'node:assert/strict';
import {setupCoherent} from './helpers/coherent.mjs';
import {hash,seal,unseal} from '../src/generation/common.mjs';
import {createReferenceStructure} from '../src/reference-feature-layout.mjs';
import {createLayerSourceScopes} from '../src/generation/layer-source.mjs';
import * as flow from '../src/generation/index.mjs';

test('explicit owned feature group survives compilation, freezing and replay without weakening legacy plans',t=>{
  const f=setupCoherent(t),asset={instanceId:'landmark.actual',subjectId:'landmark',
    features:[{featureId:'left.tower',description:'Left fixed tower',target:{x:150,y:40},toleranceWorld:8},
      {featureId:'right.tower',description:'Right fixed tower',target:{x:210,y:40},toleranceWorld:8}],
    checks:[{checkId:'fixed.crossing',description:'Both towers and the connecting crossing belong to this single fixed group; keep the opening below.'}]};
  const make=part=>createReferenceStructure({referenceRawSha256:hash(f.raw),viewport:{width:256,height:144},assets:[part]});
  const scope=s=>createLayerSourceScopes(f.brief.requirements,[{subjectId:'landmark',parentRole:'far',
    content:'One fixed architectural group with left and right towers and their crossing.',exclusions:[],referenceStructure:s}]);
  const legacyStructure=make(asset),options={...f.options,sourceScopes:scope(legacyStructure)};
  const legacy=flow.previewCoherentSources(f.workflow,options),old=legacy.plans.find(p=>p.recipe.assetId==='landmark.actual');
  // Captured before adding this opt-in; historical no-field bytes must replay.
  assert.equal(old.sha256,'d14de7063411377ae35492cd89dadf8d0eb65ddc6b25f1e42705519e32067c52');
  assert(old.request.prompt.includes('not a request for both sides or extra scene layers'));
  const group=make({...asset,compositionProfile:'source-owned-feature-group-v1'});
  const selected={...options,batchId:'explicit.group',sourceScopes:scope(group)};
  const preview=flow.previewCoherentSources(f.workflow,selected),p=preview.plans.find(p=>p.recipe.assetId==='landmark.actual');
  assert.notEqual(p.sha256,old.sha256);
  assert(!p.request.prompt.includes('not a request for both sides'));
  assert(p.request.prompt.includes('Keep every declared part, including opposite-side parts'));
  assert(p.request.prompt.includes(asset.checks[0].description));
  assert(p.request.prompt.includes('Do not add unowned neighboring subjects'));
  assert.equal(p.recipe.sourceScope.referenceStructure.assets[0].compositionProfile,'source-owned-feature-group-v1');
  assert.equal(p.request.images.length,old.request.images.length);
  assert.deepEqual(p.request.images,old.request.images);
  assert.deepEqual(p.qualityPolicy,old.qualityPolicy);
  assert.deepEqual(p.target,old.target);
  assert.deepEqual(flow.previewCoherentSources(f.workflow,options),legacy);
  const batch=flow.freezeCoherentSources(f.workflow,selected);
  assert(batch.planSha256s.includes(p.sha256));assert.deepEqual(flow.getGenerationPlan(f.workflow,p.sha256),p);
  assert.throws(()=>flow.reservePlan(f.workflow,p.sha256),e=>e.errors?.some(x=>x.code==='AUTHORIZATION_REQUIRED'));
  assert.throws(()=>make({...asset,compositionProfile:'arbitrary-scene'}));
  // Structure identity still protects the opt-in from being stripped in a revision.
  const replacement=flow.getGenerationPlan(f.workflow,p.sha256),changed=seal({...unseal(replacement.recipe.sourceScope),referenceStructure:legacyStructure});
  // Validation of immutable structure is exercised by the public revision API.
  assert.throws(()=>flow.reviseCoherentSources(f.workflow,batch.sha256,{batchId:'drop.group',replacements:[{
    assetId:p.recipe.assetId,planId:'drop.group.landmark',intent:'isolated-layer-v4',sourceScope:changed}]}),e=>e.errors?.some(x=>x.code==='REFERENCE_STRUCTURE_REVISION_CHANGE'));
});
