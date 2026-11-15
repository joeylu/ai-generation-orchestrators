import test from 'node:test';
import assert from 'node:assert/strict';
import {setupCoherent} from './helpers/coherent.mjs';
import {decision} from './helpers/generation.mjs';
import * as flow from '../src/generation/index.mjs';
import {assessCoherentSource} from '../src/generation/coherent-source.mjs';
import {validateSourceFraming} from '../src/generation/source-framing.mjs';
import {encodeRgbaPng} from '../src/png.mjs';
const PROFILE=flow.COMPLETE_SOURCE_FRAMING_PROFILE;
const code=(e,c)=>e.errors?.some(x=>x.code===c);
const brief=(extra={})=>({subjectId:'landmark',parentRole:'far',content:'One complete isolated mechanical gate and its own hinged arms.',exclusions:['Separate moving cargo and floor'],...extra});

test('new source framing is explicit, retains source ownership and does not rewrite unrelated or historical requests',t=>{
  const f=setupCoherent(t),oldScopes=flow.createLayerSourceScopes(f.brief.requirements,[brief()]);
  const options={...f.options,sourceScopes:oldScopes},old=flow.previewCoherentSources(f.workflow,options);
  const nextScopes=flow.createLayerSourceScopes(f.brief.requirements,[brief({framingProfile:PROFILE})]);
  const next=flow.previewCoherentSources(f.workflow,{...options,sourceScopes:nextScopes});
  for(const p of old.plans){const n=next.plans.find(n=>n.recipe.assetId===p.recipe.assetId);
    if(p.recipe.assetId!=='landmark.actual'){assert.deepEqual(n,p);continue;}
    assert(p.request.prompt.includes('12 percent'));assert(!n.request.prompt.includes('12 percent'));
    assert(n.request.prompt.includes('antialiased edges, owned shadows and glow'));
    assert(n.request.prompt.includes('No owned contour, shadow or glow is cut'));
    assert(n.request.prompt.includes(brief().content));assert(n.request.prompt.includes(brief().exclusions[0]));
    assert.equal(n.sourceScope.framingProfile,PROFILE);assert.notEqual(n.sha256,p.sha256);
    assert.deepEqual(n.request.images,p.request.images);assert.deepEqual(n.target,p.target);assert.deepEqual(n.qualityPolicy,p.qualityPolicy);
    assert.equal(n.request.maximumCalls,1);
  }
  assert.deepEqual(flow.previewCoherentSources(f.workflow,options),old);
});

test('a framing-only revision freezes a new digest, preserves the old authorization and still needs a fresh one',t=>{
  const f=setupCoherent(t),sourceScopes=flow.createLayerSourceScopes(f.brief.requirements,[brief()]);
  const batch=flow.freezeCoherentSources(f.workflow,{...f.options,sourceScopes});
  const old=batch.planSha256s.map(s=>flow.getGenerationPlan(f.workflow,s)).find(p=>p.recipe.assetId==='landmark.actual');
  flow.authorizeReferenceAssetBatch(f.workflow,batch.sha256,decision('old.framing.compute',batch.sha256,'approve-compute'));
  const next=flow.reviseCoherentSources(f.workflow,batch.sha256,{batchId:'framing.revision',replacements:[{
    assetId:old.recipe.assetId,planId:'framing.revision.gate',intent:'isolated-layer-v4',sourceScope:flow.withSourceFraming(old.recipe.sourceScope)}]});
  const newSha=next.planSha256s.find(s=>!batch.planSha256s.includes(s)),plan=flow.getGenerationPlan(f.workflow,newSha);
  assert.deepEqual(flow.getGenerationPlan(f.workflow,old.sha256),old);
  assert.deepEqual(plan.recipe.parents,[old.sha256]);assert.equal(plan.recipe.sourceScope.framingProfile,PROFILE);
  assert.throws(()=>flow.reservePlan(f.workflow,newSha),e=>code(e,'AUTHORIZATION_REQUIRED'));
  const entries=flow.inspectWorkflow(f.workflow).plans;
  assert.equal(entries.find(p=>p.planSha256===old.sha256).status,'authorized');
  assert.equal(entries.find(p=>p.planSha256===newSha).status,'planned');
  assert(entries.filter(p=>[old.sha256,newSha].includes(p.planSha256)).every(p=>!p.reserved));
});

test('framing keeps the transparent PNG gate: small safe margins pass and clipped contours fail',t=>{
  const f=setupCoherent(t),sourceScopes=flow.createLayerSourceScopes(f.brief.requirements,[brief({framingProfile:PROFILE})]);
  const p=flow.previewCoherentSources(f.workflow,{...f.options,sourceScopes}).plans.find(p=>p.recipe.assetId==='landmark.actual');
  const size=512,rgba=Buffer.alloc(size*size*4);
  // Less than one percent on each side. This is technical evidence only, not art.
  for(let y=4;y<size-4;y++)for(let x=4;x<size-4;x++)rgba.set([40,90,130,255],(y*size+x)*4);
  assert.equal(assessCoherentSource(p,encodeRgbaPng(size,size,rgba)).status,'pass');
  rgba.set([40,90,130,255],(200*size)*4);
  const clipped=assessCoherentSource(p,encodeRgbaPng(size,size,rgba));
  assert.equal(clipped.status,'fail');assert(clipped.issues.includes('COHERENT_CLIPPED_SILHOUETTE'));
});

test('invalid profiles and incompatible opaque or band sources fail instead of silently ignoring framing',t=>{
  const f=setupCoherent(t);
  assert.throws(()=>flow.createLayerSourceScopes(f.brief.requirements,[brief({framingProfile:'anything'})]),e=>code(e,'SOURCE_FRAMING_PROFILE'));
  for(const role of ['sky','ground','material'])assert.throws(()=>validateSourceFraming({role,framingProfile:PROFILE}),e=>code(e,'SOURCE_FRAMING_ROLE'));
  assert.throws(()=>flow.createLayerSourceScopes(f.brief.requirements,[{subjectId:'sky',parentRole:'background',content:'Sky only',exclusions:[],framingProfile:PROFILE}]),e=>code(e,'SOURCE_FRAMING_ROLE'));
  for(const field of ['backgroundBand','bandCompositionGuide'])assert.throws(()=>validateSourceFraming({role:'valley',framingProfile:PROFILE,[field]:{}}),e=>code(e,'SOURCE_FRAMING_ROLE'));
});
