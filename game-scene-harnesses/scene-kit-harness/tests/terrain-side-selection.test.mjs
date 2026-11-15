import test from 'node:test';
import assert from 'node:assert/strict';
import {combineTerrainSideInputs,combineTerrainUpperInputs,readTerrainSideSelection,terrainEdgeSourceOrigin} from '../src/terrain-edge-selection.mjs';
import {buildTerrainEdgeDelivery,verifyTerrainEdgeDelivery} from '../src/terrain-edge-pipeline.mjs';
import {hash,seal,unseal} from '../src/generation/common.mjs';
const roles=['left-wall','right-wall','left-top-corner','right-top-corner','bottom-edge','left-bottom-corner','right-bottom-corner'];
const sha=s=>hash(Buffer.from(s)),bindings=Object.fromEntries(['baseBatchSha256','referencePlanSha256','targetSha256','materialPlanSha256','materialRawSha256','policySha256',
  'nativeSizeProfile','renderEnvelopeProfile','naturalSurfaceProfile'].map(k=>[k,sha(k)]));
function view(name,requested=roles){
  const sources=requested.map(role=>{const raw=Buffer.from(name+'/'+role);return {status:'pending-visual-review',raw,
    plan:{sha256:sha(name+'/'+role+'/plan'),recipe:{edgeRole:role}},
    result:{sha256:sha(name+'/'+role+'/result'),rawSha256:hash(raw),technical:{status:'pass',sha256:sha(name+'/'+role+'/qa')}}};});
  return {batch:seal({...bindings,batchId:name,coverageProfile:'full-perimeter-v1',coverage:requested.length===7?'complete':'explicit-subset-replacement',planSha256s:sources.map(s=>s.plan.sha256)}),
    sources,reference:{plan:{id:'same.reference'},raw:Buffer.from('same reference')},material:{plan:{id:'same.material'},raw:Buffer.from('same material')}};
}
const rejects=(fn,code)=>assert.throws(fn,e=>e.errors?.some(i=>i.code===code));

test('disjoint wall and upper subsets keep seven checked role identities, original origin views and order-independent selection',()=>{
  const base=view('base'),upper=view('upper',['left-top-corner','right-top-corner']),left=view('left',['left-wall']),before=structuredClone([base,upper,left]),
    result=combineTerrainSideInputs(base,[upper,left]),reverse=combineTerrainSideInputs(base,[left,upper]);
  assert.equal(result.selection.sha256,reverse.selection.sha256);unseal(result.selection);
  assert.equal(result.sources.length,7);assert.equal(result.selection.generationCalls,0);assert.equal(result.selection.computeAuthorizationIncluded,false);
  assert.equal(result.selection.artAcceptance,'not-transferred');
  for(const role of roles){const origin=role==='left-wall'?left:role.endsWith('top-corner')?upper:base,item=result.sources.find(s=>s.plan.recipe.edgeRole===role),record=result.selection.sources.find(s=>s.edgeRole===role);
    assert.equal(item,origin.sources.find(s=>s.plan.recipe.edgeRole===role));assert.equal(record.batchSha256,origin.batch.sha256);
    assert.equal(terrainEdgeSourceOrigin(result,item),origin===base?result:origin);
    assert.equal(Object.hasOwn(record,'replacedPlanSha256'),origin!==base);
  }
  assert.deepEqual(structuredClone([base,upper,left]),before);
  const legacy=combineTerrainUpperInputs(base,upper),legacyBefore=structuredClone(legacy.selection);combineTerrainSideInputs(base,[upper,left]);
  assert.deepEqual(combineTerrainUpperInputs(base,upper).selection,legacyBefore);assert.equal(legacy.selection.format,'ai_scene_terrain_upper_selection_v1');
});

test('ambiguous duplicate roles, duplicate batches, bottom roles and incomplete base coverage are rejected',()=>{
  const base=view('base'),a=view('a',['left-wall']),b=view('b',['left-wall']);
  rejects(()=>combineTerrainSideInputs(base,[a,b]),'TERRAIN_PERIMETER_SELECTION_DUPLICATE_ROLE');
  rejects(()=>combineTerrainSideInputs(base,[a,a]),'TERRAIN_PERIMETER_SELECTION_BINDING');
  rejects(()=>combineTerrainSideInputs(base,[base]),'TERRAIN_PERIMETER_SELECTION_BINDING');
  rejects(()=>combineTerrainSideInputs(base,[view('bottom',['bottom-edge'])]),'TERRAIN_PERIMETER_SELECTION_COVERAGE');
  rejects(()=>combineTerrainSideInputs(view('short',['left-wall']),[a]),'TERRAIN_PERIMETER_SELECTION_COVERAGE');
  rejects(()=>combineTerrainSideInputs(base,[]),'TERRAIN_PERIMETER_SELECTION_COVERAGE');
});

test('raw/QA/status and reference/material bindings cannot be borrowed from another checked batch',()=>{
  const base=view('base');
  for(const change of [v=>v.sources[0].raw=Buffer.from('different'),v=>v.sources[0].status='failed-technical',v=>v.sources[0].result.technical.status='fail']){
    const changed=view('wall',['left-wall']);change(changed);rejects(()=>combineTerrainSideInputs(base,[changed]),'TERRAIN_PERIMETER_SELECTION_SOURCE');
  }
  for(const change of [v=>v.batch=seal({...unseal(v.batch),materialRawSha256:sha('other')}),v=>v.reference.raw=Buffer.from('other'),v=>v.material.plan.id='other']){
    const changed=view('wall',['left-wall']);change(changed);rejects(()=>combineTerrainSideInputs(base,[changed]),'TERRAIN_PERIMETER_SELECTION_BINDING');
  }
});

test('invalid selectors and conflicting old/new options stop before workflow reads or output writes',()=>{
  for(const values of [[],[sha('a'),sha('a')],['bad'],undefined,Array(5).fill(sha('a'))])
    rejects(()=>readTerrainSideSelection('unopened-workflow',sha('base'),values),'TERRAIN_PERIMETER_SELECTION_BINDING');
  const options={workflow:'unopened-workflow',baseKitRoot:'unopened-kit',batchSha256:sha('base'),controls:{},output:'unwritten-output',
    upperReplacementBatchSha256:sha('upper'),replacementBatchSha256s:[sha('wall')]};
  for(const fn of [buildTerrainEdgeDelivery,verifyTerrainEdgeDelivery])rejects(()=>fn(options),'TERRAIN_PERIMETER_SELECTION_BINDING');
});
